import type { NormalizedMode } from "./mode.js";

/** Words the description is built from; the web layer supplies them in the guardian's language. */
export interface DescribeLabels {
  /** One-word trigger labels for local changes. */
  triggerUncommitted: string;
  staged: string;
  unstaged: string;
  head: string;
  worktree: string;
  index: string;
  hintLocalAll: string;
  hintLocalStaged: string;
  hintLocalUnstaged: string;
  hintThreeWorktree: string;
  hintThreeHead: string;
  hintTwoWorktree: string;
  hintTwoHead: string;
  hintPr: string;
}
export interface PrInfo {
  number: number;
  title?: string;
  baseRefName?: string;
  headRefName?: string;
}
export interface Description {
  /** A single word that replaces the arrow (local changes); the arrow stays in the tooltip. */
  label?: string;
  /** Left end of the arrow; empty while nothing is chosen yet. */
  from: string;
  /** Right end of the arrow. */
  to: string;
  /** Short badge before the arrow, e.g. "#123" for a pull request. */
  badge?: string;
  /** The badge says it all (a chosen pull request): show it without the arrow. */
  badgeOnly?: boolean;
  /** Only set when the method differs from the default (merge base), so it is worth showing. */
  twoDot?: boolean;
  /** True when the comparison cannot run yet because the guardian still has to pick something. */
  placeholder?: boolean;
  tooltip: string;
}

export function describeComparison(
  m: Pick<NormalizedMode, "mode" | "filter" | "ref" | "target" | "dots" | "pr">,
  ctx: { defaultBase: string; pr?: PrInfo },
  l: DescribeLabels,
): Description {
  if (m.mode === "uncommitted") {
    const [from, to, hint, label] =
      m.filter === "staged"
        ? [l.head, l.index, l.hintLocalStaged, l.staged]
        : m.filter === "unstaged"
          ? [l.index, l.worktree, l.hintLocalUnstaged, l.unstaged]
          : [l.head, l.worktree, l.hintLocalAll, l.triggerUncommitted];
    return { from, to, label, tooltip: `${label} · ${from} → ${to} · ${hint}` };
  }
  if (m.mode === "pr") {
    if (!m.pr)
      return { from: "", to: "", placeholder: true, tooltip: l.hintPr };
    const info = ctx.pr?.number === Number(m.pr) ? ctx.pr : undefined;
    const from = info?.baseRefName || ctx.defaultBase || "…";
    const to = info?.headRefName || "…";
    return {
      from,
      to,
      badge: "#" + m.pr,
      badgeOnly: true,
      tooltip: `#${m.pr}${info?.title ? " " + info.title : ""} · ${from} → ${to} · ${l.hintPr}`,
    };
  }
  const from = m.ref || ctx.defaultBase || l.head;
  const to = m.target === "worktree" ? l.worktree : l.head;
  const hint =
    m.dots === "two"
      ? m.target === "worktree"
        ? l.hintTwoWorktree
        : l.hintTwoHead
      : m.target === "worktree"
        ? l.hintThreeWorktree
        : l.hintThreeHead;
  return {
    from,
    to,
    twoDot: m.dots === "two",
    tooltip: `${from} → ${to} · ${hint}`,
  };
}

export type EmptyKind =
  | "all-viewed"
  | "local-clean"
  | "local-staged"
  | "local-unstaged"
  | "same-as-base"
  | "same-as-worktree"
  | "no-difference"
  | "pick-pr"
  | "no-open-pr"
  | "pr-unavailable"
  | "pr-not-found";
export type EmptyAction = "target-worktree" | "filter-all" | "open-menu" | null;

/**
 * Why a comparison shows nothing, and the one thing the guardian can do about it. `same` says the
 * base resolves to the very commit HEAD is on (nothing to compare, not a failed lookup).
 */
export function describeEmpty(
  m: Pick<NormalizedMode, "mode" | "filter" | "target" | "pr">,
  ctx: {
    hideViewed: boolean;
    same: boolean;
    prState?: string;
    openPrs: number;
    /** The chosen PR number resolved to a real pull request. */
    prKnown?: boolean;
  },
): { kind: EmptyKind; action: EmptyAction } {
  if (ctx.hideViewed) return { kind: "all-viewed", action: null };
  if (m.mode === "uncommitted")
    return m.filter === "staged"
      ? { kind: "local-staged", action: "filter-all" }
      : m.filter === "unstaged"
        ? { kind: "local-unstaged", action: "filter-all" }
        : { kind: "local-clean", action: null };
  if (m.mode === "pr") {
    if (!m.pr)
      return ctx.prState && ctx.prState !== "ready"
        ? { kind: "pr-unavailable", action: null }
        : ctx.openPrs
          ? { kind: "pick-pr", action: "open-menu" }
          : { kind: "no-open-pr", action: "open-menu" };
    // A number that matches nothing is not an empty diff: say so instead of comparing "…" with "…".
    return ctx.prKnown
      ? { kind: "no-difference", action: null }
      : { kind: "pr-not-found", action: "open-menu" };
  }
  if (ctx.same)
    return m.target === "head"
      ? { kind: "same-as-base", action: "target-worktree" }
      : { kind: "same-as-worktree", action: null };
  return { kind: "no-difference", action: null };
}
