import {
  readConversation,
  writeConversation,
  type StorageKV,
} from "./conversationStorage.js";
/**
 * What is remembered, and where.
 *  - Per conversation: which repo and comparison is being reviewed.
 *  - Global: how diffs are displayed (split, wrap, context lines, ...).
 */
export const CHAT_FIELDS = [
  "repo",
  "mode",
  "filter",
  "base",
  "ref",
  "pr",
  "commit",
  "dots",
  "target",
] as const;
export type ChatField = (typeof CHAT_FIELDS)[number];
export type ChatState = Partial<Record<ChatField, string>> & {
  mode?: "uncommitted" | "branch" | "pr" | "ref" | "unpushed" | "commit";
};
const ENUMS: Partial<Record<ChatField, readonly string[]>> = {
  mode: ["uncommitted", "branch", "pr", "ref", "unpushed", "commit"],
  filter: ["all", "staged", "unstaged"],
  dots: ["three", "two"],
  target: ["head", "worktree"],
};
export const DEFAULT_CHAT_STATE: Required<ChatState> = {
  repo: "",
  mode: "uncommitted",
  filter: "all",
  base: "",
  ref: "",
  pr: "",
  commit: "",
  dots: "three",
  target: "worktree",
};
export interface Prefs {
  split?: boolean;
  wrap?: boolean;
  collapseContext?: boolean;
  hideViewed?: boolean;
  showTree?: boolean;
  unified?: string;
  treeWidth?: number;
}
export interface KV extends StorageKV {}
const PREFS_KEY = "diffview:prefs:v1";
const chatKey = (scope: string) => "diffview:chat:v1:" + scope;
function read(storage: KV | undefined, key: string): unknown {
  try {
    return JSON.parse(storage?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(storage: KV | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: preferences are best-effort */
  }
}
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
export function loadPrefs(storage?: KV): Prefs {
  const raw = read(storage, PREFS_KEY);
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const width = Number(o.treeWidth);
  const unified = typeof o.unified === "string" && /^\d{1,5}$/.test(o.unified);
  return {
    split: bool(o.split),
    wrap: bool(o.wrap),
    collapseContext: bool(o.collapseContext),
    hideViewed: bool(o.hideViewed),
    showTree: bool(o.showTree),
    unified: unified ? (o.unified as string) : undefined,
    treeWidth: Number.isFinite(width) && width > 0 ? width : undefined,
  };
}
export function savePrefs(prefs: Prefs, storage?: KV) {
  write(storage, PREFS_KEY, prefs);
}
export function pickChatState(state: ChatState): ChatState {
  const out: Record<string, string> = {};
  for (const field of CHAT_FIELDS) {
    const v = (state as Record<string, unknown>)[field];
    const allowed = ENUMS[field];
    if (typeof v === "string" && (!allowed || allowed.includes(v)))
      out[field] = v;
  }
  return out as ChatState;
}
export function loadChatState(
  scope: string,
  storage?: KV,
): ChatState | undefined {
  const raw = (() => {
    try {
      return JSON.parse(readConversation(storage, chatKey(scope)) || "null");
    } catch {
      return null;
    }
  })();
  if (!raw || typeof raw !== "object") return undefined;
  return pickChatState(raw as ChatState);
}
export function saveChatState(scope: string, state: ChatState, storage?: KV) {
  writeConversation(
    storage,
    chatKey(scope),
    JSON.stringify(pickChatState(state)),
  );
}

const homeKey = (scope: string) => "diffview:home:v1:" + scope;
/** The first repository a conversation reviewed; never overwritten once set. */
export function loadHome(scope: string, storage?: KV): string {
  let v: unknown;
  try {
    v = JSON.parse(readConversation(storage, homeKey(scope)) || "null");
  } catch {}
  return typeof v === "string" ? v : "";
}
export function rememberHome(
  scope: string,
  repo: string,
  storage?: KV,
): string {
  const existing = loadHome(scope, storage);
  if (existing || !repo) return existing;
  writeConversation(storage, homeKey(scope), JSON.stringify(repo));
  return repo;
}
