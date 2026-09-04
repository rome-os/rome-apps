/**
 * GitHub event-bus integration for the Issue Triage app.
 *
 * Wiring:
 *   GitHub repo webhook  (registered by connector_github_subscribe)
 *     -> POST /api/app-api/connector/webhook   (HMAC verify + delivery dedup)
 *     -> publish_event  provider:event:github.issues
 *     -> routine (event-bus trigger, created by ensureGithubRoutines)
 *     -> issue-triage:issue-triage_issue-webhook  (per-repo filtering)
 *     -> issue-triage:issue-triage_triage-issue
 *
 * The bus delivers the raw GitHub webhook body under `__triggerPayload`. The
 * GitHub event name is not in the body — it lives in the topic — so each
 * routine passes a static `githubEvent` arg.
 */

/** GitHub events we subscribe to. Issue triage only needs `issues`. */
export const GITHUB_EVENTS = ["issues"] as const;
export type GithubEvent = (typeof GITHUB_EVENTS)[number];

function topicFor(event: GithubEvent): string {
  return `provider:event:github.${event}`;
}

/** The action a routine fires when a GitHub event lands on the bus. */
export const HANDLER_ACTION = "issue-triage:issue-triage_issue-webhook";

/** Connector actions that register / tear down Rome's own GitHub webhook. */
export const SUBSCRIBE_ACTION = "connector:connector_github_subscribe";
export const UNSUBSCRIBE_ACTION = "connector:connector_github_unsubscribe";

/** System actions that manage event-bus routines. */
export const CREATE_ROUTINE_ACTION = "system:create_routine";
export const DELETE_ROUTINE_ACTION = "system:delete_routine";
export const SEARCH_ROUTINE_ACTION = "system:search_routine";

export interface RoutineSpec {
  key: string;
  name: string;
  eventName: string;
  githubEvent: GithubEvent;
}

export const ROUTINE_SPECS: RoutineSpec[] = GITHUB_EVENTS.map((event) => ({
  key: `issue-triage:github:${event}`,
  name: `Issue Triage · GitHub ${event} events`,
  eventName: topicFor(event),
  githubEvent: event,
}));

export type RunAction = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

interface RoutineMatch {
  id: string;
  name?: string;
  enabled?: boolean;
  actionName?: string;
  args?: Record<string, unknown>;
}

export interface GithubRoutineStatus {
  ready: boolean;
  required: GithubEvent[];
  present: GithubEvent[];
  enabled: GithubEvent[];
  missing: GithubEvent[];
  disabled: GithubEvent[];
}

function unwrap(result: unknown): any {
  if (result && typeof result === "object" && "data" in (result as any)) {
    return (result as any).data ?? result;
  }
  return result;
}

function resultError(result: unknown): string | undefined {
  if (result && typeof result === "object" && (result as any).status === "error") {
    return (result as any).error || "action error";
  }
  return undefined;
}

/** Find this app's GitHub event-bus routines keyed by the event they react to. */
async function findOurRoutines(runAction: RunAction): Promise<Map<GithubEvent, RoutineMatch>> {
  const found = new Map<GithubEvent, RoutineMatch>();
  const res = unwrap(await runAction(SEARCH_ROUTINE_ACTION, { query: HANDLER_ACTION }));
  const matches: RoutineMatch[] = res?.matches ?? res?.routines ?? [];
  for (const m of matches) {
    if (m.actionName !== HANDLER_ACTION) continue;
    const ev = (m.args?.githubEvent as GithubEvent) ?? undefined;
    if (ev && GITHUB_EVENTS.includes(ev)) found.set(ev, m);
  }
  return found;
}

/** Read-only health check for the shared GitHub event routines. */
export async function getGithubRoutineStatus(runAction: RunAction): Promise<GithubRoutineStatus> {
  const existing = await findOurRoutines(runAction);
  const required = [...GITHUB_EVENTS];
  const present = required.filter((event) => existing.has(event));
  const enabled = required.filter((event) => existing.get(event)?.enabled === true);
  const missing = required.filter((event) => !existing.has(event));
  const disabled = required.filter((event) => {
    const routine = existing.get(event);
    return !!routine && routine.enabled !== true;
  });
  return {
    ready: missing.length === 0 && disabled.length === 0,
    required,
    present,
    enabled,
    missing,
    disabled,
  };
}

/**
 * Idempotently ensure the per-event routines exist AND are enabled. A missing
 * routine is created; a healthy one is left untouched; a present-but-disabled
 * one is dropped and recreated (the routine store exposes no enable action).
 */
export async function ensureGithubRoutines(runAction: RunAction): Promise<void> {
  const existing = await findOurRoutines(runAction);
  for (const spec of ROUTINE_SPECS) {
    const current = existing.get(spec.githubEvent);
    if (current?.enabled === true) continue;
    if (current) {
      await runAction(DELETE_ROUTINE_ACTION, { routineId: current.id }).catch(() => {});
    }
    const result = await runAction(CREATE_ROUTINE_ACTION, {
      name: spec.name,
      key: spec.key,
      trigger: { type: "event-bus", eventName: spec.eventName },
      actionName: HANDLER_ACTION,
      args: { githubEvent: spec.githubEvent },
      enabled: true,
    });
    const err = resultError(result);
    if (err && !/key|exist|duplicate|in use/i.test(err)) {
      throw new Error(`Failed to create routine ${spec.key}: ${err}`);
    }
  }
}

/** Remove the per-event routines when no repo has auto-triage enabled anymore. */
export async function removeGithubRoutines(runAction: RunAction): Promise<void> {
  let existing: Map<GithubEvent, RoutineMatch>;
  try {
    existing = await findOurRoutines(runAction);
  } catch {
    return;
  }
  for (const match of existing.values()) {
    await runAction(DELETE_ROUTINE_ACTION, { routineId: match.id }).catch(() => {});
  }
}
