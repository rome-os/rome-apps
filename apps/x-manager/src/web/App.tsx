import "./styles.css";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchAppApi,
  getBootstrap,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  Plus,
  Trash2,
  User,
  Mic,
  BookOpen,
  LogIn,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// --- Types ---

interface AccountState {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  followers: string | null;
  following: string | null;
  tweets: string | null;
  loginStatus: string;
  lastCheckedAt: string | null;
  updatedAt: string;
}

interface BrandVoice {
  id: string;
  accountHandle: string;
  isOwn: number;
  learnStatus: string;
  learnProgress: number;
  memoryFilePath: string | null;
  sourceAccounts: string | null;
  tweetsAnalyzed: number;
  lastLearnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActionRun {
  id: string;
  actionName: string;
  status: string;
  inputJson: string | null;
  outputJson: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface DashboardData {
  accountState: AccountState | null;
  brandVoices: BrandVoice[];
  recentRuns: ActionRun[];
  stats: {
    totalRuns: number;
    totalBrandVoices: number;
    ownBrandVoices: number;
    referenceBrandVoices: number;
  };
}

interface ActionRunsPage {
  runs: ActionRun[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const RUNS_PAGE_SIZE = 20;

// --- Helpers ---

function buildPageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "never";
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return dateStr;
  }
}

// --- Badge Components ---

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    complete: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    logged_in: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    learning: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    idle: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
    unknown: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    not_logged_in: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  const icons: Record<string, React.ReactNode> = {
    success: <CheckCircle className="inline w-3 h-3 mr-1" />,
    complete: <CheckCircle className="inline w-3 h-3 mr-1" />,
    logged_in: <CheckCircle className="inline w-3 h-3 mr-1" />,
    running: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    learning: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    error: <XCircle className="inline w-3 h-3 mr-1" />,
    not_logged_in: <XCircle className="inline w-3 h-3 mr-1" />,
    idle: <Clock className="inline w-3 h-3 mr-1" />,
    unknown: <AlertCircle className="inline w-3 h-3 mr-1" />,
  };
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.idle}`}
    >
      {icons[status] || null}
      {label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-blue-500 rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function ActionNameBadge({ name }: { name: string }) {
  const colors: Record<string, string> = {
    "check-login": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
    "learn-brand-voice": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    "fetch-tweets": "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
    "post-tweet": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    "reply-tweet": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    "poll-metrics": "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    "fetch-notifications": "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${colors[name] || "bg-muted text-muted-foreground"}`}>
      {name}
    </span>
  );
}

// --- Account Status Card ---

