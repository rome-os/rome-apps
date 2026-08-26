import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AgentRunnerInterface,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { runTwitterCli, parseYamlRecords } from "../../lib/cli.js";
import { createXRepository } from "../../db/repositories/repo.js";

const log = createAppLogger("x-poll-metrics");

const DATA_DIR = join(homedir(), ".rome", "default", "apps", "data", "x");
const LAST_POLL_FILE = join(DATA_DIR, "last-poll.json");
const METRICS_LOG_FILE = join(DATA_DIR, "metrics-log.jsonl");

interface LastPollState {
  lastPollAt: string;
  lastNotificationIds: string[];
  lastTweetIds: string[];
}

interface Deps {
  agentRunner: AgentRunnerInterface;
}

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps<Deps>,
): Action {
  const { agentRunner, appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Twitter username to poll. If omitted, uses the logged-in user.",
        },
        setupSchedule: {
          type: "boolean",
          description: "If true, sets up a recurring 15-minute schedule for this action",
        },
      },
    },
    async execute(args): Promise<ActionResult> {
      if (args.setupSchedule === true) {
        return await setupRecurringPoll(appContext, args.username as string | undefined);
      }

      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "poll-metrics",
          status: "running",
          inputJson: JSON.stringify(args),
          startedAt: new Date(),
        });
      } catch { /* best effort */ }

      // Step 1: Determine username
      let username = args.username as string | undefined;
      if (!username) {
        const profileResult = await runTwitterCli("profile", []);
        if (!profileResult.success) {
          try { repo?.completeActionRun(runId, "error", null, "Not logged in"); } catch { /* */ }
          return {
            status: "error",
            error: "Not logged in to X. Please log in first via x_check_login.",
          };
        }
        const profiles = parseYamlRecords(profileResult.stdout);
        username = profiles[0]?.["screen_name"];
        if (!username) {
          try { repo?.completeActionRun(runId, "error", null, "Could not determine username"); } catch { /* */ }
          return { status: "error", error: "Could not determine logged-in username." };
        }
      }

      // Step 2: Load last poll state
      const lastState = await loadLastPollState();

      // Step 3: Fetch recent tweets for metrics
      const tweetsResult = await runTwitterCli("tweets", [username], { limit: "10" });
      const tweets = tweetsResult.success ? parseYamlRecords(tweetsResult.stdout) : [];

      // Step 4: Fetch notifications
      const notifResult = await runTwitterCli("notifications", [], { limit: "20" });
      const notifications = notifResult.success ? parseYamlRecords(notifResult.stdout) : [];

      // Step 5: Identify new notifications since last poll
      const previousNotifIds = new Set(lastState.lastNotificationIds);
      const newNotifications = notifications.filter(
        (n) => n["id"] && !previousNotifIds.has(n["id"]!),
      );

      // Step 6: Identify reply/comment notifications
      const replyNotifications = newNotifications.filter((n) => {
        const action = (n["action"] || "").toLowerCase();
        return (
          action.includes("reply") ||
          action.includes("replied") ||
          action.includes("mention") ||
          action.includes("comment")
        );
      });

      // Step 7: Log metrics
      const metricsEntry = {
        timestamp: new Date().toISOString(),
        username,
        tweetMetrics: tweets.map((t) => ({
          id: t["id"],
          text: (t["text"] || "").slice(0, 100),
          likes: t["likes"],
          retweets: t["retweets"],
          replies: t["replies"],
          views: t["views"],
        })),
        notificationCount: notifications.length,
        newNotificationCount: newNotifications.length,
        newReplyCount: replyNotifications.length,
      };
      await appendMetricsLog(metricsEntry);

      // Step 8: If there are new replies, trigger the comment-reply agent
      const replyResults: Array<{ notification: Record<string, string>; agentResponse: string }> = [];

      for (const replyNotif of replyNotifications) {
        const notifText = replyNotif["text"] || "";
        const notifAuthor = replyNotif["author"] || "";
        const notifUrl = replyNotif["url"] || "";

        log.info("New reply/mention detected", { author: notifAuthor, url: notifUrl });

        try {
          let agentResponse = "";
          for await (const msg of agentRunner.run({
            agentName: "comment-reply",
            prompt: `A new reply/mention has been received on X (Twitter).

Author: @${notifAuthor}
URL: ${notifUrl}
Text: ${notifText}

Please draft an appropriate reply. Before drafting, load the brand voice memory file to match the account's tone and style. Look for a file matching pattern: memory/x-*-brand-voice.md

Draft a reply and present it to the user for review. Do NOT post the reply automatically — wait for the user to approve it first.`,
          })) {
            if (msg.type === "result") {
              agentResponse = String(msg.content ?? "");
            }
          }
          replyResults.push({ notification: replyNotif, agentResponse });
        } catch (error) {
          log.warn("Failed to process reply notification", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Step 9: Save updated poll state
      await saveLastPollState({
        lastPollAt: new Date().toISOString(),
        lastNotificationIds: notifications
          .map((n) => n["id"])
          .filter((id): id is string => !!id),
        lastTweetIds: tweets
          .map((t) => t["id"])
          .filter((id): id is string => !!id),
      });

      const data = {
        username,
        polledAt: new Date().toISOString(),
        tweetsChecked: tweets.length,
        totalNotifications: notifications.length,
        newNotifications: newNotifications.length,
        newReplies: replyNotifications.length,
        replyDrafts: replyResults.length,
        topTweetMetrics: tweets.slice(0, 5).map((t) => ({
          text: (t["text"] || "").slice(0, 80),
          likes: t["likes"],
          retweets: t["retweets"],
          views: t["views"],
        })),
        message: `Polled @${username}: ${tweets.length} tweets checked, ${newNotifications.length} new notifications, ${replyNotifications.length} new replies processed.`,
      };

      try { repo?.completeActionRun(runId, "success", JSON.stringify({ tweetsChecked: tweets.length, newNotifications: newNotifications.length, newReplies: replyNotifications.length })); } catch { /* */ }

      return { status: "ok", data };
    },
  };
}

async function setupRecurringPoll(
  appContext: AppActionRuntimeDeps["appContext"],
  username?: string,
): Promise<ActionResult> {
  const existing = await appContext.listRoutines();
  const alreadyScheduled = existing.some((routine) => routine.name === "x-poll-metrics-15m");

  if (alreadyScheduled) {
    return {
      status: "ok",
      data: { message: "Recurring X metrics poll is already scheduled (every 15 minutes)." },
    };
  }

  await appContext.runAction("schedule_event", {
    name: "x-poll-metrics-15m",
    type: "recurring",
    tzid: "America/Los_Angeles",
    localTime: "00:00",
    rrule: "FREQ=MINUTELY;INTERVAL=15",
    actionName: "x_poll_metrics",
    args: [username ? { username } : {}],
  });

  return {
    status: "ok",
    data: {
      message: "Recurring X metrics poll scheduled every 15 minutes. Will check tweet performance and new comments.",
    },
  };
}

async function loadLastPollState(): Promise<LastPollState> {
  try {
    const raw = await readFile(LAST_POLL_FILE, "utf8");
    return JSON.parse(raw) as LastPollState;
  } catch {
    return {
      lastPollAt: "",
      lastNotificationIds: [],
      lastTweetIds: [],
    };
  }
}

async function saveLastPollState(state: LastPollState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LAST_POLL_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function appendMetricsLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(METRICS_LOG_FILE, JSON.stringify(entry) + "\n", {
    flag: "a",
    encoding: "utf8",
  });
}
