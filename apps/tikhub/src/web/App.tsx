import "./styles.css";
import { useCallback, useEffect, useState } from "react";
import { getCurrentAppPath, navigateToApp, subscribeToAppPath, type RomeAppBootstrap } from "@rome-os/app-web-sdk";
import { Measure, Page, PageDescription, PageHeader, PageHeading, PageNav, PageNavLink, PageTitle } from "@rome-os/ui/page";
import { TimestampProvider } from "@rome-os/ui/timestamp";
import { api, type PublicSettings } from "./api";
import { I18nProvider, useI18n, type MessageKey } from "./i18n";
import { Calls, CallDetail } from "./components/Calls";
import { ErrorAlert } from "./components/common";
import { EndpointDetail } from "./components/EndpointDetail";
import { Explorer } from "./components/Explorer";
import { Overview } from "./components/Overview";
import { Settings } from "./components/Settings";

type Route =
  | { view: "overview" }
  | { view: "explorer"; platform?: string }
  | { view: "endpoint"; method: string; path: string }
  | { view: "calls" }
  | { view: "call"; id: string }
  | { view: "settings" };

/** Routes: "", explorer[/<platform>] (defaults to douyin), endpoint/<method>/api/v1/…, calls[/<id>], settings. */
export function parseRoute(raw: string): Route {
  const path = raw.replace(/^\/+/, "").split("?")[0] ?? "";
  const [head, ...rest] = path.split("/");
  switch (head) {
    case "explorer":
      return rest[0] ? { view: "explorer", platform: decodeURIComponent(rest[0]) } : { view: "explorer" };
    case "endpoint":
      if (rest.length >= 2) return { view: "endpoint", method: rest[0]!, path: `/${rest.slice(1).join("/")}` };
      return { view: "explorer" };
    case "calls":
      return rest[0] ? { view: "call", id: rest[0] } : { view: "calls" };
    case "settings":
      return { view: "settings" };
    default:
      return { view: "overview" };
  }
}

const NAV: Array<{ key: string; label: MessageKey; path: string; match: Route["view"][] }> = [
  { key: "overview", label: "nav.overview", path: "", match: ["overview"] },
  { key: "explorer", label: "nav.explorer", path: "explorer", match: ["explorer", "endpoint"] },
  { key: "calls", label: "nav.calls", path: "calls", match: ["calls", "call"] },
  { key: "settings", label: "nav.settings", path: "settings", match: ["settings"] },
];

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}

function Shell() {
  const { t, locale, lang } = useI18n();
  const [route, setRoute] = useState<Route>(() => parseRoute(getCurrentAppPath()));
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToAppPath((p) => setRoute(parseRoute(p))), []);

  const loadSettings = useCallback(() => {
    api<PublicSettings>("settings").then(
      (s) => {
        setSettings(s);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => loadSettings(), [loadSettings]);
  // Re-fetch when landing on settings without data (e.g. first load raced an app reinstall).
  useEffect(() => {
    if (route.view === "settings" && !settings) loadSettings();
  }, [route.view, settings, loadSettings]);

  return (
    <TimestampProvider locale={locale}>
    <Page className="min-h-full bg-[var(--app-canvas)]">
      <PageHeader>
        <PageHeading>
          <PageTitle>TikHub</PageTitle>
          <PageDescription>
            {t("app.description")}
            {settings && !settings.configured ? t("app.noKeySuffix") : ""}
          </PageDescription>
        </PageHeading>
      </PageHeader>
      <PageNav aria-label={t("app.navLabel")}>
        {NAV.map((n) => (
          <PageNavLink
            key={n.key}
            href="#"
            active={n.match.includes(route.view)}
            onClick={(e) => {
              e.preventDefault();
              navigateToApp(n.path);
            }}
          >
            {t(n.label)}
          </PageNavLink>
        ))}
      </PageNav>
      {/* Re-mount views on a language switch so server-rendered text is refetched in the new language. */}
      <Measure key={lang} className="flex flex-col gap-6 pb-12">
        {error ? <ErrorAlert title={t("app.backendError")} error={error} /> : null}
        {route.view === "overview" ? <Overview settings={settings} /> : null}
        {route.view === "explorer" ? <Explorer platform={route.platform} /> : null}
        {route.view === "endpoint" ? <EndpointDetail key={`${route.method}:${route.path}`} method={route.method} path={route.path} settings={settings} /> : null}
        {route.view === "calls" ? <Calls /> : null}
        {route.view === "call" ? <CallDetail id={route.id} /> : null}
        {route.view === "settings" ? <Settings settings={settings} onChange={setSettings} loadError={error} onRetry={loadSettings} /> : null}
      </Measure>
    </Page>
    </TimestampProvider>
  );
}
