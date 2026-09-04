import { useCallback, useEffect, useState } from "react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { Textarea } from "@rome-os/ui/textarea";
import { Switch } from "@rome-os/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rome-os/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Badge } from "@rome-os/ui/badge";
import { Spinner } from "@rome-os/ui/spinner";
import { Separator } from "@rome-os/ui/separator";
import { ArrowLeft, Wrench, Trash2, PlayCircle, Layers, Tag, RefreshCw } from "lucide-react";
import type { DimensionsEnabled, GhAuthStatus, LabelMap, ProvisionResponse, RepoSettingsData, TriageResultData } from "@/types";
import { GhAuthBanner, LabelChip, LabelChips, StatusBadge } from "./shared";
import { actorLabel, relativeTime } from "@/lib/format";

interface Props {
  repoSlug: string;
  ghAuth: GhAuthStatus | null;
  onBack: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<RepoSettingsData | null>;
  onRepair: () => Promise<void>;
  onRemoveRepository: (id: string) => Promise<void>;
  onTriageSingle: (body: { repo?: string; issueNumber?: number; issueUrl?: string }) => Promise<{ resultId: string }>;
  onTriageBatch: (repoSlug: string) => Promise<{ queued: number; total: number }>;
  onOpenResult: (id: string) => void;
}

const DEFAULT_DIMS: DimensionsEnabled = { type: true, priority: true, area: true, flags: true };

