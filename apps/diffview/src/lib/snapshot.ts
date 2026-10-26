import { parsePatchFiles } from "@pierre/diffs";
import {
  GitError,
  collapseHint,
  conflictEntry,
  comparison,
  git,
  readSafe,
  splitPatch,
  type FileEntry,
  type FingerprintInfo,
  type Mode,
  type ResolvedComparison,
} from "./git.js";
import { isPageable, pageEnd } from "../shared/paging.js";

/** Largest text patch shipped for one file before the user asks for it explicitly. */
export const FILE_CAP = 512 * 1024;
export const FILE_CAP_ANYWAY = 8 * 1024 * 1024;
/** Largest single `git diff` we hold in memory; beyond it the caller falls back to per-file requests. */
/** A single page is bounded by its line budget; this only guards pathological (e.g. minified) lines. */
const PAGE_DIFF_CAP = 32 * 1024 * 1024;
/**
 * Whole-diff mode keeps every patch in memory and builds them with one `git diff`. Beyond these
 * limits that stops paying off (measured: 20,000 changed files = 45 MB, 2.7 s for the whole diff
 * versus about 130 ms per path-limited page), so such comparisons are paged from the start.
 */
const diffCap = () => Number(process.env.DIFFVIEW_DIFF_CAP) || 8 * 1024 * 1024;
export const maxWholeDiffFiles = () =>
  Number(process.env.DIFFVIEW_MAX_FILES) || 1500;
const ZERO = /^0+$/;

export interface SnapshotFile extends FileEntry {
  /** Unified patch text for this file at the snapshot's context size (empty for binary). */
  patch: string;
  /**
   * An untracked file whose patch is not held in memory (it is collapsed, or the snapshot's budget
   * for untracked content is spent). It is read from disk when someone actually asks for it.
   */
  lazy?: boolean;
  /** Lines in the new version of the file, so the last "unmodified lines" bar is exact. */
  totalLines?: number;
}
export interface Snapshot {
  context: number;
  files: SnapshotFile[];
}
export interface PatchData {
  patch: string;
  binary: boolean;
  truncated: boolean;
  collapsed: boolean;
  totalLines?: number;
}

const countLines = (text: string) =>
  text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
const STATUS: Record<string, string> = {
  new: "A",
  deleted: "D",
  "rename-pure": "R",
  "rename-changed": "R",
};

/**
 * Turns the output of ONE `git diff` into per-file entries. Parsing is delegated to
 * `@pierre/diffs` (the same parser the viewer renders with), one block at a time so the raw text
 * of each file stays attached to its metadata.
 */
export function parseDiffText(text: string): {
  entries: Omit<SnapshotFile, "totalLines">[];
  newIds: Map<string, string>;
} {
  const entries: Omit<SnapshotFile, "totalLines">[] = [];
  const newIds = new Map<string, string>();
  for (const chunk of splitPatch(text)) {
    const binary = /^Binary files |^GIT binary patch/m.test(chunk);
    const file = parsePatchFiles(chunk, "snapshot", true).flatMap(
      (p) => p.files,
    )[0];
    if (!file) continue;
    const added = file.hunks.reduce((n, h) => n + h.additionLines, 0);
    const deleted = file.hunks.reduce((n, h) => n + h.deletionLines, 0);
    const path = file.name;
    const oldPath =
      file.prevName && file.prevName !== file.name ? file.prevName : undefined;
    entries.push({
      path,
      oldPath,
      status: STATUS[file.type] ?? "M",
      added: binary ? 0 : added,
      deleted: binary ? 0 : deleted,
      binary,
      collapsed: collapseHint(path) || added + deleted > 2000,
      patch: binary ? "" : chunk,
    });
    if (file.newObjectId && !ZERO.test(file.newObjectId))
      newIds.set(path, file.newObjectId);
  }
  return { entries, newIds };
}

/**
 * Counts lines of many blobs with a single `git cat-file --batch`. Replies come back in request
 * order and carry the full object id, so they are matched by position, not by (abbreviated) id.
 */
async function blobLines(repo: string, ids: string[]) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  let raw: Buffer;
  try {
    raw = Buffer.from(
      await git(
        repo,
        ["cat-file", "--batch"],
        32 * 1024 * 1024,
        20000,
        ids.join("\n") + "\n",
        "latin1", // bytes, not text: the sizes in the replies are byte counts
      ),
      "latin1",
    );
  } catch {
    return out; // unknown counts only make the final bar less precise
  }
  let at = 0;
  for (const id of ids) {
    const eol = raw.indexOf(10, at);
    if (eol < 0) break;
    const [, type, size] = raw.toString("latin1", at, eol).split(" ");
    if (type !== "blob" || !size) {
      at = eol + 1; // "<id> missing" / "<id> ambiguous": a single line, no body
      continue;
    }
    const start = eol + 1,
      end = start + Number(size);
    if (Number(size) <= FILE_CAP) {
      let lines = 0;
      for (let i = start; i < end; i++) if (raw[i] === 10) lines++;
      if (end > start && raw[end - 1] !== 10) lines++;
      out.set(id, lines);
    }
    at = end + 1;
  }
  return out;
}

