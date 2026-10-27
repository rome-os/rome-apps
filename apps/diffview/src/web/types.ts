import type { CodeViewItem } from "@pierre/diffs";
import type { Mode } from "../lib/git";
import type { ChangeTotals } from "../lib/attributes";
import type { PullRequestInfo } from "../shared/reviewContext";
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
}
export interface PrRefData {
  /** Checkout snapshot used to resolve this association, not the repository scan. */
  currentBranch: string;
  prs: PullRequestInfo[];
  /** Exact current-branch association, including a recently merged or closed PR. */
  currentBranchPr?: PullRequestInfo;
  /** Canonical GitHub identity of the checked-out branch’s tracking/origin repository. */
  branchRepositoryId?: string;
  prState: string;
}
export interface FilesData {
  /** Only GitHub-provided hunks are available; no local context/full-file expansion. */
  fallback?: boolean;
  /** How long the server took, so polling can back off on large repositories. */
  ms?: number;
  files: import("../lib/git").FileEntry[];
  /** Backend-computed review totals; absent only in old cached/test payloads. */
  totals?: ChangeTotals;
  /** First page of patches, shipped with the list so the first paint needs no further request. */
  page?: PageData;
  /** Comparing a base: its resolved name, and whether it is the commit HEAD is on. */
  compare?: { ref: string; same: boolean };
  /** Exact selected PR metadata returned by the comparison resolver. */
  pullRequest?: PullRequestInfo;
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
