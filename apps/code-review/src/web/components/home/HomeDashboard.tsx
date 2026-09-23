import { useState } from "react";
import { Bot, Brain, CheckCircle, ChevronDown, ExternalLink, Eye, Github, ListFilter, MessageSquare, Plus, RefreshCw, Wrench, X } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent } from "@rome-os/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Badge, type BadgeProps } from "@rome-os/ui/badge";
import { EmptyState, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@rome-os/ui/empty-state";
import { FilterChipGroup } from "@rome-os/ui/filter-chip-group";
import { IconButton } from "@rome-os/ui/icon-button";
import { Input } from "@rome-os/ui/input";
import { ListCollection, ListFooter, ListGrid } from "@rome-os/ui/layout-list";
import { List, ListRow, ListRowContent } from "@rome-os/ui/list-row";
import {
  PageActions,
  PageDescription,
  PageHeader,
  PageHeading,
  PageTitle,
  Section,
  SectionActions,
  SectionDescription,
  SectionHeader,
  SectionHeading,
  SectionTitle,
} from "@rome-os/ui/page";
import { Spinner } from "@rome-os/ui/spinner";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Skeleton } from "@rome-os/ui/skeleton";
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

const STATUS_VARIANT: Record<StatusTone, BadgeProps["variant"]> = {
  success: "success",
  active: "warning",
  danger: "destructive",
  info: "info",
  muted: "muted",
};

