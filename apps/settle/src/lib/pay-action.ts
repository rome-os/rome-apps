import {
  defineAction,
  getCurrentActionContext,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createLedgerRepository } from "../db/repositories/ledger.js";
import { settlePayment } from "./settle.js";

/**
 * Shared body of every `settle:pay_<amount>` action. Rome Cloud runs the
 * action after the payer approves the charge (the favor dispatcher passes
 * `favorActionRequestId` in the shared context). `item`, `payee` and
 * `reference` exist only for the consent screen; the payment row is the
 * source of truth. Idempotent: the payer's return sync may settle first.
 */
export function createPayAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  const tier = Number(/^pay_(\d+)$/.exec(config.name)?.[1] ?? NaN);
  return defineAction({
    config,
    schema: z.object({
      paymentId: z.string().uuid().describe("Settle payment id created by the Settle API"),
      item: z.string().max(200).optional().describe("What the favor is for (shown to the payer)"),
      payee: z.string().max(120).optional().describe("Who receives the favors (shown to the payer)"),
      reference: z.string().max(40).optional().describe("Request reference (shown to the payer)"),
    }),
    execute: async ({ paymentId }) => {
      const ctx = deps.appContext;
      const repo = createLedgerRepository(ctx.db);
      const payment = repo.payment(paymentId);
      if (!payment) return { status: "error", error: "Payment not found." };
      if (payment.amount !== tier) {
        return { status: "error", error: `This payment is for ${payment.amount} favors, not ${tier}.` };
      }
      const shared = getCurrentActionContext()?.sharedContext ?? {};
      const favorRequestId = typeof shared.favorActionRequestId === "string" ? shared.favorActionRequestId : null;
      const outcome = await settlePayment(ctx, repo, paymentId, favorRequestId);
      if (outcome === "missing") return { status: "error", error: "Request not found." };
      return { status: "ok", data: { paymentId, requestId: payment.requestId, outcome } };
    },
  });
}
