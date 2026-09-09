import { SLIDE_STYLE_OPTIONS } from "./shared.js";

/**
 * Slide-deck generation, inspired by the "frontend-slides" skill
 * (github.com/zarazhangrui/frontend-slides) plus theme palettes from the
 * guizang / html-ppt skills.
 *
 * Design decisions that make the decks look good AND render reliably:
 *  - The APP owns the deck "shell": a fixed 1920x1080 stage that scales as a
 *    whole to the viewport (never reflows), the slide-switching CSS, the
 *    staggered reveal animation, and a JS controller with keyboard / wheel /
 *    touch navigation and a page counter. This guarantees working navigation
 *    regardless of what the model emits.
 *  - The MODEL authors only the creative parts: a Google-Fonts <link>, the
 *    theme CSS (`:root` variables + slide look), and the `<section class="slide">`
 *    content — one idea per slide, strong hierarchy, in the video's language.
 *  - We parse the model output on `@@FONTS@@ / @@THEME@@ / @@SLIDES@@` markers
 *    and assemble the final document ourselves, with a legacy fallback for a
 *    full HTML document.
 */

/** Mandatory fixed-16:9 stage CSS (from frontend-slides viewport-base.css). */
const BASE_STAGE_CSS = `
/* === FIXED 16:9 STAGE (mandatory) === */
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: var(--stage-bg, #0a0a0a); }
.deck-viewport { position: fixed; inset: 0; overflow: hidden; background: var(--stage-bg, #0a0a0a); }
.deck-stage {
  position: absolute; left: 0; top: 0; width: 1920px; height: 1080px;
  overflow: hidden; transform-origin: 0 0; background: var(--slide-bg, #fff);
}
/* Positioning invariants use !important so a theme's own .slide rule (e.g.
   position:relative) cannot break the absolute-overlay stacking. */
.slide {
  position: absolute !important; inset: 0 !important; left: 0 !important; top: 0 !important;
  width: 1920px !important; height: 1080px !important; overflow: hidden;
  visibility: hidden; opacity: 0; pointer-events: none;
  transition: opacity .5s ease; background: var(--slide-bg, #fff);
}
.slide.active, .slide.visible { visibility: visible !important; opacity: 1 !important; pointer-events: auto; z-index: 1; }
img, video, canvas, svg { max-width: 100%; max-height: 100%; }

/* === STAGGERED REVEAL (children with class "reveal" animate in) === */
.reveal { opacity: 0; transform: translateY(30px); transition: opacity .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1); }
.slide.visible .reveal { opacity: 1; transform: translateY(0); }
.slide.visible .reveal:nth-child(1) { transition-delay: .08s; }
.slide.visible .reveal:nth-child(2) { transition-delay: .18s; }
.slide.visible .reveal:nth-child(3) { transition-delay: .28s; }
.slide.visible .reveal:nth-child(4) { transition-delay: .38s; }
.slide.visible .reveal:nth-child(5) { transition-delay: .48s; }
.slide.visible .reveal:nth-child(6) { transition-delay: .58s; }

/* === DECK CHROME (outside the design system) === */
.deck-counter {
  position: fixed; right: 20px; bottom: 16px; z-index: 1000;
  font: 600 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgba(255,255,255,.55); background: rgba(0,0,0,.35);
  padding: 6px 10px; border-radius: 999px; letter-spacing: .04em;
  backdrop-filter: blur(6px);
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .2s !important; }
}
`;

/**
 * Deck controller. Written with string concatenation (no backticks / ${}) so it
 * can live safely inside a TS template literal. Injected verbatim into the deck.
 */
const CONTROLLER_JS = [
  "(function(){",
  "  var stage = document.getElementById('deckStage');",
  "  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));",
  "  var counter = document.getElementById('deckCounter');",
  "  var i = 0;",
  "  function scale(){",
  "    var f = Math.min(window.innerWidth/1920, window.innerHeight/1080);",
  "    var x = (window.innerWidth - 1920*f)/2;",
  "    var y = (window.innerHeight - 1080*f)/2;",
  "    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + f + ')';",
  "  }",
  "  function show(n){",
  "    i = Math.max(0, Math.min(n, slides.length-1));",
  "    for (var k=0;k<slides.length;k++){",
  "      var on = k===i;",
  "      slides[k].classList.toggle('active', on);",
  "      slides[k].classList.toggle('visible', on);",
  "    }",
  "    if (counter) counter.textContent = (i+1) + ' / ' + slides.length;",
  "  }",
  "  function next(){ show(i+1); } function prev(){ show(i-1); }",
  "  window.addEventListener('resize', scale);",
  "  document.addEventListener('keydown', function(e){",
  "    var k = e.key;",
  "    if (k==='ArrowRight'||k==='ArrowDown'||k===' '||k==='PageDown'||k==='l'){ e.preventDefault(); next(); }",
  "    else if (k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='k'){ e.preventDefault(); prev(); }",
  "    else if (k==='Home'){ show(0); } else if (k==='End'){ show(slides.length-1); }",
  "  });",
  "  var wheelLock=false;",
  "  window.addEventListener('wheel', function(e){",
  "    if (wheelLock) return; if (Math.abs(e.deltaY) < 20) return;",
  "    wheelLock=true; setTimeout(function(){ wheelLock=false; }, 700);",
  "    if (e.deltaY>0) next(); else prev();",
  "  }, { passive: true });",
  "  var tx=0, ty=0;",
  "  window.addEventListener('touchstart', function(e){ tx=e.changedTouches[0].clientX; ty=e.changedTouches[0].clientY; }, { passive: true });",
  "  window.addEventListener('touchend', function(e){",
  "    var dx=e.changedTouches[0].clientX - tx, dy=e.changedTouches[0].clientY - ty;",
  "    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50){ if (dx<0) next(); else prev(); }",
  "    else if (Math.abs(dy) > 50){ if (dy<0) next(); else prev(); }",
  "  }, { passive: true });",
  "  scale(); show(0);",
  "})();",
].join("\n");

