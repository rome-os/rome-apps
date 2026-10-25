import type { FileEntry } from "../lib/git.js";
export interface ReviewFolder {
  name: string;
  path: string;
  folders: ReviewFolder[];
  files: FileEntry[];
}
/** Compress only folder-only single-child chains; preserve file-bearing branches. */
export function compressedTree(files: FileEntry[]): ReviewFolder {
  const root: ReviewFolder = { name: "", path: "", folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    let path = "";
    for (const name of parts.slice(0, -1)) {
      path += name + "/";
      let next = node.folders.find((f) => f.name === name);
      if (!next) {
        next = { name, path, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  const compress = (node: ReviewFolder) => {
    for (let child of node.folders) {
      while (!child.files.length && child.folders.length === 1) {
        const next = child.folders[0];
        child.name += "/" + next.name;
        child.path = next.path;
        child.files = next.files;
        child.folders = next.folders;
      }
      compress(child);
    }
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
  };
  compress(root);
  return root;
}
export function activeFileAt(
  rows: { id: string; top: number }[],
  scrollTop: number,
  inset = 44,
) {
  const sorted = [...rows].sort((a, b) => a.top - b.top);
  let result = sorted[0]?.id;
  for (const row of sorted) {
    if (row.top > scrollTop + inset) break;
    result = row.id;
  }
  return result;
}
export function nextContext(
  current: number,
  direction: "up" | "down" | "all" = "down",
) {
  return direction === "all"
    ? 10000
    : Math.min(10000, Math.max(0, Math.floor(current || 0)) + 20);
}
export function pathParts(path: string) {
  const index = path.lastIndexOf("/");
  return {
    directory: index < 0 ? "" : path.slice(0, index + 1),
    basename: path.slice(index + 1),
  };
}

// Pierre treats the explicit version as authoritative, including collapsed state.
export function reviewItemVersion(base = 0, collapsed = false) {
  return base * 2 + (collapsed ? 1 : 0);
}

/**
 * A version number derived from the patch text itself (FNV-1a over its UTF-16 units, mixed with
 * the length). Identical content always gets the same version, so Pierre's per-item caches (keyed
 * by id and version) are reused when a refresh brings back files that did not change. A version
 * taken from the clock made every refresh look like all-new content: measured, the JS heap kept
 * growing about 180 KB per refresh on a 60-file repository that changed every few seconds.
 */
export function contentVersion(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 0x3fffffff) * 4 + (text.length % 4) + 1;
}
