// Mermaid loader (lightweight, no mermaid import). The heavy mermaid code lives
// in a SEPARATE bundle (lesson-mermaid.js); this module fetches it on demand —
// only when a lesson actually contains a diagram — by injecting a classic
// <script> from a sibling absolute URL, then delegates to the global the bundle
// installs (window.__teachMermaid). This keeps every-lesson payload to the
// Shiki-only core; lessons without diagrams never download mermaid at all.

let bundleUrl = "";
let loadPromise: Promise<void> | null = null;

/** Called once by the core runtime with the absolute URL of lesson-mermaid.js. */
export function setMermaidBundleUrl(url: string): void {
  bundleUrl = url;
}

function hasMermaidSource(root: ParentNode): boolean {
  return !!root.querySelector("pre.mermaid, div.mermaid, .teach-mermaid");
}

function loadBundle(): Promise<void> {
  if (window.__teachMermaid) return Promise.resolve();
  if (loadPromise) return loadPromise;
  if (!bundleUrl) return Promise.reject(new Error("mermaid bundle url not set"));
  loadPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = bundleUrl;
    s.async = true;
    s.onload = () => {
      // The bundle assigns window.__teachMermaid synchronously on execution.
      if (window.__teachMermaid) resolve();
      else reject(new Error("mermaid bundle loaded but global missing"));
    };
    s.onerror = () => reject(new Error("failed to load mermaid bundle"));
    document.head.appendChild(s);
  });
  // Allow a later retry if this attempt failed.
  loadPromise.catch(() => {
    loadPromise = null;
  });
  return loadPromise;
}

/**
 * Render (or re-render) every Mermaid diagram under `root` for the given theme.
 * Returns true if at least one diagram was processed (so the caller can
 * re-measure height after the async work). Loads the mermaid bundle on first
 * use; no-ops (and downloads nothing) when there are no diagrams.
 */
export async function renderMermaid(root: ParentNode, dark: boolean): Promise<boolean> {
  if (!window.__teachMermaid && !hasMermaidSource(root)) return false;
  try {
    await loadBundle();
  } catch {
    return false;
  }
  return window.__teachMermaid!.render(root, dark);
}
