import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AgentRunnerInterface,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createReportsRepository } from "../../db/repositories/reports.js";

const log = createAppLogger("summary_generate_summary");

interface ChannelMappingRow {
  channel_user_id: string;
}

/** Run a gh CLI command and return stdout, or an error string. */
function ghCmd(args: string[], timeoutMs = 30_000): string {
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? "/home/rome",
        GH_CONFIG_DIR: process.env.GH_CONFIG_DIR ?? "/home/rome/.config/gh",
      },
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("gh command failed", { args, error: msg });
    return "";
  }
}

/** Fetch GitHub activity for the authenticated user within the time window. */
function fetchGitHubActivity(windowHours: number, repos?: string[]): string {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const sinceDate = since.slice(0, 10);
  const parts: string[] = [];

  // 1. If specific repos are provided, fetch PRs and commits per repo
  if (repos && repos.length > 0) {
    for (const repo of repos) {
      const trimmed = repo.trim();
      if (!trimmed) continue;

      // Recent PRs (JSON output)
      const prs = ghCmd([
        "pr", "list", "--repo", trimmed,
        "--state", "all", "--limit", "30",
        "--search", `updated:>=${sinceDate}`,
        "--json", "number,title,state,author,createdAt,mergedAt,url",
      ]);
      if (prs && prs !== "[]") {
        parts.push(`### ${trimmed} — Pull Requests\n\`\`\`json\n${prs}\n\`\`\``);
      }

      // Recent commits on default branch
      const commits = ghCmd([
        "api", `repos/${trimmed}/commits?per_page=30&since=${since}`,
        "--jq", `.[] | "[" + .commit.author.date + "] " + (.commit.message | split("\n")[0]) + " (" + (.author.login // .commit.author.name) + ")"`,
      ]);
      if (commits) {
        parts.push(`### ${trimmed} — Recent Commits\n${commits}`);
      }
    }
  }

  // 2. Always try to fetch the authenticated user's recent events
  const username = ghCmd(["api", "user", "--jq", ".login"]);
  if (username) {
    // Fetch user events with a simple jq filter
    const rawEvents = ghCmd([
      "api", `/users/${username}/events?per_page=100`,
      "--jq", `.[] | select(.created_at >= "${since}") | "[" + .created_at + "] " + .type + " on " + .repo.name`,
    ]);
    if (rawEvents) {
      parts.push(`### ${username} — Recent Events\n${rawEvents}`);
    }

    // Also fetch user's recent PRs across all repos
    const myPrs = ghCmd([
      "search", "prs",
      "--author", username,
      "--updated", `>=${sinceDate}`,
      "--limit", "30",
      "--json", "repository,number,title,state,createdAt,url",
    ]);
    if (myPrs && myPrs !== "[]") {
      parts.push(`### ${username} — My Pull Requests\n\`\`\`json\n${myPrs}\n\`\`\``);
    }
  }

  if (parts.length === 0) {
    return "(No GitHub activity found or gh CLI not authenticated)";
  }

  return `## GitHub Activity (since ${since})\n\n${parts.join("\n\n")}`;
}

type Period = "last-day" | "last-week" | "this-week" | "last-month";

function periodToWindowHours(period: Period): number {
  switch (period) {
    case "last-day":
      return 24;
    case "last-week":
      return 24 * 7;
    case "this-week": {
      const now = new Date();
      // Monday is day 1 in ISO, Sunday is 0 — compute hours since Monday 00:00
      const day = now.getDay(); // 0=Sun, 1=Mon, ...
      const daysSinceMonday = day === 0 ? 6 : day - 1;
      const hoursSinceMidnight = now.getHours() + now.getMinutes() / 60;
      return daysSinceMonday * 24 + hoursSinceMidnight;
    }
    case "last-month":
      return 24 * 30;
  }
}

type GenerateSummaryDeps = AppActionRuntimeDeps<{
  agentRunner: AgentRunnerInterface;
}>;