/** The patch git would print for a new file, built from its text. */
function syntheticPatch(path: string, text: string, lines: number) {
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return lines
    ? `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n` +
        parts.map((l) => "+" + l + "\n").join("") +
        (text && !text.endsWith("\n") ? "\\ No newline at end of file\n" : "")
    : "";
}
/**
 * Memory the snapshot may spend on the text of untracked files. An untracked directory can hold
 * thousands of files; keeping every one's patch is what made a view grow with the size of the tree
 * (measured: about one byte of heap per byte on disk, 600 MB for 1,500 files of 400 KB). Beyond
 * the budget a file is read again from disk when asked for.
 */
const untrackedBudget = () =>
  Number(process.env.DIFFVIEW_UNTRACKED_BUDGET) || 16 * 1024 * 1024;

async function untrackedFile(
  repo: string,
  path: string,
  /** Bytes of patch text still allowed to be kept; a file that does not fit is left lazy. */
  room: number,
): Promise<SnapshotFile> {
  let data: Awaited<ReturnType<typeof readSafe>> | undefined;
  try {
    data = await readSafe(repo, path, FILE_CAP);
  } catch {
    /* unreadable: shown as a collapsed placeholder */
  }
  if (!data || data.large || data.binary)
    return {
      path,
      status: "?",
      added: 0,
      deleted: 0,
      binary: !!data?.binary,
      collapsed: !data || data.large,
      untracked: true,
      lazy: !!data?.large, // too big to show by default; "load full file" reads it then
      patch: "",
    };
  const lines = countLines(data.text);
  const collapsed = lines > 2000 || collapseHint(path);
  // Collapsed files are never part of a page: nothing needs their text until someone opens one.
  const keep = !collapsed && data.text.length * 1.3 <= room;
  return {
    path,
    status: "?",
    added: lines,
    deleted: 0,
    binary: false,
    collapsed,
    untracked: true,
    lazy: !keep,
    patch: keep ? syntheticPatch(path, data.text, lines) : "",
    totalLines: lines,
  };
}
/** Reads an untracked file's patch from disk, for files the snapshot did not keep. */
export async function loadUntrackedPatch(
  repo: string,
  path: string,
  anyway: boolean,
): Promise<PatchData> {
  const cap = anyway ? FILE_CAP_ANYWAY : FILE_CAP;
  try {
    const data = await readSafe(repo, path, cap);
    if (data.large)
      return { patch: "", binary: false, truncated: true, collapsed: true };
    if (data.binary)
      return { patch: "", binary: true, truncated: false, collapsed: true };
    const lines = countLines(data.text);
    return {
      patch: syntheticPatch(path, data.text, lines),
      binary: false,
      truncated: false,
      collapsed: lines > 2000 || collapseHint(path),
      totalLines: lines,
    };
  } catch {
    return { patch: "", binary: false, truncated: true, collapsed: true };
  }
}

/** True when the "after" side of the comparison is the working tree rather than a commit or the index. */
export function worktreeSide(m: Mode) {
  return (
    (m.mode === "uncommitted" && m.filter !== "staged") ||
    (m.mode === "ref" && m.target === "worktree")
  );
}

