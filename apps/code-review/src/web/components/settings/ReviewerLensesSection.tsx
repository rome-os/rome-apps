import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Swords, Trash2, Users } from "lucide-react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ReviewLensData } from "@/types";

const ADVERSARIAL_INSTRUCTIONS = `Take an adversarial stance: try to break this change rather than confirm it works. Hunt for correctness bugs, edge cases, races, security vulnerabilities, data loss, and failure modes. Challenge wrong assumptions and whether the approach solves the right problem.
Verify every claim by reading the relevant implementation, callers, and tests. Trace realistic inputs and failure paths; look for missing invariants and interactions with existing behavior.
Report only concrete, evidenced problems introduced by this change, with a specific scenario, impact, and code location. Do not invent concerns, repeat disproven findings, or report style nits. If you cannot substantiate a problem, omit it. Keep the required review output schema.`;

type LensPatch = Partial<Pick<ReviewLensData, "name" | "instructions" | "enabled">>;
const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function LensEditor({ lens, busy, onSave, onDelete, onCancel }: {
  lens?: ReviewLensData;
  busy: boolean;
  onSave: (patch: LensPatch) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(lens?.name ?? "");
  const [instructions, setInstructions] = useState(lens?.instructions ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setName(lens?.name ?? ""), [lens?.name]);
  useEffect(() => setInstructions(lens?.instructions ?? ""), [lens?.instructions]);
  const dirty = name !== lens?.name || instructions !== lens?.instructions;

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="flex items-center gap-3">
        <label className="min-w-0 flex-1 space-y-1 text-xs font-medium">
          <span>Name</span>
          <input aria-label="Reviewer name" value={name} maxLength={100} disabled={busy}
            onChange={(e) => setName(e.target.value)} placeholder="e.g. Security" className={fieldClass} />
        </label>
        {lens && (
          <div className="flex items-center gap-2 pt-5">
            <span className="text-xs text-muted-foreground">{lens.enabled ? "Enabled" : "Disabled"}</span>
            <Switch aria-label={`Enable ${lens.name}`} checked={lens.enabled} disabled={busy}
              onCheckedChange={(enabled) => void onSave({ enabled })} />
          </div>
        )}
      </div>
      <label className="block space-y-1 text-xs font-medium">
        <span>Instructions</span>
        <textarea aria-label="Reviewer instructions" value={instructions} maxLength={20000} rows={5} disabled={busy}
          onChange={(e) => setInstructions(e.target.value)} placeholder="What should this reviewer focus on?"
          className={`${fieldClass} resize-y font-normal`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !name.trim() || !instructions.trim() || (!!lens && !dirty)}
          onClick={() => void onSave({ name: name.trim(), instructions: instructions.trim() })}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {lens ? "Save reviewer" : "Add reviewer"}
        </Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
        {onDelete && (confirmDelete ? (
          <>
            <span className="text-xs text-muted-foreground">Delete this reviewer? Past runs are kept.</span>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onDelete()}>Delete reviewer</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={busy}
            onClick={() => setConfirmDelete(true)} aria-label={`Delete ${lens?.name}`}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ReviewerLensesSection({ repoName }: { repoName: string }) {
  const [lenses, setLenses] = useState<ReviewLensData[] | null>(null);
  const [adding, setAdding] = useState(false);
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

  const mutate = async (method: string, patch?: LensPatch, id?: string) => {
    setBusy(true);
    setError(null);
    try {
      const path = id ? `review-lenses/${encodeURIComponent(id)}?repo=${encodeURIComponent(repoName)}` : endpoint;
      const response = await fetchAppApi(path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(patch ? { body: JSON.stringify(patch) } : {}),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Could not save reviewer (HTTP ${response.status})`);
      }
      if (method === "POST") setAdding(false);
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
        {lenses === null ? <p className="text-xs text-muted-foreground">{error ? "Reviewers could not be loaded." : "Loading reviewers…"}</p>
          : lenses.length === 0 && !adding && <p className="text-xs text-muted-foreground">Only the main reviewer runs. Add a focused reviewer or start with Adversarial.</p>}
        {lenses?.map((lens) => <LensEditor key={lens.id} lens={lens} busy={busy}
          onSave={(patch) => mutate("PATCH", patch, lens.id)} onDelete={() => mutate("DELETE", undefined, lens.id)} />)}
        {adding && <LensEditor busy={busy} onSave={(patch) => mutate("POST", patch)} onCancel={() => setAdding(false)} />}
        <div className="flex flex-wrap gap-2">
          {!adding && <Button size="sm" variant="outline" disabled={busy || lenses === null} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Add reviewer</Button>}
          <Button size="sm" variant="outline" disabled={busy || lenses === null}
            onClick={() => void mutate("POST", { name: "Adversarial", instructions: ADVERSARIAL_INSTRUCTIONS })}>
            <Swords className="h-3.5 w-3.5" />Adversarial
          </Button>
        </div>
      </div>
    </section>
  );
}
