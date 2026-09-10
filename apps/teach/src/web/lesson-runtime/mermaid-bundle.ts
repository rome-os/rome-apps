// Mermaid bundle — the HEAVY half of the lesson runtime, split into its own
// IIFE file (dist/web/lesson-mermaid.js) so it is fetched ONLY when a lesson
// actually contains a diagram. The core runtime (lesson-runtime.js) detects
// `.mermaid` sources and injects this script from a sibling absolute URL, then
// calls `window.__teachMermaid.render(...)`. Keeping mermaid out of the core
// bundle drops the every-lesson payload from ~4.4 MB to the Shiki-only size.
//
// Built as a classic IIFE with asyncChunks disabled (see rslib.config.ts): the
// lesson iframe is a null-origin `allow-scripts` sandbox, so neither a module
// script nor a code-split chunk could be fetched — everything mermaid needs is
// inlined here and the global is assigned synchronously on load.

import DOMPurify from "dompurify";
import mermaid from "mermaid";

let renderSeq = 0;

// Normalise authored Mermaid into a stable wrapper:
//   <pre class="mermaid">…</pre>  or  <div class="mermaid">…</div>
// →  <div class="teach-mermaid" data-teach-mermaid-src="…">…</div>
// The original source is stashed so we can re-render on a host theme flip.
function collectTargets(root: ParentNode): HTMLElement[] {
  const raw = Array.from(
    root.querySelectorAll<HTMLElement>("pre.mermaid, div.mermaid, .teach-mermaid"),
  );
  const targets: HTMLElement[] = [];
  for (const el of raw) {
    if (el.classList.contains("teach-mermaid")) {
      targets.push(el);
      continue;
    }
    const src = (el.textContent ?? "").trim();
    if (!src) continue;
    const holder = document.createElement("div");
    holder.className = "teach-mermaid";
    holder.dataset.teachMermaidSrc = src;
    el.replaceWith(holder);
    targets.push(holder);
  }
  return targets;
}

async function render(root: ParentNode, dark: boolean): Promise<boolean> {
  const targets = collectTargets(root);
  if (targets.length === 0) return false;

  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: "inherit",
    flowchart: { htmlLabels: false },
  });

  for (const holder of targets) {
    const src = holder.dataset.teachMermaidSrc ?? holder.textContent ?? "";
    if (!src.trim()) continue;
    const id = `teach-mermaid-${renderSeq++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      holder.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      holder.removeAttribute("data-teach-error");
    } catch (err) {
      holder.setAttribute("data-teach-error", "1");
      holder.textContent = `Diagram failed to render: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }
  return true;
}

declare global {
  interface Window {
    __teachMermaid?: { render(root: ParentNode, dark: boolean): Promise<boolean> };
  }
}

// Assigned synchronously when this IIFE executes, so the core runtime's
// script.onload can rely on the global being present.
window.__teachMermaid = { render };
