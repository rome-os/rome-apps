import "./styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAppApi, navigateRome, type RomeAppBootstrap } from "@rome-os/app-web-sdk";
import {
  Upload,
  Play,
  Trash2,
  Download,
  Pencil,
  Check,
  X,
  GripVertical,
  Plus,
  ListVideo,
  AlertCircle,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// --- Wire types (mirror the API's TraceSummaryRow) --------------------------

interface TraceSummary {
  id: string;
  name: string;
  uploadedAt: string;
  sizeBytes: number;
  blockCount: number;
  originalUserPrompt: string | null;
  status: string | null;
  model: string | null;
  durationMs: number | null;
}

interface UploadResult {
  ok: boolean;
  trace?: TraceSummary;
  name?: string;
  error?: string;
}

// --- Small helpers ----------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drive a bound replay session one turn at a time: post a turn's recorded
 * prompt, then wait for the replay middleware to finish it (the cursor advances
 * past it) before posting the next. Lives at module scope, not inside the React
 * component, so it keeps running after `navigateRome` unmounts the Replay app —
 * the chat view it navigated to is what the guardian watches the replay in.
 *
 * Sequential (not fire-all) is load-bearing: each turn's messages must occupy
 * their own monotonically-increasing wall-clock second, or the transcript
 * interleaves them (see replayInChat for the full why).
 */
async function driveReplay(
  sessionId: string,
  traces: { originalUserPrompt: string | null }[],
): Promise<void> {
  const POLL_MS = 600;
  // Generous ceiling per turn — a long trace types for a while (the middleware
  // budget caps it). If we ever exceed this we stop rather than wedge.
  const MAX_WAIT_MS = 180_000;
  for (let i = 0; i < traces.length; i++) {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: traces[i].originalUserPrompt || "(replayed turn)" }),
    });
    if (!res.ok) return;
    if (i === traces.length - 1) return; // nothing to pace after the last turn

    const target = i + 1;
    const deadline = Date.now() + MAX_WAIT_MS;
    for (;;) {
      await sleep(POLL_MS);
      if (Date.now() > deadline) return;
      try {
        const pr = await fetchAppApi(`sessions/${encodeURIComponent(sessionId)}/progress`);
        if (!pr.ok) continue;
        const { cursor } = (await pr.json()) as { cursor?: number };
        if (typeof cursor === "number" && cursor >= target) break;
      } catch {
        // Transient fetch error (e.g. mid-navigation) — keep polling.
      }
    }
  }
}

// Slider bounds mirror the API contract in src/lib/plan-settings.ts.
const SPEED_MIN = 0.5;
const SPEED_MAX = 10;
const TYPING_CAP_MIN_SECS = 1;
const TYPING_CAP_MAX_SECS = 30;

const statusTone: Record<string, string> = {
  completed: "bg-primary/10 text-primary",
  interrupted: "bg-muted text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
};

