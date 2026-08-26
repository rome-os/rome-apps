import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";

// --- Types ---

export interface ActionRun {
  id: string;
  actionName: string;
  status: string;
  inputJson: string | null;
  outputJson: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AccountState {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  followers: string | null;
  following: string | null;
  tweets: string | null;
  loginStatus: string;
  lastCheckedAt: string | null;
  updatedAt: string;
}

export interface BrandVoice {
  id: string;
  accountHandle: string;
  isOwn: number;
  learnStatus: string;
  learnProgress: number;
  memoryFilePath: string | null;
  sourceAccounts: string | null;
  tweetsAnalyzed: number;
  lastLearnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Repository ---

export class XRepository {
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

  // --- Action Runs ---

  insertActionRun(run: {
    id: string;
    actionName: string;
    status: string;
    inputJson?: string | null;
    startedAt: Date;
  }): void {
    this.run(
      `INSERT INTO "${this.t("action_runs")}" (id, action_name, status, input_json, started_at) VALUES (?, ?, ?, ?, ?)`,
      [run.id, run.actionName, run.status, run.inputJson ?? null, Math.floor(run.startedAt.getTime() / 1000)],
    );
  }

  completeActionRun(id: string, status: string, outputJson?: string | null, errorMessage?: string | null): void {
    this.run(
      `UPDATE "${this.t("action_runs")}" SET status = ?, output_json = ?, error_message = ?, finished_at = ? WHERE id = ?`,
      [status, outputJson ?? null, errorMessage ?? null, Math.floor(Date.now() / 1000), id],
    );
  }

  listActionRuns(limit: number = 20, offset: number = 0): ActionRun[] {
    return this.all<ActionRun>(
      `SELECT id, action_name AS actionName, status, input_json AS inputJson, output_json AS outputJson, error_message AS errorMessage, datetime(started_at, 'unixepoch') AS startedAt, CASE WHEN finished_at IS NOT NULL THEN datetime(finished_at, 'unixepoch') ELSE NULL END AS finishedAt FROM "${this.t("action_runs")}" ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  }

  countActionRuns(): number {
    const row = this.get<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM "${this.t("action_runs")}"`);
    return row?.cnt ?? 0;
  }

  listActionRunsByName(actionName: string, limit: number = 20, offset: number = 0): ActionRun[] {
    return this.all<ActionRun>(
      `SELECT id, action_name AS actionName, status, input_json AS inputJson, output_json AS outputJson, error_message AS errorMessage, datetime(started_at, 'unixepoch') AS startedAt, CASE WHEN finished_at IS NOT NULL THEN datetime(finished_at, 'unixepoch') ELSE NULL END AS finishedAt FROM "${this.t("action_runs")}" WHERE action_name = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [actionName, limit, offset],
    );
  }

  // --- Account State ---

  getAccountState(): AccountState | undefined {
    return this.get<AccountState>(
      `SELECT id, handle, display_name AS displayName, bio, followers, following, tweets, login_status AS loginStatus, CASE WHEN last_checked_at IS NOT NULL THEN datetime(last_checked_at, 'unixepoch') ELSE NULL END AS lastCheckedAt, datetime(updated_at, 'unixepoch') AS updatedAt FROM "${this.t("account_state")}" LIMIT 1`,
    );
  }

  upsertAccountState(state: {
    handle: string;
    displayName?: string | null;
    bio?: string | null;
    followers?: string | null;
    following?: string | null;
    tweets?: string | null;
    loginStatus: string;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.get<{ id: string }>(`SELECT id FROM "${this.t("account_state")}" LIMIT 1`);
    if (existing) {
      this.run(
        `UPDATE "${this.t("account_state")}" SET handle = ?, display_name = ?, bio = ?, followers = ?, following = ?, tweets = ?, login_status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?`,
        [state.handle, state.displayName ?? null, state.bio ?? null, state.followers ?? null, state.following ?? null, state.tweets ?? null, state.loginStatus, now, now, existing.id],
      );
    } else {
      const id = crypto.randomUUID();
      this.run(
        `INSERT INTO "${this.t("account_state")}" (id, handle, display_name, bio, followers, following, tweets, login_status, last_checked_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, state.handle, state.displayName ?? null, state.bio ?? null, state.followers ?? null, state.following ?? null, state.tweets ?? null, state.loginStatus, now, now],
      );
    }
  }

  // --- Brand Voices ---

