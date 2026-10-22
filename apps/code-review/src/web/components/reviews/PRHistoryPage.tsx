import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpNarrowWide,
  Bot,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  GitCommitHorizontal,
  History,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { navigateRome } from "@rome-os/app-web-sdk";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GithubAvatar } from "@/components/home/GithubAvatar";
import { MiniStatusBadge } from "@/components/home/HomeDashboard";
import type { MentionTaskData, PRHistoryData, PRReviewData } from "@/types";
import { formatDate, formatRelative } from "@/lib/helpers";
import { ACTIVE_REVIEW_STATUSES, MarkdownBlock } from "./review-components";
import { ACTIVE_MENTION_STATUSES, INTENT_META, parseResult } from "./MentionTaskDetailPage";

type Entry =
  | { kind: "review"; at: number; run: number; review: PRReviewData }
  | { kind: "mention"; at: number; task: MentionTaskData };

type Filter = "all" | "review" | "mention";

/** Long histories render in pages so a 150-entry PR stays fast. */
const PAGE_SIZE = 20;

const entryKey = (e: Entry) => (e.kind === "review" ? `r:${e.review.id}` : `m:${e.task.id}`);

function durationLabel(start: string, end: string | null): string | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

type Verdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** The verdict the reviewer wrote ("Verdict: APPROVE", or a leading "# APPROVE" heading). */
function parseVerdict(comment: string | null): Verdict | null {
  if (!comment) return null;
  const m =
    comment.match(/Verdict:?\**\s*\**\s*(APPROVE|REQUEST[_ ]CHANGES|COMMENT)\b/i) ??
    comment.match(/^\s*#*\s*(APPROVE|REQUEST[_ ]CHANGES|COMMENT)\b/);
  return m ? (m[1].toUpperCase().replace(" ", "_") as Verdict) : null;
}

const VERDICT_META: Record<Verdict, { label: string; className: string; dot: string }> = {
  APPROVE: {
    label: "Approved",
    className: "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  REQUEST_CHANGES: {
    label: "Changes requested",
    className: "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300",
    dot: "bg-red-500",
  },
  COMMENT: {
    label: "Commented",
    className: "border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300",
    dot: "bg-amber-500",
  },
};

/** Verdict pill for a completed review; falls back to the run status otherwise. */
function ReviewOutcome({ review }: { review: PRReviewData }) {
  const verdict = review.status === "completed" ? parseVerdict(review.reviewComment) : null;
  if (!verdict) return <MiniStatusBadge status={review.status} />;
  const meta = VERDICT_META[verdict];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium ${meta.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function TimeStamp({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDate(value)} className="whitespace-nowrap">
      {formatRelative(value)}
    </time>
  );
}

function LinkChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </a>
  );
}

function ActionChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

const PREVIEW_HEIGHT_PX = 176;

/** Long markdown clipped to a preview height with a fade, expandable in place. */
function Collapsible({
  expanded,
  onToggle,
  children,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  label: string;
}) {
  // Only clip (and offer a toggle) when the content is taller than the preview.
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > PREVIEW_HEIGHT_PX + 24);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const clipped = overflows && !expanded;
  return (
    <div>
      <div className="relative overflow-hidden" style={clipped ? { maxHeight: PREVIEW_HEIGHT_PX } : undefined}>
        <div ref={ref}>{children}</div>
        {clipped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>
      {overflows && (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        {expanded ? "Show less" : label}
      </button>
      )}
    </div>
  );
}

