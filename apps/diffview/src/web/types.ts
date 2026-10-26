import type { CodeViewItem } from "@pierre/diffs";
import type { Mode } from "../lib/git";
export interface Repo {
  path: string;
  name: string;
  branch: string;
  base: string;
  lastCommit?: number;
}
export interface RefData {
  branches: string[];
  tags: string[];
  commits: { sha: string; title: string }[];
  prs: {
    number: number;
    title: string;
    headRefName: string;
    baseRefName: string;
  }[];
  prState: string;
}
export interface FilesData {
  /** Only GitHub-provided hunks are available; no local context/full-file expansion. */
  fallback?: boolean;
  /** How long the server took, so polling can back off on large repositories. */
  ms?: number;
  files: import("../lib/git").FileEntry[];
  /** First page of patches, shipped with the list so the first paint needs no further request. */
  page?: PageData;
  /** Comparing a base: its resolved name, and whether it is the commit HEAD is on. */
  compare?: { ref: string; same: boolean };
  fingerprint: string;
  head: string;
  base: string;
}
export interface State extends Mode {
  repo: string;
  unified: string;
}
export interface PageData {
  patches: Record<string, PatchData>;
  /** Cursor of the next page, or null after the last one. */
  next: number | null;
}
export interface PatchData {
  patch: string;
  binary: boolean;
  truncated: boolean;
  collapsed: boolean;
  totalLines?: number;
}
export interface Loaded {
  item?: CodeViewItem<undefined>;
  busy?: boolean;
  error?: string;
  binary?: boolean;
  truncated?: boolean;
  empty?: boolean;
  collapsed?: boolean;
  context?: number;
  totalLines?: number;
  /** Fingerprint of the file list this content was cut for; older than the current one = stale. */
  fp?: string;
  /** `contentVersion` of the patch, to recognise unchanged content without parsing it again. */
  version?: number;
}
