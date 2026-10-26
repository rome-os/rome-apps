import { createHash } from "node:crypto";
import type { RomeAppApiHandler, RomeAppContext } from "@rome-os/app-runtime";
import {
  ROOT,
  allowedRepo,
  cached,
  cachedSWR,
  cachedPayload,
  comparison,
  sha,
  type ResolvedComparison,
  defaultBase,
  files,
  type FileEntry,
  fingerprintInfo,
  type FingerprintInfo,
  GitError,
  homeRepo,
  traceStore,
  type Trace,
  patch,
  refs,
  tracking,
  history,
  scanRepos,
  type Mode,
} from "../lib/git.js";
import {
  buildPage,
  worktreeSide,
  buildSnapshot,
  isPageable,
  loadUntrackedPatch,
  maxWholeDiffFiles,
  pageOf,
  patchData,
  toEntry,
  type PageData,
  type Snapshot,
  type SnapshotFile,
} from "../lib/snapshot.js";
import { PAGE_MAX_BYTES, pageEnd } from "../shared/paging.js";
/**
 * Everything known about one comparison at one fingerprint. `snap` holds all patches when the
 * whole diff fits in memory; otherwise only the file list is kept and pages are cut from git.
 */
interface View {
  info: FingerprintInfo;
  comparison: ResolvedComparison;
  head: string;
  list: FileEntry[];
  snap?: Snapshot;
  /** Comparing against a base: its resolved name, and whether it is the commit HEAD is on. */
  compare?: { ref: string; same: boolean };
}
const views = new Map<string, { promise: Promise<View>; bytes: number }>();
/** Rough size of what a view keeps alive: its patches plus the file list. */
function viewBytes(v: View) {
  return (
    (v.snap?.files.reduce((n, f) => n + f.patch.length * 2, 0) ?? 0) +
    (v.comparison.fallback?.length ?? 0) * 2 +
    v.list.length * 300
  );
}
const viewBudget = () =>
  Number(process.env.DIFFVIEW_VIEW_BUDGET) || 96 * 1024 * 1024;
/**
 * The daemon runs the API in its own process, whose heap is about 2 GB: a count limit alone let a
 * few big views add up to more than that. Drop the oldest until the total fits, but never the one
 * just built.
 */
function trimViews(keep: string) {
  let total = 0;
  for (const e of views.values()) total += e.bytes;
  for (const [key, e] of views) {
    if (total <= viewBudget() && views.size <= 6) break;
    if (key === keep) continue;
    views.delete(key);
    total -= e.bytes;
  }
}
async function buildView(
  repo: string,
  m: Mode,
  ctx: number,
  info: FingerprintInfo,
  resolved: ResolvedComparison,
): Promise<View> {
  const head =
    m.mode !== "uncommitted" && !worktreeSide(m)
      ? resolved.to || info.hash
      : info.head || "unborn";
  const compare =
    m.mode === "ref"
      ? {
          ref: m.ref || m.base!,
          same: !!info.head && resolved.from === info.head,
        }
      : undefined;
  const common = { info, head, compare, comparison: resolved };
  // `git status` already counted the changed paths; a large count means page from the start
  // instead of first computing (and discarding) the whole diff.
  if (m.mode === "uncommitted" && info.changed > maxWholeDiffFiles())
    return { ...common, list: await files(repo, m, resolved, info.conflicts) };
  try {
    const snap = await buildSnapshot(repo, m, ctx, info, resolved);
    return { ...common, snap, list: snap.files.map(toEntry) };
  } catch (e) {
    if (e instanceof GitError && e.code === "output_limit")
      return {
        ...common,
        list: await files(repo, m, resolved, info.conflicts),
      };
    throw e;
  }
}
/** Cuts one page of patches out of a view. */
async function pageFor(
  repo: string,
  m: Mode,
  ctx: number,
  view: View,
  cursor: number,
  filter = "",
): Promise<PageData> {
  // The same substring filter the file tree applies, so a cursor means the same thing on both sides.
  const eligible = view.list.filter(
    (f) => isPageable(f) && (!filter || f.path.toLowerCase().includes(filter)),
  );
  if (cursor < 0 || cursor > eligible.length)
    throw new GitError("invalid_cursor");
  let subset: SnapshotFile[];
  if (view.snap) {
    const byPath = new Map(view.snap.files.map((f) => [f.path, f]));
    const all = eligible.map((e) => byPath.get(e.path)!);
    subset = all.slice(cursor, pageOf(all, cursor).end);
  } else {
    const end = pageEnd(eligible, cursor);
    const built = await buildPage(
      repo,
      m,
      ctx,
      view.info,
      eligible.slice(cursor, end),
      view.comparison,
    );
    const byPath = new Map(built.map((f) => [f.path, f]));
    subset = eligible.slice(cursor, end).map(
      (entry) =>
        byPath.get(entry.path) ?? {
          ...entry,
          patch: "",
          lazy: !!entry.untracked,
          collapsed: true,
        },
    );
  }
  const patches: PageData["patches"] = {};
  let bytes = 0,
    count = 0;
  for (const file of subset) {
    const payload = file.lazy
      ? await loadUntrackedPatch(repo, file.path, false)
      : patchData(file, false);
    const size = Buffer.byteLength(payload.patch);
    // Estimate when choosing candidate paths, then enforce the actual byte budget after
    // hydrating lazy content. A large single-line file must not inflate a 150-file page.
    if (count > 0 && bytes + size > PAGE_MAX_BYTES) break;
    patches[file.path] = payload;
    bytes += size;
    count++;
  }
  const end = cursor + count;
  return { patches, next: end < eligible.length ? end : null };
}

