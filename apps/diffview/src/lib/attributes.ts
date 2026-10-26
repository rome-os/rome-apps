import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  git,
  type FileCategory,
  type FileEntry,
  type Mode,
  type ResolvedComparison,
  type SupportingCategory,
} from "./git.js";

const ATTRIBUTE_NAMES = [
  "diffview-category",
  "linguist-generated",
  "linguist-vendored",
  "linguist-documentation",
] as const;
const SUPPORTING_CATEGORIES: SupportingCategory[] = [
  "generated",
  "lockfile",
  "test",
  "fixture",
  "snapshot",
  "vendored",
  "documentation",
];
const EXPLICIT = new Set<SupportingCategory>(
  SUPPORTING_CATEGORIES.filter((category) => category !== "documentation"),
);
const ATTRIBUTE_BATCH = 4096;
const ATTRIBUTE_INPUT_BYTES = 512 * 1024;

export interface ChangeCount {
  files: number;
  added: number;
  deleted: number;
}
export interface ChangeTotals {
  all: ChangeCount;
  primary: ChangeCount;
  supporting: ChangeCount;
  categories: Record<SupportingCategory, ChangeCount>;
}

type AttributeValues = Partial<
  Record<(typeof ATTRIBUTE_NAMES)[number], string>
>;
type AttributeSource =
  | { kind: "worktree" }
  | { kind: "index" }
  | { kind: "revision"; revision: string }
  | { kind: "unavailable" };

/** The right side of the comparison determines which .gitattributes tree is authoritative. */
export function attributeSource(
  mode: Mode,
  resolved: ResolvedComparison,
): AttributeSource {
  if (mode.mode === "uncommitted")
    return mode.filter === "staged" ? { kind: "index" } : { kind: "worktree" };
  if (mode.mode === "ref" && mode.target === "worktree")
    return { kind: "worktree" };
  return resolved.to
    ? { kind: "revision", revision: resolved.to }
    : { kind: "unavailable" };
}

function enabled(value?: string) {
  return (
    !!value &&
    !["unspecified", "unset", "false", "0"].includes(value.toLowerCase())
  );
}

export function categoryFromAttributes(values: AttributeValues): FileCategory {
  const explicit = values["diffview-category"] as
    SupportingCategory | undefined;
  if (explicit && EXPLICIT.has(explicit)) return explicit;
  if (enabled(values["linguist-generated"])) return "generated";
  if (enabled(values["linguist-vendored"])) return "vendored";
  if (enabled(values["linguist-documentation"])) return "documentation";
  return "primary";
}

export function parseAttributeOutput(output: string) {
  const fields = output.split("\0");
  const values = new Map<string, AttributeValues>();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const path = fields[i];
    const attribute = fields[i + 1] as (typeof ATTRIBUTE_NAMES)[number];
    if (!path || !ATTRIBUTE_NAMES.includes(attribute)) continue;
    const row = values.get(path) ?? {};
    row[attribute] = fields[i + 2];
    values.set(path, row);
  }
  return values;
}

async function checkBatch(
  repo: string,
  paths: string[],
  cached: boolean,
  extraEnv?: NodeJS.ProcessEnv,
) {
  const input = paths.join("\0") + "\0";
  const cap = Math.min(
    32 * 1024 * 1024,
    Math.max(1024 * 1024, input.length * (ATTRIBUTE_NAMES.length * 3 + 2)),
  );
  const output = await git(
    repo,
    [
      "-c",
      "core.attributesFile=/dev/null",
      "check-attr",
      ...(cached ? ["--cached"] : []),
      "--stdin",
      "-z",
      ...ATTRIBUTE_NAMES,
    ],
    cap,
    20000,
    input,
    "utf8",
    extraEnv,
  );
  return parseAttributeOutput(output);
}

async function attributesForPaths(
  repo: string,
  paths: string[],
  source: AttributeSource,
) {
  const result = new Map<string, AttributeValues>();
  if (!paths.length || source.kind === "unavailable") return result;
  let dir: string | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  try {
    if (source.kind === "revision") {
      dir = await mkdtemp(join(tmpdir(), "diffview-attributes-"));
      env = { GIT_INDEX_FILE: join(dir, "index") };
      await git(
        repo,
        ["read-tree", "--reset", source.revision],
        undefined,
        20000,
        undefined,
        "utf8",
        env,
      );
    }
    for (let start = 0; start < paths.length;) {
      let end = start,
        bytes = 0;
      while (end < paths.length && end - start < ATTRIBUTE_BATCH) {
        const next = Buffer.byteLength(paths[end]) + 1;
        if (end > start && bytes + next > ATTRIBUTE_INPUT_BYTES) break;
        bytes += next;
        end++;
      }
      const batch = await checkBatch(
        repo,
        paths.slice(start, end),
        source.kind !== "worktree",
        env,
      );
      for (const [path, row] of batch) result.set(path, row);
      start = end;
    }
  } catch {
    // Attribute metadata is advisory. An unavailable historical tree must never make the diff fail
    // or accidentally fall back to unrelated working-tree attributes; those files stay primary.
    result.clear();
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}

/** Resolve all changed paths in bounded batches; never spawn a process for an individual file. */
export async function classifyFiles<T extends FileEntry>(
  repo: string,
  mode: Mode,
  resolved: ResolvedComparison,
  files: T[],
): Promise<T[]> {
  const values = await attributesForPaths(
    repo,
    files.map((file) => file.path),
    attributeSource(mode, resolved),
  );
  return files.map((file) => ({
    ...file,
    category: categoryFromAttributes(values.get(file.path) ?? {}),
  }));
}

const empty = (): ChangeCount => ({ files: 0, added: 0, deleted: 0 });
const add = (count: ChangeCount, file: FileEntry) => {
  count.files++;
  count.added += file.added;
  count.deleted += file.deleted;
};

export function summarizeFiles(files: FileEntry[]): ChangeTotals {
  const totals: ChangeTotals = {
    all: empty(),
    primary: empty(),
    supporting: empty(),
    categories: Object.fromEntries(
      SUPPORTING_CATEGORIES.map((category) => [category, empty()]),
    ) as Record<SupportingCategory, ChangeCount>,
  };
  for (const file of files) {
    add(totals.all, file);
    const category = file.category ?? "primary";
    if (category === "primary") add(totals.primary, file);
    else {
      add(totals.supporting, file);
      add(totals.categories[category], file);
    }
  }
  return totals;
}
