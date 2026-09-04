import type { AppDbContext, DrizzleDb, RomeSessionRef } from "@rome-os/app-runtime";
import { DEFAULT_DIMENSIONS, type DimensionsEnabled, type LabelMap } from "../../utils/taxonomy.js";

export interface Repository {
  id: string;
  slug: string;
  name: string;
  addedAt: string;
}

export interface RepoSettings {
  id: string;
  repo: string;
  autoTriageEnabled: boolean;
  triggerOnOpen: boolean;
  triggerOnEdit: boolean;
  applyMode: string;
  dimensionsEnabled: DimensionsEnabled;
  createMissingLabels: boolean;
  autoCreateLabels: boolean;
  labelMap: LabelMap | null;
  provisionedAt: string | null;
  customRules: string | null;
  githubWebhookId: string | null;
  webhookChannelUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriageClassification {
  type: string | null;
  priority: string | null;
  areas: string[];
  flags: string[];
}

export interface TriageResult {
  id: string;
  repo: string;
  issueNumber: number;
  issueUrl: string | null;
  issueTitle: string | null;
  actor: string;
  status: string;
  appliedLabels: string[];
  createdLabels: string[];
  reasoning: string | null;
  classification: TriageClassification | null;
  romeSession: RomeSessionRef | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const ACTIVE_STATUSES = ["queued", "running"] as const;

/**
 * Raw-SQL repository over the better-sqlite3 driver exposed by DrizzleDb.
 * Mirrors the code-review app's ScanRepository shape.
 */
export class TriageRepository {
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

  // --- helpers ---

