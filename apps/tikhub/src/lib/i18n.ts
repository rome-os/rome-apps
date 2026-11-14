/**
 * Pure text helpers shared by backend and web UI:
 * - `pickSlash`: pick one half of TikHub's upstream "中文/English" doc strings.
 * - `legacyPick`: pick one language out of call-log text written before
 *   structured messages existed ("中文\nEnglish", or "中文 / English — 中文 / English").
 * New code must not produce bilingual text — use src/lib/messages.ts.
 */
export type { Lang } from "./messages.js";
import type { Lang } from "./messages.js";

const HAS_CJK = /[\u3400-\u9fff]/;

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Pick one line of a `bi()` message ("中文\nEnglish"). Other shapes pass through unchanged. */
export function pickBi(text: string | null | undefined, lang: Lang): string {
  if (!text) return "";
  const nl = text.indexOf("\n");
  if (nl < 0) return text;
  const first = text.slice(0, nl);
  const rest = text.slice(nl + 1);
  if (!HAS_CJK.test(first) || !rest.trim()) return text;
  return lang === "zh" ? first : rest;
}

/**
 * TikHub docs write "获取用户笔记列表/Get user posted notes", and either half may
 * itself contain "/". The boundary is the first "/" after the last CJK character;
 * the right side must be Latin text. Anything else is returned unchanged.
 */
export function pickSlash(text: string | null | undefined, lang: Lang): string {
  if (!text) return "";
  let lastCjk = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (HAS_CJK.test(text[i]!)) {
      lastCjk = i;
      break;
    }
  }
  if (lastCjk < 0) return text;
  const choose = (slash: number): string | null => {
    const left = text.slice(0, slash).trim();
    const right = text.slice(slash + 1).trim();
    return left && HAS_CJK.test(left) && /[A-Za-z]/.test(right) ? (lang === "zh" ? left : right) : null;
  };
  // 1) Strict: English half is CJK-free.
  const strict = text.indexOf("/", lastCjk + 1);
  if (strict >= 0) {
    const hit = choose(strict);
    if (hit !== null) return hit;
  }
  // 2) Fallback: English half carries CJK annotations, e.g. "渠道/Channel: lite(极速版)".
  for (let i = text.indexOf("/"); i >= 0; i = text.indexOf("/", i + 1)) {
    if (/^\s*[A-Za-z]/.test(text.slice(i + 1))) {
      const hit = choose(i);
      if (hit !== null) return hit;
    }
  }
  return text;
}

/** Legacy call-log text → one language. */
export function legacyPick(text: string, lang: Lang): string {
  if (text.includes("\n")) return pickBi(text, lang);
  if (!HAS_CJK.test(text)) return text;
  return text
    .split(" — ")
    .map((seg) => {
      const i = seg.indexOf(" / ");
      if (i <= 0) return seg;
      const left = seg.slice(0, i).trim();
      const right = seg.slice(i + 3).trim();
      if (!HAS_CJK.test(left) || !right) return seg;
      return lang === "zh" ? left : right;
    })
    .join(" — ");
}
