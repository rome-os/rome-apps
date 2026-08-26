import type { DrizzleDb } from "@rome-os/app-runtime";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Survey {
  id: string;
  title: string;
  goal: string;
  description: string | null;
  schemaDefinition: string | null;
  formDefinition: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignMessage {
  id: string;
  surveyId: string;
  role: string;
  content: string;
  metadata: string | null;
  createdAt: string;
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  respondentId: string | null;
  answers: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

export interface ResponseMessage {
  id: string;
  responseId: string;
  role: string;
  content: string;
  uiBlock: string | null;
  createdAt: string;
}

export interface AccountingRecord {
  id: string;
  surveyId: string;
  responseId: string | null;
  actionType: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AccountingSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUsd: number;
  totalCalls: number;
  totalDurationMs: number;
  byActionType: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    calls: number;
    durationMs: number;
  }>;
  records: AccountingRecord[];
}

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export class SurveyRepository {
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

  /* ---------- Surveys ---------- */

  createSurvey(id: string, title: string, goal: string): Survey {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("surveys")}" (id, title, goal, status, created_at, updated_at)
       VALUES (?, ?, ?, 'designing', ?, ?)`,
      [id, title, goal, now, now],
    );
    return { id, title, goal, description: null, schemaDefinition: null, formDefinition: null, status: "designing", createdAt: now, updatedAt: now };
  }

  getSurvey(id: string): Survey | undefined {
    return this.get<Survey>(
      `SELECT id, title, goal, description, schema_definition AS schemaDefinition, form_definition AS formDefinition, status, created_at AS createdAt, updated_at AS updatedAt FROM "${this.t("surveys")}" WHERE id = ?`,
      [id],
    );
  }

  listSurveys(): Survey[] {
    return this.all<Survey>(
      `SELECT id, title, goal, description, schema_definition AS schemaDefinition, form_definition AS formDefinition, status, created_at AS createdAt, updated_at AS updatedAt FROM "${this.t("surveys")}" ORDER BY updated_at DESC`,
    );
  }

  updateSurvey(id: string, fields: {
    title?: string;
    description?: string;
    schemaDefinition?: string;
    formDefinition?: string;
    status?: string;
  }): void {
    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const params: any[] = [now];
    if (fields.title !== undefined) { sets.push("title = ?"); params.push(fields.title); }
    if (fields.description !== undefined) { sets.push("description = ?"); params.push(fields.description); }
    if (fields.schemaDefinition !== undefined) { sets.push("schema_definition = ?"); params.push(fields.schemaDefinition); }
    if (fields.formDefinition !== undefined) { sets.push("form_definition = ?"); params.push(fields.formDefinition); }
    if (fields.status !== undefined) { sets.push("status = ?"); params.push(fields.status); }
    params.push(id);
    this.run(`UPDATE "${this.t("surveys")}" SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  deleteSurvey(id: string): void {
    this.run(`DELETE FROM "${this.t("response_messages")}" WHERE response_id IN (SELECT id FROM "${this.t("survey_responses")}" WHERE survey_id = ?)`, [id]);
    this.run(`DELETE FROM "${this.t("survey_responses")}" WHERE survey_id = ?`, [id]);
    this.run(`DELETE FROM "${this.t("design_messages")}" WHERE survey_id = ?`, [id]);
    this.run(`DELETE FROM "${this.t("surveys")}" WHERE id = ?`, [id]);
  }

  /* ---------- Design Messages ---------- */

  addDesignMessage(id: string, surveyId: string, role: string, content: string, metadata?: string): DesignMessage {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("design_messages")}" (id, survey_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, surveyId, role, content, metadata ?? null, now],
    );
    return { id, surveyId, role, content, metadata: metadata ?? null, createdAt: now };
  }

  listDesignMessages(surveyId: string): DesignMessage[] {
    return this.all<DesignMessage>(
      `SELECT id, survey_id AS surveyId, role, content, metadata, created_at AS createdAt FROM "${this.t("design_messages")}" WHERE survey_id = ? ORDER BY created_at ASC`,
      [surveyId],
    );
  }

  /* ---------- Survey Responses ---------- */

  createResponse(id: string, surveyId: string, respondentId?: string): SurveyResponse {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("survey_responses")}" (id, survey_id, respondent_id, status, started_at) VALUES (?, ?, ?, 'in_progress', ?)`,
      [id, surveyId, respondentId ?? null, now],
    );
    return { id, surveyId, respondentId: respondentId ?? null, answers: null, status: "in_progress", startedAt: now, completedAt: null };
  }

  getResponse(id: string): SurveyResponse | undefined {
    return this.get<SurveyResponse>(
      `SELECT id, survey_id AS surveyId, respondent_id AS respondentId, answers, status, started_at AS startedAt, completed_at AS completedAt FROM "${this.t("survey_responses")}" WHERE id = ?`,
      [id],
    );
  }

  listResponses(surveyId: string): SurveyResponse[] {
    return this.all<SurveyResponse>(
      `SELECT id, survey_id AS surveyId, respondent_id AS respondentId, answers, status, started_at AS startedAt, completed_at AS completedAt FROM "${this.t("survey_responses")}" WHERE survey_id = ? ORDER BY started_at DESC`,
      [surveyId],
    );
  }

  countResponses(surveyId: string): number {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) AS count FROM "${this.t("survey_responses")}" WHERE survey_id = ?`, [surveyId]);
    return row?.count ?? 0;
  }

  updateResponse(id: string, fields: { answers?: string; status?: string }): void {
    const sets: string[] = [];
    const params: any[] = [];
    if (fields.answers !== undefined) { sets.push("answers = ?"); params.push(fields.answers); }
    if (fields.status !== undefined) {
      sets.push("status = ?");
      params.push(fields.status);
      if (fields.status === "completed") { sets.push("completed_at = ?"); params.push(new Date().toISOString()); }
    }
    if (sets.length === 0) return;
    params.push(id);
    this.run(`UPDATE "${this.t("survey_responses")}" SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  deleteResponse(id: string): void {
    this.run(`DELETE FROM "${this.t("response_messages")}" WHERE response_id = ?`, [id]);
    this.run(`DELETE FROM "${this.t("survey_responses")}" WHERE id = ?`, [id]);
  }

  /* ---------- Response Messages ---------- */

  addResponseMessage(id: string, responseId: string, role: string, content: string, uiBlock?: string): ResponseMessage {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("response_messages")}" (id, response_id, role, content, ui_block, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, responseId, role, content, uiBlock ?? null, now],
    );
    return { id, responseId, role, content, uiBlock: uiBlock ?? null, createdAt: now };
  }

  listResponseMessages(responseId: string): ResponseMessage[] {
    return this.all<ResponseMessage>(
      `SELECT id, response_id AS responseId, role, content, ui_block AS uiBlock, created_at AS createdAt FROM "${this.t("response_messages")}" WHERE response_id = ? ORDER BY created_at ASC`,
      [responseId],
    );
  }

  /* ---------- Accounting ---------- */

  addAccountingRecord(record: {
    id: string;
    surveyId: string;
    responseId?: string;
    actionType: string;
    provider?: string;
    model?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd?: number;
    durationMs?: number;
  }): void {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO "${this.t("accounting")}" (id, survey_id, response_id, action_type, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.surveyId,
        record.responseId ?? null,
        record.actionType,
        record.provider ?? null,
        record.model ?? null,
        record.inputTokens,
        record.outputTokens,
        record.cacheReadTokens,
        record.cacheWriteTokens,
        record.costUsd != null ? String(record.costUsd) : null,
        record.durationMs ?? null,
        now,
      ],
    );
  }

  getResponseAccountingSummary(responseId: string): AccountingSummary {
    const records = this.all<AccountingRecord>(
      `SELECT id, survey_id AS surveyId, response_id AS responseId, action_type AS actionType, provider, model, input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens, cost_usd AS costUsd, duration_ms AS durationMs, created_at AS createdAt FROM "${this.t("accounting")}" WHERE response_id = ? ORDER BY created_at ASC`,
      [responseId],
    );
    return this.buildSummary(records);
  }

  /** Returns a map of responseId → { tokens, cost, calls } for all responses in a survey */
  getResponseAccountingMap(surveyId: string): Record<string, { tokens: number; costUsd: number; calls: number }> {
    const rows = this.all<{ responseId: string; tokens: number; costUsd: string | null; calls: number }>(
      `SELECT response_id AS responseId, SUM(input_tokens + output_tokens) AS tokens, SUM(CAST(cost_usd AS REAL)) AS costUsd, COUNT(*) AS calls FROM "${this.t("accounting")}" WHERE survey_id = ? AND response_id IS NOT NULL GROUP BY response_id`,
      [surveyId],
    );
    const map: Record<string, { tokens: number; costUsd: number; calls: number }> = {};
    for (const r of rows) {
      map[r.responseId] = { tokens: r.tokens, costUsd: r.costUsd ? parseFloat(String(r.costUsd)) : 0, calls: r.calls };
    }
    return map;
  }

  getAccountingSummary(surveyId: string): AccountingSummary {
    const records = this.all<AccountingRecord>(
      `SELECT id, survey_id AS surveyId, response_id AS responseId, action_type AS actionType, provider, model, input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens, cost_usd AS costUsd, duration_ms AS durationMs, created_at AS createdAt FROM "${this.t("accounting")}" WHERE survey_id = ? ORDER BY created_at ASC`,
      [surveyId],
    );
    return this.buildSummary(records);
  }

  private buildSummary(records: AccountingRecord[]): AccountingSummary {
    const summary: AccountingSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCostUsd: 0,
      totalCalls: records.length,
      totalDurationMs: 0,
      byActionType: {},
      records,
    };

    for (const r of records) {
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;
      summary.totalCacheReadTokens += r.cacheReadTokens;
      summary.totalCacheWriteTokens += r.cacheWriteTokens;
      summary.totalCostUsd += r.costUsd ? parseFloat(r.costUsd) : 0;
      summary.totalDurationMs += r.durationMs ?? 0;

      if (!summary.byActionType[r.actionType]) {
        summary.byActionType[r.actionType] = {
          inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0,
          costUsd: 0, calls: 0, durationMs: 0,
        };
      }
      const bucket = summary.byActionType[r.actionType];
      bucket.inputTokens += r.inputTokens;
      bucket.outputTokens += r.outputTokens;
      bucket.cacheReadTokens += r.cacheReadTokens;
      bucket.cacheWriteTokens += r.cacheWriteTokens;
      bucket.costUsd += r.costUsd ? parseFloat(r.costUsd) : 0;
      bucket.calls += 1;
      bucket.durationMs += r.durationMs ?? 0;
    }

    return summary;
  }
}

export function createSurveyRepository(ctx: { connection: DrizzleDb; tablePrefix: string }): SurveyRepository {
  return new SurveyRepository(ctx.connection, ctx.tablePrefix);
}
