import { ArrowLeft, Bot, CircleStop, Clock, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { navigateRome } from "@rome-os/app-web-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PRReviewData } from "@/types";
import { formatDate } from "@/lib/helpers";
import { ACTIVE_REVIEW_STATUSES, MarkdownBlock, StageTimeline, StatusBadge } from "./review-components";

export function ReviewDetailPage({
  selectedReview,
  loadingReviewDetail,
  error,
  refreshing,
  triggeringReview,
  cancellingReview,
  onBack,
  onRefresh,
  onDismissError,
  onTriggerReview,
  onCancelReview,
}: {
  selectedReview: PRReviewData | null;
  loadingReviewDetail: boolean;
  error: string | null;
  refreshing: boolean;
  triggeringReview: boolean;
  cancellingReview: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onDismissError: () => void;
  onTriggerReview: (prUrl: string) => void;
  onCancelReview: (reviewId: string) => void;
}) {
  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <MessageSquare className="h-7 w-7 text-primary" />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {selectedReview
                  ? `#${selectedReview.prNumber} ${selectedReview.prTitle}`
                  : "Review Details"}
              </h1>
              {selectedReview && (
                <p className="text-sm text-muted-foreground truncate">
                  {selectedReview.repo} · {formatDate(selectedReview.startedAt)}
                </p>
              )}
            </div>
          </div>
        </div>
        <Button
          onClick={onRefresh}
          disabled={refreshing}
          variant="outline"
          size="sm"
        >
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

      {loadingReviewDetail && !selectedReview ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading review...
          </CardContent>
        </Card>
      ) : selectedReview ? (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selectedReview.status} />
                  {selectedReview.prAuthor && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {selectedReview.prAuthor}
                    </span>
                  )}
                  {selectedReview.completedAt && (
                    <span className="text-xs text-muted-foreground">
                      completed {formatDate(selectedReview.completedAt)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={selectedReview.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View PR
                  </a>
                  {selectedReview.githubCommentUrl && (
                    <a
                      href={selectedReview.githubCommentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline"
                    >
                      <MessageSquare className="h-3 w-3" />
                      View Review
                    </a>
                  )}
                  {selectedReview.romeSession && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateRome({ path: "session", session: selectedReview.romeSession! })}
                    >
                      <Bot className="h-3.5 w-3.5 mr-1" />
                      View agent session
                    </Button>
                  )}
                  {ACTIVE_REVIEW_STATUSES.has(selectedReview.status) && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onCancelReview(selectedReview.id)}
                      disabled={cancellingReview}
                    >
                      <CircleStop className={`h-3.5 w-3.5 mr-1 ${cancellingReview ? "animate-pulse" : ""}`} />
                      {cancellingReview ? "Stopping..." : "Stop"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onTriggerReview(selectedReview.prUrl)}
                    disabled={triggeringReview}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${triggeringReview ? "animate-spin" : ""}`} />
                    Re-review
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <StageTimeline review={selectedReview} orientation="horizontal" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedReview.reviewComment ? (
                <div className="rounded-lg border bg-muted/30 p-4 max-h-[70vh] overflow-y-auto">
                  <MarkdownBlock>{selectedReview.reviewComment}</MarkdownBlock>
                </div>
              ) : ACTIVE_REVIEW_STATUSES.has(selectedReview.status) ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-40 animate-spin" />
                  <MarkdownBlock>{`Review in progress: **${selectedReview.status}**`}</MarkdownBlock>
                </div>
              ) : selectedReview.status === "completed" && selectedReview.githubCommentUrl ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <MarkdownBlock>{`Review posted to GitHub: ${selectedReview.githubCommentUrl}`}</MarkdownBlock>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                  <MarkdownBlock>No markdown details yet.</MarkdownBlock>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
