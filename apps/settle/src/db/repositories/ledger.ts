import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";
import type { EventKind, PaidVia, PaymentStatus, RequestStatus } from "../../shared/model.js";

type Schema = ReturnType<typeof createAppDbSchema>;
export type RequestRow = Schema["requests"]["$inferSelect"];
export type PaymentRow = Schema["payments"]["$inferSelect"];
export type EventRow = Schema["events"]["$inferSelect"];

export const now = (): string => new Date().toISOString();

/** Rome Cloud's favor-request lifetime (30 min) plus a margin for clock skew. */
export const CHECKOUT_LOCK_MS = 35 * 60 * 1000;

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** 14 chars from a 55-symbol alphabet ≈ 81 bits — unguessable, short enough to share. */
export function newToken(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = "";
  for (const b of bytes) {
    if (b >= ALPHABET.length * 4) continue; // reject to keep the distribution uniform
    out += ALPHABET[b % ALPHABET.length];
    if (out.length === length) break;
  }
  return out.length === length ? out : newToken(length);
}

export function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[23456789a-zA-Z]{14}$/.test(value);
}

export interface NewRequest {
  item: string;
  details: string;
  recipientName: string;
  recipientEmail: string;
  amount: number;
  dueDate: string | null;
}

export class LedgerRepository {
  readonly t: Schema;
  private readonly db: DrizzleDb;

  constructor(ctx: AppDbContext) {
    this.db = ctx.connection;
    this.t = createAppDbSchema(ctx.tablePrefix);
  }

  /** Run synchronous ledger writes as one SQLite transaction (all or nothing). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(() => fn());
  }

  // ── Requests ─────────────────────────────────────────────────────────

  request(id: string): RequestRow | undefined {
    return this.db.select().from(this.t.requests).where(eq(this.t.requests.id, id)).get();
  }

  requests(): RequestRow[] {
    return this.db.select().from(this.t.requests).orderBy(desc(this.t.requests.createdAt)).all();
  }

  createRequest(input: NewRequest): RequestRow {
    const at = now();
    const row = { id: newToken(), ...input, status: "open" as RequestStatus, createdAt: at, updatedAt: at };
    this.db.insert(this.t.requests).values(row).run();
    this.log(row.id, "created", "");
    return this.request(row.id)!;
  }

  updateRequest(id: string, patch: Partial<Omit<RequestRow, "id" | "createdAt">>): RequestRow | undefined {
    this.db
      .update(this.t.requests)
      .set({ ...patch, updatedAt: now() })
      .where(eq(this.t.requests.id, id))
      .run();
    return this.request(id);
  }

  /**
   * Delete a request and its history. Refused (returns false) while a payer
   * is in Rome Cloud checkout: that charge can still settle and must find
   * its payment row to get a receipt or a refund notice.
   */
  deleteRequest(id: string): boolean {
    return this.transaction(() => {
      if (this.hasActiveCheckout(id)) return false;
      this.deleteRequestRows(id);
      return true;
    });
  }

  private deleteRequestRows(id: string): void {
    this.db.delete(this.t.events).where(eq(this.t.events.requestId, id)).run();
    this.db.delete(this.t.payments).where(eq(this.t.payments.requestId, id)).run();
    this.db.delete(this.t.requests).where(eq(this.t.requests.id, id)).run();
  }

  /** Count a payer-side view. Returns true when this is the first one. */
  recordView(id: string): boolean {
    const at = now();
    const before = this.request(id);
    if (!before) return false;
    this.db
      .update(this.t.requests)
      .set({
        viewCount: sql`${this.t.requests.viewCount} + 1`,
        lastViewedAt: at,
        firstViewedAt: before.firstViewedAt ?? at,
      })
      .where(eq(this.t.requests.id, id))
      .run();
    return !before.firstViewedAt;
  }

  /**
   * Mark a request paid exactly once. Returns false when it was already paid
   * or void — or, with `amount`, when the request no longer asks for that
   * amount — so concurrent settlements can't both win.
   */
  markPaid(
    id: string,
    input: { via: PaidVia; payerAccountId?: string | null; payerEmail?: string | null; paymentId?: string | null; amount?: number },
  ): boolean {
    const at = now();
    const result = this.db
      .update(this.t.requests)
      .set({
        status: "paid",
        paidVia: input.via,
        payerAccountId: input.payerAccountId ?? null,
        payerEmail: input.payerEmail ?? null,
        paymentId: input.paymentId ?? null,
        paidAt: at,
        updatedAt: at,
      })
      .where(
        and(
          eq(this.t.requests.id, id),
          eq(this.t.requests.status, "open"),
          input.amount === undefined ? undefined : eq(this.t.requests.amount, input.amount),
        ),
      )
      .run() as unknown as { changes?: number };
    return (result?.changes ?? 0) > 0;
  }

