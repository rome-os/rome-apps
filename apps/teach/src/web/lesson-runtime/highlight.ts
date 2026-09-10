// Syntax highlighting with Shiki, using the JavaScript RegExp engine (NOT WASM)
// and fine-grained language/theme imports so everything is bundled into the
// single IIFE — no network fetch, no .wasm. Two themes are loaded for a
// light/dark dual-theme output driven by CSS variables (see RUNTIME_CSS); the
// `html.dark` class toggled by the bridge selects which palette paints.
//
// Phase-2 note: this module only RENDERS highlighted markup. Making code blocks
// runnable/editable later means swapping the rendered <pre> for an editor mount
// — the per-block discovery loop (`highlightAll`) is the seam to hook.

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";

import langTs from "shiki/langs/typescript.mjs";
import langTsx from "shiki/langs/tsx.mjs";
import langJs from "shiki/langs/javascript.mjs";
import langJsx from "shiki/langs/jsx.mjs";
import langJson from "shiki/langs/json.mjs";
import langBash from "shiki/langs/bash.mjs";
import langHtml from "shiki/langs/html.mjs";
import langCss from "shiki/langs/css.mjs";
import langPython from "shiki/langs/python.mjs";
import langSql from "shiki/langs/sql.mjs";
import langYaml from "shiki/langs/yaml.mjs";
import langDiff from "shiki/langs/diff.mjs";
import langMarkdown from "shiki/langs/markdown.mjs";

// Canonical Shiki language ids we ship, plus the aliases an author is likely to
// write in `class="language-…"`. Anything not here falls back to plaintext.
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",
  console: "bash",
  shellscript: "bash",
  html: "html",
  xml: "html",
  css: "css",
  py: "python",
  python: "python",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  diff: "diff",
  patch: "diff",
  md: "markdown",
  markdown: "markdown",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [
        langTs,
        langTsx,
        langJs,
        langJsx,
        langJson,
        langBash,
        langHtml,
        langCss,
        langPython,
        langSql,
        langYaml,
        langDiff,
        langMarkdown,
      ],
      // JS RegExp engine — avoids loading the Oniguruma WASM binary. `forgiving`
      // keeps a single unsupported grammar regex from throwing the whole render.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}

// Pull the language from a `language-xxx` / `lang-xxx` class.
function langFromClass(className: string): string | null {
  const m = /(?:language|lang)-([a-z0-9+#._-]+)/i.exec(className);
  return m ? m[1].toLowerCase() : null;
}

// Best-effort guess for legacy lessons whose <pre><code> carry no language
// class, so existing content still gets highlighted instead of staying flat.
function guessLang(code: string): string {
  const c = code.trim();
  if (/^#!.*\b(ba)?sh\b/.test(c) || /(^|\n)\s*(\$ |npm |pnpm |yarn |git |cd |sudo |curl |echo )/.test(c))
    return "bash";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(c)) return "sql";
  if (/^\s*[[{][\s\S]*"[^"]+"\s*:/.test(c)) return "json";
  if (/(^|\n)\s*(def |class |import |from \w+ import |print\()/.test(c) && !/[;{]/.test(c))
    return "python";
  if (/^\s*</.test(c) && /<\/[a-z]/i.test(c) && !/=>/.test(c)) return "html";
  if (/(^|\n)[-+] /.test(c) && /(^|\n)@@/.test(c)) return "diff";
  if (/\b(const|let|var|function|=>|interface|type |export |import .* from|async |await)\b/.test(c))
    return "typescript";
  return "typescript";
}

function resolveLang(rawCode: string, className: string): string {
  const declared = langFromClass(className);
  const key = declared ?? guessLang(rawCode);
  return LANG_ALIASES[key] ?? "text";
}

/**
 * Highlight every `<pre><code>` in `root` in place, replacing the original
 * <pre> with Shiki's dual-theme markup. Mermaid pre/code and already-processed
 * blocks are skipped. Resolves once all blocks are done so the caller can
 * re-measure height.
 */
export async function highlightAll(root: ParentNode): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code")).filter((code) => {
    const pre = code.parentElement;
    if (!pre) return false;
    if (pre.dataset.teachHighlighted) return false;
    // Leave Mermaid sources alone — they're rendered by the mermaid module.
    if (pre.classList.contains("mermaid") || code.classList.contains("mermaid")) return false;
    return true;
  });
  if (blocks.length === 0) return;

  let hl: HighlighterCore;
  try {
    hl = await getHighlighter();
  } catch {
    return; // Highlighter failed to init — leave plain <pre> as-is.
  }

  for (const code of blocks) {
    const pre = code.parentElement as HTMLElement | null;
    if (!pre) continue;
    const source = code.textContent ?? "";
    const lang = resolveLang(source, `${code.className} ${pre.className}`);
    let html: string;
    try {
      html = hl.codeToHtml(source, {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
    } catch {
      try {
        html = hl.codeToHtml(source, {
          lang: "text",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
      } catch {
        continue;
      }
    }
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    const next = tpl.content.firstElementChild as HTMLElement | null;
    if (!next) continue;
    next.dataset.teachHighlighted = "1";
    pre.replaceWith(next);
  }
}