  private parseJsonArray(raw: unknown): string[] {
    if (typeof raw !== "string" || !raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  private parseDimensions(raw: unknown): DimensionsEnabled {
    if (typeof raw !== "string" || !raw) return { ...DEFAULT_DIMENSIONS };
    try {
      const parsed = JSON.parse(raw) as Partial<DimensionsEnabled>;
      return {
        type: parsed.type !== undefined ? !!parsed.type : DEFAULT_DIMENSIONS.type,
        priority: parsed.priority !== undefined ? !!parsed.priority : DEFAULT_DIMENSIONS.priority,
        area: parsed.area !== undefined ? !!parsed.area : DEFAULT_DIMENSIONS.area,
        flags: parsed.flags !== undefined ? !!parsed.flags : DEFAULT_DIMENSIONS.flags,
      };
    } catch {
      return { ...DEFAULT_DIMENSIONS };
    }
  }

  private parseLabelMap(raw: unknown): LabelMap | null {
    if (typeof raw !== "string" || !raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return null;
      const out: LabelMap = {};
      for (const dim of ["type", "priority", "flags"] as const) {
        const bucket = parsed[dim];
        if (bucket && typeof bucket === "object") {
          const clean: Record<string, string> = {};
          for (const [k, v] of Object.entries(bucket as Record<string, unknown>)) {
            if (typeof v === "string") clean[k] = v;
          }
          if (Object.keys(clean).length) out[dim] = clean;
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  private parseRomeSession(raw: unknown): RomeSessionRef | null {
    if (typeof raw === "string" && raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && typeof parsed._romeSessionId === "string") {
          return parsed as RomeSessionRef;
        }
      } catch {
        return null;
      }
    } else if (raw && typeof raw === "object") {
      return raw as RomeSessionRef;
    }
    return null;
  }

  private parseClassification(raw: unknown): TriageClassification | null {
    if (typeof raw !== "string" || !raw) return null;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      return {
        type: typeof p.type === "string" ? p.type : null,
        priority: typeof p.priority === "string" ? p.priority : null,
        areas: Array.isArray(p.areas) ? (p.areas as unknown[]).filter((x) => typeof x === "string") as string[] : [],
        flags: Array.isArray(p.flags) ? (p.flags as unknown[]).filter((x) => typeof x === "string") as string[] : [],
      };
    } catch {
      return null;
    }
  }

  // --- Repositories ---

  addRepository(slug: string, name: string): Repository {
    const id = crypto.randomUUID();
    const addedAt = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("repositories")}" (id, slug, name, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(slug) DO NOTHING`,
      [id, slug, name, addedAt],
    );
    const existing = this.getRepositoryBySlug(slug);
    return existing ?? { id, slug, name, addedAt };
  }

  removeRepository(id: string): void {
    this.run(`DELETE FROM "${this.t("repositories")}" WHERE id = ?`, [id]);
  }

  listRepositories(): Repository[] {
    return this.all<any>(
      `SELECT id, slug, name, added_at as addedAt FROM "${this.t("repositories")}" ORDER BY added_at DESC`,
    );
  }

  getRepository(id: string): Repository | undefined {
    return this.get<any>(
      `SELECT id, slug, name, added_at as addedAt FROM "${this.t("repositories")}" WHERE id = ?`,
      [id],
    );
  }

  getRepositoryBySlug(slug: string): Repository | undefined {
    return this.get<any>(
      `SELECT id, slug, name, added_at as addedAt FROM "${this.t("repositories")}" WHERE slug = ?`,
      [slug],
    );
  }

  // --- Repo settings ---

  private hydrateSettings(row: any): RepoSettings {
    return {
      id: row.id,
      repo: row.repo,
      autoTriageEnabled: !!row.autoTriageEnabled,
      triggerOnOpen: !!row.triggerOnOpen,
      triggerOnEdit: !!row.triggerOnEdit,
      applyMode: row.applyMode || "apply",
      dimensionsEnabled: this.parseDimensions(row.dimensionsEnabled),
      createMissingLabels: !!row.createMissingLabels,
      autoCreateLabels: row.autoCreateLabels === undefined || row.autoCreateLabels === null ? true : !!row.autoCreateLabels,
      labelMap: this.parseLabelMap(row.labelMap),
      provisionedAt: row.provisionedAt ?? null,
      customRules: row.customRules ?? null,
      githubWebhookId: row.githubWebhookId ?? null,
      webhookChannelUrl: row.webhookChannelUrl ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private settingsColumns(): string {
    return `id, repo, auto_triage_enabled as autoTriageEnabled, trigger_on_open as triggerOnOpen,
      trigger_on_edit as triggerOnEdit, apply_mode as applyMode, dimensions_enabled as dimensionsEnabled,
      create_missing_labels as createMissingLabels, auto_create_labels as autoCreateLabels,
      label_map as labelMap, provisioned_at as provisionedAt, custom_rules as customRules,
      github_webhook_id as githubWebhookId, webhook_channel_url as webhookChannelUrl,
      created_at as createdAt, updated_at as updatedAt`;
  }

  getRepoSettings(repo: string): RepoSettings | undefined {
    const row = this.get<any>(
      `SELECT ${this.settingsColumns()} FROM "${this.t("repo_settings")}" WHERE repo = ?`,
      [repo],
    );
    return row ? this.hydrateSettings(row) : undefined;
  }

  listAllRepoSettings(): RepoSettings[] {
    return this.all<any>(
      `SELECT ${this.settingsColumns()} FROM "${this.t("repo_settings")}" ORDER BY updated_at DESC`,
    ).map((r) => this.hydrateSettings(r));
  }

  upsertRepoSettings(
    repo: string,
    settings: {
      autoTriageEnabled?: boolean;
      triggerOnOpen?: boolean;
      triggerOnEdit?: boolean;
      applyMode?: string;
      dimensionsEnabled?: DimensionsEnabled;
      createMissingLabels?: boolean;
      autoCreateLabels?: boolean;
      labelMap?: LabelMap | null;
      provisionedAt?: string | null;
      customRules?: string | null;
      githubWebhookId?: string | null;
      webhookChannelUrl?: string | null;
    },
  ): RepoSettings {
    const existing = this.getRepoSettings(repo);
    const now = new Date().toISOString();

    if (existing) {
      const merged: RepoSettings = {
        ...existing,
        autoTriageEnabled: settings.autoTriageEnabled ?? existing.autoTriageEnabled,
        triggerOnOpen: settings.triggerOnOpen ?? existing.triggerOnOpen,
        triggerOnEdit: settings.triggerOnEdit ?? existing.triggerOnEdit,
        applyMode: settings.applyMode ?? existing.applyMode,
        dimensionsEnabled: settings.dimensionsEnabled ?? existing.dimensionsEnabled,
        createMissingLabels: settings.createMissingLabels ?? existing.createMissingLabels,
        autoCreateLabels: settings.autoCreateLabels ?? existing.autoCreateLabels,
        labelMap: settings.labelMap !== undefined ? settings.labelMap : existing.labelMap,
        provisionedAt: settings.provisionedAt !== undefined ? settings.provisionedAt : existing.provisionedAt,
        customRules: settings.customRules !== undefined ? settings.customRules : existing.customRules,
        githubWebhookId: settings.githubWebhookId !== undefined ? settings.githubWebhookId : existing.githubWebhookId,
        webhookChannelUrl: settings.webhookChannelUrl !== undefined ? settings.webhookChannelUrl : existing.webhookChannelUrl,
        updatedAt: now,
      };
      this.run(
        `UPDATE "${this.t("repo_settings")}" SET auto_triage_enabled = ?, trigger_on_open = ?, trigger_on_edit = ?,
           apply_mode = ?, dimensions_enabled = ?, create_missing_labels = ?, auto_create_labels = ?,
           label_map = ?, provisioned_at = ?, custom_rules = ?,
           github_webhook_id = ?, webhook_channel_url = ?, updated_at = ? WHERE id = ?`,
        [
          merged.autoTriageEnabled ? 1 : 0,
          merged.triggerOnOpen ? 1 : 0,
          merged.triggerOnEdit ? 1 : 0,
          merged.applyMode,
          JSON.stringify(merged.dimensionsEnabled),
          merged.createMissingLabels ? 1 : 0,
          merged.autoCreateLabels ? 1 : 0,
          merged.labelMap ? JSON.stringify(merged.labelMap) : null,
          merged.provisionedAt,
          merged.customRules,
          merged.githubWebhookId,
          merged.webhookChannelUrl,
          now,
          existing.id,
        ],
      );
      return merged;
    }

    const id = crypto.randomUUID();
    const created: RepoSettings = {
      id,
      repo,
      autoTriageEnabled: settings.autoTriageEnabled ?? false,
      triggerOnOpen: settings.triggerOnOpen ?? true,
      triggerOnEdit: settings.triggerOnEdit ?? true,
      applyMode: settings.applyMode ?? "apply",
      dimensionsEnabled: settings.dimensionsEnabled ?? { ...DEFAULT_DIMENSIONS },
      createMissingLabels: settings.createMissingLabels ?? true,
      autoCreateLabels: settings.autoCreateLabels ?? true,
      labelMap: settings.labelMap ?? null,
      provisionedAt: settings.provisionedAt ?? null,
      customRules: settings.customRules ?? null,
      githubWebhookId: settings.githubWebhookId ?? null,
      webhookChannelUrl: settings.webhookChannelUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.run(
      `INSERT INTO "${this.t("repo_settings")}" (id, repo, auto_triage_enabled, trigger_on_open, trigger_on_edit,
         apply_mode, dimensions_enabled, create_missing_labels, auto_create_labels, label_map, provisioned_at,
         custom_rules, github_webhook_id, webhook_channel_url,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        repo,
        created.autoTriageEnabled ? 1 : 0,
        created.triggerOnOpen ? 1 : 0,
        created.triggerOnEdit ? 1 : 0,
        created.applyMode,
        JSON.stringify(created.dimensionsEnabled),
        created.createMissingLabels ? 1 : 0,
        created.autoCreateLabels ? 1 : 0,
        created.labelMap ? JSON.stringify(created.labelMap) : null,
        created.provisionedAt,
        created.customRules,
        created.githubWebhookId,
        created.webhookChannelUrl,
        now,
        now,
      ],
    );
    return created;
  }

  /** Persist the resolved label map and provisioning timestamp for a repo. */
  setRepoLabelMap(repo: string, labelMap: LabelMap, provisionedAt: string): RepoSettings {
    return this.upsertRepoSettings(repo, { labelMap, provisionedAt });
  }

  // --- Triage results ---

  private resultColumns(): string {
    return `id, repo, issue_number as issueNumber, issue_url as issueUrl, issue_title as issueTitle,
      actor, status, applied_labels as appliedLabels, created_labels as createdLabels, reasoning,
      classification, rome_session as romeSession, error, started_at as startedAt,
      completed_at as completedAt, created_at as createdAt`;
  }

  private hydrateResult(row: any): TriageResult | undefined {
    if (!row) return undefined;
    return {
      id: row.id,
      repo: row.repo,
      issueNumber: row.issueNumber,
      issueUrl: row.issueUrl ?? null,
      issueTitle: row.issueTitle ?? null,
      actor: row.actor,
      status: row.status,
      appliedLabels: this.parseJsonArray(row.appliedLabels),
      createdLabels: this.parseJsonArray(row.createdLabels),
      reasoning: row.reasoning ?? null,
      classification: this.parseClassification(row.classification),
      romeSession: this.parseRomeSession(row.romeSession),
      error: row.error ?? null,
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  createQueuedResult(input: {
    repo: string;
    issueNumber: number;
    issueUrl?: string | null;
    issueTitle?: string | null;
    actor?: string;
    contentSig?: string | null;
  }): TriageResult {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("triage_results")}" (id, repo, issue_number, issue_url, issue_title, actor, status, content_sig, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.repo,
        input.issueNumber,
        input.issueUrl ?? `https://github.com/${input.repo}/issues/${input.issueNumber}`,
        input.issueTitle ?? null,
        input.actor ?? "manual",
        "queued",
        input.contentSig ?? null,
        createdAt,
      ],
    );
    return this.getResult(id)!;
  }

  getResult(id: string): TriageResult | undefined {
    return this.hydrateResult(
      this.get<any>(`SELECT ${this.resultColumns()} FROM "${this.t("triage_results")}" WHERE id = ?`, [id]),
    );
  }

  markRunning(id: string): void {
    const now = new Date().toISOString();
    this.run(
      `UPDATE "${this.t("triage_results")}" SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?`,
      [now, id],
    );
  }

  setResultRomeSession(id: string, romeSession: RomeSessionRef): void {
    this.run(`UPDATE "${this.t("triage_results")}" SET rome_session = ? WHERE id = ?`, [JSON.stringify(romeSession), id]);
  }

  updateResultMeta(id: string, meta: { issueTitle?: string | null; issueUrl?: string | null }): void {
    if (meta.issueTitle !== undefined) {
      this.run(`UPDATE "${this.t("triage_results")}" SET issue_title = ? WHERE id = ?`, [meta.issueTitle, id]);
    }
    if (meta.issueUrl !== undefined) {
      this.run(`UPDATE "${this.t("triage_results")}" SET issue_url = ? WHERE id = ?`, [meta.issueUrl, id]);
    }
  }

  completeResult(
    id: string,
    input: {
      status: "succeeded" | "failed" | "skipped";
      appliedLabels?: string[];
      createdLabels?: string[];
      reasoning?: string | null;
      classification?: TriageClassification | null;
      error?: string | null;
    },
  ): TriageResult | undefined {
    const completedAt = new Date().toISOString();
    this.run(
      `UPDATE "${this.t("triage_results")}" SET status = ?, applied_labels = ?, created_labels = ?,
         reasoning = ?, classification = ?, error = ?, completed_at = ? WHERE id = ?`,
      [
        input.status,
        JSON.stringify(input.appliedLabels ?? []),
        JSON.stringify(input.createdLabels ?? []),
        input.reasoning ?? null,
        input.classification ? JSON.stringify(input.classification) : null,
        input.error ?? null,
        completedAt,
        id,
      ],
    );
    return this.getResult(id);
  }

  listResults(limit = 20, offset = 0): TriageResult[] {
    return this.all<any>(
      `SELECT ${this.resultColumns()} FROM "${this.t("triage_results")}" ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    ).map((r) => this.hydrateResult(r)!);
  }

  listResultsByRepo(repo: string, limit = 20): TriageResult[] {
    return this.all<any>(
      `SELECT ${this.resultColumns()} FROM "${this.t("triage_results")}" WHERE repo = ? ORDER BY created_at DESC LIMIT ?`,
      [repo, limit],
    ).map((r) => this.hydrateResult(r)!);
  }

  countResults(): number {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${this.t("triage_results")}"`);
    return row?.count ?? 0;
  }

  countResultsByStatus(): Record<string, number> {
    const rows = this.all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM "${this.t("triage_results")}" GROUP BY status`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count) || 0;
    return out;
  }

  /**
   * Idempotency guard: is there a recent running/succeeded result for this exact
   * issue with the same content signature (a hash of title+body)? Used to avoid
   * re-triage loops when a webhook re-fires on an unchanged issue.
   */
  hasRecentResultForSignature(repo: string, issueNumber: number, signature: string, withinMs = 10 * 60 * 1000): boolean {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${this.t("triage_results")}"
       WHERE repo = ? AND issue_number = ? AND status IN ('running','succeeded')
         AND created_at >= ? AND content_sig = ?`,
      [repo, issueNumber, cutoff, signature],
    );
    return (row?.count ?? 0) > 0;
  }

  /** True when a triage for this issue is currently queued or running. */
  hasActiveResult(repo: string, issueNumber: number): boolean {
    const row = this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${this.t("triage_results")}"
       WHERE repo = ? AND issue_number = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})`,
      [repo, issueNumber, ...ACTIVE_STATUSES],
    );
    return (row?.count ?? 0) > 0;
  }
}

export function createTriageRepository(ctx: AppDbContext): TriageRepository {
  return new TriageRepository(ctx.connection, ctx.tablePrefix);
}