/** Curated presets (fonts + palette) synthesized from the four slide skills. */
export interface SlidePreset {
  id: string;
  name: string;
  guide: string;
}

export const SLIDE_PRESETS: SlidePreset[] = [
  {
    id: "bold-signal",
    name: "Bold Signal",
    guide:
      'dark & high-impact: display Archivo Black; body Space Grotesk; --stage-bg #101014, --slide-bg #16161c, text #ffffff, accent #FF5722. Big section numbers 01/02, a vivid accent card as focal point.',
  },
  {
    id: "electric-studio",
    name: "Electric Studio",
    guide:
      'clean & corporate: display & body Manrope (800/500); --slide-bg #ffffff, text #0a0a0a, accent #4361ee. Two-panel splits, an accent edge bar, confident spacing.',
  },
  {
    id: "dark-botanical",
    name: "Dark Botanical",
    guide:
      'elegant & premium: display Cormorant (serif, 600); body IBM Plex Sans; --slide-bg #0f0f0f, text #e8e4df, accents #d4a574 / #e8b4b8. Soft blurred gradient circles in a corner.',
  },
  {
    id: "ink-editorial",
    name: "Ink Editorial",
    guide:
      'magazine & calm: display Playfair Display; body Newsreader; --slide-bg #f1efea (warm cream), ink #0a0a0b, subtle rule lines, drop caps, generous margins.',
  },
  {
    id: "indigo-porcelain",
    name: "Indigo Porcelain",
    guide:
      'technical & cool: display Space Grotesk; body Inter Tight; --slide-bg #f1f3f5, ink #0a1f3d (deep indigo), thin borders, small-caps labels, tidy grids.',
  },
  {
    id: "neon-cyber",
    name: "Neon Cyber",
    guide:
      'energetic: display Syne (800); mono Space Mono; --stage-bg #0b0b12, --slide-bg #12121c, text #ffffff, accent #d4ff00 on #0066ff. Halftone/grid texture, neon badges.',
  },
  {
    id: "swiss-grid",
    name: "Swiss Grid",
    guide:
      'serious typography: display & body Space Grotesk / Helvetica-feel; --slide-bg #ffffff, ink #111, one red accent #e5322d, strict left-aligned grid, big numerals.',
  },
];

/** Style options exposed to the UI: "auto" (random each run) plus each preset. */
const SLIDE_STYLE_IDS = new Set(SLIDE_STYLE_OPTIONS.map((o) => o.id));

/** Normalize an incoming style value; unknown/empty falls back to "auto". */
export function normalizeSlideStyle(input: unknown): string {
  return typeof input === "string" && SLIDE_STYLE_IDS.has(input) ? input : "auto";
}

/** Resolve a style id to a concrete preset. "auto" picks a random one for variety. */
function resolvePreset(style: string): SlidePreset {
  if (style !== "auto") {
    const found = SLIDE_PRESETS.find((p) => p.id === style);
    if (found) return found;
  }
  return SLIDE_PRESETS[Math.floor(Math.random() * SLIDE_PRESETS.length)];
}

interface SlidesPromptContext {
  title: string | null;
  transcript: string;
  truncated: boolean;
  condensed?: boolean;
  languageRule: string;
  style?: string;
}

