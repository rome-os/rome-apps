/** Only viewed-state keys are enumerated/read/pruned; all other origin storage is untouched. */
interface ViewedStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const PREFIX = "diffview:viewed:";
const INDEX = "diffview:viewed-lru:v1";
export const VIEWED_LIMIT = 32;
export const VIEWED_BYTES = 256 * 1024;
const ENTRY_BYTES = 32 * 1024;
function owned(key: string) {
  return key.startsWith(PREFIX);
}
function order(storage: ViewedStorage, touched: string, replacement?: string) {
  let old: string[] = [];
  try {
    const raw = JSON.parse(storage.getItem(INDEX) || "[]");
    if (Array.isArray(raw))
      old = raw.filter((k): k is string => typeof k === "string" && owned(k));
  } catch {}
  const values = new Map<string, string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && owned(key)) values.set(key, storage.getItem(key) || "[]");
  }
  if (replacement !== undefined) values.set(touched, replacement);
  const keys = [
    ...new Set([...values.keys()].filter((k) => !old.includes(k)).concat(old)),
  ].filter((k) => values.has(k) && k !== touched);
  if (values.has(touched)) keys.push(touched);
  let bytes = 0;
  for (const key of [...keys]) {
    const size = ((values.get(key)?.length || 0) + key.length) * 2;
    if (size > ENTRY_BYTES) {
      storage.removeItem(key);
      keys.splice(keys.indexOf(key), 1);
      values.delete(key);
    } else bytes += size;
  }
  let indexCharacters =
    2 +
    keys.reduce((n, key) => n + JSON.stringify(key).length, 0) +
    Math.max(0, keys.length - 1);
  while (
    keys.length > VIEWED_LIMIT ||
    bytes + (INDEX.length + indexCharacters) * 2 > VIEWED_BYTES
  ) {
    const key = keys.shift();
    if (!key) break;
    indexCharacters -= JSON.stringify(key).length + (keys.length ? 1 : 0);
    bytes -= ((values.get(key)?.length || 0) + key.length) * 2;
    storage.removeItem(key);
  }
  return keys;
}
export function loadViewed(key: string, storage: ViewedStorage): string[] {
  if (!owned(key)) return [];
  try {
    const keys = order(storage, key);
    try {
      storage.setItem(INDEX, JSON.stringify(keys));
    } catch {
      /* reading marks must not depend on writing the LRU */
    }
    const value: unknown = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string").slice(-2000)
      : [];
  } catch {
    return [];
  }
}
export function saveViewed(
  key: string,
  marks: string[],
  storage: ViewedStorage,
) {
  if (!owned(key)) return;
  try {
    const bounded = [...new Set(marks)].slice(-2000);
    const parts: string[] = [];
    let characters = 2 + key.length;
    for (let i = bounded.length - 1; i >= 0; i--) {
      const part = JSON.stringify(bounded[i]);
      const size = part.length + (parts.length ? 1 : 0);
      if ((characters + size) * 2 > ENTRY_BYTES) break;
      parts.push(part);
      characters += size;
    }
    const text = "[" + parts.reverse().join(",") + "]";
    if ((text.length + key.length) * 2 > ENTRY_BYTES) return;
    const keys = order(storage, key, text);
    for (;;) {
      try {
        storage.setItem(key, text);
        break;
      } catch {
        const oldest = keys.shift();
        if (!oldest || oldest === key) return;
        storage.removeItem(oldest);
      }
    }
    storage.setItem(INDEX, JSON.stringify(keys));
  } catch {
    /* storage blocked: the in-memory viewed state still works */
  }
}
