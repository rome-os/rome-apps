import { useEffect, useState } from "react";
import { navigateToApp } from "@rome-os/app-web-sdk";
import { ArrowLeft, ExternalLink, Eye, Send, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Badge } from "@rome-os/ui/badge";
import { Button } from "@rome-os/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@rome-os/ui/field";
import { Input } from "@rome-os/ui/input";
import { Section, SectionDescription, SectionHeader, SectionHeading, SectionTitle } from "@rome-os/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rome-os/ui/select";
import { Spinner } from "@rome-os/ui/spinner";
import { Textarea } from "@rome-os/ui/textarea";
import { api, formatUsd, type CallOutcome, type EndpointDetail as Detail, type FieldInfo, type PublicSettings } from "../api";
import { useI18n } from "../i18n";
import { ErrorAlert, JsonBlock, KeyValueRows, Loading, MethodBadge, StatusBadge } from "./common";
import { isPrivateField } from "../../lib/safety";
import { useEndpointCall } from "../hooks/useEndpointCall";
import { CostValue } from "./CostValue";

const NONE = "__none__";

function initialValue(p: FieldInfo): string {
  const v = p.example ?? (p.required ? p.default : undefined);
  if (v === undefined || v === null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function EndpointDetail({ method, path, settings }: { method: string; path: string; settings: PublicSettings | null }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const { running, outcome, error: runError, uncertain, setError: setRunError, send } = useEndpointCall(`${method}:${path}`);

  useEffect(() => {
    setDetail(null);
    setError(null);
    let active = true;
    const q = new URLSearchParams({ path, method });
    api<Detail>(`endpoint?${q.toString()}`)
      .then((d) => {
        if (!active) return;
        setDetail(d);
        setValues(Object.fromEntries(d.parameters.map((p) => [p.name, initialValue(p)])));
        setBodyText(d.body ? JSON.stringify(d.example.body ?? {}, null, 2) : "");
      })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [method, path]);

  async function run(dryRun: boolean) {
    if (!detail || detail.safety.sensitive) return;
    setRunError(null);
    let body: unknown;
    if (detail.body) {
      try {
        body = bodyText.trim() ? JSON.parse(bodyText) : undefined;
      } catch {
        setRunError(t("endpoint.invalidJson"));
        return;
      }
    }
    const query: Record<string, unknown> = {};
    const pathParams: Record<string, string> = {};
    for (const p of detail.parameters) {
      const v = values[p.name]?.trim();
      if (!v) continue;
      if (p.in === "path") pathParams[p.name] = v;
      else if (p.in === "query") {
        if (p.type?.startsWith("array")) {
          try { const parsed: unknown = JSON.parse(v); if (!Array.isArray(parsed)) throw new Error(); query[p.name] = parsed; }
          catch { setRunError(t("endpoint.invalidJson")); return; }
        } else query[p.name] = v;
      }
    }
    await send({ method: detail.method, path: detail.path, query, pathParams, body, dryRun }, dryRun ? "dry" : "send");
  }

  const back = (
    <Button variant="ghost" size="sm" className="self-start" onClick={() => navigateToApp(detail?.platform ? `explorer/${detail.platform}` : "explorer")}>
      <ArrowLeft />
      {t("endpoint.back")}
    </Button>
  );

  if (error) return <div className="flex flex-col gap-4">{back}<ErrorAlert title={t("endpoint.notFound")} error={error} /></div>;
  if (!detail) return <Loading />;

  const inputs = detail.parameters.filter((p) => (p.in === "query" || p.in === "path") && !isPrivateField(p.name));
  const cost = detail.price?.costUsd ?? null;
  const brief = detail.brief;
  const reasons = detail.safety.reasons;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={detail.method} />
          <code className="min-w-0 break-all font-mono text-ui">{detail.path}</code>
        </div>
        <p className="text-ui">{detail.summary}</p>
        {brief ? <p className="text-ui text-muted-foreground">{brief}</p> : null}
        <KeyValueRows
          rows={[
            [t("endpoint.group"), detail.tag ?? "—"],
            [
              t("endpoint.price"),
              <span key="c">
                {t("endpoint.perCall", { cost: formatUsd(cost) })}
                {detail.price?.allowFreeCredit ? t("endpoint.freeCredit") : ""}
              </span>,
            ],
            [t("endpoint.rateLimit"), detail.price?.rateLimit ?? "—"],
            [
              t("endpoint.docs"),
              <a key="d" href={detail.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                TikHub Swagger <ExternalLink className="size-3" />
              </a>,
            ],
          ]}
        />
        {detail.safety.sensitive ? (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>{t("endpoint.guardedTitle")}</AlertTitle>
            <AlertDescription>{t("endpoint.guardedDesc", { reasons: reasons.join(t("endpoint.reasonSep")) })}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>{t("endpoint.tryIt")}</SectionTitle>
            <SectionDescription>{settings?.configured ? t("endpoint.tryItDesc") : t("endpoint.tryItNeedKey")}</SectionDescription>
          </SectionHeading>
        </SectionHeader>
        {!detail.safety.sensitive ? <FieldGroup className="max-w-2xl">
          {inputs.map((p) => (
            <Field key={`${p.in}:${p.name}`}>
              <FieldLabel htmlFor={`p-${p.name}`} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{p.name}</span>
                {p.required ? <Badge variant="destructive">{t("endpoint.required")}</Badge> : null}
                <span className="text-aux text-muted-foreground">{p.type ?? ""}{p.in === "path" ? " · path" : ""}</span>
              </FieldLabel>
              {p.enum ? (
                <Select
                  value={values[p.name] ? values[p.name] : NONE}
                  onValueChange={(val) => setValues((v) => ({ ...v, [p.name]: val === NONE ? "" : val }))}
                >
                  <SelectTrigger id={`p-${p.name}`} className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("endpoint.omit")}</SelectItem>
                    {p.enum.map((opt) => (
                      <SelectItem key={String(opt)} value={String(opt)}>
                        {String(opt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`p-${p.name}`}
                  value={values[p.name] ?? ""}
                  placeholder={p.default !== undefined ? t("endpoint.defaultValue", { value: String(p.default) }) : ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                />
              )}
              {p.description ? <FieldDescription className="line-clamp-3">{p.description}</FieldDescription> : null}
            </Field>
          ))}
          {detail.body ? (
            <Field>
              <FieldLabel htmlFor="body">{t("endpoint.body")}</FieldLabel>
              <Textarea id="body" className="min-h-40 font-mono text-aux" value={bodyText} onChange={(e) => setBodyText(e.target.value)} spellCheck={false} />
              <FieldDescription>
                {t("endpoint.bodyFields", {
                  fields: detail.body.fields.filter((f) => !isPrivateField(f.name)).map((f) => `${f.name}${f.required ? "*" : ""}`).join(t("endpoint.listSep")) || "—",
                })}
              </FieldDescription>
            </Field>
          ) : null}
          {inputs.length === 0 && !detail.body ? <p className="text-ui text-muted-foreground">{t("endpoint.noParams")}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => void run(true)} disabled={running !== null}>
              {running === "dry" ? <Spinner size="sm" label={t("endpoint.previewing")} /> : <Eye />}
              {t("endpoint.preview")}
            </Button>
            <Button onClick={() => void run(false)} disabled={running !== null || !settings?.configured || detail.safety.sensitive}>
              {running === "send" ? <Spinner size="sm" label={t("endpoint.sending")} /> : <Send />}
              {running === "send" ? t("endpoint.sending") : t("endpoint.send", { cost: formatUsd(cost) })}
            </Button>
          </div>
        </FieldGroup> : null}
        {runError ? <ErrorAlert title={t(uncertain ? "endpoint.unconfirmed" : "endpoint.notSent")} error={uncertain ? `${runError} ${t("cost.unknown")}` : runError} /> : null}
      </Section>

      {outcome ? <OutcomeView outcome={outcome} /> : null}
    </div>
  );
}

export function OutcomeView({ outcome }: { outcome: CallOutcome }) {
  const { t } = useI18n();
  const details = [
    outcome.httpStatus ? `HTTP ${outcome.httpStatus}` : null,
    outcome.durationMs !== undefined ? `${outcome.durationMs} ms` : null,
    outcome.attempts && outcome.attempts > 1 ? t("endpoint.retries", { n: outcome.attempts - 1 }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <Section>
      <SectionHeader>
        <SectionHeading>
          <SectionTitle className="flex items-center gap-2">
            {t("endpoint.result")} <StatusBadge status={outcome.status} />
          </SectionTitle>
          <SectionDescription>
            {details ? `${details} · ` : null}<CostValue value={outcome} />
          </SectionDescription>
        </SectionHeading>
      </SectionHeader>
      {outcome.error ? <ErrorAlert title={t("endpoint.failed")} error={outcome.error} /> : null}
      {outcome.warnings.length ? (
        <ul className="list-disc pl-5 text-ui text-muted-foreground">
          {outcome.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {outcome.request ? <JsonBlock value={outcome.request} maxHeight="12rem" /> : null}
      {outcome.pagination ? (
        <div className="flex flex-col gap-1">
          <div className="text-aux text-muted-foreground">{t("endpoint.pagination")}</div>
          <JsonBlock value={outcome.pagination} maxHeight="8rem" />
        </div>
      ) : null}
      {outcome.data !== undefined ? <JsonBlock value={outcome.data} /> : null}
      <Button variant="ghost" size="sm" className="self-start" onClick={() => navigateToApp(`calls/${outcome.callId}`)}>
        {t("endpoint.viewInLog")}
      </Button>
    </Section>
  );
}
