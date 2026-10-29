import { describe, expect, it } from "vitest";
import { recentInlineThreads, type InlineComment } from "./pr-discussion.js";

const c = (id: number, inReplyTo: number | null = null): InlineComment =>
  ({ id, inReplyTo, author: "a", path: "x.ts", line: 1, body: String(id) });

describe("recentInlineThreads", () => {
  it("keeps whole recent threads, so a reply never loses its parent", () => {
    // Thread 1 (root + late reply) is oldest; threads 2 and 3 are newer.
    const comments = [c(1), c(2), c(3), c(4, 1)];
    expect(recentInlineThreads(comments, 2).map((x) => x.id)).toEqual([2, 3]);
    expect(recentInlineThreads(comments, 4).map((x) => x.id)).toEqual([1, 4, 2, 3]);
  });
  it("keeps at least the newest thread even when it exceeds the limit", () => {
    expect(recentInlineThreads([c(1), c(2, 1), c(3, 1)], 2).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