const validModes = new Set([
  "uncommitted",
  "branch",
  "pr",
  "ref",
  "unpushed",
  "commit",
]);
export function createApiHandler(_ctx: RomeAppContext): RomeAppApiHandler {
  const inner = createInnerHandler();
  return {
    async handle(request) {
      const trace: Trace = {
        spawns: 0,
        spawnMs: 0,
        cacheHits: 0,
        cacheMisses: 0,
      };
      const started = performance.now();
      const res = await traceStore.run(trace, () => inner.handle(request));
      // Server-Timing separates our work from the platform's request path in DevTools and the browser.
      res.headers.set(
        "Server-Timing",
        `app;dur=${(performance.now() - started).toFixed(1)}, git;dur=${trace.spawnMs.toFixed(1)};desc="${trace.spawns} spawns", cache;desc="${trace.cacheHits} hit/${trace.cacheMisses} miss"`,
      );
      return res;
    },
  };
}
function createInnerHandler(): RomeAppApiHandler {
  // The scan spawns dozens of processes; do it once up front and refresh it off the request path.
  void cachedSWR("repos", () => scanRepos(), 30000).catch(() => {});
  return {
    async handle(request) {
      if (request.caller.kind !== "guardian")
        return Response.json({ error: "forbidden" }, { status: 403 });
      if (request.method !== "GET")
        return Response.json({ error: "read_only" }, { status: 405 });
      const q = request.query,
        route = request.path.join("/");
      try {
        if (route === "repos") {
          const repos = await cachedSWR("repos", () => scanRepos(), 30000);
          const raw = (q.get("project") || "default").replace(/\/+$/, "");
          const rel = raw.startsWith(ROOT + "/")
            ? raw.slice(ROOT.length + 1)
            : raw;
          const segments = rel.split("/").filter(Boolean);
          const selected =
            segments.length && !segments.some((p) => p === ".." || p === ".")
              ? ROOT + "/" + segments.join("/")
              : ROOT + "/default";
          const home = homeRepo(repos, selected);
          return Response.json({
            repos,
            root: ROOT,
            selectedProject: selected,
            homeRepo: home,
            defaultRepo: home || repos[0]?.path || "",
          });
        }
        const repo = await allowedRepo(q.get("repo") || ROOT + "/default");
        if (route === "tracking") return Response.json(await tracking(repo));
        if (route === "history")
          return Response.json(
            await history(repo, Number(q.get("cursor") || 0)),
          );
        if (route === "revisions")
          return Response.json(
            await cached(repo + ":revisions", () => refs(repo, false), 5000),
          );
        if (route === "refs")
          return Response.json(
            await cached(repo + ":refs", () => refs(repo), 30000),
          );
        if (route === "events") {
          const started = performance.now();
          const { hash } = await fingerprintInfo(repo);
          // `ms` lets the client poll no faster than the repository can answer.
          return Response.json({
            fingerprint: hash,
            ms: Math.round(performance.now() - started),
          });
        }
        const mode = (q.get("mode") || "uncommitted") as Mode["mode"];
        if (!validModes.has(mode)) throw new GitError("invalid_mode");
        const m: Mode = {
          mode,
          filter: q.get("filter") || "all",
          base: q.get("base") || (await defaultBase(repo)),
          pr: q.get("pr") || "",
          commit: q.get("commit") || "",
          ref: q.get("ref") || "",
          dots: q.get("dots") || "three",
          target: q.get("target") || "worktree",
        };
        if (
          !["all", "staged", "unstaged"].includes(m.filter!) ||
          !["two", "three"].includes(m.dots!) ||
          !["head", "worktree"].includes(m.target!)
        )
          throw new GitError("invalid_mode");
        const ctx = Number(q.get("ctx") || 3);
        if (!Number.isInteger(ctx) || ctx < 0 || ctx > 10000)
          throw new GitError("invalid_context");
        const claimed = q.get("fp") || "";
        const lookup = (fp: string) => JSON.stringify([repo, m, fp, ctx]);
        // Page and single-file requests carry the fingerprint of the list they belong to, so they
        // are answered from memory without asking git anything.
        const known = claimed ? views.get(lookup(claimed)) : undefined;
        const view = async (): Promise<{ v: View; fp: string }> => {
          if (known) return { v: await known.promise, fp: claimed };
          const mutable = m.mode === "uncommitted" || worktreeSide(m);
          const raw: FingerprintInfo = mutable
            ? await fingerprintInfo(repo)
            : {
                head: await sha(repo, "HEAD").catch(() => ""),
                hash: "",
                untracked: [],
                conflicts: [],
                changed: 0,
              };
          const resolved = await comparison(
            repo,
            m,
            raw.head,
            q.get("refresh") === "1",
          );
          const info =
            m.mode === "uncommitted"
              ? raw
              : {
                  ...raw,
                  hash: createHash("sha256")
                    .update(
                      JSON.stringify([
                        worktreeSide(m) ? raw.hash : undefined,
                        resolved.from,
                        resolved.to,
                        resolved.args,
                      ]),
                    )
                    .update(resolved.fallback ?? "")
                    .digest("hex"),
                };
          // A missing old view may be rebuilt only if it is still the same comparison.
          // Never silently attach current patches to the client's superseded file list.
          if (claimed && claimed !== info.hash)
            throw new GitError("stale_view");
          const key = lookup(info.hash);
          let entry = views.get(key);
          if (!entry) {
            const promise = buildView(repo, m, ctx, info, resolved);
            const fresh = { promise, bytes: 0 };
            entry = fresh;
            views.set(key, fresh);
            // Observe success and rejection on the same derived promise. A request-level
            // catch on `promise` alone does not handle a rejected `.then()` observer.
            void promise
              .then(
                (v) => {
                  fresh.bytes = viewBytes(v);
                  if (views.get(key) === fresh) trimViews(key);
                },
                () => {
                  if (views.get(key) === fresh) views.delete(key);
                },
              )
              .catch(() => {});
            trimViews(key);
          }
          return { v: await entry.promise, fp: info.hash };
        };
        if (route === "files") {
          const started = performance.now();
          const { v, fp } = await view();
          // Conditional refresh: the client already holds this exact list, don't send it again.
          if (fp === (q.get("have") || ""))
            return Response.json({
              unchanged: true,
              fingerprint: fp,
              ms: Math.round(performance.now() - started),
            });
          return Response.json({
            ms: Math.round(performance.now() - started),
            files: v.list,
            fallback: v.comparison.fallback !== undefined,
            // The first page travels with the list, so the first paint needs no further request.
            page: await pageFor(repo, m, ctx, v, 0),
            compare: v.compare,
            fingerprint: fp,
            head: v.head,
            base: m.base,
          });
        }
        if (route === "patches") {
          const cursor = Number(q.get("cursor") || 0);
          if (!Number.isInteger(cursor)) throw new GitError("invalid_cursor");
          const filter = (q.get("q") || "").toLowerCase().slice(0, 200);
          const { v, fp } = await view();
          return Response.json(
            await cachedPayload(
              JSON.stringify([repo, m, fp, ctx, "page", cursor, filter]),
              () => pageFor(repo, m, ctx, v, cursor, filter),
              60000,
            ),
          );
        }
        if (route === "patch") {
          // One file on explicit request: a collapsed file, "load full file", or more context.
          const context = Number(q.get("unified") || ctx);
          if (!Number.isInteger(context) || context < 0 || context > 10000)
            throw new GitError("invalid_context");
          const path = q.get("path") || "";
          const anyway = q.get("anyway") === "1";
          const { v, fp } = await view();
          const file = v.snap?.files.find((f) => f.path === path);
          const entry = v.list.find((f) => f.path === path);
          if (!entry) throw new GitError("file_not_found");
          if (entry.conflicted) throw new GitError("unmerged_conflict");
          if (
            v.comparison.fallback !== undefined &&
            (anyway || context !== ctx)
          )
            throw new GitError("fallback_context_unavailable");
          // Untracked files the snapshot did not keep are read from disk now.
          if (file?.lazy)
            return Response.json(await loadUntrackedPatch(repo, path, anyway));
          if (file && context === v.snap!.context)
            return Response.json(patchData(file, anyway));
          return Response.json(
            await cachedPayload(
              JSON.stringify([repo, m, fp, path, context, anyway]),
              () => patch(repo, m, path, context, anyway, entry, v.comparison),
            ),
          );
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      } catch (e) {
        return Response.json(
          { error: e instanceof GitError ? e.code : "internal" },
          {
            status:
              e instanceof GitError
                ? e.code === "forbidden_path"
                  ? 403
                  : ["stale_view", "unmerged_conflict"].includes(e.code)
                    ? 409
                    : 400
                : 500,
          },
        );
      }
    },
  };
}
