import type { NormalizedMode } from "./mode.js";

export interface PullRequestInfo {
  number: number;
  title?: string;
  baseRefName?: string;
  headRefName?: string;
  updatedAt?: string;
}

export interface ReviewContext {
  /** The branch whose work is being reviewed, never the comparison's base ref. */
  branch?: string;
  /** Explicit in PR mode; otherwise the open PR associated with `branch`. */
  pr?: PullRequestInfo;
  driver: "local" | "branch" | "pr" | "none";
}

export function branchDisplayName(value?: string) {
  if (!value) return undefined;
  let branch = value
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/[^/]+\//, "");
  if (!branch || branch === "HEAD") return undefined;
  return branch;
}

function newestMatchingPr(prs: PullRequestInfo[], branch: string) {
  return prs
    .filter((pr) => branchDisplayName(pr.headRefName) === branch)
    .map((pr, index) => ({ pr, index, time: Date.parse(pr.updatedAt || "") }))
    .sort((a, b) => {
      const byTime =
        (Number.isFinite(b.time) ? b.time : -1) -
        (Number.isFinite(a.time) ? a.time : -1);
      return byTime || a.index - b.index;
    })[0]?.pr;
}

/**
 * Derive both linked labels from one active comparison source. This deliberately does not mutate
 * mode state: the inactive label follows passively, so branch/PR data can never chase each other in
 * a pair of effects or leak a stale `pr` URL parameter into another mode.
 */
export function deriveReviewContext(
  mode: Pick<NormalizedMode, "mode" | "pr">,
  checkedOutBranch: string | undefined,
  openPrs: PullRequestInfo[],
  resolvedPr?: PullRequestInfo,
  associatedBranchPr?: PullRequestInfo,
): ReviewContext {
  if (mode.mode === "commit") return { driver: "none" };

  if (mode.mode === "pr") {
    const number = Number(mode.pr);
    const pr =
      (resolvedPr?.number === number ? resolvedPr : undefined) ??
      openPrs.find((candidate) => candidate.number === number) ??
      (Number.isInteger(number) && number > 0 ? { number } : undefined);
    return {
      driver: "pr",
      branch: branchDisplayName(pr?.headRefName),
      pr,
    };
  }

  const branch = branchDisplayName(checkedOutBranch);
  const driver = mode.mode === "ref" ? "branch" : "local";
  return {
    driver,
    branch,
    pr: branch
      ? branchDisplayName(associatedBranchPr?.headRefName) === branch
        ? associatedBranchPr
        : newestMatchingPr(openPrs, branch)
      : undefined,
  };
}
