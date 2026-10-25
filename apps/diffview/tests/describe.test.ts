import { test } from "vitest";
import assert from "node:assert/strict";
import { normalizeMode } from "../src/shared/mode";
import {
  describeComparison,
  describeEmpty,
  type DescribeLabels,
} from "../src/shared/describe";

const L: DescribeLabels = {
  triggerUncommitted: "未提交",
  staged: "已暂存",
  unstaged: "未暂存",
  head: "HEAD",
  worktree: "工作区",
  index: "暂存区",
  hintLocalAll: "all",
  hintLocalStaged: "staged",
  hintLocalUnstaged: "unstaged",
  hintThreeWorktree: "3dot+wt",
  hintThreeHead: "3dot+head",
  hintTwoWorktree: "2dot+wt",
  hintTwoHead: "2dot+head",
  hintPr: "pr",
};
const d = (m: Parameters<typeof normalizeMode>[0], ctx = {}) =>
  describeComparison(
    normalizeMode(m),
    { defaultBase: "origin/main", ...ctx },
    L,
  );
const arrow = (x: ReturnType<typeof d>) => `${x.from} → ${x.to}`;

test("local changes read as one word in the trigger; the arrow stays in the tooltip", () => {
  const all = d({ mode: "uncommitted" });
  const staged = d({ mode: "uncommitted", filter: "staged" });
  const unstaged = d({ mode: "uncommitted", filter: "unstaged" });
  assert.deepEqual(
    [all.label, staged.label, unstaged.label],
    ["未提交", "已暂存", "未暂存"],
  );
  assert.match(all.tooltip, /HEAD → 工作区/);
  assert.match(staged.tooltip, /HEAD → 暂存区/);
  assert.match(unstaged.tooltip, /暂存区 → 工作区/);
  // Comparisons between refs keep the arrow and have no single-word label.
  assert.equal(d({ mode: "ref" }).label, undefined);
  assert.equal(d({ mode: "pr", pr: "1" }).label, undefined);
});
test("local changes: every 'include' choice names both ends", () => {
  assert.equal(arrow(d({ mode: "uncommitted" })), "HEAD → 工作区");
  assert.equal(
    arrow(d({ mode: "uncommitted", filter: "staged" })),
    "HEAD → 暂存区",
  );
  assert.equal(
    arrow(d({ mode: "uncommitted", filter: "unstaged" })),
    "暂存区 → 工作区",
  );
});
test("comparing a base: defaults are the default branch, the working tree and the merge base", () => {
  const x = d({ mode: "ref" });
  assert.equal(arrow(x), "origin/main → 工作区");
  assert.equal(x.twoDot, false);
  assert.match(x.tooltip, /3dot\+wt/);
});
test("comparing a base: all four target × method combinations are distinguishable", () => {
  const all = [
    d({ mode: "ref", ref: "v1", target: "head", dots: "three" }),
    d({ mode: "ref", ref: "v1", target: "head", dots: "two" }),
    d({ mode: "ref", ref: "v1", target: "worktree", dots: "three" }),
    d({ mode: "ref", ref: "v1", target: "worktree", dots: "two" }),
  ];
  assert.deepEqual(all.map(arrow), [
    "v1 → HEAD",
    "v1 → HEAD",
    "v1 → 工作区",
    "v1 → 工作区",
  ]);
  // The method no longer hides: a non-default one is flagged, and every hint differs.
  assert.deepEqual(
    all.map((x) => !!x.twoDot),
    [false, true, false, true],
  );
  assert.equal(new Set(all.map((x) => x.tooltip)).size, 4);
});
test("an empty base falls back to the default branch, never silently to HEAD", () => {
  assert.equal(d({ mode: "ref", ref: "" }).from, "origin/main");
  assert.equal(d({ mode: "ref", ref: "" }, { defaultBase: "" }).from, "HEAD");
});
test("pull request: a badge plus base → head, or a placeholder while none is chosen", () => {
  const none = d({ mode: "pr", pr: "" });
  assert.equal(none.placeholder, true);
  assert.equal(none.from, "");
  const typed = d({ mode: "pr", pr: "123" });
  assert.equal(typed.badge, "#123");
  // Once chosen, the number alone identifies it in the trigger.
  assert.equal(typed.badgeOnly, true);
  assert.equal(none.badgeOnly, undefined);
  assert.equal(arrow(typed), "origin/main → …");
  const known = d(
    { mode: "pr", pr: "123" },
    {
      pr: {
        number: 123,
        title: "Fix it",
        baseRefName: "main",
        headRefName: "fix/it",
      },
    },
  );
  assert.equal(arrow(known), "main → fix/it");
  assert.match(known.tooltip, /#123 Fix it/);
  // A different PR's details must not leak onto this one.
  const other = d(
    { mode: "pr", pr: "9" },
    { pr: { number: 123, baseRefName: "x", headRefName: "y" } },
  );
  assert.equal(arrow(other), "origin/main → …");
});

test("old links and saved state keep their meaning: 'branch' becomes a committed-only base comparison", () => {
  const n = normalizeMode({
    mode: "branch",
    base: "release",
    target: "head",
    dots: "three",
  });
  assert.deepEqual(
    [n.mode, n.ref, n.target, n.dots],
    ["ref", "release", "head", "three"],
  );
  assert.equal(normalizeMode({ mode: "branch" }).target, "head");
});
test("unknown values fall back to safe defaults", () => {
  const n = normalizeMode({
    mode: "weird",
    filter: "x",
    target: "y",
    dots: "z",
  });
  assert.deepEqual(
    [n.mode, n.filter, n.target, n.dots, n.ref],
    ["uncommitted", "all", "worktree", "three", ""],
  );
});

const e = (
  m: Parameters<typeof normalizeMode>[0],
  ctx: Partial<Parameters<typeof describeEmpty>[1]> = {},
) =>
  describeEmpty(normalizeMode(m), {
    hideViewed: false,
    same: false,
    openPrs: 0,
    ...ctx,
  });
test("empty states say why and offer the one useful next step", () => {
  assert.deepEqual(e({ mode: "uncommitted" }), {
    kind: "local-clean",
    action: null,
  });
  assert.deepEqual(e({ mode: "uncommitted", filter: "staged" }), {
    kind: "local-staged",
    action: "filter-all",
  });
  assert.deepEqual(e({ mode: "uncommitted", filter: "unstaged" }), {
    kind: "local-unstaged",
    action: "filter-all",
  });
  // On the base branch itself: nothing committed to compare, but the working tree is a way out.
  assert.deepEqual(e({ mode: "ref", target: "head" }, { same: true }), {
    kind: "same-as-base",
    action: "target-worktree",
  });
  assert.deepEqual(e({ mode: "ref", target: "worktree" }, { same: true }), {
    kind: "same-as-worktree",
    action: null,
  });
  assert.deepEqual(e({ mode: "ref" }, { same: false }), {
    kind: "no-difference",
    action: null,
  });
  assert.deepEqual(e({ mode: "pr" }, { openPrs: 3 }), {
    kind: "pick-pr",
    action: "open-menu",
  });
  assert.deepEqual(e({ mode: "pr" }, { openPrs: 0 }), {
    kind: "no-open-pr",
    action: "open-menu",
  });
  assert.deepEqual(e({ mode: "pr" }, { prState: "missing" }), {
    kind: "pr-unavailable",
    action: null,
  });
  assert.deepEqual(e({ mode: "pr", pr: "5" }, { prKnown: true }), {
    kind: "no-difference",
    action: null,
  });
  // A number that matches no pull request is "not found", not "no differences".
  assert.deepEqual(e({ mode: "pr", pr: "5" }, { prKnown: false }), {
    kind: "pr-not-found",
    action: "open-menu",
  });
  assert.deepEqual(e({ mode: "ref" }, { hideViewed: true }), {
    kind: "all-viewed",
    action: null,
  });
});
