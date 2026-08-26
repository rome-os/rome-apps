import type { ReactNode } from "react";
import { Ban, CheckCircle, Clock, XCircle } from "lucide-react";
import { Streamdown } from "streamdown";
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
  const styles: Record<string, string> = {
    completed:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    queued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    fetching_pr_info:
      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    cloning: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    reviewing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    posting: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    pending:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    skipped: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    open: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    done: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  };
  const icons: Record<string, ReactNode> = {
    completed: <CheckCircle className="inline w-3 h-3 mr-1" />,
    running: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    queued: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    fetching_pr_info: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    cloning: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    reviewing: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    posting: <Clock className="inline w-3 h-3 mr-1 animate-spin" />,
    pending: <Clock className="inline w-3 h-3 mr-1" />,
    failed: <XCircle className="inline w-3 h-3 mr-1" />,
    cancelled: <Ban className="inline w-3 h-3 mr-1" />,
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.done}`}
    >
      {icons[status] || null}
      {status}
    </span>
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
    <Streamdown
      mode="static"
      // Disable Streamdown's "Open external link?" confirmation modal — links
      // (GitHub PRs/comments) should open directly in a new tab.
      linkSafety={{ enabled: false }}
      className={`sd-markdown text-sm leading-7 ${className}`}
    >
      {children}
    </Streamdown>
  );
}
