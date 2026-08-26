import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionEvent,
  ActionResult,
  AgentRunnerInterface,
  AppActionRuntimeDeps,
  RomeSessionRef,
} from "@rome-os/app-runtime";
import { createScanRepository } from "../../db/repositories/repo.js";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { formatCliError, sanitizeCliError } from "../../utils/cli-errors.js";

/** Validate repo slug to prevent shell injection */
function validateRepoSlug(slug: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(slug)) {
    throw new Error(`Invalid repository slug: ${slug}. Expected format: owner/repo`);
  }
}

const log = createAppLogger("code-review_pr-review");

class ReviewCancelledError extends Error {
  constructor(message = "Review cancelled by user.") {
    super(message);
    this.name = "ReviewCancelledError";
  }
}

interface PRReviewInput {
  repo?: string;
  prNumber?: number;
  prUrl?: string;
  /** Existing queued review row created by the API/webhook before this action starts. */
  reviewId?: string;
  /** Comment ID that triggered the review (e.g. PTAL comment) — used for eyes reaction */
  triggerCommentId?: number;
}

interface AgentFinding {
  severity: string;
  category: string;
  title: string;
  path: string;
  line: number;
  body: string;
}

interface AgentReviewOutput {
  summary: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  verdict_reason: string;
  findings: AgentFinding[];
}

/**
 * Public action event streamed by the `summon` action as soon as the summoned
 * agent's durable Rome session is minted. Mirrors the system app's
 * `SummonSessionStartedEvent` shape (kept local to avoid a cross-app import).
 */
interface SummonSessionStartedEvent extends ActionEvent {
  type: "rome_session_started";
  agentName: string;
  romeSession: RomeSessionRef;
}

/** Final result payload of a (non-interactive) `summon` invocation. */
interface SummonOutput {
  result: string;
  sessionId: string;
  romeSession: RomeSessionRef;
  /** Validated payload from the agent's `submit_output`, when it declares an outputSchema. */
  output?: unknown;
}

// `agentRunner` is retained for backwards compatibility with existing wiring,
// but the review agent now runs through the `summon` system action so its
// durable Rome session can be surfaced in the UI.
type PRReviewDeps = AppActionRuntimeDeps<{ agentRunner?: AgentRunnerInterface }>;

