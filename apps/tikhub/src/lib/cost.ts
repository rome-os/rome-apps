/** Shared interpretation for action errors and UI. Estimates are not settlement. */
export interface CostInfo {
  status?: string;
  costUsd?: number | null;
  costBasis?: "base_estimate" | "not_billed" | "unknown";
  outcomeUnknown?: boolean;
}

export type CostKind = "base_estimate" | "not_billed" | "unknown";

export function costKind(value: CostInfo): CostKind {
  if (value.outcomeUnknown || value.status === "outcome_unknown" || value.status === "pending") return "unknown";
  // A dry run may carry a prospective quote, not incurred spend.
  if (value.status === "blocked" || value.status === "dry_run") return "not_billed";
  if (value.costBasis === "unknown") return "unknown";
  if (typeof value.costUsd !== "number" || !Number.isFinite(value.costUsd) || value.costUsd < 0) return "unknown";
  if (value.costUsd > 0 || value.costBasis === "base_estimate") return "base_estimate";
  return "not_billed";
}
