import { ArrowLeft, Bot, CircleStop, Clock, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { navigateRome } from "@rome-os/app-web-sdk";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { Badge } from "@rome-os/ui/badge";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent } from "@rome-os/ui/card";
import { EmptyState, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@rome-os/ui/empty-state";
import {
  Measure,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderNav,
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
          <Section>
            <SectionHeader>
              <SectionHeading>
                <SectionTitle className="flex flex-wrap items-center gap-2">
                  Review run
                  <StatusBadge status={selectedReview.status} />
                  {selectedReview.prAuthor && (
                    <Badge variant="muted">{selectedReview.prAuthor}</Badge>
                  )}
                </SectionTitle>
                <SectionDescription>
                  {selectedReview.completedAt && (
                    <>Completed <Timestamp value={selectedReview.completedAt} format="datetime" /></>
                  )}
                </SectionDescription>
              </SectionHeading>
              <SectionActions>
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
              </SectionActions>
            </SectionHeader>
            <Card>
            <CardContent>
              <StageTimeline review={selectedReview} orientation="horizontal" />
            </CardContent>
            </Card>
          </Section>

          <Section>
            <SectionHeader>
              <SectionHeading>
                <SectionTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Details
                </SectionTitle>
                <SectionDescription>The review summary and actionable findings posted by the agent.</SectionDescription>
              </SectionHeading>
            </SectionHeader>
            <Measure className="max-w-4xl">
              {selectedReview.reviewComment ? (
                <Card>
                  <CardContent className="max-h-[70vh] overflow-y-auto">
                  <MarkdownBlock>{selectedReview.reviewComment}</MarkdownBlock>
                  </CardContent>
                </Card>
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
            </Measure>
          </Section>
        </div>
      ) : null}
    </>
  );
}
