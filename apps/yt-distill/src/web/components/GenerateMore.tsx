import { useState } from "react";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent } from "@rome-os/ui/card";
import { Spinner } from "@rome-os/ui/spinner";
import { Check, Recycle, Sparkles } from "lucide-react";
import { generateInto, SLIDE_STYLE_OPTIONS, type ArtifactType, type Distillation } from "../lib/api";

const OPTIONS: { type: ArtifactType; label: string }[] = [
  { type: "mindmap", label: "Mindmap" },
  { type: "summary", label: "Summary" },
  { type: "slides", label: "Slides" },
];

function has(record: Distillation, type: ArtifactType): boolean {
  if (type === "mindmap") return !!record.mindmapMd;
  if (type === "summary") return !!record.summaryMd;
  return !!record.slidesHtml;
}

/**
 * Owner-only panel on a record: generate more artifacts from the transcript
 * already stored on this record (no YouTube re-scrape, and the cached condensed
 * outline is reused for long videos). Missing artifacts are pre-selected;
 * existing ones can be regenerated in place (e.g. slides in a new style).
 */
export function GenerateMore({
  record,
  onDone,
}: {
  record: Distillation;
  onDone: () => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<Record<ArtifactType, boolean>>({
    mindmap: !record.mindmapMd,
    summary: !record.summaryMd,
    slides: !record.slidesHtml,
  });
  const [style, setStyle] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const chosen = OPTIONS.map((o) => o.type).filter((t) => selected[t]);

  async function run() {
    if (chosen.length === 0) {
      setError("Pick at least one artifact.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await generateInto(record.id, chosen, style);
      if (res.failed && res.failed.length > 0) {
        setError(`Some content failed to generate: ${res.failed.join(", ")}`);
      } else if (res.errorMessage) {
        setError(res.errorMessage);
      } else {
        setNotice(`Generated: ${(res.generated ?? chosen).join(", ")}.`);
      }
      await onDone();
      setSelected({ mindmap: false, summary: false, slides: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Generate more from this transcript</h2>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Recycle className="mt-0.5 size-3.5 shrink-0" />
          Uses the transcript saved on this record — no re-scraping of YouTube. Already generated
          items will be replaced in place.
        </p>

        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => {
            const on = selected[o.type];
            const exists = has(record, o.type);
            return (
              <button
                key={o.type}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={busy}
                onClick={() => setSelected((p) => ({ ...p, [o.type]: !p[o.type] }))}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  on ? "border-primary bg-accent" : "border-border hover:bg-muted"
                } disabled:opacity-50`}
              >
                <span
                  className={`flex size-4 items-center justify-center rounded border ${
                    on ? "border-primary bg-primary text-primary-foreground" : "border-input"
                  }`}
                >
                  {on ? <Check className="size-3" /> : null}
                </span>
                {o.label}
                <span className="text-[10px] text-muted-foreground">{exists ? "replace" : "new"}</span>
              </button>
            );
          })}
        </div>

        {selected.slides ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="more-slide-style" className="text-sm">
              Slide style
            </label>
            <select
              id="more-slide-style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              disabled={busy}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              {SLIDE_STYLE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

        <Button size="sm" onClick={() => void run()} disabled={busy || chosen.length === 0}>
          {busy ? (
            <>
              <Spinner size="sm" /> Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Generate
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
