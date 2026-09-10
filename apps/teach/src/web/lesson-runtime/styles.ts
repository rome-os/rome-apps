// All CSS for the lesson runtime, carried as a string so the single IIFE bundle
// is fully self-contained: the runtime injects this into the iframe document at
// init (no separate .css file to fetch). These rules used to live in
// src/web/styles.css under `.lesson-prose …`; they MOVED here so they apply
// INSIDE the sandboxed iframe. Painted only with the host theme tokens
// (forwarded onto :root by the bridge), so the lesson matches Rome's light/dark
// theme. Shiki dual-theme variables and Mermaid containers are styled here too.

export const RUNTIME_CSS = `
:root { color-scheme: light; }
html.dark { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  font-family: var(--font-sans, system-ui, sans-serif);
  /* No inner scrollbars — the host sizes the iframe to content height. */
  overflow: visible;
}

/* ── Lesson typography ──────────────────────────────────────────────────────
   The lesson body is self-contained HTML authored by the lesson-author agent.
   This restores readable document styling for the body container. */
.lesson-prose {
  color: var(--color-foreground);
  font-size: 1rem;
  line-height: 1.7;
  word-wrap: break-word;
}
.lesson-prose > :first-child { margin-top: 0; }
.lesson-prose > :last-child { margin-bottom: 0; }
.lesson-prose h1,
.lesson-prose h2,
.lesson-prose h3,
.lesson-prose h4 {
  color: var(--color-foreground);
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.4em;
  margin-bottom: 0.5em;
}
.lesson-prose h1 { font-size: 1.5rem; }
.lesson-prose h2 { font-size: 1.25rem; }
.lesson-prose h3 { font-size: 1.1rem; }
.lesson-prose h4 { font-size: 1rem; }
.lesson-prose p { margin: 0.75em 0; }
.lesson-prose ul,
.lesson-prose ol { margin: 0.75em 0; padding-left: 1.5rem; }
.lesson-prose ul { list-style: disc; }
.lesson-prose ol { list-style: decimal; }
.lesson-prose li { margin: 0.3em 0; }
.lesson-prose a { color: var(--color-brand); text-decoration: underline; }
.lesson-prose strong { font-weight: 600; }
.lesson-prose em { font-style: italic; }
.lesson-prose hr { border: none; border-top: 1px solid var(--color-border); margin: 1.4em 0; }
.lesson-prose img { max-width: 100%; height: auto; }
.lesson-prose code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875em;
  background: var(--color-surface-muted);
  padding: 0.1em 0.35em;
  border-radius: var(--radius-sm, 4px);
}
.lesson-prose pre {
  background: var(--color-surface-muted);
  color: var(--color-surface-muted-foreground);
  padding: 0.9rem 1rem;
  border-radius: var(--radius-md, 8px);
  overflow-x: auto;
  margin: 0.9em 0;
  border: 1px solid var(--color-border);
  position: relative;
  font-size: 0.875rem;
  line-height: 1.55;
}
.lesson-prose pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  white-space: pre;
}
.lesson-prose blockquote {
  border-left: 3px solid var(--color-border-strong);
  padding-left: 1rem;
  color: var(--color-muted-foreground);
  margin: 0.9em 0;
}
.lesson-prose table { border-collapse: collapse; margin: 0.9em 0; width: 100%; }
.lesson-prose th,
.lesson-prose td { border: 1px solid var(--color-border); padding: 0.4rem 0.6rem; text-align: left; }
.lesson-prose th { background: var(--color-surface-muted); font-weight: 600; }

/* ── Shiki syntax highlighting (dual theme via CSS variables) ────────────────
   codeToHtml is called with defaultColor:false, so each token carries
   --shiki-light / --shiki-dark. We pick which to paint by the html.dark class
   the bridge toggles to follow the host theme. */
.lesson-prose pre.shiki {
  color: var(--shiki-light);
  background: var(--shiki-light-bg) !important;
}
.lesson-prose pre.shiki span { color: var(--shiki-light); }
html.dark .lesson-prose pre.shiki {
  color: var(--shiki-dark);
  background: var(--shiki-dark-bg) !important;
}
html.dark .lesson-prose pre.shiki span { color: var(--shiki-dark) !important; }

/* ── Code copy button ───────────────────────────────────────────────────────*/
.lesson-prose .teach-copy {
  position: absolute;
  top: 0.45rem;
  right: 0.45rem;
  font-size: 0.72rem;
  padding: 0.12rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-card);
  color: var(--color-muted-foreground);
  cursor: pointer;
  opacity: 0.7;
  z-index: 2;
}
.lesson-prose .teach-copy:hover { opacity: 1; }

/* ── Callout / tip box ──────────────────────────────────────────────────────*/
.lesson-prose .teach-callout {
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-brand);
  background: var(--color-surface-muted);
  border-radius: var(--radius-md, 8px);
  padding: 0.75rem 1rem;
  margin: 1.1em 0;
}
.lesson-prose .teach-callout-title { font-weight: 600; margin-bottom: 0.25rem; }
.lesson-prose .teach-callout > :first-child { margin-top: 0; }
.lesson-prose .teach-callout > :last-child { margin-bottom: 0; }

/* ── Collapsible deep-dive (native <details>) ───────────────────────────────*/
.lesson-prose details.teach-collapse {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  padding: 0.6rem 0.95rem;
  margin: 1.1em 0;
  background: var(--color-card);
}
.lesson-prose details.teach-collapse > summary {
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}
.lesson-prose details.teach-collapse > summary::-webkit-details-marker { display: none; }
.lesson-prose details.teach-collapse > summary::before { content: "▸ "; color: var(--color-brand); }
.lesson-prose details.teach-collapse[open] > summary::before { content: "▾ "; }
.lesson-prose details.teach-collapse[open] > summary { margin-bottom: 0.5rem; }

/* ── Inline check-your-understanding quiz ───────────────────────────────────*/
.lesson-prose .teach-quiz {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  padding: 0.9rem 1rem;
  margin: 1.1em 0;
  background: var(--color-card);
}
.lesson-prose .teach-q { font-weight: 600; margin: 0 0 0.6rem; }
.lesson-prose .teach-opts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.lesson-prose .teach-opts > li {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.lesson-prose .teach-opts > li:hover { background: var(--color-surface-hover); }
.lesson-prose .teach-opts > li.is-correct {
  border-color: var(--color-success-border);
  background: var(--color-success-bg);
  color: var(--color-success-fg);
}
.lesson-prose .teach-opts > li.is-wrong.is-chosen {
  border-color: var(--color-destructive-border);
  background: var(--color-destructive-bg);
  color: var(--color-destructive-fg);
}
.lesson-prose .teach-explain {
  margin-top: 0.7rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--color-border);
  font-size: 0.925em;
  color: var(--color-muted-foreground);
}

/* ── Flip / reveal card ─────────────────────────────────────────────────────*/
.lesson-prose .teach-flip {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  padding: 0.9rem 1rem;
  margin: 1.1em 0;
  background: var(--color-card);
  cursor: pointer;
}
.lesson-prose .teach-front { font-weight: 600; }
.lesson-prose .teach-back { margin-top: 0.5rem; }
.lesson-prose .teach-flip-hint {
  margin-top: 0.5rem;
  font-size: 0.75em;
  color: var(--color-brand);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ── Tabs ───────────────────────────────────────────────────────────────────*/
.lesson-prose .teach-tabs {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  margin: 1.1em 0;
  background: var(--color-card);
  overflow: hidden;
}
.lesson-prose .teach-tablist {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.4rem 0.4rem 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}
.lesson-prose .teach-tab {
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--color-muted-foreground);
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  border-radius: var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0;
}
.lesson-prose .teach-tab:hover { color: var(--color-foreground); }
.lesson-prose .teach-tab.is-active {
  background: var(--color-card);
  color: var(--color-foreground);
  border-color: var(--color-border);
}
.lesson-prose .teach-tabpanels { padding: 0.4rem 1rem; }
.lesson-prose .teach-tabpanel { display: none; }
.lesson-prose .teach-tabpanel.is-active { display: block; }
.lesson-prose .teach-tabpanel > :first-child { margin-top: 0.4rem; }

/* ── Step-by-step / stepper (CSS counter, no JS) ────────────────────────────*/
.lesson-prose .teach-stepper { counter-reset: teach-step; margin: 1.1em 0; }
.lesson-prose .teach-step {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  background: var(--color-card);
  padding: 0.75rem 1rem 0.75rem 3rem;
  margin: 0.5rem 0;
}
.lesson-prose .teach-step::before {
  counter-increment: teach-step;
  content: counter(teach-step);
  position: absolute;
  left: 0.75rem;
  top: 0.75rem;
  width: 1.5rem;
  height: 1.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-brand);
  color: var(--color-brand-foreground, #fff);
  font-size: 0.8rem;
  font-weight: 700;
}
.lesson-prose .teach-step-title { font-weight: 600; margin-bottom: 0.25rem; }
.lesson-prose .teach-step > :first-child { margin-top: 0; }
.lesson-prose .teach-step > :last-child { margin-bottom: 0; }

/* ── Annotated code (code + numbered notes) ─────────────────────────────────*/
.lesson-prose .teach-annotated {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  margin: 1.1em 0;
  overflow: hidden;
}
.lesson-prose .teach-annotated > pre { margin: 0; border: none; border-radius: 0; }
.lesson-prose .teach-annotations {
  counter-reset: teach-note;
  list-style: none;
  margin: 0;
  padding: 0.6rem 1rem 0.6rem 1rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: 0.925em;
}
.lesson-prose .teach-annotations > li {
  position: relative;
  padding-left: 1.9rem;
  margin: 0.4rem 0;
  color: var(--color-foreground);
}
.lesson-prose .teach-annotations > li::before {
  counter-increment: teach-note;
  content: counter(teach-note);
  position: absolute;
  left: 0;
  top: 0.05rem;
  width: 1.35rem;
  height: 1.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-secondary);
  color: var(--color-secondary-foreground);
  font-size: 0.72rem;
  font-weight: 700;
}

/* ── Mermaid diagrams ───────────────────────────────────────────────────────*/
.lesson-prose .teach-mermaid {
  margin: 1.1em 0;
  text-align: center;
  overflow-x: auto;
}
.lesson-prose .teach-mermaid svg { max-width: 100%; height: auto; }
.lesson-prose .teach-mermaid[data-teach-error] {
  border: 1px solid var(--color-destructive-border);
  background: var(--color-destructive-bg);
  color: var(--color-destructive-fg);
  border-radius: var(--radius-md, 8px);
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.9rem;
}
`;
