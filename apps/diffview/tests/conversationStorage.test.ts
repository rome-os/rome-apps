import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CONVERSATION_LIMIT,
  CONVERSATION_BYTES,
  CONVERSATION_ENTRY_BYTES,
  readConversation,
  writeConversation,
} from "../src/shared/conversationStorage";
import {
  loadChatState,
  saveChatState,
  loadHome,
  rememberHome,
} from "../src/shared/prefs";
import { loadScroll, saveScroll } from "../src/shared/scroll";
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => {
      if (!k.startsWith("diffview:")) throw Error("unrelated value read");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      assert(k.startsWith("diffview:"));
      data.delete(k);
    },
  };
}
const prefixes = [
  "diffview:chat:v1:",
  "diffview:home:v1:",
  "diffview:scroll:v1:",
];
const ownedBytes = (s: ReturnType<typeof memory>) =>
  [...s.data]
    .filter(
      ([k]) =>
        prefixes.some((p) => k.startsWith(p)) ||
        k === "diffview:conversations-lru:v1",
    )
    .reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0);

test("legacy conversation keys are pruned as whole scopes and unrelated values are untouched", () => {
  const s = memory();
  s.data.set("other-app:data", "untouched");
  s.data.set("diffview:viewed:keep", '["keep.ts"]');
  s.data.set("diffview:prefs:v1", '{"split":true}');
  for (let i = 0; i < 200; i++)
    for (const p of prefixes)
      s.data.set(
        p + `chat:${i}`,
        JSON.stringify(p.includes("chat:v1") ? { repo: `/r/${i}` } : []),
      );
  assert.equal(loadChatState("chat:0", s)?.repo, "/r/0");
  const scopes = new Set(
    [...s.data.keys()].flatMap((k) =>
      prefixes.filter((p) => k.startsWith(p)).map((p) => k.slice(p.length)),
    ),
  );
  assert.equal(scopes.size, CONVERSATION_LIMIT);
  assert(scopes.has("chat:0"));
  for (const p of prefixes) assert(s.data.has(p + "chat:0"));
  assert.equal(s.data.get("other-app:data"), "untouched");
  assert.equal(s.data.get("diffview:viewed:keep"), '["keep.ts"]');
  assert.equal(s.data.get("diffview:prefs:v1"), '{"split":true}');
  assert(ownedBytes(s) <= CONVERSATION_BYTES);
});
test("chat, home and scroll share recency and group eviction", () => {
  const s = memory();
  for (let i = 0; i < CONVERSATION_LIMIT; i++) {
    saveChatState(`chat:${i}`, { repo: `/r/${i}` }, s);
    rememberHome(`chat:${i}`, `/r/${i}`, s);
    saveScroll(`chat:${i}`, "view", { top: i, offset: 0, file: "f.ts" }, s);
  }
  loadHome("chat:0", s);
  saveChatState("chat:new", { repo: "/new" }, s);
  assert(loadScroll("chat:0", "view", s));
  for (const p of prefixes) assert(!s.data.has(p + "chat:1"));
  assert.equal(loadChatState("chat:new", s)?.repo, "/new");
});
test("total byte budget and per-entry limits include keys and the LRU index", () => {
  const s = memory();
  for (let i = 0; i < 100; i++)
    writeConversation(s, `diffview:chat:v1:chat:${i}`, "x".repeat(30000));
  assert(ownedBytes(s) <= CONVERSATION_BYTES);
  writeConversation(
    s,
    "diffview:chat:v1:chat:oversized",
    "x".repeat(CONVERSATION_ENTRY_BYTES),
  );
  assert(!s.data.has("diffview:chat:v1:chat:oversized"));
  for (let i = 0; i < 12; i++)
    saveScroll(
      "chat:scroll",
      "v".repeat(4096) + i,
      { top: i, offset: 0, file: "f".repeat(4096) },
      s,
    );
  const key = "diffview:scroll:v1:chat:scroll",
    text = s.data.get(key)!;
  assert((key.length + text.length) * 2 <= CONVERSATION_ENTRY_BYTES);
  assert(JSON.parse(text).length < 12);
  assert.equal(loadScroll("chat:scroll", "v".repeat(4096) + 11, s)?.top, 11);
});
test("quota recovery evicts only other owned conversation groups", () => {
  const s = memory();
  for (let i = 0; i < 5; i++)
    writeConversation(s, `diffview:chat:v1:chat:${i}`, "x".repeat(200));
  s.data.set("other-app:data", "untouched");
  const set = s.setItem;
  s.setItem = (k, v) => {
    if (
      !s.data.has(k) &&
      [...s.data.keys()].filter((k) => k.startsWith("diffview:chat:v1:"))
        .length >= 3
    )
      throw Error("quota");
    set(k, v);
  };
  writeConversation(s, "diffview:chat:v1:chat:new", '"saved"');
  assert.equal(readConversation(s, "diffview:chat:v1:chat:new"), '"saved"');
  assert.equal(s.data.get("other-app:data"), "untouched");
});
test("blocked index writes do not prevent reads and unsupported prefixes are refused", () => {
  const s = memory();
  writeConversation(s, "diffview:home:v1:chat:a", '"/r"');
  s.setItem = () => {
    throw Error("blocked");
  };
  assert.equal(readConversation(s, "diffview:home:v1:chat:a"), '"/r"');
  assert.equal(readConversation(s, "other-app:data"), null);
  assert.doesNotThrow(() =>
    writeConversation(s, "diffview:chat:v1:chat:b", "x"),
  );
  assert.equal(readConversation(undefined, "diffview:home:v1:chat:a"), null);
});
