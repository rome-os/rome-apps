import { useEffect, useState } from "react";
import {
  buildAppUrl,
  fetchAppApi,
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import "./styles.css";

type RouteKey = "" | "runs";
type WindowKey = "24h" | "7d" | "30d" | "all";

interface DashboardPost {
  id: string;
  redditPostId: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  url: string | null;
  selftext: string | null;
  searchQuery: string;
  scanName: string;
  createdUtc: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

interface DashboardRun {
  id: string;
  scanName: string;
  status: "running" | "success" | "partial" | "error";
  queryCount: number;
  subredditCount: number;
  scannedPairCount: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}

interface DashboardPayload {
  posts: DashboardPost[];
  runs: DashboardRun[];
  schedule: {
    id: string;
    tzid: string;
    localTime: string;
    rrule?: string;
    nextRunAt?: string;
    lastRunAt?: string;
    enabled: boolean;
  } | null;
  catalog: {
    subreddits: string[];
    queries: string[];
  };
  stats: {
    totalPosts: number;
    postsInWindow: number;
    runCount: number;
    trackedSubreddits: number;
  };
  topSubreddits: Array<{ subreddit: string; count: number }>;
  latestRun: DashboardRun | null;
  config: {
    scanName: string;
    cadence: string;
    queryCount: number;
    subredditCount: number;
    queries: string[];
    subreddits: string[];
  };
}

function normalizeRoute(path: string): RouteKey {
  return path === "runs" ? "runs" : "";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Not yet";
  }
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return "pending";
  }
  const date = new Date(value);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) {
    return diff >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}

