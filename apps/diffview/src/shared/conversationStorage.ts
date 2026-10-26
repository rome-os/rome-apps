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
function inventory(storage: StorageKV, touched: string, replacement?: string) {
  const values = new Map<string, string>();
  // Discover legacy keys too, including scopes not represented by an old/corrupt index.
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && scopeOf(key) !== undefined)
      values.set(key, storage.getItem(key) || "");
  }
  if (replacement !== undefined) values.set(touched, replacement);
  let previous: string[] = [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(INDEX) || "[]");
    if (Array.isArray(raw))
      previous = raw.filter((s): s is string => typeof s === "string");
  } catch {}
  for (const [key, value] of values) {
    if ((key.length + value.length) * 2 > CONVERSATION_ENTRY_BYTES) {
      storage.removeItem(key);
      values.delete(key);
    }
  }
  const scopes = new Set([...values.keys()].map((key) => scopeOf(key)!));
  const touchedScope = scopeOf(touched)!;
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
  return { order, remove };
}
export function readConversation(storage: StorageKV | undefined, key: string) {
  if (!storage || scopeOf(key) === undefined) return null;
  try {
    const { order } = inventory(storage, key);
    try {
      storage.setItem(INDEX, JSON.stringify(order));
    } catch {
      /* reads survive index-write failure */
    }
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
    const { order, remove } = inventory(storage, key, text);
    if (!order.includes(scopeOf(key)!)) return;
    for (;;) {
      try {
        storage.setItem(key, text);
        break;
      } catch {
        const oldest = order.shift();
        if (oldest === undefined || oldest === scopeOf(key)) return;
        remove(oldest);
      }
    }
    storage.setItem(INDEX, JSON.stringify(order));
  } catch {
    /* browser storage blocked/full; in-memory UI remains usable */
  }
}
