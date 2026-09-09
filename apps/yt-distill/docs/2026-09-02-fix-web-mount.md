# 2026-09-02 — Fix: web bundle failed to mount

## Symptom

Navigating to `/apps/yt-distill` showed a red "Failed to mount YouTube Distill —
Failed to construct 'URL': Invalid base URL" card. Backend/actions were fine.

## Root cause

The Summary tab used the `@rome-os/ui` kit `Markdown` component, which pulls in
the `streamdown` peer set (KaTeX + mermaid + shiki). KaTeX's stylesheet, bundled
into `dist/web/*.css`, contains relative font references like
`url(./static/font/KaTeX_*.woff2)`. The host style-loader resolves relative CSS
refs with `new URL(ref, styleUrl)`, but the manifest `styleUrl` is an
origin-less root-relative path, which is not a valid URL *base* — so the first
relative `url()` threw and aborted mounting. The peer set also bloated the
bundle to ~43MB across ~150 async chunks.

## Fix

Replaced the heavy renderer with a lightweight one that ships **no CSS**:

- Removed deps: `streamdown`, `@streamdown/code`, `@streamdown/math`,
  `@streamdown/mermaid`, `katex`.
- Added: `react-markdown` + `remark-gfm` (no math/mermaid/syntax-highlighting).
- New `src/web/components/MarkdownView.tsx` renders Markdown and styles every
  element with host semantic tokens (no bespoke stylesheet, no relative URLs).
- Removed the `@import "@rome-os/ui/markdown.css"` line from `styles.css`.
- `DetailView` Summary tab now uses `MarkdownView`.

Mindmap (markmap via CDN) and Slides (sandboxed `iframe srcDoc`) were unaffected.

## Validation

- `pnpm typecheck`, `pnpm test` (40), `pnpm build` all pass.
- `dist/web` shrank from ~43MB to ~0.5MB (single `index.css` 78KB + `index.js`
  414KB, no async chunks).
- `grep` confirms `dist/web/index.css` has zero `url(...)` and zero `@import`.
- Re-installed and confirmed the Home view mounts with no "Failed to mount"
  error; Summary markdown renders from a sample string.
