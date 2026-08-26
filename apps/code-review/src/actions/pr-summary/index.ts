import { execFileSync } from "child_process";
import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionEvent,
  ActionResult,
  AppActionRuntimeDeps,
  RomeSessionRef,
} from "@rome-os/app-runtime";
import { createScanRepository } from "../../db/repositories/repo.js";
import {
  addCommentReaction,
  addIssueReaction,
  postIssueComment,
  removeReaction,
  validateRepoSlug,
  type ReactionHandle,
} from "../../utils/github.js";
import { sanitizeCliError } from "../../utils/cli-errors.js";

const log = createAppLogger("code-review_pr-summary");

/** Caps to keep the agent prompt bounded on very noisy PRs. */
const MAX_REVIEWS = 40;
const MAX_INLINE_COMMENTS = 80;
const MAX_DISCUSSION_COMMENTS = 60;
const MAX_BODY_CHARS = 4000;
const MAX_ITEM_BODY_CHARS = 1500;

interface SummaryInput {
  repo?: string;
  prNumber?: number;
  triggerCommentId?: number | null;
  commentBody?: string;
  actorLogin?: string | null;
}

type FixSize = "small" | "medium" | "large";
type Rating = "low" | "medium" | "high";

interface SummaryItem {
  title: string;
  fix_size: FixSize;
  /** Concrete estimated lines of code to fix (a single number), e.g. 60. */
  fix_size_loc: number;
  trigger_probability: Rating;
  impact: Rating;
  fix_value: Rating;
  rationale: string;
}

interface AgentSummaryOutput {
  overview: string;
  items: SummaryItem[];
  overall: string;
}

/** Public event streamed by `summon` when the agent's durable session is minted. */
interface SummonSessionStartedEvent extends ActionEvent {
  type: "rome_session_started";
  agentName: string;
  romeSession: RomeSessionRef;
}

interface SummonOutput {
  result: string;
  sessionId: string;
  romeSession: RomeSessionRef;
  output?: unknown;
}

// ---------------------------------------------------------------------------
// GitHub gathering helpers (read-only; posting is done via utils/github.ts)
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

interface PRMeta {
  title: string;
  author: string;
  body: string;
  state: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
}

function fetchPRMeta(repoSlug: string, prNumber: number): PRMeta {
  validateRepoSlug(repoSlug);
  const result = execFileSync(
    "gh",
    ["pr", "view", String(prNumber), "--repo", repoSlug, "--json", "title,author,body,state,additions,deletions,changedFiles,url"],
    { encoding: "utf-8", timeout: 30000 },
  );
  const data = JSON.parse(result);
  return {
    title: data.title || `PR #${prNumber}`,
    author: data.author?.login || "unknown",
    body: data.body || "",
    state: data.state || "",
    additions: Number(data.additions ?? 0),
    deletions: Number(data.deletions ?? 0),
    changedFiles: Number(data.changedFiles ?? 0),
    url: data.url || `https://github.com/${repoSlug}/pull/${prNumber}`,
  };
}

interface ReviewEntry {
  author: string;
  state: string;
  body: string;
}

