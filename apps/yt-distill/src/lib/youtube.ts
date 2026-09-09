/**
 * Transcript + metadata fetching for YouTube videos.
 *
 * YouTube's caption/timedtext endpoints are gated behind a proof-of-origin
 * token and return empty bodies from server IPs, so we cannot fetch captions
 * over plain HTTP (and `opencli youtube transcript` fails the same way). The
 * reliable path is to drive the platform's persistent, logged-in Chrome via
 * CDP: open the watch page, expand the description, click "Show transcript",
 * and scrape the rendered transcript segments — exactly what a human does.
 *
 * This uses only the Node >=21 built-in global `WebSocket` and `fetch`, so it
 * has no external dependencies. We never invent a transcript: any failure is
 * surfaced so the caller can show a friendly error status.
 */

const CDP_BASE = process.env.YT_CDP_BASE || "http://127.0.0.1:9222";
const VISIT_TIMEOUT_MS = 120_000;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/**
 * Machine-readable reasons a transcript fetch can fail. Stored on the record
 * so the UI can show targeted help (e.g. a link to the Rome browser).
 */
export type TranscriptErrorCode =
  | "BROWSER_UNAVAILABLE" // could not reach the agent browser over CDP
  | "NOT_LOGGED_IN" // the browser is not signed in to YouTube
  | "NO_TRANSCRIPT" // page loaded but YouTube offers no transcript for it
  | "PANEL_EMPTY" // transcript panel opened but never populated
  | "TIMEOUT" // scrape exceeded the time budget
  | "PAGE_ERROR"; // any other CDP / page-level failure

export interface OpenCliError {
  code?: TranscriptErrorCode | string;
  message?: string;
}

/** Parse a YouTube video id from a full URL or a bare id. */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return /^[A-Za-z0-9_-]{6,20}$/.test(trimmed) ? trimmed : null;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;
    const v = parsed.searchParams.get("v");
    if (v) return v;
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id || null;
    }
    const pathMatch = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
    if (pathMatch) return pathMatch[2];
    return null;
  } catch {
    return null;
  }
}

/** True when the input looks like a usable YouTube video link or id. */
export function isYouTubeUrl(input: string): boolean {
  return parseVideoId(input) !== null;
}

// --- Minimal CDP client over the built-in WebSocket ------------------------

interface CdpTab {
  id: string;
  webSocketDebuggerUrl: string;
}

