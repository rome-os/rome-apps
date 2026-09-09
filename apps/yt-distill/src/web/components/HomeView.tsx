import { useCallback, useEffect, useState } from "react";
import { navigateToApp, useCaller } from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { Card, CardContent } from "@rome-os/ui/card";
import { Spinner } from "@rome-os/ui/spinner";
import {
  Check,
  Clapperboard,
  ExternalLink,
  FileText,
  Network,
  Presentation,
  Recycle,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  distill,
  listHistory,
  removeDistillation,
  setFeatured as setFeaturedApi,
  SLIDE_STYLE_OPTIONS,
  type ArtifactType,
  type HistoryItem,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";

const ARTIFACT_OPTIONS: { type: ArtifactType; label: string; hint: string }[] = [
  { type: "mindmap", label: "Mindmap", hint: "Hierarchical mind map" },
  { type: "summary", label: "Summary", hint: "Key points" },
  { type: "slides", label: "Slides", hint: "Web slide deck" },
];

const ARTIFACT_META: { type: ArtifactType; label: string; Icon: LucideIcon }[] = [
  { type: "mindmap", label: "Mindmap", Icon: Network },
  { type: "summary", label: "Summary", Icon: FileText },
  { type: "slides", label: "Slides", Icon: Presentation },
];

function ArtifactBadges({ artifacts }: { artifacts: HistoryItem["artifacts"] }) {
  const present = ARTIFACT_META.filter((a) => artifacts[a.type]);
  if (present.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {present.map(({ type, label, Icon }) => (
        <span
          key={type}
          className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <Icon className="size-3" />
          {label}
        </span>
      ))}
    </span>
  );
}

/** Client-side mirror of the server's video-id parser (good enough for the reuse hint). */
function parseVideoIdClient(raw: string): string | null {
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/) ??
      (u.hostname.endsWith("youtu.be") ? u.pathname.match(/^\/([A-Za-z0-9_-]{11})/) : null);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ArtifactToggle({
  option,
  selected,
  onToggle,
}: {
  option: (typeof ARTIFACT_OPTIONS)[number];
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={`flex flex-1 items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-primary bg-accent" : "border-border hover:bg-muted"
      }`}
    >
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded border ${
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input"
        }`}
      >
        {selected ? <Check className="size-3.5" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{option.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
      </span>
    </button>
  );
}

export function HomeView() {
  const caller = useCaller();
  const isOwner = caller?.kind === "guardian";

  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Record<ArtifactType, boolean>>({
    mindmap: true,
    summary: true,
    slides: true,
  });
  const [slideStyle, setSlideStyle] = useState("auto");
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      setHistory(await listHistory());
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const chosenTypes = ARTIFACT_OPTIONS.map((o) => o.type).filter((t) => selected[t]);

  // A previous run of the same video with a saved transcript → no re-scrape.
  const reusable = (() => {
    const vid = parseVideoIdClient(url);
    if (!vid) return null;
    return history.find((h) => h.videoId === vid && h.status === "ready") ?? null;
  })();

  async function onGenerate() {
    setFormError(null);
    if (!url.trim()) {
      setFormError("Paste a YouTube video URL first.");
      return;
    }
    if (chosenTypes.length === 0) {
      setFormError("Pick at least one artifact to generate.");
      return;
    }
    setGenerating(true);
    try {
      const result = await distill(url.trim(), chosenTypes, slideStyle);
      setUrl("");
      await refreshHistory();
      navigateToApp(result.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
      void refreshHistory();
    } finally {
      setGenerating(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await removeDistillation(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onToggleFeature(id: string, next: boolean) {
    // optimistic
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, featured: next } : h)));
    try {
      await setFeaturedApi(id, next);
    } catch (err) {
      setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, featured: !next } : h)));
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <header className="flex items-center gap-3">
        <Clapperboard className="size-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">YouTube Distill</h1>
      </header>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        {isOwner
          ? "Paste a YouTube link and get a mind map, a key-point summary, and a web slide deck — built from the transcript, in the video's original language."
          : "A public showcase of mind maps, summaries, and slide decks distilled from YouTube videos. Browse the samples below."}
      </p>

      {!isOwner ? (
        <Card className="mt-6">
          <CardContent className="py-5 text-sm text-muted-foreground">
            This is the owner&apos;s public showcase. Generating new distillations is available to the
            owner only.
          </CardContent>
        </Card>
      ) : (
      <Card className="mt-6">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <label htmlFor="yt-url" className="text-sm font-medium">
              YouTube URL
            </label>
            <Input
              id="yt-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              inputMode="url"
              autoComplete="off"
              disabled={generating}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !generating) void onGenerate();
              }}
            />
            {reusable ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Recycle className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>
                  Transcript already saved for this video — it will be reused (no re-scraping).
                  To add to the existing record instead,{" "}
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => navigateToApp(reusable.id)}
                  >
                    open it
                  </button>{" "}
                  and use “Generate more”.
                </span>
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Generate</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              {ARTIFACT_OPTIONS.map((option) => (
                <ArtifactToggle
                  key={option.type}
                  option={option}
                  selected={selected[option.type]}
                  onToggle={() =>
                    setSelected((prev) => ({ ...prev, [option.type]: !prev[option.type] }))
                  }
                />
              ))}
            </div>
          </div>

          {selected.slides ? (
            <div className="space-y-2">
              <label htmlFor="slide-style" className="text-sm font-medium">
                Slide style
              </label>
              <select
                id="slide-style"
                value={slideStyle}
                onChange={(e) => setSlideStyle(e.target.value)}
                disabled={generating}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              >
                {SLIDE_STYLE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Auto picks a different look each time. Choose a preset to lock the vibe.
              </p>
            </div>
          ) : null}

          {formError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button onClick={() => void onGenerate()} disabled={generating}>
              {generating ? <Spinner size="sm" /> : null}
              {generating ? "Distilling… (this can take a minute)" : "Generate"}
            </Button>
            {generating ? (
              <span className="text-sm text-muted-foreground">
                Fetching transcript and generating — please keep this tab open.
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">{isOwner ? "History" : "Samples"}</h2>
          <Button variant="ghost" size="sm" onClick={() => void refreshHistory()} disabled={loadingHistory}>
            <RefreshCw className={loadingHistory ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>

        {historyError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {historyError}
          </div>
        ) : loadingHistory && history.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner size="sm" /> Loading history…
          </div>
        ) : history.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {isOwner
                ? "No videos yet. Paste a YouTube link above to create your first distillation."
                : "No samples have been shared yet."}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {history.map((item) => (
              <li key={item.id}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center gap-3 py-3">
                    <button
                      type="button"
                      onClick={() => navigateToApp(item.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <img
                        src={`https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        className="hidden h-12 w-20 shrink-0 rounded object-cover sm:block"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {item.title ?? item.url}
                          </span>
                          {isOwner && item.featured ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                              <Star className="size-3 fill-current" /> Sample
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.channel ? `${item.channel} · ` : ""}
                          {formatDate(item.createdAt)}
                        </span>
                        <ArtifactBadges artifacts={item.artifacts} />
                      </span>
                      <StatusBadge status={item.status} />
                    </button>
                    {isOwner ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={item.featured ? "Unmark public sample" : "Mark as public sample"}
                        title={item.featured ? "Public sample — click to make private" : "Show as a public sample"}
                        onClick={() => void onToggleFeature(item.id, !item.featured)}
                      >
                        <Star
                          className={`size-4 ${item.featured ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`}
                        />
                      </Button>
                    ) : null}
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      aria-label="Open on YouTube"
                      title="Open on YouTube"
                    >
                      <a
                        href={item.url || `https://www.youtube.com/watch?v=${item.videoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                    {isOwner ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete"
                        onClick={() => void onDelete(item.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