function MiniStatusBadge({ status }: { status: string }) {
  const { tone, label } = statusMeta(status);
  return (
    <Badge variant={STATUS_VARIANT[tone]} className="shrink-0 gap-1.5">
      {tone === "active" ? <Spinner size="xs" /> : null}
      {label}
    </Badge>
  );
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }) {
  const meta = TYPE_META[item.type] ?? { Icon: Bot, dot: "text-muted-foreground" };
  const surfaceLabel = item.surface === "pr" ? "PR" : "Issue";
  return (
    <ListRow asChild interactive size="md">
      <button onClick={() => onOpen(item)} type="button">
      {/* Actor avatar with a type-icon badge overlaid at the bottom-right. */}
      <div className="relative shrink-0">
        <GithubAvatar login={item.actor} size={40} rounded="rounded-full" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-background shadow-sm">
          <meta.Icon className={`h-3 w-3 ${meta.dot}`} />
        </span>
      </div>

      {/* Two rows: (surface #num · title) then (repo · time). */}
      <ListRowContent>
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
      </ListRowContent>

      <div className="flex shrink-0 items-center gap-2">
        {item.hasSession && <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has agent session" />}
        <MiniStatusBadge status={item.status} />
      </div>
      </button>
    </ListRow>
  );
}

/** Placeholder repo card matching RepoCard's footprint (avatar, name, badge, sparkline). */
function RepoCardSkeleton() {
  return (
    <Card className="flex flex-col">
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
    </Card>
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
      <PageHeader align="start">
        <PageHeading>
          <div className="flex min-w-0 items-center gap-3">
            <CodeReviewAppIcon />
            <div className="min-w-0">
              <PageTitle>Code Review</PageTitle>
              {dashboard ? (
                <PageDescription>
                  {dashboard.stats.totalRepos} repo{dashboard.stats.totalRepos !== 1 ? "s" : ""} · {dashboard.stats.totalPRReviews} review{dashboard.stats.totalPRReviews !== 1 ? "s" : ""}
                </PageDescription>
              ) : showSkeleton ? (
                <Skeleton className="mt-1.5 h-4 w-36" />
              ) : null}
            </div>
          </div>
        </PageHeading>
        <PageActions>
          {ghAuth?.loggedIn && (
            <Badge asChild variant="success">
              <a
                href="/settings/integrations"
                title="Manage GitHub connection in Settings → Integrations"
                className="gap-1.5"
              >
                <Github className="h-4 w-4" />
                <CheckCircle className="h-3.5 w-3.5" />
                {ghAuth.login ? `@${ghAuth.login}` : "GitHub connected"}
              </a>
            </Badge>
          )}
          <Button onClick={onRefresh} disabled={refreshing} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button onClick={onDismissError} variant="ghost" size="xs">Dismiss</Button>
          </AlertDescription>
        </Alert>
      )}

      {ghAuth && !ghAuth.loggedIn && (
        <Alert variant="warning">
          <Github />
          <AlertTitle>GitHub is not connected</AlertTitle>
          <AlertDescription>
            <p>Code Review uses the GitHub CLI to read PRs and post reviews. Connect your GitHub account to enable reviews.</p>
            <a
              href="/settings/integrations"
              className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Connect GitHub in Settings → Integrations
            </a>
          </AlertDescription>
        </Alert>
      )}

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle className="flex items-center gap-2">
              <Github className="h-4 w-4 text-muted-foreground" />
              Repositories
              {!showSkeleton && (
                <Badge variant="muted">{repositories.length}</Badge>
              )}
            </SectionTitle>
            <SectionDescription>Repositories monitored by the review agent.</SectionDescription>
          </SectionHeading>
          <SectionActions>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShowAddRepoChange(!showAddRepo)}
              className="border-dashed"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </SectionActions>
        </SectionHeader>

        {showAddRepo && (
          <Card>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="text"
                value={repoUrl}
                onChange={(e) => onRepoUrlChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onAddRepository()}
                placeholder="https://github.com/owner/repo or owner/repo"
                autoFocus
                size="sm"
                className="flex-1"
              />
              <Button onClick={onAddRepository} disabled={addingRepo || !repoUrl.trim()} size="sm">
                {addingRepo ? <><Spinner size="sm" /> Adding...</> : "Add"}
              </Button>
              <IconButton
                label="Cancel adding repository"
                icon={<X />}
                size="sm"
                onClick={() => {
                  onShowAddRepoChange(false);
                  onRepoUrlChange("");
                }}
              />
            </CardContent>
          </Card>
        )}

        {showSkeleton ? (
          <ListGrid className="xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <RepoCardSkeleton key={i} />
              ))}
          </ListGrid>
        ) : repositories.length === 0 ? (
          <EmptyState className="min-h-32">
            <EmptyStateIcon><Github /></EmptyStateIcon>
            <EmptyStateTitle>No repositories yet</EmptyStateTitle>
            <EmptyStateDescription>Click Add to monitor a GitHub repository.</EmptyStateDescription>
          </EmptyState>
        ) : (
          <ListGrid className="xl:grid-cols-2">
              {repositories.map((r) => (
                <RepoCard
                  key={r.id}
                  repo={r}
                  settings={prSettings.find((s) => s.repo === r.name)}
                  stat={repoStats?.[r.name]}
                  onOpenSettings={onOpenTriggerSettings}
                />
              ))}
          </ListGrid>
        )}

        <Card className="overflow-hidden p-0">
          <Button
            type="button"
            variant="ghost"
            align="between"
            onClick={() => setManualOpen((v) => !v)}
            className="h-auto w-full rounded-none px-4 py-3.5 text-muted-foreground"
          >
            <Eye className="h-4 w-4 shrink-0" />
            <span className="flex-1">Run a manual review on a specific PR</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
          </Button>
          {manualOpen && (
            <CardContent className="flex flex-col gap-2 pb-4 sm:flex-row">
              <Input
                type="text"
                value={prInput}
                onChange={(e) => onPrInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onTriggerPRReview()}
                placeholder="https://github.com/owner/repo/pull/123"
                autoFocus
                className="flex-1"
              />
              <Button onClick={() => onTriggerPRReview()} disabled={triggeringReview || !prInput.trim()}>
                <Eye className="mr-1 h-4 w-4" />
                {triggeringReview ? <><Spinner size="sm" /> Starting...</> : "Review"}
              </Button>
            </CardContent>
          )}
        </Card>
      </Section>

      <Section>
        <SectionHeader>
          <SectionHeading>
            <SectionTitle className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            Activity
            {!showSkeleton && (
                <Badge variant="muted">{activityAll}</Badge>
            )}
            </SectionTitle>
            <SectionDescription>Reviews and assistant work across monitored repositories.</SectionDescription>
          </SectionHeading>
          <SectionActions>
          <FilterChipGroup
            aria-label="Filter activity"
            value={activityFilter}
            onValueChange={onActivityFilterChange}
            disabled={loadingActivity}
            options={ACTIVITY_FILTERS.map((filter) => ({
              value: filter.value,
              label: filter.label,
              count: countFor(filter.value) ?? undefined,
            }))}
          />
          </SectionActions>
        </SectionHeader>

        <Card className="overflow-hidden p-0">
          <ListCollection>
          {showSkeleton ? (
            <div className="divide-y">
              {Array.from({ length: 6 }).map((_, i) => (
                <ActivityRowSkeleton key={i} />
              ))}
            </div>
          ) : activityItems.length === 0 ? (
            <EmptyState>
              <EmptyStateIcon><ListFilter /></EmptyStateIcon>
              <EmptyStateTitle>No activity yet</EmptyStateTitle>
              <EmptyStateDescription>
                {activityFilter === "all"
                  ? "Run a manual review above, or @mention the bot on a PR or issue."
                  : "No activity of this type yet."}
              </EmptyStateDescription>
            </EmptyState>
          ) : (
            <List>
              {activityItems.map((item) => (
                <ActivityRow key={`${item.kind}:${item.id}`} item={item} onOpen={onOpenActivityItem} />
              ))}
            </List>
          )}
          </ListCollection>
          {activityTotal > ACTIVITY_PAGE_SIZE && (
            <ListFooter className="border-t px-4 py-3">
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
            </ListFooter>
          )}
        </Card>
      </Section>
    </>
  );
}