function RailNode({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm ${tone}`}>
      {children}
    </span>
  );
}

function ReviewEntry({
  entry,
  expanded,
  onToggle,
  isLatest,
  onOpenReview,
}: {
  entry: Extract<Entry, { kind: "review" }>;
  expanded: boolean;
  onToggle: () => void;
  isLatest: boolean;
  onOpenReview: (id: string) => void;
}) {
  const r = entry.review;
  const active = ACTIVE_REVIEW_STATUSES.has(r.status);
  const took = durationLabel(r.startedAt, r.completedAt);
  return (
    <li className="relative flex gap-4">
      <RailNode tone="text-violet-600 dark:text-violet-400">
        <Eye className="h-4 w-4" />
      </RailNode>
      <Card className="min-w-0 flex-1 gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b bg-muted/30 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold">Review run {entry.run}</span>
            {isLatest && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                Latest
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              <TimeStamp value={r.startedAt} />
              {took && <> · took {took}</>}
            </span>
            {r.headSha && (
              <span
                className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                title={`Reviewed commit ${r.headSha}`}
              >
                <GitCommitHorizontal className="h-3 w-3" />
                {r.headSha.slice(0, 7)}
              </span>
            )}
          </div>
          <ReviewOutcome review={r} />
        </div>

        <div className="px-4 py-3">
          {r.reviewComment ? (
            <Collapsible expanded={expanded} onToggle={onToggle} label="Show full review">
              <MarkdownBlock className="sd-compact">{r.reviewComment}</MarkdownBlock>
            </Collapsible>
          ) : (
            <p className="py-1 text-sm text-muted-foreground">
              {active
                ? `Review in progress (${r.status})…`
                : r.status === "completed" && r.githubCommentUrl
                  ? "Posted to GitHub; no copy was stored here."
                  : "No review text was recorded for this run."}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          <ActionChip onClick={() => onOpenReview(r.id)}>
            <History className="h-3.5 w-3.5" />
            Run details
          </ActionChip>
          {r.githubCommentUrl && (
            <LinkChip href={r.githubCommentUrl}>
              <MessageSquare className="h-3.5 w-3.5" />
              On GitHub
            </LinkChip>
          )}
          {r.romeSession && (
            <ActionChip onClick={() => navigateRome({ path: "session", session: r.romeSession! })}>
              <Bot className="h-3.5 w-3.5" />
              Agent session
            </ActionChip>
          )}
        </div>
      </Card>
    </li>
  );
}

function MentionEntry({
  entry,
  expanded,
  onToggle,
  onOpenTask,
}: {
  entry: Extract<Entry, { kind: "mention" }>;
  expanded: boolean;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = entry.task;
  const meta = INTENT_META[t.intent] ?? { label: t.intent, Icon: MessageSquare };
  const result = parseResult(t.resultRef);
  const active = ACTIVE_MENTION_STATUSES.has(t.status);
  return (
    <li className="relative flex gap-4">
      <div className="relative z-10 shrink-0">
        <GithubAvatar login={t.actorLogin} size={36} rounded="rounded-full" className="ring-4 ring-background" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-background shadow-sm">
          <meta.Icon className="h-3 w-3 text-sky-600 dark:text-sky-400" />
        </span>
      </div>
      <Card className="min-w-0 flex-1 gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b bg-muted/30 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold">{t.actorLogin ? `@${t.actorLogin}` : "Someone"}</span>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              {meta.label}
            </span>
            <span className="text-xs text-muted-foreground">
              <TimeStamp value={t.createdAt} />
            </span>
          </div>
          <MiniStatusBadge status={t.status} />
        </div>

        <div className="space-y-3 px-4 py-3">
          {t.commentBody && (
            <blockquote className="border-l-2 border-muted-foreground/25 pl-3 text-muted-foreground">
              <Collapsible expanded={expanded} onToggle={onToggle} label="Show full comment">
                <MarkdownBlock className="sd-compact">{t.commentBody}</MarkdownBlock>
              </Collapsible>
            </blockquote>
          )}
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              {result.error ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {result.error}
                </p>
              ) : result.body ? (
                <Collapsible expanded={expanded} onToggle={onToggle} label="Show full reply">
                  <MarkdownBlock className="sd-compact">{result.body}</MarkdownBlock>
                </Collapsible>
              ) : (
                <p className="pt-0.5 text-sm text-muted-foreground">
                  {active ? "Working on it…" : result.url ? "Replied on GitHub." : "No reply was recorded."}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          <ActionChip onClick={() => onOpenTask(t.id)}>
            <History className="h-3.5 w-3.5" />
            Task details
          </ActionChip>
          {result.url && (
            <LinkChip href={result.url}>
              <MessageSquare className="h-3.5 w-3.5" />
              On GitHub
            </LinkChip>
          )}
          {t.romeSession && (
            <ActionChip onClick={() => navigateRome({ path: "session", session: t.romeSession! })}>
              <Bot className="h-3.5 w-3.5" />
              Agent session
            </ActionChip>
          )}
        </div>
      </Card>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <ol className="space-y-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex gap-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 rounded-xl border p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PRHistoryPage({
  repo,
  prNumber,
  history,
  loading,
  error,
  triggeringReview,
  onBack,
  onRefresh,
  onDismissError,
  onTriggerReview,
  onOpenReview,
  onOpenTask,
}: {
  repo: string;
  prNumber: number;
  history: PRHistoryData | null;
  loading: boolean;
  error: string | null;
  triggeringReview: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onDismissError: () => void;
  onTriggerReview: (prUrl: string) => void;
  onOpenReview: (id: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [filter, newestFirst, repo, prNumber]);

  const entries = useMemo<Entry[]>(() => {
    if (!history) return [];
    const reviews: Entry[] = history.reviews.map((review, i) => ({
      kind: "review",
      at: new Date(review.startedAt).getTime(),
      run: i + 1,
      review,
    }));
    const tasks: Entry[] = history.tasks.map((task) => ({
      kind: "mention",
      at: new Date(task.createdAt).getTime(),
      task,
    }));
    return [...reviews, ...tasks].sort((a, b) => a.at - b.at);
  }, [history]);

  const latestReviewId = history?.reviews[history.reviews.length - 1]?.id ?? null;

  // Open the latest review by default; everything older starts as a preview.
  useEffect(() => {
    setExpanded(latestReviewId ? new Set([`r:${latestReviewId}`]) : new Set());
  }, [latestReviewId]);

  const visible = useMemo(() => {
    const filtered = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
    return newestFirst ? [...filtered].reverse() : filtered;
  }, [entries, filter, newestFirst]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allExpanded = visible.length > 0 && visible.every((e) => expanded.has(entryKey(e)));
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(visible.map(entryKey)));

  const reviewCount = history?.reviews.length ?? 0;
  const taskCount = history?.tasks.length ?? 0;
  const latestReview = history?.reviews[reviewCount - 1] ?? null;
  const lastActivity = entries.length ? new Date(entries[entries.length - 1].at).toISOString() : null;
  const prUrl = history?.url ?? `https://github.com/${repo}/pull/${prNumber}`;
  const reviewActive = latestReview ? ACTIVE_REVIEW_STATUSES.has(latestReview.status) : false;

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: entries.length },
    { value: "review", label: "Reviews", count: reviewCount },
    { value: "mention", label: "Comments", count: taskCount },
  ];

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back
      </Button>

      {/* ---------- PR header ---------- */}
      <Card className="mb-6 gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-3">
            <GithubAvatar login={history?.author ?? repo.split("/")[0]} size={44} rounded="rounded-xl" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                PR history
              </div>
              <h1 className="mt-1 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                {history?.title ?? (loading ? <Skeleton className="h-7 w-72" /> : `Pull request #${prNumber}`)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{repo}</span> #{prNumber}
                {history?.author && <> · opened by @{history.author}</>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={prUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                GitHub
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} aria-label="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => onTriggerReview(prUrl)} disabled={triggeringReview || reviewActive}>
              <Eye className="mr-1 h-3.5 w-3.5" />
              {triggeringReview ? "Starting…" : reviewActive ? "Reviewing…" : "Re-review"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t bg-muted/20 px-5 py-4 sm:grid-cols-4 sm:px-6">
          <Stat label="Review runs" value={reviewCount} />
          <Stat label="Bot conversations" value={taskCount} />
          <Stat label="Latest review" value={latestReview ? <ReviewOutcome review={latestReview} /> : "—"} />
          <Stat label="Last activity" value={lastActivity ? <TimeStamp value={lastActivity} /> : "—"} />
        </div>
      </Card>

      {error && (
        <div className="mb-5 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button onClick={onDismissError} className="ml-3 shrink-0 text-xs underline">
            dismiss
          </button>
        </div>
      )}

      {/* ---------- Toolbar ---------- */}
      {entries.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1" role="tablist">
            {filters.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.value)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                  <span className="text-muted-foreground/80">{f.count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            <ActionChip onClick={() => setNewestFirst((v) => !v)}>
              {newestFirst ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
              {newestFirst ? "Newest first" : "Oldest first"}
            </ActionChip>
            <ActionChip onClick={toggleAll}>
              {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
              {allExpanded ? "Collapse all" : "Expand all"}
            </ActionChip>
          </div>
        </div>
      )}

      {/* ---------- Timeline ---------- */}
      {loading && !history ? (
        <HistorySkeleton />
      ) : entries.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <History className="h-9 w-9 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">No history for this PR yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Reviews and bot conversations on {repo}#{prNumber} will appear here. Start one with Re-review.
          </p>
        </Card>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing of this type on this PR.</p>
      ) : (
        <ol className="relative space-y-5 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-border">
          {visible.slice(0, shown).map((entry) =>
            entry.kind === "review" ? (
              <ReviewEntry
                key={entryKey(entry)}
                entry={entry}
                isLatest={entry.review.id === latestReviewId}
                expanded={expanded.has(entryKey(entry))}
                onToggle={() => toggle(entryKey(entry))}
                onOpenReview={onOpenReview}
              />
            ) : (
              <MentionEntry
                key={entryKey(entry)}
                entry={entry}
                expanded={expanded.has(entryKey(entry))}
                onToggle={() => toggle(entryKey(entry))}
                onOpenTask={onOpenTask}
              />
            ),
          )}
        </ol>
      )}
      {visible.length > shown && (
        <div className="mt-6 flex flex-col items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, visible.length - shown)} more
          </Button>
          <span className="text-xs text-muted-foreground">
            Showing {shown} of {visible.length}
          </span>
        </div>
      )}
    </>
  );
}
