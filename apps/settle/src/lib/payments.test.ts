import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDbContext, DrizzleDb, RomeAppApiRequest, RomeAppContext } from "@rome-os/app-runtime";
import { createApiHandler } from "../api/index.js";
import { LedgerRepository } from "../db/repositories/ledger.js";
import { settlePayment } from "./settle.js";

function appDb(): AppDbContext {
  const sqlite = new Database(":memory:");
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  return { connection: drizzle(sqlite) as unknown as DrizzleDb, tablePrefix: "settle", tableName: (n: string) => `settle__${n}` };
}

const visitor = { kind: "visitor", accountId: "acct-1", email: "payer@example.com" } as const;
const guardian = { kind: "guardian", userId: "owner", via: "loopback" } as const;

let db: AppDbContext;
let repo: LedgerRepository;
let notices: Array<Record<string, unknown>>;
let favorResults: Array<Awaited<ReturnType<RomeAppContext["favors"]["requestAction"]>>>;
let ctx: RomeAppContext;

beforeEach(() => {
  db = appDb();
  repo = new LedgerRepository(db);
  notices = [];
  favorResults = [];
  ctx = {
    db,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    runAction: async (_name: string, args: Record<string, unknown>) => {
      notices.push(args);
      return { status: "ok", data: {} };
    },
    favors: { requestAction: vi.fn(async () => favorResults.shift() ?? { status: "error", error: "no stub" }) },
  } as unknown as RomeAppContext;
});

function newRequest(amount = 10) {
  return repo.createRequest({ item: "Deck review", details: "", recipientName: "", recipientEmail: "", amount, dueDate: null });
}

function age(paymentId: string, minutes: number) {
  const at = new Date(Date.now() - minutes * 60_000).toISOString();
  db.connection.run(sql`UPDATE settle__payments SET created_at = ${at} WHERE id = ${paymentId}`);
}

async function call(method: string, path: string[], caller: RomeAppApiRequest["caller"], payload?: unknown, headers: Record<string, string> = {}) {
  const res = await createApiHandler(ctx).handle({
    method,
    path,
    headers,
    query: new URLSearchParams(),
    body: payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload)),
    caller,
  } as RomeAppApiRequest);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

describe("settlement", () => {
  it("settles once and notifies once", async () => {
    const row = newRequest();
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: "payer@example.com", amount: 10 });

    expect(await settlePayment(ctx, repo, payment.id, "fr-1")).toBe("settled");
    expect(await settlePayment(ctx, repo, payment.id, "fr-1")).toBe("already");
    expect(repo.request(row.id)?.status).toBe("paid");
    expect(notices).toHaveLength(1);
  });

  it("rolls back the payment when the request write fails, so a retry can settle", async () => {
    const row = newRequest();
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: null, amount: 10 });
    const markPaid = vi.spyOn(repo, "markPaid").mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    await expect(settlePayment(ctx, repo, payment.id, "fr-1")).rejects.toThrow("disk full");
    expect(repo.payment(payment.id)?.status).toBe("awaiting");
    expect(repo.request(row.id)?.status).toBe("open");
    expect(notices).toHaveLength(0);

    markPaid.mockRestore();
    expect(await settlePayment(ctx, repo, payment.id, "fr-1")).toBe("settled");
    expect(repo.request(row.id)?.status).toBe("paid");
  });

  it("never marks a request paid at an amount it no longer asks for", async () => {
    const row = newRequest(10);
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: null, amount: 10 });
    repo.updateRequest(row.id, { amount: 5000 }); // bypasses the API lock, e.g. a pre-fix edit

    expect(await settlePayment(ctx, repo, payment.id, "fr-1")).toBe("mismatch");
    expect(repo.request(row.id)?.status).toBe("open");
    expect(String(notices[0]?.text)).toContain("amount had changed");
  });
});