function normaliseRepo(input: string): string {
  let s = input.trim().replace(/\.git\/?$/, "");
  try {
    const url = new URL(s);
    const parts = url.pathname.replace(/^\//, "").split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch { /* not a URL */ }
  return s;
}

function parsePRUrl(url: string): { repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { repo: match[1], prNumber: parseInt(match[2], 10) };
}

function throwIfReviewCancelled(
  db: ReturnType<typeof createScanRepository>,
  reviewId: string,
): void {
  if (db.isPRReviewCancelled(reviewId)) {
    throw new ReviewCancelledError();
  }
}

/**
 * Await a `summon` invocation's final result while polling the review's
 * cancelled flag. Resolves with the {@link SummonOutput} on success, throws
 * {@link ReviewCancelledError} if the guardian cancels first, and throws a
 * plain Error for any non-`ok` summon result. The summon keeps running in the
 * background if we bail on cancellation — safe, because GitHub posting is owned
 * by this action, so an abandoned result is never published.
 */
async function awaitSummonWithCancellation(
  resultPromise: Promise<ActionResult<SummonOutput>>,
  db: ReturnType<typeof createScanRepository>,
  reviewId: string,
): Promise<SummonOutput> {
  const CANCEL_POLL_MS = 2000;
  return await new Promise<SummonOutput>((resolve, reject) => {
    let settled = false;
    const timer = setInterval(() => {
      if (settled) return;
      try {
        if (db.isPRReviewCancelled(reviewId)) {
          settled = true;
          clearInterval(timer);
          reject(new ReviewCancelledError());
        }
      } catch {
        /* ignore transient poll errors — the result promise still governs */
      }
    }, CANCEL_POLL_MS);
    resultPromise.then(
      (res) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        if (res.status !== "ok") {
          const message =
            res.status === "error" ? res.error : `Review agent ended with status "${res.status}".`;
          reject(new Error(message));
          return;
        }
        resolve(res.data as SummonOutput);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function fetchPRInfo(repoSlug: string, prNumber: number): { title: string; author: string; url: string; body: string; headSha: string } {
  validateRepoSlug(repoSlug);
  const result = execFileSync(
    "gh", ["pr", "view", String(prNumber), "--repo", repoSlug, "--json", "title,author,url,body,headRefOid"],
    { encoding: "utf-8", timeout: 30000 },
  );
  const data = JSON.parse(result);
  return {
    title: data.title || `PR #${prNumber}`,
    author: data.author?.login || "unknown",
    url: data.url || `https://github.com/${repoSlug}/pull/${prNumber}`,
    body: data.body || "",
    headSha: data.headRefOid || "",
  };
}

/**
 * Shallow-clone a repository (--depth 1) into a temporary directory and check
 * out the PR head so the clone reflects the code under review (not the
 * pre-change default branch). Falls back to the default-branch clone if the
 * PR head cannot be fetched. Returns the clone path and whether the checkout
 * landed on the PR head. Caller must clean up.
 */
function shallowCloneRepo(repoSlug: string, prNumber: number): { path: string; atPrHead: boolean } {
  validateRepoSlug(repoSlug);
  const tempDir = mkdtempSync(join(tmpdir(), "code-review-"));
  const cloneUrl = `https://github.com/${repoSlug}.git`;
  log.info("Shallow-cloning repository", { repo: repoSlug, dest: tempDir });
  execFileSync(
    "git", ["clone", "--depth", "1", cloneUrl, tempDir],
    { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
  );
  try {
    execFileSync(
      "git", ["-C", tempDir, "fetch", "--depth", "1", "origin", `pull/${prNumber}/head`],
      { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
    );
    execFileSync(
      "git", ["-C", tempDir, "checkout", "--detach", "FETCH_HEAD"],
      { encoding: "utf-8", timeout: 60000, stdio: "pipe" },
    );
    log.info("Checked out PR head in clone", { repo: repoSlug, prNumber, dest: tempDir });
    return { path: tempDir, atPrHead: true };
  } catch (err) {
    log.warn("Failed to fetch/checkout PR head, clone stays on default branch", {
      repo: repoSlug, prNumber, error: sanitizeCliError(err),
    });
    return { path: tempDir, atPrHead: false };
  }
}

// ---------------------------------------------------------------------------
// Eyes reaction helpers — indicate review-in-progress on GitHub
// ---------------------------------------------------------------------------

interface ReactionHandle {
  /** GitHub reaction ID, needed for deletion */
  reactionId: number;
  /** Where the reaction was placed: "issue" or "comment" */
  target: "issue" | "comment";
  /** For issue reactions: the issue/PR number. For comment reactions: the comment ID. */
  targetId: number;
}

/**
 * Add an "eyes" reaction to a PR (issue-level) to indicate review is in progress.
 */
function addEyesReactionToIssue(repoSlug: string, issueNumber: number): ReactionHandle | null {
  validateRepoSlug(repoSlug);
  try {
    const payload = JSON.stringify({ content: "eyes" });
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/issues/${issueNumber}/reactions`, "--method", "POST", "--input", "-"],
      { encoding: "utf-8", timeout: 15000, input: payload },
    );
    const data = JSON.parse(result);
    log.info("Added eyes reaction to PR", { repo: repoSlug, issueNumber, reactionId: data.id });
    return { reactionId: data.id, target: "issue", targetId: issueNumber };
  } catch (err) {
    log.warn("Failed to add eyes reaction to PR", { repo: repoSlug, issueNumber, error: sanitizeCliError(err) });
    return null;
  }
}

/** GitHub reaction contents used by this app. */
type ReactionContent = "eyes" | "confused";

/**
 * Add a reaction to a specific issue comment (e.g. PTAL comment). `eyes` marks
 * review-in-progress; `confused` marks that the comment's review was skipped.
 */
function addReactionToComment(
  repoSlug: string,
  commentId: number,
  content: ReactionContent,
): ReactionHandle | null {
  validateRepoSlug(repoSlug);
  try {
    const payload = JSON.stringify({ content });
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/issues/comments/${commentId}/reactions`, "--method", "POST", "--input", "-"],
      { encoding: "utf-8", timeout: 15000, input: payload },
    );
    const data = JSON.parse(result);
    log.info("Added reaction to comment", { repo: repoSlug, commentId, content, reactionId: data.id });
    return { reactionId: data.id, target: "comment", targetId: commentId };
  } catch (err) {
    log.warn("Failed to add reaction to comment", { repo: repoSlug, commentId, content, error: sanitizeCliError(err) });
    return null;
  }
}

/** Add an "eyes" reaction to a specific issue comment (e.g. PTAL comment). */
function addEyesReactionToComment(repoSlug: string, commentId: number): ReactionHandle | null {
  return addReactionToComment(repoSlug, commentId, "eyes");
}

/**
 * Add a "confused" (😕) reaction to a comment to signal its requested review was
 * skipped (e.g. an in-progress review for the same commit already owns it), so a
 * PTAL never goes silently unanswered. Fire-and-forget — the reaction is left in
 * place as a durable marker, so no handle is returned.
 */
function markCommentReviewSkipped(repoSlug: string, commentId: number): void {
  addReactionToComment(repoSlug, commentId, "confused");
}

/**
 * Remove an eyes reaction that was previously added.
 */
function removeEyesReaction(repoSlug: string, handle: ReactionHandle): void {
  validateRepoSlug(repoSlug);
  try {
    if (handle.target === "issue") {
      execFileSync(
        "gh", ["api", `repos/${repoSlug}/issues/${handle.targetId}/reactions/${handle.reactionId}`, "--method", "DELETE"],
        { encoding: "utf-8", timeout: 15000 },
      );
    } else {
      execFileSync(
        "gh", ["api", `repos/${repoSlug}/issues/comments/${handle.targetId}/reactions/${handle.reactionId}`, "--method", "DELETE"],
        { encoding: "utf-8", timeout: 15000 },
      );
    }
    log.info("Removed eyes reaction", { repo: repoSlug, target: handle.target, targetId: handle.targetId, reactionId: handle.reactionId });
  } catch (err) {
    log.warn("Failed to remove eyes reaction", { repo: repoSlug, target: handle.target, targetId: handle.targetId, error: sanitizeCliError(err) });
  }
}

// ---------------------------------------------------------------------------
// GitHub Review posting (still action-side — agent returns findings, we post)
// ---------------------------------------------------------------------------

/**
 * Build a map of valid inline-comment anchors from the PR's diff:
 * path -> set of NEW-side line numbers (context and `+` lines in hunks).
 * Returns null if the file list cannot be fetched — callers should then skip
 * anchor validation and fall back to letting GitHub validate.
 */
function fetchValidDiffAnchors(repoSlug: string, prNumber: number): Map<string, Set<number>> | null {
  validateRepoSlug(repoSlug);
  try {
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/pulls/${prNumber}/files`, "--paginate", "--jq", "[.[] | {filename, patch}]"],
      { encoding: "utf-8", timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
    );
    // --paginate with --jq emits one JSON array per page; concatenate them.
    const files: Array<{ filename: string; patch?: string | null }> = [];
    for (const chunk of result.trim().split("\n")) {
      if (!chunk) continue;
      const page = JSON.parse(chunk);
      if (Array.isArray(page)) files.push(...page);
    }
    const anchors = new Map<string, Set<number>>();
    for (const file of files) {
      const lines = new Set<number>();
      const patch = file.patch;
      if (patch) {
        let newLine = 0;
        for (const raw of patch.split("\n")) {
          const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (hunk) {
            newLine = parseInt(hunk[1], 10);
            continue;
          }
          if (raw.startsWith("+") || raw.startsWith(" ")) {
            lines.add(newLine);
            newLine++;
          }
          // '-' lines belong to the old side; do not advance newLine.
        }
      }
      anchors.set(file.filename, lines);
    }
    return anchors;
  } catch (err) {
    log.warn("Failed to fetch diff anchors, skipping anchor validation", {
      repo: repoSlug, prNumber, error: sanitizeCliError(err),
    });
    return null;
  }
}

/**
 * Post a GitHub PR Review with inline comments using the Reviews API.
 * Findings whose path+line don't anchor to the diff are dropped from the
 * inline comments (they remain visible in the summary table). Returns the
 * review URL.
 */
function postInlineReview(
  repoSlug: string,
  prNumber: number,
  headSha: string,
  reviewOutput: AgentReviewOutput,
): { reviewUrl: string | null; postedFindings: number; skippedFindings: number } {
  validateRepoSlug(repoSlug);

  const event = "COMMENT";

  const verdictEmoji: Record<string, string> = {
    APPROVE: "\u2705",
    REQUEST_CHANGES: "\u{1F6D1}",
    COMMENT: "\u{1F4AC}",
  };

  let cleanSummary = reviewOutput.summary
    .replace(/^Code Review:?\s*(?:PR\s*#\d+\s*[—–-]\s*)?/i, "")
    .trim();
  if (cleanSummary.startsWith("#")) {
    cleanSummary = cleanSummary.replace(/^#+\s*/, "");
  }

  const summaryParts: string[] = [];
  summaryParts.push(`## Code Review: ${verdictEmoji[reviewOutput.verdict] || ""} ${reviewOutput.verdict}`);
  summaryParts.push("");
  summaryParts.push(cleanSummary);
  summaryParts.push("");
  summaryParts.push(`**Verdict:** ${reviewOutput.verdict} — ${reviewOutput.verdict_reason}`);

  // Validate finding anchors against the diff BEFORE posting: an invalid
  // path+line makes the Reviews API reject the ENTIRE review (HTTP 422), so a
  // single bad anchor would otherwise drop every inline comment. Findings
  // that don't anchor are dropped from inline comments only — they remain
  // fully listed in the summary table.
  const anchors = fetchValidDiffAnchors(repoSlug, prNumber);
  const anchoredFindings: AgentFinding[] = [];
  let skipped = 0;
  for (const finding of reviewOutput.findings) {
    if (!finding.path || !finding.line) {
      skipped++;
      continue;
    }
    if (anchors && !anchors.get(finding.path)?.has(finding.line)) {
      log.info("Dropping inline comment with invalid diff anchor", {
        path: finding.path, line: finding.line, title: finding.title,
      });
      skipped++;
      continue;
    }
    anchoredFindings.push(finding);
  }

  if (reviewOutput.findings.length > 0) {
    summaryParts.push("");
    if (skipped > 0) {
      summaryParts.push(`**${reviewOutput.findings.length} finding(s)** — ${anchoredFindings.length} posted as inline comments below; ${skipped} listed in this table only (no matching diff line).`);
    } else {
      summaryParts.push(`**${reviewOutput.findings.length} finding(s)** posted as inline comments below.`);
    }
    summaryParts.push("");
    summaryParts.push("| Severity | Category | File | Title |");
    summaryParts.push("|----------|----------|------|-------|");
    for (const f of reviewOutput.findings) {
      summaryParts.push(`| ${f.severity} | ${f.category} | \`${f.path}\` | ${f.title} |`);
    }
  } else {
    summaryParts.push("");
    summaryParts.push("No issues found. Code looks good!");
  }
  summaryParts.push("");
  summaryParts.push("---");
  summaryParts.push(`*Automated review by [RomeOS](https://romeos.io) Code Review · commit ${headSha.substring(0, 7)}*`);

  // Build inline comments from the anchor-validated findings.
  const comments: Array<{ path: string; line: number; body: string }> = anchoredFindings.map((finding) => ({
    path: finding.path,
    line: finding.line,
    body: `**[${finding.severity}]** \`${finding.category}\` — **${finding.title}**\n\n${finding.body}`,
  }));

  const payload = JSON.stringify({
    commit_id: headSha,
    body: summaryParts.join("\n"),
    event,
    comments,
  });

  try {
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/pulls/${prNumber}/reviews`, "--method", "POST", "--input", "-"],
      { encoding: "utf-8", timeout: 60000, input: payload },
    );
    const data = JSON.parse(result);
    const reviewUrl = data.html_url || null;
    log.info("Posted PR review", { reviewUrl, inlineComments: comments.length, skipped });
    return { reviewUrl, postedFindings: comments.length, skippedFindings: skipped };
  } catch (err) {
    // If inline comments fail (e.g. path/line mismatch), retry without comments
    log.warn("PR review with inline comments failed, retrying summary-only", { error: sanitizeCliError(err) });
    try {
      const fallbackPayload = JSON.stringify({
        commit_id: headSha,
        body: summaryParts.join("\n"),
        event,
        comments: [],
      });
      const result = execFileSync(
        "gh", ["api", `repos/${repoSlug}/pulls/${prNumber}/reviews`, "--method", "POST", "--input", "-"],
        { encoding: "utf-8", timeout: 60000, input: fallbackPayload },
      );
      const data = JSON.parse(result);
      const reviewUrl = data.html_url || null;
      log.info("Posted PR review (summary-only fallback)", { reviewUrl });
      return { reviewUrl, postedFindings: 0, skippedFindings: reviewOutput.findings.length };
    } catch (fallbackErr) {
      log.error("Failed to post PR review", { error: sanitizeCliError(fallbackErr) });
      return { reviewUrl: null, postedFindings: 0, skippedFindings: reviewOutput.findings.length };
    }
  }
}

/**
 * Delete all inline comments belonging to a specific review.
 */
function deleteReviewInlineComments(repoSlug: string, prNumber: number, reviewId: string): void {
  try {
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/pulls/${prNumber}/reviews/${reviewId}/comments`, "--jq", ".[].id"],
      { encoding: "utf-8", timeout: 15000 },
    );
    const commentIds = result.trim().split("\n").filter(Boolean);
    for (const commentId of commentIds) {
      try {
        execFileSync(
          "gh", ["api", `repos/${repoSlug}/pulls/comments/${commentId}`, "--method", "DELETE"],
          { encoding: "utf-8", timeout: 10000 },
        );
      } catch (err) {
        log.warn("Failed to delete inline comment", { commentId, error: sanitizeCliError(err) });
      }
    }
    if (commentIds.length > 0) {
      log.info("Deleted inline comments from previous review", { reviewId, count: commentIds.length });
    }
  } catch (err) {
    log.warn("Failed to list inline comments for deletion", { reviewId, error: sanitizeCliError(err) });
  }
}

/**
 * Collapse a previous review comment by editing it to point to the new review,
 * and delete its inline comments so they don't clutter the PR.
 */
function collapsePreviousReview(
  repoSlug: string,
  prNumber: number,
  previousReviewUrl: string | null,
  newReviewUrl: string,
): void {
  if (!previousReviewUrl) return;
  validateRepoSlug(repoSlug);

  const reviewMatch = previousReviewUrl.match(/#pullrequestreview-(\d+)/);
  const commentMatch = previousReviewUrl.match(/#issuecomment-(\d+)/);

  try {
    if (reviewMatch) {
      const reviewId = reviewMatch[1];
      deleteReviewInlineComments(repoSlug, prNumber, reviewId);
      const payload = JSON.stringify({
        body: `\u{1F501} **This review has been superseded.** See the [latest review](${newReviewUrl}).`,
      });
      execFileSync(
        "gh", ["api", `repos/${repoSlug}/pulls/${prNumber}/reviews/${reviewId}`, "--method", "PUT", "--input", "-"],
        { encoding: "utf-8", timeout: 15000, input: payload },
      );
      log.info("Collapsed previous review", { reviewId, newReviewUrl });
    } else if (commentMatch) {
      const commentId = commentMatch[1];
      const payload = JSON.stringify({
        body: `\u{1F501} **This review has been superseded.** See the [latest review](${newReviewUrl}).`,
      });
      execFileSync(
        "gh", ["api", `repos/${repoSlug}/issues/comments/${commentId}`, "--method", "PATCH", "--input", "-"],
        { encoding: "utf-8", timeout: 15000, input: payload },
      );
      log.info("Collapsed previous comment", { commentId, newReviewUrl });
    }
  } catch (err) {
    log.error("Failed to collapse previous review", { error: sanitizeCliError(err), previousReviewUrl });
  }
}

// ---------------------------------------------------------------------------
// Agent prompt — thin context only, no diff content
// ---------------------------------------------------------------------------

function buildAgentPrompt(
  repoSlug: string,
  prNumber: number,
  prInfo: { title: string; body: string },
  customRules: string | null,
  projectMemory: string | null,
  clonePath: string | null,
  cloneAtPrHead: boolean,
): string {
  const parts: string[] = [];

  parts.push(`Please review this pull request:\n`);
  parts.push(`**Repository:** ${repoSlug}`);
  parts.push(`**PR #${prNumber}:** ${prInfo.title}\n`);

  if (prInfo.body) {
    parts.push(`**PR Description:**\n${prInfo.body}\n`);
  }

  if (clonePath && cloneAtPrHead) {
    parts.push(`**Local Repository Clone:** \`${clonePath}\` — a shallow clone checked out at the PR head (it already contains this PR's changes). Use Read, Glob, Grep, and Bash to browse the full post-change source.\n`);
  } else if (clonePath) {
    parts.push(`**Local Repository Clone:** \`${clonePath}\` — a shallow clone of the DEFAULT BRANCH (PR head checkout failed, so it does NOT contain this PR's changes). Use it for pre-change context only; fetch post-change file content via the get-pr-diff skill's full-file strategy (\`contents?ref=<head SHA>\`).\n`);
  }

  if (customRules) {
    parts.push(`**Custom Review Rules (must also check these):**\n${customRules}\n`);
  }

  // Project memory: accumulated, feedback-derived knowledge for this repo.
  // Injected independently of customRules (a separate, agent/user-maintained
  // block) so past feedback shapes this review. See design doc §5 / §7a.
  if (projectMemory && projectMemory.trim()) {
    parts.push(`**Project Memory (accumulated knowledge & past feedback for this repo — weigh it during review):**\n${projectMemory}\n`);
  }

  parts.push(`## Task`);
  parts.push(`Review this PR using your system instructions. The registered \`get-pr-diff\` skill should be used to fetch the diff; the primary command is \`gh pr diff ${prNumber} --repo ${repoSlug}\`.`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function buildWebUIComment(
  reviewOutput: AgentReviewOutput,
  rawOutput: string,
  isStructured: boolean,
): string {
  if (!isStructured) return rawOutput;

  const parts: string[] = [];
  parts.push(`## ${reviewOutput.verdict}`);
  parts.push("");
  parts.push(reviewOutput.summary);
  parts.push("");
  parts.push(`**Verdict:** ${reviewOutput.verdict} — ${reviewOutput.verdict_reason}`);
  if (reviewOutput.findings.length > 0) {
    parts.push("");
    parts.push(`### Findings (${reviewOutput.findings.length})`);
    for (const f of reviewOutput.findings) {
      parts.push("");
      parts.push(`- **[${f.severity}] ${f.title}** (\`${f.path}:${f.line}\` · ${f.category})`);
      parts.push(`  ${f.body}`);
    }
  }
  return parts.join("\n");
}

/**
 * Fallback parser for raw text output when the agent doesn't use submit_output.
 */
function parseAgentOutputFallback(raw: string): AgentReviewOutput {
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    const data = parsed.review ?? parsed.result ?? parsed.output ?? parsed;

    const summary = String(data.summary ?? data.overview ?? "");
    const rawVerdict = String(data.verdict ?? data.decision ?? "COMMENT").toUpperCase();
    const verdict = (["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(rawVerdict)
      ? rawVerdict : "COMMENT") as AgentReviewOutput["verdict"];
    const verdict_reason = String(data.verdict_reason ?? data.verdictReason ?? data.reason ?? "");

    const rawFindings: unknown[] =
      Array.isArray(data.findings) ? data.findings
      : Array.isArray(data.comments) ? data.comments
      : Array.isArray(data.issues) ? data.issues : [];

    const findings = rawFindings.map((f: any) => ({
      severity: String(f.severity ?? f.priority ?? "P2"),
      category: String(f.category ?? f.type ?? "general"),
      title:    String(f.title ?? f.name ?? "Finding"),
      path:     String(f.path ?? f.file ?? ""),
      line:     Number(f.line ?? f.lineNumber ?? 0),
      body:     String(f.body ?? f.description ?? f.message ?? ""),
    }));

    if (!summary) throw new Error("No summary");
    return { summary, verdict, verdict_reason, findings };
  } catch {
    log.warn("Could not parse agent text as JSON, using raw text as summary");
    const cleaned = raw.replace(/```json\s*\n?[\s\S]*?\n?```/g, "").trim();
    return {
      summary: cleaned || raw.substring(0, 2000),
      verdict: "COMMENT",
      verdict_reason: "Review completed (unstructured output)",
      findings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Action entry point
// ---------------------------------------------------------------------------

export function createAction(
  config: ActionConfig,
  deps: PRReviewDeps,
): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "GitHub repository in owner/repo format or full URL" },
        prNumber: { type: "number", description: "PR number to review" },
        prUrl: { type: "string", description: "Full PR URL (alternative to repo + prNumber)" },
        reviewId: { type: "string", description: "Existing queued review record id to update in-place" },
        triggerCommentId: { type: "number", description: "Comment ID that triggered the review (e.g. PTAL comment) — used for eyes reaction" },
      },
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const typedInput = input as unknown as PRReviewInput;
      const db = createScanRepository(deps.appContext.db);

      let repoSlug: string;
      let prNumber: number;

      if (typedInput.prUrl) {
        const parsed = parsePRUrl(typedInput.prUrl);
        if (!parsed) {
          return { status: "error", error: `Invalid PR URL: ${typedInput.prUrl}. Expected: https://github.com/owner/repo/pull/123` };
        }
        repoSlug = parsed.repo;
        prNumber = parsed.prNumber;
      } else if (typedInput.repo && typedInput.prNumber) {
        repoSlug = normaliseRepo(typedInput.repo);
        prNumber = typedInput.prNumber;
      } else {
        return { status: "error", error: "Either prUrl or both repo and prNumber are required." };
      }

      log.info("Starting PR review", { repo: repoSlug, prNumber });

      let review = typedInput.reviewId ? db.getPRReview(typedInput.reviewId) : undefined;
      if (review && (review.repo !== repoSlug || review.prNumber !== prNumber)) {
        log.warn("Queued review id does not match action input; creating a new review row", {
          reviewId: review.id,
          queuedRepo: review.repo,
          queuedPrNumber: review.prNumber,
          repo: repoSlug,
          prNumber,
        });
        review = undefined;
      }
      if (!review) {
        review = db.createQueuedPRReview({ repo: repoSlug, prNumber });
        log.info("Created queued PR review from action", { reviewId: review.id, repo: repoSlug, prNumber });
      }

      // Fetch PR info for headSha (commit-based locking) and metadata
      let prInfo: { title: string; author: string; url: string; body: string; headSha: string };
      try {
        throwIfReviewCancelled(db, review.id);
        db.updatePRReviewStage(review.id, "fetching_pr_info");
        prInfo = fetchPRInfo(repoSlug, prNumber);
        throwIfReviewCancelled(db, review.id);
      } catch (err: unknown) {
        if (err instanceof ReviewCancelledError || db.isPRReviewCancelled(review.id)) {
          const cancelled = db.cancelPRReview(review.id);
          log.info("PR review cancelled before PR info fetch completed", { reviewId: review.id, repo: repoSlug, prNumber });
          return { status: "ok", data: { reviewId: review.id, repo: repoSlug, prNumber, status: "cancelled", review: cancelled } };
        }
        const errorMsg = formatCliError(err, `Failed to fetch PR #${prNumber} from ${repoSlug}`);
        db.failPRReview(review.id, errorMsg);
        log.warn("Persisted failed PR review after PR info fetch error", {
          reviewId: review.id,
          repo: repoSlug,
          prNumber,
          error: errorMsg,
        });
        return { status: "error", error: errorMsg };
      }

      // Atomic lock + claim: update the queued row unless another in-progress
      // review already owns this repo+PR+commit. Any DB error here (e.g. a
      // constraint violation) must fail the review rather than propagate
      // uncaught and strand the row at `fetching_pr_info` with nothing to reap it.
      let claimedReview: ReturnType<typeof db.claimQueuedPRReview>;
      try {
        claimedReview = db.claimQueuedPRReview(review.id, {
          repo: repoSlug,
          prNumber,
          prUrl: prInfo.url,
          prTitle: prInfo.title,
          prAuthor: prInfo.author,
          headSha: prInfo.headSha || null,
        });
      } catch (err: unknown) {
        if (err instanceof ReviewCancelledError || db.isPRReviewCancelled(review.id)) {
          const cancelled = db.cancelPRReview(review.id);
          return { status: "ok", data: { reviewId: review.id, repo: repoSlug, prNumber, status: "cancelled", review: cancelled } };
        }
        const errorMsg = formatCliError(err, `Failed to claim review for PR #${prNumber} in ${repoSlug}`);
        db.failPRReview(review.id, errorMsg);
        log.warn("Persisted failed PR review after claim error", { reviewId: review.id, repo: repoSlug, prNumber, error: errorMsg });
        return { status: "error", error: errorMsg };
      }

      if (!claimedReview) {
        const message = `A review for commit ${prInfo.headSha.substring(0, 7)} is already in progress.`;
        db.skipPRReview(review.id, message);
        // Leave a visible marker on the triggering comment (e.g. a PTAL) so a
        // skipped request never goes silently unanswered.
        if (typedInput.triggerCommentId) {
          markCommentReviewSkipped(repoSlug, typedInput.triggerCommentId);
        }
        log.info("Review already in progress for this commit, skipping", {
          repo: repoSlug, prNumber, headSha: prInfo.headSha,
        });
        return {
          status: "ok",
          data: {
            repo: repoSlug,
            prNumber,
            headSha: prInfo.headSha,
            reviewId: review.id,
            status: "already-reviewed",
            message,
          },
        };
      }
      review = claimedReview;
      if (db.isPRReviewCancelled(review.id)) {
        const cancelled = db.cancelPRReview(review.id);
        log.info("PR review cancelled after claim", { reviewId: review.id, repo: repoSlug, prNumber });
        return { status: "ok", data: { reviewId: review.id, repo: repoSlug, prNumber, status: "cancelled", review: cancelled } };
      }
      const previousReview = db.getPreviousCompletedPRReviewByPR(repoSlug, prNumber, review.id);

      // Add eyes reactions to signal review-in-progress
      const eyesReactions: ReactionHandle[] = [];
      const prEyesReaction = addEyesReactionToIssue(repoSlug, prNumber);
      if (prEyesReaction) eyesReactions.push(prEyesReaction);
      if (typedInput.triggerCommentId) {
        const commentEyesReaction = addEyesReactionToComment(repoSlug, typedInput.triggerCommentId);
        if (commentEyesReaction) eyesReactions.push(commentEyesReaction);
      }

      // Shallow-clone the repo (at the PR head when possible) for broader context
      let clonePath: string | null = null;
      let cloneAtPrHead = false;
      let cloneWarning: string | null = null;
      try {
        throwIfReviewCancelled(db, review.id);
        db.updatePRReviewStage(review.id, "cloning");
        const clone = shallowCloneRepo(repoSlug, prNumber);
        clonePath = clone.path;
        cloneAtPrHead = clone.atPrHead;
        throwIfReviewCancelled(db, review.id);
        log.info("Repository cloned for review context", { clonePath, cloneAtPrHead, reviewId: review.id });
      } catch (err: unknown) {
        if (err instanceof ReviewCancelledError || db.isPRReviewCancelled(review.id)) {
          log.info("PR review cancellation noticed during clone", { reviewId: review.id, repo: repoSlug, prNumber });
        } else {
          cloneWarning = formatCliError(err, `Could not clone ${repoSlug} for context`);
          log.warn("Shallow clone failed, proceeding without local clone", { error: cloneWarning, reviewId: review.id });
        }
      }

      try {
        throwIfReviewCancelled(db, review.id);
        const settings = db.getPRReviewSettings(repoSlug);
        const customRules = settings?.customRules || null;
        const projectMemory = settings?.projectMemory || null;

        const prompt = buildAgentPrompt(repoSlug, prNumber, prInfo, customRules, projectMemory, clonePath, cloneAtPrHead);

        log.info("Invoking Code Review Expert agent", { reviewId: review.id, clonePath });
        db.updatePRReviewStage(review.id, "reviewing");
        throwIfReviewCancelled(db, review.id);

        let rawOutput = "";
        let structuredOutput: AgentReviewOutput | undefined;

        // Run the review through the `summon` system action instead of the raw
        // agent runner. Summon mints a durable Rome session for the summoned
        // agent and streams a `rome_session_started` event carrying an opaque
        // RomeSessionRef — we persist it so the UI can deep-link straight to the
        // live agent session (via `navigateRome({ path: "session", session })`).
        const invocation = deps.appContext.invokeAction<SummonSessionStartedEvent, SummonOutput>(
          "system:summon",
          { agentName: "code-review:code-review-expert", prompt },
        );

        // Consume the event stream in the background so the session link shows up
        // in the UI while the review is still running. Never throws upstream.
        const pumpSessionEvents = (async () => {
          for await (const ev of invocation.events) {
            if (ev.type === "rome_session_started" && ev.romeSession) {
              try {
                db.setPRReviewRomeSession(review.id, ev.romeSession);
                log.info("Captured summoned review agent session", { reviewId: review.id });
              } catch (err) {
                log.warn("Failed to persist review agent session", { reviewId: review.id, error: String(err) });
              }
            }
          }
        })().catch((err) => {
          log.warn("Summon event stream error", { reviewId: review.id, error: String(err) });
        });
        void pumpSessionEvents;

        // Await the summon result while still honoring cooperative cancellation:
        // poll the review's cancelled flag and stop waiting if the guardian
        // cancels. This action owns the GitHub posting, so an abandoned summon
        // result is never published.
        const summonOutput = await awaitSummonWithCancellation(invocation.result, db, review.id);

        // Persist the authoritative session from the final result too, in case
        // the early event was missed.
        if (summonOutput.romeSession) {
          try {
            db.setPRReviewRomeSession(review.id, summonOutput.romeSession);
          } catch (err) {
            log.warn("Failed to persist review agent session from result", { reviewId: review.id, error: String(err) });
          }
        }

        rawOutput = summonOutput.result ?? "";
        // Summon returns the agent's validated `submit_output` payload as `output`.
        if (summonOutput.output && typeof summonOutput.output === "object") {
          structuredOutput = summonOutput.output as AgentReviewOutput;
          log.info("Received structured output from summon", { reviewId: review.id });
        }

        // Prefer structured output; fall back to parsing raw text
        throwIfReviewCancelled(db, review.id);
        let reviewOutput: AgentReviewOutput;
        if (structuredOutput) {
          reviewOutput = structuredOutput;
        } else if (rawOutput.trim()) {
          log.warn("Agent did not use submit_output, falling back to text parsing", { reviewId: review.id });
          reviewOutput = parseAgentOutputFallback(rawOutput);
        } else {
          db.failPRReview(review.id, "Agent returned empty review.");
          return { status: "error", error: "Agent returned empty review." };
        }

        // Post review to GitHub
        throwIfReviewCancelled(db, review.id);
        db.updatePRReviewStage(review.id, "posting");
        throwIfReviewCancelled(db, review.id);
        const { reviewUrl, postedFindings, skippedFindings } = postInlineReview(
          repoSlug, prNumber, prInfo.headSha, reviewOutput,
        );
        throwIfReviewCancelled(db, review.id);

        // Collapse previous review if this is a re-review
        if (previousReview?.githubCommentUrl && reviewUrl) {
          collapsePreviousReview(repoSlug, prNumber, previousReview.githubCommentUrl, reviewUrl);
        }

        const fullComment = buildWebUIComment(reviewOutput, rawOutput, !!structuredOutput);
        db.completePRReview(review.id, fullComment, reviewUrl);

        log.info("PR review completed", {
          reviewId: review.id, repo: repoSlug, prNumber, reviewUrl,
          verdict: reviewOutput.verdict,
          totalFindings: reviewOutput.findings.length,
          postedFindings, skippedFindings,
        });

        const warnings: string[] = [];
        if (cloneWarning) warnings.push(cloneWarning);
        if (!reviewUrl) warnings.push("Failed to post review to GitHub. The review was completed but could not be published as a PR comment.");

        return {
          status: "ok",
          data: {
            reviewId: review.id,
            repo: repoSlug,
            prNumber,
            prTitle: prInfo.title,
            status: "completed",
            githubCommentUrl: reviewUrl,
            verdict: reviewOutput.verdict,
            totalFindings: reviewOutput.findings.length,
            postedInline: postedFindings,
            summary: reviewOutput.summary.substring(0, 500) + (reviewOutput.summary.length > 500 ? "..." : ""),
            ...(warnings.length > 0 ? { warnings } : {}),
          },
        };
      } catch (err: unknown) {
        if (err instanceof ReviewCancelledError || db.isPRReviewCancelled(review.id)) {
          const cancelled = db.cancelPRReview(review.id);
          log.info("PR review cancelled", { reviewId: review.id, repo: repoSlug, prNumber });
          return {
            status: "ok",
            data: {
              reviewId: review.id,
              repo: repoSlug,
              prNumber,
              status: "cancelled",
              review: cancelled,
            },
          };
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        db.failPRReview(review.id, errorMsg);
        log.error("PR review failed", { reviewId: review.id, error: errorMsg });
        return { status: "error", error: errorMsg };
      } finally {
        // Remove eyes reactions — review is done (success or failure)
        for (const handle of eyesReactions) {
          removeEyesReaction(repoSlug, handle);
        }
        if (clonePath) {
          try {
            rmSync(clonePath, { recursive: true, force: true });
            log.info("Cleaned up shallow clone", { clonePath });
          } catch (cleanupErr) {
            log.warn("Failed to clean up shallow clone", { clonePath, error: String(cleanupErr) });
          }
        }
      }
    },
  };
}