export function buildSlidesPrompt(ctx: SlidesPromptContext): string {
  const preset = resolvePreset(normalizeSlideStyle(ctx.style));
  const presetGuide = `Use THIS visual style for the whole deck — "${preset.name}" (${preset.guide})
Commit to it fully and consistently. You may tune exact shades for legibility, but keep its font
choices, palette character, and layout personality. Load fonts via a Google Fonts <link>. Never use
system fonts (Arial/Inter/Roboto unless named above) or purple-gradient-on-white cliches.`;
  const notes =
    (ctx.condensed
      ? "NOTE: This is a CONDENSED outline of a long video assembled from ordered parts — cover the ENTIRE arc across all sections, not just the beginning.\n"
      : "") +
    (ctx.truncated
      ? "NOTE: the transcript was truncated to fit the length limit; work from the portion provided.\n"
      : "");
  return [
    `Video title: ${ctx.title ?? "(unknown)"}`,
    notes,
    ctx.languageRule,
    "",
    "Transcript:",
    "-----",
    ctx.transcript,
    "-----",
    "",
    "TASK: Design a beautiful, presentation-grade slide deck that teaches this video's key ideas.",
    "You are authoring ONLY the creative layer — the app supplies the fixed 16:9 stage, slide",
    "switching, animations, and navigation. Do NOT write <html>, <head>, <body>, the stage CSS,",
    "or any JavaScript. Output EXACTLY these three sections, in this order, using these literal markers:",
    "",
    "@@FONTS@@",
    "(one or two <link> tags loading your chosen Google Fonts — nothing else)",
    "@@THEME@@",
    "(a block of CSS: first a :root {} that sets --stage-bg, --slide-bg, text and accent colors and",
    " font variables, then the styles for your slide layouts/typography. Author everything at the",
    " 1920x1080 stage size in px. Use classes you reference in the slides below. Add atmosphere:",
    " gradients, shapes, rules, or texture via CSS — not flat solid color. Keep strong hierarchy.",
    " Do NOT set position, inset, left, top, width, or height on the .slide element itself — the",
    " app controls those. Style .slide only for look (background, padding, display/flex, color).)",
    "@@SLIDES@@",
    "(the slides: a sequence of <section class=\"slide\"> ... </section> elements, no wrapper.)",
    "",
    "DESIGN RULES:",
    presetGuide,
    "",
    "CONTENT RULES:",
    "- Start with a title slide (video title + a one-line framing). End with a short takeaways/closing slide.",
    "- In between, 6-12 slides, ONE idea per slide: a clear heading + at most 3-5 short bullets or a single",
    "  strong statement. Prefer phrases over sentences. Split dense ideas across more slides; never overflow.",
    "- Everything must fit inside the 1920x1080 slide with comfortable margins (~72px). No scrolling, no overlap.",
    "- Wrap each animatable element (heading, each bullet, image) in class=\"reveal\" so it staggers in.",
    "- Be faithful to the transcript; do not invent facts.",
    "- Write ALL slide text in the transcript's language (see LANGUAGE above).",
    "",
    "Output ONLY the three marked sections. No commentary, no ``` code fences.",
  ].join("\n");
}

interface ParsedDeck {
  fonts: string;
  theme: string;
  slides: string;
}

function parseSections(raw: string): ParsedDeck | null {
  const fontsIdx = raw.indexOf("@@FONTS@@");
  const themeIdx = raw.indexOf("@@THEME@@");
  const slidesIdx = raw.indexOf("@@SLIDES@@");
  if (themeIdx === -1 || slidesIdx === -1 || slidesIdx < themeIdx) return null;
  const fonts =
    fontsIdx !== -1 && fontsIdx < themeIdx
      ? raw.slice(fontsIdx + "@@FONTS@@".length, themeIdx)
      : "";
  const theme = raw.slice(themeIdx + "@@THEME@@".length, slidesIdx);
  let slides = raw.slice(slidesIdx + "@@SLIDES@@".length);
  // Defensive: strip stray code fences the model may have added.
  const clean = (s: string) => s.replace(/^```[a-zA-Z]*\s*/gm, "").replace(/```/g, "").trim();
  return { fonts: clean(fonts), theme: clean(theme), slides: clean(slides) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Assemble the final self-contained deck HTML from the model output. Falls back
 * to returning a full HTML document unchanged (legacy path), or wrapping bare
 * <section> markup when the markers are missing.
 */
export function assembleSlidesHtml(raw: string, title: string | null): string {
  const trimmed = raw.trim();
  const parsed = parseSections(trimmed);

  let fonts = "";
  let theme = "";
  let slides = "";

  if (parsed && /<section[\s>]/i.test(parsed.slides)) {
    fonts = parsed.fonts;
    theme = parsed.theme;
    slides = parsed.slides;
  } else if (/<!doctype html|<html[\s>]/i.test(trimmed)) {
    // Legacy: model returned a whole document. Trust it as-is.
    return trimmed;
  } else if (/<section[\s>]/i.test(trimmed)) {
    // Bare slides, no theme — still render on the stage with sensible defaults.
    slides = trimmed;
  } else {
    // Last resort: wrap plain text as a single slide so nothing crashes.
    slides = `<section class="slide"><div style="padding:72px"><pre class="reveal" style="white-space:pre-wrap;font:400 28px/1.5 system-ui">${esc(
      trimmed,
    )}</pre></div></section>`;
  }

  const safeTitle = esc(title ?? "Slides");
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${safeTitle}</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    fonts,
    "<style>",
    BASE_STAGE_CSS,
    "/* === THEME (model-authored) === */",
    theme,
    "</style>",
    "</head>",
    "<body>",
    '<div class="deck-viewport">',
    '<main class="deck-stage" id="deckStage">',
    slides,
    "</main>",
    '<div class="deck-counter" id="deckCounter"></div>',
    "</div>",
    `<script>${CONTROLLER_JS}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
