import { syntheticPatch } from "./patchFormat.js";
import { parsePatchFiles } from "@pierre/diffs";
import { AsyncLocalStorage } from "node:async_hooks";
import { verifyOpenedFile } from "./fileSafety.js";
import { BoundedCache } from "./cache.js";
import { spawn } from "node:child_process";
import { realpath, readdir, lstat, open } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { constants } from "node:fs";
export const ROOT = join(
  homedir(),
  ".rome",
  process.env.ROME_PROFILE || "default",
  "projects",
);
export class GitError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export function validateRef(ref: string) {
  if (
    !ref ||
    ref.length > 256 ||
    ref.startsWith("-") ||
    /[\x00-\x20\x7f]/.test(ref)
  )
    throw new GitError("invalid_ref");
  return ref;
}
export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}
const allowedCache = new Map<string, { at: number; repo: string }>();
/** Validated repositories are remembered for a few seconds: the check costs three processes. */
export async function allowedRepo(input: string, root = ROOT) {
  const key = root + "\0" + input;
  const hit = allowedCache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.repo;
  const repo = await allowedRepoUncached(input, root);
  allowedCache.set(key, { at: Date.now(), repo });
  if (allowedCache.size > 64)
    allowedCache.delete(allowedCache.keys().next().value!);
  return repo;
}
async function allowedRepoUncached(input: string, root = ROOT) {
  const base = await realpath(root);
  const repo = await realpath(input).catch(() => {
    throw new GitError("not_repo");
  });
  if (!inside(base, repo)) throw new GitError("forbidden_path");
  const top = (
    await git(repo, ["rev-parse", "--show-toplevel"]).catch(() => {
      throw new GitError("not_repo");
    })
  ).trim();
  if ((await realpath(top)) !== repo) throw new GitError("not_repo");
  const dir = (await git(repo, ["rev-parse", "--absolute-git-dir"])).trim();
  if (!inside(base, await realpath(dir))) throw new GitError("forbidden_path");
  return repo;
}
/** Per-request counters so the API can report where a request's time went (Server-Timing). */
export interface Trace {
  spawns: number;
  spawnMs: number;
  cacheHits: number;
  cacheMisses: number;
}
export const traceStore = new AsyncLocalStorage<Trace>();
export function command(
  cwd: string,
  bin: string,
  args: string[],
  cap = 8 * 1024 * 1024,
  timeout = 15000,
  input?: string,
  /** `latin1` keeps every byte of binary output (cat-file); text output stays utf8. */
  encoding: "utf8" | "latin1" = "utf8",
): Promise<string> {
  const trace = traceStore.getStore();
  const started = performance.now();
  return new Promise((res, rej) => {
    let chunks: Buffer[] = [],
      size = 0,
      stderr = "",
      done = false;
    const p = spawn(bin, args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GH_PROMPT_DISABLED: "true",
      },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (input !== undefined) {
      p.stdin!.on("error", () => {});
      p.stdin!.end(input);
    }
    const finish = (e?: Error, out?: string) => {
      if (done) return;
      done = true;
      if (trace) {
        trace.spawns++;
        trace.spawnMs += performance.now() - started;
      }
      clearTimeout(timer);
      e ? rej(e) : res(out || "");
    };
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      finish(new GitError("timeout"));
    }, timeout);
    p.stdout!.on("data", (b: Buffer) => {
      size += b.length;
      if (size > cap) {
        p.kill("SIGKILL");
        finish(new GitError("output_limit"));
      } else chunks.push(b);
    });
    p.stderr!.on("data", (b) => {
      if (stderr.length < 2000) stderr += b.toString();
    });
    p.on("error", (e) =>
      finish(
        new GitError(
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "missing_tool"
            : "command_failed",
          e.message,
        ),
      ),
    );
    p.on("close", (code) =>
      finish(
        code ? new GitError("command_failed", stderr.trim()) : undefined,
        Buffer.concat(chunks).toString(encoding),
      ),
    );
  });
}
export function git(
  cwd: string,
  args: string[],
  cap?: number,
  timeout?: number,
  input?: string,
  encoding?: "utf8" | "latin1",
) {
  return command(
    cwd,
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "gc.auto=0",
      "-c",
      "maintenance.auto=false",
      ...args,
    ],
    cap,
    timeout,
    input,
    encoding,
  );
}
export async function sha(repo: string, ref: string) {
  validateRef(ref);
  return (
    await git(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      ref + "^{commit}",
    ]).catch(() => {
      throw new GitError("invalid_ref");
    })
  ).trim();
}
const tryGit = async (r: string, a: string[], fallback = "") =>
  git(r, a)
    .then((x) => x.trim())
    .catch(() => fallback);
