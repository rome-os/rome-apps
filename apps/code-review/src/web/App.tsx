import "./styles.css";
import "streamdown/styles.css";
import { useCallback, useEffect, useState } from "react";
import { fetchAppApi, getBootstrap, type RomeAppBootstrap } from "@rome-os/app-web-sdk";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { ReviewDetailPage } from "@/components/reviews/ReviewDetailPage";
import { MentionTaskDetailPage } from "@/components/reviews/MentionTaskDetailPage";
import { TriggerSettingsPage } from "@/components/settings/TriggerSettingsPage";
import type { ActivityCounts, ActivityItem, ActivityPage, DashboardData, GhAuthStatus, MentionTaskData, PRReviewData, TriggerSettingsPayload } from "@/types";
import { getAppBasePath, getRouteMentionTaskId, getRouteReviewId, isTriggerSettingsRoute, normalizeGithubLogins } from "@/lib/helpers";
import { ACTIVITY_PAGE_SIZE, TRIGGER_SETTINGS_ROUTE } from "@/lib/constants";
import { readHomeCache, writeHomeCache } from "@/lib/home-cache";

export default function App({
  bootstrap: _bootstrap,
}: {
  bootstrap: RomeAppBootstrap;
}) {
  const appVersion = _bootstrap.version;
  // Seed the first screen synchronously from a version-matched cache so a
  // returning visit paints real content instantly (stale-while-revalidate); a
  // cold/invalidated cache leaves everything null → the skeleton shows.
  const [initialCache] = useState(() => readHomeCache(appVersion));

  const [dashboard, setDashboard] = useState<DashboardData | null>(() => initialCache?.dashboard ?? null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // True only on a true cold start (no cache to show) until the first load lands.
  const [initializing, setInitializing] = useState(() => !initialCache);

  // Unified activity feed (PR reviews + new-flow mention tasks).
  const [activityItems, setActivityItems] = useState<ActivityItem[]>(() => initialCache?.activity.items ?? []);
  const [activityTotal, setActivityTotal] = useState(() => initialCache?.activity.total ?? 0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityCounts, setActivityCounts] = useState<ActivityCounts | null>(() => initialCache?.activity.counts ?? null);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // GitHub CLI auth status (loaded in parallel with the dashboard)
  const [ghAuth, setGhAuth] = useState<GhAuthStatus | null>(() => initialCache?.ghAuth ?? null);

  // Add repo form
  const [repoUrl, setRepoUrl] = useState("");
  const [addingRepo, setAddingRepo] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);

  // PR Review + detail state
  const [prInput, setPrInput] = useState("");
  const [triggeringReview, setTriggeringReview] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PRReviewData | null>(null);
  const [selectedTask, setSelectedTask] = useState<MentionTaskData | null>(null);
  const [routeReviewId, setRouteReviewId] = useState<string | null>(() => getRouteReviewId());
  const [routeMentionTaskId, setRouteMentionTaskId] = useState<string | null>(() => getRouteMentionTaskId());
  const [routeIsTriggerSettings, setRouteIsTriggerSettings] = useState(() => isTriggerSettingsRoute());
  const [loadingReviewDetail, setLoadingReviewDetail] = useState(false);
  const [loadingTaskDetail, setLoadingTaskDetail] = useState(false);
  const [cancellingReview, setCancellingReview] = useState(false);

  const loadActivity = useCallback(async (page: number, filter: string) => {
    setLoadingActivity(true);
    setError(null);
    try {
      const offset = (page - 1) * ACTIVITY_PAGE_SIZE;
      const apiBase = getBootstrap().apiBase;
      const response = await fetch(
        `${apiBase}/activity?type=${encodeURIComponent(filter)}&limit=${ACTIVITY_PAGE_SIZE}&offset=${offset}`,
      );
      if (!response.ok) throw new Error(`Failed to load activity (HTTP ${response.status})`);
      const data = (await response.json()) as ActivityPage;
      setActivityItems(Array.isArray(data.items) ? data.items : []);
      setActivityTotal(typeof data.total === "number" ? data.total : 0);
      if (data.counts) setActivityCounts(data.counts);
      setActivityPage(page);
      setActivityFilter(filter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetchAppApi("dashboard");
      if (!response.ok) {
        throw new Error(`Failed to load dashboard (HTTP ${response.status})`);
      }
      const data = (await response.json()) as DashboardData;
      setDashboard(data);
      if (data.activityCounts) setActivityCounts(data.activityCounts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
    await loadActivity(1, activityFilter);
    setInitializing(false);
  }, [loadActivity, activityFilter]);

  const checkGhAuth = useCallback(async () => {
    try {
      const response = await fetchAppApi("gh-auth-status");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as GhAuthStatus;
      setGhAuth(data);
    } catch {
      setGhAuth({ loggedIn: false, login: null });
    }
  }, []);

  const loadReviewDetail = useCallback(async (reviewId: string) => {
    setLoadingReviewDetail(true);
    setError(null);
    try {
      const apiBase = getBootstrap().apiBase;
      const response = await fetch(`${apiBase}/pr-reviews/${encodeURIComponent(reviewId)}`);
      if (!response.ok) {
        throw new Error(`Failed to load review (HTTP ${response.status})`);
      }
      const data = (await response.json()) as { review: PRReviewData };
      setSelectedReview(data.review);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReviewDetail(false);
    }
  }, []);

  const loadMentionTaskDetail = useCallback(async (taskId: string) => {
    setLoadingTaskDetail(true);
    setError(null);
    try {
      const apiBase = getBootstrap().apiBase;
      const response = await fetch(`${apiBase}/mention-tasks/${encodeURIComponent(taskId)}`);
      if (!response.ok) {
        throw new Error(`Failed to load task (HTTP ${response.status})`);
      }
      const data = (await response.json()) as { task: MentionTaskData };
      setSelectedTask(data.task);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTaskDetail(false);
    }
  }, []);

  const goToActivityPage = useCallback(
    (page: number) => {
      const totalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));
      const target = Math.min(Math.max(1, page), totalPages);
      if (target === activityPage || loadingActivity) return;
      void loadActivity(target, activityFilter);
    },
    [activityTotal, activityPage, loadingActivity, activityFilter, loadActivity],
  );

  const changeActivityFilter = useCallback(
    (filter: string) => {
      if (filter === activityFilter || loadingActivity) return;
      void loadActivity(1, filter);
    },
    [activityFilter, loadingActivity, loadActivity],
  );

  const addRepository = useCallback(async () => {
    const trimmed = repoUrl.trim();
    if (!trimmed) return;
    setAddingRepo(true);
    try {
      const response = await fetchAppApi("repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data.error as string) || `Failed to add repository (HTTP ${response.status})`);
      }
      setRepoUrl("");
      setShowAddRepo(false);
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingRepo(false);
    }
  }, [repoUrl, loadDashboard]);

  const removeRepository = useCallback(
    async (id: string) => {
      // Let the caller decide how to surface failure (e.g. the Danger-zone
      // inline error on the settings page). On success we refresh the dashboard.
      const response = await fetchAppApi(`repositories/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data.error as string) || `Failed to remove repository (HTTP ${response.status})`);
      }
      await loadDashboard();
    },
    [loadDashboard],
  );

  const cancelPRReview = useCallback(
    async (reviewId: string) => {
      setCancellingReview(true);
      setError(null);
      try {
        const response = await fetchAppApi(`pr-reviews/${reviewId}/cancel`, {
          method: "POST",
        });
        const data = (await response.json().catch(() => ({}))) as {
          review?: PRReviewData;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || `Failed to stop review (HTTP ${response.status})`);
        }
        if (data.review) {
          setSelectedReview(data.review);
        }
        await loadActivity(activityPage, activityFilter);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCancellingReview(false);
      }
    },
    [loadActivity, activityPage, activityFilter],
  );

  // Trigger manual PR review
  const triggerPRReview = useCallback(
    async (overrideInput?: string) => {
      const trimmed = (overrideInput ?? prInput).trim();
      if (!trimmed) return;
      setTriggeringReview(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { force: true };
        if (trimmed.includes("github.com")) {
          body.prUrl = trimmed;
        } else if (/^\d+$/.test(trimmed)) {
          const repos = dashboard?.repositories || [];
          if (repos.length === 1) {
            body.repo = repos[0].name;
            body.prNumber = parseInt(trimmed, 10);
          } else {
            setError("Please provide the full PR URL or select a repository first.");
            setTriggeringReview(false);
            return;
          }
        } else if (trimmed.includes("#")) {
          const [repo, num] = trimmed.split("#");
          body.repo = repo;
          body.prNumber = parseInt(num, 10);
        } else {
          setError("Please enter a valid PR URL (https://github.com/owner/repo/pull/123) or PR number.");
          setTriggeringReview(false);
          return;
        }

        const response = await fetchAppApi("pr-reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error((data.error as string) || `Failed to trigger review (HTTP ${response.status})`);
        }
        setPrInput("");
        setTimeout(() => void loadActivity(1, activityFilter), 1000);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setTriggeringReview(false);
      }
    },
    [prInput, dashboard, loadActivity, activityFilter],
  );

  // Save PR review settings
  const saveSettings = useCallback(
    async (
      repoName: string,
      settings: TriggerSettingsPayload,
    ) => {
      setError(null);
      try {
        const allowlist = normalizeGithubLogins(settings.triggerAllowlist);
        const response = await fetchAppApi("pr-review-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: repoName,
            autoReviewEnabled: settings.autoReview,
            triggerOnCreate: settings.triggerOnCreate,
            manualTriggerEnabled: settings.manualTriggerEnabled,
            triggerOnRequest: settings.manualTriggerEnabled,
            triggerOnReviewRequest: settings.triggerOnReviewRequest,
            triggerOnMention: settings.triggerOnMention,
            triggerOnPush: settings.triggerOnPush,
            triggerAllowlist: allowlist,
            mentionTriggerPhrase: settings.mentionTriggerPhrase.trim() || "PTAL",
            summaryTriggerPhrase: settings.summaryTriggerPhrase.trim() || "summary",
            customRules: settings.customRules.trim() || null,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error((data.error as string) || `Failed to save settings (HTTP ${response.status})`);
        }
        await loadDashboard();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        throw err; // re-throw so the settings form knows save failed
      }
    },
    [loadDashboard],
  );

  // Repair the GitHub connection: re-subscribe the webhook to the full event
  // list and (re)create/enable the event-bus routines, then reload so the
  // Connection card reflects the healed state.
  const repairConnection = useCallback(async () => {
    setError(null);
    try {
      const response = await fetchAppApi("connection/repair", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((data.error as string) || `Failed to repair connection (HTTP ${response.status})`);
      }
      await loadDashboard();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err; // re-throw so the settings form knows repair failed
    }
  }, [loadDashboard]);

  useEffect(() => {
    void loadDashboard();
    void checkGhAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot the first screen (dashboard + auth + page-1 "all" activity) into the
  // version-keyed cache whenever it changes, so the next visit paints instantly.
  // Only the default first-screen state is cached — not paged/filtered views.
  useEffect(() => {
    if (!dashboard) return;
    if (activityFilter !== "all" || activityPage !== 1) return;
    writeHomeCache(appVersion, {
      dashboard,
      ghAuth,
      activity: { items: activityItems, total: activityTotal, counts: activityCounts },
    });
  }, [dashboard, ghAuth, activityItems, activityTotal, activityCounts, activityFilter, activityPage, appVersion]);

  // Warm the TLS connection to the avatar CDN so the first avatar image paints
  // faster (part of the avatar-loading chain optimization).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = "https://avatars.githubusercontent.com";
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRouteIsTriggerSettings(isTriggerSettingsRoute());
      setRouteReviewId(getRouteReviewId());
      setRouteMentionTaskId(getRouteMentionTaskId());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!routeReviewId) {
      setSelectedReview(null);
      return;
    }
    void loadReviewDetail(routeReviewId);
  }, [routeReviewId, loadReviewDetail]);

  useEffect(() => {
    if (!routeMentionTaskId) {
      setSelectedTask(null);
      return;
    }
    void loadMentionTaskDetail(routeMentionTaskId);
  }, [routeMentionTaskId, loadMentionTaskDetail]);

  const repositories = dashboard?.repositories || [];
  const prSettings = dashboard?.prReviewSettings || [];

  const openActivityItem = (item: ActivityItem) => {
    if (item.kind === "review") {
      const nextPath = `${getAppBasePath()}/${encodeURIComponent(item.id)}`;
      window.history.pushState({}, "", nextPath);
      setRouteIsTriggerSettings(false);
      setRouteMentionTaskId(null);
      setRouteReviewId(item.id);
    } else {
      const nextPath = `${getAppBasePath()}/task/${encodeURIComponent(item.id)}`;
      window.history.pushState({}, "", nextPath);
      setRouteIsTriggerSettings(false);
      setRouteReviewId(null);
      setRouteMentionTaskId(item.id);
    }
  };

  const openTriggerSettings = (repoName?: string) => {
    const query = repoName ? `?repo=${encodeURIComponent(repoName)}` : "";
    const nextPath = `${getAppBasePath()}/${TRIGGER_SETTINGS_ROUTE}${query}`;
    window.history.pushState({}, "", nextPath);
    setRouteReviewId(null);
    setRouteMentionTaskId(null);
    setRouteIsTriggerSettings(true);
  };

  const goHome = () => {
    window.history.pushState({}, "", getAppBasePath());
    setRouteIsTriggerSettings(false);
    setRouteReviewId(null);
    setRouteMentionTaskId(null);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {routeIsTriggerSettings ? (
        <TriggerSettingsPage
          dashboard={dashboard}
          ghAuth={ghAuth}
          refreshing={refreshing}
          error={error}
          onBack={goHome}
          onRefresh={() => void loadDashboard()}
          onSave={saveSettings}
          onRepair={repairConnection}
          onRemoveRepository={async (id) => {
            await removeRepository(id);
            goHome();
          }}
        />
      ) : routeReviewId ? (
        <ReviewDetailPage
          selectedReview={selectedReview}
          loadingReviewDetail={loadingReviewDetail}
          error={error}
          refreshing={refreshing}
          triggeringReview={triggeringReview}
          cancellingReview={cancellingReview}
          onBack={goHome}
          onRefresh={() => routeReviewId ? void loadReviewDetail(routeReviewId) : void loadDashboard()}
          onDismissError={() => setError(null)}
          onTriggerReview={(prUrl) => void triggerPRReview(prUrl)}
          onCancelReview={(reviewId) => void cancelPRReview(reviewId)}
        />
      ) : routeMentionTaskId ? (
        <MentionTaskDetailPage
          selectedTask={selectedTask}
          loading={loadingTaskDetail}
          error={error}
          refreshing={refreshing}
          onBack={goHome}
          onRefresh={() => routeMentionTaskId ? void loadMentionTaskDetail(routeMentionTaskId) : void loadDashboard()}
          onDismissError={() => setError(null)}
        />
      ) : (
        <HomeDashboard
          dashboard={dashboard}
          ghAuth={ghAuth}
          loading={initializing}
          error={error}
          refreshing={refreshing}
          repositories={repositories}
          prSettings={prSettings}
          repoStats={dashboard?.repoStats}
          activityCounts={activityCounts}
          activityItems={activityItems}
          activityTotal={activityTotal}
          activityPage={activityPage}
          activityFilter={activityFilter}
          loadingActivity={loadingActivity}
          repoUrl={repoUrl}
          addingRepo={addingRepo}
          showAddRepo={showAddRepo}
          prInput={prInput}
          triggeringReview={triggeringReview}
          onRefresh={() => void loadDashboard()}
          onDismissError={() => setError(null)}
          onRepoUrlChange={setRepoUrl}
          onShowAddRepoChange={setShowAddRepo}
          onAddRepository={() => void addRepository()}
          onOpenTriggerSettings={openTriggerSettings}
          onPrInputChange={setPrInput}
          onTriggerPRReview={(input) => void triggerPRReview(input)}
          onOpenActivityItem={openActivityItem}
          onActivityFilterChange={changeActivityFilter}
          onGoToActivityPage={goToActivityPage}
        />
      )}
    </main>
  );
}
