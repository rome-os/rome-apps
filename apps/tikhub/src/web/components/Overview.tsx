import { useCallback, useEffect, useState } from "react";
import { navigateToApp } from "@rome-os/app-web-sdk";
import { KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { EmptyState, EmptyStateAction, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@rome-os/ui/empty-state";
import { Section, SectionActions, SectionDescription, SectionHeader, SectionHeading, SectionTitle } from "@rome-os/ui/page";
import { Spinner } from "@rome-os/ui/spinner";
import { Timestamp } from "@rome-os/ui/timestamp";
import { api, formatScalar, formatUsd, postJson, type AccountInfo, type CatalogInfo, type Health, type PublicSettings, type Stats } from "../api";
import { useI18n } from "../i18n";
import { ErrorAlert, JsonBlock, KeyValueRows, Loading, Stat } from "./common";

const TZ_OFFSET = -new Date().getTimezoneOffset();

export function Overview({ settings }: { settings: PublicSettings | null }) {
  const { t } = useI18n();
  const yesNo: [string, string] = [t("common.yes"), t("common.no")];
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<CatalogInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      api<AccountInfo>("account"),
      api<Health>("health"),
      api<Stats>(`stats?days=7&tz=${TZ_OFFSET}`),
      api<CatalogInfo>("catalog"),
    ]);
    const [a, h, s, c] = results;
    if (a.status === "fulfilled") setAccount(a.value);
    if (h.status === "fulfilled") setHealth(h.value);
    if (s.status === "fulfilled") setStats(s.value);
    if (c.status === "fulfilled") setCatalog(c.value);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) setError(failed.map((f) => (f.reason as Error).message).join("\n\n"));
    setLoading(false);
  }, []);

  // Only fetch dashboard data once we know a key exists; before that we don't know which view to show.
  const configured = settings?.configured === true;
  useEffect(() => {
    if (configured) void load();
  }, [load, configured]);

  async function refreshCatalog() {
    setRefreshingCatalog(true);
    try {
      setCatalog(await postJson<CatalogInfo>("catalog/refresh", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshingCatalog(false);
    }
  }

  if (!settings) {
    // Unknown yet whether this is the onboarding view or the dashboard — show neither.
    return (
      <div className="flex min-h-64 items-center justify-center" aria-busy="true">
        <Spinner size="sm" label={t("overview.loading")} />
      </div>
    );
  }

  if (!settings.configured) {
    return (
      <EmptyState>
        <EmptyStateIcon>
          <KeyRound />
        </EmptyStateIcon>
        <EmptyStateTitle>{t("overview.noKeyTitle")}</EmptyStateTitle>
        <EmptyStateDescription>{t("overview.noKeyDesc")}</EmptyStateDescription>
        <EmptyStateAction className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => navigateToApp("settings")}>{t("overview.goSettings")}</Button>
          <Button variant="outline" onClick={() => navigateToApp("explorer")}>
            {t("overview.browseFirst")}
          </Button>
        </EmptyStateAction>
      </EmptyState>
    );
  }

  const maxCalls = Math.max(1, ...(stats?.buckets.map((b) => b.calls) ?? [1]));

  return (
    <div className="flex flex-col gap-8">
      {error ? <ErrorAlert title={t("overview.partialError")} error={error} /> : null}

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>{t("overview.account")}</SectionTitle>
            <SectionDescription>{t("overview.accountDesc")}</SectionDescription>
          </SectionHeading>
          <SectionActions>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner size="sm" label={t("common.refreshing")} /> : <RefreshCw />}
              {t("common.refresh")}
            </Button>
          </SectionActions>
        </SectionHeader>
        {loading && !account ? (
          <Loading />
        ) : account?.ok === false ? (
          <ErrorAlert title={t("overview.accountError")} error={account.error ?? t("common.unknownError")} />
        ) : account?.user ? (
          <div className="grid grid-cols-2 gap-4 rounded-12 border border-border p-4 md:grid-cols-4">
            <Stat label={t("overview.balance")} value={formatScalar(account.user.balance, yesNo)} />
            <Stat label={t("overview.freeCredit")} value={formatScalar(account.user.freeCredit, yesNo)} />
            <Stat
              label={t("overview.connectivity")}
              value={health ? (health.ok ? `${health.latencyMs} ms` : t("overview.unavailable")) : "—"}
              hint={health?.baseUrl.replace("https://", "")}
            />
            <Stat
              label="API Key"
              value={formatScalar(account.apiKey?.name, yesNo)}
              hint={account.apiKey?.expiresAt ? t("overview.expires", { date: formatScalar(account.apiKey.expiresAt, yesNo) }) : t("overview.noExpiry")}
            />
          </div>
        ) : null}
      </Section>

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>{t("overview.calls7d")}</SectionTitle>
            <SectionDescription>
              {stats
                ? t("overview.callsSummary", {
                    calls: stats.totals.calls,
                    ok: stats.totals.ok,
                    errors: stats.totals.errors,
                    cost: formatUsd(stats.totals.costUsd),
                  })
                : t("overview.callsHint")}
            </SectionDescription>
            {stats && stats.totals.unknownCosts > 0 ? <p className="text-ui text-muted-foreground">{t("overview.unknownCosts", { n: stats.totals.unknownCosts })}</p> : null}
          </SectionHeading>
          <SectionActions>
            <Button variant="ghost" onClick={() => navigateToApp("calls")}>
              {t("overview.viewCalls")}
            </Button>
          </SectionActions>
        </SectionHeader>
        {stats ? (
          stats.totals.calls === 0 ? (
            <p className="text-ui text-muted-foreground">{t("overview.noCalls")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex h-32 items-end gap-2" role="img" aria-label={t("overview.chartLabel")}>
                {stats.buckets.map((b) => (
                  <div key={b.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={t("overview.barTitle", { date: b.date, calls: b.calls, cost: formatUsd(b.costUsd) })}>
                    <div className="text-aux text-muted-foreground">{b.calls || ""}</div>
                    <div className="w-full rounded-4 bg-primary" style={{ height: `${Math.max(b.calls ? 4 : 1, (b.calls / maxCalls) * 88)}%`, opacity: b.calls ? 1 : 0.15 }} />
                    <div className="text-aux text-muted-foreground">{b.date.slice(5)}</div>
                  </div>
                ))}
              </div>
              {stats.byPlatform.length ? (
                <p className="text-ui text-muted-foreground">
                  {stats.byPlatform.map((p) => t("overview.platformCalls", { platform: p.platform, calls: p.calls })).join(" · ")}
                </p>
              ) : null}
            </div>
          )
        ) : loading ? (
          <Loading />
        ) : null}
      </Section>

      {account?.dailyUsage || account?.dailyUsageError ? (
        <Section>
          <SectionHeader>
            <SectionHeading>
              <SectionTitle>{t("overview.dailyUsage")}</SectionTitle>
              <SectionDescription>{t("overview.dailyUsageDesc")}</SectionDescription>
            </SectionHeading>
          </SectionHeader>
          {account.dailyUsageError ? (
            <ErrorAlert title={t("overview.dailyUsageError")} error={account.dailyUsageError} />
          ) : (
            <details className="text-ui">
              <summary className="cursor-pointer text-muted-foreground">{t("overview.showRaw")}</summary>
              <div className="mt-2">
                <JsonBlock value={account.dailyUsage} maxHeight="20rem" />
              </div>
            </details>
          )}
        </Section>
      ) : null}

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle>{t("overview.catalog")}</SectionTitle>
            <SectionDescription>{t("overview.catalogDesc")}</SectionDescription>
          </SectionHeading>
          <SectionActions>
            <Button variant="outline" onClick={() => void refreshCatalog()} disabled={refreshingCatalog}>
              {refreshingCatalog ? <Spinner size="sm" label={t("overview.updating")} /> : <RefreshCw />}
              {t("overview.updateNow")}
            </Button>
          </SectionActions>
        </SectionHeader>
        {catalog ? (
          <KeyValueRows
            rows={[
              [t("overview.version"), catalog.version ?? "—"],
              [
                t("overview.operations"),
                t("overview.operationsValue", { ops: catalog.operations, platforms: catalog.platforms.filter((p) => p.operations > 0).length }),
              ],
              [t("overview.docsUpdated"), <Timestamp key="s" value={catalog.fetchedAt} />],
              [t("overview.pricesUpdated"), <Timestamp key="p" value={catalog.pricesFetchedAt} />],
            ]}
          />
        ) : loading ? (
          <Loading />
        ) : null}
      </Section>
    </div>
  );
}
