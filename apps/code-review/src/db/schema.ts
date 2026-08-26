import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "repo_guardian") {
  const repositories = sqliteTable(`${tablePrefix}__repositories`, {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    name: text("name").notNull(),
    addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
  });

  const prReviews = sqliteTable(`${tablePrefix}__pr_reviews`, {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    prUrl: text("pr_url").notNull(),
    prTitle: text("pr_title").notNull(),
    prAuthor: text("pr_author"),
    headSha: text("head_sha"),
    status: text("status").notNull().default("pending"),
    stageHistory: text("stage_history"),
    reviewComment: text("review_comment"),
    githubCommentUrl: text("github_comment_url"),
    /** JSON-serialized opaque RomeSessionRef of the summoned review agent session. */
    romeSession: text("rome_session"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  });

  const prReviewSettings = sqliteTable(`${tablePrefix}__pr_review_settings`, {
    id: text("id").primaryKey(),
    repo: text("repo").notNull().unique(),
    autoReviewEnabled: integer("auto_review_enabled").notNull().default(0),
    triggerOnCreate: integer("trigger_on_create").notNull().default(1),
    triggerOnRequest: integer("trigger_on_request").notNull().default(1),
    triggerOnReviewRequest: integer("trigger_on_review_request").notNull().default(1),
    triggerOnMention: integer("trigger_on_mention").notNull().default(1),
    triggerOnPush: integer("trigger_on_push").notNull().default(1),
    manualTriggerAllowlist: text("manual_trigger_allowlist"),
    mentionTriggerPhrase: text("mention_trigger_phrase").notNull().default("PTAL"),
    /**
     * Per-repo phrase that, when a PR comment @-mentions the bot and carries it,
     * triggers the discussion-summary flow (a plain comment recapping the PR's
     * reviews/discussion with a fix-size + fix-value assessment). Mirrors
     * mentionTriggerPhrase (PTAL) but routes to the pr-summary action.
     */
    summaryTriggerPhrase: text("summary_trigger_phrase").notNull().default("summary"),
    customRules: text("custom_rules"),
    /**
     * Per-repo project memory: a short knowledge cache injected into every
     * review's prompt (alongside customRules). Written through the
     * update_project_memory action by both the agent (feedback handling) and
     * the dashboard "Save" button. See docs/agentic-code-review-design.md §5.
     */
    projectMemory: text("project_memory"),
    webhookChannelUrl: text("webhook_channel_url"),
    githubWebhookId: text("github_webhook_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  /**
   * Chassis task rows for the new (additive) mention-handling flow. One row per
   * atomic durable task fanned out from a single GitHub mention/comment. Carries
   * the target identity (resolved server-side by submit-actions from the task
   * id, which is the opaque task token) plus stage history for durability.
   * See docs/agentic-code-review-design.md §3 (chassis) and §8 (durability).
   */
  const mentionTasks = sqliteTable(`${tablePrefix}__mention_tasks`, {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    /** "pr" | "issue" — the GitHub surface the trigger came from. */
    surface: text("surface").notNull(),
    /** PR or issue number the task acts on. */
    number: integer("number").notNull(),
    /** PR head SHA when the surface is a PR (used for code-task branch work). */
    headSha: text("head_sha"),
    /** The comment id that triggered this task (for eyes reaction + idempotency). */
    triggerCommentId: integer("trigger_comment_id"),
    /** GitHub login that authored the triggering comment. */
    actorLogin: text("actor_login"),
    /** Resolved intent for this atomic task: update-memory | code-task | general | none. */
    intent: text("intent").notNull(),
    /** Raw triggering comment body, for the handler agent's context. */
    commentBody: text("comment_body"),
    status: text("status").notNull().default("queued"),
    stageHistory: text("stage_history"),
    /** JSON result reference produced by the landing submit-action (url, prUrl, ...). */
    resultRef: text("result_ref"),
    /** JSON-serialized opaque RomeSessionRef of the summoned handler agent session. */
    romeSession: text("rome_session"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  });

  /**
   * Append-only audit trail of every project-memory change (agent or user).
   * Ties the whole feedback chain together: which mention task caused which
   * memory edit. See docs/agentic-code-review-design.md §5②.
   */
  const memoryEdits = sqliteTable(`${tablePrefix}__memory_edits`, {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    /** Links the mention task that produced this edit (null for manual UI edits). */
    taskId: text("task_id"),
    /** "pr_feedback" | "issue_feedback" | "manual_ui" | ... */
    source: text("source").notNull(),
    /** prNumber / commentId, or "dashboard". */
    sourceRef: text("source_ref"),
    /** "agent" | "user". */
    actor: text("actor").notNull(),
    /** Snapshot of projectMemory before the edit. */
    before: text("before"),
    /** Snapshot of projectMemory after the edit. */
    after: text("after"),
    /** One-line plain-words summary of what changed. */
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  return { repositories, prReviews, prReviewSettings, mentionTasks, memoryEdits };
}

const defaultSchema = createAppDbSchema();
export const repositories = defaultSchema.repositories;
export const prReviews = defaultSchema.prReviews;
export const prReviewSettings = defaultSchema.prReviewSettings;
export const mentionTasks = defaultSchema.mentionTasks;
export const memoryEdits = defaultSchema.memoryEdits;
