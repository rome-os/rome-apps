import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@rome-os/ui/button";
import { Check, Copy } from "lucide-react";
import { applyHighlights, clearHighlights, scrollActiveIntoView } from "../lib/highlight";
import { SearchBar } from "./SearchBar";

/**
 * Render the readable, timestamped transcript. Each paragraph is stored as
 * "[mm:ss] text"; the leading timestamp becomes a clickable timecode (jumping
 * to that moment on YouTube). Includes a "Copy transcript" button and an
 * in-view search box (highlight + counter + prev/next).
 */
interface Para {
  ts: string | null;
  text: string;
}

function parseParagraphs(transcript: string): Para[] {
  return transcript
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const m = block.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
      return m ? { ts: m[1], text: m[2].trim() } : { ts: null, text: block };
    });
}

/** "1:02" or "1:02:03" -> seconds. Returns null if unparseable. */
function tsToSeconds(ts: string): number | null {
  const parts = ts.split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.some((v) => !Number.isFinite(v))) return null;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

export function TranscriptView({
  transcript,
  videoId,
}: {
  transcript: string;
  videoId: string;
}) {
  const paras = useMemo(() => parseParagraphs(transcript), [transcript]);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [count, setCount] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const onCopy = async () => {
    const plain = paras.map((p) => p.text).join("\n\n");
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  // Memoize the paragraph list so search-box typing never re-renders it; the
  // highlight effect then safely owns those DOM nodes.
  const body = useMemo(
    () => (
      <div className="space-y-4">
        {paras.map((p, i) => {
          const seconds = p.ts ? tsToSeconds(p.ts) : null;
          return (
            <div key={i} className="flex gap-3">
              {p.ts ? (
                seconds !== null ? (
                  <a
                    href={`https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on YouTube at this time"
                    className="mt-1 w-14 shrink-0 select-none font-mono text-xs tabular-nums text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {p.ts}
                  </a>
                ) : (
                  <span className="mt-1 w-14 shrink-0 select-none font-mono text-xs tabular-nums text-muted-foreground">
                    {p.ts}
                  </span>
                )
              ) : null}
              <p className="min-w-0 flex-1 text-sm leading-relaxed">{p.text}</p>
            </div>
          );
        })}
      </div>
    ),
    [paras, videoId],
  );

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const n = applyHighlights(root, query, active);
    setCount(n);
    if (n > 0) scrollActiveIntoView(root);
    return () => {
      if (bodyRef.current) clearHighlights(bodyRef.current);
    };
  }, [query, active, paras]);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="min-w-[200px] flex-1">
          <SearchBar
            value={query}
            onChange={(v) => {
              setQuery(v);
              setActive(0);
            }}
            count={count}
            activeIndex={active}
            onPrev={() => setActive((a) => a - 1)}
            onNext={() => setActive((a) => a + 1)}
            onClear={() => {
              setQuery("");
              setActive(0);
            }}
            placeholder="Search transcript…"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => void onCopy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy transcript"}
        </Button>
      </div>
      <div ref={bodyRef} className="max-h-[65vh] overflow-y-auto p-4 md:p-6">
        {body}
      </div>
    </div>
  );
}
