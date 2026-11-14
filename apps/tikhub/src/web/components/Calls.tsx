import { useCallback, useEffect, useRef, useState } from "react";
import { navigateToApp } from "@rome-os/app-web-sdk";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { FilterChipGroup } from "@rome-os/ui/filter-chip-group";
import { Section, SectionHeader, SectionHeading, SectionTitle } from "@rome-os/ui/page";
import { Spinner } from "@rome-os/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rome-os/ui/table";
import { Timestamp } from "@rome-os/ui/timestamp";
import { api, endpointRoute, type CallRow } from "../api";
import { useI18n } from "../i18n";
import { ErrorAlert, JsonBlock, KeyValueRows, Loading, MethodBadge, StatusBadge } from "./common";
import { CostValue } from "./CostValue";

type StatusFilter = "all" | "ok" | "error" | "blocked" | "dry_run";
const PAGE = 50;

export function Calls() {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [data, setData] = useState<{ total: number; items: CallRow[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const requestSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (status !== "all") q.set("status", status);
      const next = await api<{ total: number; items: CallRow[] }>(`calls?${q.toString()}`);
      if (sequence !== requestSequence.current) return;
      setData((previous) => offset === 0 ? next : { total: next.total, items: [...(previous?.items ?? []).slice(0, offset), ...next.items] });
      setError(null);
    } catch (e) {
      if (sequence === requestSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [status, offset]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current++; };
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterChipGroup<StatusFilter>
          aria-label={t("calls.filterLabel")}
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setOffset(0);
            setData(null);
          }}
          options={[
            { value: "all", label: t("calls.all") },
            { value: "ok", label: t("status.ok") },
            { value: "error", label: t("status.error") },
            { value: "blocked", label: t("status.blocked") },
            { value: "dry_run", label: t("status.dry_run") },
          ]}
        />
        <Button variant="outline" onClick={() => { if (offset === 0) void load(); else setOffset(0); }} disabled={loading}>
          {loading ? <Spinner size="sm" label={t("common.refreshing")} /> : <RefreshCw />}
          {t("common.refresh")}
        </Button>
      </div>
      {error ? <ErrorAlert title={t("calls.loadError")} error={error} /> : null}
      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <p className="text-ui text-muted-foreground">{t("calls.empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-12 border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("calls.time")}</TableHead>
                  <TableHead>{t("calls.endpoint")}</TableHead>
                  <TableHead>{t("calls.status")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("calls.source")}</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">{t("calls.duration")}</TableHead>
                  <TableHead className="text-right">{t("calls.cost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigateToApp(`calls/${c.id}`)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <Timestamp value={c.createdAt} />
                    </TableCell>
                    <TableCell className="max-w-[12rem] sm:max-w-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <MethodBadge method={c.method} />
                        <span className="truncate font-mono text-aux" title={c.path}>
                          {c.path.replace(/^\/api\/v1\//, "")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">{c.source === "agent" ? t("calls.sourceAgent") : t("calls.sourceUi")}</TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-muted-foreground">{c.durationMs != null ? `${c.durationMs} ms` : "—"}</TableCell>
                    <TableCell className="text-right"><CostValue value={c} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.total > data.items.length ? (
            <Button variant="outline" className="self-center" onClick={() => setOffset(data.items.length)} disabled={loading}>
              {t("calls.loadMore", { total: data.total })}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CallDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const [row, setRow] = useState<CallRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CallRow>(`calls/${encodeURIComponent(id)}`).then(setRow, (e: Error) => setError(e.message));
  }, [id]);

  const back = (
    <Button variant="ghost" size="sm" className="self-start" onClick={() => navigateToApp("calls")}>
      <ArrowLeft />
      {t("calls.back")}
    </Button>
  );
  if (error) return <div className="flex flex-col gap-4">{back}<ErrorAlert title={t("calls.notFound")} error={error} /></div>;
  if (!row) return <Loading />;

  let request: unknown = row.requestJson;
  try {
    request = row.requestJson ? JSON.parse(row.requestJson) : null;
  } catch {
    /* keep text */
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={row.method} />
        <code className="min-w-0 break-all font-mono text-ui">{row.path}</code>
        <StatusBadge status={row.status} />
      </div>
      <KeyValueRows
        rows={[
          [t("calls.time"), <Timestamp key="t" value={row.createdAt} format="full" />],
          [t("calls.source"), row.source === "agent" ? t("calls.sourceAgent") : t("calls.sourceUi")],
          ["HTTP", row.httpStatus ?? "—"],
          [
            t("calls.duration"),
            row.durationMs != null
              ? `${row.durationMs} ms${row.attempts && row.attempts > 1 ? t("calls.attempts", { n: row.attempts }) : ""}`
              : "—",
          ],
          [t("calls.cost"), <CostValue key="cost" value={row} />],
          ["Request ID", row.requestId ? <code key="r" className="font-mono text-aux">{row.requestId}</code> : "—"],
          [t("calls.responseSize"), row.responseBytes != null ? `${(row.responseBytes / 1024).toFixed(1)} KB` : "—"],
        ]}
      />
      <Button variant="outline" size="sm" className="self-start" onClick={() => navigateToApp(endpointRoute(row.method, row.path))}>
        {t("calls.openEndpoint")}
      </Button>
      {row.errorMessage ? <ErrorAlert error={row.errorMessage} /> : null}
      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>{t("calls.request")}</SectionTitle>
          </SectionHeading>
        </SectionHeader>
        <JsonBlock value={request} maxHeight="14rem" />
      </Section>
      {row.responsePreview ? (
        <Section>
          <SectionHeader>
            <SectionHeading>
              <SectionTitle>{t("calls.response")}</SectionTitle>
            </SectionHeading>
          </SectionHeader>
          <JsonBlock value={row.responsePreview} />
        </Section>
      ) : null}
    </div>
  );
}
