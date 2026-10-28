import { defaultAgentSettings, normalizePhrase } from "../../lib/agent-settings.js";
import { commentTriggerAccess, decidePRReviewTrigger, normalizeGitHubLogin, repoFromPayload, type GitHubWebhookPayload, type PRReviewTriggerSettings, type TriggerDecision } from "./decision.js";

export type AgentDecision = TriggerDecision | {
  kind: "assistant"; repo: string; prNumber: number; surface: "pr" | "issue";
  triggerCommentId: number | null; commentBody: string; actorLogin: string | null;
};
export type RoutedDecision = AgentDecision & { reviewAgentIds?: string[] };

/** Exact commands are reserved, even when their agent is disabled. Legacy
 * collisions have a deterministic order: review, summary, security, design.
 * Assistant accepts only an explicit addressed phrase followed by a request. */
export function decideAgentTrigger(input: {
  githubEvent: string; payload: GitHubWebhookPayload;
  settings: PRReviewTriggerSettings | undefined; currentGitHubLogin: string | null;
  lenses: {id: string; enabled: boolean}[];
}): RoutedDecision {
  const { settings: s, payload: p, githubEvent: event, currentGitHubLogin: bot, lenses } = input;
  if (!s || !repoFromPayload(p)) return decidePRReviewTrigger(input);
  const a = s.agentSettings ?? defaultAgentSettings(s);
  const body = normalizePhrase(p.comment?.body ?? "");
  const handle = normalizeGitHubLogin(bot);
  const command = (phrase: string) => normalizePhrase(`@${handle} ${phrase}`);
  const isComment = event === "issue_comment" && p.action === "created";
  const commands = [
    ["review", s.mentionTriggerPhrase || "PTAL"], ["summary", s.summaryTriggerPhrase || "summary"],
    ["security", a.security.phrase], ["design-alternatives", a.designAlternatives.phrase],
  ];
  const matched = isComment && handle ? commands.find(([, phrase]) => body === command(phrase))?.[0] : undefined;
  // Reuse the established access checks and review-request targeting.
  const decide = (overrides: Partial<PRReviewTriggerSettings>) => decidePRReviewTrigger({ ...input, settings: { ...s, ...overrides } });
  if (matched === "summary") {
    if (!a.summary.enabled || !a.summary.onMention) return { kind: "skip", reason: "Summary is disabled." };
    const access = commentTriggerAccess(p, s, bot);
    if (access.kind === "skip") return access;
    if (!p.issue?.pull_request) return { kind: "skip", reason: "Summary is only supported on pull requests." };
    return { kind: "summary", repo: repoFromPayload(p), prNumber: access.number,
      triggerCommentId: p.comment?.id ?? null, commentBody: p.comment?.body ?? "", actorLogin: access.actorLogin };
  }
  if (isComment && !matched && handle && a.assistant.enabled && a.assistant.onMention) {
    const prefix = command(a.assistant.phrase);
    if (body.startsWith(prefix + " ") && normalizeGitHubLogin(p.comment?.user?.login) !== handle) {
      const access = commentTriggerAccess(p, s, bot);
      if (access.kind === "skip") return access;
      return { kind: "assistant", repo: repoFromPayload(p), prNumber: access.number,
        surface: p.issue?.pull_request ? "pr" : "issue", triggerCommentId: p.comment?.id ?? null,
        commentBody: p.comment?.body ?? "", actorLogin: access.actorLogin };
    }
  }
  const main = decide({});
  const ids: string[] = [];
  if (a.reviewEnabled && main.kind === "trigger" && (!isComment || matched === "review")) ids.push("review");
  let first: TriggerDecision | undefined = ids.length ? main : undefined;
  for (const lens of lenses.filter(l => l.enabled)) {
    const t = lens.id === "security" ? a.security : a.designAlternatives;
    if (isComment && matched !== lens.id && !(matched === "review" && t.withReviewCommand && a.reviewEnabled)) continue;
    // withReviewCommand preserves the old fan-out without conflating the
    // reviewer's independent command switch with the main review's switch.
    if (isComment && matched === "review") {
      if (main.kind === "trigger" && t.withReviewCommand) { ids.push(lens.id); first ??= main; }
      continue;
    }
    const d = decide({ autoReviewEnabled: true, triggerOnCreate: t.onCreate, triggerOnPush: t.onPush,
      triggerOnRequest: true, triggerOnReviewRequest: t.onReviewRequest, triggerOnMention: t.onMention,
      mentionTriggerPhrase: t.phrase, summaryTriggerPhrase: t.phrase });
    if (d.kind === "trigger") { ids.push(lens.id); first ??= d; }
  }
  if (first?.kind === "trigger" && ids.length) return { ...first, reviewAgentIds: ids };
  if (main.kind === "trigger" || main.kind === "summary") return { kind: "skip", reason: "No enabled agent matches this trigger." };
  return main;
}
