import type { ReactNode } from "react";
import { Ban, CheckCircle, Clock, XCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@rome-os/ui/badge";
import { Markdown } from "@rome-os/ui/markdown";
import { Spinner } from "@rome-os/ui/spinner";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import type { PRReviewData } from "@/types";

export const ACTIVE_REVIEW_STATUSES = new Set([
  "queued",
  "fetching_pr_info",
  "pending",
  "cloning",
  "reviewing",
  "posting",
  "running",
]);

export function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, BadgeProps["variant"]> = {
    completed: "success",
    running: "info",
    queued: "info",
    fetching_pr_info: "info",
    cloning: "info",
    reviewing: "info",
    posting: "info",
    pending: "warning",
    failed: "destructive",
    cancelled: "muted",
    skipped: "muted",
    open: "warning",
    done: "muted",
  };
  const icons: Record<string, ReactNode> = {
    completed: <CheckCircle className="inline w-3 h-3 mr-1" />,
    running: <Spinner size="xs" />,
    queued: <Spinner size="xs" />,
    fetching_pr_info: <Spinner size="xs" />,
    cloning: <Spinner size="xs" />,
    reviewing: <Spinner size="xs" />,
    posting: <Spinner size="xs" />,
    pending: <Clock className="inline w-3 h-3 mr-1" />,
    failed: <XCircle className="inline w-3 h-3 mr-1" />,
    cancelled: <Ban className="inline w-3 h-3 mr-1" />,
  };
  return (
    <Badge variant={variants[status] ?? "muted"} className="gap-1">
      {icons[status] || null}
      {status}
    </Badge>
  );
}

interface StageHistoryEntry {
  stage: string;
  time: number;
}

function parseStageHistory(history: string | null): StageHistoryEntry[] {
  if (!history) return [];
  try {
    const parsed = JSON.parse(history);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StageHistoryEntry =>
        typeof entry?.stage === "string" && typeof entry?.time === "number",
    );
  } catch {
    return [];
  }
}

function formatStageDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function StageTimeline({
  review,
  orientation = "vertical",
}: {
  review: PRReviewData;
  orientation?: "vertical" | "horizontal";
}) {
  const history = parseStageHistory(review.stageHistory);
  if (history.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Review timeline
      </p>
      <Timeline size="sm" iconsize="sm" orientation={orientation}>
        {history.map((entry, index) => {
          const next = history[index + 1];
          const isLatest = index === history.length - 1;
          const duration = next
            ? formatStageDuration(next.time - entry.time)
            : ACTIVE_REVIEW_STATUSES.has(entry.stage)
              ? `${formatStageDuration(Date.now() - entry.time)} so far`
              : null;
          const timelineStatus =
            entry.stage === "failed"
              ? "error"
              : entry.stage === "cancelled"
                ? "pending"
              : isLatest && ACTIVE_REVIEW_STATUSES.has(entry.stage)
                ? "in-progress"
                : entry.stage === "skipped"
                  ? "pending"
                  : "completed";
          return (
            <TimelineItem
              key={`${entry.stage}-${entry.time}-${index}`}
              date={new Date(entry.time).toLocaleTimeString()}
              title={entry.stage}
              description={duration || new Date(entry.time).toLocaleString()}
              status={timelineStatus}
            />
          );
        })}
      </Timeline>
    </div>
  );
}

/**
 * Timeline for any stage-history JSON (reviews or new-flow mention tasks).
 * `activeStatuses` lists the stages considered in-progress (spinner + "so far").
 */
export function GenericStageTimeline({
  stageHistory,
  activeStatuses,
  title = "Timeline",
  orientation = "horizontal",
}: {
  stageHistory: string | null;
  activeStatuses: Set<string>;
  title?: string;
  orientation?: "vertical" | "horizontal";
}) {
  const history = parseStageHistory(stageHistory);
  if (history.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{title}</p>
      <Timeline size="sm" iconsize="sm" orientation={orientation}>
        {history.map((entry, index) => {
          const next = history[index + 1];
          const isLatest = index === history.length - 1;
          const duration = next
            ? formatStageDuration(next.time - entry.time)
            : activeStatuses.has(entry.stage)
              ? `${formatStageDuration(Date.now() - entry.time)} so far`
              : null;
          const timelineStatus =
            entry.stage === "failed"
              ? "error"
              : entry.stage === "cancelled"
                ? "pending"
                : isLatest && activeStatuses.has(entry.stage)
                  ? "in-progress"
                  : entry.stage === "skipped"
                    ? "pending"
                    : "completed";
          return (
            <TimelineItem
              key={`${entry.stage}-${entry.time}-${index}`}
              date={new Date(entry.time).toLocaleTimeString()}
              title={entry.stage}
              description={duration || new Date(entry.time).toLocaleString()}
              status={timelineStatus}
            />
          );
        })}
      </Timeline>
    </div>
  );
}

export function MarkdownBlock({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <Markdown compact className={className}>
      {children}
    </Markdown>
  );
}
