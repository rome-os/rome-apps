import { Badge } from "@rome-os/ui/badge";
import type { DistillStatus } from "../lib/api";

const LABELS: Record<DistillStatus, string> = {
  pending: "Processing",
  ready: "Ready",
  error: "Error",
};

const VARIANTS: Record<DistillStatus, "info" | "success" | "destructive"> = {
  pending: "info",
  ready: "success",
  error: "destructive",
};

export function StatusBadge({ status }: { status: DistillStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