function AccountStatusCard({
  account,
  onCheckLogin,
  checking,
}: {
  account: AccountState | null;
  onCheckLogin: () => void;
  checking: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Account</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckLogin}
            disabled={checking}
          >
            {checking ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            {checking ? "Checking..." : "Check Login"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!account ? (
          <div className="text-sm text-muted-foreground">
            No account info yet. Click "Check Login" to verify your X login status.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">
                    {account.displayName || account.handle}
                  </span>
                  {account.handle !== "unknown" && (
                    <a
                      href={`https://x.com/${account.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                {account.handle !== "unknown" && (
                  <span className="text-sm text-muted-foreground">@{account.handle}</span>
                )}
              </div>
              <StatusBadge status={account.loginStatus} />
            </div>

            {account.bio && (
              <p className="text-sm text-muted-foreground line-clamp-2">{account.bio}</p>
            )}

            {account.loginStatus === "logged_in" && (
              <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                <div className="text-center">
                  <div className="text-lg font-semibold">{account.followers || "0"}</div>
                  <div className="text-xs text-muted-foreground">Followers</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold">{account.following || "0"}</div>
                  <div className="text-xs text-muted-foreground">Following</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold">{account.tweets || "0"}</div>
                  <div className="text-xs text-muted-foreground">Tweets</div>
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Last checked: {formatRelativeTime(account.lastCheckedAt)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Brand Voice Card ---

function BrandVoiceCard({
  brandVoices,
  onLearnOwn,
  onAddReference,
  onDelete,
  learning,
}: {
  brandVoices: BrandVoice[];
  onLearnOwn: () => void;
  onAddReference: (username: string) => void;
  onDelete: (id: string) => void;
  learning: boolean;
}) {
  const [refUsername, setRefUsername] = useState("");
  const ownVoices = brandVoices.filter((v) => v.isOwn === 1);
  const refVoices = brandVoices.filter((v) => v.isOwn === 0);

  const handleAddRef = () => {
    const u = refUsername.trim().replace(/^@/, "");
    if (u) {
      onAddReference(u);
      setRefUsername("");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Brand Voice</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onLearnOwn}
            disabled={learning}
          >
            {learning ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookOpen className="h-3.5 w-3.5" />
            )}
            {learning ? "Learning..." : "Learn My Voice"}
          </Button>
        </div>
        <CardDescription>
          Learn your writing style or borrow from other accounts
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Own voice profiles */}
          {ownVoices.length === 0 && refVoices.length === 0 && (
            <div className="text-sm text-muted-foreground py-2">
              No brand voice learned yet. Click "Learn My Voice" to analyze your tweets and create a voice profile.
            </div>
          )}

          {ownVoices.map((v) => (
            <div key={v.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">@{v.accountHandle}</span>
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">own</span>
                </div>
                <StatusBadge status={v.learnStatus} />
              </div>
              {v.learnStatus === "learning" && (
                <ProgressBar value={v.learnProgress} />
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{v.tweetsAnalyzed} tweets analyzed</span>
                {v.lastLearnedAt && <span>learned {formatRelativeTime(v.lastLearnedAt)}</span>}
              </div>
            </div>
          ))}

          {/* Reference voice profiles */}
          {refVoices.length > 0 && (
            <div className="pt-2">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Reference Voices</h4>
              {refVoices.map((v) => (
                <div key={v.id} className="rounded-lg border p-3 space-y-2 mb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">@{v.accountHandle}</span>
                      <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">reference</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={v.learnStatus} />
                      <button
                        onClick={() => onDelete(v.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {v.learnStatus === "learning" && (
                    <ProgressBar value={v.learnProgress} />
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{v.tweetsAnalyzed} tweets analyzed</span>
                    {v.lastLearnedAt && <span>learned {formatRelativeTime(v.lastLearnedAt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add reference account */}
          <div className="flex gap-2 pt-2 border-t">
            <input
              type="text"
              placeholder="@username to learn from"
              value={refUsername}
              onChange={(e) => setRefUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddRef()}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddRef}
              disabled={!refUsername.trim() || learning}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Reference
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Action History ---

function ActionHistoryTable({
  runs,
  total,
  page,
  onPageChange,
}: {
  runs: ActionRun[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / RUNS_PAGE_SIZE));
  const pageList = buildPageList(page, totalPages);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Action History</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">{total} total runs</span>
        </div>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No action runs yet. Actions will be logged here as they execute.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground">Action</th>
                    <th className="pb-2 font-medium text-muted-foreground">Status</th>
                    <th className="pb-2 font-medium text-muted-foreground">Started</th>
                    <th className="pb-2 font-medium text-muted-foreground">Duration</th>
                    <th className="pb-2 font-medium text-muted-foreground">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    let duration = "";
                    if (run.startedAt && run.finishedAt) {
                      const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
                      if (ms < 1000) duration = `${ms}ms`;
                      else if (ms < 60000) duration = `${(ms / 1000).toFixed(1)}s`;
                      else duration = `${(ms / 60000).toFixed(1)}m`;
                    } else if (run.status === "running") {
                      duration = "running...";
                    }

                    let details = "";
                    if (run.errorMessage) {
                      details = run.errorMessage.slice(0, 80);
                    } else if (run.outputJson) {
                      try {
                        const out = JSON.parse(run.outputJson);
                        details = Object.entries(out)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")
                          .slice(0, 80);
                      } catch {
                        details = run.outputJson.slice(0, 80);
                      }
                    }

                    return (
                      <tr key={run.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 pr-3">
                          <ActionNameBadge name={run.actionName} />
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelativeTime(run.startedAt)}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          {duration}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]" title={details}>
                          {details || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => onPageChange(page - 1)}
                      disabled={page <= 1}
                    />
                  </PaginationItem>
                  {pageList.map((p, i) =>
                    p === "ellipsis" ? (
                      <PaginationItem key={`e-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink
                          isActive={p === page}
                          onClick={() => onPageChange(p as number)}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => onPageChange(page + 1)}
                      disabled={page >= totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main App ---

export default function App() {
  const [bootstrap, setBootstrap] = useState<RomeAppBootstrap | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [learningVoice, setLearningVoice] = useState(false);

  // Pagination for action runs
  const [runsPage, setRunsPage] = useState(1);
  const [runsData, setRunsData] = useState<ActionRunsPage | null>(null);

  // Fast-poll: after triggering an action, poll every 2s until no "running"
  // actions remain, then fall back to the idle 15s interval.
  const fastPollUntil = useRef<number>(0);

  const refreshAll = useCallback(async () => {
    const [dashRes, runsRes] = await Promise.allSettled([
      fetchAppApi("dashboard").then(async (r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json() as Promise<DashboardData>;
      }),
      fetchAppApi(
        `action-runs?limit=${RUNS_PAGE_SIZE}&offset=${(runsPage - 1) * RUNS_PAGE_SIZE}`,
      ).then(async (r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json() as Promise<ActionRunsPage>;
      }),
    ]);
    if (dashRes.status === "fulfilled") {
      setDashboard(dashRes.value);
      setError(null);
    } else {
      setError(dashRes.reason?.message ?? String(dashRes.reason));
    }
    if (runsRes.status === "fulfilled") setRunsData(runsRes.value);
    setLoading(false);

    // Auto-clear button spinners once no running actions remain
    const runs = runsRes.status === "fulfilled" ? runsRes.value.runs : [];
    const hasRunning = runs.some((r) => r.status === "running");
    if (!hasRunning) {
      setCheckingLogin(false);
      setLearningVoice(false);
    }
  }, [runsPage]);

  // Bootstrap + first load
  useEffect(() => {
    setBootstrap(getBootstrap());
    refreshAll();
  }, [refreshAll]);

  // Adaptive polling: 2s while fast-poll is active, 15s idle
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      refreshAll().finally(() => {
        const fast = Date.now() < fastPollUntil.current;
        timer = setTimeout(tick, fast ? 2000 : 15000);
      });
    };
    const fast = Date.now() < fastPollUntil.current;
    timer = setTimeout(tick, fast ? 2000 : 15000);
    return () => clearTimeout(timer);
  }, [refreshAll]);

  /** Activate fast-polling for the next N ms (default 30s). */
  const startFastPoll = (durationMs = 30_000) => {
    fastPollUntil.current = Date.now() + durationMs;
  };

  const handleCheckLogin = async () => {
    setCheckingLogin(true);
    try {
      await fetchAppApi("check-login", { method: "POST" });
      startFastPoll();
      // Immediate first refresh so the "running" row shows up right away
      refreshAll();
    } catch {
      setCheckingLogin(false);
    }
  };

  const handleLearnOwnVoice = async () => {
    setLearningVoice(true);
    try {
      await fetchAppApi("brand-voices/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isOwn: true }),
      });
      startFastPoll(60_000);
      refreshAll();
    } catch {
      setLearningVoice(false);
    }
  };

  const handleAddReference = async (username: string) => {
    setLearningVoice(true);
    try {
      await fetchAppApi("brand-voices/add-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      startFastPoll(60_000);
      refreshAll();
    } catch {
      setLearningVoice(false);
    }
  };

  const handleDeleteVoice = async (id: string) => {
    try {
      await fetchAppApi(`brand-voices/${id}`, { method: "DELETE" });
      refreshAll();
    } catch (err) {
      console.error("Failed to delete brand voice:", err);
    }
  };

  const handleRunsPageChange = (page: number) => {
    setRunsPage(page);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <XCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive text-center max-w-md">{error}</p>
        <Button onClick={() => { setLoading(true); refreshAll(); }}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path
                d="M13.54 10.41L18.2 5h-1.2l-4.05 4.7L9.8 5H5.5l4.88 7.13L5.5 18h1.2l4.28-4.97L14.2 18h4.3l-5.06-7.39.1.1zm-1.52 1.76l-.5-.71L7.3 5.88h1.7l3.18 4.55.5.71 4.13 5.9h-1.7l-3.38-4.82-.01-.05z"
                fill="white"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">X Manager</h1>
            <p className="text-sm text-muted-foreground">
              Account management, brand voice, and action monitoring
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refreshAll()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Summary */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">
              {dashboard.accountState?.loginStatus === "logged_in" ? (
                <CheckCircle className="h-6 w-6 text-green-500 mx-auto" />
              ) : (
                <XCircle className="h-6 w-6 text-red-500 mx-auto" />
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Login Status</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">{dashboard.stats.ownBrandVoices}</div>
            <div className="text-xs text-muted-foreground mt-1">Own Voices</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">{dashboard.stats.referenceBrandVoices}</div>
            <div className="text-xs text-muted-foreground mt-1">Reference Voices</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">{dashboard.stats.totalRuns}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Runs</div>
          </div>
        </div>
      )}

      {/* Account + Brand Voice */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AccountStatusCard
          account={dashboard?.accountState ?? null}
          onCheckLogin={handleCheckLogin}
          checking={checkingLogin}
        />
        <BrandVoiceCard
          brandVoices={dashboard?.brandVoices ?? []}
          onLearnOwn={handleLearnOwnVoice}
          onAddReference={handleAddReference}
          onDelete={handleDeleteVoice}
          learning={learningVoice}
        />
      </div>

      {/* Action History */}
      <ActionHistoryTable
        runs={runsData?.runs ?? dashboard?.recentRuns ?? []}
        total={runsData?.total ?? dashboard?.stats.totalRuns ?? 0}
        page={runsPage}
        onPageChange={handleRunsPageChange}
      />
    </div>
  );
}