  listBrandVoices(): BrandVoice[] {
    return this.all<BrandVoice>(
      `SELECT id, account_handle AS accountHandle, is_own AS isOwn, learn_status AS learnStatus, learn_progress AS learnProgress, memory_file_path AS memoryFilePath, source_accounts AS sourceAccounts, tweets_analyzed AS tweetsAnalyzed, CASE WHEN last_learned_at IS NOT NULL THEN datetime(last_learned_at, 'unixepoch') ELSE NULL END AS lastLearnedAt, datetime(created_at, 'unixepoch') AS createdAt, datetime(updated_at, 'unixepoch') AS updatedAt FROM "${this.t("brand_voices")}" ORDER BY is_own DESC, updated_at DESC`,
    );
  }

  getBrandVoice(id: string): BrandVoice | undefined {
    return this.get<BrandVoice>(
      `SELECT id, account_handle AS accountHandle, is_own AS isOwn, learn_status AS learnStatus, learn_progress AS learnProgress, memory_file_path AS memoryFilePath, source_accounts AS sourceAccounts, tweets_analyzed AS tweetsAnalyzed, CASE WHEN last_learned_at IS NOT NULL THEN datetime(last_learned_at, 'unixepoch') ELSE NULL END AS lastLearnedAt, datetime(created_at, 'unixepoch') AS createdAt, datetime(updated_at, 'unixepoch') AS updatedAt FROM "${this.t("brand_voices")}" WHERE id = ?`,
      [id],
    );
  }

  getBrandVoiceByHandle(handle: string): BrandVoice | undefined {
    return this.get<BrandVoice>(
      `SELECT id, account_handle AS accountHandle, is_own AS isOwn, learn_status AS learnStatus, learn_progress AS learnProgress, memory_file_path AS memoryFilePath, source_accounts AS sourceAccounts, tweets_analyzed AS tweetsAnalyzed, CASE WHEN last_learned_at IS NOT NULL THEN datetime(last_learned_at, 'unixepoch') ELSE NULL END AS lastLearnedAt, datetime(created_at, 'unixepoch') AS createdAt, datetime(updated_at, 'unixepoch') AS updatedAt FROM "${this.t("brand_voices")}" WHERE account_handle = ?`,
      [handle],
    );
  }

  upsertBrandVoice(voice: {
    accountHandle: string;
    isOwn?: boolean;
    learnStatus?: string;
    learnProgress?: number;
    memoryFilePath?: string | null;
    sourceAccounts?: string | null;
    tweetsAnalyzed?: number;
  }): BrandVoice {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.getBrandVoiceByHandle(voice.accountHandle);

    if (existing) {
      this.run(
        `UPDATE "${this.t("brand_voices")}" SET is_own = ?, learn_status = ?, learn_progress = ?, memory_file_path = ?, source_accounts = ?, tweets_analyzed = ?, last_learned_at = CASE WHEN ? = 'complete' THEN ? ELSE last_learned_at END, updated_at = ? WHERE id = ?`,
        [
          voice.isOwn !== undefined ? (voice.isOwn ? 1 : 0) : existing.isOwn,
          voice.learnStatus ?? existing.learnStatus,
          voice.learnProgress ?? existing.learnProgress,
          voice.memoryFilePath !== undefined ? voice.memoryFilePath : existing.memoryFilePath,
          voice.sourceAccounts !== undefined ? voice.sourceAccounts : existing.sourceAccounts,
          voice.tweetsAnalyzed ?? existing.tweetsAnalyzed,
          voice.learnStatus ?? existing.learnStatus,
          now,
          now,
          existing.id,
        ],
      );
      return this.getBrandVoice(existing.id)!;
    }

    const id = crypto.randomUUID();
    this.run(
      `INSERT INTO "${this.t("brand_voices")}" (id, account_handle, is_own, learn_status, learn_progress, memory_file_path, source_accounts, tweets_analyzed, last_learned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        voice.accountHandle,
        voice.isOwn !== undefined ? (voice.isOwn ? 1 : 0) : 1,
        voice.learnStatus ?? "idle",
        voice.learnProgress ?? 0,
        voice.memoryFilePath ?? null,
        voice.sourceAccounts ?? null,
        voice.tweetsAnalyzed ?? 0,
        null,
        now,
        now,
      ],
    );
    return this.getBrandVoice(id)!;
  }

  deleteBrandVoice(id: string): void {
    this.run(`DELETE FROM "${this.t("brand_voices")}" WHERE id = ?`, [id]);
  }
}

export function createXRepository(ctx: AppDbContext): XRepository {
  return new XRepository(ctx.connection, ctx.tablePrefix);
}
