// Lesson runtime — the self-contained script injected into the sandboxed lesson
// iframe (built as a classic IIFE so a null-origin sandbox can load it
// cross-origin without CORS; see rslib.config.ts). Plain TS/DOM, no React.
//
// On load it: injects its CSS, syntax-highlights code (Shiki), renders Mermaid
// diagrams, hydrates interactive components, and runs a postMessage bridge to
// the host (report content height so the host sizes the iframe with no inner
// scrollbar, receive theme updates, emit a "mark complete" event).

import { RUNTIME_CSS } from "./styles.js";
import { highlightAll } from "./highlight.js";
import { renderMermaid, setMermaidBundleUrl } from "./mermaid.js";
import { hydrateComponents, hydrateCopyButtons } from "./components.js";

// ── Host bridge protocol (kept in sync with App.tsx's LessonViewer) ──────────
const MSG = {
  ready: "teach:ready",
  height: "teach:height",
  complete: "teach:complete",
  theme: "teach:theme",
} as const;

interface ThemeMessage {
  type: typeof MSG.theme;
  cssText: string;
  dark: boolean;
}

// Capture this script's own URL while the IIFE executes synchronously
// (document.currentScript is only valid here, not later inside init()). The
// mermaid bundle is its sibling, fetched on demand by the mermaid loader.
const SELF_SRC =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : "";
if (SELF_SRC) {
  setMermaidBundleUrl(SELF_SRC.replace(/lesson-runtime\.js(\?[^/]*)?$/, "lesson-mermaid.js"));
}

function post(message: unknown): void {
  // Null-origin sandbox → target origin must be "*".
  window.parent?.postMessage(message, "*");
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

// ── Height reporting ─────────────────────────────────────────────────────────
let lastHeight = 0;
function reportHeight(): void {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height > 0 && height !== lastHeight) {
    lastHeight = height;
    post({ type: MSG.height, height });
  }
}

function injectCss(): void {
  // The host inlines this same CSS into the srcdoc (id="teach-runtime-css") so
  // the first paint is correctly styled before this script loads. Only inject
  // as a fallback if that static style is somehow absent.
  if (document.getElementById("teach-runtime-css")) return;
  const style = document.createElement("style");
  style.id = "teach-runtime-css";
  style.textContent = RUNTIME_CSS;
  document.head.appendChild(style);
}

function applyTheme(msg: ThemeMessage): void {
  let style = document.getElementById("teach-theme") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "teach-theme";
    document.head.appendChild(style);
  }
  style.textContent = `:root{${msg.cssText}}`;
  document.documentElement.classList.toggle("dark", msg.dark);
}

// ── Mark-complete affordance ─────────────────────────────────────────────────
// Optional in-lesson trigger for future use; the host chrome's "Mark complete"
// button remains the primary path. Any element with [data-teach-complete]
// emits the complete event when activated.
function wireComplete(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-teach-complete]").forEach((el) => {
    if (el.dataset.teachHydrated) return;
    el.dataset.teachHydrated = "1";
    el.addEventListener("click", () => post({ type: MSG.complete }));
  });
}

async function enhance(root: HTMLElement): Promise<void> {
  // Hydrate synchronous interactions first so the lesson is usable immediately.
  hydrateComponents(root);
  wireComplete(root);
  reportHeight();

  // Then the async, heavier passes. Highlight before adding copy buttons so the
  // buttons attach to the Shiki-rendered <pre> too.
  await highlightAll(root);
  await renderMermaid(root, isDark());
  hydrateCopyButtons(root);
  reportHeight();

  // Web fonts change line metrics (and therefore height) once they swap in.
  // Wait for them so the height we report just before "ready" is the final,
  // settled one — the host reveals the lesson on that signal.
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts API unavailable — ignore */
  }
  reportHeight();
}

let lessonRoot: HTMLElement | null = null;

function init(): void {
  injectCss();
  lessonRoot =
    document.getElementById("teach-lesson-root") ??
    (document.body as HTMLElement | null) ??
    null;
  if (!lessonRoot) return;

  // Keep the host iframe height pinned to content as images/fonts/diagrams land.
  const ro = new ResizeObserver(() => reportHeight());
  ro.observe(document.documentElement);
  window.addEventListener("load", reportHeight);

  // Receive theme updates from the host and re-render theme-sensitive content
  // (Mermaid) to match.
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (!data || typeof data !== "object") return;
    if (data.type === MSG.theme) {
      const wasDark = isDark();
      applyTheme(data as ThemeMessage);
      if (lessonRoot && (data as ThemeMessage).dark !== wasDark) {
        void renderMermaid(lessonRoot, isDark()).then(() => reportHeight());
      }
      reportHeight();
    }
  });

  void enhance(lessonRoot).then(() => post({ type: MSG.ready }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
