import { test, expect } from "vitest";
import type { ReviewCard } from "../src/lib/agentView";
import {
  cardComparison,
  cardStatuses,
  cardTime,
  compactCount,
} from "../src/shared/cardPresentation";
const counts = { files: 0, added: 0, deleted: 0, binary: 0 };
const card = {
  kind: "workspace",
  branch: "feat/example",
  state: { filter: "all" },
  staged: counts,
  unstaged: { ...counts, files: 15 },
  untracked: 20,
  conflicts: 0,
} as ReviewCard;
test("workspace comparisons preserve aggregate, index and worktree semantics", () => {
  expect(cardComparison(card, true)).toEqual({
    identity: "feat/example",
    scope: "HEAD → 工作区",
  });
  expect(
    cardComparison(
      { ...card, state: { ...card.state, filter: "staged" } },
      true,
    ).scope,
  ).toBe("HEAD → 暂存区");
  expect(
    cardComparison(
      { ...card, state: { ...card.state, filter: "unstaged" } },
      false,
    ).scope,
  ).toBe("Index → Worktree");
  expect(cardComparison({ ...card, branch: "" }, true).identity).toBe("HEAD");
});
test("refs never imply the checkout branch and distinguish merge-base from two-dot", () => {
  const refs = {
    ...card,
    kind: "refs",
    base: "main",
    target: "v2",
    dots: "three",
  } as ReviewCard;
  expect(cardComparison(refs, true)).toEqual({
    identity: "main → v2",
    scope: "合并基点",
  });
  expect(cardComparison({ ...refs, dots: "two" }, false).scope).toBe("Two-dot");
  expect(cardStatuses(refs, true)).toBe("SHA 已固定");
});
test("face omits zero statuses, prioritizes conflicts, exact counters remain in payload", () => {
  expect(cardStatuses(card, true)).toBe("未暂存 15 · 未跟踪 20");
  expect(cardStatuses({ ...card, conflicts: 2 }, true)).toBe(
    "冲突 2 · 未暂存 15 · 未跟踪 20",
  );
  expect(cardStatuses({ ...card, unstaged: counts, untracked: 0 }, false)).toBe(
    "Clean workspace",
  );
});
test("large totals are bounded on face without modifying source values", () => {
  expect(compactCount(204, true)).toBe("204");
  expect(compactCount(120000, false)).toBe("120K");
  expect(compactCount(120000, true)).toBe("12万");
  expect(compactCount(0, false)).toBe("0");
});
test("sample time distinguishes stale days and years and handles invalid input", () => {
  const now = new Date(2026, 10, 13, 17, 0);
  expect(
    cardTime(new Date(2026, 10, 13, 16, 30).toISOString(), true, now),
  ).toBe("16:30");
  expect(
    cardTime(new Date(2026, 10, 12, 16, 30).toISOString(), true, now),
  ).toContain("11/12");
  expect(
    cardTime(new Date(2025, 10, 12, 16, 30).toISOString(), true, now),
  ).toContain("2025");
  expect(cardTime("bad", true, now)).toBe("—");
});
