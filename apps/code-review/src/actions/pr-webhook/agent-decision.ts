import { defaultAgentSettings, type AgentId } from "../../lib/agent-settings.js";
import { commentTriggerAccess, decidePRReviewTrigger, mentionRequest, normalizeGitHubLogin, parseCommand, repoFromPayload, type GitHubWebhookPayload, type PRReviewTriggerSettings, type TriggerDecision } from "./decision.js";

export type AgentDecision = TriggerDecision | {
  kind: "assistant"; repo: string; prNumber: number; surface: "pr" | "issue";
  triggerCommentId: number | null; commentBody: string; actorLogin: string | null;
};
const COMMAND_IDS = { assistant: "assistant", review: "review", summary: "summary",
  security: "security", designAlternatives: "design-alternatives" } as const satisfies Record<AgentId, string>;
export type RoutedDecision = AgentDecision & { reviewAgentIds?: string[] };

/** Commands are reserved even when their agent is disabled. A comment starting
 * with `@bot <phrase>` matches the longest phrase; text after it is a note for
 * the agent. Equal phrases resolve in order: review, summary, security, design.
 * The assistant needs a request after its phrase. Any other `@bot <request>`
 * goes to the project's catch-all agent, if one is chosen. */
export function decideAgentTrigger(input: {
  githubEvent: string; payload: GitHubWebhookPayload;
  settings: PRReviewTriggerSettings | undefined; currentGitHubLogin: string | null;
  lenses: {id: string; enabled: boolean}[];
}): RoutedDecision {
  const { settings: s, payload: p, githubEvent: event, currentGitHubLogin: bot, lenses } = input;
  if (!s || !repoFromPayload(p)) return decidePRReviewTrigger(input);
  const a = s.agentSettings ?? defaultAgentSettings(s);
  const handle = normalizeGitHubLogin(bot);
  const isComment = event === "issue_comment" && p.action === "created";
  const commands = [
    ["review", s.mentionTriggerPhrase || "PTAL"], ["summary", s.summaryTriggerPhrase || "summary"],
    ["security", a.security.phrase], ["design-alternatives", a.designAlternatives.phrase],
    ["assistant", a.assistant.phrase],
  ] as const;
  const body = p.comment?.body ?? "";
  const command = isComment && handle ? parseCommand(body, handle, commands) : null;
  const caught = !command && a.catchAll && isComment ? mentionRequest(body, handle) : null;
  const parsed = command ?? (caught ? { id: COMMAND_IDS[a.catchAll!], note: caught } : null);
  const matched = parsed?.id === "assistant" ? undefined : parsed?.id;
  const requestNote = parsed?.note ? { requestNote: parsed.note } : {};
  // Reuse the established access checks and review-request targeting.
  const decide = (overrides: Partial<PRReviewTriggerSettings>) => decidePRReviewTrigger({ ...input, settings: { ...s, ...overrides },
    ...(caught ? { command: { command: "review" as const, note: caught } } : {}) });
  if (matched === "summary") {
    if (!a.summary.enabled || !a.summary.onMention) return { kind: "skip", reason: "Summary is disabled." };
    const access = commentTriggerAccess(p, s, bot);
    if (access.kind === "skip") return access;
    if (!p.issue?.pull_request) return { kind: "skip", reason: "Summary is only supported on pull requests." };
    return { kind: "summary", repo: repoFromPayload(p), prNumber: access.number,
      triggerCommentId: p.comment?.id ?? null, commentBody: p.comment?.body ?? "", actorLogin: access.actorLogin, ...requestNote };
  }
  // The bot may use the guardian's own GitHub account. Do not deny their
  // explicit request by author identity: replies are always framed with a
  // heading by pr-assistant and therefore cannot start with the command.
  if (parsed?.id === "assistant" && parsed.note && a.assistant.enabled && a.assistant.onMention) {
    const access = commentTriggerAccess(p, s, bot);
    if (access.kind === "skip") return access;
    return { kind: "assistant", repo: repoFromPayload(p), prNumber: access.number,
      surface: p.issue?.pull_request ? "pr" : "issue", triggerCommentId: p.comment?.id ?? null,
      commentBody: p.comment?.body ?? "", actorLogin: access.actorLogin };
  }
  const main = decide({});
  const ids: string[] = [];
  if (a.reviewEnabled && main.kind === "trigger" && (!isComment || matched === "review")) ids.push("review");
  let first: TriggerDecision | undefined = ids.length ? main : undefined;
  for (const lens of lenses.filter(l => l.enabled)) {
    const t = lens.id === "security" ? a.security : a.designAlternatives;
    if (isComment && matched !== lens.id) continue;
    const d = decide({ autoReviewEnabled: true, triggerOnCreate: t.onCreate, triggerOnPush: t.onPush,
      triggerOnRequest: true, triggerOnReviewRequest: t.onReviewRequest, triggerOnMention: t.onMention,
      mentionTriggerPhrase: t.phrase, summaryTriggerPhrase: t.phrase });
    if (d.kind === "trigger") { ids.push(lens.id); first ??= d; }
  }
  if (first?.kind === "trigger" && ids.length) return { ...first, ...requestNote, reviewAgentIds: ids };
  if (main.kind === "trigger" || main.kind === "summary") return { kind: "skip", reason: "No enabled agent matches this trigger." };
  return main;
}
