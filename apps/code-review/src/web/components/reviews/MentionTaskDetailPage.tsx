import { ArrowLeft, Bot, Brain, ExternalLink, MessageSquare, RefreshCw, Wrench } from "lucide-react";
import { navigateRome } from "@rome-os/app-web-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MentionTaskData } from "@/types";
import { formatDate } from "@/lib/helpers";
import { GenericStageTimeline, MarkdownBlock, StatusBadge } from "./review-components";

/** Mention-task stages considered in-progress (spinner + "so far"). */
const ACTIVE_MENTION_STATUSES = new Set(["queued", "running", "posting"]);

const INTENT_META: Record<string, { label: string; Icon: typeof MessageSquare }> = {
  "update-memory": { label: "Memory update", Icon: Brain },
  "code-task": { label: "Code task", Icon: Wrench },
  general: { label: "Question", Icon: MessageSquare },
};

function parseResult(resultRef: string | null): { url: string | null; error: string | null; kind: string | null; body: string | null } {
  if (!resultRef) return { url: null, error: null, kind: null, body: null };
  try {
    const r = JSON.parse(resultRef) as Record<string, unknown>;
    return {
      url: (r.prUrl as string) || (r.url as string) || (r.replyUrl as string) || null,
      error: (r.error as string) || null,
      kind: (r.kind as string) || null,
      body: (r.body as string) || null,
    };
  } catch {
    return { url: null, error: null, kind: null, body: null };
  }
}

export function MentionTaskDetailPage({
  selectedTask,
  loading,
  error,
  refreshing,
  onBack,
  onRefresh,
  onDismissError,
}: {
  selectedTask: MentionTaskData | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onDismissError: () => void;
}) {
  const meta = selectedTask ? INTENT_META[selectedTask.intent] ?? { label: selectedTask.intent, Icon: Bot } : null;
  const githubUrl = selectedTask
    ? selectedTask.surface === "pr"
      ? `https://github.com/${selectedTask.repo}/pull/${selectedTask.number}`
      : `https://github.com/${selectedTask.repo}/issues/${selectedTask.number}`
    : null;
  const result = parseResult(selectedTask?.resultRef ?? null);

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            {meta ? <meta.Icon className="h-7 w-7 text-primary" /> : <Bot className="h-7 w-7 text-primary" />}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {selectedTask ? `${meta?.label} · ${selectedTask.surface === "pr" ? "PR" : "Issue"} #${selectedTask.number}` : "Activity"}
              </h1>
              {selectedTask && (
                <p className="text-sm text-muted-foreground truncate">
                  {selectedTask.repo} · {formatDate(selectedTask.createdAt)}
                </p>
              )}
            </div>
          </div>
        </div>
        <Button onClick={onRefresh} disabled={refreshing} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mb-5 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={onDismissError} className="ml-3 underline text-xs shrink-0">
            dismiss
          </button>
        </div>
      )}

      {loading && !selectedTask ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : selectedTask ? (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                    {meta && <meta.Icon className="h-3 w-3" />}
                    {meta?.label}
                  </span>
                  <StatusBadge status={selectedTask.status} />
                  {selectedTask.actorLogin && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      by {selectedTask.actorLogin}
                    </span>
                  )}
                  {selectedTask.completedAt && (
                    <span className="text-xs text-muted-foreground">completed {formatDate(selectedTask.completedAt)}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {githubUrl && (
                    <a href={githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />
                      View {selectedTask.surface === "pr" ? "PR" : "Issue"}
                    </a>
                  )}
                  {result.url && (
                    <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline">
                      <MessageSquare className="h-3 w-3" />
                      View result
                    </a>
                  )}
                  {selectedTask.romeSession && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateRome({ path: "session", session: selectedTask.romeSession! })}
                    >
                      <Bot className="h-3.5 w-3.5 mr-1" />
                      View agent session
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <GenericStageTimeline
                stageHistory={selectedTask.stageHistory}
                activeStatuses={ACTIVE_MENTION_STATUSES}
                title="Task timeline"
                orientation="horizontal"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedTask.commentBody && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Triggering comment</p>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <MarkdownBlock>{selectedTask.commentBody}</MarkdownBlock>
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {result.kind === "code-task" ? "Reply" : "Reply posted to GitHub"}
                </p>
                {result.error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                    {result.error}
                  </div>
                ) : result.body ? (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <MarkdownBlock>{result.body}</MarkdownBlock>
                    {result.url && (
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View on GitHub
                      </a>
                    )}
                  </div>
                ) : result.url ? (
                  <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View the {result.kind || "reply"} on GitHub
                    </a>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
                    {ACTIVE_MENTION_STATUSES.has(selectedTask.status) ? "In progress…" : "No result recorded."}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
