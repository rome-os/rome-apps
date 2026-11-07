import { describe, expect, it, vi } from "vitest";
import { readPublishedPRHistory } from "./published-pr-history.js";

describe("published GitHub history reader", () => {
  it("paginates every collection through the budgeted reader without subprocess fan-out", async () => {
    let active = 0;
    const read = vi.fn(async (endpoint: string) => {
      expect(++active).toBe(1);
      await Promise.resolve();
      active--;
      return JSON.stringify(endpoint.endsWith("page=1") ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 101 }]);
    });
    const result = await readPublishedPRHistory("o/r", 1, read);
    expect(result.reviews).toHaveLength(101);
    expect(result.inline).toHaveLength(101);
    expect(result.comments).toHaveLength(101);
    expect(read.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "repos/o/r/pulls/1/reviews?per_page=100&page=1", "repos/o/r/pulls/1/reviews?per_page=100&page=2",
      "repos/o/r/pulls/1/comments?per_page=100&page=1", "repos/o/r/pulls/1/comments?per_page=100&page=2",
      "repos/o/r/issues/1/comments?per_page=100&page=1", "repos/o/r/issues/1/comments?per_page=100&page=2",
    ]);
  });

  it.each(["not json", "null", '{}'])("rejects malformed pages instead of using local output: %s", async page => {
    await expect(readPublishedPRHistory("o/r", 1, async () => page)).rejects.toThrow();
  });

  it("bounds large histories and never returns a partial successful payload", async () => {
    const read = vi.fn(async () => JSON.stringify(Array.from({ length: 100 }, () => ({}))));
    await expect(readPublishedPRHistory("o/r", 1, read)).rejects.toThrow("too large");
    expect(read).toHaveBeenCalledTimes(10);
  });
});