const DIFF_BIN = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--submodule=short",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
];
/** Parses diff text and adds line totals (disk or one batch) and the untracked files. */
async function assemble(
  repo: string,
  m: Mode,
  text: string,
  untrackedPaths: string[],
): Promise<SnapshotFile[]> {
  const { entries, newIds } = parseDiffText(text);
  const files: SnapshotFile[] = entries.map((e) => ({ ...e }));
  const onDisk = worktreeSide(m);
  const wanted: string[] = [];
  await Promise.all(
    files.map(async (f) => {
      if (f.binary) return;
      if (f.status === "D") {
        f.totalLines = 0;
        return;
      }
      if (onDisk) {
        try {
          const data = await readSafe(repo, f.path, FILE_CAP);
          if (!data.large && !data.binary) f.totalLines = countLines(data.text);
        } catch {
          /* path vanished while reading */
        }
      } else if (newIds.has(f.path)) wanted.push(newIds.get(f.path)!);
    }),
  );
  if (wanted.length) {
    const lines = await blobLines(repo, [...new Set(wanted)]);
    for (const f of files) {
      const id = newIds.get(f.path);
      if (id && f.totalLines === undefined && lines.has(id))
        f.totalLines = lines.get(id);
    }
  }
  let room = untrackedBudget();
  for (const path of untrackedPaths) {
    const file = await untrackedFile(repo, path, room);
    room -= file.patch.length;
    files.push(file);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/**
 * Everything the viewer needs for a comparison in a handful of git processes — one `git diff` for
 * all patches, one `cat-file --batch` for line counts — instead of several per file.
 * Throws `output_limit` when the whole diff is too large; callers then page it instead.
 */
export async function buildSnapshot(
  repo: string,
  m: Mode,
  context: number,
  info: FingerprintInfo,
  resolved?: ResolvedComparison,
): Promise<Snapshot> {
  const cmp = resolved ?? (await comparison(repo, m, info.head));
  const text =
    cmp.fallback ??
    (await git(
      repo,
      [...DIFF_BIN, "--unified=" + context, ...cmp.args, "--"],
      diffCap(),
      30000,
    ));
  const untracked =
    m.mode === "uncommitted" && m.filter !== "staged" ? info.untracked : [];
  let files = await assemble(repo, m, text, untracked);
  if (m.mode === "uncommitted" && info.conflicts?.length) {
    const paths = new Set(info.conflicts);
    files = files.filter((file) => !paths.has(file.path));
    files.push(
      ...[...paths].map((path) => ({ ...conflictEntry(path), patch: "" })),
    );
    files.sort((a, b) => a.path.localeCompare(b.path));
  }
  return { context, files };
}

/**
 * One page of a diff too large to hold at once: a single `git diff` restricted to the page's
 * paths. Still one request and a few processes per page, never one per file.
 */
export async function buildPage(
  repo: string,
  m: Mode,
  context: number,
  info: FingerprintInfo,
  subset: FileEntry[],
  resolved?: ResolvedComparison,
): Promise<SnapshotFile[]> {
  const tracked = subset.filter((f) => !f.untracked);
  const cmp = resolved ?? (await comparison(repo, m, info.head));
  let text = "";
  if (tracked.length) {
    if (cmp.fallback !== undefined) {
      const wanted = new Set(tracked.map((f) => f.path));
      text = splitPatch(cmp.fallback)
        .filter((c) => {
          const f = parsePatchFiles(c, "page", true).flatMap((p) => p.files)[0];
          return f && wanted.has(f.name);
        })
        .join("");
    } else
      text = await git(
        repo,
        [
          "--literal-pathspecs",
          ...DIFF_BIN,
          "--unified=" + context,
          ...cmp.args,
          "--",
          ...tracked.flatMap((f) =>
            f.oldPath ? [f.oldPath, f.path] : [f.path],
          ),
        ],
        PAGE_DIFF_CAP,
        30000,
      );
  }
  return assemble(
    repo,
    m,
    text,
    subset.filter((f) => f.untracked).map((f) => f.path),
  );
}

export interface PageData {
  patches: Record<string, PatchData>;
  /** Cursor of the next page, or null when this was the last one. */
  next: number | null;
}
/**
 * The patches of one page, cropped to the per-file caps. Untracked files the snapshot did not keep
 * come back in `lazy` for the caller to read from disk (that needs the repository path).
 */
export function pageOf(
  eligible: SnapshotFile[],
  cursor: number,
): { end: number; patches: Record<string, PatchData>; lazy: SnapshotFile[] } {
  // A file that is not held in memory still counts toward the page's size, by an estimate.
  const end = pageEnd(eligible, cursor, (i) =>
    eligible[i].lazy
      ? eligible[i].added * 80
      : Buffer.byteLength(eligible[i].patch),
  );
  const patches: Record<string, PatchData> = {};
  const lazy: SnapshotFile[] = [];
  for (const f of eligible.slice(cursor, end))
    if (f.lazy) lazy.push(f);
    else patches[f.path] = patchData(f, false);
  return { end, patches, lazy };
}
export { isPageable };

export function toEntry({
  patch: _patch,
  totalLines: _lines,
  lazy: _lazy,
  ...entry
}: SnapshotFile): FileEntry {
  return entry;
}

/** Patch payload for one file, applying the same size caps as the per-file endpoint. */
export function patchData(file: SnapshotFile, anyway: boolean): PatchData {
  if (file.binary)
    return { patch: "", binary: true, truncated: false, collapsed: true };
  const cap = anyway ? FILE_CAP_ANYWAY : FILE_CAP;
  const size = Buffer.byteLength(file.patch);
  if (file.untracked && !file.patch && file.collapsed)
    return { patch: "", binary: false, truncated: true, collapsed: true };
  if (size > cap)
    return { patch: "", binary: false, truncated: true, collapsed: true };
  return {
    patch: file.patch,
    binary: false,
    truncated: false,
    collapsed: file.collapsed,
    totalLines: file.totalLines,
  };
}

export { GitError };
