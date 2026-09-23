import { ArrowLeft, Bot, CircleStop, Clock, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { navigateRome } from "@rome-os/app-web-sdk";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { Badge } from "@rome-os/ui/badge";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@rome-os/ui/card";
import { EmptyState, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@rome-os/ui/empty-state";
import { PageActions, PageDescription, PageHeader, PageHeaderNav, PageHeading, PageTitle } from "@rome-os/ui/page";
import { Spinner } from "@rome-os/ui/spinner";
import { Timestamp } from "@rome-os/ui/timestamp";
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
      <PageHeader>
        <PageHeaderNav>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </PageHeaderNav>
        <PageHeading>
          <div className="flex items-center gap-3">
            <MessageSquare className="h-7 w-7 text-primary" />
            <div className="min-w-0">
              <PageTitle className="truncate">
                {selectedReview
                  ? `#${selectedReview.prNumber} ${selectedReview.prTitle}`
                  : "Review Details"}
              </PageTitle>
              {selectedReview && (
                <PageDescription className="truncate">
                  {selectedReview.repo} · {formatDate(selectedReview.startedAt)}
                </PageDescription>
              )}
            </div>
          </div>
        </PageHeading>
        <PageActions>
        <Button
          onClick={onRefresh}
          disabled={refreshing}
          variant="outline"
          size="sm"
        >
          {refreshing ? <Spinner size="sm" label="Refreshing review" /> : <RefreshCw />}
          Refresh
        </Button>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button onClick={onDismissError} variant="ghost" size="xs">Dismiss</Button>
          </AlertDescription>
        </Alert>
      )}

      {loadingReviewDetail && !selectedReview ? (
        <EmptyState>
          <EmptyStateIcon><Spinner label="Loading review" /></EmptyStateIcon>
          <EmptyStateTitle>Loading review</EmptyStateTitle>
        </EmptyState>
      ) : selectedReview ? (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selectedReview.status} />
                  {selectedReview.prAuthor && (
                    <Badge variant="muted">{selectedReview.prAuthor}</Badge>
                  )}
                  {selectedReview.completedAt && (
                    <span className="text-xs text-muted-foreground">completed <Timestamp value={selectedReview.completedAt} format="datetime" /></span>
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
                    {triggeringReview ? <Spinner size="sm" label="Starting review" /> : <RefreshCw />}
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
                <EmptyState>
                  <EmptyStateIcon><Spinner label="Review in progress" /></EmptyStateIcon>
                  <EmptyStateTitle>Review in progress</EmptyStateTitle>
                  <EmptyStateDescription>{selectedReview.status}</EmptyStateDescription>
                </EmptyState>
              ) : selectedReview.status === "completed" && selectedReview.githubCommentUrl ? (
                <EmptyState>
                  <EmptyStateIcon><MessageSquare /></EmptyStateIcon>
                  <EmptyStateTitle>Review posted to GitHub</EmptyStateTitle>
                  <EmptyStateDescription>{selectedReview.githubCommentUrl}</EmptyStateDescription>
                </EmptyState>
              ) : (
                <EmptyState>
                  <EmptyStateIcon><Clock /></EmptyStateIcon>
                  <EmptyStateTitle>No details yet</EmptyStateTitle>
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