function fetchReviews(repoSlug: string, prNumber: number): ReviewEntry[] {
  try {
    const result = execFileSync(
      "gh",
      ["api", `repos/${repoSlug}/pulls/${prNumber}/reviews`, "--paginate", "--jq", "[.[] | {author: .user.login, state: .state, body: .body}]"],
      { encoding: "utf-8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    );
    const entries: ReviewEntry[] = [];
    for (const chunk of result.trim().split("\n")) {
      if (!chunk) continue;
      const page = JSON.parse(chunk);
      if (Array.isArray(page)) {
        for (const r of page) {
          const body = String(r.body ?? "").trim();
          // Skip empty-body reviews (e.g. a bare "APPROVE" with no comment) unless
          // the state itself is meaningful.
          if (!body && (r.state === "COMMENTED" || !r.state)) continue;
          entries.push({ author: String(r.author ?? "unknown"), state: String(r.state ?? ""), body });
        }
      }
    }
    return entries.slice(0, MAX_REVIEWS);
  } catch (err) {
    log.warn("Failed to fetch PR reviews", { repo: repoSlug, prNumber, error: sanitizeCliError(err) });
    return [];
  }
}

interface InlineComment {
  author: string;
  path: string;
  line: number | null;
  body: string;
}

function fetchInlineComments(repoSlug: string, prNumber: number): InlineComment[] {
  try {
    const result = execFileSync(
      "gh",
      ["api", `repos/${repoSlug}/pulls/${prNumber}/comments`, "--paginate", "--jq", "[.[] | {author: .user.login, path: .path, line: (.line // .original_line), body: .body}]"],
      { encoding: "utf-8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    );
    const entries: InlineComment[] = [];
    for (const chunk of result.trim().split("\n")) {
      if (!chunk) continue;
      const page = JSON.parse(chunk);
      if (Array.isArray(page)) {
        for (const c of page) {
          const body = String(c.body ?? "").trim();
          if (!body) continue;
          entries.push({
            author: String(c.author ?? "unknown"),
            path: String(c.path ?? ""),
            line: c.line == null ? null : Number(c.line),
            body,
          });
        }
      }
    }
    return entries.slice(0, MAX_INLINE_COMMENTS);
  } catch (err) {
    log.warn("Failed to fetch inline review comments", { repo: repoSlug, prNumber, error: sanitizeCliError(err) });
    return [];
  }
}

interface DiscussionComment {
  author: string;
  body: string;
}

function fetchDiscussion(repoSlug: string, prNumber: number, botLogin: string | null): DiscussionComment[] {
  try {
    const result = execFileSync(
      "gh",
      ["api", `repos/${repoSlug}/issues/${prNumber}/comments`, "--paginate", "--jq", "[.[] | {author: .user.login, body: .body}]"],
      { encoding: "utf-8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    );
    const entries: DiscussionComment[] = [];
    for (const chunk of result.trim().split("\n")) {
      if (!chunk) continue;
      const page = JSON.parse(chunk);
      if (Array.isArray(page)) {
        for (const c of page) {
          const author = String(c.author ?? "unknown");
          const body = String(c.body ?? "").trim();
          if (!body) continue;
          // Drop the bot's own prior comments (incl. earlier summaries) so it
          // doesn't summarize itself.
          if (botLogin && author.toLowerCase() === botLogin.toLowerCase()) continue;
          entries.push({ author, body });
        }
      }
    }
    return entries.slice(0, MAX_DISCUSSION_COMMENTS);
  } catch (err) {
    log.warn("Failed to fetch PR discussion comments", { repo: repoSlug, prNumber, error: sanitizeCliError(err) });
    return [];
  }
}

function resolveBotLogin(): string | null {
  try {
    return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf-8", timeout: 10000 }).trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt + comment rendering
// ---------------------------------------------------------------------------

function buildPrompt(
  repoSlug: string,
  prNumber: number,
  meta: PRMeta,
  reviews: ReviewEntry[],
  inline: InlineComment[],
  discussion: DiscussionComment[],
): string {
  const parts: string[] = [];
  parts.push(`Follow the \`summary-skill\` skill to summarize this pull request's reviews and discussion.`);
  parts.push("");
  parts.push(`**Repository:** ${repoSlug}`);
  parts.push(`**PR #${prNumber}:** ${meta.title}`);
  parts.push(`**Author:** ${meta.author} · **State:** ${meta.state}`);
  parts.push(`**Diff size:** +${meta.additions} / -${meta.deletions} across ${meta.changedFiles} file(s)`);
  parts.push("");
  if (meta.body.trim()) {
    parts.push("**PR description:**");
    parts.push('"""');
    parts.push(truncate(meta.body.trim(), MAX_BODY_CHARS));
    parts.push('"""');
    parts.push("");
  }

  parts.push(`## Reviews (${reviews.length})`);
  if (reviews.length === 0) {
    parts.push("_(no review bodies)_");
  } else {
    for (const r of reviews) {
      parts.push(`- **@${r.author}** [${r.state || "REVIEW"}]: ${truncate(r.body || "(no body)", MAX_ITEM_BODY_CHARS)}`);
    }
  }
  parts.push("");

  parts.push(`## Inline review comments (${inline.length})`);
  if (inline.length === 0) {
    parts.push("_(none)_");
  } else {
    for (const c of inline) {
      const loc = c.path ? `\`${c.path}${c.line != null ? `:${c.line}` : ""}\`` : "(general)";
      parts.push(`- **@${c.author}** ${loc}: ${truncate(c.body, MAX_ITEM_BODY_CHARS)}`);
    }
  }
  parts.push("");

  parts.push(`## Discussion comments (${discussion.length})`);
  if (discussion.length === 0) {
    parts.push("_(none)_");
  } else {
    for (const c of discussion) {
      parts.push(`- **@${c.author}**: ${truncate(c.body, MAX_ITEM_BODY_CHARS)}`);
    }
  }
  parts.push("");

  parts.push("## Task");
  parts.push(
    "Identify the distinct open action items raised above (merge duplicates, drop resolved points and praise). " +
      "For each, estimate fix_size (small 1-10 LOC / medium 10-100 LOC / large >100 LOC), trigger_probability, " +
      "impact, and derive fix_value. Use `gh pr diff " + prNumber + " --repo " + repoSlug + "` and Read/Grep to " +
      "ground your size estimates in the real code when helpful. Then call `submit_output` with { overview, items, overall }.",
  );
  return parts.join("\n");
}

const FIX_SIZE_LABEL: Record<FixSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

/**
 * Render a concrete fix-size cell like "Medium (~60)" — the bucket name plus the
 * agent's concrete LOC estimate, so the author sees the actual effort at a
 * glance rather than a generic range.
 */
function formatFixSize(item: SummaryItem): string {
  const label = FIX_SIZE_LABEL[item.fix_size] ?? item.fix_size;
  const loc = Number.isFinite(item.fix_size_loc) && item.fix_size_loc > 0 ? Math.round(item.fix_size_loc) : null;
  return loc != null ? `${label} (~${loc})` : label;
}

const RATING_EMOJI: Record<Rating, string> = {
  low: "\u{1F7E2} Low",
  medium: "\u{1F7E1} Medium",
  high: "\u{1F534} High",
};

function renderComment(output: AgentSummaryOutput, meta: PRMeta): string {
  const parts: string[] = [];
  parts.push(`## \u{1F4CB} Discussion Summary`);
  parts.push("");
  parts.push(output.overview.trim());
  parts.push("");

  if (output.items.length > 0) {
    parts.push(`### Action items (${output.items.length})`);
    parts.push("");
    parts.push("| # | Item | Fix size (LOC) | Trigger prob. | Impact | Fix value |");
    parts.push("|---|------|----------------|---------------|--------|-----------|");
    output.items.forEach((item, i) => {
      parts.push(
        `| ${i + 1} | ${escapeCell(item.title)} | ${formatFixSize(item)} | ` +
          `${RATING_EMOJI[item.trigger_probability] ?? item.trigger_probability} | ` +
          `${RATING_EMOJI[item.impact] ?? item.impact} | ${RATING_EMOJI[item.fix_value] ?? item.fix_value} |`,
      );
    });
    parts.push("");
    parts.push("<details><summary>Rationale for each item</summary>");
    parts.push("");
    output.items.forEach((item, i) => {
      parts.push(`${i + 1}. **${item.title}** — ${item.rationale.trim()}`);
    });
    parts.push("");
    parts.push("</details>");
  } else {
    parts.push("_No open action items were raised in the reviews or discussion._");
  }

  parts.push("");
  parts.push(`### Recommendation`);
  parts.push(output.overall.trim());
  parts.push("");
  parts.push("---");
  parts.push(
    `*Fix size = estimated LOC to fix · Fix value = trigger probability × impact · ` +
      `Summary by [RomeOS](https://romeos.io) Code Review.*`,
  );
  return parts.join("\n");
}

/** Escape a value for safe rendering inside a Markdown table cell. */
function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** Best-effort parse of the agent's raw text if it skipped submit_output. */
function parseFallback(raw: string): AgentSummaryOutput | null {
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;
  try {
    const parsed = JSON.parse(jsonStr.trim());
    const data = parsed.output ?? parsed.result ?? parsed;
    if (typeof data.overview !== "string") return null;
    const items: SummaryItem[] = Array.isArray(data.items)
      ? data.items.map((it: any) => {
          const fix_size = normalizeFixSize(it.fix_size);
          return {
            title: String(it.title ?? "Item"),
            fix_size,
            fix_size_loc: normalizeLoc(it.fix_size_loc, fix_size),
            trigger_probability: normalizeRating(it.trigger_probability),
            impact: normalizeRating(it.impact),
            fix_value: normalizeRating(it.fix_value),
            rationale: String(it.rationale ?? ""),
          };
        })
      : [];
    return { overview: String(data.overview), items, overall: String(data.overall ?? "") };
  } catch {
    return null;
  }
}

function normalizeFixSize(value: unknown): FixSize {
  const v = String(value ?? "").toLowerCase();
  return v === "small" || v === "medium" || v === "large" ? v : "medium";
}

/** Bucket midpoint fallback when the agent omits a concrete LOC estimate. */
const FIX_SIZE_FALLBACK_LOC: Record<FixSize, number> = { small: 5, medium: 50, large: 150 };

function normalizeLoc(value: unknown, fixSize: FixSize): number {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return FIX_SIZE_FALLBACK_LOC[fixSize];
}

function normalizeRating(value: unknown): Rating {
  const v = String(value ?? "").toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? v : "medium";
}

// ---------------------------------------------------------------------------
// Action entry point
// ---------------------------------------------------------------------------

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "GitHub repository in owner/repo format" },
        prNumber: { type: "number", description: "PR number to summarize" },
        triggerCommentId: { type: ["number", "null"], description: "Comment id that triggered the summary (for reactions + idempotency)" },
        commentBody: { type: "string", description: "Body of the triggering comment" },
        actorLogin: { type: ["string", "null"], description: "Login that triggered the summary" },
      },
      required: ["repo", "prNumber"],
      additionalProperties: true,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const { repo, prNumber, triggerCommentId = null, commentBody = "", actorLogin = null } = input as SummaryInput;

      if (!repo || typeof prNumber !== "number") {
        return { status: "error", error: "repo and prNumber are required." };
      }
      try {
        validateRepoSlug(repo);
      } catch (err) {
        return { status: "error", error: String(err instanceof Error ? err.message : err) };
      }

      const db = createScanRepository(deps.appContext.db);

      // Idempotency: a webhook redelivery for the same trigger comment must not
      // re-run the summary. Guard on a prior summary task for this comment.
      if (triggerCommentId != null && db.hasMentionTaskForComment(repo, triggerCommentId, "summary")) {
        log.info("Summary already handled for comment; skipping redelivery", { repo, triggerCommentId });
        return { status: "ok", data: { skipped: "already-handled", repo, prNumber, triggerCommentId } };
      }

      const task = db.createMentionTask({
        repo,
        surface: "pr",
        number: prNumber,
        triggerCommentId,
        actorLogin: actorLogin ?? null,
        intent: "summary",
        commentBody: commentBody || null,
      });

      // Opening ack: 👀 on the PR + the trigger comment.
      const eyes: ReactionHandle[] = [];
      const prEyes = addIssueReaction(repo, prNumber, "eyes");
      if (prEyes) eyes.push(prEyes);
      if (triggerCommentId != null) {
        const commentEyes = addCommentReaction(repo, triggerCommentId, "eyes");
        if (commentEyes) eyes.push(commentEyes);
      }

      try {
        db.updateMentionTaskStage(task.id, "running");

        const botLogin = resolveBotLogin();
        let meta: PRMeta;
        try {
          meta = fetchPRMeta(repo, prNumber);
        } catch (err) {
          const msg = `Failed to fetch PR #${prNumber} from ${repo}: ${sanitizeCliError(err)}`;
          db.failMentionTask(task.id, msg);
          return { status: "error", error: msg };
        }

        const reviews = fetchReviews(repo, prNumber);
        const inline = fetchInlineComments(repo, prNumber);
        const discussion = fetchDiscussion(repo, prNumber, botLogin);
        log.info("Gathered PR discussion for summary", {
          repo, prNumber, reviews: reviews.length, inline: inline.length, discussion: discussion.length,
        });

        const prompt = buildPrompt(repo, prNumber, meta, reviews, inline, discussion);

        const invocation = deps.appContext.invokeAction<SummonSessionStartedEvent, SummonOutput>(
          "system:summon",
          { agentName: "code-review:code-review-summarizer", prompt },
        );

        const pump = (async () => {
          for await (const ev of invocation.events) {
            if (ev.type === "rome_session_started" && ev.romeSession) {
              try { db.setMentionTaskRomeSession(task.id, ev.romeSession); } catch { /* best-effort */ }
            }
          }
        })().catch(() => {});
        void pump;

        const res = await invocation.result;
        if (res.status !== "ok") {
          const msg = res.status === "error" ? res.error : `Summarizer agent ended with status "${res.status}".`;
          db.failMentionTask(task.id, msg);
          return { status: "error", error: msg };
        }
        if (res.data?.romeSession) {
          try { db.setMentionTaskRomeSession(task.id, res.data.romeSession); } catch { /* best-effort */ }
        }

        let output: AgentSummaryOutput | null = null;
        if (res.data?.output && typeof res.data.output === "object") {
          output = res.data.output as AgentSummaryOutput;
        } else if (res.data?.result?.trim()) {
          output = parseFallback(res.data.result);
        }
        if (!output || typeof output.overview !== "string") {
          db.failMentionTask(task.id, "Summarizer returned an empty or unparseable result.");
          return { status: "error", error: "Summarizer returned an empty or unparseable result." };
        }
        // Normalize to guard against loose enum values from the fallback path.
        output = {
          overview: output.overview,
          overall: output.overall ?? "",
          items: (output.items ?? []).map((it) => {
            const fix_size = normalizeFixSize(it.fix_size);
            return {
              title: String(it.title ?? "Item"),
              fix_size,
              fix_size_loc: normalizeLoc(it.fix_size_loc, fix_size),
              trigger_probability: normalizeRating(it.trigger_probability),
              impact: normalizeRating(it.impact),
              fix_value: normalizeRating(it.fix_value),
              rationale: String(it.rationale ?? ""),
            };
          }),
        };

        if (db.isMentionTaskCancelled(task.id)) {
          return { status: "ok", data: { status: "cancelled", taskId: task.id } };
        }

        db.updateMentionTaskStage(task.id, "posting");
        const url = postIssueComment(repo, prNumber, renderComment(output, meta));
        if (!url) {
          db.failMentionTask(task.id, "Failed to post summary comment to GitHub.");
          return { status: "error", error: "Failed to post summary comment to GitHub." };
        }
        if (triggerCommentId != null) {
          try { addCommentReaction(repo, triggerCommentId, "rocket"); } catch { /* best-effort */ }
        }
        db.completeMentionTask(task.id, { kind: "summary", url, itemCount: output.items.length });

        log.info("Posted PR summary", { repo, prNumber, url, items: output.items.length });
        return {
          status: "ok",
          data: { status: "completed", taskId: task.id, repo, prNumber, url, itemCount: output.items.length },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.failMentionTask(task.id, msg);
        log.error("PR summary failed", { repo, prNumber, error: msg });
        return { status: "error", error: msg };
      } finally {
        for (const handle of eyes) removeReaction(repo, handle);
      }
    },
  };
}
