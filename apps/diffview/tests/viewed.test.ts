import { test } from "vitest";
import assert from "node:assert/strict";
import {
  loadViewed,
  saveViewed,
  VIEWED_LIMIT,
  VIEWED_BYTES,
} from "../src/shared/viewed";
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
test("viewed keys are LRU bounded, migrate old keys, and never touch unrelated storage", () => {
  const s = memory();
  s.setItem("other-app:prefs", "keep");
  s.setItem("diffview:prefs:v1", "keep");
  for (let i = 0; i < 80; i++)
    s.setItem("diffview:viewed:" + i, JSON.stringify(["file" + i]));
  assert.deepEqual(loadViewed("diffview:viewed:0", s), ["file0"]);
  assert.ok(
    [...s.data.keys()].filter((k) => k.startsWith("diffview:viewed:")).length <=
      VIEWED_LIMIT,
  );
  for (let i = 80; i < 110; i++) saveViewed("diffview:viewed:" + i, ["new"], s);
  loadViewed("diffview:viewed:0", s);
  saveViewed("diffview:viewed:110", ["new"], s);
  assert.deepEqual(loadViewed("diffview:viewed:0", s), ["file0"]);
  assert.equal(s.getItem("other-app:prefs"), "keep");
  assert.equal(s.getItem("diffview:prefs:v1"), "keep");
});
test("viewed entries and total retained bytes are bounded; empty/malformed/blocked storage is safe", () => {
  const s = memory();
  for (let i = 0; i < 60; i++)
    saveViewed(
      "diffview:viewed:" + i,
      Array.from({ length: 2000 }, (_, j) => `${j}-` + "x".repeat(100)),
      s,
    );
  assert.ok(
    [...s.data]
      .filter(([k]) => k.startsWith("diffview:viewed"))
      .reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0) <= VIEWED_BYTES,
  );
  const entries = [...s.data].filter(([k]) => k.startsWith("diffview:viewed:"));
  assert.ok(
    entries.reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0) <=
      VIEWED_BYTES,
  );
  s.setItem("diffview:viewed:bad", "not json");
  assert.deepEqual(loadViewed("diffview:viewed:bad", s), []);
  s.setItem("diffview:viewed:huge", "x".repeat(100000));
  loadViewed("diffview:viewed:huge", s);
  assert.equal(s.getItem("diffview:viewed:huge"), null);
  const blocked = {
    ...s,
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.doesNotThrow(() =>
    saveViewed("diffview:viewed:blocked", ["a"], blocked),
  );
});
test("quota recovery prunes only owned keys and keeps the requested viewed entry", () => {
  const s = memory();
  saveViewed("diffview:viewed:old", ["old"], s);
  s.setItem("unrelated", "never remove");
  const limited = {
    ...s,
    setItem: (k: string, v: string) => {
      if (k === "diffview:viewed:new" && s.getItem("diffview:viewed:old"))
        throw Error("quota");
      s.setItem(k, v);
    },
  };
  saveViewed("diffview:viewed:new", ["new"], limited);
  assert.equal(s.getItem("diffview:viewed:old"), null);
  assert.deepEqual(loadViewed("diffview:viewed:new", s), ["new"]);
  assert.equal(s.getItem("unrelated"), "never remove");
});