  /**
   * Change a request's amount unless a payer is mid-checkout at the current
   * price. Check and write share one transaction. Returns false when blocked.
   */
  changeAmount(id: string, amount: number, patch: Partial<Omit<RequestRow, "id" | "createdAt">>): boolean {
    return this.transaction(() => {
      if (this.hasActiveCheckout(id)) return false;
      this.updateRequest(id, { ...patch, amount });
      return true;
    });
  }

  // ── Payments ─────────────────────────────────────────────────────────

  payment(id: string): PaymentRow | undefined {
    return this.db.select().from(this.t.payments).where(eq(this.t.payments.id, id)).get();
  }

  /** The visitor's in-flight payment for this request, reused so re-clicks don't stack charges. */
  openPayment(requestId: string, accountId: string, amount: number): PaymentRow | undefined {
    return this.db
      .select()
      .from(this.t.payments)
      .where(
        and(
          eq(this.t.payments.requestId, requestId),
          eq(this.t.payments.accountId, accountId),
          eq(this.t.payments.amount, amount),
          eq(this.t.payments.status, "awaiting"),
        ),
      )
      .orderBy(desc(this.t.payments.createdAt))
      .get();
  }

  /**
   * Whether a payer may still complete a Rome Cloud checkout for this request.
   * Cloud expires an unapproved favor request 30 minutes after it is created,
   * so an older `awaiting` row (an abandoned checkout) no longer locks the
   * request. A charge approved in time but reported late is still caught by
   * settlement's amount/status guard and flagged to the owner.
   */
  hasActiveCheckout(requestId: string, at: Date = new Date()): boolean {
    const cutoff = new Date(at.getTime() - CHECKOUT_LOCK_MS).toISOString();
    return !!this.db
      .select({ id: this.t.payments.id })
      .from(this.t.payments)
      .where(
        and(
          eq(this.t.payments.requestId, requestId),
          eq(this.t.payments.status, "awaiting"),
          gt(this.t.payments.createdAt, cutoff),
        ),
      )
      .get();
  }

  createPayment(input: { requestId: string; accountId: string; email: string | null; amount: number }): PaymentRow {
    const at = now();
    const row = { id: crypto.randomUUID(), ...input, status: "awaiting" as PaymentStatus, createdAt: at, updatedAt: at };
    this.db.insert(this.t.payments).values(row).run();
    return row as PaymentRow;
  }

  updatePayment(id: string, patch: Partial<Omit<PaymentRow, "id" | "createdAt">>): void {
    this.db
      .update(this.t.payments)
      .set({ ...patch, updatedAt: now() })
      .where(eq(this.t.payments.id, id))
      .run();
  }

  /** Move a payment out of `awaiting` once. Returns false if another path already did. */
  closePayment(id: string, status: Exclude<PaymentStatus, "awaiting">, favorRequestId: string | null): boolean {
    const at = now();
    const result = this.db
      .update(this.t.payments)
      .set({ status, favorRequestId, updatedAt: at, settledAt: status === "paid" ? at : null })
      .where(and(eq(this.t.payments.id, id), eq(this.t.payments.status, "awaiting")))
      .run() as unknown as { changes?: number };
    return (result?.changes ?? 0) > 0;
  }

  // ── Activity ─────────────────────────────────────────────────────────

  log(requestId: string, kind: EventKind, detail: string): void {
    this.db.insert(this.t.events).values({ requestId, kind, detail, at: now() }).run();
  }

  events(requestId: string): EventRow[] {
    return this.db.select().from(this.t.events).where(eq(this.t.events.requestId, requestId)).orderBy(asc(this.t.events.id)).all();
  }

  // ── Settings ─────────────────────────────────────────────────────────

  setting(key: string): string | null {
    return this.db.select().from(this.t.settings).where(eq(this.t.settings.key, key)).get()?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .insert(this.t.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: this.t.settings.key, set: { value } })
      .run();
  }
}

export function createLedgerRepository(ctx: AppDbContext): LedgerRepository {
  return new LedgerRepository(ctx);
}