describe("owner edits during checkout", () => {
  it("blocks amount changes while a payer is in checkout, and allows them after", async () => {
    const row = newRequest(10);
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: null, amount: 10 });

    const blocked = await call("PATCH", ["requests", row.id], guardian, { amount: 5000 });
    expect(blocked.status).toBe(409);
    expect(repo.request(row.id)?.amount).toBe(10);

    expect(await call("PATCH", ["requests", row.id], guardian, { item: "Deck + memo review" })).toMatchObject({ status: 200 });

    repo.closePayment(payment.id, "declined", null);
    expect(await call("PATCH", ["requests", row.id], guardian, { amount: 5000 })).toMatchObject({ status: 200 });
    expect(repo.request(row.id)?.amount).toBe(5000);
  });

  it("refuses to delete a request with a checkout in flight, keeping its payment row", async () => {
    const row = newRequest();
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: null, amount: 10 });

    expect((await call("DELETE", ["requests", row.id], guardian)).status).toBe(409);
    expect(repo.payment(payment.id)).toBeDefined();

    repo.closePayment(payment.id, "declined", null);
    expect((await call("DELETE", ["requests", row.id], guardian)).status).toBe(200);
    expect(repo.request(row.id)).toBeUndefined();
  });
});

describe("abandoned checkouts", () => {
  it("stop locking the request once Rome Cloud would have expired them", async () => {
    const row = newRequest(10);
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: null, amount: 10 });
    expect((await call("PATCH", ["requests", row.id], guardian, { amount: 25 })).status).toBe(409);

    age(payment.id, 40);
    expect((await call("PATCH", ["requests", row.id], guardian, { amount: 25 })).status).toBe(200);
    expect((await call("DELETE", ["requests", row.id], guardian)).status).toBe(200);
  });
});

describe("public origin", () => {
  it("is learned from the owner's requests, never from anyone else's headers", async () => {
    const row = newRequest();
    await call("GET", ["p", row.id], { kind: "anonymous" }, undefined, { "x-forwarded-host": "attacker.example" });
    expect(repo.setting("public_origin")).toBeNull();

    await call("GET", ["dashboard"], { kind: "guardian", userId: "owner", via: "cookie" }, undefined, { host: "owner.romeos.cc" });
    expect(repo.setting("public_origin")).toBe("https://owner.romeos.cc");
  });
});

describe("expired checkouts", () => {
  it("gives concurrent retries after an expiry one shared replacement checkout", async () => {
    const row = newRequest();
    repo.createPayment({ requestId: row.id, accountId: "acct-1", email: "payer@example.com", amount: 10 });
    favorResults = [
      { status: "error", error: "expired" },
      { status: "error", error: "expired" },
      { status: "pending_consent", requestId: "fr-2", authorizationUrl: "https://cloud.example/a" },
      { status: "pending_consent", requestId: "fr-2", authorizationUrl: "https://cloud.example/a" },
    ];

    const [a, b] = await Promise.all([call("POST", ["p", row.id, "pay"], visitor, {}), call("POST", ["p", row.id, "pay"], visitor, {})]);

    expect(a.data.paymentId).toBe(b.data.paymentId);
    const awaiting = db.connection.all(sql`SELECT id FROM settle__payments WHERE status = 'awaiting'`);
    expect(awaiting).toHaveLength(1);
    const keys = vi.mocked(ctx.favors.requestAction).mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[2]).toBe(keys[3]);
  });

  it("starts a fresh checkout when Rome Cloud says the earlier one expired", async () => {
    const row = newRequest();
    const old = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: "payer@example.com", amount: 10 });
    favorResults = [
      { status: "error", error: "expired" },
      { status: "pending_consent", requestId: "fr-2", authorizationUrl: "https://cloud.example/consent" },
    ];

    const res = await call("POST", ["p", row.id, "pay"], visitor, {});

    expect(res.data).toMatchObject({ status: "pending_consent", authorizationUrl: "https://cloud.example/consent" });
    expect(res.data.paymentId).not.toBe(old.id);
    expect(repo.payment(old.id)?.status).toBe("failed");
    const keys = vi.mocked(ctx.favors.requestAction).mock.calls.map(([input]) => input.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("closes an expired checkout on sync but keeps it open on a transient error", async () => {
    const row = newRequest();
    const payment = repo.createPayment({ requestId: row.id, accountId: "acct-1", email: null, amount: 10 });

    favorResults = [{ status: "error", error: "fetch failed" }];
    expect((await call("POST", ["p", row.id, "sync"], visitor, { paymentId: payment.id })).status).toBe(502);
    expect(repo.payment(payment.id)?.status).toBe("awaiting");

    favorResults = [{ status: "error", error: "favor_request_failed" }];
    expect((await call("POST", ["p", row.id, "sync"], visitor, { paymentId: payment.id })).data).toMatchObject({ status: "expired" });
    expect(repo.payment(payment.id)?.status).toBe("failed");
  });
});
