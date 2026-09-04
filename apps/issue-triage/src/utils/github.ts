/**
 * GitHub CLI helpers for the Issue Triage app. GitHub is authenticated via the
 * Rome-managed `gh` CLI, so every call shells out through `gh api`. All repo
 * slugs are validated to prevent argument/shell injection.
 */
import { execFileSync } from "child_process";
import { createAppLogger } from "@rome-os/app-runtime";
import { sanitizeCliError } from "./cli-errors.js";

const log = createAppLogger("issue-triage:github");

/** Validate a repo slug (owner/name) to prevent injection. Throws on failure. */
export function validateRepoSlug(slug: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(slug)) {
    throw new Error(`Invalid repository slug: ${slug}. Expected format: owner/repo`);
  }
}

/** Normalize a repo URL or slug to `owner/name`. */
export function normalizeRepoSlug(input: string): string {
  let s = (input || "").trim().replace(/\.git\/?$/, "");
  try {
    const url = new URL(s);
    const parts = url.pathname.replace(/^\//, "").split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch {
    /* not a URL */
  }
  return s;
}

/** Parse an issue URL into { repo, issueNumber } or null. */
export function parseIssueUrl(url: string): { repo: string; issueNumber: number } | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { repo: match[1], issueNumber: parseInt(match[2], 10) };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  state: string;
  labels: string[];
  isPullRequest: boolean;
  authorLogin: string | null;
}

/** Fetch a single issue via `gh api repos/<slug>/issues/<n>`. */
export function fetchIssue(repoSlug: string, issueNumber: number): GitHubIssue {
  validateRepoSlug(repoSlug);
  const result = execFileSync(
    "gh",
    ["api", `repos/${repoSlug}/issues/${issueNumber}`],
    { encoding: "utf-8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
  );
  const data = JSON.parse(result) as Record<string, any>;
  return {
    number: Number(data.number) || issueNumber,
    title: String(data.title ?? `Issue #${issueNumber}`),
    body: String(data.body ?? ""),
    htmlUrl: String(data.html_url ?? `https://github.com/${repoSlug}/issues/${issueNumber}`),
    state: String(data.state ?? "open"),
    labels: Array.isArray(data.labels)
      ? data.labels.map((l: any) => (typeof l === "string" ? l : String(l?.name ?? ""))).filter(Boolean)
      : [],
    isPullRequest: !!data.pull_request,
    authorLogin: data.user?.login ? String(data.user.login) : null,
  };
}

export interface RepoLabel {
  name: string;
  color: string;
  description: string | null;
}

/** Fetch all labels defined in a repo via `gh api repos/<slug>/labels --paginate`. */
export function fetchRepoLabels(repoSlug: string): RepoLabel[] {
  validateRepoSlug(repoSlug);
  const result = execFileSync(
    "gh",
    ["api", `repos/${repoSlug}/labels`, "--paginate"],
    { encoding: "utf-8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
  );
  // --paginate concatenates JSON arrays; parse defensively.
  const labels: RepoLabel[] = [];
  const trimmed = result.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      for (const l of parsed) pushLabel(labels, l);
      return labels;
    }
  } catch {
    /* fall through to line-by-line */
  }
  for (const chunk of trimmed.split("\n")) {
    if (!chunk.trim()) continue;
    try {
      const page = JSON.parse(chunk);
      if (Array.isArray(page)) for (const l of page) pushLabel(labels, l);
    } catch {
      /* ignore unparseable chunk */
    }
  }
  return labels;
}

function pushLabel(into: RepoLabel[], l: any): void {
  if (!l || typeof l.name !== "string") return;
  into.push({
    name: l.name,
    color: typeof l.color === "string" ? l.color : "ededed",
    description: typeof l.description === "string" ? l.description : null,
  });
}

/**
 * Create a label in the repo. Idempotent: a 422 (label already exists) is
 * treated as success. Returns true if the label was newly created.
 */
export function createLabel(
  repoSlug: string,
  label: { name: string; color: string; description: string },
): boolean {
  validateRepoSlug(repoSlug);
  try {
    execFileSync(
      "gh",
      [
        "api",
        `repos/${repoSlug}/labels`,
        "-f", `name=${label.name}`,
        "-f", `color=${label.color}`,
        "-f", `description=${label.description}`,
      ],
      { encoding: "utf-8", timeout: 20000 },
    );
    return true;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/HTTP 422|already_exists|already exists/i.test(raw)) {
      // Already present — not an error.
      return false;
    }
    log.warn("Failed to create label", { repo: repoSlug, label: label.name, error: sanitizeCliError(err) });
    throw err;
  }
}

/**
 * Add labels to an issue via `POST repos/<slug>/issues/<n>/labels`. This ADDS
 * the given labels without clobbering unrelated ones already on the issue.
 * Returns the resulting label name set as reported by GitHub.
 */
export function addLabelsToIssue(repoSlug: string, issueNumber: number, labels: string[]): string[] {
  validateRepoSlug(repoSlug);
  if (labels.length === 0) return [];
  const payload = JSON.stringify({ labels });
  const result = execFileSync(
    "gh",
    ["api", `repos/${repoSlug}/issues/${issueNumber}/labels`, "--method", "POST", "--input", "-"],
    { encoding: "utf-8", timeout: 20000, input: payload },
  );
  try {
    const data = JSON.parse(result);
    if (Array.isArray(data)) return data.map((l: any) => String(l?.name ?? "")).filter(Boolean);
  } catch {
    /* ignore */
  }
  return labels;
}

/** Remove a single label from an issue. Best-effort; a 404 is ignored. */
export function removeLabelFromIssue(repoSlug: string, issueNumber: number, label: string): void {
  validateRepoSlug(repoSlug);
  try {
    execFileSync(
      "gh",
      ["api", `repos/${repoSlug}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`, "--method", "DELETE"],
      { encoding: "utf-8", timeout: 15000 },
    );
  } catch (err) {
    log.info("Could not remove label (continuing)", { repo: repoSlug, issueNumber, label, error: sanitizeCliError(err) });
  }
}

/**
 * List open issues in a repo (excluding pull requests) via
 * `gh api repos/<slug>/issues?state=open&per_page=100 --paginate`.
 */
export function listOpenIssues(repoSlug: string, cap = 100): Array<{ number: number; title: string; htmlUrl: string }> {
  validateRepoSlug(repoSlug);
  const result = execFileSync(
    "gh",
    ["api", `repos/${repoSlug}/issues?state=open&per_page=100`, "--paginate"],
    { encoding: "utf-8", timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
  );
  const out: Array<{ number: number; title: string; htmlUrl: string }> = [];
  const trimmed = result.trim();
  const pages: any[] = [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) pages.push(...parsed);
    else pages.push(parsed);
  } catch {
    for (const chunk of trimmed.split("\n")) {
      if (!chunk.trim()) continue;
      try {
        const page = JSON.parse(chunk);
        if (Array.isArray(page)) pages.push(...page);
      } catch {
        /* ignore */
      }
    }
  }
  for (const issue of pages) {
    if (!issue || issue.pull_request) continue; // exclude PRs
    if (typeof issue.number !== "number") continue;
    out.push({
      number: issue.number,
      title: String(issue.title ?? `Issue #${issue.number}`),
      htmlUrl: String(issue.html_url ?? `https://github.com/${repoSlug}/issues/${issue.number}`),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** Read the connected GitHub login, or null when gh is not authenticated. */
export function readGitHubLogin(): string | null {
  try {
    const login = execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return login || null;
  } catch (err) {
    log.info("gh auth status check failed", { error: sanitizeCliError(err) });
    return null;
  }
}
