/** Shared retention for chat/home/scroll keys only. Never enumerate values outside these prefixes. */
export interface StorageKV {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const PREFIXES = [
  "diffview:chat:v1:",
  "diffview:home:v1:",
  "diffview:scroll:v1:",
];
const INDEX = "diffview:conversations-lru:v1";
export const CONVERSATION_LIMIT = 32;
export const CONVERSATION_BYTES = 512 * 1024;
export const CONVERSATION_ENTRY_BYTES = 64 * 1024;
function scopeOf(key: string) {
  const prefix = PREFIXES.find((prefix) => key.startsWith(prefix));
  return prefix ? key.slice(prefix.length) : undefined;
}
export function isConversationStorageKey(key: string | null) {
  return key === null || key === INDEX || scopeOf(key) !== undefined;
}
interface Inventory {
  scope: string;
  values: Map<string, string>;
  order: string[];
  index: string | null;
  length: number;
}
const inventories = new WeakMap<StorageKV, Inventory>();
/** A storage event from another document invalidates the bounded in-memory inventory. */
export function invalidateConversationInventory(storage: StorageKV) {
  inventories.delete(storage);
}
function inventory(storage: StorageKV, touched: string, replacement?: string) {
  const touchedScope = scopeOf(touched)!;
  const index = storage.getItem(INDEX);
  const cached = inventories.get(storage);
  const reuse =
    cached &&
    cached.scope === touchedScope &&
    cached.index === index &&
    cached.length === storage.length;
  const values = reuse ? cached.values : new Map<string, string>();
  let previous: string[] = reuse ? cached.order : [];
  if (!reuse) {
    // Scope/revision/key-count changes discover legacy and cross-document keys. The hot scroll
    // path reuses this bounded inventory rather than enumerating the whole shared origin.
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && scopeOf(key) !== undefined)
        values.set(key, storage.getItem(key) || "");
    }
    try {
      const raw: unknown = JSON.parse(index || "[]");
      if (Array.isArray(raw))
        previous = raw.filter((s): s is string => typeof s === "string");
    } catch {}
  }
  const current = replacement ?? storage.getItem(touched);
  if (current !== null) values.set(touched, current);
  else values.delete(touched);
  for (const [key, value] of values) {
    if ((key.length + value.length) * 2 > CONVERSATION_ENTRY_BYTES) {
      storage.removeItem(key);
      values.delete(key);
    }
  }
  const scopes = new Set([...values.keys()].map((key) => scopeOf(key)!));
  const order = [
    ...new Set(
      [...scopes].filter((s) => !previous.includes(s)).concat(previous),
    ),
  ].filter((s) => scopes.has(s) && s !== touchedScope);
  if (scopes.has(touchedScope)) order.push(touchedScope);
  const remove = (scope: string) => {
    for (const key of values.keys())
      if (scopeOf(key) === scope) {
        storage.removeItem(key);
        values.delete(key);
      }
  };
  const size = () =>
    [...values].reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0) +
    (INDEX.length + JSON.stringify(order).length) * 2;
  while (order.length > CONVERSATION_LIMIT || size() > CONVERSATION_BYTES) {
    const scope = order.shift();
    if (scope === undefined) break;
    remove(scope);
  }
  const state: Inventory = {
    scope: touchedScope,
    values,
    order,
    index,
    length: storage.length,
  };
  inventories.set(storage, state);
  return { state, remove };
}
function finish(storage: StorageKV, state: Inventory) {
  const text = JSON.stringify(state.order);
  try {
    if (state.index !== text) storage.setItem(INDEX, text);
    state.index = text;
  } catch {
    /* a failed index write cannot prevent reading existing state */
  }
  state.length = storage.length;
  inventories.set(storage, state);
}
export function readConversation(storage: StorageKV | undefined, key: string) {
  if (!storage || scopeOf(key) === undefined) return null;
  try {
    const { state } = inventory(storage, key);
    finish(storage, state);
    return storage.getItem(key);
  } catch {
    return null;
  }
}
export function writeConversation(
  storage: StorageKV | undefined,
  key: string,
  text: string,
) {
  if (
    !storage ||
    scopeOf(key) === undefined ||
    (key.length + text.length) * 2 > CONVERSATION_ENTRY_BYTES
  )
    return;
  try {
    let current = inventory(storage, key, text);
    let rescanned = false;
    if (!current.state.order.includes(scopeOf(key)!)) return;
    for (;;) {
      try {
        storage.setItem(key, text);
        break;
      } catch {
        invalidateConversationInventory(storage);
        if (!rescanned) {
          current = inventory(storage, key, text);
          rescanned = true;
        }
        const oldest = current.state.order.shift();
        if (oldest === undefined || oldest === scopeOf(key)) return;
        current.remove(oldest);
      }
    }
    finish(storage, current.state);
  } catch {
    invalidateConversationInventory(storage);
    /* browser storage blocked/full; in-memory UI remains usable */
  }
}
