/**
 * What the guardian can pick as the thing to compare. "branch" used to be a separate mode; it is
 * now the same operation as comparing a ref, so old links and saved state are migrated here.
 */
export type UiMode = "uncommitted" | "ref" | "pr";
export interface RawMode {
  mode?: string;
  filter?: string;
  base?: string;
  ref?: string;
  target?: string;
  dots?: string;
  pr?: string;
}
export interface NormalizedMode {
  mode: UiMode;
  filter: "all" | "staged" | "unstaged";
  /** Empty means "the repository's default branch". */
  ref: string;
  /** What the base is compared with: the working tree (includes uncommitted work) or HEAD. */
  target: "worktree" | "head";
  /** `three` = from the merge base (only this branch's changes); `two` = both tips directly. */
  dots: "three" | "two";
  pr: string;
  base: string;
}
const pick = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
) => ((allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback);

export function normalizeMode(raw: RawMode): NormalizedMode {
  const filter = pick(
    raw.filter,
    ["all", "staged", "unstaged"] as const,
    "all",
  );
  const pr = raw.pr ?? "";
  const base = raw.base ?? "";
  if (raw.mode === "branch")
    // The old "branch" view: base...HEAD, committed work only.
    return {
      mode: "ref",
      filter,
      ref: base,
      target: "head",
      dots: "three",
      pr,
      base,
    };
  return {
    mode: pick(raw.mode, ["uncommitted", "ref", "pr"] as const, "uncommitted"),
    filter,
    ref: raw.ref ?? "",
    target: pick(raw.target, ["worktree", "head"] as const, "worktree"),
    dots: pick(raw.dots, ["three", "two"] as const, "three"),
    pr,
    base,
  };
}
