# 2026-09-02 — Initial build of YouTube Distill

## Objective

Build a Rome app that takes a YouTube URL, fetches the transcript, and generates
up to three artifacts (mind map, summary, reveal.js slides) in the video's
original language, with a browsable history.

## What was built

- **Data model** (`src/db/schema.ts`): one `distillations` table, one row per
  video. Nullable artifact columns (`mindmap_md`, `summary_md`, `slides_html`)
  plus `status` (pending | ready | error), `error_message`, `requested_types`
  (JSON), transcript, and metadata. Access via `DistillationsRepository`.
- **Actions**: `distill` (create + fetch + generate), `list` (history),
  `get` (full record), `remove` (delete). Canonical ids `yt-distill:*`.
- **Transcript source** (`src/lib/youtube.ts`): shells out to `opencli` via
  `child_process.execFile` with a 120s timeout.
  - Transcript: `opencli youtube transcript <url> --mode grouped -f json` →
    inspected shape is a JSON **array** of `{ timestamp, speaker, text }`.
    Text is flattened robustly (also tolerates object-wrapped shapes).
  - Metadata: `opencli youtube video <url> -f json` → object with
    `title` / `channel` / `videoId`.
  - Any non-zero exit, empty output, or `error` payload → treated as failure.
    The `distill` action then sets `status=error` with a friendly Chinese
    message rather than crashing or inventing a transcript.
- **Generation** (`src/lib/artifacts.ts` + `distill`): for each selected type,
  calls `system:summon` with agent `assistant:assistant`, instructing it to
  detect the transcript language and reply in it, returning only the artifact
  content. Transcript is truncated to ~40k chars (noted in the prompt). Stray
  ``` code fences are stripped before storing.
- **Web UI** (`src/web/`): single-page app, two views driven by the app route.
  - Home: hero URL input, three selectable artifact toggles (all on by
    default), a Generate button with a loading state, and the history list with
    thumbnails, status badges, and per-row delete.
  - Detail (`/apps/yt-distill/<id>`): title + external link, tabs for whichever
    artifacts exist. Mind map rendered with markmap (d3 + markmap-lib/-view from
    jsDelivr); summary via the kit `Markdown`; slides in a sandboxed
    `<iframe srcDoc>`. Error/pending states shown as cards.

## Decisions

- Used `assistant:assistant` via `system:summon` (no app-private agent needed) —
  matches the one-shot generation pattern.
- Selectable toggle cards instead of a copied checkbox primitive (the kit does
  not publish one), styled with `border-primary bg-accent` for the selected
  state per the design guidance.
- Pulled in the `streamdown` peer set so the kit `Markdown` renders; its shiki
  language grammars and mermaid are code-split and lazy-loaded.

## Validation

- `pnpm typecheck`, `pnpm test` (20 unit tests for URL parsing, type
  normalization, fence stripping, truncation, prompt building), and `pnpm build`
  all pass.
- Smoke-tested list/get/remove and the transcript-failure error path against the
  installed app.

## Caveats / follow-ups

- `opencli` needs a logged-in YouTube browser session. In this build environment
  the Browser Bridge extension was not connected, so live transcript/metadata
  fetches return non-zero — exercising the friendly error path but not a full
  happy-path generation. Verify happy path where a YouTube session exists.
