/**
 * Pure helpers shared by the server side (actions) and the web bundle.
 * Keep this file free of Node-only imports so it can be bundled for the browser.
 */

/** Slide style options shown in the UI and accepted by the `distill` action. */
export const SLIDE_STYLE_OPTIONS: { id: string; name: string }[] = [
  { id: "auto", name: "Auto (surprise me)" },
  { id: "bold-signal", name: "Bold Signal — dark, high-impact" },
  { id: "electric-studio", name: "Electric Studio — clean, corporate" },
  { id: "dark-botanical", name: "Dark Botanical — elegant, premium" },
  { id: "ink-editorial", name: "Ink Editorial — magazine, calm" },
  { id: "indigo-porcelain", name: "Indigo Porcelain — technical, cool" },
  { id: "neon-cyber", name: "Neon Cyber — energetic" },
  { id: "swiss-grid", name: "Swiss Grid — serious typography" },
];

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

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
