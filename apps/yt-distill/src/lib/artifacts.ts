import type { ArtifactType } from "../db/repositories/distillations.js";
import { buildSlidesPrompt } from "./slides.js";

export const ARTIFACT_TYPES: ArtifactType[] = ["mindmap", "summary", "slides"];

export const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  mindmap: "Mindmap",
  summary: "Summary",
  slides: "Slides",
};

/** Keep only valid, de-duplicated artifact types, preserving canonical order. */
export function normalizeTypes(input: unknown): ArtifactType[] {
  const set = new Set<ArtifactType>();
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item === "mindmap" || item === "summary" || item === "slides") set.add(item);
    }
  }
  return ARTIFACT_TYPES.filter((t) => set.has(t));
}

/** Longest transcript we hand to the model directly (chars). Videos over this
 *  are condensed via a chunked map-reduce first so the WHOLE video is covered,
 *  not just the opening. ~120k chars ≈ ~30k tokens — safe for large contexts. */
export const TRANSCRIPT_LIMIT = 120_000;

export interface TruncatedTranscript {
  text: string;
  truncated: boolean;
}

export function truncateTranscript(transcript: string, limit = TRANSCRIPT_LIMIT): TruncatedTranscript {
  if (transcript.length <= limit) return { text: transcript, truncated: false };
  return { text: transcript.slice(0, limit), truncated: true };
}

/**
 * Defensively strip a leading/trailing Markdown code fence the model may have
 * wrapped the artifact in (```markdown ... ``` or ```html ... ```), so we store
 * the raw artifact content rather than a fenced block.
 */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();
  const fenceOpen = /^```[^\n]*\n/;
  const fenceClose = /\n```$/;
  if (fenceOpen.test(text) && fenceClose.test(text)) {
    text = text.replace(fenceOpen, "").replace(fenceClose, "").trim();
  }
  return text;
}

/**
 * Best-effort language detection from the transcript so we can give the model
 * an EXPLICIT target language rather than relying on it to "detect" one (which
 * drifted, e.g. producing Spanish for an English video). Script-based checks
 * cover CJK / Cyrillic / Arabic / Hangul confidently; a small stop-word vote
 * disambiguates the common Latin-script languages.
 */
export function detectLanguage(transcript: string): string | null {
  const sample = transcript.slice(0, 4000);
  if (!sample.trim()) return null;

  const count = (re: RegExp) => (sample.match(re) || []).length;
  if (count(/[\u3040-\u309f\u30a0-\u30ff]/g) > 5) return "Japanese";
  if (count(/[\uac00-\ud7af]/g) > 5) return "Korean";
  if (count(/[\u4e00-\u9fff]/g) > 5) return "Chinese";
  if (count(/[\u0400-\u04ff]/g) > 5) return "Russian";
  if (count(/[\u0600-\u06ff]/g) > 5) return "Arabic";

  const words = sample.toLowerCase().match(/[a-zà-ÿ']+/g) || [];
  if (words.length < 8) return null;
  const stop: Record<string, string[]> = {
    English: ["the", "and", "is", "to", "of", "that", "you", "it", "in", "this", "we", "are"],
    Spanish: ["el", "la", "que", "de", "y", "en", "los", "las", "un", "una", "es", "por", "para"],
    French: ["le", "la", "les", "des", "et", "que", "est", "un", "une", "pour", "dans", "vous"],
    German: ["der", "die", "das", "und", "ist", "ein", "eine", "nicht", "mit", "auf", "wir", "sie"],
    Portuguese: ["que", "de", "não", "uma", "para", "com", "os", "as", "um", "por", "está", "você"],
    Italian: ["il", "la", "che", "di", "un", "una", "per", "non", "con", "sono", "questo", "gli"],
  };
  const set = new Set(words);
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(stop)) {
    const score = list.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return bestScore >= 3 ? best : null;
}

function languageRule(transcript: string): string {
  const lang = detectLanguage(transcript);
  if (lang) {
    return (
      `LANGUAGE: Write the ENTIRE output in ${lang} — the language of the transcript. ` +
      `Every heading, bullet, sentence, and slide must be in ${lang}. Never translate or switch to another language.`
    );
  }
  return (
    "LANGUAGE: Write the ENTIRE output in the EXACT SAME language as the transcript above. " +
    "Match the transcript's language word-for-word; never translate or switch languages."
  );
}

interface PromptContext {
  title: string | null;
  transcript: string;
  truncated: boolean;
  condensed?: boolean;
  slideStyle?: string;
}

function header({ title, truncated, condensed }: PromptContext): string {
  const lines = [`Video title: ${title ?? "(unknown)"}`];
  if (condensed) {
    lines.push(
      "NOTE: This is a CONDENSED outline of a long video, assembled from ordered parts that each cover a segment of the full talk. Cover the ENTIRE arc — every part/section — not just the beginning.",
    );
  }
  if (truncated) {
    lines.push(
      "NOTE: The transcript below was truncated to fit the length limit; work from the portion provided.",
    );
  }
  return lines.join("\n");
}

export function buildPrompt(type: ArtifactType, ctx: PromptContext): string {
  const common = [
    header(ctx),
    "",
    languageRule(ctx.transcript),
    "",
    "Transcript:",
    "-----",
    ctx.transcript,
    "-----",
    "",
  ];

  if (type === "mindmap") {
    return [
      ...common,
      "TASK: Produce a hierarchical mind map of this video as markmap-flavored Markdown.",
      "Rules:",
      "- Use a SINGLE top-level heading (# ) as the root — the video's topic.",
      "- Use nested headings (##, ###) and bullet lists (-) for branches and leaves.",
      "- Keep node labels short and scannable; group related ideas.",
      "- Write every node in the transcript's language (see LANGUAGE above).",
      "- Output ONLY the raw Markdown. No commentary, no surrounding ``` code fences.",
    ].join("\n");
  }

  if (type === "summary") {
    return [
      ...common,
      "TASK: Produce a concise, well-structured summary as clean Markdown.",
      "Rules:",
      "- Start with a 1-2 sentence overview.",
      "- Then a bulleted list of the key points; each bullet is a bold takeaway followed by a one-line explanation.",
      "- Be faithful to the transcript; do not invent facts.",
      "- Write the overview and every bullet in the transcript's language (see LANGUAGE above).",
      "- Output ONLY the raw Markdown. No commentary, no surrounding ``` code fences.",
    ].join("\n");
  }

  // slides — delegate to the design-rich, fixed-stage deck builder.
  return buildSlidesPrompt({
    title: ctx.title,
    transcript: ctx.transcript,
    truncated: ctx.truncated,
    condensed: ctx.condensed,
    languageRule: languageRule(ctx.transcript),
    style: ctx.slideStyle,
  });
}