function truncate(text: string | null | undefined, limit: number): string {
  const value = text?.trim();
  if (!value) {
    return "No self-post body was captured for this result.";
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

export default function RedditApp({ bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [route, setRoute] = useState<RouteKey>(() => normalizeRoute(getCurrentAppPath()));
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [search, setSearch] = useState("");
  const [subreddit, setSubreddit] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanState, setScanState] = useState<"idle" | "running">("idle");
  const [scheduleState, setScheduleState] = useState<"idle" | "saving">("idle");

  async function fetchDashboardSnapshot(
    activeWindow: WindowKey,
    activeSearch: string,
    activeSubreddit: string,
  ): Promise<DashboardPayload> {
    const params = new URLSearchParams({
      window: activeWindow,
      limit: "80",
    });
    if (activeSearch.trim()) {
      params.set("search", activeSearch.trim());
    }
    if (activeSubreddit) {
      params.set("subreddit", activeSubreddit);
    }

    const url = new URL(`${bootstrap.apiBase}/dashboard`, window.location.origin);
    url.search = params.toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Dashboard API returned ${response.status}`);
    }

    return (await response.json()) as DashboardPayload;
  }

  useEffect(() => {
    return subscribeToAppPath((nextPath) => setRoute(normalizeRoute(nextPath)));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError(null);

      try {
        const payload = await fetchDashboardSnapshot(windowKey, search, subreddit);
        if (!cancelled) {
          setDashboard(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();
    const interval = window.setInterval(loadDashboard, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [windowKey, search, subreddit]);

  const heroStatus = (() => {
    if (!dashboard?.latestRun) {
      return "No completed scan yet";
    }
    if (dashboard.latestRun.status === "partial") {
      return "Latest scan completed with recoverable errors";
    }
    if (dashboard.latestRun.status === "error") {
      return "Latest scan failed";
    }
    return "Latest scan completed successfully";
  })();

  async function triggerScan() {
    setScanState("running");
    setError(null);
    try {
      const response = await fetchAppApi("scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(`Scan API returned ${response.status}`);
      }
      setWindowKey("7d");
      const payload = (await response.json()) as { status: string };
      if (payload.status === "error") {
        throw new Error("Manual scan failed");
      }
      setDashboard(await fetchDashboardSnapshot("7d", "", ""));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setScanState("idle");
    }
  }

  async function ensureSchedule() {
    setScheduleState("saving");
    setError(null);
    try {
      const response = await fetchAppApi("schedule/ensure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ tzid: "UTC", localTime: "00:00" }),
      });
      if (!response.ok) {
        throw new Error(`Schedule API returned ${response.status}`);
      }
      setDashboard(await fetchDashboardSnapshot(windowKey, search, subreddit));
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : String(scheduleError));
    } finally {
      setScheduleState("idle");
    }
  }

  return (
    <div className="radar-shell">
      <div className="radar-backdrop" />
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Reddit Radar</p>
          <h1>Track how Reddit is discussing AI agents.</h1>
          <p className="hero-text">
            This app mounts through the Rome dynamic app host, stores scan runs in custom
            tables, and schedules Reddit searches every three hours through the shared events
            engine.
          </p>
        </div>
        <div className="hero-stack">
          <div className="hero-metric">
            <span>App</span>
            <strong>{bootstrap.appId}</strong>
          </div>
          <div className="hero-metric">
            <span>Status</span>
            <strong>{heroStatus}</strong>
          </div>
          <div className="hero-metric">
            <span>Cadence</span>
            <strong>{dashboard?.config.cadence ?? "Every 3 hours"}</strong>
          </div>
        </div>
      </header>

      <nav className="radar-nav" aria-label="Reddit radar navigation">
        <a
          href={buildAppUrl("")}
          className={route === "" ? "tab active" : "tab"}
          onClick={(event) => {
            event.preventDefault();
            navigateToApp("");
          }}
        >
          Overview
        </a>
        <a
          href={buildAppUrl("runs")}
          className={route === "runs" ? "tab active" : "tab"}
          onClick={(event) => {
            event.preventDefault();
            navigateToApp("runs");
          }}
        >
          Run History
        </a>
      </nav>

      <section className="toolbar">
        <div className="button-row">
          <button
            className="primary-button"
            onClick={() => void triggerScan()}
            disabled={scanState === "running"}
          >
            {scanState === "running" ? "Scanning Reddit..." : "Run Scan Now"}
          </button>
          <button
            className="secondary-button"
            onClick={() => void ensureSchedule()}
            disabled={scheduleState === "saving"}
          >
            {scheduleState === "saving" ? "Saving schedule..." : "Ensure 3h Schedule"}
          </button>
        </div>
        <div className="filters">
          <div className="segmented">
            {(["24h", "7d", "30d", "all"] as WindowKey[]).map((value) => (
              <button
                key={value}
                className={windowKey === value ? "segment active" : "segment"}
                onClick={() => setWindowKey(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <input
            className="text-filter"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search titles and selftext"
          />
          <select
            className="select-filter"
            value={subreddit}
            onChange={(event) => setSubreddit(event.target.value)}
          >
            <option value="">All subreddits</option>
            {dashboard?.catalog.subreddits.map((value) => (
              <option key={value} value={value}>
                r/{value}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading && !dashboard ? (
        <section className="empty-state">Loading dashboard...</section>
      ) : dashboard ? (
        <>
          {route === "" ? (
            <>
              <section className="summary-grid">
                <article className="summary-card">
                  <span className="label">Tracked posts</span>
                  <strong>{dashboard.stats.totalPosts}</strong>
                  <small>{dashboard.stats.postsInWindow} in the selected window</small>
                </article>
                <article className="summary-card">
                  <span className="label">Latest run</span>
                  <strong>{dashboard.latestRun?.status ?? "none"}</strong>
                  <small>{formatTimestamp(dashboard.latestRun?.startedAt)}</small>
                </article>
                <article className="summary-card">
                  <span className="label">Next scheduled run</span>
                  <strong>{formatRelative(dashboard.schedule?.nextRunAt)}</strong>
                  <small>{formatTimestamp(dashboard.schedule?.nextRunAt)}</small>
                </article>
                <article className="summary-card">
                  <span className="label">Coverage</span>
                  <strong>{dashboard.config.subredditCount} subreddits</strong>
                  <small>{dashboard.config.queryCount} search templates</small>
                </article>
              </section>

              <section className="content-grid">
                <div className="feed-column">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Discussion Feed</p>
                      <h2>Recent AI agent posts</h2>
                    </div>
                  </div>
                  <div className="feed-list">
                    {dashboard.posts.map((post) => (
                      <article className="post-card" key={post.id}>
                        <div className="post-header">
                          <div className="chip-row">
                            <span className="chip accent">r/{post.subreddit}</span>
                            <span className="chip">{post.searchQuery}</span>
                          </div>
                          <a
                            className="post-link"
                            href={`https://www.reddit.com${post.permalink}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {post.title}
                          </a>
                        </div>
                        <p className="post-body">{truncate(post.selftext, 220)}</p>
                        <div className="post-meta">
                          <span>u/{post.author}</span>
                          <span>{post.score} points</span>
                          <span>{post.numComments} comments</span>
                          <span>seen {post.seenCount} times</span>
                          <span>{formatRelative(post.lastSeenAt)}</span>
                        </div>
                      </article>
                    ))}
                    {dashboard.posts.length === 0 ? (
                      <div className="empty-inline">No posts matched the current filters.</div>
                    ) : null}
                  </div>
                </div>

                <aside className="rail">
                  <section className="rail-card">
                    <p className="eyebrow">Schedule</p>
                    <h3>Automation state</h3>
                    <dl className="detail-list">
                      <div>
                        <dt>Enabled</dt>
                        <dd>{dashboard.schedule?.enabled ? "Yes" : "No"}</dd>
                      </div>
                      <div>
                        <dt>Timezone</dt>
                        <dd>{dashboard.schedule?.tzid ?? "UTC"}</dd>
                      </div>
                      <div>
                        <dt>Next run</dt>
                        <dd>{formatTimestamp(dashboard.schedule?.nextRunAt)}</dd>
                      </div>
                      <div>
                        <dt>Last run</dt>
                        <dd>{formatTimestamp(dashboard.schedule?.lastRunAt)}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="rail-card">
                    <p className="eyebrow">Concentration</p>
                    <h3>Where the discussion is landing</h3>
                    <div className="bar-list">
                      {dashboard.topSubreddits.map((item) => (
                        <div className="bar-item" key={item.subreddit}>
                          <div className="bar-labels">
                            <span>r/{item.subreddit}</span>
                            <strong>{item.count}</strong>
                          </div>
                          <div className="bar-track">
                            <div
                              className="bar-fill"
                              style={{
                                width: `${Math.max(
                                  12,
                                  Math.round((item.count / Math.max(dashboard.topSubreddits[0]?.count ?? 1, 1)) * 100),
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rail-card">
                    <p className="eyebrow">Search Design</p>
                    <h3>Current watchlist</h3>
                    <ul className="plain-list">
                      {dashboard.config.queries.map((query) => (
                        <li key={query}>{query}</li>
                      ))}
                    </ul>
                  </section>
                </aside>
              </section>
            </>
          ) : (
            <section className="runs-layout">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Execution Log</p>
                  <h2>Recent scan runs</h2>
                </div>
              </div>
              <div className="run-table">
                {dashboard.runs.map((run) => (
                  <article className="run-row" key={run.id}>
                    <div>
                      <span className={`status-pill ${run.status}`}>{run.status}</span>
                      <h3>{formatTimestamp(run.startedAt)}</h3>
                    </div>
                    <div>
                      <span className="metric-label">Requests</span>
                      <strong>{run.scannedPairCount}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Fetched</span>
                      <strong>{run.fetchedCount}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Inserted</span>
                      <strong>{run.insertedCount}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Updated</span>
                      <strong>{run.updatedCount}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Errors</span>
                      <strong>{run.errorCount}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="empty-state">No dashboard data available.</section>
      )}
    </div>
  );
}

