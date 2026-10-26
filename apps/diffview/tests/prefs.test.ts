import { test } from "vitest";
import assert from "node:assert/strict";
import {
  loadChatState,
  saveChatState,
  loadPrefs,
  loadHome,
  rememberHome,
  savePrefs,
  type KV,
} from "../src/shared/prefs";

function memory(): KV {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (key: string) => {
      m.delete(key);
    },
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

test("review state is remembered per conversation", () => {
  const kv = memory();
  saveChatState("chat:a", { repo: "/r/a", mode: "branch", base: "main" }, kv);
  saveChatState("chat:b", { repo: "/r/b", filter: "staged" }, kv);
  assert.deepEqual(loadChatState("chat:a", kv), {
    repo: "/r/a",
    mode: "branch",
    base: "main",
  });
  assert.deepEqual(loadChatState("chat:b", kv), {
    repo: "/r/b",
    filter: "staged",
  });
  assert.equal(loadChatState("chat:c", kv), undefined);
});
test("display preferences are global and never leak into a conversation", () => {
  const kv = memory();
  savePrefs({ split: true, wrap: true, unified: "10", treeWidth: 300 }, kv);
  saveChatState("chat:a", { repo: "/r", split: "x", wrap: "y" } as never, kv);
  assert.deepEqual(loadChatState("chat:a", kv), { repo: "/r" });
  const prefs = loadPrefs(kv);
  assert.equal(prefs.split, true);
  assert.equal(prefs.wrap, true);
  assert.equal(prefs.unified, "10");
  assert.equal(prefs.treeWidth, 300);
});
test("corrupt or hostile storage degrades to defaults", () => {
  const kv = memory();
  kv.setItem("diffview:prefs:v1", "{not json");
  kv.setItem("diffview:chat:v1:chat:a", '"a string"');
  assert.deepEqual(loadPrefs(kv).unified, undefined);
  assert.equal(loadChatState("chat:a", kv), undefined);
  savePrefs({ unified: "abc" }, kv);
  assert.equal(loadPrefs(kv).unified, undefined);
});
test("unknown enum values are dropped", () => {
  const kv = memory();
  saveChatState(
    "chat:a",
    { repo: "/r", mode: "evil", filter: "x" } as never,
    kv,
  );
  assert.deepEqual(loadChatState("chat:a", kv), { repo: "/r" });
});
test("a conversation's home repo is the first one it reviewed and never changes", () => {
  const kv = memory();
  assert.equal(loadHome("chat:a", kv), "");
  assert.equal(rememberHome("chat:a", "/r/one", kv), "/r/one");
  assert.equal(rememberHome("chat:a", "/r/two", kv), "/r/one");
  assert.equal(loadHome("chat:a", kv), "/r/one");
  assert.equal(loadHome("chat:b", kv), "");
  assert.equal(rememberHome("chat:b", "", kv), "");
});
