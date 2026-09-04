import type { RomeSessionRef } from "@rome-os/app-web-sdk";

export interface RepositoryData {
  id: string;
  slug: string;
  name: string;
  addedAt: string;
}

export interface DimensionsEnabled {
  type: boolean;
  priority: boolean;
  area: boolean;
  flags: boolean;
}

/** Resolved concept -> repo label name, per concept dimension. */
export interface LabelMap {
  type?: Record<string, string>;
  priority?: Record<string, string>;
  flags?: Record<string, string>;
}

export interface GithubRoutineStatus {
  ready: boolean;
  required: string[];
  present: string[];
  enabled: string[];
  missing: string[];
  disabled: string[];
}

export interface RepoSettingsData {
  id: string;
  repo: string;
  autoTriageEnabled: boolean;
  triggerOnOpen: boolean;
  triggerOnEdit: boolean;
  applyMode: string;
  dimensionsEnabled: DimensionsEnabled;
  autoCreateLabels: boolean;
  labelMap: LabelMap | null;
  provisionedAt: string | null;
  customRules: string | null;
  githubWebhookId: string | null;
  webhookChannelUrl: string | null;
  createdAt: string;
  updatedAt: string;
  webhookConnected?: boolean;
  eventRoutinesReady?: boolean | null;
  eventRoutineStatus?: GithubRoutineStatus | null;
  triggerWiringHealthy?: boolean;
}

export interface TriageClassification {
  type: string | null;
  priority: string | null;
  areas: string[];
  flags: string[];
}

export interface TriageResultData {
  id: string;
  repo: string;
  issueNumber: number;
  issueUrl: string | null;
  issueTitle: string | null;
  actor: string;
  status: string;
  appliedLabels: string[];
  createdLabels: string[];
  reasoning: string | null;
  classification: TriageClassification | null;
  romeSession: RomeSessionRef | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DashboardData {
  repositories: RepositoryData[];
  repoSettings: RepoSettingsData[];
  recentResults: TriageResultData[];
  counts: Record<string, number>;
  stats: {
    totalRepos: number;
    totalTriaged: number;
    succeeded: number;
    failed: number;
  };
}

export interface GhAuthStatus {
  loggedIn: boolean;
  login: string | null;
}

export interface RepoSettingsPayload {
  repo: string;
  autoTriageEnabled: boolean;
  triggerOnOpen: boolean;
  triggerOnEdit: boolean;
  autoCreateLabels: boolean;
  customRules: string | null;
  dimensionsEnabled: DimensionsEnabled;
}

/** Summary of a provisioning run, returned by add-repo and the provision route. */
export interface ProvisionSummary {
  reused: string[];
  created: string[];
  labelMap: LabelMap;
}

/** Response shape of POST /repositories. */
export interface AddRepositoryResponse {
  repository: RepositoryData;
  provision: ProvisionSummary | null;
  warning: string | null;
}

/** Response shape of POST /repositories/:id/provision. */
export interface ProvisionResponse {
  repo: string;
  provision: ProvisionSummary;
  settings?: RepoSettingsData;
}