export function createAction(
  config: ActionConfig,
  deps: GenerateSummaryDeps,
): Action {
  const { appContext, agentRunner } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["last-day", "last-week", "this-week", "last-month"],
          description:
            "Time period for the summary: last-day, last-week, this-week, or last-month",
        },
        sendToWechat: {
          type: "boolean",
          description:
            "Whether to send the report to WeChat after generation (default: false)",
        },
        wechatThreadId: {
          type: "string",
          description: "WeChat thread ID to send the report to",
        },
        githubRepos: {
          type: "string",
          description:
            "Comma-separated list of GitHub repos to include (e.g. owner/repo1,owner/repo2). If omitted, fetches user activity.",
        },
      },
      required: ["period"],
      additionalProperties: false,
    },

    async execute(args): Promise<ActionResult> {
      const period = args.period as Period;
      const sendToWechat = (args.sendToWechat as boolean | undefined) ?? false;
      const wechatThreadId = args.wechatThreadId as string | undefined;
      const githubRepos = args.githubRepos as string | undefined;
      const windowHours = periodToWindowHours(period);

      log.info("generating summary", { period, windowHours, sendToWechat });

      // --- 1. Collect data from multiple sources in parallel ---
      const dataPromises: Array<Promise<{ source: string; content: string }>> =
        [];

      // Webchat conversations
      dataPromises.push(
        appContext
          .runAction("get_webchat_conversations", { windowHours })
          .then((r) => ({
            source: "webchat",
            content: r.status === "ok"
              ? (r.data as { content: string }).content
              : "(Failed to fetch webchat conversations)",
          }))
          .catch((err) => ({
            source: "webchat",
            content: `(Error fetching webchat: ${err instanceof Error ? err.message : String(err)})`,
          })),
      );

      // Channel messages (try wechat, discord, telegram)
      for (const channel of ["wechat", "discord", "telegram"]) {
        dataPromises.push(
          appContext
            .runAction("fetch_channel_history", { channel, windowHours })
            .then((r) => ({
              source: channel,
              content: r.status === "ok"
                ? (r.data as { content: string }).content
                : `(No ${channel} history available)`,
            }))
            .catch(() => ({
              source: channel,
              content: `(${channel} channel not configured or unavailable)`,
            })),
        );
      }

      // Action logs
      dataPromises.push(
        appContext
          .runAction("get_action_logs", { windowHours })
          .then((r) => ({
            source: "action-logs",
            content: r.status === "ok"
              ? (r.data as { content: string }).content
              : "(Failed to fetch action logs)",
          }))
          .catch((err) => ({
            source: "action-logs",
            content: `(Error fetching action logs: ${err instanceof Error ? err.message : String(err)})`,
          })),
      );

      // GitHub activity (runs gh CLI synchronously but wrapped in a promise)
      const repoList = githubRepos
        ? githubRepos.split(",").map((r) => r.trim()).filter(Boolean)
        : undefined;
      dataPromises.push(
        Promise.resolve().then(() => ({
          source: "github",
          content: fetchGitHubActivity(windowHours, repoList),
        })),
      );

      const results = await Promise.all(dataPromises);

      // --- 2. Build context for the agent ---
      const contextParts = results
        .filter((r) => !r.content.startsWith("("))
        .map(
          (r) =>
            `=== Source: ${r.source} ===\n${r.content}`,
        );

      const periodLabel =
        period === "last-day"
          ? "最近一天"
          : period === "last-week"
            ? "最近一周"
            : period === "this-week"
              ? "本周"
              : "最近一个月";

      const agentPrompt = `请根据以下数据源，为我生成一份「${periodLabel}」的工作总结报告。

要求：
1. 按照项目/事项维度进行分组总结
2. 使用以下格式输出：

TL;DR: 完成了X个功能开发，修复Y个故障等（简短概括）

- 项目 A
  - 进展
    - 完成了 A1
    - 完成了 A2
  - 后续
    - 可以继续做 A4
  - 风险
    - 遇到一些问题...
- 项目 B
  - （同上结构）

注意：
- 仔细分析所有数据源，提取有价值的工作内容
- 忽略系统自动操作（如心跳、健康检查等）
- 对话中讨论的任务和决策应该被纳入总结
- 如果没有足够数据，诚实说明
- 报告用中文撰写
- GitHub 活动数据已作为数据源提供，无需再自行获取

以下是收集到的数据：

${contextParts.join("\n\n")}`;

      // --- 3. Run the summary agent ---
      let report = "";
      try {
        for await (const msg of agentRunner.run({
          agentName: "summary",
          prompt: agentPrompt,
        })) {
          if (msg.type === "result") {
            report = msg.content;
          } else if (msg.type === "error") {
            log.error("agent failed", { error: msg.error });
            return {
              status: "error",
              error: `Summary agent failed: ${msg.error}`,
            };
          }
        }
      } catch (err) {
        log.error("agent runner error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          status: "error",
          error: `Agent runner error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (!report) {
        return { status: "error", error: "Agent produced no output" };
      }

      // --- 4. Optionally send to WeChat ---
      let wechatSent = false;
      if (sendToWechat) {
        // Auto-lookup wechat threadId from channel_mappings if not provided.
        // Find the guardian's wechat ID by joining persons (bond_level='guardian')
        // with channel_mappings.
        let resolvedThreadId = wechatThreadId;
        if (!resolvedThreadId) {
          try {
            const rows = appContext.db.connection.all(
              sql`SELECT cm.channel_user_id
                  FROM channel_mappings cm
                  JOIN persons p ON p.id = cm.person_id
                  WHERE cm.channel = 'wechat' AND p.bond_level = 'guardian'
                  LIMIT 1`,
            ) as ChannelMappingRow[];
            if (rows.length > 0) {
              resolvedThreadId = rows[0].channel_user_id;
              log.info("auto-resolved wechat threadId from guardian", { threadId: resolvedThreadId });
            }
          } catch (err) {
            log.warn("failed to auto-resolve wechat threadId via persons table, falling back to direct lookup", {
              error: err instanceof Error ? err.message : String(err),
            });
            // Fallback: just grab the first wechat mapping
            try {
              const rows = appContext.db.connection.all(
                sql`SELECT channel_user_id FROM channel_mappings WHERE channel = 'wechat' LIMIT 1`,
              ) as ChannelMappingRow[];
              if (rows.length > 0) {
                resolvedThreadId = rows[0].channel_user_id;
                log.info("auto-resolved wechat threadId via fallback", { threadId: resolvedThreadId });
              }
            } catch (fallbackErr) {
              log.warn("fallback wechat lookup also failed", {
                error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
              });
            }
          }
        }

        if (resolvedThreadId) {
          try {
            await appContext.runAction("send_message", {
              channel: "wechat",
              threadId: resolvedThreadId,
              text: report,
            });
            wechatSent = true;
            log.info("report sent to wechat", { threadId: resolvedThreadId });
          } catch (err) {
            log.error("failed to send to wechat", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          log.warn("sendToWechat requested but no wechat threadId found");
        }
      }

      // --- 5. Persist report to DB ---
      let reportId: string | undefined;
      try {
        const repo = createReportsRepository(appContext.db);
        const saved = await repo.save({
          period,
          periodLabel,
          windowHours,
          report,
          rawSources: results,
          sourcesCollected: results.length,
          wechatSent,
        });
        reportId = saved.id;
        log.info("report saved to DB", { reportId });
      } catch (err) {
        log.error("failed to save report to DB", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        status: "ok",
        data: {
          id: reportId,
          report,
          period,
          periodLabel,
          windowHours,
          sourcesCollected: results.length,
          wechatSent,
        },
      };
    },
  };
}
