import type { AppDbContext, DrizzleDb, RomeSessionRef } from "@rome-os/app-runtime";

export interface Repository {
  id: string;
  url: string;
  name: string;
  addedAt: string;
}

export interface PRReview {
  id: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prAuthor: string | null;
  headSha: string | null;
  status: string;
  stageHistory: string | null;
  reviewComment: string | null;
  githubCommentUrl: string | null;
  /** Opaque durable Rome session of the summoned review agent, when available. */
  romeSession: RomeSessionRef | null;
  startedAt: string;
  completedAt: string | null;
}

/** Per-repo dashboard aggregate for the repo cards (count + last-activity + sparkline). */
export interface RepoStat {
  reviewCount: number;
  lastActivityAt: string | null;
  /** Daily review counts, oldest→newest, for the sparkline. */
  trend: number[];
}

const ACTIVE_PR_REVIEW_STATUSES = [
  "queued",
  "fetching_pr_info",
  "pending",
  "cloning",
  "reviewing",
  "posting",
  "running",
] as const;

export interface PRReviewSettings {
  id: string;
  repo: string;
  autoReviewEnabled: boolean;
  triggerOnCreate: boolean;
  triggerOnRequest: boolean;
  triggerOnReviewRequest: boolean;
  triggerOnMention: boolean;
  triggerOnPush: boolean;
  triggerAllowlist: string[];
  manualTriggerAllowlist: string[];
  mentionTriggerPhrase: string;
  summaryTriggerPhrase: string;
  customRules: string | null;
  projectMemory: string | null;
  webhookChannelUrl: string | null;
  githubWebhookId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A chassis task row for the new mention-handling flow. */
export interface MentionTask {
  id: string;
  repo: string;
  surface: "pr" | "issue";
  number: number;
  headSha: string | null;
  triggerCommentId: number | null;
  actorLogin: string | null;
  intent: string;
  commentBody: string | null;
  status: string;
  stageHistory: string | null;
  resultRef: string | null;
  romeSession: RomeSessionRef | null;
  createdAt: string;
  completedAt: string | null;
}

const ACTIVE_MENTION_TASK_STATUSES = [
  "queued",
  "running",
  "posting",
] as const;

/** An append-only project-memory audit row. */
export interface MemoryEdit {
  id: string;
  repo: string;
  taskId: string | null;
  source: string;
  sourceRef: string | null;
  actor: string;
  before: string | null;
  after: string | null;
  summary: string | null;
  createdAt: string;
}

/**
 * Raw-SQL repository that avoids importing drizzle-orm directly.
 * Uses the underlying better-sqlite3 driver exposed by DrizzleDb.
 */
export class ScanRepository {
  private readonly prefix: string;
  private readonly driver: any;

  constructor(db: DrizzleDb, tablePrefix: string) {
    this.prefix = tablePrefix;
    this.driver = (db as any).session?.client ?? (db as any)._db ?? (db as any);
  }

  private run(sql: string, params: any[] = []): void {
    this.driver.prepare(sql).run(...params);
  }

  private all<T = any>(sql: string, params: any[] = []): T[] {
    return this.driver.prepare(sql).all(...params) as T[];
  }

  private get<T = any>(sql: string, params: any[] = []): T | undefined {
    return this.driver.prepare(sql).get(...params) as T | undefined;
  }

  private t(name: string): string {
    return `${this.prefix}__${name}`;
  }

  private prReviewSelectColumns(): string {
    return "id, repo, pr_number as prNumber, pr_url as prUrl, pr_title as prTitle, pr_author as prAuthor, head_sha as headSha, status, stage_history as stageHistory, review_comment as reviewComment, github_comment_url as githubCommentUrl, rome_session as romeSession, started_at as startedAt, completed_at as completedAt";
  }

