import { createHash } from "node:crypto";
import type { RomeAppApiHandler, RomeAppContext } from "@rome-os/app-runtime";
import {
  ROOT,
  allowedRepo,
  cached,
  cachedSWR,
  defaultBase,
  sha,
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
/**
 * Everything known about one comparison at one fingerprint. `snap` holds all patches when the
 * whole diff fits in memory; otherwise only the file list is kept and pages are cut from git.
 */
interface View {
  info: FingerprintInfo;
  head: string;
  list: FileEntry[];
  snap?: Snapshot;
  /** Comparing against a base: its resolved name, and whether it is the commit HEAD is on. */
  compare?: { ref: string; same: boolean };
}
const views = new Map<
  string,
  { promise: Promise<View>; at: number; bytes: number }
>();
/** Rough size of what a view keeps alive: its patches plus the file list. */
function viewBytes(v: View) {
  return (
    (v.snap?.files.reduce((n, f) => n + f.patch.length, 0) ?? 0) +
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
async function compareMeta(
  repo: string,
  m: Mode,
  info: FingerprintInfo,
): Promise<View["compare"]> {
  if (m.mode !== "ref") return undefined;
  try {
    const ref = m.ref || (await defaultBase(repo));
    return { ref, same: !!info.head && (await sha(repo, ref)) === info.head };
  } catch {
    return undefined; // an invalid ref is reported by the comparison itself
  }
}
async function buildView(
  repo: string,
  m: Mode,
  ctx: number,
  info: FingerprintInfo,
): Promise<View> {
  const head = info.head || "unborn";
  const compare = await compareMeta(repo, m, info);
  // `git status` already counted the changed paths; a large count means page from the start
  // instead of first computing (and discarding) the whole diff.
  if (m.mode === "uncommitted" && info.changed > maxWholeDiffFiles())
    return { info, head, compare, list: await files(repo, m) };
  try {
    const snap = await buildSnapshot(repo, m, ctx, info);
    return { info, head, compare, snap, list: snap.files.map(toEntry) };
  } catch (e) {
    if (e instanceof GitError && e.code === "output_limit")
      return { info, head, compare, list: await files(repo, m) };
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
  if (view.snap) {
    const byPath = new Map(view.snap.files.map((f) => [f.path, f]));
    const page = pageOf(
      eligible.map((e) => byPath.get(e.path)!),
      cursor,
    );
    for (const f of page.lazy)
      page.patches[f.path] = await loadUntrackedPatch(repo, f.path, false);
    return {
      patches: page.patches,
      next: page.end < eligible.length ? page.end : null,
    };
  }
  // Too large to hold at once: the page's own paths, one git diff for the whole page.
  const end = pageOf(
    eligible.map((e) => ({ ...e, patch: "" }) as SnapshotFile),
    cursor,
  ).end;
  const built = await buildPage(
    repo,
    m,
    ctx,
    view.info,
    eligible.slice(cursor, end),
  );
  const byPath = new Map(built.map((f) => [f.path, f]));
  const patches: PageData["patches"] = {};
  for (const f of eligible.slice(cursor, end)) {
    const file = byPath.get(f.path);
    if (file) patches[f.path] = patchData(file, false);
  }
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
          let info = await fingerprintInfo(repo);
          if (m.mode === "unpushed") {
            const upstream = await tracking(repo);
            info = {
              ...info,
              hash: createHash("sha256")
                .update(JSON.stringify([info.hash, upstream]))
                .digest("hex"),
            };
          } else if (m.mode === "commit" || m.mode === "ref") {
            const selected = await sha(
              repo,
              m.mode === "commit" ? m.commit || "" : m.ref || m.base || "HEAD",
            );
            info = {
              ...info,
              hash: createHash("sha256")
                .update(JSON.stringify([info.hash, selected]))
                .digest("hex"),
            };
          }
          const key = lookup(info.hash);
          let entry = views.get(key);
          // PR/legacy branch metadata may change independently of the worktree;
          // periodically rebuild non-local views even when the fingerprint is stable.
          if (entry && m.mode !== "uncommitted" && Date.now() - entry.at > 5000)
            entry = undefined;
          if (!entry) {
            const promise = buildView(repo, m, ctx, info);
            const fresh = { promise, at: Date.now(), bytes: 0 };
            entry = fresh;
            views.set(key, fresh);
            void promise
              .then((v) => {
                fresh.bytes = viewBytes(v);
                trimViews(key);
              })
              .catch(() => {});
            trimViews(key);
            // A failed build must not be remembered.
            promise.catch(() => views.delete(key));
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
            await cached(
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
          // Untracked files the snapshot did not keep are read from disk now.
          if (file?.lazy)
            return Response.json(await loadUntrackedPatch(repo, path, anyway));
          if (file && context === v.snap!.context)
            return Response.json(patchData(file, anyway));
          return Response.json(
            await cached(
              JSON.stringify([repo, m, fp, path, context, anyway]),
              () => patch(repo, m, path, context, anyway, entry),
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
                  : 400
                : 500,
          },
        );
      }
    },
  };
}
