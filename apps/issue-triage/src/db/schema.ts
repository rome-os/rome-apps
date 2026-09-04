import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Issue Triage schema. Mirrors the code-review app's shape: a repositories
 * catalog, per-repo trigger/dimension settings, and an append-only log of
 * triage runs (one row per issue triaged, with the classification + applied
 * labels + reasoning the dashboard renders).
 */
export function createAppDbSchema(tablePrefix: string = "issue_triage") {
  const repositories = sqliteTable(`${tablePrefix}__repositories`, {
    id: text("id").primaryKey(),
    /** owner/name — the GitHub slug, unique. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
  });

  const repoSettings = sqliteTable(`${tablePrefix}__repo_settings`, {
    id: text("id").primaryKey(),
    repo: text("repo").notNull().unique(),
    autoTriageEnabled: integer("auto_triage_enabled").notNull().default(0),
    triggerOnOpen: integer("trigger_on_open").notNull().default(1),
    /** Covers both `edited` and `reopened` issue actions. */
    triggerOnEdit: integer("trigger_on_edit").notNull().default(1),
    /** How labels are applied. Only "apply" is supported today. */
    applyMode: text("apply_mode").notNull().default("apply"),
    /** JSON: { type, priority, area, flags } booleans. */
    dimensionsEnabled: text("dimensions_enabled"),
    createMissingLabels: integer("create_missing_labels").notNull().default(1),
    /** Whether add-repo/provisioning may auto-create missing recommended labels. */
    autoCreateLabels: integer("auto_create_labels").notNull().default(1),
    /** JSON: resolved LabelMap { type:{concept:label}, priority:{...}, flags:{...} }. */
    labelMap: text("label_map"),
    /** When labels were last provisioned for this repo. */
    provisionedAt: integer("provisioned_at", { mode: "timestamp" }),
    customRules: text("custom_rules"),
    githubWebhookId: text("github_webhook_id"),
    /** Legacy field, always null in the event-bus implementation. */
    webhookChannelUrl: text("webhook_channel_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  const triageResults = sqliteTable(`${tablePrefix}__triage_results`, {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    issueNumber: integer("issue_number").notNull(),
    issueUrl: text("issue_url"),
    issueTitle: text("issue_title"),
    /** e.g. webhook:opened | webhook:edited | webhook:reopened | manual | batch. */
    actor: text("actor").notNull().default("manual"),
    /** queued | running | succeeded | failed | skipped. */
    status: text("status").notNull().default("queued"),
    /** JSON array of the final label names applied to the issue. */
    appliedLabels: text("applied_labels"),
    /** JSON array of label names created in the repo during this run. */
    createdLabels: text("created_labels"),
    reasoning: text("reasoning"),
    /** JSON: { type, priority, areas: string[], flags: string[] }. */
    classification: text("classification"),
    /** Hash of issue title+body at triage time; used to dedup webhook re-fires. */
    contentSig: text("content_sig"),
    /** JSON-serialized opaque RomeSessionRef of the classifier agent session. */
    romeSession: text("rome_session"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  });

  return { repositories, repoSettings, triageResults };
}

const defaultSchema = createAppDbSchema();
export const repositories = defaultSchema.repositories;
export const repoSettings = defaultSchema.repoSettings;
export const triageResults = defaultSchema.triageResults;
