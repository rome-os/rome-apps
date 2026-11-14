import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Badge } from "@rome-os/ui/badge";
import { Spinner } from "@rome-os/ui/spinner";
import { useI18n, type MessageKey } from "../i18n";

export function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  return (
    <Badge variant={m === "GET" ? "info" : "brand"} shape="square" className="font-mono">
      {m}
    </Badge>
  );
}

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning" | "muted" | "info"> = {
  ok: "success",
  error: "destructive",
  blocked: "warning",
  dry_run: "muted",
  pending: "info",
  outcome_unknown: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const known = status in STATUS_VARIANT;
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "muted"}>{known ? t(`status.${status}` as MessageKey) : status}</Badge>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  const text = label ?? t("common.loading");
  return (
    <div className="flex min-h-24 items-center justify-center gap-2 text-ui text-muted-foreground">
      <Spinner size="sm" label={text} />
      {text}
    </div>
  );
}

export function ErrorAlert({ title, error }: { title?: string; error: string }) {
  const { t, lang } = useI18n();
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title ?? t("common.error")}</AlertTitle>
      <AlertDescription className="break-words">
        {error.split("\n\n").join(lang === "zh" ? "；" : "; ")}
      </AlertDescription>
    </Alert>
  );
}

export function JsonBlock({ value, maxHeight = "28rem" }: { value: unknown; maxHeight?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="overflow-auto rounded-8 border border-border bg-surface-muted p-3 font-mono text-aux leading-relaxed whitespace-pre-wrap break-all"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-aux text-muted-foreground">{label}</div>
      <div className="truncate text-section">{value}</div>
      {hint ? <div className="text-aux text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function KeyValueRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-ui">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
