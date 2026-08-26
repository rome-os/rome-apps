import { useEffect, useMemo, useState } from "react";
import {
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import "./styles.css";

interface RedditPost {
  id: string;
  redditPostId: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  selftext: string | null;
  searchQuery: string;
  scanName: string;
  createdUtc: string;
  discoveredAt: string;
}

interface ApiResponse {
  posts: RedditPost[];
  subreddits: string[];
  scanNames: string[];
  stats: { total: number; today: number };
}

type AppRoute = "" | "reddit-posts";
type TimeRange = "24h" | "7d" | "30d" | "all";
type SortField =
  | "score"
  | "title"
  | "subreddit"
  | "author"
  | "numComments"
  | "createdUtc"
  | "discoveredAt";
type SortDir = "asc" | "desc";

function normalizeRoute(path: string): AppRoute {
  return path === "" ? "" : "reddit-posts";
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const diff = Date.now() - date.getTime();
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function timeRangeToSince(range: TimeRange): string | undefined {
  if (range === "all") {
    return undefined;
  }

  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1_000).toISOString();
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1_000).toISOString();
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString();
  }
}

function buildRedditPostsUrl(
  bootstrap: RomeAppBootstrap,
  options: {
    timeRange: TimeRange;
    scanFilter: string;
    subFilter: string;
    search: string;
  },
): URL {
  const url = new URL(`${bootstrap.apiBase}/reddit-posts`, window.location.origin);
  const since = timeRangeToSince(options.timeRange);

  if (since) {
    url.searchParams.set("since", since);
  }
  if (options.scanFilter) {
    url.searchParams.set("scanName", options.scanFilter);
  }
  if (options.subFilter) {
    url.searchParams.set("subreddit", options.subFilter);
  }
  if (options.search.trim()) {
    url.searchParams.set("search", options.search.trim());
  }

  return url;
}

function SortHeader(props: {
  field: SortField;
  label: string;
  activeField: SortField;
  activeDir: SortDir;
  onToggle: (field: SortField) => void;
}) {
  const active = props.field === props.activeField;

  return (
    <button
      type="button"
      className="table-sort"
      onClick={() => props.onToggle(props.field)}
    >
      <span>{props.label}</span>
      <span className={`table-sort-arrow${active ? " active" : ""}`}>
        {active ? (props.activeDir === "asc" ? "^" : "v") : "-"}
      </span>
    </button>
  );
}

