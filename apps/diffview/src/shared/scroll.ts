import { comparisonIdentity } from "./comparison.js";
import type { Mode } from "../lib/git.js";
import type { KV } from "./prefs.js";

export interface ScrollPosition {
  top: number;
  file: string;
  /** Distance below the file header, independent of heights of earlier files. */
  offset: number;
}
export const SCROLL_VIEW_LIMIT = 12;
const storageKey = (scope: string) => "diffview:scroll:v1:" + scope;
export function scrollViewKey(state: Mode & { repo: string }) {
  return JSON.stringify([state.repo, comparisonIdentity(state)]);
}
function valid(value: unknown): value is ScrollPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as ScrollPosition;
  return (
    typeof p.top === "number" &&
    Number.isFinite(p.top) &&
    p.top >= 0 &&
    typeof p.offset === "number" &&
    Number.isFinite(p.offset) &&
    p.offset >= 0 &&
    typeof p.file === "string" &&
    p.file.length > 0 &&
    p.file.length <= 4096
  );
}
function positions(scope: string, storage?: KV): [string, ScrollPosition][] {
  try {
    const raw: unknown = JSON.parse(
      storage?.getItem(storageKey(scope)) ?? "null",
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .slice(-SCROLL_VIEW_LIMIT)
      .filter(
        (entry): entry is [string, ScrollPosition] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          valid(entry[1]),
      );
  } catch {
    return [];
  }
}
export function loadScroll(
  scope: string,
  view: string,
  storage?: KV,
): ScrollPosition | undefined {
  return positions(scope, storage).find(([key]) => key === view)?.[1];
}
export function saveScroll(
  scope: string,
  view: string,
  position: ScrollPosition,
  storage?: KV,
) {
  if (!valid(position)) return;
  const next = positions(scope, storage).filter(([key]) => key !== view);
  // Persist only a small anchor, never a diff, rendered item or DOM object.
  next.push([
    view,
    { top: position.top, file: position.file, offset: position.offset },
  ]);
  try {
    storage?.setItem(
      storageKey(scope),
      JSON.stringify(next.slice(-SCROLL_VIEW_LIMIT)),
    );
  } catch {
    /* Best effort when browser storage is blocked or full. */
  }
}
