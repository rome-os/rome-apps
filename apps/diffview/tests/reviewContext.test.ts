import { describe, expect, it } from "vitest";
import { deriveReviewContext } from "../src/shared/reviewContext.js";

const prs = [
  {
    number: 18,
    title: "Refactor UI",
    baseRefName: "main",
    headRefName: "refactor/code-review-ui-library",
    updatedAt: "2026-10-27T08:00:00Z",
  },
  {
    number: 30,
    title: "Diffview",
    baseRefName: "main",
    headRefName: "feat/diffview",
    updatedAt: "2026-10-27T09:00:00Z",
  },
  {
    number: 31,
    title: "Newer Diffview",
    baseRefName: "main",
    headRefName: "feat/diffview",
    updatedAt: "2026-10-27T10:00:00Z",
  },
];

describe("linked review context", () => {
  for (const mode of ["uncommitted", "unpushed"] as const)
    it(`${mode} derives branch and newest open PR from the worktree`, () => {
      expect(
        deriveReviewContext({ mode, pr: "18" }, "feat/diffview", prs),
      ).toEqual({
        driver: "local",
        branch: "feat/diffview",
        pr: prs[2],
      });
    });

  it("ref mode treats the checked-out target branch as active, not its base", () => {
    expect(
      deriveReviewContext({ mode: "ref", pr: "18" }, "feat/diffview", prs),
    ).toEqual({
      driver: "branch",
      branch: "feat/diffview",
      pr: prs[2],
    });
  });

  it("keeps an exact merged/closed PR association outside the bounded open list", () => {
    const associated = {
      number: 30,
      title: "Merged Diffview work",
      baseRefName: "main",
      headRefName: "feat/merged-diffview",
      updatedAt: "2026-10-27T11:00:00Z",
    };
    expect(
      deriveReviewContext(
        { mode: "ref", pr: "18" },
        "feat/merged-diffview",
        prs,
        undefined,
        associated,
      ),
    ).toEqual({
      driver: "branch",
      branch: "feat/merged-diffview",
      pr: associated,
    });
  });

  it("PR mode makes the selected PR active and follows its head branch", () => {
    expect(
      deriveReviewContext({ mode: "pr", pr: "18" }, "feat/diffview", prs),
    ).toEqual({
      driver: "pr",
      branch: "refactor/code-review-ui-library",
      pr: prs[0],
    });
  });

  it("uses exact resolved PR metadata even when the open list is bounded", () => {
    const resolved = {
      number: 404,
      title: "Exact PR",
      baseRefName: "trunk",
      headRefName: "fork/exact",
    };
    expect(
      deriveReviewContext(
        { mode: "pr", pr: "404" },
        "feat/diffview",
        prs,
        resolved,
      ),
    ).toEqual({ driver: "pr", branch: "fork/exact", pr: resolved });
  });

  it("preserves a PR branch whose real name starts with origin/", () => {
    const resolved = {
      number: 405,
      baseRefName: "main",
      headRefName: "origin/real-branch-name",
    };
    expect(
      deriveReviewContext({ mode: "pr", pr: "405" }, "main", [], resolved),
    ).toEqual({
      driver: "pr",
      branch: "origin/real-branch-name",
      pr: resolved,
    });
  });

  it("keeps an explicit PR number while its branch metadata loads", () => {
    expect(deriveReviewContext({ mode: "pr", pr: "99" }, "main", [])).toEqual({
      driver: "pr",
      branch: undefined,
      pr: { number: 99 },
    });
  });

  it("does not invent branch or PR context for a detached commit", () => {
    expect(
      deriveReviewContext({ mode: "commit", pr: "18" }, "feat/diffview", prs),
    ).toEqual({ driver: "none" });
    expect(
      deriveReviewContext({ mode: "uncommitted", pr: "18" }, "HEAD", prs),
    ).toEqual({ driver: "local", branch: undefined, pr: undefined });
  });
});