export function SettingsPage(props: Props) {
  const { repoSlug } = props;
  const [settings, setSettings] = useState<RepoSettingsData | null>(null);
  const [results, setResults] = useState<TriageResultData[]>([]);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editable form state
  const [autoTriage, setAutoTriage] = useState(false);
  const [triggerOnOpen, setTriggerOnOpen] = useState(true);
  const [triggerOnEdit, setTriggerOnEdit] = useState(true);
  const [autoCreateLabels, setAutoCreateLabels] = useState(true);
  const [dims, setDims] = useState<DimensionsEnabled>(DEFAULT_DIMS);
  const [customRules, setCustomRules] = useState("");

  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [batching, setBatching] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [issueInput, setIssueInput] = useState("");
  const [triaging, setTriaging] = useState(false);

  const applyToForm = useCallback((s: RepoSettingsData | null) => {
    if (!s) return;
    setAutoTriage(s.autoTriageEnabled);
    setTriggerOnOpen(s.triggerOnOpen);
    setTriggerOnEdit(s.triggerOnEdit);
    setAutoCreateLabels(s.autoCreateLabels ?? true);
    setDims(s.dimensionsEnabled ?? DEFAULT_DIMS);
    setCustomRules(s.customRules ?? "");
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sRes, rRes, reposRes] = await Promise.all([
        fetchAppApi(`repo-settings?repo=${encodeURIComponent(repoSlug)}`),
        fetchAppApi(`triage-results?repo=${encodeURIComponent(repoSlug)}&limit=50`),
        fetchAppApi("repositories"),
      ]);
      const sData = (await sRes.json()) as { settings: RepoSettingsData | null };
      setSettings(sData.settings);
      applyToForm(sData.settings);
      const rData = (await rRes.json()) as { results: TriageResultData[] };
      setResults(rData.results ?? []);
      const reposData = (await reposRes.json()) as { repositories: { id: string; slug: string }[] };
      setRepoId(reposData.repositories.find((r) => r.slug === repoSlug)?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repoSlug, applyToForm]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await props.onSave({
        repo: repoSlug,
        autoTriageEnabled: autoTriage,
        triggerOnOpen,
        triggerOnEdit,
        autoCreateLabels,
        customRules: customRules.trim() || null,
        dimensionsEnabled: dims,
      });
      if (saved) {
        setSettings(saved);
        applyToForm(saved);
      }
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRepair() {
    setRepairing(true);
    setError(null);
    try {
      await props.onRepair();
      await load();
      setNotice("Connection repaired.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  }

  async function handleBatch() {
    setBatching(true);
    setError(null);
    setNotice(null);
    try {
      const res = await props.onTriageBatch(repoSlug);
      setNotice(`Queued ${res.queued} of ${res.total} open issue(s) for triage.`);
      setTimeout(() => void load(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBatching(false);
    }
  }

  async function handleProvision() {
    if (!repoId) return;
    setProvisioning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetchAppApi(`repositories/${repoId}/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCreateLabels }),
      });
      const data = (await res.json().catch(() => ({}))) as ProvisionResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to provision labels (HTTP ${res.status})`);
      const parts: string[] = [];
      if (data.provision?.reused?.length) parts.push(`Reused ${data.provision.reused.join(", ")}`);
      if (data.provision?.created?.length) parts.push(`Created ${data.provision.created.join(", ")}`);
      setNotice(parts.length ? parts.join(" · ") : "Labels provisioned.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProvisioning(false);
    }
  }

  async function handleTriageOne() {
    const trimmed = issueInput.trim();
    if (!trimmed) return;
    setTriaging(true);
    setError(null);
    try {
      if (trimmed.includes("github.com")) {
        await props.onTriageSingle({ issueUrl: trimmed });
      } else if (/^\d+$/.test(trimmed)) {
        await props.onTriageSingle({ repo: repoSlug, issueNumber: parseInt(trimmed, 10) });
      } else {
        setError("Enter an issue number or a full issue URL.");
        return;
      }
      setIssueInput("");
      setNotice("Triage queued.");
      setTimeout(() => void load(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriaging(false);
    }
  }

  const routine = settings?.eventRoutineStatus;

  return (
    <div>
      <button onClick={props.onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back
      </button>

      <header className="mb-6">
        <h1 className="font-mono text-xl font-semibold tracking-tight">{repoSlug}</h1>
        <p className="text-sm text-muted-foreground">Triage settings and manual controls for this repository.</p>
      </header>

      <GhAuthBanner ghAuth={props.ghAuth} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Triggers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auto-triage</CardTitle>
              <CardDescription>
                When enabled, Rome registers a GitHub webhook for this repo and triages matching issue events
                automatically. Labels are applied directly to the issue.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Enable auto-triage"
                description="Subscribe to GitHub issue events and triage automatically."
                checked={autoTriage}
                onChange={setAutoTriage}
              />
              <Separator />
              <ToggleRow
                label="Trigger on issue opened"
                checked={triggerOnOpen}
                onChange={setTriggerOnOpen}
                disabled={!autoTriage}
              />
              <ToggleRow
                label="Trigger on issue edited or reopened"
                checked={triggerOnEdit}
                onChange={setTriggerOnEdit}
                disabled={!autoTriage}
              />
            </CardContent>
          </Card>

          {/* Dimensions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Classification dimensions</CardTitle>
              <CardDescription>Choose which label dimensions the classifier fills.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow label="Type" description="One of: bug, enhancement, documentation, question." checked={dims.type} onChange={(v) => setDims({ ...dims, type: v })} />
              <ToggleRow label="Priority" description="One of: low, medium, high, critical." checked={dims.priority} onChange={(v) => setDims({ ...dims, priority: v })} />
              <ToggleRow label="Area / component" description="Only from this repo's existing labels — never created." checked={dims.area} onChange={(v) => setDims({ ...dims, area: v })} />
              <ToggleRow label="Flags" description="needs-triage, needs-info." checked={dims.flags} onChange={(v) => setDims({ ...dims, flags: v })} />
            </CardContent>
          </Card>

          {/* Labels */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="size-4" /> Labels
              </CardTitle>
              <CardDescription>
                Labels are provisioned once when a repo is added: existing labels that match a concept are reused, and any
                missing recommended labels can be created automatically. Triage never creates labels — it only applies these.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <LabelMapView labelMap={settings?.labelMap ?? null} />
              <Separator />
              <ToggleRow
                label="Auto-create missing labels on add / re-scan"
                description="When on, provisioning creates the recommended flat labels for concepts this repo doesn't already have."
                checked={autoCreateLabels}
                onChange={setAutoCreateLabels}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleProvision()} disabled={provisioning || !repoId}>
                  <RefreshCw className={provisioning ? "size-4 animate-spin" : "size-4"} />
                  {provisioning ? "Provisioning…" : "Re-scan / provision labels"}
                </Button>
                {settings?.provisionedAt ? (
                  <span className="text-xs text-muted-foreground">Last provisioned {relativeTime(settings.provisionedAt)}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not provisioned yet</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Save settings first if you changed the auto-create toggle or dimensions, then re-scan.
              </p>
            </CardContent>
          </Card>

          {/* Custom rules */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custom triage rules</CardTitle>
              <CardDescription>Extra guidance the classifier must follow for this repo (optional).</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder="e.g. Treat anything mentioning 'crash' or 'data loss' as critical priority. Label docs typos as documentation + low priority."
                rows={4}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>

          {/* Connection health */}
          {autoTriage || settings?.webhookConnected ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connection health</CardTitle>
                <CardDescription>GitHub webhook + Rome event routine wiring for auto-triage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={settings?.webhookConnected ? "success" : "muted"} shape="pill">
                    Webhook {settings?.webhookConnected ? "connected" : "not connected"}
                  </Badge>
                  <Badge variant={routine?.ready ? "success" : "warning"} shape="pill">
                    Event routine {routine?.ready ? "ready" : routine ? "needs repair" : "unknown"}
                  </Badge>
                  <Badge variant={settings?.triggerWiringHealthy ? "success" : "warning"} shape="pill">
                    {settings?.triggerWiringHealthy ? "Wiring healthy" : "Wiring incomplete"}
                  </Badge>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleRepair()} disabled={repairing}>
                  <Wrench className="size-4" /> {repairing ? "Repairing…" : "Repair connection"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Manual controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manual triage</CardTitle>
              <CardDescription>Triage one issue now, or batch-triage every open issue in this repo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={issueInput}
                  onChange={(e) => setIssueInput(e.target.value)}
                  placeholder="Issue number (e.g. 42) or full issue URL"
                  onKeyDown={(e) => e.key === "Enter" && void handleTriageOne()}
                />
                <Button variant="outline" onClick={() => void handleTriageOne()} disabled={triaging || !issueInput.trim()}>
                  <PlayCircle className="size-4" /> {triaging ? "Queuing…" : "Triage issue"}
                </Button>
              </div>
              <Button onClick={() => void handleBatch()} disabled={batching}>
                <Layers className="size-4" /> {batching ? "Queuing…" : "Batch-triage open issues"}
              </Button>
            </CardContent>
          </Card>

          {/* Recent results for this repo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent triage results</CardTitle>
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No triage results for this repo yet.</p>
              ) : (
                <div className="space-y-2">
                  {results.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => props.onOpenResult(r.id)}
                      className="w-full rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-accent/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm text-muted-foreground">#{r.issueNumber}</span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{actorLabel(r.actor)}</span>
                          <StatusBadge status={r.status} />
                          <span>{relativeTime(r.createdAt)}</span>
                        </div>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{r.issueTitle || `Issue #${r.issueNumber}`}</p>
                      {r.appliedLabels.length ? (
                        <div className="mt-2">
                          <LabelChips labels={r.appliedLabels} created={r.createdLabels} />
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-destructive">Remove repository</CardTitle>
              <CardDescription>Removes this repo from Issue Triage. Disable auto-triage first to clean up its webhook.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                size="sm"
                disabled={!repoId}
                onClick={async () => {
                  if (!repoId) return;
                  try {
                    await props.onRemoveRepository(repoId);
                    props.onBack();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                <Trash2 className="size-4" /> Remove {repoSlug}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const LABEL_MAP_DIMENSIONS: Array<{ key: keyof LabelMap; title: string }> = [
  { key: "type", title: "Type" },
  { key: "priority", title: "Priority" },
  { key: "flags", title: "Flags" },
];

function LabelMapView({ labelMap }: { labelMap: LabelMap | null }) {
  const hasAny = labelMap && LABEL_MAP_DIMENSIONS.some(({ key }) => Object.keys(labelMap[key] ?? {}).length > 0);
  if (!hasAny) {
    return (
      <p className="text-sm text-muted-foreground">
        No labels provisioned yet. Use “Re-scan / provision labels” to detect existing labels and create any missing ones.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {LABEL_MAP_DIMENSIONS.map(({ key, title }) => {
        const bucket = labelMap?.[key] ?? {};
        const entries = Object.entries(bucket);
        if (!entries.length) return null;
        return (
          <div key={key}>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
            <div className="flex flex-col gap-1.5">
              {entries.map(([concept, label]) => (
                <div key={concept} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{concept}</span>
                  <span className="text-muted-foreground">→</span>
                  <LabelChip name={label} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
