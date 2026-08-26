import { useState } from "react";
import { Bot, Brain, CheckCircle, ChevronDown, ExternalLink, Eye, Github, ListFilter, MessageSquare, Plus, RefreshCw, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeReviewAppIcon } from "@/components/app/CodeReviewAppIcon";
import type { ActivityCounts, ActivityItem, DashboardData, GhAuthStatus, PRReviewSettingsData } from "@/types";
import { buildPageList, formatRelative } from "@/lib/helpers";
import { ACTIVITY_FILTERS, ACTIVITY_PAGE_SIZE } from "@/lib/constants";
import { RepoCard } from "./RepoCard";
import { GithubAvatar } from "./GithubAvatar";

/** Per-type tag icon + accent color for an activity item's badge overlay. */
const TYPE_META: Record<string, { Icon: typeof MessageSquare; dot: string }> = {
  review: { Icon: Eye, dot: "text-violet-600 dark:text-violet-400" },
  question: { Icon: MessageSquare, dot: "text-sky-600 dark:text-sky-400" },
  memory: { Icon: Brain, dot: "text-amber-600 dark:text-amber-400" },
  "code-task": { Icon: Wrench, dot: "text-emerald-600 dark:text-emerald-400" },
};

type StatusTone = "success" | "active" | "danger" | "muted" | "info";

/** Map a raw review/task status to a minimal dot-pill tone + humanized label. */
function statusMeta(status: string): { tone: StatusTone; label: string } {
  switch (status) {
    case "completed":
      return { tone: "success", label: "Completed" };
    case "failed":
      return { tone: "danger", label: "Failed" };
    case "cancelled":
      return { tone: "muted", label: "Cancelled" };
    case "skipped":
      return { tone: "muted", label: "Skipped" };
    case "open":
      return { tone: "info", label: "Needs review" };
    case "done":
      return { tone: "muted", label: "Done" };
    case "queued":
      return { tone: "active", label: "Queued" };
    case "pending":
      return { tone: "active", label: "Pending" };
    default:
      return { tone: "active", label: "Running" };
  }
}

const STATUS_TONE: Record<StatusTone, { dot: string; text: string; ring: string }> = {
  success: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", ring: "border-emerald-200 dark:border-emerald-900" },
  active: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", ring: "border-amber-200 dark:border-amber-900" },
  danger: { dot: "bg-red-500", text: "text-red-700 dark:text-red-300", ring: "border-red-200 dark:border-red-900" },
  info: { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300", ring: "border-sky-200 dark:border-sky-900" },
  muted: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", ring: "border-border" },
};

function MiniStatusBadge({ status }: { status: string }) {
  const { tone, label } = statusMeta(status);
  const c = STATUS_TONE[tone];
  const pulse = tone === "active" ? "animate-pulse" : "";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium ${c.ring} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot} ${pulse}`} />
      {label}
    </span>
  );
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }) {
  const meta = TYPE_META[item.type] ?? { Icon: Bot, dot: "text-muted-foreground" };
  const surfaceLabel = item.surface === "pr" ? "PR" : "Issue";
  return (
    <button
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50"
    >
      {/* Actor avatar with a type-icon badge overlaid at the bottom-right. */}
      <div className="relative shrink-0">
        <GithubAvatar login={item.actor} size={40} rounded="rounded-full" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-background shadow-sm">
          <meta.Icon className={`h-3 w-3 ${meta.dot}`} />
        </span>
      </div>

      {/* Two rows: (surface #num · title) then (repo · time). */}
      <div className="min-w-0 flex-1">
        <div className="min-w-0 truncate text-sm">
          <span className="font-medium text-muted-foreground">
            {item.type === "review" ? `${surfaceLabel} #${item.number}` : item.tag}
          </span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium text-foreground">{item.title}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{item.repo}</span>
          <span className="shrink-0 whitespace-nowrap">· {formatRelative(item.createdAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.hasSession && <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has agent session" />}
        <MiniStatusBadge status={item.status} />
      </div>
    </button>
  );
}

/** Placeholder repo card matching RepoCard's footprint (avatar, name, badge, sparkline). */
function RepoCardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-3 w-10 rounded-full" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-[92px] rounded" />
      </div>
    </div>
  );
}

