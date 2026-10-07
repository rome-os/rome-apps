import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// All timestamps are ISO-8601 strings (UTC).
export function createAppDbSchema(prefix: string = "settle") {
  /** A favor request for work already done. `id` is the unguessable link token. */
  const requests = sqliteTable(
    `${prefix}__requests`,
    {
      id: text("id").primaryKey(),
      item: text("item").notNull(),
      details: text("details").notNull().default(""),
      recipientName: text("recipient_name").notNull().default(""),
      recipientEmail: text("recipient_email").notNull().default(""),
      amount: integer("amount").notNull(),
      dueDate: text("due_date"),
      status: text("status").notNull().default("open"),
      paidVia: text("paid_via"),
      payerAccountId: text("payer_account_id"),
      payerEmail: text("payer_email"),
      paymentId: text("payment_id"),
      paidAt: text("paid_at"),
      viewCount: integer("view_count").notNull().default(0),
      firstViewedAt: text("first_viewed_at"),
      lastViewedAt: text("last_viewed_at"),
      voidedAt: text("voided_at"),
      createdAt: text("created_at").notNull(),
      updatedAt: text("updated_at").notNull(),
    },
    (t) => [index(`${prefix}__requests_status_idx`).on(t.status)],
  );

  /** One attempt by a signed-in visitor to pay a request with favors. */
  const payments = sqliteTable(
    `${prefix}__payments`,
    {
      id: text("id").primaryKey(),
      requestId: text("request_id").notNull(),
      accountId: text("account_id").notNull(),
      email: text("email"),
      amount: integer("amount").notNull(),
      status: text("status").notNull().default("awaiting"),
      favorRequestId: text("favor_request_id"),
      createdAt: text("created_at").notNull(),
      updatedAt: text("updated_at").notNull(),
      settledAt: text("settled_at"),
    },
    (t) => [index(`${prefix}__payments_request_idx`).on(t.requestId)],
  );

  /** Timeline of what happened to a request — the progress view reads this. */
  const events = sqliteTable(
    `${prefix}__events`,
    {
      id: integer("id").primaryKey({ autoIncrement: true }),
      requestId: text("request_id").notNull(),
      kind: text("kind").notNull(),
      detail: text("detail").notNull().default(""),
      at: text("at").notNull(),
    },
    (t) => [index(`${prefix}__events_request_idx`).on(t.requestId)],
  );

  const settings = sqliteTable(`${prefix}__settings`, {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
  });

  return { requests, payments, events, settings };
}

// drizzle-kit reads these top-level exports to generate migrations.
const defaultSchema = createAppDbSchema();
export const requests = defaultSchema.requests;
export const payments = defaultSchema.payments;
export const events = defaultSchema.events;
export const settings = defaultSchema.settings;