  /**
   * Parse the JSON-serialized `rome_session` column into an opaque
   * RomeSessionRef. Rows come back with `romeSession` as a JSON string (or
   * null); callers get the parsed object so the web layer can pass it straight
   * to `navigateRome({ path: "session", session })`.
   */
  private hydratePRReviewRow(row: any): PRReview {
    let romeSession: RomeSessionRef | null = null;
    const raw = row?.romeSession;
    if (typeof raw === "string" && raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && typeof parsed._romeSessionId === "string") {
          romeSession = parsed as RomeSessionRef;
        }
      } catch {
        romeSession = null;
      }
    } else if (raw && typeof raw === "object") {
      romeSession = raw as RomeSessionRef;
    }
    return { ...row, romeSession };
  }

  private hydratePRReview(row: any): PRReview | undefined {
    return row ? this.hydratePRReviewRow(row) : undefined;
  }

  private normalizeGitHubLogin(login: unknown): string | null {
    if (typeof login !== "string") return null;
    const normalized = login.trim().replace(/^@+/, "").toLowerCase();
    return normalized ? normalized : null;
  }

  private sanitizeLoginList(value: unknown): string[] {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[\s,]+/)
        : [];
    const seen = new Set<string>();
    const logins: string[] = [];
    for (const item of rawItems) {
      const login = this.normalizeGitHubLogin(item);
      if (!login || seen.has(login)) continue;
      seen.add(login);
      logins.push(login);
    }
    return logins;
  }

  private parseLoginList(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      return this.sanitizeLoginList(JSON.parse(raw));
    } catch {
      return this.sanitizeLoginList(raw);
    }
  }

  private serializeLoginList(value: unknown): string {
    return JSON.stringify(this.sanitizeLoginList(value));
  }

  private normalizeMentionPhrase(value: unknown): string {
    if (typeof value !== "string") return "PTAL";
    const phrase = value.trim();
    return phrase || "PTAL";
  }

  private normalizeSummaryPhrase(value: unknown): string {
    if (typeof value !== "string") return "summary";
    const phrase = value.trim();
    return phrase || "summary";
  }

  private newStageHistory(stage: string): string {
    return JSON.stringify([{ stage, time: Date.now() }]);
  }

  private appendStageHistory(id: string, stage: string): string {
    const row = this.get<{ stageHistory: string | null }>(
      `SELECT stage_history as stageHistory FROM "${this.t("pr_reviews")}" WHERE id = ?`,
      [id],
    );
    let history: Array<{ stage: string; time: number }> = [];
    if (row?.stageHistory) {
      try {
        const parsed = JSON.parse(row.stageHistory);
        if (Array.isArray(parsed)) {
          history = parsed.filter(
            (entry): entry is { stage: string; time: number } =>
              typeof entry?.stage === "string" && typeof entry?.time === "number",
          );
        }
      } catch {
        history = [];
      }
    }
    history.push({ stage, time: Date.now() });
    return JSON.stringify(history);
  }

  // --- Repositories ---

  addRepository(url: string, name: string): Repository {
    const id = crypto.randomUUID();
    const addedAt = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("repositories")}" (id, url, name, added_at) VALUES (?, ?, ?, ?)`,
      [id, url, name, addedAt],
    );
    return { id, url, name, addedAt };
  }

  removeRepository(id: string): void {
    this.run(`DELETE FROM "${this.t("repositories")}" WHERE id = ?`, [id]);
  }

  listRepositories(): Repository[] {
    return this.all<any>(
      `SELECT id, url, name, added_at as addedAt FROM "${this.t("repositories")}" ORDER BY added_at DESC`,
    );
  }

  getRepository(id: string): Repository | undefined {
    return this.get<any>(
      `SELECT id, url, name, added_at as addedAt FROM "${this.t("repositories")}" WHERE id = ?`,
      [id],
    );
  }

  // --- PR Reviews ---

  private selectPRReviewById(id: string): PRReview | undefined {
    return this.hydratePRReview(
      this.get<any>(
        `SELECT ${this.prReviewSelectColumns()} FROM "${this.t("pr_reviews")}" WHERE id = ?`,
        [id],
      ),
    );
  }

  createQueuedPRReview(review: {
    repo: string;
    prNumber: number;
    prUrl?: string | null;
    prTitle?: string | null;
    prAuthor?: string | null;
    headSha?: string | null;
  }): PRReview {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const prUrl = review.prUrl || `https://github.com/${review.repo}/pull/${review.prNumber}`;
    const prTitle = review.prTitle || `PR #${review.prNumber}`;
    const stageHistory = this.newStageHistory("queued");
    this.run(
      `INSERT INTO "${this.t("pr_reviews")}" (id, repo, pr_number, pr_url, pr_title, pr_author, head_sha, status, stage_history, review_comment, github_comment_url, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        review.repo,
        review.prNumber,
        prUrl,
        prTitle,
        review.prAuthor ?? null,
        review.headSha ?? null,
        "queued",
        stageHistory,
        null,
        null,
        startedAt,
        null,
      ],
    );
    return {
      id,
      repo: review.repo,
      prNumber: review.prNumber,
      prUrl,
      prTitle,
      prAuthor: review.prAuthor ?? null,
      headSha: review.headSha ?? null,
      status: "queued",
      stageHistory,
      reviewComment: null,
      githubCommentUrl: null,
      romeSession: null,
      startedAt,
      completedAt: null,
    };
  }

  updatePRReviewStage(id: string, status: string, message?: string | null): PRReview | undefined {
    if (this.isPRReviewCancelled(id)) return this.selectPRReviewById(id);
    const stageHistory = this.appendStageHistory(id, status);
    if (message !== undefined) {
      this.run(
        `UPDATE "${this.t("pr_reviews")}" SET status = ?, stage_history = ?, review_comment = ? WHERE id = ? AND status <> 'cancelled'`,
        [status, stageHistory, message, id],
      );
    } else {
      this.run(
        `UPDATE "${this.t("pr_reviews")}" SET status = ?, stage_history = ? WHERE id = ? AND status <> 'cancelled'`,
        [status, stageHistory, id],
      );
    }
    return this.selectPRReviewById(id);
  }

  isPRReviewCancelled(id: string): boolean {
    const row = this.get<{ status: string }>(
      `SELECT status FROM "${this.t("pr_reviews")}" WHERE id = ?`,
      [id],
    );
    return row?.status === "cancelled";
  }

  cancelPRReview(id: string, message: string = "Review cancelled by user."): PRReview | undefined {
    const current = this.selectPRReviewById(id);
    if (!current) return undefined;
    if (current.status === "cancelled") return current;
    if (!ACTIVE_PR_REVIEW_STATUSES.includes(current.status as any)) return current;

    const completedAt = new Date().toISOString();
    const stageHistory = this.appendStageHistory(id, "cancelled");
    this.run(
      `UPDATE "${this.t("pr_reviews")}"
       SET status = ?, stage_history = ?, review_comment = ?, completed_at = ?
       WHERE id = ?
         AND status IN (${ACTIVE_PR_REVIEW_STATUSES.map(() => "?").join(", ")})`,
      ["cancelled", stageHistory, message, completedAt, id, ...ACTIVE_PR_REVIEW_STATUSES],
    );
    return this.selectPRReviewById(id);
  }

  claimQueuedPRReview(
    id: string,
    review: Omit<PRReview, "id" | "status" | "stageHistory" | "reviewComment" | "githubCommentUrl" | "romeSession" | "startedAt" | "completedAt">,
  ): PRReview | null {
    const stageHistory = this.appendStageHistory(id, "pending");
    const stmt = this.driver.prepare(
      `UPDATE "${this.t("pr_reviews")}"
       SET repo = ?, pr_number = ?, pr_url = ?, pr_title = ?, pr_author = ?, head_sha = ?, status = ?, stage_history = ?, review_comment = ?, github_comment_url = ?, completed_at = ?
       WHERE id = ?
         AND status IN ('queued', 'fetching_pr_info')
         AND NOT EXISTS (
           SELECT 1 FROM "${this.t("pr_reviews")}"
           WHERE repo = ?
             AND pr_number = ?
             AND head_sha = ?
             -- Only an IN-PROGRESS review of the same commit blocks a new claim.
             -- A previously 'completed' review no longer blocks: a fresh PTAL on
             -- the same commit re-triggers a review (the old one is collapsed /
             -- superseded by the re-review path).
             AND status IN ('pending', 'cloning', 'reviewing', 'posting')
             AND id <> ?
         )`,
    );
    const result = stmt.run(
      review.repo,
      review.prNumber,
      review.prUrl,
      review.prTitle,
      review.prAuthor ?? null,
      review.headSha ?? null,
      "pending",
      stageHistory,
      null,
      null,
      null,
      id,
      review.repo,
      review.prNumber,
      review.headSha ?? null,
      id,
    );
    if (result.changes === 0) return null;
    return this.selectPRReviewById(id) ?? null;
  }

  skipPRReview(id: string, message: string): void {
    if (this.isPRReviewCancelled(id)) return;
    const completedAt = new Date().toISOString();
    const stageHistory = this.appendStageHistory(id, "skipped");
    this.run(
      `UPDATE "${this.t("pr_reviews")}" SET status = ?, stage_history = ?, review_comment = ?, completed_at = ? WHERE id = ? AND status <> 'cancelled'`,
      ["skipped", stageHistory, message, completedAt, id],
    );
  }

  /**
   * Fail every review still stuck in a non-terminal ("active") state whose start
   * is older than maxAgeMs. A detached review cannot outlive a process restart,
   * and a wedged claim/clone can otherwise strand a row forever with no catch to
   * fail it — leaving a stale in-progress row that blocks a fresh review of the
   * same commit. This sweep is the backstop; callers run it opportunistically
   * (e.g. on each inbound webhook) so stale rows get cleared right when a new
   * review is about to be claimed. Returns the number of rows reaped.
   */
  reapStaleActiveReviews(maxAgeMs = 30 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const completedAt = new Date().toISOString();
    const placeholders = ACTIVE_PR_REVIEW_STATUSES.map(() => "?").join(", ");
    const result = this.driver
      .prepare(
        `UPDATE "${this.t("pr_reviews")}"
           SET status = 'failed',
               review_comment = COALESCE(review_comment, ?),
               completed_at = ?
         WHERE status IN (${placeholders})
           AND started_at < ?`,
      )
      .run(
        "Interrupted — review did not finish and was auto-failed as stale.",
        completedAt,
        ...ACTIVE_PR_REVIEW_STATUSES,
        cutoff,
      );
    return Number(result?.changes ?? 0);
  }

  createFailedPRReview(
    review: Omit<PRReview, "id" | "status" | "stageHistory" | "reviewComment" | "githubCommentUrl" | "romeSession" | "startedAt" | "completedAt">,
    error: string,
  ): PRReview {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stageHistory = this.newStageHistory("failed");
    this.run(
      `INSERT INTO "${this.t("pr_reviews")}" (id, repo, pr_number, pr_url, pr_title, pr_author, head_sha, status, stage_history, review_comment, github_comment_url, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        review.repo,
        review.prNumber,
        review.prUrl,
        review.prTitle,
        review.prAuthor ?? null,
        review.headSha ?? null,
        "failed",
        stageHistory,
        error,
        null,
        now,
        now,
      ],
    );
    return {
      id,
      ...review,
      prAuthor: review.prAuthor ?? null,
      headSha: review.headSha ?? null,
      status: "failed",
      stageHistory,
      reviewComment: error,
      githubCommentUrl: null,
      romeSession: null,
      startedAt: now,
      completedAt: now,
    };
  }

  completePRReview(id: string, reviewComment: string, githubCommentUrl: string | null): void {
    if (this.isPRReviewCancelled(id)) return;
    const completedAt = new Date().toISOString();
    const stageHistory = this.appendStageHistory(id, "completed");
    this.run(
      `UPDATE "${this.t("pr_reviews")}" SET status = ?, stage_history = ?, review_comment = ?, github_comment_url = ?, completed_at = ? WHERE id = ? AND status <> 'cancelled'`,
      ["completed", stageHistory, reviewComment, githubCommentUrl, completedAt, id],
    );
  }

  failPRReview(id: string, error: string): void {
    if (this.isPRReviewCancelled(id)) return;
    const completedAt = new Date().toISOString();
    const stageHistory = this.appendStageHistory(id, "failed");
    this.run(
      `UPDATE "${this.t("pr_reviews")}" SET status = ?, stage_history = ?, review_comment = ?, completed_at = ? WHERE id = ? AND status <> 'cancelled'`,
      ["failed", stageHistory, error, completedAt, id],
    );
  }

  listPRReviews(limit: number = 30, offset: number = 0): PRReview[] {
    return this.all<any>(
      `SELECT ${this.prReviewSelectColumns()} FROM "${this.t("pr_reviews")}" ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    ).map((row) => this.hydratePRReviewRow(row));
  }

  countPRReviews(): number {
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${this.t("pr_reviews")}"`,
    );
    return row?.count ?? 0;
  }

  listPRReviewsByRepo(repo: string, limit: number = 30): PRReview[] {
    return this.all<any>(
      `SELECT ${this.prReviewSelectColumns()} FROM "${this.t("pr_reviews")}" WHERE repo = ? ORDER BY started_at DESC LIMIT ?`,
      [repo, limit],
    ).map((row) => this.hydratePRReviewRow(row));
  }

  /**
   * Per-repo dashboard aggregates: total PR-review count, the most recent review
   * time, and a daily-bucketed trend series (oldest→newest) over the last
   * `days` days for the repo-card sparkline. Computed with two grouped queries
   * (totals + per-day buckets) rather than N per-repo scans. `started_at` is an
   * ISO-8601 string, so `substr(started_at, 1, 10)` yields the `YYYY-MM-DD` day
   * key without any date-math functions.
   */
  getRepoStats(days: number = 14): Record<string, RepoStat> {
    const span = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 90) : 14;

    const totals = this.all<{ repo: string; reviewCount: number; lastActivityAt: string | null }>(
      `SELECT repo, COUNT(*) as reviewCount, MAX(started_at) as lastActivityAt FROM "${this.t("pr_reviews")}" GROUP BY repo`,
    );

    // Build the ordered list of day keys we want a bucket for (oldest first).
    const dayKeys: string[] = [];
    const today = new Date();
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const sinceKey = dayKeys[0];

    const buckets = this.all<{ repo: string; day: string; c: number }>(
      `SELECT repo, substr(started_at, 1, 10) as day, COUNT(*) as c
       FROM "${this.t("pr_reviews")}"
       WHERE substr(started_at, 1, 10) >= ?
       GROUP BY repo, day`,
      [sinceKey],
    );

    const byRepoDay = new Map<string, Map<string, number>>();
    for (const b of buckets) {
      let m = byRepoDay.get(b.repo);
      if (!m) {
        m = new Map<string, number>();
        byRepoDay.set(b.repo, m);
      }
      m.set(b.day, Number(b.c) || 0);
    }

    const stats: Record<string, RepoStat> = {};
    for (const t of totals) {
      const dayMap = byRepoDay.get(t.repo);
      const trend = dayKeys.map((k) => dayMap?.get(k) ?? 0);
      stats[t.repo] = {
        reviewCount: Number(t.reviewCount) || 0,
        lastActivityAt: t.lastActivityAt ?? null,
        trend,
      };
    }
    return stats;
  }

  /**
   * Persist the summoned review agent's opaque Rome session so the UI can deep
   * link to the live agent session. Serialized as JSON; never overwrites a
   * cancelled review's row.
   */
  setPRReviewRomeSession(id: string, romeSession: RomeSessionRef): void {
    this.run(
      `UPDATE "${this.t("pr_reviews")}" SET rome_session = ? WHERE id = ?`,
      [JSON.stringify(romeSession), id],
    );
  }

  getPRReview(id: string): PRReview | undefined {
    return this.selectPRReviewById(id);
  }

  getPRReviewByPR(repo: string, prNumber: number): PRReview | undefined {
    return this.hydratePRReview(
      this.get<any>(
        `SELECT ${this.prReviewSelectColumns()} FROM "${this.t("pr_reviews")}" WHERE repo = ? AND pr_number = ? ORDER BY started_at DESC LIMIT 1`,
        [repo, prNumber],
      ),
    );
  }

  getPreviousCompletedPRReviewByPR(repo: string, prNumber: number, excludeId: string): PRReview | undefined {
    return this.hydratePRReview(
      this.get<any>(
        `SELECT ${this.prReviewSelectColumns()} FROM "${this.t("pr_reviews")}" WHERE repo = ? AND pr_number = ? AND id <> ? AND status = 'completed' AND github_comment_url IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
        [repo, prNumber, excludeId],
      ),
    );
  }

  // --- PR Review Settings ---

  getPRReviewSettings(repo: string): PRReviewSettings | undefined {
    const row = this.get<any>(
      `SELECT id, repo, auto_review_enabled as autoReviewEnabled, trigger_on_create as triggerOnCreate, trigger_on_request as triggerOnRequest, trigger_on_review_request as triggerOnReviewRequest, trigger_on_mention as triggerOnMention, trigger_on_push as triggerOnPush, manual_trigger_allowlist as triggerAllowlist, mention_trigger_phrase as mentionTriggerPhrase, summary_trigger_phrase as summaryTriggerPhrase, custom_rules as customRules, project_memory as projectMemory, webhook_channel_url as webhookChannelUrl, github_webhook_id as githubWebhookId, created_at as createdAt, updated_at as updatedAt FROM "${this.t("pr_review_settings")}" WHERE repo = ?`,
      [repo],
    );
    if (!row) return undefined;
    const triggerAllowlist = this.parseLoginList(row.triggerAllowlist);
    return {
      ...row,
      autoReviewEnabled: !!row.autoReviewEnabled,
      triggerOnCreate: !!row.triggerOnCreate,
      triggerOnRequest: !!row.triggerOnRequest,
      triggerOnReviewRequest: row.triggerOnReviewRequest === undefined ? !!row.triggerOnRequest : !!row.triggerOnReviewRequest,
      triggerOnMention: row.triggerOnMention === undefined ? !!row.triggerOnRequest : !!row.triggerOnMention,
      triggerOnPush: !!row.triggerOnPush,
      triggerAllowlist,
      manualTriggerAllowlist: triggerAllowlist,
      mentionTriggerPhrase: this.normalizeMentionPhrase(row.mentionTriggerPhrase),
      summaryTriggerPhrase: this.normalizeSummaryPhrase(row.summaryTriggerPhrase),
      projectMemory: row.projectMemory ?? null,
      githubWebhookId: row.githubWebhookId ?? null,
    };
  }

  upsertPRReviewSettings(repo: string, settings: { autoReviewEnabled?: boolean; triggerOnCreate?: boolean; triggerOnRequest?: boolean; triggerOnReviewRequest?: boolean; triggerOnMention?: boolean; triggerOnPush?: boolean; triggerAllowlist?: unknown; manualTriggerAllowlist?: unknown; mentionTriggerPhrase?: string | null; summaryTriggerPhrase?: string | null; customRules?: string | null; projectMemory?: string | null; webhookChannelUrl?: string | null; githubWebhookId?: string | null }): PRReviewSettings {
    const existing = this.getPRReviewSettings(repo);
    const now = new Date().toISOString();

    if (existing) {
      const autoReview = settings.autoReviewEnabled !== undefined ? settings.autoReviewEnabled : existing.autoReviewEnabled;
      const onCreate = settings.triggerOnCreate !== undefined ? settings.triggerOnCreate : existing.triggerOnCreate;
      const onRequest = settings.triggerOnRequest !== undefined ? settings.triggerOnRequest : existing.triggerOnRequest;
      const onReviewRequest = settings.triggerOnReviewRequest !== undefined ? settings.triggerOnReviewRequest : existing.triggerOnReviewRequest;
      const onMention = settings.triggerOnMention !== undefined ? settings.triggerOnMention : existing.triggerOnMention;
      const onPush = settings.triggerOnPush !== undefined ? settings.triggerOnPush : existing.triggerOnPush;
      const triggerAllowlistInput = settings.triggerAllowlist !== undefined ? settings.triggerAllowlist : settings.manualTriggerAllowlist;
      const triggerAllowlist = triggerAllowlistInput !== undefined ? this.sanitizeLoginList(triggerAllowlistInput) : existing.triggerAllowlist;
      const triggerAllowlistRaw = this.serializeLoginList(triggerAllowlist);
      const mentionPhrase = settings.mentionTriggerPhrase !== undefined ? this.normalizeMentionPhrase(settings.mentionTriggerPhrase) : existing.mentionTriggerPhrase;
      const summaryPhrase = settings.summaryTriggerPhrase !== undefined ? this.normalizeSummaryPhrase(settings.summaryTriggerPhrase) : existing.summaryTriggerPhrase;
      const rules = settings.customRules !== undefined ? settings.customRules : existing.customRules;
      const memory = settings.projectMemory !== undefined ? settings.projectMemory : existing.projectMemory;
      const webhook = settings.webhookChannelUrl !== undefined ? settings.webhookChannelUrl : existing.webhookChannelUrl;
      const webhookId = settings.githubWebhookId !== undefined ? settings.githubWebhookId : existing.githubWebhookId;
      this.run(
        `UPDATE "${this.t("pr_review_settings")}" SET auto_review_enabled = ?, trigger_on_create = ?, trigger_on_request = ?, trigger_on_review_request = ?, trigger_on_mention = ?, trigger_on_push = ?, manual_trigger_allowlist = ?, mention_trigger_phrase = ?, summary_trigger_phrase = ?, custom_rules = ?, project_memory = ?, webhook_channel_url = ?, github_webhook_id = ?, updated_at = ? WHERE id = ?`,
        [autoReview ? 1 : 0, onCreate ? 1 : 0, onRequest ? 1 : 0, onReviewRequest ? 1 : 0, onMention ? 1 : 0, onPush ? 1 : 0, triggerAllowlistRaw, mentionPhrase, summaryPhrase, rules, memory, webhook, webhookId, now, existing.id],
      );
      return { ...existing, autoReviewEnabled: !!autoReview, triggerOnCreate: !!onCreate, triggerOnRequest: !!onRequest, triggerOnReviewRequest: !!onReviewRequest, triggerOnMention: !!onMention, triggerOnPush: !!onPush, triggerAllowlist, manualTriggerAllowlist: triggerAllowlist, mentionTriggerPhrase: mentionPhrase, summaryTriggerPhrase: summaryPhrase, customRules: rules ?? null, projectMemory: memory ?? null, webhookChannelUrl: webhook ?? null, githubWebhookId: webhookId ?? null, updatedAt: now };
    }

    const id = crypto.randomUUID();
    const autoReview = settings.autoReviewEnabled ?? false;
    const onCreate = settings.triggerOnCreate ?? true;
    const onRequest = settings.triggerOnRequest ?? true;
    const onReviewRequest = settings.triggerOnReviewRequest ?? true;
    const onMention = settings.triggerOnMention ?? true;
    const onPush = settings.triggerOnPush ?? true;
    const triggerAllowlistInput = settings.triggerAllowlist !== undefined ? settings.triggerAllowlist : settings.manualTriggerAllowlist;
    const triggerAllowlist = this.sanitizeLoginList(triggerAllowlistInput);
    const triggerAllowlistRaw = this.serializeLoginList(triggerAllowlist);
    const mentionPhrase = this.normalizeMentionPhrase(settings.mentionTriggerPhrase);
    const summaryPhrase = this.normalizeSummaryPhrase(settings.summaryTriggerPhrase);
    const rules = settings.customRules ?? null;
    const memory = settings.projectMemory ?? null;
    const webhook = settings.webhookChannelUrl ?? null;
    const webhookId = settings.githubWebhookId ?? null;
    this.run(
      `INSERT INTO "${this.t("pr_review_settings")}" (id, repo, auto_review_enabled, trigger_on_create, trigger_on_request, trigger_on_review_request, trigger_on_mention, trigger_on_push, manual_trigger_allowlist, mention_trigger_phrase, summary_trigger_phrase, custom_rules, project_memory, webhook_channel_url, github_webhook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, repo, autoReview ? 1 : 0, onCreate ? 1 : 0, onRequest ? 1 : 0, onReviewRequest ? 1 : 0, onMention ? 1 : 0, onPush ? 1 : 0, triggerAllowlistRaw, mentionPhrase, summaryPhrase, rules, memory, webhook, webhookId, now, now],
    );
    return { id, repo, autoReviewEnabled: autoReview, triggerOnCreate: onCreate, triggerOnRequest: onRequest, triggerOnReviewRequest: onReviewRequest, triggerOnMention: onMention, triggerOnPush: onPush, triggerAllowlist, manualTriggerAllowlist: triggerAllowlist, mentionTriggerPhrase: mentionPhrase, summaryTriggerPhrase: summaryPhrase, customRules: rules, projectMemory: memory, webhookChannelUrl: webhook, githubWebhookId: webhookId, createdAt: now, updatedAt: now };
  }

  listAllPRReviewSettings(): PRReviewSettings[] {
    return this.all<any>(
      `SELECT id, repo, auto_review_enabled as autoReviewEnabled, trigger_on_create as triggerOnCreate, trigger_on_request as triggerOnRequest, trigger_on_review_request as triggerOnReviewRequest, trigger_on_mention as triggerOnMention, trigger_on_push as triggerOnPush, manual_trigger_allowlist as triggerAllowlist, mention_trigger_phrase as mentionTriggerPhrase, summary_trigger_phrase as summaryTriggerPhrase, custom_rules as customRules, project_memory as projectMemory, webhook_channel_url as webhookChannelUrl, github_webhook_id as githubWebhookId, created_at as createdAt, updated_at as updatedAt FROM "${this.t("pr_review_settings")}" ORDER BY updated_at DESC`,
    ).map((r: any) => ({
      ...r,
      autoReviewEnabled: !!r.autoReviewEnabled,
      triggerOnCreate: !!r.triggerOnCreate,
      triggerOnRequest: !!r.triggerOnRequest,
      triggerOnReviewRequest: r.triggerOnReviewRequest === undefined ? !!r.triggerOnRequest : !!r.triggerOnReviewRequest,
      triggerOnMention: r.triggerOnMention === undefined ? !!r.triggerOnRequest : !!r.triggerOnMention,
      triggerOnPush: !!r.triggerOnPush,
      triggerAllowlist: this.parseLoginList(r.triggerAllowlist),
      manualTriggerAllowlist: this.parseLoginList(r.triggerAllowlist),
      mentionTriggerPhrase: this.normalizeMentionPhrase(r.mentionTriggerPhrase),
      summaryTriggerPhrase: this.normalizeSummaryPhrase(r.summaryTriggerPhrase),
      projectMemory: r.projectMemory ?? null,
      githubWebhookId: r.githubWebhookId ?? null,
    }));
  }

  isAutoReviewEnabled(repo: string): boolean {
    const settings = this.getPRReviewSettings(repo);
    return settings?.autoReviewEnabled ?? false;
  }

  // --- Mention tasks (new flow chassis) ---

  private mentionTaskColumns(): string {
    return "id, repo, surface, number, head_sha as headSha, trigger_comment_id as triggerCommentId, actor_login as actorLogin, intent, comment_body as commentBody, status, stage_history as stageHistory, result_ref as resultRef, rome_session as romeSession, created_at as createdAt, completed_at as completedAt";
  }

  private hydrateMentionTask(row: any): MentionTask | undefined {
    if (!row) return undefined;
    let romeSession: RomeSessionRef | null = null;
    const raw = row.romeSession;
    if (typeof raw === "string" && raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && typeof parsed._romeSessionId === "string") {
          romeSession = parsed as RomeSessionRef;
        }
      } catch {
        romeSession = null;
      }
    }
    return { ...row, romeSession } as MentionTask;
  }

  createMentionTask(task: {
    repo: string;
    surface: "pr" | "issue";
    number: number;
    headSha?: string | null;
    triggerCommentId?: number | null;
    actorLogin?: string | null;
    intent: string;
    commentBody?: string | null;
  }): MentionTask {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const stageHistory = this.newStageHistory("queued");
    this.run(
      `INSERT INTO "${this.t("mention_tasks")}" (id, repo, surface, number, head_sha, trigger_comment_id, actor_login, intent, comment_body, status, stage_history, result_ref, rome_session, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.repo,
        task.surface,
        task.number,
        task.headSha ?? null,
        task.triggerCommentId ?? null,
        task.actorLogin ?? null,
        task.intent,
        task.commentBody ?? null,
        "queued",
        stageHistory,
        null,
        null,
        createdAt,
        null,
      ],
    );
    return {
      id,
      repo: task.repo,
      surface: task.surface,
      number: task.number,
      headSha: task.headSha ?? null,
      triggerCommentId: task.triggerCommentId ?? null,
      actorLogin: task.actorLogin ?? null,
      intent: task.intent,
      commentBody: task.commentBody ?? null,
      status: "queued",
      stageHistory,
      resultRef: null,
      romeSession: null,
      createdAt,
      completedAt: null,
    };
  }

  getMentionTask(id: string): MentionTask | undefined {
    return this.hydrateMentionTask(
      this.get<any>(`SELECT ${this.mentionTaskColumns()} FROM "${this.t("mention_tasks")}" WHERE id = ?`, [id]),
    );
  }

  /**
   * Idempotency guard: has any task already been created for this trigger
   * comment + intent? Prevents webhook redelivery from double-handling.
   */
  hasMentionTaskForComment(repo: string, triggerCommentId: number, intent: string): boolean {
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${this.t("mention_tasks")}" WHERE repo = ? AND trigger_comment_id = ? AND intent = ?`,
      [repo, triggerCommentId, intent],
    );
    return (row?.count ?? 0) > 0;
  }

  /** True when any task already exists for this trigger comment (any intent). */
  hasAnyMentionTaskForComment(repo: string, triggerCommentId: number): boolean {
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${this.t("mention_tasks")}" WHERE repo = ? AND trigger_comment_id = ?`,
      [repo, triggerCommentId],
    );
    return (row?.count ?? 0) > 0;
  }

  isMentionTaskCancelled(id: string): boolean {
    const row = this.get<{ status: string }>(
      `SELECT status FROM "${this.t("mention_tasks")}" WHERE id = ?`,
      [id],
    );
    return row?.status === "cancelled";
  }

  updateMentionTaskStage(id: string, status: string): MentionTask | undefined {
    if (this.isMentionTaskCancelled(id)) return this.getMentionTask(id);
    const stageHistory = this.appendMentionStageHistory(id, status);
    this.run(
      `UPDATE "${this.t("mention_tasks")}" SET status = ?, stage_history = ? WHERE id = ? AND status <> 'cancelled'`,
      [status, stageHistory, id],
    );
    return this.getMentionTask(id);
  }

  private appendMentionStageHistory(id: string, stage: string): string {
    const row = this.get<{ stageHistory: string | null }>(
      `SELECT stage_history as stageHistory FROM "${this.t("mention_tasks")}" WHERE id = ?`,
      [id],
    );
    let history: Array<{ stage: string; time: number }> = [];
    if (row?.stageHistory) {
      try {
        const parsed = JSON.parse(row.stageHistory);
        if (Array.isArray(parsed)) {
          history = parsed.filter(
            (entry): entry is { stage: string; time: number } =>
              typeof entry?.stage === "string" && typeof entry?.time === "number",
          );
        }
      } catch {
        history = [];
      }
    }
    history.push({ stage, time: Date.now() });
    return JSON.stringify(history);
  }

  setMentionTaskRomeSession(id: string, romeSession: RomeSessionRef): void {
    this.run(`UPDATE "${this.t("mention_tasks")}" SET rome_session = ? WHERE id = ?`, [JSON.stringify(romeSession), id]);
  }

  completeMentionTask(id: string, resultRef: Record<string, unknown> | null): MentionTask | undefined {
    if (this.isMentionTaskCancelled(id)) return this.getMentionTask(id);
    const completedAt = new Date().toISOString();
    const stageHistory = this.appendMentionStageHistory(id, "completed");
    this.run(
      `UPDATE "${this.t("mention_tasks")}" SET status = ?, stage_history = ?, result_ref = ?, completed_at = ? WHERE id = ? AND status <> 'cancelled'`,
      ["completed", stageHistory, resultRef ? JSON.stringify(resultRef) : null, completedAt, id],
    );
    return this.getMentionTask(id);
  }

  failMentionTask(id: string, error: string): MentionTask | undefined {
    if (this.isMentionTaskCancelled(id)) return this.getMentionTask(id);
    const completedAt = new Date().toISOString();
    const stageHistory = this.appendMentionStageHistory(id, "failed");
    this.run(
      `UPDATE "${this.t("mention_tasks")}" SET status = ?, stage_history = ?, result_ref = ?, completed_at = ? WHERE id = ? AND status <> 'cancelled'`,
      ["failed", stageHistory, JSON.stringify({ error }), completedAt, id],
    );
    return this.getMentionTask(id);
  }

  cancelMentionTask(id: string): MentionTask | undefined {
    const current = this.getMentionTask(id);
    if (!current) return undefined;
    if (current.status === "cancelled") return current;
    if (!ACTIVE_MENTION_TASK_STATUSES.includes(current.status as any) && current.status !== "queued") return current;
    const completedAt = new Date().toISOString();
    const stageHistory = this.appendMentionStageHistory(id, "cancelled");
    this.run(
      `UPDATE "${this.t("mention_tasks")}" SET status = ?, stage_history = ?, completed_at = ? WHERE id = ?`,
      ["cancelled", stageHistory, completedAt, id],
    );
    return this.getMentionTask(id);
  }

  listMentionTasks(limit: number = 30, offset: number = 0): MentionTask[] {
    return this.all<any>(
      `SELECT ${this.mentionTaskColumns()} FROM "${this.t("mention_tasks")}" ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    ).map((row) => this.hydrateMentionTask(row)!).filter(Boolean);
  }

  // --- Project memory writer + audit ---

  /**
   * Single, isomorphic write entry for project memory (agent + user). Pure
   * writer: snapshots `before`, writes the field, appends a memory_edits audit
   * row. No merge intelligence — callers submit the final content.
   * See docs/agentic-code-review-design.md §5③.
   */
  writeProjectMemory(input: {
    repo: string;
    after: string | null;
    source: string;
    sourceRef?: string | null;
    actor: "agent" | "user";
    taskId?: string | null;
    summary?: string | null;
  }): { before: string | null; after: string | null; edit: MemoryEdit } {
    const existing = this.getPRReviewSettings(input.repo);
    const before = existing?.projectMemory ?? null;
    const after = input.after && input.after.trim() ? input.after : null;
    // Ensure a settings row exists so the field has a home.
    this.upsertPRReviewSettings(input.repo, { projectMemory: after });
    const edit = this.appendMemoryEdit({
      repo: input.repo,
      taskId: input.taskId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      actor: input.actor,
      before,
      after,
      summary: input.summary ?? null,
    });
    return { before, after, edit };
  }

  private appendMemoryEdit(edit: {
    repo: string;
    taskId: string | null;
    source: string;
    sourceRef: string | null;
    actor: string;
    before: string | null;
    after: string | null;
    summary: string | null;
  }): MemoryEdit {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("memory_edits")}" (id, repo, task_id, source, source_ref, actor, before, after, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, edit.repo, edit.taskId, edit.source, edit.sourceRef, edit.actor, edit.before, edit.after, edit.summary, createdAt],
    );
    return { id, ...edit, createdAt };
  }

  listMemoryEdits(repo: string, limit: number = 50): MemoryEdit[] {
    return this.all<any>(
      `SELECT id, repo, task_id as taskId, source, source_ref as sourceRef, actor, before, after, summary, created_at as createdAt FROM "${this.t("memory_edits")}" WHERE repo = ? ORDER BY created_at DESC LIMIT ?`,
      [repo, limit],
    );
  }
}

export function createScanRepository(ctx: AppDbContext): ScanRepository {
  return new ScanRepository(ctx.connection, ctx.tablePrefix);
}
