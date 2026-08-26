/**
 * GitHub event-bus integration constants and helpers.
 *
 * The code-review app reacts to GitHub PR activity by subscribing to Rome's
 * event bus instead of relaying webhooks through smee.io. The wiring is:
 *
 *   GitHub repo webhook  (registered by connector_github_subscribe)
 *     -> POST /api/app-api/connector/webhook   (HMAC verify + delivery dedup)
 *     -> publish_event  provider:event:github.<event>
 *     -> routine (event-bus trigger)
 *     -> code-review_pr-webhook action
 *     -> code-review_pr-review action
 *
 * The bus payload a routine delivers to the action is the *raw GitHub webhook
 * body* (e.g. `{ action, pull_request, repository, sender, ... }`) under
 * `__triggerPayload`. The GitHub event name itself is NOT in the body — it is
 * encoded in the topic — so each routine passes a static `githubEvent` arg so
 * the handler knows which event it is reacting to.
 */

/**
 * GitHub event names we ask connector_github_subscribe to deliver.
 * `issues` is subscribed so new-issue activity reaches the bus (design doc §6
 * Phase 2); standalone issue events are not auto-actioned — issue *comments*
 * (delivered via `issue_comment`) drive the new flow.
 */
export const GITHUB_EVENTS = ["pull_request", "issue_comment", "issues"] as const;
export type GithubEvent = (typeof GITHUB_EVENTS)[number];

/** Bus topic format mirrors connector's `buildTopic("github", <event>)`. */
function topicFor(event: GithubEvent): string {
  return `provider:event:github.${event}`;
}

/** The action a routine fires when a GitHub event lands on the bus. */
export const HANDLER_ACTION = "code-review:code-review_pr-webhook";

/**
 * Bare, un-namespaced handler action name used before the `appId:name`
 * convention. Deployments upgraded from an older code-review still carry
 * routines wired to this name; they occupy our stable `key`s but no longer
 * match {@link HANDLER_ACTION}, so the repair path must sweep them before it
 * can recreate the routines under the fully-qualified name. Removable once no
 * live deployment has legacy routines left.
 */
export const LEGACY_HANDLER_ACTIONS = ["code-review_pr-webhook"] as const;

/** The connector actions that register / tear down Rome's own GitHub webhook. */
export const SUBSCRIBE_ACTION = "connector:connector_github_subscribe";
export const UNSUBSCRIBE_ACTION = "connector:connector_github_unsubscribe";

/** The system actions that manage event-bus routines. */
export const CREATE_ROUTINE_ACTION = "system:create_routine";
export const DELETE_ROUTINE_ACTION = "system:delete_routine";
export const SEARCH_ROUTINE_ACTION = "system:search_routine";

/**
 * One routine per GitHub event type, shared by every subscribed repo. The
 * routine fans every delivery of its topic into the handler action, which does
 * the per-repo filtering against the app's own settings table. Using a stable
 * `key` makes creation idempotent (re-enabling another repo is a no-op) and
 * teardown precise.
 */
export interface RoutineSpec {
  key: string;
  name: string;
  eventName: string;
  githubEvent: GithubEvent;
}

