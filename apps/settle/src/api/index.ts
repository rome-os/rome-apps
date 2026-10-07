import {
  visitorAuthRequired,
  type RomeAppApiHandler,
  type RomeAppApiRequest,
  type RomeAppCaller,
  type RomeAppContext,
} from "@rome-os/app-runtime";
import { createLedgerRepository, isToken, type LedgerRepository, type PaymentRow, type RequestRow } from "../db/repositories/ledger.js";
import { HttpError, body, date, email, json, text, url, type Json } from "../lib/http.js";
import { avatarResponse, readProfile, removeAvatar, saveAvatar, saveProfile } from "../lib/profile.js";
import { declinePayment, failPayment, isTerminalFavorError, payPath, publicOrigin, rememberOrigin, settlePayment } from "../lib/settle.js";
import {
  favorWord,
  formatFavors,
  isTier,
  payeeName,
  tierActionName,
  type DashboardView,
  type PublicRequestView,
  type RequestView,
  type Tier,
} from "../shared/model.js";

type FavorResult = Awaited<ReturnType<RomeAppContext["favors"]["requestAction"]>>;

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

class SettleApi implements RomeAppApiHandler {
  private readonly repo: LedgerRepository;

  constructor(private readonly ctx: RomeAppContext) {
    this.repo = createLedgerRepository(ctx.db);
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    try {
      // Only the owner's own requests teach Settle its public origin; anyone else's headers could be forged.
      if (request.caller.kind === "guardian") rememberOrigin(request.headers, this.repo);
      return await this.route(request);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.code === "visitor_auth_required") return visitorAuthRequired(error.message);
        return json({ error: error.message }, { status: error.status });
      }
      this.ctx.log.error("Settle API error", { path: request.path.join("/"), error: String(error).slice(0, 500) });
      return json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  }

  private async route(request: RomeAppApiRequest): Promise<Response> {
    const { method, caller } = request;
    const p = request.path;
    const route = p.join("/");
    const isGuardian = caller.kind === "guardian";

    // ── Public: anyone with the link ───────────────────────────────────
    if (method === "GET" && route === "profile") return json(readProfile(this.repo));
    if ((method === "GET" || method === "HEAD") && route === "avatar") return avatarResponse(this.repo);
    if (p[0] === "p" && p.length >= 2) {
      const row = this.findRequest(p[1]);
      if (method === "GET" && p.length === 2) return json(this.publicView(row, caller, request.query.get("view") === "1"));
      if (method === "POST" && p[2] === "pay" && p.length === 3) return this.pay(row, caller, body(request));
      if (method === "POST" && p[2] === "sync" && p.length === 3) return this.sync(row, caller, body(request));
    }

    // ── Owner only ─────────────────────────────────────────────────────
    if (!isGuardian) throw new HttpError(404, "Not found.");

    if (method === "GET" && route === "dashboard") return json(this.dashboard());
    if (method === "PUT" && route === "profile") return json(this.updateProfile(body(request)));
    if (method === "POST" && route === "profile/avatar") return json(this.uploadAvatar(request));
    if (method === "DELETE" && route === "profile/avatar") return json(removeAvatar(this.repo));
    if (method === "POST" && route === "requests") return json({ request: this.createRequest(body(request)) }, { status: 201 });
    if (p[0] === "requests" && p.length >= 2) {
      const row = this.findRequest(p[1]);
      if (method === "GET" && p.length === 2) return json({ request: this.view(row, true) });
      if (method === "PATCH" && p.length === 2) return json({ request: this.editRequest(row, body(request)) });
      if (method === "DELETE" && p.length === 2) {
        if (!this.repo.deleteRequest(row.id)) {
          throw new HttpError(409, "Someone is paying this request on Rome Cloud right now. Withdraw it instead, or try again once their checkout ends.");
        }
        return json({ ok: true });
      }
      if (method === "POST" && p.length === 3) {
        if (p[2] === "void") return json({ request: this.voidRequest(row) });
        if (p[2] === "reopen") return json({ request: this.reopenRequest(row) });
        if (p[2] === "mark-paid") return json({ request: this.markPaidByHand(row, body(request)) });
      }
    }
    throw new HttpError(404, "Not found.");
  }

  // ── Views ──────────────────────────────────────────────────────────────

  private findRequest(id: string | undefined): RequestRow {
    const row = isToken(id) ? this.repo.request(id) : undefined;
    if (!row) throw new HttpError(404, "This request doesn't exist or was removed.");
    return row;
  }

  private link(id: string): string {
    const origin = publicOrigin(this.repo);
    return `${origin}${payPath(id)}`;
  }

  private view(row: RequestRow, withActivity = false): RequestView {
    return {
      id: row.id,
      item: row.item,
      details: row.details,
      recipientName: row.recipientName,
      recipientEmail: row.recipientEmail,
      amount: row.amount,
      dueDate: row.dueDate,
      status: row.status as RequestView["status"],
      paidVia: (row.paidVia as RequestView["paidVia"]) ?? null,
      payerEmail: row.payerEmail,
      paidAt: row.paidAt,
      viewCount: row.viewCount,
      firstViewedAt: row.firstViewedAt,
      lastViewedAt: row.lastViewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      voidedAt: row.voidedAt,
      pendingPayment: row.status === "open" && this.repo.hasActiveCheckout(row.id),
      link: this.link(row.id),
      ...(withActivity
        ? { activity: this.repo.events(row.id).map((e) => ({ kind: e.kind as never, detail: e.detail, at: e.at })) }
        : {}),
    };
  }

  private dashboard(): DashboardView {
    const rows = this.repo.requests();
    const paid = rows.filter((r) => r.status === "paid");
    const open = rows.filter((r) => r.status === "open");
    return {
      profile: readProfile(this.repo),
      requests: rows.map((r) => this.view(r)),
      totals: {
        collected: paid.reduce((n, r) => n + r.amount, 0),
        outstanding: open.reduce((n, r) => n + r.amount, 0),
        paidCount: paid.length,
        openCount: open.length,
      },
      origin: publicOrigin(this.repo),
    };
  }

  private publicView(row: RequestRow, caller: RomeAppCaller, countView: boolean): PublicRequestView {
    const accountId = caller.kind === "visitor" ? caller.accountId : null;
    if (countView && caller.kind !== "guardian") {
      const first = this.repo.recordView(row.id);
      if (first) this.repo.log(row.id, "viewed", caller.kind === "visitor" ? `Opened by ${caller.email}` : "Link opened");
      row = this.repo.request(row.id) ?? row;
    }
    const pending = accountId && row.status === "open" ? this.repo.openPayment(row.id, accountId, row.amount) : undefined;
    return {
      id: row.id,
      item: row.item,
      details: row.details,
      recipientName: row.recipientName,
      amount: row.amount,
      dueDate: row.dueDate,
      status: row.status as PublicRequestView["status"],
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      profile: readProfile(this.repo),
      viewer: {
        kind: caller.kind,
        email: caller.kind === "visitor" ? caller.email : null,
        isPayer: !!accountId && row.payerAccountId === accountId,
        pendingPaymentId: pending?.id ?? null,
      },
    };
  }

  // ── Owner writes ───────────────────────────────────────────────────────

  private amount(value: unknown): Tier {
    const n = typeof value === "string" ? Number(value) : value;
    if (!isTier(n)) throw new HttpError(400, "Choose one of the favor amounts.");
    return n;
  }

  private createRequest(input: Json): RequestView {
    const row = this.repo.createRequest({
      item: text(input.item, "Item", 140, { required: true }),
      details: text(input.details, "Details", 2000),
      recipientName: text(input.recipientName, "Recipient name", 120),
      recipientEmail: email(input.recipientEmail),
      amount: this.amount(input.amount),
      dueDate: date(input.dueDate),
    });
    return this.view(row, true);
  }

  private editRequest(row: RequestRow, input: Json): RequestView {
    const patch: Partial<RequestRow> = {};
    if ("item" in input) patch.item = text(input.item, "Item", 140, { required: true });
    if ("details" in input) patch.details = text(input.details, "Details", 2000);
    if ("recipientName" in input) patch.recipientName = text(input.recipientName, "Recipient name", 120);
    if ("recipientEmail" in input) patch.recipientEmail = email(input.recipientEmail);
    if ("dueDate" in input) patch.dueDate = date(input.dueDate);
    if ("amount" in input) {
      const amount = this.amount(input.amount);
      if (amount !== row.amount && row.status === "paid") throw new HttpError(409, "This request is already paid, so its amount is final.");
      patch.amount = amount;
    }
    const changed = Object.entries(patch).filter(([k, v]) => (row as Record<string, unknown>)[k] !== v);
    if (!changed.length) return this.view(row, true);
    const amountChanged = patch.amount !== undefined && patch.amount !== row.amount;
    if (amountChanged) {
      const { amount, ...rest } = patch;
      if (!this.repo.changeAmount(row.id, amount!, rest)) {
        throw new HttpError(409, "Someone is paying the current amount on Rome Cloud right now, so it can't change until their checkout ends.");
      }
    } else {
      this.repo.updateRequest(row.id, patch);
    }
    const next = this.repo.request(row.id)!;
    const amountNote =
      patch.amount !== undefined && patch.amount !== row.amount
        ? `Amount ${formatFavors(row.amount)} → ${formatFavors(patch.amount)} ${favorWord(patch.amount)}`
        : "";
    this.repo.log(row.id, "edited", amountNote || "Details updated");
    return this.view(next, true);
  }

  private voidRequest(row: RequestRow): RequestView {
    if (row.status === "paid") throw new HttpError(409, "A paid request can't be voided.");
    if (row.status === "void") return this.view(row, true);
    const next = this.repo.updateRequest(row.id, { status: "void", voidedAt: new Date().toISOString() })!;
    this.repo.log(row.id, "voided", "");
    return this.view(next, true);
  }

  private reopenRequest(row: RequestRow): RequestView {
    if (row.status === "open") return this.view(row, true);
    if (row.status === "paid" && row.paidVia === "favors") {
      throw new HttpError(409, "This request was paid with favors on Rome Cloud, so it stays paid.");
    }
    const next = this.repo.updateRequest(row.id, {
      status: "open",
      voidedAt: null,
      paidVia: null,
      paidAt: null,
      payerAccountId: null,
      payerEmail: null,
      paymentId: null,
    })!;
    this.repo.log(row.id, "reopened", "");
    return this.view(next, true);
  }

  private markPaidByHand(row: RequestRow, input: Json): RequestView {
    if (row.status !== "open") throw new HttpError(409, row.status === "paid" ? "Already paid." : "Reopen this request first.");
    const note = text(input.note, "Note", 200);
    this.repo.markPaid(row.id, { via: "manual" });
    this.repo.log(row.id, "marked_paid", note || "Marked paid by hand");
    return this.view(this.repo.request(row.id)!, true);
  }

  private updateProfile(input: Json) {
    return saveProfile(this.repo, {
      ...("name" in input ? { name: text(input.name, "Name", 80, { required: true }) } : {}),
      ...("title" in input ? { title: text(input.title, "Title", 80) } : {}),
      ...("company" in input ? { company: text(input.company, "Company", 80) } : {}),
      ...("bio" in input ? { bio: text(input.bio, "Bio", 280) } : {}),
      ...("website" in input ? { website: url(input.website) } : {}),
    });
  }

  private uploadAvatar(request: RomeAppApiRequest) {
    const type = String(request.headers["content-type"] ?? request.headers["Content-Type"] ?? "").split(";")[0].trim().toLowerCase();
    const bytes = request.body;
    if (!bytes?.byteLength) throw new HttpError(400, "Choose an image.");
    if (bytes.byteLength > MAX_AVATAR_BYTES) throw new HttpError(413, "Use an image under 3 MB.");
    try {
      return saveAvatar(this.repo, type, bytes);
    } catch (error) {
      throw new HttpError(415, error instanceof Error ? error.message : "Unsupported image.");
    }
  }

  // ── Paying ─────────────────────────────────────────────────────────────

  /** The exact favor request for a payment. Re-sent verbatim on sync (same idempotency key → no second charge). */
  private favorRequest(payment: PaymentRow, row: RequestRow) {
    const profile = readProfile(this.repo);
    return {
      actionName: `settle:${tierActionName(payment.amount as Tier)}`,
      args: {
        paymentId: payment.id,
        item: row.item.slice(0, 200),
        payee: (profile.company ? `${payeeName(profile)} · ${profile.company}` : payeeName(profile)).slice(0, 120),
        reference: row.id,
      },
      taskRef: { requestId: row.id, paymentId: payment.id },
      idempotencyKey: `settle-payment:${payment.id}`,
    };
  }

  private async pay(row: RequestRow, caller: RomeAppCaller, input: Json): Promise<Response> {
    if (caller.kind === "guardian") {
      throw new HttpError(409, "This is your own request — share the link so the other person can pay.");
    }
    if (caller.kind !== "visitor") throw new HttpError(401, "Sign in with Rome Cloud to pay with favors.", "visitor_auth_required");
    if (row.status === "paid") return json({ status: "paid" });
    if (row.status === "void") throw new HttpError(409, "This request was withdrawn, so there's nothing to pay.");
    if (!isTier(row.amount)) throw new HttpError(409, "This request has an unsupported amount. Ask the sender to update it.");

    let payment = this.repo.openPayment(row.id, caller.accountId, row.amount);
    if (!payment) {
      payment = this.repo.createPayment({ requestId: row.id, accountId: caller.accountId, email: caller.email, amount: row.amount });
      this.repo.log(row.id, "payment_started", `${caller.email} started paying ${formatFavors(row.amount)} ${favorWord(row.amount)}`);
    }

    const request = (p: PaymentRow) => {
      this.repo.updatePayment(p.id, {}); // renew the edit/delete lock before Cloud can (re)issue consent
      return this.ctx.favors.requestAction({ ...this.favorRequest(p, row), returnTo: `${payPath(row.id)}?payment=${p.id}` });
    };
    let favor = await request(payment);
    if (favor.status === "error" && isTerminalFavorError(favor.error)) {
      // The earlier checkout expired on Rome Cloud and its idempotency key can't be reused. Close it and
      // acquire-or-create one replacement in a single transaction, so concurrent retries share it.
      const expired = favor.error;
      const replacement = this.repo.transaction(() => {
        failPayment(this.repo, payment!.id, expired);
        const current = this.repo.request(row.id);
        if (!current || current.status !== "open" || current.amount !== row.amount) return null;
        return this.repo.openPayment(row.id, caller.accountId, row.amount) ?? this.repo.createPayment({ requestId: row.id, accountId: caller.accountId, email: caller.email, amount: row.amount });
      });
      if (!replacement) return json({ status: "expired", paymentId: payment.id });
      payment = replacement;
      favor = await request(payment);
    }
    return this.favorResponse(payment, favor);
  }

  private async sync(row: RequestRow, caller: RomeAppCaller, input: Json): Promise<Response> {
    if (caller.kind !== "visitor") {
      return json({ status: row.status === "paid" ? "paid" : row.status === "void" ? "void" : "open" });
    }
    const paymentId = typeof input.paymentId === "string" ? input.paymentId : "";
    const payment = paymentId ? this.repo.payment(paymentId) : undefined;
    if (!payment || payment.requestId !== row.id || payment.accountId !== caller.accountId) {
      throw new HttpError(404, "Payment not found.");
    }
    if (payment.status !== "awaiting") return json({ status: payment.status });
    this.repo.updatePayment(payment.id, {}); // renew the edit/delete lock before Cloud can renew consent
    const favor = await this.ctx.favors.requestAction(this.favorRequest(payment, row));
    return this.favorResponse(payment, favor);
  }

  private async favorResponse(payment: PaymentRow, favor: FavorResult): Promise<Response> {
    switch (favor.status) {
      case "pending_consent":
        this.repo.updatePayment(payment.id, { favorRequestId: favor.requestId });
        return json({ status: "pending_consent", paymentId: payment.id, authorizationUrl: favor.authorizationUrl ?? null });
      case "queued": {
        const state = favor.request.status;
        if (state === "settled") {
          await settlePayment(this.ctx, this.repo, payment.id, favor.request.id);
          return json({ status: "paid", paymentId: payment.id });
        }
        if (state === "declined" || state === "expired" || state === "failed") {
          declinePayment(this.repo, payment.id, favor.request.id);
          return json({ status: "declined", paymentId: payment.id });
        }
        this.repo.updatePayment(payment.id, { favorRequestId: favor.request.id });
        return json({ status: "processing", paymentId: payment.id });
      }
      case "declined":
        declinePayment(this.repo, payment.id, favor.requestId);
        return json({ status: "declined", paymentId: payment.id });
      default: {
        const error = favor.status === "error" ? favor.error : "unknown";
        if (isTerminalFavorError(error)) {
          failPayment(this.repo, payment.id, error);
          return json({ status: "expired", paymentId: payment.id });
        }
        if (error === "visitor_auth_required" || error === "visitor_favor_auth_required") {
          throw new HttpError(401, "Sign in with Rome Cloud to pay with favors.", "visitor_auth_required");
        }
        this.ctx.log.error("Favor request failed", { paymentId: payment.id, error });
        throw new HttpError(502, "We couldn't reach Rome Cloud to start the payment. Please try again in a moment.");
      }
    }
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new SettleApi(ctx);
}
