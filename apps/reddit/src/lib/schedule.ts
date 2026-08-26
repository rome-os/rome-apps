import type { RomeAppContext, Routine } from "@rome-os/app-runtime";
import { DEFAULT_AI_AGENT_SCAN_CONFIG } from "./scan-config.js";

export const AI_AGENT_EVENT_NAME = "reddit_ai_agent_watch";
export const AI_AGENT_ACTION_NAME = "scan_ai_agents";
export const AI_AGENT_EVENT_RRULE = "FREQ=HOURLY;INTERVAL=3";

export interface AiAgentScheduleOptions {
  tzid?: string;
  localTime?: string;
}

function isAiAgentSchedule(routine: Routine): boolean {
  return routine.name === AI_AGENT_EVENT_NAME || routine.actionName === AI_AGENT_ACTION_NAME;
}

export async function getAiAgentSchedule(
  appContext: Pick<RomeAppContext, "listRoutines">,
): Promise<Routine | null> {
  const routines = await appContext.listRoutines();
  return routines.find((routine) => isAiAgentSchedule(routine) && routine.enabled) ?? null;
}

export async function ensureAiAgentSchedule(
  appContext: Pick<RomeAppContext, "listRoutines" | "runAction">,
  options: AiAgentScheduleOptions = {},
) {
  const existing = await getAiAgentSchedule(appContext);
  if (existing) {
    return {
      created: false,
      eventId: existing.id,
      event: existing,
    };
  }

  const tzid = options.tzid ?? "UTC";
  const localTime = options.localTime ?? "00:00";
  const scheduleResult = await appContext.runAction("schedule_event", {
    name: AI_AGENT_EVENT_NAME,
    type: "recurring",
    tzid,
    localTime,
    rrule: AI_AGENT_EVENT_RRULE,
    actionName: AI_AGENT_ACTION_NAME,
    args: [{ scanName: DEFAULT_AI_AGENT_SCAN_CONFIG.scanName }],
  });
  if (scheduleResult.status !== "ok") {
    throw new Error(
      scheduleResult.status === "error"
        ? scheduleResult.error
        : "Failed to schedule Reddit AI agent watch",
    );
  }

  const eventId =
    scheduleResult.data &&
    typeof scheduleResult.data === "object" &&
    "eventId" in scheduleResult.data &&
    typeof scheduleResult.data.eventId === "string"
      ? scheduleResult.data.eventId
      : undefined;
  const event = await getAiAgentSchedule(appContext);
  return {
    created: true,
    eventId,
    event,
  };
}