function StatusChip({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        statusTone[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

/**
 * One row in the replay queue, made sortable via dnd-kit. The grip is the drag
 * handle (so the remove button stays clickable), and the row lifts + follows the
 * pointer with a smooth transform while dragging.
 */
function SortableQueueRow({
  trace,
  index,
  onRemove,
}: {
  trace: TraceSummary;
  index: number;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: trace.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-2 rounded-12 border bg-card p-3 transition-shadow",
        isDragging && "relative z-10 shadow-10",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label="Drag to reorder"
        className={cn(
          "mt-0.5 shrink-0 rounded-4 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="mt-0.5 shrink-0 text-sm font-semibold text-muted-foreground">
        {index + 1}.
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {trace.originalUserPrompt || (
            <span className="italic text-muted-foreground">no recorded prompt</span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">{trace.name}</p>
      </div>
      <button
        type="button"
        aria-label="Remove from queue"
        className="rounded-4 p-1 text-muted-foreground hover:bg-accent"
        onClick={onRemove}
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

export default function App(_props: { bootstrap: RomeAppBootstrap }) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<string[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [replaying, setReplaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [typingCapSecs, setTypingCapSecs] = useState(30);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(traces.map((t) => [t.id, t])), [traces]);

  const refresh = useCallback(async () => {
    const res = await fetchAppApi("state");
    const data = (await res.json()) as { traces: TraceSummary[] };
    setTraces(data.traces ?? []);
    // Drop any queued ids whose trace was deleted out from under us.
    setQueue((q) => q.filter((id) => (data.traces ?? []).some((t) => t.id === id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // --- Upload ---------------------------------------------------------------

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".json"));
      if (list.length === 0) {
        setUploadErrors(["Only .json trace files are supported."]);
        return;
      }
      setUploading(true);
      setUploadErrors([]);
      try {
        const entries = await Promise.all(
          list.map(async (f) => ({ name: f.name, content: await f.text() })),
        );
        const res = await fetchAppApi("traces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traces: entries }),
        });
        const data = (await res.json()) as { results?: UploadResult[]; error?: string };
        if (data.error) {
          setUploadErrors([data.error]);
        } else {
          const errs = (data.results ?? [])
            .filter((r) => !r.ok)
            .map((r) => `${r.name ?? "trace"}: ${r.error ?? "failed"}`);
          setUploadErrors(errs);
          // Auto-queue the newly imported traces, in upload order.
          const newIds = (data.results ?? [])
            .filter((r) => r.ok && r.trace)
            .map((r) => r.trace!.id);
          setQueue((q) => [...q, ...newIds.filter((id) => !q.includes(id))]);
        }
        await refresh();
      } catch (err) {
        setUploadErrors([err instanceof Error ? err.message : "Upload failed."]);
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles],
  );

  // --- Library actions ------------------------------------------------------

  const remove = useCallback(
    async (id: string) => {
      await fetchAppApi(`traces/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const commitRename = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      setRenaming(null);
      if (!name) return;
      await fetchAppApi(`traces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refresh();
    },
    [renameValue, refresh],
  );

  const download = useCallback(async (t: TraceSummary) => {
    const res = await fetchAppApi(`traces/${t.id}/content`);
    const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = t.name.endsWith(".json") ? t.name : `${t.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // --- Replay queue (drag-to-order via dnd-kit) -----------------------------

  const sensors = useSensors(
    // A small activation distance lets a click on the grip still register as a
    // click (e.g. focus) rather than starting a drag immediately.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setQueue((q) => {
      const from = q.indexOf(active.id as string);
      const to = q.indexOf(over.id as string);
      if (from < 0 || to < 0) return q;
      return arrayMove(q, from, to);
    });
  }, []);

  const replayInChat = useCallback(async () => {
    if (queue.length === 0 || replaying) return;
    setReplaying(true);
    try {
      // 1. Create the ordered plan; the API echoes the ordered trace summaries
      //    so we have each turn's original user prompt to post.
      const planRes = await fetchAppApi("plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceIds: queue,
          speed,
          turnBudgetMs: typingCapSecs * 1000,
        }),
      });
      const planData = (await planRes.json()) as {
        plan?: { id: string };
        traces?: TraceSummary[];
        error?: string;
      };
      if (!planRes.ok || !planData.plan) {
        setUploadErrors([planData.error ?? "Could not create the replay plan."]);
        return;
      }
      const planId = planData.plan.id;
      const orderedTraces = planData.traces ?? [];

      // 2. Create a chat session bound to the `replay` agent — no turn yet.
      // Deliberately unnamed: the standard conversation-title generator then
      // names it from the first replayed prompt, exactly like a real chat —
      // a hardcoded "Replay" title would out the session in the sidebar and
      // header (it matters under the host's presentation mode).
      const sessionRes = await fetch("/api/chat/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "replay" }),
      });
      const session = (await sessionRes.json()) as { id?: string };
      if (!sessionRes.ok || !session.id) {
        setUploadErrors(["Could not create a chat session."]);
        return;
      }

      // 3. Bind the plan to the session BEFORE any turn runs (no race: this is
      //    awaited before the first turn POST below).
      await fetchAppApi("sessions/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, planId }),
      });

      // 4. Open the chat, then drive the turns SEQUENTIALLY in the background:
      //    post turn N+1 only once the replay middleware has finished turn N
      //    (cursor advanced). Posting all turns up front (the original approach)
      //    collided every user row in the same wall-clock second —
      //    `webchat_messages.created_at` has second granularity — so the chat
      //    transcript, which groups by turn but orders groups by their earliest
      //    timestamp, interleaved the turns (the answer to turn 2 surfaced
      //    mid-way through turn 1). Sequential posting gives each turn its own
      //    monotonically-increasing time window, so order is always faithful.
      window.dispatchEvent(new CustomEvent("rome:chat-sessions-changed"));
      navigateRome({ path: "chat", sessionId: session.id });
      void driveReplay(session.id, orderedTraces);
    } catch (err) {
      setUploadErrors([err instanceof Error ? err.message : "Replay failed to start."]);
    } finally {
      setReplaying(false);
    }
  }, [queue, replaying, speed, typingCapSecs]);

  const queuedTraces = queue.flatMap((id) => {
    const t = byId.get(id);
    return t ? [t] : [];
  });

  return (
    <main className="mx-auto w-full max-w-screen-lg px-4 py-6 md:py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl">
          <ListVideo className="size-7" /> Replay
        </h1>
        <p className="mt-1 text-base leading-relaxed text-muted-foreground">
          Upload <code className="rounded-4 bg-muted px-1 py-0.5 text-sm">trace.json</code> files
          downloaded from a chat turn, order them, and replay them block-by-block in chat. Replay is
          inert — no model runs and no tool is re-executed.
        </p>
      </header>

      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "mb-6 flex flex-col items-center justify-center rounded-12 border-2 border-dashed p-8 text-center transition-colors",
          dragOver ? "border-ring bg-accent/40" : "border-input",
        )}
      >
        <Upload className="mb-2 size-6 text-muted-foreground" />
        <p className="text-base font-medium">Drop trace.json files here</p>
        <p className="mb-3 text-sm text-muted-foreground">
          or pick them from disk — you can select several at once
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? "Importing…" : "Choose files"}
        </Button>
      </div>

      {uploadErrors.length > 0 && (
        <div className="mb-6 space-y-1 rounded-12 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {uploadErrors.map((e, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{e}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Replay queue */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Replay order</h2>
            <Button
              size="sm"
              disabled={queue.length === 0 || replaying}
              onClick={() => void replayInChat()}
            >
              <Play className="size-4" /> {replaying ? "Starting…" : "Replay in chat"}
            </Button>
          </div>
          {queuedTraces.length === 0 ? (
            <p className="rounded-12 border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
              Add traces from your library, then drag to set the playback order.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="whitespace-nowrap">Speed</span>
                  <Slider
                    aria-label="Playback speed"
                    value={[speed]}
                    min={SPEED_MIN}
                    max={SPEED_MAX}
                    step={0.25}
                    onValueChange={([v]) => setSpeed(v)}
                    className="w-36"
                  />
                  <span className="w-12 text-right font-medium tabular-nums text-foreground">
                    {speed}×
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  title="Max time a turn spends typing — past it, the rest of the turn appears instantly"
                >
                  <span className="whitespace-nowrap">Typing cap</span>
                  <Slider
                    aria-label="Typing cap in seconds"
                    value={[typingCapSecs]}
                    min={TYPING_CAP_MIN_SECS}
                    max={TYPING_CAP_MAX_SECS}
                    step={1}
                    onValueChange={([v]) => setTypingCapSecs(v)}
                    className="w-36"
                  />
                  <span className="w-8 text-right font-medium tabular-nums text-foreground">
                    {typingCapSecs}s
                  </span>
                </div>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={queue} strategy={verticalListSortingStrategy}>
                  <ol className="space-y-2">
                    {queuedTraces.map((t, i) => (
                      <SortableQueueRow
                        key={t.id}
                        trace={t}
                        index={i}
                        onRemove={() => setQueue((q) => q.filter((id) => id !== t.id))}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            </>
          )}
        </section>

        {/* Library */}
        <section>
          <h2 className="mb-2 text-lg font-semibold">
            Library{" "}
            {traces.length > 0 && <span className="text-muted-foreground">({traces.length})</span>}
          </h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : traces.length === 0 ? (
            <p className="rounded-12 border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
              No traces yet. Upload some above.
            </p>
          ) : (
            <ul className="space-y-2">
              {traces.map((t) => {
                const inQueue = queue.includes(t.id);
                return (
                  <li key={t.id} className="rounded-12 border bg-card p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {renaming === t.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitRename(t.id);
                                if (e.key === "Escape") setRenaming(null);
                              }}
                              className="h-7"
                            />
                            <button
                              aria-label="Save name"
                              className="rounded-4 p-1 hover:bg-accent"
                              onClick={() => void commitRename(t.id)}
                            >
                              <Check className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <p className="truncate text-sm font-medium">{t.name}</p>
                        )}
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {t.originalUserPrompt || "no recorded prompt"}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <StatusChip status={t.status} />
                          <span>{t.blockCount} blocks</span>
                          <span>·</span>
                          <span>{formatBytes(t.sizeBytes)}</span>
                          {t.model && (
                            <>
                              <span>·</span>
                              <span className="truncate">{t.model}</span>
                            </>
                          )}
                          {formatDuration(t.durationMs) && (
                            <>
                              <span>·</span>
                              <span>{formatDuration(t.durationMs)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          aria-label="Rename"
                          className="rounded-4 p-1.5 text-muted-foreground hover:bg-accent"
                          onClick={() => {
                            setRenaming(t.id);
                            setRenameValue(t.name);
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          aria-label="Download"
                          className="rounded-4 p-1.5 text-muted-foreground hover:bg-accent"
                          onClick={() => void download(t)}
                        >
                          <Download className="size-4" />
                        </button>
                        <button
                          aria-label="Delete"
                          className="rounded-4 p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                          onClick={() => void remove(t.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2">
                      <Button
                        variant={inQueue ? "secondary" : "outline"}
                        size="sm"
                        disabled={inQueue}
                        onClick={() => setQueue((q) => (q.includes(t.id) ? q : [...q, t.id]))}
                      >
                        <Plus className="size-4" /> {inQueue ? "In replay order" : "Add to replay"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
