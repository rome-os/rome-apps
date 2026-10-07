import type { ActionResult, RomeAppContext } from "@rome-os/app-runtime";
import type { LedgerRepository } from "../db/repositories/ledger.js";
import { favorWord, formatFavors, usdFor } from "../shared/model.js";

type RunAction = (name: string, args: Record<string, unknown>) => Promise<ActionResult>;

const ORIGIN_KEY = "public_origin";
let rememberedOrigin: string | null = null;

/** Remember the public origin payers reach us on, so links and notices can be absolute. */
export function rememberOrigin(headers: Record<string, string>, repo: LedgerRepository): void {
  const host = headers["x-forwarded-host"] || headers["X-Forwarded-Host"] || headers["host"] || headers["Host"];
  if (!host || /^(127\.|localhost|0\.0\.0\.0|\[::1\])/.test(host)) return;
  // Public hosts are served over HTTPS by the edge proxy even when it forwards plain http.
  const origin = `https://${host.split(",")[0].trim()}`;
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return;
  if (origin !== rememberedOrigin) {
    rememberedOrigin = origin;
    if (repo.setting(ORIGIN_KEY) !== origin) repo.setSetting(ORIGIN_KEY, origin);
  }
}

export function publicOrigin(repo: LedgerRepository): string {
  return rememberedOrigin ?? repo.setting(ORIGIN_KEY) ?? "";
}

export function payPath(id: string): string {
  return `/apps/settle/p/${id}`;
}

/** Tell the guardian in webchat (email as fallback). Never throws. */
export async function notifyGuardian(runAction: RunAction, subject: string, body: string, path: string): Promise<void> {
  const attempts = [
    { channel: "webchat", to: "guardian", text: `**${subject}**\n\n${body}\n\n[Open in Settle](${path})` },
    { channel: "email", to: "guardian", subject: `Settle · ${subject}`, text: body },
  ];
  for (const args of attempts) {
    try {
      const result = await runAction("system:send_message", args);
      if (result.status === "ok") return;
    } catch {
      /* try the next channel */
    }
  }
}

export type SettleOutcome = "settled" | "already" | "duplicate" | "mismatch" | "declined" | "missing";

/**
 * Settle a favor payment exactly once. Called by the favor-dispatched
 * `settle:pay_<amount>` action and by the payer's post-payment sync —
 * whichever sees the settled charge first wins; the other gets "already".
 */
export async function settlePayment(
  ctx: Pick<RomeAppContext, "runAction">,
  repo: LedgerRepository,
  paymentId: string,
  favorRequestId: string | null,
): Promise<SettleOutcome> {
  const payment = repo.payment(paymentId);
  if (!payment) return "missing";
  const request = repo.request(payment.requestId);
  if (!request) return "missing";
  if (payment.status === "paid") return "already";

  const who = payment.email ?? "Someone";
  const amount = `${formatFavors(payment.amount)} ${favorWord(payment.amount)} (${usdFor(payment.amount)})`;

  // Payment, request and activity change together or not at all, so a crash
  // can't leave a paid charge against an open request.
  const outcome = repo.transaction((): SettleOutcome => {
    if (!repo.closePayment(payment.id, "paid", favorRequestId ?? payment.favorRequestId)) return "already";
    const current = repo.request(request.id);
    if (
      repo.markPaid(request.id, {
        via: "favors",
        payerAccountId: payment.accountId,
        payerEmail: payment.email,
        paymentId: payment.id,
        amount: payment.amount,
      })
    ) {
      repo.log(request.id, "paid", `${who} paid ${amount}`);
      return "settled";
    }
    if (current?.status === "open") {
      repo.log(request.id, "duplicate_payment", `${who} paid ${amount}, but the request now asks for ${formatFavors(current.amount)} ${favorWord(current.amount)}`);
      return "mismatch";
    }
    repo.log(request.id, "duplicate_payment", `${who} paid ${amount} after the request was ${current?.status === "void" ? "voided" : "already paid"}`);
    return "duplicate";
  });

  // Notify only after the transaction committed.
  const runAction = ctx.runAction.bind(ctx) as RunAction;
  const path = `/apps/settle/r/${request.id}`;
  if (outcome === "settled") {
    await notifyGuardian(runAction, "Favor request paid", `${who} paid ${amount} for “${request.item}”.`, path);
  } else if (outcome === "mismatch") {
    await notifyGuardian(
      runAction,
      "Payment at an old amount",
      `${who} paid ${amount} for “${request.item}”, but the request's amount had changed, so it is still open. Check the favor ledger and refund or adjust.`,
      path,
    );
  } else if (outcome === "duplicate") {
    const state = repo.request(request.id)?.status === "void" ? "voided" : "paid";
    await notifyGuardian(
      runAction,
      "Extra payment received",
      `${who} paid ${amount} for “${request.item}”, but the request was already ${state}. Check the favor ledger and refund if needed.`,
      path,
    );
  }
  return outcome;
}

export function declinePayment(repo: LedgerRepository, paymentId: string, favorRequestId: string | null): boolean {
  const payment = repo.payment(paymentId);
  if (!payment) return false;
  return repo.transaction(() => {
    if (!repo.closePayment(payment.id, "declined", favorRequestId)) return false;
    repo.log(payment.requestId, "declined", `${payment.email ?? "The payer"} declined the charge`);
    return true;
  });
}

/** Rome Cloud's answer for a checkout that can never complete (expired or failed). */
export function isTerminalFavorError(error: string): boolean {
  return error === "expired" || error === "favor_request_failed";
}

/** Close a checkout Rome Cloud reports as expired/failed so a new one can start. */
export function failPayment(repo: LedgerRepository, paymentId: string, reason: string): boolean {
  const payment = repo.payment(paymentId);
  if (!payment) return false;
  return repo.transaction(() => {
    if (!repo.closePayment(payment.id, "failed", payment.favorRequestId)) return false;
    repo.log(payment.requestId, "declined", `Checkout ${reason === "expired" ? "expired" : "failed"} on Rome Cloud; nothing was charged`);
    return true;
  });
}
