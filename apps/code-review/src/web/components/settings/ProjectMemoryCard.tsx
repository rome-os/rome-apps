import { useCallback, useEffect, useState } from "react";
import { History, Save } from "lucide-react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { Button } from "@rome-os/ui/button";
import { List, ListRow, ListRowContent, ListRowDescription, ListRowTitle } from "@rome-os/ui/list-row";
import { Spinner } from "@rome-os/ui/spinner";
import { Textarea } from "@rome-os/ui/textarea";
import { Timestamp } from "@rome-os/ui/timestamp";
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
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`Project knowledge, e.g.\n- We intentionally use default exports in src/legacy/\n- Don't flag console.log under scripts/\n- Deploy via the release workflow, never by hand`}
        rows={5}
      />
      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner size="sm" label="Saving project memory" /> : <Save />}
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
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner size="xs" /> Loading history…</p>
          ) : edits.length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <List asChild>
              <ul>
              {edits.map((edit) => (
                <ListRow key={edit.id} asChild size="sm">
                  <li className="text-xs">
                    <ListRowContent>
                      <ListRowTitle>
                        {edit.actor === "agent" ? "Agent" : "You"}
                        <span className="ml-1 font-normal text-muted-foreground">· {edit.source}{edit.sourceRef ? ` (${edit.sourceRef})` : ""}</span>
                      </ListRowTitle>
                      {edit.summary && <ListRowDescription>{edit.summary}</ListRowDescription>}
                    </ListRowContent>
                    <Timestamp value={edit.createdAt} format="datetime" className="shrink-0 text-muted-foreground" />
                  </li>
                </ListRow>
              ))}
              </ul>
            </List>
          )}
        </div>
      )}
    </div>
  );
}