export const ROUTINE_SPECS: RoutineSpec[] = GITHUB_EVENTS.map((event) => ({
  key: `code-review:github:${event}`,
  name: `Code Review · GitHub ${event} events`,
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

/** Unwrap an action result that may be a bare value or `{ status, data }`. */
function unwrap(result: unknown): any {
  if (result && typeof result === "object" && "data" in (result as any)) {
    return (result as any).data ?? result;
  }
  return result;
}

/** True when an action result explicitly reports an error. */
function resultError(result: unknown): string | undefined {
  if (result && typeof result === "object" && (result as any).status === "error") {
    return (result as any).error || "action error";
  }
  return undefined;
}

/**
 * Find this app's GitHub event-bus routines, keyed by the GitHub event they
 * react to. We can't search by routine `key` (search_routine doesn't return it),
 * so we match on our handler action plus the static `githubEvent` arg.
 */
async function findOurRoutines(
  runAction: RunAction,
): Promise<Map<GithubEvent, RoutineMatch>> {
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

/**
 * Find this app's legacy (pre-`appId:name`) GitHub routines — those still wired
 * to a bare handler action in {@link LEGACY_HANDLER_ACTIONS}. They hold our
 * stable `key`s but no longer match {@link HANDLER_ACTION}, so we must delete
 * them before recreating the routines under the fully-qualified name. The
 * `search_routine` query is a fuzzy substring match, so we filter with an exact
 * actionName equality to avoid catching the current fully-qualified routines.
 */
async function findLegacyRoutines(runAction: RunAction): Promise<RoutineMatch[]> {
  const legacy: RoutineMatch[] = [];
  for (const action of LEGACY_HANDLER_ACTIONS) {
    const res = unwrap(await runAction(SEARCH_ROUTINE_ACTION, { query: action }));
    const matches: RoutineMatch[] = res?.matches ?? res?.routines ?? [];
    for (const m of matches) {
      if (m.actionName === action) legacy.push(m);
    }
  }
  return legacy;
}

/**
 * Delete any legacy bare-name routines so their stable `key`s are freed for
 * recreation under {@link HANDLER_ACTION}. Best-effort: a delete refusal (e.g.
 * an in-flight run) is swallowed, leaving that key taken until the next repair.
 */
async function sweepLegacyRoutines(runAction: RunAction): Promise<void> {
  let legacy: RoutineMatch[];
  try {
    legacy = await findLegacyRoutines(runAction);
  } catch {
    return; // best-effort — never block the main wiring on legacy cleanup
  }
  for (const m of legacy) {
    await runAction(DELETE_ROUTINE_ACTION, { routineId: m.id }).catch(() => {});
  }
}

/**
 * Read-only health check for this app's shared GitHub event routines. This does
 * not create, enable, or delete anything; callers use it to distinguish the
 * GitHub webhook subscription from the separate event-bus routine wiring.
 */
export async function getGithubRoutineStatus(
  runAction: RunAction,
): Promise<GithubRoutineStatus> {
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
 * Idempotently ensure the per-event routines exist AND are enabled. Safe to call
 * on every enable / repair:
 *   - a missing routine is created (enabled);
 *   - a healthy (enabled) routine is left untouched;
 *   - a present-but-disabled routine is healed by delete + recreate, since the
 *     routine store exposes no update/enable action — only create/delete/search.
 * This makes the function converge both the "missing" and "disabled" states the
 * health check reports, so a single call fully repairs the event-bus wiring.
 */
export async function ensureGithubRoutines(runAction: RunAction): Promise<void> {
  // Sweep legacy bare-name routines first so their stable keys are free to be
  // recreated under the fully-qualified handler action. A no-op on fresh
  // installs (none exist) and idempotent once migrated.
  await sweepLegacyRoutines(runAction);
  const existing = await findOurRoutines(runAction);
  for (const spec of ROUTINE_SPECS) {
    const current = existing.get(spec.githubEvent);
    if (current?.enabled === true) continue; // already healthy
    if (current) {
      // Present but disabled: no enable/update action exists, so drop it and
      // recreate enabled below. Best-effort — a delete refusal (e.g. in-flight
      // run) leaves the key taken, and the create below is swallowed as a
      // benign key collision, so the routine simply stays as-is until retried.
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
    // A key collision means a concurrent enable already created it — fine.
    if (err && !/key|exist|duplicate|in use/i.test(err)) {
      throw new Error(`Failed to create routine ${spec.key}: ${err}`);
    }
  }
}

/**
 * Remove the per-event routines. Called when no repo has auto-review enabled
 * anymore, so leftover routines don't fire as no-ops. Best-effort: a missing
 * routine (already gone) is success.
 */
export async function removeGithubRoutines(runAction: RunAction): Promise<void> {
  let existing: Map<GithubEvent, RoutineMatch>;
  try {
    existing = await findOurRoutines(runAction);
  } catch {
    return; // best-effort cleanup
  }
  for (const match of existing.values()) {
    await runAction(DELETE_ROUTINE_ACTION, { routineId: match.id }).catch(() => {});
  }
  // Also drop any legacy bare-name routines so an upgraded deployment doesn't
  // leave orphaned wiring behind when auto-review is fully turned off.
  await sweepLegacyRoutines(runAction);
}
