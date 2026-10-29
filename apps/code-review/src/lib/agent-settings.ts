/** Only the five shipped agents. Existing review flags, phrases and lens opt-ins
 * stay in their original columns; this stores only previously missing controls. */
export interface ReviewerTriggers {
  onCreate: boolean;
  onPush: boolean;
  onReviewRequest: boolean;
  onMention: boolean;
  phrase: string;
}
export const AGENT_IDS = ["assistant", "review", "security", "designAlternatives", "summary"] as const;
export type AgentId = typeof AGENT_IDS[number];
export interface AgentSettings {
  reviewEnabled: boolean;
  /** The one agent that answers `@bot …` comments matching no agent's phrase. */
  catchAll: AgentId | null;
  assistant: { enabled: boolean; onMention: boolean; phrase: string };
  summary: { enabled: boolean; onMention: boolean };
  security: ReviewerTriggers;
  designAlternatives: ReviewerTriggers;
}
export interface LegacyTriggers {
  autoReviewEnabled: boolean;
  triggerOnCreate: boolean;
  triggerOnPush: boolean;
  triggerOnRequest: boolean;
  triggerOnReviewRequest: boolean;
  triggerOnMention: boolean;
  mentionTriggerPhrase?: string | null;
  summaryTriggerPhrase?: string | null;
  agentSettings?: AgentSettings;
}
export function defaultAgentSettings(s: LegacyTriggers): AgentSettings {
  const reviewer = (phrase: string): ReviewerTriggers => ({
    onCreate: s.autoReviewEnabled && s.triggerOnCreate,
    onPush: s.autoReviewEnabled && s.triggerOnPush,
    onReviewRequest: s.triggerOnRequest && s.triggerOnReviewRequest,
    onMention: s.triggerOnRequest && s.triggerOnMention,
    phrase,
  });
  return {
    reviewEnabled: true, catchAll: null,
    // The general mention flow was removed in v0.26. Never silently reactivate it.
    assistant: { enabled: false, onMention: true, phrase: "ask" },
    summary: { enabled: s.triggerOnRequest && s.triggerOnMention, onMention: true },
    security: reviewer("security"), designAlternatives: reviewer("design"),
  };
}
/** v0.38 stored a `withReviewCommand` reviewer flag; drop it so old rows validate on save.
 * Rows from before v0.40 have no `catchAll`; it defaults to off. */
export function parseAgentSettings(json: string): AgentSettings {
  const a = JSON.parse(json);
  for (const k of ["security", "designAlternatives"]) if (a?.[k]) delete a[k].withReviewCommand;
  if (a && typeof a === "object" && a.catchAll === undefined) a.catchAll = null;
  return a;
}
export const normalizePhrase = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
export function validateAgentSettings(value: unknown): value is AgentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as AgentSettings;
  const exact = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o)
    && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
  const booleans = (o: object, keys: string[]) => keys.every(k => typeof (o as any)[k] === "boolean");
  const reviewer = (o: ReviewerTriggers) => exact(o, ["onCreate", "onPush", "onReviewRequest", "onMention", "phrase"])
    && booleans(o, ["onCreate", "onPush", "onReviewRequest", "onMention"]) && typeof o.phrase === "string";
  return exact(v, ["reviewEnabled", "catchAll", "assistant", "summary", "security", "designAlternatives"])
    && typeof v.reviewEnabled === "boolean" && (v.catchAll === null || AGENT_IDS.includes(v.catchAll))
    && exact(v.assistant, ["enabled", "onMention", "phrase"]) && booleans(v.assistant, ["enabled", "onMention"]) && typeof v.assistant.phrase === "string"
    && exact(v.summary, ["enabled", "onMention"]) && booleans(v.summary, ["enabled", "onMention"])
    && reviewer(v.security) && reviewer(v.designAlternatives);
}
/** Legacy review/summary collisions retain their documented review-first precedence.
 * New saves reject all collisions (including disabled agents) and empty phrases. */
export function phraseValidationError(review: string, summary: string, agents: AgentSettings): string | null {
  const phrases = [["Code Review", review], ["Summary", summary], ["Assistant", agents.assistant.phrase],
    ["Security", agents.security.phrase], ["Design & Alternatives", agents.designAlternatives.phrase]];
  const seen = new Map<string, string>();
  for (const [name, phrase] of phrases) {
    if (typeof phrase !== "string" || !normalizePhrase(phrase)) return `${name} needs a trigger phrase.`;
    const normalized = normalizePhrase(phrase);
    if (normalized.length > 80 || /[@\r\n]/.test(phrase)) return `${name}: use a phrase of up to 80 characters, without @ or line breaks.`;
    if (seen.has(normalized)) return `${name} and ${seen.get(normalized)} must use different trigger phrases.`;
    seen.set(normalized, name);
  }
  return null;
}
export function hasAgentTriggers(s: LegacyTriggers, lenses: {id: string; enabled: boolean}[] = []): boolean {
  const a = s.agentSettings ?? defaultAgentSettings(s);
  return (a.reviewEnabled && ((s.autoReviewEnabled && (s.triggerOnCreate || s.triggerOnPush))
      || (s.triggerOnRequest && (s.triggerOnReviewRequest || s.triggerOnMention))))
    || (a.summary.enabled && a.summary.onMention) || (a.assistant.enabled && a.assistant.onMention)
    || lenses.some(l => { const t = l.id === "security" ? a.security : a.designAlternatives;
      return l.enabled && (t.onCreate || t.onPush || t.onReviewRequest || t.onMention); });
}
