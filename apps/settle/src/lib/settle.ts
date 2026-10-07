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

export type SettleOutcome = "settled" | "already" | "duplicate" | "declined" | "missing";

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

  if (!repo.closePayment(payment.id, "paid", favorRequestId ?? payment.favorRequestId)) return "already";

  const who = payment.email ?? "Someone";
  const amount = `${formatFavors(payment.amount)} ${favorWord(payment.amount)} (${usdFor(payment.amount)})`;
  const runAction = ctx.runAction.bind(ctx) as RunAction;

  if (repo.markPaid(request.id, { via: "favors", payerAccountId: payment.accountId, payerEmail: payment.email, paymentId: payment.id })) {
    repo.log(request.id, "paid", `${who} paid ${amount}`);
    await notifyGuardian(runAction, "Favor request paid", `${who} paid ${amount} for “${request.item}”.`, `/apps/settle/r/${request.id}`);
    return "settled";
  }

  // The request was already paid (or voided) when this charge landed.
  repo.log(request.id, "duplicate_payment", `${who} paid ${amount} after the request was ${request.status === "void" ? "voided" : "already paid"}`);
  await notifyGuardian(
    runAction,
    "Extra payment received",
    `${who} paid ${amount} for “${request.item}”, but the request was already ${request.status === "void" ? "voided" : "paid"}. Check the favor ledger and refund if needed.`,
    `/apps/settle/r/${request.id}`,
  );
  return "duplicate";
}

export function declinePayment(repo: LedgerRepository, paymentId: string, favorRequestId: string | null): boolean {
  const payment = repo.payment(paymentId);
  if (!payment) return false;
  if (!repo.closePayment(payment.id, "declined", favorRequestId)) return false;
  repo.log(payment.requestId, "declined", `${payment.email ?? "The payer"} declined the charge`);
  return true;
}
