import { useCallback, useEffect, useState } from "react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@rome-os/ui/card";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { Spinner } from "@rome-os/ui/spinner";
import { Badge } from "@rome-os/ui/badge";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import type { TriageResultData } from "@/types";
import { LabelChips, StatusBadge } from "./shared";
import { actorLabel, relativeTime } from "@/lib/format";

export function ResultDetailPage({ resultId, onBack }: { resultId: string; onBack: () => void }) {
  const [result, setResult] = useState<TriageResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchAppApi(`triage-results/${encodeURIComponent(resultId)}`);
      if (!res.ok) throw new Error(`Failed to load result (HTTP ${res.status})`);
      const data = (await res.json()) as { result: TriageResultData };
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [resultId]);

  useEffect(() => {
    void load();
  }, [load]);

  const c = result?.classification;

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back
      </button>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : result ? (
        <div className="space-y-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  {result.repo}#{result.issueNumber}
                </span>
                <StatusBadge status={result.status} />
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">
                {result.issueTitle || `Issue #${result.issueNumber}`}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {actorLabel(result.actor)} · {relativeTime(result.createdAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-4" /> Refresh
              </Button>
              {result.issueUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={result.issueUrl} target="_blank" rel="noreferrer">
                    View issue <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          </header>

          {result.error ? (
            <Alert variant="destructive">
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Type">{c?.type ? <Badge variant="brand" shape="square" className="font-mono text-xs">{c.type}</Badge> : <Muted />}</Field>
              <Field label="Priority">{c?.priority ? <Badge variant="warning" shape="square" className="font-mono text-xs">{c.priority}</Badge> : <Muted />}</Field>
              <Field label="Areas">{c?.areas.length ? <LabelChips labels={c.areas} /> : <Muted />}</Field>
              <Field label="Flags">{c?.flags.length ? <LabelChips labels={c.flags} /> : <Muted />}</Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Applied labels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <LabelChips labels={result.appliedLabels} created={result.createdLabels} />
              {result.createdLabels.length ? (
                <p className="text-xs text-muted-foreground">
                  Created {result.createdLabels.length} new label{result.createdLabels.length === 1 ? "" : "s"} in the repo.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {result.reasoning ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reasoning</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.reasoning}</p>
              </CardContent>
            </Card>
          ) : null}

          {result.romeSession ? (
            <p className="text-xs text-muted-foreground">A classifier agent session was recorded for this triage.</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Result not found.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-wrap justify-end gap-1.5">{children}</div>
    </div>
  );
}

function Muted() {
  return <span className="text-sm text-muted-foreground">—</span>;
}
