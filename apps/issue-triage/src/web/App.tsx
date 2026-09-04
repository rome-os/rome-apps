import "./styles.css";
import { useCallback, useEffect, useState } from "react";
import {
  fetchAppApi,
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import type { AddRepositoryResponse, DashboardData, GhAuthStatus, RepoSettingsData, TriageResultData } from "@/types";
import { HomeDashboard } from "@/components/HomeDashboard";
import { SettingsPage } from "@/components/SettingsPage";
import { ResultDetailPage } from "@/components/ResultDetailPage";

interface Route {
  view: "home" | "settings" | "result";
  param?: string;
}

function parseRoute(path: string): Route {
  const clean = (path || "").replace(/^\/+|\/+$/g, "");
  if (!clean) return { view: "home" };
  const segments = clean.split("/");
  // A repo slug is `owner/name`, so it spans two real path segments — the SDK
  // router forbids a percent-encoded `/` inside a single segment, so we keep the
  // slash as a genuine separator and rejoin here.
  if (segments[0] === "settings" && segments.length >= 3) {
    return { view: "settings", param: segments.slice(1, 3).map(decodeURIComponent).join("/") };
  }
  if (segments[0] === "result" && segments[1]) {
    return { view: "result", param: decodeURIComponent(segments[1]) };
  }
  return { view: "home" };
}

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(getCurrentAppPath()));

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [ghAuth, setGhAuth] = useState<GhAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToAppPath((p) => setRoute(parseRoute(p))), []);

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchAppApi("dashboard");
      if (!res.ok) throw new Error(`Failed to load dashboard (HTTP ${res.status})`);
      setDashboard((await res.json()) as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkGhAuth = useCallback(async () => {
    try {
      const res = await fetchAppApi("gh-auth-status");
      setGhAuth((await res.json()) as GhAuthStatus);
    } catch {
      setGhAuth({ loggedIn: false, login: null });
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void checkGhAuth();
  }, [loadDashboard, checkGhAuth]);

  const goHome = useCallback(() => navigateToApp(""), []);
  // Pass `owner/name` as two real path segments (no percent-encoded slash, which
  // the SDK router rejects). Each segment is still encoded for other reserved
  // characters.
  const openSettings = useCallback(
    (slug: string) => navigateToApp(`settings/${slug.split("/").map(encodeURIComponent).join("/")}`),
    [],
  );
  const openResult = useCallback((id: string) => navigateToApp(`result/${encodeURIComponent(id)}`), []);

  const addRepository = useCallback(
    async (input: string): Promise<AddRepositoryResponse> => {
      const res = await fetchAppApi("repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: input.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AddRepositoryResponse> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Failed to add repository (HTTP ${res.status})`);
      }
      await loadDashboard();
      return {
        repository: data.repository as AddRepositoryResponse["repository"],
        provision: data.provision ?? null,
        warning: data.warning ?? null,
      };
    },
    [loadDashboard],
  );

  const removeRepository = useCallback(
    async (id: string) => {
      const res = await fetchAppApi(`repositories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to remove repository (HTTP ${res.status})`);
      await loadDashboard();
    },
    [loadDashboard],
  );

  const triageSingle = useCallback(
    async (body: { repo?: string; issueNumber?: number; issueUrl?: string }) => {
      const res = await fetchAppApi("triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((data.error as string) || `Failed to trigger triage (HTTP ${res.status})`);
      }
      setTimeout(() => void loadDashboard(), 1200);
      return (await res.json()) as { resultId: string };
    },
    [loadDashboard],
  );

  const triageBatch = useCallback(
    async (repoSlug: string) => {
      const res = await fetchAppApi("triage-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoSlug }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((data.error as string) || `Failed to batch triage (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { queued: number; total: number };
      setTimeout(() => void loadDashboard(), 1500);
      return data;
    },
    [loadDashboard],
  );

  const saveSettings = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetchAppApi("repo-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: RepoSettingsData; error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to save settings (HTTP ${res.status})`);
      await loadDashboard();
      return data.settings ?? null;
    },
    [loadDashboard],
  );

  const repairConnection = useCallback(async () => {
    const res = await fetchAppApi("connection/repair", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((data.error as string) || `Failed to repair connection (HTTP ${res.status})`);
    await loadDashboard();
  }, [loadDashboard]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {route.view === "settings" && route.param ? (
        <SettingsPage
          repoSlug={route.param}
          ghAuth={ghAuth}
          onBack={goHome}
          onSave={saveSettings}
          onRepair={repairConnection}
          onRemoveRepository={removeRepository}
          onTriageSingle={triageSingle}
          onTriageBatch={triageBatch}
          onOpenResult={openResult}
        />
      ) : route.view === "result" && route.param ? (
        <ResultDetailPage resultId={route.param} onBack={goHome} />
      ) : (
        <HomeDashboard
          dashboard={dashboard}
          ghAuth={ghAuth}
          loading={loading}
          error={error}
          onRefresh={loadDashboard}
          onDismissError={() => setError(null)}
          onAddRepository={addRepository}
          onOpenSettings={openSettings}
          onOpenResult={openResult}
          onTriageSingle={triageSingle}
        />
      )}
    </main>
  );
}
