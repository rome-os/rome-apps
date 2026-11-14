import { costKind, type CostInfo } from "../../lib/cost";
import { formatUsd } from "../api";
import { useI18n } from "../i18n";

export function CostValue({ value }: { value: CostInfo }) {
  const { t } = useI18n();
  const kind = costKind(value);
  if (kind === "base_estimate") return <span>{t("cost.baseEstimate", { cost: formatUsd(value.costUsd ?? null) })}</span>;
  return <span>{t(kind === "not_billed" ? "cost.notBilled" : "cost.unknown")}</span>;
}
