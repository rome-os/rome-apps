import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Save } from "lucide-react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Button } from "@/components/ui/button";
import type { MemoryEditData } from "@/types";

/**
 * Per-repo project-memory editor + audit trail. Saving routes through the
 * `code-review_update_project_memory` action (via the API), never the DB
 * directly — the same single write entry the feedback agent uses — so every
 * change is captured in the memory_edits audit log (design doc §5).
 */
export function ProjectMemoryCard({
  repoName,
  initialProjectMemory,
}: {
  repoName: string;
  initialProjectMemory: string | null;
}) {
  const [value, setValue] = useState(initialProjectMemory ?? "");
  const [edits, setEdits] = useState<MemoryEditData[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEdits, setLoadingEdits] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setValue(initialProjectMemory ?? "");
  }, [initialProjectMemory, repoName]);

  const loadEdits = useCallback(async () => {
    setLoadingEdits(true);
    try {
      const res = await fetchAppApi(`project-memory?repo=${encodeURIComponent(repoName)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projectMemory: string | null; edits: MemoryEditData[] };
      setEdits(Array.isArray(data.edits) ? data.edits : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEdits(false);
    }
  }, [repoName]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetchAppApi("project-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoName, content: value.trim() ? value : null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((data.error as string) || `Failed to save (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { edits: MemoryEditData[] };
      setEdits(Array.isArray(data.edits) ? data.edits : []);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [repoName, value]);

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && edits.length === 0) void loadEdits();
  };

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`Project knowledge, e.g.\n- We intentionally use default exports in src/legacy/\n- Don't flag console.log under scripts/\n- Deploy via the release workflow, never by hand`}
        rows={5}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
      />
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save memory
        </Button>
        <Button size="sm" variant="ghost" onClick={toggleHistory}>
          <History className="h-4 w-4" />
          {showHistory ? "Hide history" : "History"}
        </Button>
        {savedAt && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>

      {showHistory && (
        <div className="mt-2 space-y-2">
          {loadingEdits ? (
            <p className="text-xs text-muted-foreground">Loading history…</p>
          ) : edits.length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {edits.map((edit) => (
                <li key={edit.id} className="rounded-md border bg-background/60 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {edit.actor === "agent" ? "🤖 Agent" : "🧑 You"}
                      <span className="ml-1 text-muted-foreground">· {edit.source}{edit.sourceRef ? ` (${edit.sourceRef})` : ""}</span>
                    </span>
                    <span className="text-muted-foreground">{new Date(edit.createdAt).toLocaleString()}</span>
                  </div>
                  {edit.summary && <p className="mt-1 text-muted-foreground">{edit.summary}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
