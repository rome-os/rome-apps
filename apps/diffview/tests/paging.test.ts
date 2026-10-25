import { test } from "vitest";
import assert from "node:assert/strict";
import {
  PAGE_MAX_BYTES,
  PAGE_MAX_FILES,
  PAGE_MAX_LINES,
  isPageable,
  pageEnd,
} from "../src/shared/paging";

const f = (added: number, deleted = 0) => ({ added, deleted });
test("pageable files are text, expanded and non-empty", () => {
  const base = { binary: false, collapsed: false, added: 1, deleted: 0 };
  assert.equal(isPageable(base), true);
  assert.equal(isPageable({ ...base, binary: true }), false);
  assert.equal(isPageable({ ...base, collapsed: true }), false);
  assert.equal(isPageable({ ...base, added: 0 }), false);
});
test("a page always holds at least one file, even an over-budget one", () => {
  assert.equal(pageEnd([f(PAGE_MAX_LINES * 3), f(1)], 0), 1);
});
test("pages stop at the changed-line budget and continue from the cursor", () => {
  const items = Array.from({ length: 10 }, () => f(PAGE_MAX_LINES / 4));
  const first = pageEnd(items, 0);
  assert.equal(first, 4);
  assert.equal(pageEnd(items, first), 8);
  assert.equal(pageEnd(items, 8), 10);
});
test("pages stop at the file budget and at the byte budget", () => {
  const many = Array.from({ length: PAGE_MAX_FILES * 2 }, () => f(1));
  assert.equal(pageEnd(many, 0), PAGE_MAX_FILES);
  const big = Array.from({ length: 5 }, () => f(1));
  assert.equal(
    pageEnd(big, 0, () => PAGE_MAX_BYTES / 2 + 1),
    1,
  );
  assert.equal(
    pageEnd(big, 0, () => 10),
    5,
  );
});
test("paging every page covers each file exactly once", () => {
  const items = Array.from({ length: 1234 }, (_, i) => f((i % 37) + 1, i % 5));
  const seen: number[] = [];
  for (let c = 0; c < items.length;) {
    const end = pageEnd(items, c);
    assert.ok(end > c);
    for (let i = c; i < end; i++) seen.push(i);
    c = end;
  }
  assert.equal(seen.length, items.length);
  assert.deepEqual(
    seen,
    [...seen].sort((a, b) => a - b),
  );
});