export function defaultBase(repo: string) {
  return cached(
    repo + ":default-base",
    () => defaultBaseUncached(repo),
    30_000,
  );
}
async function defaultBaseUncached(repo: string) {
  const origin = await tryGit(repo, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (origin) return origin;
  for (const ref of ["main", "master"])
    if (await tryGit(repo, ["rev-parse", "--verify", ref])) return ref;
  return await tryGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"], "HEAD");
}
export async function scanRepos(root = ROOT) {
  const base = await realpath(root);
  const seen = new Set<string>(),
    repos: string[] = [];
  async function walk(path: string, depth: number) {
    let real: string;
    try {
      real = await realpath(path);
      if (!inside(base, real) || seen.has(real)) return;
      seen.add(real);
      const entries = await readdir(real, { withFileTypes: true });
      if (entries.some((e) => e.name === ".git")) {
        try {
          repos.push(await allowedRepo(real, base));
        } catch {}
      }
      if (depth >= 3) return;
      await Promise.all(
        entries
          .filter(
            (e) =>
              e.isDirectory() &&
              !e.name.startsWith(".") &&
              !["node_modules", "dist", "vendor"].includes(e.name),
          )
          .map((e) => walk(join(real, e.name), depth + 1)),
      );
    } catch {}
  }
  await walk(base, 0);
  return Promise.all(
    repos.sort().map(async (path) => ({
      path,
      name: relative(base, path),
      branch: await tryGit(path, ["symbolic-ref", "--short", "HEAD"], "HEAD"),
      base: await defaultBase(path),
      lastCommit:
        Number(await tryGit(path, ["log", "-1", "--format=%ct"], "0")) || 0,
    })),
  );
}
export interface FileEntry {
  path: string;
  oldPath?: string;
  status: string;
  added: number;
  deleted: number;
  binary: boolean;
  collapsed: boolean;
  untracked?: boolean;
  conflicted?: boolean;
  typeChanged?: boolean;
}
export function parseNumstat(text: string) {
  const fields = text.split("\0");
  const out = new Map<
    string,
    { added: number; deleted: number; binary: boolean; oldPath?: string }
  >();
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    const m = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(fields[i]);
    if (!m) continue;
    let path = m[3],
      oldPath: string | undefined;
    if (!path) {
      oldPath = fields[++i];
      path = fields[++i];
    }
    out.set(path, {
      added: m[1] === "-" ? 0 : Number(m[1]),
      deleted: m[2] === "-" ? 0 : Number(m[2]),
      binary: m[1] === "-",
      oldPath,
    });
  }
  return out;
}
export function parseRaw(text: string) {
  const a = text.split("\0");
  const out: { path: string; oldPath?: string; status: string }[] = [];
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith(":")) continue;
    const status = a[i].split(" ").at(-1)![0];
    let path = a[++i],
      oldPath: string | undefined;
    if (status === "R" || status === "C") {
      oldPath = path;
      path = a[++i];
    }
    out.push({ path, oldPath, status });
  }
  return out;
}
export function collapseHint(path: string) {
  return /(^|\/)([^/]*lock[^/]*|[^/]*\.min\.[^/]+|[^/]*\.generated\.[^/]+|dist|vendor)(\/|$)/i.test(
    path,
  );
}
export interface Mode {
  mode: "uncommitted" | "branch" | "pr" | "ref" | "unpushed" | "commit";
  filter?: string;
  base?: string;
  ref?: string;
  dots?: string;
  target?: string;
  pr?: string;
  commit?: string;
}
export function diffArgs(m: Mode, from?: string, to = "HEAD") {
  if (m.mode === "uncommitted")
    return m.filter === "staged"
      ? ["--cached"]
      : m.filter === "unstaged"
        ? []
        : ["HEAD"];
  if (!from) throw new GitError("invalid_ref");
  if (m.mode === "branch" || m.mode === "pr") return [from + "..." + to];
  return m.target === "worktree"
    ? [from]
    : [from + (m.dots === "two" ? ".." : "...") + to];
}
export interface ResolvedComparison {
  args: string[];
  from?: string;
  to?: string;
  /** Empty string is a valid empty remote diff, not a missing fallback. */
  fallback?: string;
}
interface PrMetadata {
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
  url: string;
}
function prLocation(value: string, n: string) {
  const url = new URL(value);
  const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !match ||
    match[3] !== n
  )
    throw new GitError("pr_unavailable");
  return {
    git: url.origin + "/" + match[1] + "/" + match[2] + ".git",
    hostname: url.host,
    api: "repos/" + match[1] + "/" + match[2] + "/pulls/" + n,
  };
}
export function prRepository(meta: PrMetadata, n: string) {
  const location = prLocation(meta.url, n);
  if (
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(meta.headRefOid) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(meta.baseRefOid)
  )
    throw new GitError("pr_unavailable");
  validateRef(meta.baseRefName);
  return location.git;
}
/** Compare repository identity without confusing a same-named PR in a different fork. */
export function remoteRepository(value: string): string | undefined {
  let host: string, path: string;
  try {
    const scp = /^(?:[^@/:]+@)?([^/:]+):([^/].*)$/.exec(value);
    if (scp && !value.includes("://")) {
      host = scp[1];
      path = scp[2];
    } else {
      const url = new URL(value);
      if (
        !["https:", "http:", "ssh:", "git:"].includes(url.protocol) ||
        url.search ||
        url.hash
      )
        return;
      host = url.hostname;
      path = url.pathname.replace(/^\//, "");
    }
    const match = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(path);
    if (match) return (host + "/" + match[1] + "/" + match[2]).toLowerCase();
  } catch {
    /* local paths and unsupported URLs cannot establish repository identity */
  }
}
export async function prFetchSource(repo: string, canonical: string) {
  const expected = remoteRepository(canonical);
  const names = (await git(repo, ["remote"]))
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const name of names) {
    const urls = await tryGit(repo, ["remote", "get-url", "--all", name]);
    // Fetch uses the first fetch URL, not a push URL or a later alternative URL.
    const url = urls.split("\n")[0];
    if (expected && remoteRepository(url) === expected) return name;
  }
  return canonical;
}
async function deleteReviewRefs(repo: string, entries: string[]) {
  if (!entries.length) return;
  // Compare-and-delete: do not delete a ref if another writer changed its value.
  const input = entries
    .map((entry) => {
      const [ref, oid] = entry.split("\t");
      return "delete " + ref + " " + oid + "\n";
    })
    .join("");
  await git(repo, ["update-ref", "--stdin"], undefined, undefined, input);
}
async function reviewRefs(repo: string, prefixes: string[]) {
  return (
    await git(repo, [
      "for-each-ref",
      "--format=%(refname)%09%(objectname)",
      ...prefixes,
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}
/** Retire legacy retained refs and abandoned temporary refs, never active fetch namespaces. */
export async function pruneReviewRefs(repo: string, now = Date.now()) {
  const entries = await reviewRefs(repo, [
    "refs/diffview/pr/",
    "refs/diffview/pulls/",
    "refs/diffview/tmp/",
  ]);
  await deleteReviewRefs(
    repo,
    entries.filter((entry) => {
      const ref = entry.split("\t")[0];
      if (
        ref.startsWith("refs/diffview/pr/") ||
        ref.startsWith("refs/diffview/pulls/")
      )
        return true;
      const match = /^refs\/diffview\/tmp\/(\d+)-[a-z0-9-]+\/(base|head)$/.exec(
        ref,
      );
      return !!match && Number(match[1]) < now - 3600_000;
    }),
  );
}
const prCache = new BoundedCache(6, 32 * 1024 * 1024);
async function prCompare(repo: string, n: string, refresh = false) {
  if (!/^[1-9]\d{0,7}$/.test(n)) throw new GitError("invalid_pr");
  return prCache.get(
    repo + ":" + n,
    async () => {
      let meta: PrMetadata, source: string;
      try {
        // Older supported gh releases expose headRefOid but not baseRefOid in `pr view`.
        // Resolve gh's canonical repository first, then read both OIDs from stable REST data.
        const initial = JSON.parse(
          await command(repo, "gh", ["pr", "view", n, "--json", "url"]),
        );
        const location = prLocation(initial.url, n);
        meta = JSON.parse(
          await command(repo, "gh", [
            "api",
            "--hostname",
            location.hostname,
            location.api,
            "--jq",
            "{url:.html_url,baseRefName:.base.ref,baseRefOid:.base.sha,headRefOid:.head.sha}",
          ]),
        );
        source = prRepository(meta, n);
        if (source !== location.git) throw new GitError("pr_unavailable");
        await git(repo, ["check-ref-format", "refs/heads/" + meta.baseRefName]);
      } catch {
        throw new GitError("pr_unavailable");
      }
      try {
        await cached(
          repo + ":pr-ref-cleanup",
          () => pruneReviewRefs(repo),
          60000,
        );
        source = await prFetchSource(repo, source);
        const temp = "refs/diffview/tmp/" + Date.now() + "-" + randomUUID();
        try {
          await git(
            repo,
            [
              "fetch",
              "--no-auto-maintenance",
              "--recurse-submodules=no",
              "--atomic",
              "--no-tags",
              "--no-write-fetch-head",
              "--refmap=",
              "--",
              source,
              "+refs/heads/" + meta.baseRefName + ":" + temp + "/base",
              "+refs/pull/" + n + "/head:" + temp + "/head",
            ],
            undefined,
            25000,
          );
          const from = await sha(repo, temp + "/base"),
            to = await sha(repo, temp + "/head");
          if (from !== meta.baseRefOid || to !== meta.headRefOid)
            throw new GitError("pr_changed_during_fetch");
          return { from, to };
        } finally {
          await deleteReviewRefs(repo, await reviewRefs(repo, [temp + "/"]));
        }
      } catch {
        // An authoritative server diff is safer than mixing a fork's refs or racing endpoints.
        return {
          from: "",
          to: "",
          fallback: await command(
            repo,
            "gh",
            ["pr", "diff", n, "--color=never"],
            8 * 1024 * 1024,
            25000,
          ),
        };
      }
    },
    60000,
    refresh,
  );
}
/** Tracking is local metadata only. Never fetch, change branches, or guess a base. */
export interface TrackingInfo {
  state: "ready" | "no_upstream" | "detached" | "unborn" | "upstream_missing";
  upstream: string;
  head: string;
  upstreamHead: string;
  ahead: number;
  behind: number;
}
export async function tracking(repo: string): Promise<TrackingInfo> {
  const result: TrackingInfo = {
    state: "unborn",
    upstream: "",
    head: "",
    upstreamHead: "",
    ahead: 0,
    behind: 0,
  };
  result.head = await tryGit(repo, ["rev-parse", "--verify", "HEAD"]);
  if (!result.head) return result;
  const branch = await tryGit(repo, ["symbolic-ref", "--quiet", "HEAD"]);
  if (!branch) return { ...result, state: "detached" };
  result.upstream = await tryGit(repo, [
    "for-each-ref",
    "--format=%(upstream:short)",
    branch,
  ]);
  if (!result.upstream) return { ...result, state: "no_upstream" };
  result.upstreamHead = await sha(repo, result.upstream).catch(() => "");
  if (!result.upstreamHead) return { ...result, state: "upstream_missing" };
  const counts = (
    await git(repo, [
      "rev-list",
      "--left-right",
      "--count",
      result.upstreamHead + "..." + result.head,
    ])
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  return { ...result, state: "ready", behind: counts[0], ahead: counts[1] };
}
export interface CommitInfo {
  sha: string;
  title: string;
  timestamp: number;
}
/** Bounded pages, independent of GitHub availability. Empty repositories have no history. */
export async function history(repo: string, cursor = 0) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > 1_000_000)
    throw new GitError("invalid_cursor");
  if (!(await tryGit(repo, ["rev-parse", "--verify", "HEAD"])))
    return { commits: [] as CommitInfo[], next: null as number | null };
  const text = await git(
    repo,
    ["log", "-41", "--skip=" + cursor, "--format=%H%x09%ct%x09%s"],
    256 * 1024,
  );
  const rows = text.trimEnd().split("\n").filter(Boolean);
  const commits: CommitInfo[] = rows.slice(0, 40).map((row) => {
    const [sha, timestamp, ...title] = row.split("\t");
    return { sha, timestamp: Number(timestamp), title: title.join("\t") };
  });
  return { commits, next: rows.length > 40 ? cursor + 40 : null };
}
export async function comparison(
  repo: string,
  m: Mode,
  head?: string,
  refresh = false,
): Promise<ResolvedComparison> {
  if (m.mode === "commit") {
    const to = await sha(repo, m.commit || "");
    const parents = (await git(repo, ["rev-list", "--parents", "-n", "1", to]))
      .trim()
      .split(/\s+/);
    // First-parent diff for merges; root commits compare with the empty tree (also SHA-256 safe).
    const from =
      parents[1] ||
      (
        await git(
          repo,
          ["hash-object", "-t", "tree", "--stdin"],
          undefined,
          undefined,
          "",
        )
      ).trim();
    return { from, to, args: [from, to] };
  }
  if (m.mode === "unpushed") {
    const info = await tracking(repo);
    if (info.state !== "ready") throw new GitError(info.state);
    const from = await git(repo, ["merge-base", info.upstreamHead, info.head])
      .then((s) => s.trim())
      .catch(() => {
        throw new GitError("no_merge_base");
      });
    return { from: info.upstreamHead, to: info.head, args: [from, info.head] };
  }
  if (m.mode === "pr") {
    const r = await prCompare(repo, m.pr || "", refresh);
    return {
      ...r,
      args: r.fallback !== undefined ? [] : diffArgs(m, r.from, r.to),
    };
  }
  if (m.mode === "uncommitted") {
    let args = diffArgs(m);
    if (
      m.filter !== "staged" &&
      m.filter !== "unstaged" &&
      !(head ?? (await tryGit(repo, ["rev-parse", "--verify", "HEAD"])))
    )
      args = [
        (
          await git(
            repo,
            ["hash-object", "-t", "tree", "--stdin"],
            undefined,
            undefined,
            "",
          )
        ).trim(),
      ];
    if (args[0] === "HEAD" && head) args = [head];
    return { args };
  }
  const from = await sha(
    repo,
    validateRef(
      m.mode === "branch"
        ? m.base || (await defaultBase(repo))
        : m.ref || (await defaultBase(repo)),
    ),
  );
  const to = head || (await sha(repo, "HEAD"));
  if (m.mode === "ref" && m.target === "worktree" && m.dots !== "two") {
    const merge = (await git(repo, ["merge-base", from, to])).trim();
    return { from, to, args: [merge] };
  }
  return { from, to, args: diffArgs(m, from, to) };
}
/** `Promise.all(items.map(fn))` that never has more than `limit` calls in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
export interface FingerprintInfo {
  hash: string;
  /** Commit HEAD points at; empty on an unborn branch. */
  head: string;
  untracked: string[];
  conflicts?: string[];
  /** Paths git status lists as changed (staged, unstaged or untracked): a free size signal. */
  changed: number;
}
/**
 * One `git status` gives everything the other views need: HEAD, the untracked files, and which
 * paths changed (whose mtime/size are folded in so editing an already-modified file is noticed).
 */
async function fingerprintInfoUncached(repo: string): Promise<FingerprintInfo> {
  const status = await git(repo, [
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  const parts = status.split("\0");
  let head = "";
  const paths: string[] = [],
    untracked: string[] = [],
    conflicts: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    if (e.startsWith("# branch.oid ")) {
      const oid = e.slice("# branch.oid ".length);
      head = oid === "(initial)" ? "" : oid;
    } else if (e[0] === "1") paths.push(e.split(" ").slice(8).join(" "));
    else if (e[0] === "2") {
      paths.push(e.split(" ").slice(9).join(" "));
      i++; // the original path follows as its own NUL field
    } else if (e[0] === "u") {
      const path = e.split(" ").slice(10).join(" ");
      paths.push(path);
      conflicts.push(path);
    } else if (e[0] === "?") {
      untracked.push(e.slice(2));
      paths.push(e.slice(2));
    }
  }
  // Keep content-change detection for every changed path, including large trees. Only one
  // small batch of stat results is retained; concurrency and scratch memory do not grow with
  // the repository. ctime also catches same-size edits whose mtime was restored by a tool.
  const digest = createHash("sha256").update(status);
  for (let start = 0; start < paths.length; start += 256) {
    const info = await mapLimit(
      paths.slice(start, start + 256),
      64,
      async (path) => {
        const s = await lstat(join(repo, path)).catch(() => null);
        return [path, s?.mtimeMs, s?.ctimeMs, s?.size];
      },
    );
    digest.update(JSON.stringify(info));
  }
  const hash = digest.digest("hex");
  return { hash, head, untracked, conflicts, changed: paths.length };
}
/** Concurrent callers (several tabs polling) share one `git status` instead of each running it. */
export function fingerprintInfo(repo: string): Promise<FingerprintInfo> {
  return cached(repo + ":fingerprint", () => fingerprintInfoUncached(repo), 0);
}
export async function fingerprint(repo: string) {
  return (await fingerprintInfo(repo)).hash;
}
const onCacheLookup = (hit: boolean) => {
  const trace = traceStore.getStore();
  if (trace) hit ? trace.cacheHits++ : trace.cacheMisses++;
};
const metadataCache = new BoundedCache(64, 4 * 1024 * 1024, onCacheLookup);
const payloadCache = new BoundedCache(32, 32 * 1024 * 1024, onCacheLookup);
export function cached<T>(key: string, fn: () => Promise<T>, ttl = 2000) {
  return metadataCache.get(key, fn, ttl);
}
/** Patch/page payloads cannot evict the repository scan or other small metadata. */
export function cachedPayload<T>(
  key: string,
  fn: () => Promise<T>,
  ttl = 2000,
) {
  return payloadCache.get(key, fn, ttl);
}
export function cachedSWR<T>(key: string, fn: () => Promise<T>, ttl: number) {
  return metadataCache.swr(key, fn, ttl);
}
export function splitPatch(patch: string) {
  return patch
    .split(/(?=^diff --git )/m)
    .filter((x) => x.startsWith("diff --git "));
}
export async function files(
  repo: string,
  m: Mode,
  resolved?: ResolvedComparison,
  conflicts?: string[],
) {
  const cmp = resolved ?? (await comparison(repo, m));
  let entries: FileEntry[] = [];
  if (cmp.fallback !== undefined) {
    entries = splitPatch(cmp.fallback).flatMap((chunk) =>
      parsePatchFiles(chunk, "fallback-list", true)
        .flatMap((patch) => patch.files)
        .map((file) => {
          const binary = /^Binary files |^GIT binary patch/m.test(chunk);
          const added = binary
            ? 0
            : file.hunks.reduce((n, h) => n + h.additionLines, 0);
          const deleted = binary
            ? 0
            : file.hunks.reduce((n, h) => n + h.deletionLines, 0);
          return {
            path: file.name,
            oldPath: file.prevName !== file.name ? file.prevName : undefined,
            status:
              file.type === "new"
                ? "A"
                : file.type === "deleted"
                  ? "D"
                  : file.type.startsWith("rename")
                    ? "R"
                    : "M",
            added,
            deleted,
            binary,
            collapsed: collapseHint(file.name) || added + deleted > 2000,
          };
        }),
    );
  } else {
    const base = ["diff", "--no-ext-diff", "--no-textconv", "-M", ...cmp.args];
    const [num, raw] = await Promise.all([
      git(repo, [...base, "--numstat", "-z", "--"]),
      git(repo, [...base, "--raw", "-z", "--"]),
    ]);
    const counts = parseNumstat(num);
    entries = parseRaw(raw).map((f) => ({
      ...f,
      ...counts.get(f.path),
      added: counts.get(f.path)?.added || 0,
      deleted: counts.get(f.path)?.deleted || 0,
      binary: counts.get(f.path)?.binary || false,
      collapsed:
        collapseHint(f.path) ||
        (counts.get(f.path)?.added || 0) + (counts.get(f.path)?.deleted || 0) >
          2000,
    }));
  }
  if (m.mode === "uncommitted" && m.filter !== "staged") {
    const paths = (
      await git(repo, ["ls-files", "-o", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter(Boolean);
    const read = await mapLimit(paths, 32, async (path) => {
      let added = 0,
        binary = false,
        large = false;
      try {
        const data = await readSafe(repo, path, 512 * 1024);
        large = data.large;
        binary = data.binary;
        added = data.text
          ? data.text.split("\n").length - (data.text.endsWith("\n") ? 1 : 0)
          : 0;
      } catch {
        large = true;
      }
      return {
        path,
        status: "?",
        added,
        deleted: 0,
        binary,
        collapsed: large || added > 2000 || collapseHint(path),
        untracked: true,
      };
    });
    entries.push(...read);
  }
  if (m.mode === "uncommitted") {
    const paths =
      conflicts ??
      (
        await git(repo, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--name-only",
          "--diff-filter=U",
          "-z",
        ])
      )
        .split("\0")
        .filter(Boolean);
    const unmerged = new Set(paths);
    entries = entries.filter((entry) => !unmerged.has(entry.path));
    entries.push(...[...unmerged].map(conflictEntry));
  }
  return normalizeEntries(entries).sort((a, b) => a.path.localeCompare(b.path));
}
/** Git can emit delete/add blocks for one type-changing pathname; IDs must remain unique. */
export function normalizeEntries<T extends FileEntry>(entries: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const entry of entries) {
    const old = byPath.get(entry.path);
    if (old || entry.status === "T" || entry.typeChanged) {
      const merged = {
        ...entry,
        status: "T",
        typeChanged: true,
        collapsed: true,
        added: entry.added + (old?.added ?? 0),
        deleted: entry.deleted + (old?.deleted ?? 0),
      };
      if ("patch" in merged) Object.assign(merged, { patch: "" });
      byPath.set(entry.path, merged);
    } else byPath.set(entry.path, entry);
  }
  return [...byPath.values()];
}
export function conflictEntry(path: string): FileEntry {
  return {
    path,
    status: "U",
    added: 0,
    deleted: 0,
    binary: false,
    collapsed: true,
    conflicted: true,
  };
}
export async function readSafe(repo: string, path: string, limit: number) {
  if (
    !path ||
    isAbsolute(path) ||
    !inside(repo, resolve(repo, path)) ||
    /[\x00]/.test(path)
  )
    throw new GitError("forbidden_path");
  const real = await realpath(join(repo, path));
  if (!inside(repo, real)) throw new GitError("forbidden_path");
  const s = await lstat(join(repo, path));
  if (!s.isFile() || s.isSymbolicLink()) throw new GitError("unsupported_file");
  const h = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await verifyOpenedFile(repo, real, s, h).catch(() => {
      throw new GitError("forbidden_path");
    });
    const size = stat.size;
    const b = Buffer.alloc(Math.min(size, limit));
    await h.read(b, 0, b.length, 0);
    const binary = b.includes(0);
    return {
      text: binary ? "" : b.toString("utf8"),
      binary,
      large: size > limit,
      size,
    };
  } finally {
    await h.close();
  }
}
export async function patch(
  repo: string,
  m: Mode,
  path: string,
  context = 3,
  anyway = false,
  known?: FileEntry,
  resolved?: ResolvedComparison,
) {
  const entry =
    known ??
    (
      await cached(repo + JSON.stringify(m) + ":file-list", () =>
        files(repo, m),
      )
    ).find((f) => f.path === path);
  if (!entry) throw new GitError("file_not_found");
  if (entry.conflicted) throw new GitError("unmerged_conflict");
  if (entry.typeChanged) throw new GitError("unsupported_type_change");
  if (entry.binary)
    return { patch: "", binary: true, truncated: false, collapsed: true };
  const cap = anyway ? 8 * 1024 * 1024 : 512 * 1024;
  let text = "";
  let totalLines: number | undefined;
  if (entry.untracked) {
    const data = await readSafe(repo, path, cap);
    if (data.large)
      return {
        patch: "",
        binary: data.binary,
        truncated: true,
        collapsed: true,
      };
    if (data.binary)
      return { patch: "", binary: true, truncated: false, collapsed: true };
    const lines = data.text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    totalLines = lines.length;
    text = syntheticPatch(path, data.text, lines.length);
  } else {
    const cmp = resolved ?? (await comparison(repo, m));
    if (cmp.fallback !== undefined)
      text =
        splitPatch(cmp.fallback).find((chunk) =>
          parsePatchFiles(chunk, "fallback", true).some((patch) =>
            patch.files.some(
              (file) => file.name === path || file.prevName === path,
            ),
          ),
        ) || "";
    else
      try {
        text = await git(
          repo,
          [
            "-c",
            "core.quotePath=false",
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--submodule=short",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "-M",
            "--unified=" + context,
            ...cmp.args,
            "--",
            ...(entry.oldPath ? [entry.oldPath] : []),
            path,
          ],
          cap,
        );
      } catch (e) {
        if (e instanceof GitError && e.code === "output_limit")
          return { patch: "", binary: false, truncated: true, collapsed: true };
        throw e;
      }
  }
  // The line count makes the final omitted-context bar exact without shipping blobs to the UI.
  if (totalLines === undefined) {
    const ids = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/m.exec(text);
    const id = ids ? (/^0+$/.test(ids[2]) ? ids[1] : ids[2]) : undefined;
    if (id && !/^0+$/.test(id))
      totalLines = await cached(
        repo + ":blob-lines:" + id + ":" + cap,
        async () => {
          try {
            const blob = await git(repo, ["cat-file", "blob", id], cap);
            return blob
              ? blob.split("\n").length - (blob.endsWith("\n") ? 1 : 0)
              : 0;
          } catch {
            return undefined;
          }
        },
        60000,
      );
  }
  return {
    totalLines,
    patch: text,
    binary: /^Binary files|^GIT binary patch/m.test(text),
    truncated: Buffer.byteLength(text) > cap,
    collapsed: entry.collapsed,
  };
}
export async function refs(repo: string, includePr = true) {
  const [branches, commits, tags] = await Promise.all([
    git(repo, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
      "refs/remotes/",
    ]),
    tryGit(repo, ["log", "-40", "--format=%H%x09%s"]),
    git(repo, ["tag", "--list"]),
  ]);
  let prs: unknown[] = [],
    prState = "ready";
  try {
    if (includePr)
      prs = JSON.parse(
        await command(repo, "gh", [
          "pr",
          "list",
          "--limit",
          "50",
          "--json",
          "number,title,headRefName,baseRefName,author",
        ]),
      );
  } catch (e) {
    const err = e as GitError;
    prState =
      err.code === "missing_tool"
        ? "missing"
        : /auth|login|token/i.test(err.message)
          ? "unauthenticated"
          : /remote/i.test(err.message)
            ? "no_remote"
            : "unavailable";
  }
  return {
    branches: branches.trim().split("\n").filter(Boolean),
    tags: tags.trim().split("\n").filter(Boolean),
    commits: commits
      .split("\n")
      .filter(Boolean)
      .map((s) => {
        const [sha, ...title] = s.split("\t");
        return { sha, title: title.join("\t") };
      }),
    prs,
    prState,
  };
}

/**
 * The repository a conversation "lives in", when that is unambiguous: its project directory is
 * itself a repository, or contains exactly one. Otherwise empty (the client then remembers the
 * first repository the conversation reviewed).
 */
export function homeRepo(
  repos: { path: string }[],
  projectDir: string,
): string {
  const dir = projectDir.replace(/\/+$/, "");
  const exact = repos.find((r) => r.path === dir);
  if (exact) return exact.path;
  const inside = repos.filter((r) => r.path.startsWith(dir + "/"));
  return inside.length === 1 ? inside[0].path : "";
}
