import { test } from "vitest";
import assert from "node:assert/strict";
import {
  loadScroll,
  saveScroll,
  scrollViewKey,
  SCROLL_VIEW_LIMIT,
} from "../src/shared/scroll";
import type { KV } from "../src/shared/prefs";

function memory(): KV {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}
const local = { repo: "/r", mode: "uncommitted" as const, filter: "all" };
const position = { top: 876, file: "src/file.ts", offset: 112 };

test("scroll positions are isolated by conversation, repository and comparison", () => {
  const storage = memory();
  const view = scrollViewKey(local);
  saveScroll("chat:a", view, position, storage);
  saveScroll("chat:b", view, { ...position, top: 234 }, storage);
  assert.deepEqual(loadScroll("chat:a", view, storage), position);
  assert.equal(loadScroll("chat:b", view, storage)?.top, 234);
  assert.equal(loadScroll("chat:c", view, storage), undefined);
  assert.equal(
    loadScroll("chat:a", scrollViewKey({ ...local, repo: "/other" }), storage),
    undefined,
  );
  assert.equal(
    loadScroll(
      "chat:a",
      scrollViewKey({ ...local, filter: "staged" }),
      storage,
    ),
    undefined,
  );
  assert.equal(loadScroll("page", view, storage), undefined);
});
test("inactive comparison inputs and fingerprints do not invalidate a scroll position", () => {
  assert.equal(
    scrollViewKey(local),
    scrollViewKey({ ...local, base: "main", ref: "HEAD~2", pr: "12" }),
  );
  assert.notEqual(
    scrollViewKey({ repo: "/r", mode: "pr", pr: "12" }),
    scrollViewKey({ repo: "/r", mode: "pr", pr: "13" }),
  );
  assert.notEqual(
    scrollViewKey({ repo: "/r", mode: "ref", ref: "main", target: "head" }),
    scrollViewKey({ repo: "/r", mode: "ref", ref: "main", target: "worktree" }),
  );
});
test("top-of-view positions are saved and restored, not treated as missing", () => {
  const storage = memory();
  saveScroll(
    "chat:a",
    "view",
    { top: 0, file: "first.ts", offset: 0 },
    storage,
  );
  assert.deepEqual(loadScroll("chat:a", "view", storage), {
    top: 0,
    file: "first.ts",
    offset: 0,
  });
});
test("scroll history has a bounded most-recently-saved set per conversation", () => {
  const storage = memory();
  for (let i = 0; i < SCROLL_VIEW_LIMIT; i++)
    saveScroll("chat:a", String(i), position, storage);
  saveScroll("chat:a", "0", { ...position, top: 999 }, storage);
  saveScroll("chat:a", "new", position, storage);
  assert.equal(loadScroll("chat:a", "0", storage)?.top, 999);
  assert.equal(loadScroll("chat:a", "1", storage), undefined);
  assert.deepEqual(loadScroll("chat:a", "new", storage), position);
});
test("malformed positions and unavailable storage cannot break the viewer", () => {
  const storage = memory();
  storage.setItem("diffview:scroll:v1:chat:a", "not json");
  assert.equal(loadScroll("chat:a", "view", storage), undefined);
  for (const top of [NaN, Infinity, -1, "123"]) {
    saveScroll("chat:a", "view", { ...position, top } as never, storage);
    assert.equal(loadScroll("chat:a", "view", storage), undefined);
  }
  const unavailable: KV = {
    length: 0,
    key: () => null,
    removeItem: () => {},
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("full");
    },
  };
  assert.doesNotThrow(() =>
    saveScroll("chat:a", "view", position, unavailable),
  );
  assert.equal(loadScroll("chat:a", "view", unavailable), undefined);
});
