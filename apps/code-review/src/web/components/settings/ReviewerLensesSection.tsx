import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ReviewLensData } from "@/types";

export function ReviewerLensesSection({ repoName }: { repoName: string }) {
  const [lenses, setLenses] = useState<ReviewLensData[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `review-lenses?repo=${encodeURIComponent(repoName)}`;

  const load = useCallback(async () => {
    try {
      const response = await fetchAppApi(endpoint);
      if (!response.ok) throw new Error(`Could not load reviewers (HTTP ${response.status})`);
      const data = await response.json() as { lenses: ReviewLensData[] };
      setLenses(data.lenses);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden && !busy) void load(); }, 12000);
    const onFocus = () => { if (!busy) void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load, busy]);

  const mutate = async (id: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const path = `review-lenses/${encodeURIComponent(id)}?repo=${encodeURIComponent(repoName)}`;
      const response = await fetchAppApi(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Could not save reviewer (HTTP ${response.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border bg-muted/20 p-4" aria-label="Additional reviewers">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Users className="h-4 w-4" /></span>
        <div>
          <h3 className="text-sm font-semibold">Additional reviewers</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Enabled reviewers run in parallel with the main review and each post a separate GitHub review.</p>
        </div>
      </div>
      <div className="space-y-3 sm:pl-9">
        {error && <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">{error}
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
        </div>}
        {lenses === null && <p className="text-xs text-muted-foreground">{error ? "Reviewers could not be loaded." : "Loading reviewers…"}</p>}
        {lenses?.map((lens) => <div key={lens.id} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{lens.name}</p>
            <p className="text-xs text-muted-foreground">{lens.description}</p>
          </div>
          <Switch aria-label={`Enable ${lens.name}`} checked={lens.enabled} disabled={busy}
            onCheckedChange={(enabled) => void mutate(lens.id, enabled)} />
        </div>)}
      </div>
    </section>
  );
}
