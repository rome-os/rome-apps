import type { RomeSessionRef } from "@rome-os/app-web-sdk";

export interface RepositoryData {
  id: string;
  url: string;
  name: string;
  addedAt: string;
}

export interface PRReviewData {
  id: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prAuthor: string | null;
  status: string;
  stageHistory: string | null;
  reviewComment: string | null;
  githubCommentUrl: string | null;
  /** Opaque durable Rome session of the summoned review agent, when available. */
  romeSession: RomeSessionRef | null;
  startedAt: string;
  completedAt: string | null;
}

export interface GithubRoutineStatus {
  ready: boolean;
  required: string[];
  present: string[];
  enabled: string[];
  missing: string[];
  disabled: string[];
}

export interface PRReviewSettingsData {
  id: string;
  repo: string;
  autoReviewEnabled: boolean;
  triggerOnCreate: boolean;
  triggerOnRequest: boolean;
  triggerOnReviewRequest: boolean;
  triggerOnMention: boolean;
  triggerOnPush: boolean;
  triggerAccessMode: TriggerAccessMode;
  triggerAllowlist: string[];
  manualTriggerAllowlist: string[];
  triggerBlocklist: string[];
  mentionTriggerPhrase: string;
  summaryTriggerPhrase: string;
  customRules: string | null;
  projectMemory: string | null;
  webhookChannelUrl: string | null;
  githubWebhookId: string | null;
  guardianGithubLogin?: string | null;
  /** GitHub hook exists for this repo; this is not enough for auto-review health. */
  webhookConnected?: boolean;
  /** Shared event-bus routines are present and enabled; null means the check failed. */
  eventRoutinesReady?: boolean | null;
  eventRoutineStatus?: GithubRoutineStatus | null;
  /** True when webhook + event routines are ready for any enabled webhook-driven trigger. */
  triggerWiringHealthy?: boolean;
  /** True only when both the GitHub hook and event-bus routines are ready. */
  autoReviewHealthy?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TriggerAccessMode = "allowlist" | "blocklist";

export interface MemoryEditData {
  id: string;
  repo: string;
  taskId: string | null;
  source: string;
  sourceRef: string | null;
  actor: string;
  before: string | null;
  after: string | null;
  summary: string | null;
  createdAt: string;
}

export interface MentionTaskData {
  id: string;
  repo: string;
  surface: "pr" | "issue";
  number: number;
  headSha: string | null;
  triggerCommentId: number | null;
  intent: string;
  commentBody: string | null;
  status: string;
  stageHistory: string | null;
  resultRef: string | null;
  romeSession: RomeSessionRef | null;
  actorLogin: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** A normalized item in the unified activity feed (review or mention task). */
export interface ActivityItem {
  kind: "review" | "mention";
  type: string;
  tag: string;
  id: string;
  repo: string;
  surface: "pr" | "issue";
  number: number;
  title: string;
  intent: string | null;
  status: string;
  actor: string | null;
  url: string;
  resultUrl: string | null;
  hasSession: boolean;
  createdAt: string;
  completedAt: string | null;
}

/** Per-filter tallies for the activity tabs (plus the "all" total). */
export interface ActivityCounts {
  all: number;
  review: number;
  question: number;
  memory: number;
  "code-task": number;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  counts?: ActivityCounts;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Per-repo dashboard aggregate for the repo cards (count + last-activity + sparkline). */
export interface RepoStat {
  reviewCount: number;
  lastActivityAt: string | null;
  /** Daily review counts, oldest→newest, for the sparkline. */
  trend: number[];
}

export interface DashboardData {
  repositories: RepositoryData[];
  recentPRReviews: PRReviewData[];
  prReviewSettings: PRReviewSettingsData[];
  recentMentionTasks?: MentionTaskData[];
  /** Keyed by repo full name (owner/repo). */
  repoStats?: Record<string, RepoStat>;
  activityCounts?: ActivityCounts;
  stats: {
    totalRepos: number;
    totalPRReviews: number;
  };
}

export interface PRReviewsPage {
  reviews: PRReviewData[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface GhAuthStatus {
  loggedIn: boolean;
  login: string | null;
}

export interface GithubUserProfile {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
}

export interface TriggerSettingsPayload {
  autoReview: boolean;
  triggerOnCreate: boolean;
  manualTriggerEnabled: boolean;
  triggerOnReviewRequest: boolean;
  triggerOnMention: boolean;
  triggerOnPush: boolean;
  customRules: string;
  triggerAccessMode: TriggerAccessMode;
  triggerAllowlist: string[];
  triggerBlocklist: string[];
  mentionTriggerPhrase: string;
  summaryTriggerPhrase: string;
}
