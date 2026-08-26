import { describe, expect, it } from "vitest";
import {
  CREATE_ROUTINE_ACTION,
  DELETE_ROUTINE_ACTION,
  GITHUB_EVENTS,
  HANDLER_ACTION,
  LEGACY_HANDLER_ACTIONS,
  SEARCH_ROUTINE_ACTION,
  ensureGithubRoutines,
  getGithubRoutineStatus,
} from "./github-events.js";

type Call = { name: string; args: Record<string, unknown> };

/**
 * Build a fake runAction over an in-memory set of routines. Records every call
 * so tests can assert what ensureGithubRoutines did (create / delete / search).
 * Seeds default to the current fully-qualified handler action; pass `actionName`
 * to emulate a legacy bare-name routine occupying the same stable key.
 */
function makeRunAction(
  initial: Array<{ id: string; githubEvent: string; enabled: boolean; actionName?: string }>,
) {
  const routines = new Map(
    initial.map((r) => [
      r.id,
      { id: r.id, actionName: r.actionName ?? HANDLER_ACTION, enabled: r.enabled, args: { githubEvent: r.githubEvent } },
    ]),
  );
  const calls: Call[] = [];
  let nextId = 100;
  const runAction = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === SEARCH_ROUTINE_ACTION) {
      return { status: "ok", data: { matches: [...routines.values()] } };
    }
    if (name === DELETE_ROUTINE_ACTION) {
      routines.delete(String(args.routineId));
      return { status: "ok" };
    }
    if (name === CREATE_ROUTINE_ACTION) {
      const ev = String((args.args as Record<string, unknown>)?.githubEvent ?? "");
      // Emulate the stable-key collision guard: refuse a second live routine.
      const clash = [...routines.values()].some((r) => r.args.githubEvent === ev);
      if (clash) return { status: "error", error: "routine key already in use" };
      const id = `new-${nextId++}`;
      routines.set(id, { id, actionName: HANDLER_ACTION, enabled: true, args: { githubEvent: ev } });
      return { status: "ok", data: { id } };
    }
    return { status: "ok" };
  };
  return { runAction, calls, routines };
}

describe("ensureGithubRoutines", () => {
  it("creates only the missing routine and leaves healthy ones untouched", async () => {
    const { runAction, calls, routines } = makeRunAction([
      { id: "a", githubEvent: "pull_request", enabled: true },
      { id: "b", githubEvent: "issue_comment", enabled: true },
      // `issues` missing — the exact scenario from the bug report.
    ]);

    await ensureGithubRoutines(runAction);

    const created = calls.filter((c) => c.name === CREATE_ROUTINE_ACTION);
    expect(created).toHaveLength(1);
    expect((created[0].args.args as Record<string, unknown>).githubEvent).toBe("issues");
    expect(calls.some((c) => c.name === DELETE_ROUTINE_ACTION)).toBe(false);

    const status = await getGithubRoutineStatus(runAction);
    expect(status.ready).toBe(true);
    expect([...routines.values()].every((r) => r.enabled)).toBe(true);
  });

  it("heals a disabled routine by delete + recreate enabled", async () => {
    const { runAction, calls, routines } = makeRunAction([
      { id: "a", githubEvent: "pull_request", enabled: true },
      { id: "b", githubEvent: "issue_comment", enabled: true },
      { id: "c", githubEvent: "issues", enabled: false },
    ]);

    await ensureGithubRoutines(runAction);

    expect(calls.some((c) => c.name === DELETE_ROUTINE_ACTION && c.args.routineId === "c")).toBe(true);
    const created = calls.filter((c) => c.name === CREATE_ROUTINE_ACTION);
    expect(created).toHaveLength(1);
    expect((created[0].args.args as Record<string, unknown>).githubEvent).toBe("issues");

    const status = await getGithubRoutineStatus(runAction);
    expect(status.ready).toBe(true);
    expect(status.disabled).toHaveLength(0);
    expect([...routines.values()].every((r) => r.enabled)).toBe(true);
  });

  it("is a no-op when every required routine is present and enabled", async () => {
    const { runAction, calls } = makeRunAction(
      GITHUB_EVENTS.map((event, i) => ({ id: `r${i}`, githubEvent: event, enabled: true })),
    );

    await ensureGithubRoutines(runAction);

    expect(calls.some((c) => c.name === CREATE_ROUTINE_ACTION)).toBe(false);
    expect(calls.some((c) => c.name === DELETE_ROUTINE_ACTION)).toBe(false);
  });

  it("migrates a legacy bare-name routine to the fully-qualified handler", async () => {
    // An upgraded deployment: every event is already wired, but under the OLD
    // bare handler action. These occupy our stable keys yet don't match the new
    // HANDLER_ACTION, so without a sweep the recreate would collide and stall.
    const legacy = LEGACY_HANDLER_ACTIONS[0];
    const { runAction, calls, routines } = makeRunAction(
      GITHUB_EVENTS.map((event, i) => ({
        id: `legacy-${i}`,
        githubEvent: event,
        enabled: true,
        actionName: legacy,
      })),
    );

    await ensureGithubRoutines(runAction);

    // Every legacy routine is deleted and recreated under the new handler name.
    expect(calls.filter((c) => c.name === DELETE_ROUTINE_ACTION)).toHaveLength(GITHUB_EVENTS.length);
    expect(calls.filter((c) => c.name === CREATE_ROUTINE_ACTION)).toHaveLength(GITHUB_EVENTS.length);
    const live = [...routines.values()];
    expect(live).toHaveLength(GITHUB_EVENTS.length);
    expect(live.every((r) => r.actionName === HANDLER_ACTION)).toBe(true);

    // And the health check now reports ready.
    const status = await getGithubRoutineStatus(runAction);
    expect(status.ready).toBe(true);
  });
});
