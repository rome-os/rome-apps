import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, PlugZap, Save, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Button } from "@rome-os/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@rome-os/ui/field";
import { Input } from "@rome-os/ui/input";
import { Section, SectionDescription, SectionHeader, SectionHeading, SectionTitle } from "@rome-os/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rome-os/ui/select";
import { Skeleton } from "@rome-os/ui/skeleton";
import { Spinner } from "@rome-os/ui/spinner";
import { formatScalar, postJson, type Health, type PublicSettings } from "../api";
import { useI18n } from "../i18n";
import { ErrorAlert } from "./common";

interface TestResult {
  health: Health;
  account: { ok: boolean; error: string | null; email: unknown; balance: unknown } | null;
  message?: string;
}

export function Settings({
  settings,
  onChange,
  loadError,
  onRetry,
}: {
  settings: PublicSettings | null;
  onChange: (s: PublicSettings) => void;
  loadError?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const yesNo: [string, string] = [t("common.yes"), t("common.no")];
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? "");
  const [timeoutSec, setTimeoutSec] = useState(String((settings?.timeoutMs ?? 45000) / 1000));
  const [maxRetries, setMaxRetries] = useState(String(settings?.maxRetries ?? 3));
  const [qps, setQps] = useState(String(settings?.qps ?? 8));
  const [busy, setBusy] = useState<"key" | "clear" | "net" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!settings) return;
    setBaseUrl(settings.baseUrl);
    setTimeoutSec(String(settings.timeoutMs / 1000));
    setMaxRetries(String(settings.maxRetries));
    setQps(String(settings.qps));
  }, [settings]);

  async function save(kind: "key" | "clear" | "net", patch: Record<string, unknown>, message: string) {
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      const next = await postJson<PublicSettings>("settings", patch, "PUT");
      onChange(next);
      setSaved(message);
      if (kind !== "net") setApiKey("");
      if (kind === "key") void runTest();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      setTest(await postJson<TestResult>("settings/test", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!settings) {
    if (loadError) {
      return (
        <div className="flex flex-col gap-3">
          <ErrorAlert title={t("settings.loadError")} error={loadError} />
          {onRetry ? (
            <Button variant="outline" className="self-start" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      );
    }
    return <SettingsSkeleton />;
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? <ErrorAlert title={t("settings.saveError")} error={error} /> : null}
      {saved ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>{saved}</AlertTitle>
        </Alert>
      ) : null}

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>API Key</SectionTitle>
            <SectionDescription>{t("settings.apiKeyDesc")}</SectionDescription>
          </SectionHeading>
        </SectionHeader>
        <FieldGroup className="max-w-xl">
          <Field>
            <FieldLabel htmlFor="api-key">{settings.configured ? t("settings.current", { masked: settings.apiKeyMasked ?? "" }) : t("settings.noKey")}</FieldLabel>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              icon={<KeyRound />}
              placeholder={settings.configured ? t("settings.replacePlaceholder") : t("settings.pastePlaceholder")}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => void save("key", { apiKey }, t("settings.keySaved"))} disabled={!apiKey.trim() || busy !== null}>
              {busy === "key" ? <Spinner size="sm" label={t("common.saving")} /> : <Save />}
              {t("settings.saveKey")}
            </Button>
            <Button variant="outline" onClick={() => void runTest()} disabled={busy !== null}>
              {busy === "test" ? <Spinner size="sm" label={t("settings.testing")} /> : <PlugZap />}
              {t("settings.test")}
            </Button>
            {settings.configured ? (
              <Button variant="ghost" className="text-destructive" onClick={() => void save("clear", { apiKey: null }, t("settings.keyDeleted"))} disabled={busy !== null}>
                <Trash2 />
                {t("settings.deleteKey")}
              </Button>
            ) : null}
          </div>
          {test ? (
            <Alert variant={test.health.ok && (test.account?.ok ?? true) ? "success" : "destructive"}>
              <PlugZap />
              <AlertTitle>
                {test.health.ok
                  ? t("settings.reachable", { ms: test.health.latencyMs })
                  : t("settings.unreachable", { error: test.health.error || `HTTP ${test.health.httpStatus}` })}
              </AlertTitle>
              <AlertDescription>
                {test.account
                  ? test.account.ok
                    ? t("settings.keyValid", { email: formatScalar(test.account.email, yesNo), balance: formatScalar(test.account.balance, yesNo) })
                    : t("settings.keyInvalid", { error: test.account.error || t("common.unknownError") })
                  : t("settings.onlyConnectivity")}
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </Section>

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>{t("settings.network")}</SectionTitle>
            <SectionDescription>{t("settings.networkDesc")}</SectionDescription>
          </SectionHeading>
        </SectionHeader>
        <FieldGroup className="max-w-xl">
          <Field>
            <FieldLabel htmlFor="base-url">{t("settings.baseUrl")}</FieldLabel>
            <Select value={baseUrl} onValueChange={setBaseUrl}>
              <SelectTrigger id="base-url" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {settings.baseUrlOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.value.includes("tikhub.dev") ? t("settings.baseUrl.china") : o.value.includes("api.tikhub.io") ? t("settings.baseUrl.global") : o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="timeout">{t("settings.timeout")}</FieldLabel>
              <Input id="timeout" inputMode="numeric" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} />
              <FieldDescription>5–120</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="retries">{t("settings.retries")}</FieldLabel>
              <Input id="retries" inputMode="numeric" value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
              <FieldDescription>0–5</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="qps">{t("settings.qps")}</FieldLabel>
              <Input id="qps" inputMode="numeric" value={qps} onChange={(e) => setQps(e.target.value)} />
              <FieldDescription>1–10</FieldDescription>
            </Field>
          </div>
          <Button
            className="self-start"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void save(
                "net",
                { baseUrl, timeoutMs: Number(timeoutSec) * 1000, maxRetries: Number(maxRetries), qps: Number(qps) },
                t("settings.networkSaved"),
              )
            }
          >
            {busy === "net" ? <Spinner size="sm" label={t("common.saving")} /> : <Save />}
            {t("settings.saveNetwork")}
          </Button>
        </FieldGroup>
      </Section>

    </div>
  );
}

/** Same geometry as the settings form, so nothing jumps when data arrives. */
function SettingsSkeleton() {
  const { t } = useI18n();
  const block = (fields: number) => (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-4 w-full max-w-md" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex max-w-xl flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <Skeleton className="h-9 w-28" />
    </div>
  );
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label={t("settings.loading")}>
      {block(1)}
      {block(2)}
    </div>
  );
}
