import { describe, expect, it } from "vitest";
import { defaultAgentSettings, phraseValidationError, validateAgentSettings, hasAgentTriggers } from "../../lib/agent-settings.js";
import { decideAgentTrigger } from "./agent-decision.js";
import type { PRReviewTriggerSettings, GitHubWebhookPayload } from "./decision.js";

const legacy: PRReviewTriggerSettings = {
  autoReviewEnabled: true, triggerOnCreate: true, triggerOnPush: true,
  triggerOnRequest: true, triggerOnReviewRequest: true, triggerOnMention: true,
  triggerAccessMode: "blocklist", triggerAllowlist: [], triggerBlocklist: [],
  mentionTriggerPhrase: "PTAL", summaryTriggerPhrase: "summary",
};
const lenses = [{ id: "security", enabled: true }, { id: "design-alternatives", enabled: true }];
function comment(body: string, actor = "alice", isPR = true): GitHubWebhookPayload {
  return { action: "created", repository: { full_name: "o/r" },
    issue: { number: 3, ...(isPR ? { pull_request: {} } : {}) }, comment: { id: 10, body, user: { login: actor } } };
}
function event(action: string, actor = "alice"): GitHubWebhookPayload {
  return { action, repository: { full_name: "o/r" }, sender: { login: actor }, requested_reviewer: { login: "bot" },
    pull_request: { number: 3, user: { login: actor } } };
}
function route(payload: GitHubWebhookPayload, s = legacy, enabledLenses = lenses, bot: string | null = "bot") {
  return decideAgentTrigger({ payload, settings: s, lenses: enabledLenses, currentGitHubLogin: bot,
    githubEvent: payload.comment ? "issue_comment" : "pull_request" });
}
function configured() { return { ...legacy, agentSettings: defaultAgentSettings(legacy) }; }