async function openTab(url: string): Promise<CdpTab> {
  let lastErr: unknown;
  for (const method of ["PUT", "GET"] as const) {
    try {
      const r = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, { method });
      if (r.ok) return (await r.json()) as CdpTab;
      lastErr = new Error(`open tab HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`CDP openTab failed: ${String((lastErr as Error)?.message ?? lastErr)}`);
}

async function closeTab(id: string): Promise<void> {
  try {
    await fetch(`${CDP_BASE}/json/close/${id}`);
  } catch {
    /* best-effort */
  }
}

interface CdpConn {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
}

function connectCdp(wsUrl: string): Promise<CdpConn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map<
      number,
      { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
    >();

    ws.onopen = () => {
      const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<Record<string, unknown>>((res, rej) => {
          const id = nextId++;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      resolve({ send, close: () => ws.close() });
    };
    ws.onerror = () => reject(new Error("CDP websocket error"));
    ws.onmessage = (ev: MessageEvent) => {
      let msg: { id?: number; result?: Record<string, unknown>; error?: unknown };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result ?? {});
      }
    };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page. Expands the description, opens the transcript panel,
// and scrapes the rendered segments plus basic metadata.
const SCRAPE_EXPRESSION = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let pr = null;
  for (let i = 0; i < 40; i++) { pr = window.ytInitialPlayerResponse; if (pr && pr.videoDetails) break; await sleep(500); }
  const vd = (pr && pr.videoDetails) || {};
  const meta = { title: vd.title || document.title || '', author: vd.author || '', videoId: vd.videoId || '' };

  // The button label follows the YouTube ACCOUNT language ("Show transcript",
  // zh-CN "内容转文字", zh-TW "顯示轉錄稿", ja "文字起こしを表示", ko "스크립트 표시",
  // ...), so prefer the locale-independent DOM structure (the transcript section
  // inside the expanded description) and only fall back to multilingual text matching.
  const WORDS = /transcript|内容转文字|转写|轉錄|字幕记录|字幕記錄|文字起こし|스크립트|transkript|transcripci|transcrição|trascrizione|транскрип/i;
  const expandDescription = () => {
    const exp = document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand');
    if (exp && exp.offsetParent !== null) { exp.click(); return true; }
    return false;
  };
  const findBtn = () => {
    const sec = document.querySelector('ytd-video-description-transcript-section-renderer');
    if (sec) {
      const b = sec.querySelector('#primary-button button, yt-button-shape button, button');
      if (b) return b;
    }
    const btns = [...document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button')];
    return btns.find(b => WORDS.test(b.getAttribute('aria-label') || '') || WORDS.test(b.textContent || ''));
  };

  // Read segments from EITHER the classic panel (ytd-transcript-segment-renderer)
  // OR YouTube's newer "In this video" panel (transcript-segment-view-model).
  const read = () => {
    const oldSegs = [...document.querySelectorAll('ytd-transcript-segment-renderer')].map(s => ({
      t: (s.querySelector('.segment-timestamp') ? s.querySelector('.segment-timestamp').textContent : '').trim(),
      x: (s.querySelector('.segment-text, yt-formatted-string.segment-text') ? s.querySelector('.segment-text, yt-formatted-string.segment-text').textContent : '').trim(),
    })).filter(o => o.x);
    if (oldSegs.length) return oldSegs;
    return [...document.querySelectorAll('transcript-segment-view-model')].map(s => {
      const ts = s.querySelector('.ytwTranscriptSegmentViewModelTimestamp');
      const tx = s.querySelector('.ytAttributedStringHost, span[role=text]');
      return { t: (ts ? ts.textContent : '').trim(), x: (tx ? tx.textContent : '').trim() };
    }).filter(o => o.x);
  };

  // On a cold tab the "Show transcript" button may not exist for several seconds
  // and the panel loads lazily. Click it ONCE when found (re-clicking would
  // toggle the panel closed), then poll for segments — up to ~50s, with one
  // retry click if nothing has appeared after ~18s.
  let segs = [];
  let clicked = false;
  let lastClick = 0;
  let expandedAt = 0;
  const deadline = Date.now() + 50000;
  while (Date.now() < deadline) {
    segs = read();
    if (segs.length > 0) break;
    let btn = findBtn();
    if (!btn && Date.now() - expandedAt > 4000) {
      // The transcript section only renders once the description is expanded.
      if (expandDescription()) { expandedAt = Date.now(); await sleep(800); btn = findBtn(); }
    }
    if (btn && (!clicked || Date.now() - lastClick > 18000)) {
      btn.click();
      clicked = true;
      lastClick = Date.now();
    }
    await sleep(1000);
  }
  // Let the list finish streaming in, then read once more.
  if (segs.length > 0) { await sleep(1000); segs = read(); }

  let loggedIn = null;
  try { const c = window.ytcfg && window.ytcfg.get && window.ytcfg.get('LOGGED_IN'); if (typeof c === 'boolean') loggedIn = c; } catch (e) {}
  if (loggedIn === null) loggedIn = !!document.querySelector('#avatar-btn, button#avatar-btn');
  const reason = segs.length > 0 ? null : (clicked ? 'PANEL_EMPTY' : 'NO_BUTTON');
  return { meta, transcriptFound: segs.length > 0, segCount: segs.length, segments: segs, reason, buttonClicked: clicked, loggedIn, uiLang: document.documentElement.lang || '' };
})()`;

/**
 * YouTube's transcript panel sometimes yields the whole transcript twice. Detect
 * a full restart (the opening line reappearing in the back half, followed by
 * more matching lines) and drop the duplicated tail.
 */
function dedupeSegments(segments: { t: string; x: string }[]): { t: string; x: string }[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (segments.length < 8) return segments;
  const first = norm(segments[0].x);
  if (!first) return segments;
  const start = Math.floor(segments.length * 0.4);
  for (let j = start; j < segments.length; j++) {
    if (norm(segments[j].x) !== first) continue;
    let matches = 0;
    for (let k = 0; k < 5 && j + k < segments.length; k++) {
      if (norm(segments[j + k].x) === norm(segments[k].x)) matches++;
    }
    if (matches >= 3) return segments.slice(0, j);
  }
  return segments;
}

/** Join segment text into a single clean line for the LLM (no timestamps). */
function toPlainText(segments: { t: string; x: string }[]): string {
  return segments
    .map((s) => s.x)
    .filter((x) => x && !/^\[[^\]]*\]$/.test(x))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Group segments into readable, timestamped paragraphs for on-screen display.
 * Starts a new paragraph on sentence boundaries past ~320 chars (hard cap ~560).
 */
function toFormattedText(segments: { t: string; x: string }[]): string {
  const paras: { ts: string; text: string }[] = [];
  let cur: string[] = [];
  let curTs: string | null = null;
  let curLen = 0;
  for (const seg of segments) {
    const text = seg.x.trim();
    if (!text || /^\[[^\]]*\]$/.test(text)) continue;
    if (curTs === null) curTs = seg.t || "";
    cur.push(text);
    curLen += text.length + 1;
    const endsSentence = /[.!?。！？…]["')\]]?$/.test(text);
    if ((curLen >= 320 && endsSentence) || curLen >= 560) {
      paras.push({ ts: curTs, text: cur.join(" ").replace(/\s+/g, " ").trim() });
      cur = [];
      curTs = null;
      curLen = 0;
    }
  }
  if (cur.length) paras.push({ ts: curTs ?? "", text: cur.join(" ").replace(/\s+/g, " ").trim() });
  return paras.map((p) => (p.ts ? `[${p.ts}] ${p.text}` : p.text)).join("\n\n");
}

interface VisitResult {
  ok: boolean;
  meta: { title: string | null; channel: string | null; videoId: string | null };
  text: string;
  formatted: string;
  error?: OpenCliError;
}

async function visitAndScrape(url: string): Promise<VisitResult> {
  let tab: CdpTab | null = null;
  let conn: CdpConn | null = null;
  const empty = { title: null, channel: null, videoId: null };
  try {
    tab = await openTab(url);
    conn = await connectCdp(tab.webSocketDebuggerUrl);
    await conn.send("Page.enable");
    await conn.send("Runtime.enable");
    try {
      await conn.send("Page.bringToFront");
    } catch {
      /* ignore */
    }
    await sleep(3500);
    try {
      await conn.send("Runtime.evaluate", { expression: "window.scrollTo(0, 600)" });
    } catch {
      /* ignore */
    }
    await sleep(1500);
    const res = await conn.send("Runtime.evaluate", {
      expression: SCRAPE_EXPRESSION,
      awaitPromise: true,
      returnByValue: true,
      timeout: 90_000,
    });
    const value = ((res.result as { value?: unknown } | undefined)?.value ?? {}) as {
      meta?: { title?: string; author?: string; videoId?: string };
      transcriptFound?: boolean;
      segments?: { t: string; x: string }[];
      reason?: "PANEL_EMPTY" | "NO_BUTTON" | null;
      buttonClicked?: boolean;
      loggedIn?: boolean;
      uiLang?: string;
    };
    const meta = {
      title: value.meta?.title?.trim() || null,
      channel: value.meta?.author?.trim() || null,
      videoId: value.meta?.videoId?.trim() || parseVideoId(url),
    };
    const segments = dedupeSegments(Array.isArray(value.segments) ? value.segments : []);
    const text = toPlainText(segments);
    if (!value.transcriptFound || !text) {
      let code: TranscriptErrorCode;
      let detail: string;
      if (value.reason === "NO_BUTTON" && value.loggedIn === false) {
        code = "NOT_LOGGED_IN";
        detail = "The agent browser is not signed in to YouTube";
      } else if (value.reason === "NO_BUTTON") {
        code = "NO_TRANSCRIPT";
        detail = `YouTube shows no "Show transcript" option for this video (ui=${value.uiLang || "?"})`;
      } else if (value.reason === "PANEL_EMPTY") {
        code = "PANEL_EMPTY";
        detail = "The transcript panel opened but no lines were loaded";
      } else {
        code = "NO_TRANSCRIPT";
        detail = "No transcript panel / captions for this video";
      }
      return { ok: false, meta, text: "", formatted: "", error: { code, message: detail } };
    }
    return { ok: true, meta, text, formatted: toFormattedText(segments) };
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    const browserDown = !tab || /openTab failed|websocket error|ECONNREFUSED|fetch failed/i.test(message);
    return {
      ok: false,
      meta: { ...empty, videoId: parseVideoId(url) },
      text: "",
      formatted: "",
      error: {
        code: browserDown ? "BROWSER_UNAVAILABLE" : "PAGE_ERROR",
        message: browserDown ? `Could not reach the agent browser (${message})` : message,
      },
    };
  } finally {
    try {
      conn?.close();
    } catch {
      /* ignore */
    }
    if (tab?.id) await closeTab(tab.id);
  }
}

// De-dupe concurrent visits to the same video (the action fetches transcript
// and metadata in parallel). Cache the in-flight promise briefly.
const inflight = new Map<string, Promise<VisitResult>>();

function getVisit(url: string): Promise<VisitResult> {
  const key = parseVideoId(url) ?? url;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const timeout = new Promise<VisitResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            meta: { title: null, channel: null, videoId: parseVideoId(url) },
            text: "",
            formatted: "",
            error: { code: "TIMEOUT", message: "Transcript fetch timed out after 2 minutes" },
          }),
        VISIT_TIMEOUT_MS,
      ),
    );
    return Promise.race([visitAndScrape(url), timeout]);
  })();
  inflight.set(key, p);
  // Keep the shared result around just long enough for the parallel caller.
  p.finally(() => setTimeout(() => inflight.delete(key), 2000));
  return p;
}

export interface TranscriptResult {
  ok: boolean;
  /** Plain single-line transcript (no timestamps) — used for the LLM prompt. */
  text: string;
  /** Readable, timestamped paragraphs — used for on-screen display. */
  formatted: string;
  error?: OpenCliError;
}

/** Fetch a video transcript. Never throws. */
export async function fetchTranscript(url: string): Promise<TranscriptResult> {
  const v = await getVisit(url);
  return v.ok
    ? { ok: true, text: v.text, formatted: v.formatted }
    : { ok: false, text: "", formatted: "", error: v.error };
}

export interface VideoMetadata {
  title: string | null;
  channel: string | null;
  videoId: string | null;
}

/** Fetch video metadata (title + channel). Never throws; nulls on failure. */
export async function fetchVideoMetadata(url: string): Promise<VideoMetadata> {
  const v = await getVisit(url);
  return v.meta;
}
