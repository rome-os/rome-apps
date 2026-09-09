import { useState } from "react";
import { navigateToApp } from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent } from "@rome-os/ui/card";
import { Spinner } from "@rome-os/ui/spinner";
import { AlertTriangle, ExternalLink, Globe, RefreshCw, RotateCcw } from "lucide-react";
import { distill, removeDistillation, type Distillation } from "../lib/api";

/** Rome dashboard routes (same origin as the app host). */
const BROWSER_URL = "/desktop";

interface Help {
  title: string;
  why: string;
  steps: string[];
  /** Primary call-to-action link (opens in a new tab). */
  link?: { href: string; label: string };
  /** Whether "Try again" (a fresh scrape) is likely to help. */
  retry: boolean;
}

function helpFor(code: string | null | undefined, videoUrl: string): Help {
  switch (code) {
    case "NOT_LOGGED_IN":
      return {
        title: "YouTube is not signed in on the Rome browser",
        why:
          "Transcripts are read from the transcript panel of the YouTube watch page inside Rome's own browser. That browser is not currently logged in to YouTube, and YouTube only exposes the transcript to signed-in sessions.",
        steps: [
          "Open the Rome browser (button below).",
          "Go to youtube.com and sign in with any Google account.",
          "Come back here and click “Try again”. The session stays logged in for future videos.",
        ],
        link: { href: BROWSER_URL, label: "Open Rome browser" },
        retry: true,
      };
    case "BROWSER_UNAVAILABLE":
      return {
        title: "Couldn't reach the Rome browser",
        why:
          "The app fetches transcripts through Rome's built-in browser (Chrome DevTools on port 9222), and it did not respond. It may still be starting up, or it may have crashed.",
        steps: [
          "Open the Rome browser page to wake it up and check that it loads.",
          "Wait a few seconds, then click “Try again”.",
          "If it keeps failing, restart Rome.",
        ],
        link: { href: BROWSER_URL, label: "Open Rome browser" },
        retry: true,
      };
    case "NO_TRANSCRIPT":
      return {
        title: "YouTube has no transcript for this video",
        why:
          "The watch page loaded fine in the Rome browser, but YouTube did not offer a “Show transcript” option. Usually that means the video has no captions (auto-generated or uploaded), the uploader disabled them, or it is a live stream / premiere that has not been processed yet.",
        steps: [
          "Open the video on YouTube and check whether the transcript panel exists there (⋯ menu › Show transcript).",
          "If it does, YouTube may have changed its page layout — click “Try again”, and if it still fails, report it.",
          "If it doesn't, this video can't be distilled until captions are available.",
        ],
        link: { href: videoUrl, label: "Check on YouTube" },
        retry: true,
      };
    case "PANEL_EMPTY":
      return {
        title: "The transcript panel opened but stayed empty",
        why:
          "The Rome browser found and opened YouTube's transcript panel, but no lines loaded within the time budget. This is usually a slow network / very long video, or YouTube throttling the session.",
        steps: [
          "Click “Try again” — a second attempt often succeeds.",
          "If it keeps happening, open the Rome browser, play the video once, and verify the transcript loads there.",
        ],
        link: { href: BROWSER_URL, label: "Open Rome browser" },
        retry: true,
      };
    case "TIMEOUT":
      return {
        title: "Fetching the transcript timed out",
        why: "The whole scrape (open the page, expand the transcript, read every line) took longer than 2 minutes. Very long videos on a slow connection can hit this limit.",
        steps: ["Click “Try again”.", "If it keeps timing out, check that the Rome browser can load YouTube normally."],
        link: { href: BROWSER_URL, label: "Open Rome browser" },
        retry: true,
      };
    case "PAGE_ERROR":
      return {
        title: "The YouTube page could not be read",
        why: "The Rome browser opened the page, but something went wrong while driving it (a navigation, a consent dialog, or a script error). The technical detail is shown below.",
        steps: [
          "Open the Rome browser and check whether YouTube is showing a dialog (cookie consent, account chooser, “are you a robot”). Dismiss it.",
          "Click “Try again”.",
        ],
        link: { href: BROWSER_URL, label: "Open Rome browser" },
        retry: true,
      };
    case "GENERATION_FAILED":
      return {
        title: "The transcript was fetched, but nothing could be generated",
        why: "The AI step that writes the mind map / summary / slides returned nothing for every requested artifact. This is usually a temporary model or connectivity problem.",
        steps: ["Click “Try again” — the saved transcript will be reused, so this is fast."],
        retry: true,
      };
    default:
      return {
        title: "Couldn't distill this video",
        why: "Something went wrong while fetching the transcript. The technical detail is shown below.",
        steps: [
          "Make sure the Rome browser is running and signed in to YouTube.",
          "Click “Try again”.",
        ],
        link: { href: BROWSER_URL, label: "Open Rome browser" },
        retry: true,
      };
  }
}

/**
 * Friendly, actionable error card for a failed distillation: explains what
 * went wrong in plain words, lists concrete steps, links to the place where
 * the fix happens (e.g. the Rome browser for a YouTube login), and — for the
 * owner — offers a one-click "Try again" that re-runs the same request with a
 * fresh scrape.
 */
export function ErrorPanel({
  record,
  isOwner,
  onRefresh,
}: {
  record: Distillation;
  isOwner: boolean;
  onRefresh: () => Promise<void> | void;
}) {
  const help = helpFor(record.errorCode, record.url);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Strip the generic prefix so the technical detail reads on its own.
  const detail = (() => {
    const m = record.errorMessage?.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
    return m ? m[1] : record.errorMessage;
  })();

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const types = record.requestedTypes.length ? record.requestedTypes : undefined;
      const res = await distill(record.url, types ?? ["mindmap", "summary", "slides"], "auto", {
        reuseTranscript: record.errorCode === "GENERATION_FAILED",
      });
      if (res.id && res.id !== record.id) {
        // The retry made a fresh record; drop this failed one so history stays tidy.
        await removeDistillation(record.id).catch(() => undefined);
        navigateToApp(res.id);
      } else {
        await onRefresh();
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-4 py-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-destructive">{help.title}</h2>
            <p className="text-sm text-muted-foreground">{help.why}</p>
          </div>
        </div>

        <div className="rounded-md bg-muted/50 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How to fix it
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {help.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {help.link ? (
            <Button asChild size="sm">
              <a href={help.link.href} target="_blank" rel="noreferrer">
                {help.link.href === BROWSER_URL ? (
                  <Globe className="size-4" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                {help.link.label}
              </a>
            </Button>
          ) : null}
          {isOwner && help.retry ? (
            <Button variant="outline" size="sm" onClick={() => void retry()} disabled={retrying}>
              {retrying ? <Spinner size="sm" /> : <RotateCcw className="size-4" />}
              {retrying ? "Retrying…" : "Try again"}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void onRefresh()} disabled={retrying}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>

        {retryError ? <p className="text-sm text-destructive">{retryError}</p> : null}

        {detail ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Technical detail</summary>
            <p className="mt-1 break-words font-mono">
              {record.errorCode ? `[${record.errorCode}] ` : ""}
              {detail}
            </p>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