/** Placeholder activity row matching ActivityRow's footprint. */
function ActivityRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 px-3 py-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      <Skeleton className="h-6 w-24 rounded-full" />
    </div>
  );
}

export function HomeDashboard({
  dashboard,
  ghAuth,
  loading = false,
  error,
  refreshing,
  repositories,
  prSettings,
  repoStats,
  activityCounts,
  activityItems,
  activityTotal,
  activityPage,
  activityFilter,
  loadingActivity,
  repoUrl,
  addingRepo,
  showAddRepo,
  prInput,
  triggeringReview,
  onRefresh,
  onDismissError,
  onRepoUrlChange,
  onShowAddRepoChange,
  onAddRepository,
  onOpenTriggerSettings,
  onPrInputChange,
  onTriggerPRReview,
  onOpenActivityItem,
  onActivityFilterChange,
  onGoToActivityPage,
}: {
  dashboard: DashboardData | null;
  ghAuth: GhAuthStatus | null;
  loading?: boolean;
  error: string | null;
  refreshing: boolean;
  repositories: DashboardData["repositories"];
  prSettings: PRReviewSettingsData[];
  repoStats: DashboardData["repoStats"];
  activityCounts: ActivityCounts | null;
  activityItems: ActivityItem[];
  activityTotal: number;
  activityPage: number;
  activityFilter: string;
  loadingActivity: boolean;
  repoUrl: string;
  addingRepo: boolean;
  showAddRepo: boolean;
  prInput: string;
  triggeringReview: boolean;
  onRefresh: () => void;
  onDismissError: () => void;
  onRepoUrlChange: (value: string) => void;
  onShowAddRepoChange: (value: boolean) => void;
  onAddRepository: () => void;
  onOpenTriggerSettings: (repoName?: string) => void;
  onPrInputChange: (value: string) => void;
  onTriggerPRReview: (input?: string) => void;
  onOpenActivityItem: (item: ActivityItem) => void;
  onActivityFilterChange: (type: string) => void;
  onGoToActivityPage: (page: number) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  // Skeleton only on the true cold start: loading with nothing (no cache) to show.
  const showSkeleton = loading && !dashboard;
  const totalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));
  const countFor = (value: string): number | null => {
    if (!activityCounts) return null;
    return (activityCounts as unknown as Record<string, number>)[value] ?? 0;
  };
  const activityAll = countFor("all") ?? activityTotal;

  return (
    <>
      {/* ---------- Top panel: header + repositories + manual review ---------- */}
      <Card className="mb-6 overflow-hidden p-0">
        {/* Header */}
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <CodeReviewAppIcon />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Code Review</h1>
              {dashboard ? (
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {dashboard.stats.totalRepos} repo{dashboard.stats.totalRepos !== 1 ? "s" : ""} · {dashboard.stats.totalPRReviews} review{dashboard.stats.totalPRReviews !== 1 ? "s" : ""}
                </div>
              ) : showSkeleton ? (
                <Skeleton className="mt-1.5 h-4 w-36" />
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {ghAuth?.loggedIn && (
              <a
                href="/settings/integrations"
                title="Manage GitHub connection in Settings → Integrations"
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <Github className="h-4 w-4" />
                <CheckCircle className="h-3.5 w-3.5" />
                {ghAuth.login ? `@${ghAuth.login}` : "GitHub connected"}
              </a>
            )}
            <Button onClick={onRefresh} disabled={refreshing} variant="outline" size="sm">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-4 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:mx-6">
            <span>{error}</span>
            <button onClick={onDismissError} className="ml-3 shrink-0 text-xs underline">
              dismiss
            </button>
          </div>
        )}

        {ghAuth && !ghAuth.loggedIn && (
          <div className="mx-5 mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40 sm:mx-6">
            <div className="flex items-start gap-3">
              <Github className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">GitHub is not connected</p>
                <p className="mt-0.5 text-sm text-amber-800/90 dark:text-amber-200/90">
                  Code Review uses the GitHub CLI to read PRs and post reviews. Connect your GitHub account to enable reviews.
                </p>
                <a
                  href="/settings/integrations"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-900 underline underline-offset-2 hover:no-underline dark:text-amber-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Connect GitHub in Settings → Integrations
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Repositories */}
        <div className="border-t px-5 py-5 sm:px-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Github className="h-4 w-4 text-muted-foreground" />
              Repositories
              {!showSkeleton && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                  {repositories.length}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShowAddRepoChange(!showAddRepo)}
              className="border-dashed"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>

          {showAddRepo && (
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => onRepoUrlChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onAddRepository()}
                placeholder="https://github.com/owner/repo or owner/repo"
                autoFocus
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button onClick={onAddRepository} disabled={addingRepo || !repoUrl.trim()} size="sm">
                {addingRepo ? "Adding..." : "Add"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onShowAddRepoChange(false);
                  onRepoUrlChange("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {showSkeleton ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <RepoCardSkeleton key={i} />
              ))}
            </div>
          ) : repositories.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No repositories added yet. Click "Add" to monitor a GitHub repository.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {repositories.map((r) => (
                <RepoCard
                  key={r.id}
                  repo={r}
                  settings={prSettings.find((s) => s.repo === r.name)}
                  stat={repoStats?.[r.name]}
                  onOpenSettings={onOpenTriggerSettings}
                />
              ))}
            </div>
          )}
        </div>

        {/* Collapsible manual review */}
        <div className="border-t">
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/40 sm:px-6"
          >
            <Eye className="h-4 w-4 shrink-0" />
            <span className="flex-1">Run a manual review on a specific PR</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
          </button>
          {manualOpen && (
            <div className="flex gap-2 px-5 pb-4 sm:px-6">
              <input
                type="text"
                value={prInput}
                onChange={(e) => onPrInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onTriggerPRReview()}
                placeholder="https://github.com/owner/repo/pull/123"
                autoFocus
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button onClick={() => onTriggerPRReview()} disabled={triggeringReview || !prInput.trim()}>
                <Eye className="mr-1 h-4 w-4" />
                {triggeringReview ? "Starting..." : "Review"}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* ---------- Activity ---------- */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            Activity
            {!showSkeleton && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                {activityAll}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1">
            {ACTIVITY_FILTERS.map((f) => {
              const active = activityFilter === f.value;
              const count = countFor(f.value);
              return (
                <button
                  key={f.value}
                  onClick={() => onActivityFilterChange(f.value)}
                  disabled={loadingActivity}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                  {count !== null && (
                    <span className={active ? "text-muted-foreground" : "text-muted-foreground/70"}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <CardContent className="p-0">
          {showSkeleton ? (
            <div className="divide-y">
              {Array.from({ length: 6 }).map((_, i) => (
                <ActivityRowSkeleton key={i} />
              ))}
            </div>
          ) : activityItems.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              {activityFilter === "all"
                ? "No activity yet. Run a manual review above, or @mention the bot on a PR/issue to ask a question, give feedback, or request a code task."
                : "No activity of this type yet."}
            </p>
          ) : (
            <div className="divide-y">
              {activityItems.map((item) => (
                <ActivityRow key={`${item.kind}:${item.id}`} item={item} onOpen={onOpenActivityItem} />
              ))}
            </div>
          )}
          {activityTotal > ACTIVITY_PAGE_SIZE && (
            <div className="border-t px-4 py-3">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious onClick={() => onGoToActivityPage(activityPage - 1)} disabled={loadingActivity || activityPage <= 1} />
                  </PaginationItem>
                  {buildPageList(activityPage, totalPages).map((p, idx) =>
                    p === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${idx}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink isActive={p === activityPage} disabled={loadingActivity} onClick={() => onGoToActivityPage(p)}>
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext onClick={() => onGoToActivityPage(activityPage + 1)} disabled={loadingActivity || activityPage >= totalPages} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Page {activityPage} of {totalPages} · {activityTotal} total
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
