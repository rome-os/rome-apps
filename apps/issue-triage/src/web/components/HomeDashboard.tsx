import { useMemo, useState } from "react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@rome-os/ui/card";
import { Badge } from "@rome-os/ui/badge";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { EmptyState, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@rome-os/ui/empty-state";
import { Skeleton } from "@rome-os/ui/skeleton";
import { Plus, RefreshCw, Settings2, Tag, CheckCircle2, XCircle, Radio, ExternalLink } from "lucide-react";
import type { AddRepositoryResponse, DashboardData, GhAuthStatus, ProvisionSummary, RepoSettingsData, TriageResultData } from "@/types";
import { actorLabel, isGithubUrl, relativeTime } from "@/lib/format";
import { GhAuthBanner, LabelChips, StatusBadge } from "./shared";

interface Props {
  dashboard: DashboardData | null;
  ghAuth: GhAuthStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onDismissError: () => void;
  onAddRepository: (input: string) => Promise<AddRepositoryResponse>;
  onOpenSettings: (slug: string) => void;
  onOpenResult: (id: string) => void;
  onTriageSingle: (body: { issueUrl?: string; repo?: string; issueNumber?: number }) => Promise<{ resultId: string }>;
}

export function HomeDashboard(props: Props) {
  const { dashboard, ghAuth, loading, error, onRefresh } = props;
  const [repoInput, setRepoInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [provisionSummary, setProvisionSummary] = useState<{ slug: string; provision: ProvisionSummary | null; warning: string | null } | null>(null);
  const [issueInput, setIssueInput] = useState("");
  const [triaging, setTriaging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const settingsByRepo = useMemo(() => {
    const map = new Map<string, RepoSettingsData>();
    for (const s of dashboard?.repoSettings ?? []) map.set(s.repo, s);
    return map;
  }, [dashboard]);

  async function handleAdd() {
    const trimmed = repoInput.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    setProvisionSummary(null);
    try {
      const res = await props.onAddRepository(trimmed);
      setRepoInput("");
      setProvisionSummary({ slug: res.repository?.slug ?? trimmed, provision: res.provision, warning: res.warning });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleTriage() {
    const trimmed = issueInput.trim();
    if (!trimmed) return;
    setTriaging(true);
    try {
      if (isGithubUrl(trimmed)) {
        await props.onTriageSingle({ issueUrl: trimmed });
      } else {
        setAddError("Enter a full issue URL, or triage from a repo's settings page.");
        return;
      }
      setIssueInput("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriaging(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const repositories = dashboard?.repositories ?? [];
  const results = dashboard?.recentResults ?? [];
  const stats = dashboard?.stats;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Tag className="text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Issue Triage</h1>
            <p className="text-sm text-muted-foreground">
              AI auto-labeling for GitHub issues
              {stats ? (
                <>
                  {" · "}
                  {stats.totalRepos} {stats.totalRepos === 1 ? "repo" : "repos"} · {stats.totalTriaged} triaged
                </>
              ) : null}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </header>

      <GhAuthBanner ghAuth={ghAuth} />

      {error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={props.onDismissError}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {stats ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={<Radio className="size-4" />} label="Repos" value={stats.totalRepos} />
          <StatTile icon={<Tag className="size-4" />} label="Triaged" value={stats.totalTriaged} />
          <StatTile icon={<CheckCircle2 className="size-4 text-emerald-500" />} label="Succeeded" value={stats.succeeded} />
          <StatTile icon={<XCircle className="size-4 text-destructive" />} label="Failed" value={stats.failed} />
        </div>
      ) : null}

      {/* Add repo + manual triage */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a repository</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/name or https://github.com/owner/name"
              onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            />
            <Button onClick={() => void handleAdd()} disabled={adding || !repoInput.trim()}>
              <Plus /> {adding ? "Adding…" : "Add"}
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={issueInput}
              onChange={(e) => setIssueInput(e.target.value)}
              placeholder="Triage one issue by URL: https://github.com/owner/name/issues/123"
              onKeyDown={(e) => e.key === "Enter" && void handleTriage()}
            />
            <Button variant="outline" onClick={() => void handleTriage()} disabled={triaging || !issueInput.trim()}>
              {triaging ? "Queuing…" : "Triage issue"}
            </Button>
          </div>
          {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          {provisionSummary ? <ProvisionNotice summary={provisionSummary} /> : null}
        </CardContent>
      </Card>

      {/* Repositories */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Repositories</h2>
        {loading && !dashboard ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : repositories.length === 0 ? (
          <EmptyState>
            <EmptyStateIcon>
              <Tag />
            </EmptyStateIcon>
            <EmptyStateTitle>No repositories yet</EmptyStateTitle>
            <EmptyStateDescription>Add a repository above to start triaging its issues.</EmptyStateDescription>
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {repositories.map((repo) => (
              <RepoCard
                key={repo.id}
                slug={repo.slug}
                settings={settingsByRepo.get(repo.slug)}
                onOpenSettings={() => props.onOpenSettings(repo.slug)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent triage activity</h2>
        {loading && !dashboard ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : results.length === 0 ? (
          <EmptyState>
            <EmptyStateIcon>
              <Tag />
            </EmptyStateIcon>
            <EmptyStateTitle>Nothing triaged yet</EmptyStateTitle>
            <EmptyStateDescription>
              Enable auto-triage on a repository, or triage an issue by URL to see results here.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <ActivityRow key={r.id} result={r} onOpen={() => props.onOpenResult(r.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProvisionNotice({
  summary,
}: {
  summary: { slug: string; provision: ProvisionSummary | null; warning: string | null };
}) {
  const { slug, provision, warning } = summary;
  if (warning) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          Added <span className="font-mono">{slug}</span>. {warning}
        </AlertDescription>
      </Alert>
    );
  }
  if (!provision) {
    return (
      <Alert variant="success">
        <AlertDescription>
          Added <span className="font-mono">{slug}</span>.
        </AlertDescription>
      </Alert>
    );
  }
  const { reused, created } = provision;
  const segments: string[] = [];
  if (reused.length) segments.push(`Reused: ${reused.join(", ")}`);
  if (created.length) segments.push(`Created: ${created.join(", ")}`);
  return (
    <Alert variant="success">
      <AlertDescription>
        Added <span className="font-mono">{slug}</span> and provisioned its triage labels.
        {segments.length ? ` ${segments.join(" · ")}` : " No labels needed provisioning."}
      </AlertDescription>
    </Alert>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function RepoCard({
  slug,
  settings,
  onOpenSettings,
}: {
  slug: string;
  settings: RepoSettingsData | undefined;
  onOpenSettings: () => void;
}) {
  const auto = settings?.autoTriageEnabled ?? false;
  const healthy = settings?.triggerWiringHealthy ?? false;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-mono">{slug}</CardTitle>
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Settings">
            <Settings2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {auto ? (
            <Badge variant={healthy ? "success" : "warning"} shape="pill">
              {healthy ? "Auto-triage on" : "Auto-triage: check wiring"}
            </Badge>
          ) : (
            <Badge variant="muted" shape="pill">
              Auto-triage off
            </Badge>
          )}
          {settings?.webhookConnected ? (
            <Badge variant="outline" shape="pill">
              Webhook connected
            </Badge>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={onOpenSettings} className="w-full">
          Configure & triage
        </Button>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ result, onOpen }: { result: TriageResultData; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-muted-foreground">
              {result.repo}#{result.issueNumber}
            </span>
            <StatusBadge status={result.status} />
          </div>
          <p className="mt-1 truncate text-sm font-medium">{result.issueTitle || `Issue #${result.issueNumber}`}</p>
          {result.appliedLabels.length ? (
            <div className="mt-2">
              <LabelChips labels={result.appliedLabels} created={result.createdLabels} />
            </div>
          ) : result.error ? (
            <p className="mt-1 truncate text-xs text-destructive">{result.error}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <span>{actorLabel(result.actor)}</span>
          <span>{relativeTime(result.createdAt)}</span>
          {result.issueUrl ? (
            <a
              href={result.issueUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              GitHub <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
    </button>
  );
}
