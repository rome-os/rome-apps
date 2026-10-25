import type { Mode } from "../lib/git.js";
/** Only inputs that change the actual comparison belong in persistence keys. */
export function comparisonIdentity(m: Mode) {
  switch (m.mode) {
    case "uncommitted":
      return { mode: m.mode, filter: m.filter || "all" };
    case "unpushed":
      return { mode: m.mode };
    case "commit":
      return { mode: m.mode, commit: m.commit || "" };
    case "branch":
      return { mode: m.mode, base: m.base || "" };
    case "pr":
      return { mode: m.mode, pr: m.pr || "" };
    case "ref":
      return {
        mode: m.mode,
        ref: m.ref || "",
        dots: m.dots || "three",
        target: m.target || "worktree",
      };
  }
}