function RedditPostsPage({ bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [scanFilter, setScanFilter] = useState("");
  const [subFilter, setSubFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;

    async function loadPosts() {
      const url = buildRedditPostsUrl(bootstrap, {
        timeRange,
        scanFilter,
        subFilter,
        search,
      });

      try {
        setError(null);
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`News API returned ${response.status}`);
        }

        const payload = (await response.json()) as ApiResponse;
        if (!cancelled) {
          setData(payload);
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

    setLoading(true);
    void loadPosts();
    const interval = window.setInterval(loadPosts, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [bootstrap, timeRange, scanFilter, subFilter, search]);

  const sortedPosts = useMemo(() => {
    if (!data) {
      return [];
    }

    return [...data.posts].sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case "score":
          comparison = left.score - right.score;
          break;
        case "title":
          comparison = left.title.localeCompare(right.title);
          break;
        case "subreddit":
          comparison = left.subreddit.localeCompare(right.subreddit);
          break;
        case "author":
          comparison = left.author.localeCompare(right.author);
          break;
        case "numComments":
          comparison = left.numComments - right.numComments;
          break;
        case "createdUtc":
          comparison = new Date(left.createdUtc).getTime() - new Date(right.createdUtc).getTime();
          break;
        case "discoveredAt":
          comparison =
            new Date(left.discoveredAt).getTime() - new Date(right.discoveredAt).getTime();
          break;
      }

      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [data, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }

    setSortField(field);
    setSortDir(field === "title" || field === "subreddit" || field === "author" ? "asc" : "desc");
  }

  return (
    <div className="news-shell">
      <div className="news-backdrop" />
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">News App</p>
          <h1>Reddit posts live under News now.</h1>
          <p className="hero-text">
            This dashboard pulls directly from the News app API and keeps the Reddit scan results
            inside the app host instead of the repo-local pages bucket.
          </p>
          <div className="hero-tab-row">
            <button
              type="button"
              className="hero-tab active"
              onClick={() => navigateToApp("reddit-posts")}
            >
              Reddit posts
            </button>
          </div>
        </div>

        <div className="hero-metrics">
          <article className="metric-card">
            <span>Total posts</span>
            <strong>{data?.stats.total ?? "..."}</strong>
          </article>
          <article className="metric-card">
            <span>Today</span>
            <strong>{data?.stats.today ?? "..."}</strong>
          </article>
          <article className="metric-card">
            <span>Visible</span>
            <strong>{data?.posts.length ?? 0}</strong>
          </article>
        </div>
      </section>

      <section className="toolbar">
        <div className="segmented-control">
          {(["24h", "7d", "30d", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              type="button"
              className={`segment${timeRange === range ? " active" : ""}`}
              onClick={() => setTimeRange(range)}
            >
              {range === "all" ? "All" : range}
            </button>
          ))}
        </div>

        <div className="filter-row">
          {data && data.scanNames.length > 0 ? (
            <select value={scanFilter} onChange={(event) => setScanFilter(event.target.value)}>
              <option value="">All scans</option>
              {data.scanNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          {data && data.subreddits.length > 0 ? (
            <select value={subFilter} onChange={(event) => setSubFilter(event.target.value)}>
              <option value="">All subreddits</option>
              {data.subreddits.map((subreddit) => (
                <option key={subreddit} value={subreddit}>
                  r/{subreddit}
                </option>
              ))}
            </select>
          ) : null}

          <input
            type="search"
            placeholder="Search titles"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="table-panel">
        {loading && !data ? (
          <div className="empty-state">Loading Reddit posts...</div>
        ) : sortedPosts.length === 0 ? (
          <div className="empty-state">No posts found for the current filters.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <SortHeader
                      field="score"
                      label="Score"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th>
                    <SortHeader
                      field="title"
                      label="Title"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th>
                    <SortHeader
                      field="subreddit"
                      label="Subreddit"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th>
                    <SortHeader
                      field="author"
                      label="Author"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th>
                    <SortHeader
                      field="numComments"
                      label="Comments"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th>
                    <SortHeader
                      field="createdUtc"
                      label="Posted"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th>
                    <SortHeader
                      field="discoveredAt"
                      label="Discovered"
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map((post) => (
                  <tr key={post.id}>
                    <td className="numeric-cell">{post.score}</td>
                    <td className="title-cell">
                      <a
                        href={`https://www.reddit.com${post.permalink}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {post.title}
                      </a>
                      <div className="meta-line">{post.scanName}</div>
                    </td>
                    <td>r/{post.subreddit}</td>
                    <td>{post.author}</td>
                    <td>{post.numComments}</td>
                    <td>
                      <div>{formatDateTime(post.createdUtc)}</div>
                      <div className="meta-line">{formatRelative(post.createdUtc)}</div>
                    </td>
                    <td>
                      <div>{formatDateTime(post.discoveredAt)}</div>
                      <div className="meta-line">{formatRelative(post.discoveredAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function NewsApp({ bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [route, setRoute] = useState<AppRoute>(() => normalizeRoute(getCurrentAppPath()));

  useEffect(() => {
    return subscribeToAppPath((nextPath) => setRoute(normalizeRoute(nextPath)));
  }, []);

  useEffect(() => {
    if (route === "") {
      navigateToApp("reddit-posts", { replace: true });
    }
  }, [route]);

  return <RedditPostsPage bootstrap={bootstrap} />;
}
