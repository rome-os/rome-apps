import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createAppDbSchema(tablePrefix: string = "survey") {
  /**
   * surveys — each row is one merchant-created survey definition.
   * `formDefinition` stores the agent-designed question list (JSON).
   * `schemaDefinition` stores the DB columns we track for analytics.
   */
  const surveys = sqliteTable(`${tablePrefix}__surveys`, {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    goal: text("goal").notNull(),
    description: text("description"),
    /** JSON: { fields: Array<{ key, label, type, options? }> } */
    schemaDefinition: text("schema_definition"),
    /** JSON: { questions: Array<{ id, text, type, options?, scale? }>, systemPrompt: string } */
    formDefinition: text("form_definition"),
    status: text("status").notNull().default("designing"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  /**
   * design_messages — merchant ⟷ design-pro agent chat history.
   * Stored so the merchant can continue the conversation across page reloads.
   */
  const designMessages = sqliteTable(`${tablePrefix}__design_messages`, {
    id: text("id").primaryKey(),
    surveyId: text("survey_id").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    /** optional JSON metadata (e.g. current schema snapshot) */
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  /**
   * survey_responses — one row per consumer who completed (or is completing) a survey.
   * `answers` stores structured { [fieldKey]: value } data.
   */
  const surveyResponses = sqliteTable(`${tablePrefix}__survey_responses`, {
    id: text("id").primaryKey(),
    surveyId: text("survey_id").notNull(),
    respondentId: text("respondent_id"),
    /** JSON: { [fieldKey]: value } */
    answers: text("answers"),
    status: text("status").notNull().default("in_progress"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  });

  /**
   * response_messages — consumer ⟷ survey-chat agent conversation.
   * Kept per-response so the merchant can replay individual sessions.
   */
  const responseMessages = sqliteTable(`${tablePrefix}__response_messages`, {
    id: text("id").primaryKey(),
    responseId: text("response_id").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    /** JSON: rendered UI block (e.g. { type: "single_choice", options: [...] }) */
    uiBlock: text("ui_block"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  /**
   * accounting — tracks token usage per agent invocation for cost analysis.
   * Each row represents one agentRunner.run() call.
   */
  const accounting = sqliteTable(`${tablePrefix}__accounting`, {
    id: text("id").primaryKey(),
    surveyId: text("survey_id").notNull(),
    /** null for design-phase calls; set for consumer chat calls */
    responseId: text("response_id"),
    /** "design" | "chat" */
    actionType: text("action_type").notNull(),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: text("cost_usd"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  return { surveys, designMessages, surveyResponses, responseMessages, accounting };
}

const defaultSchema = createAppDbSchema();
export const surveys = defaultSchema.surveys;
export const designMessages = defaultSchema.designMessages;
export const surveyResponses = defaultSchema.surveyResponses;
export const responseMessages = defaultSchema.responseMessages;
export const accounting = defaultSchema.accounting;