describe("per-agent routing", () => {
  it.each(["opened", "synchronize", "review_requested"])("keeps legacy fan-out for %s", action => {
    expect(route(event(action))).toMatchObject({ kind: "trigger", reviewAgentIds: ["review", "security", "design-alternatives"] });
    expect(route(event(action), { ...legacy, autoReviewEnabled: false, triggerOnRequest: false }).kind).toBe("skip");
  });
  it("keeps legacy exact review fan-out and summary routing", () => {
    expect(route(comment("  @BOT  pTaL\n"))).toMatchObject({ kind: "trigger", reviewAgentIds: ["review", "security", "design-alternatives"] });
    expect(route(comment("@bot summary"))).toMatchObject({ kind: "summary" });
    expect(route(comment("@bot why?"))).toMatchObject({ kind: "skip" });
  });
  it("routes direct reviewer commands to only that reviewer, without the main agent", () => {
    const s = configured(); s.agentSettings.reviewEnabled = false;
    for (const [phrase, id] of [["security", "security"], ["design", "design-alternatives"]]) {
      expect(route(comment(`@bot ${phrase}`), s)).toMatchObject({ kind: "trigger", reviewAgentIds: [id] });
    }
    expect(route(comment("@bot PTAL"), s).kind).toBe("skip");
    expect(route(comment("@bot security please"), s).kind).toBe("skip");
  });
  it("independently selects automatic and requested-review events", () => {
    const s = configured(); s.agentSettings.reviewEnabled = false;
    s.agentSettings.security.onCreate = false; s.agentSettings.designAlternatives.onPush = false;
    s.agentSettings.security.onReviewRequest = false;
    expect(route(event("opened"), s)).toMatchObject({ reviewAgentIds: ["design-alternatives"] });
    expect(route(event("synchronize"), s)).toMatchObject({ reviewAgentIds: ["security"] });
    expect(route(event("review_requested"), s)).toMatchObject({ reviewAgentIds: ["design-alternatives"] });
    expect(route({ ...event("review_requested"), requested_reviewer: { login: "someone-else" } }, s).kind).toBe("skip");
  });
  it("summary and reviewers do not depend on the legacy main-review gates", () => {
    const s = configured(); s.autoReviewEnabled = false; s.triggerOnRequest = false;
    expect(route(comment("@bot summary"), s).kind).toBe("summary");
    expect(route(comment("@bot security"), s)).toMatchObject({ reviewAgentIds: ["security"] });
    expect(route(event("opened"), s)).toMatchObject({ reviewAgentIds: ["security", "design-alternatives"] });
    expect(hasAgentTriggers(s, lenses)).toBe(true);
  });
  it("allows opting out of main-command fan-out without disabling the own command", () => {
    const s = configured(); s.agentSettings.security.withReviewCommand = false;
    expect(route(comment("@bot PTAL"), s)).toMatchObject({ reviewAgentIds: ["review", "design-alternatives"] });
    expect(route(comment("@bot security"), s)).toMatchObject({ reviewAgentIds: ["security"] });
  });
  it("reserves disabled commands and observes enabled/mention switches", () => {
    const s = configured(); s.agentSettings.assistant.enabled = true;
    s.agentSettings.summary.enabled = false; s.agentSettings.security.onMention = false;
    expect(route(comment("@bot summary"), s).kind).toBe("skip");
    expect(route(comment("@bot security"), s).kind).toBe("skip");
    expect(route(comment("@bot design"), s, []) .kind).toBe("skip");
  });
  it("preserves review-first precedence for legacy collisions", () => {
    expect(route(comment("@bot summary"), { ...legacy, mentionTriggerPhrase: "summary" })).toMatchObject({ kind: "trigger", reviewAgentIds: ["review", "security", "design-alternatives"] });
  });
  it("keeps every agent behind the same ACL, including automatic triggers", () => {
    const s = configured(); s.triggerBlocklist = ["alice"]; s.agentSettings.assistant.enabled = true;
    for (const payload of [event("opened"), event("synchronize"), event("review_requested"), comment("@bot security"), comment("@bot summary"), comment("@bot ask why?")]) {
      expect(route(payload, s).kind).toBe("skip");
      expect(route(payload, s, lenses, null).kind).toBe("skip");
    }
    expect(route(comment("@bot ask why?", "bot"), s).kind).toBe("skip"); // no self-reply loops
  });
  it("only accepts an explicit Assistant phrase plus a request, on PRs and issues", () => {
    const s = configured(); s.agentSettings.assistant.enabled = true;
    expect(route(comment("@bot ask Why this design?"), s)).toMatchObject({ kind: "assistant", surface: "pr" });
    expect(route(comment("@bot ask Why this design?", "alice", false), s)).toMatchObject({ kind: "assistant", surface: "issue" });
    for (const body of ["@bot", "@bot ask", "> @bot ask why?", "Hello @bot ask why?", "@bot asking why?"]) expect(route(comment(body), s).kind).toBe("skip");
    s.agentSettings.assistant.onMention = false;
    expect(route(comment("@bot ask why?"), s).kind).toBe("skip");
  });
  it("does not run reviews/summaries on issues or edited comments", () => {
    for (const phrase of ["PTAL", "security", "design", "summary"]) {
      expect(route(comment(`@bot ${phrase}`, "alice", false)).kind).toBe("skip");
      expect(route({ ...comment(`@bot ${phrase}`), action: "edited" }).kind).toBe("skip");
    }
  });
});
describe("agent settings validation", () => {
  it("accepts the exact fixed settings shape and rejects unknown/partial/nonboolean controls", () => {
    const a = defaultAgentSettings(legacy);
    expect(validateAgentSettings(a)).toBe(true);
    expect(validateAgentSettings({ ...a, futureAgent: {} })).toBe(false);
    expect(validateAgentSettings({ ...a, summary: { enabled: "false", onMention: true } })).toBe(false);
    expect(validateAgentSettings({ ...a, security: { ...a.security, extra: true } })).toBe(false);
    expect(validateAgentSettings({})).toBe(false);
  });
  it("rejects empty, ambiguous, multiline and overlong phrases, even for disabled agents", () => {
    const a = defaultAgentSettings(legacy);
    expect(phraseValidationError("PTAL", "summary", a)).toBeNull();
    expect(phraseValidationError(" ", "summary", a)).toContain("Code Review");
    expect(phraseValidationError("PTAL", "pTaL", a)).toContain("different");
    a.assistant.phrase = "security";
    expect(phraseValidationError("PTAL", "summary", a)).toContain("different");
    a.assistant.phrase = "check  this"; a.security.phrase = " CHECK this ";
    expect(phraseValidationError("PTAL", "summary", a)).toContain("different");
    a.assistant.phrase = "ask\nnow";
    expect(phraseValidationError("PTAL", "summary", a)).toContain("line breaks");
    expect(phraseValidationError("x".repeat(81), "summary", a)).toContain("80");
  });
});
