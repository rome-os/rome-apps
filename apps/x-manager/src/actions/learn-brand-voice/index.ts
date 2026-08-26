import type {
  Action,
  ActionConfig,
  ActionResult,
  AgentRunnerInterface,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { runTwitterCli, parseYamlRecords } from "../../lib/cli.js";
import { createXRepository } from "../../db/repositories/repo.js";

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
          description: "Twitter username to analyze. Defaults to the logged-in user. Can be any account to learn from others.",
        },
        tweetCount: {
          type: "number",
          description: "Number of recent tweets to analyze (default: 50)",
        },
        isOwn: {
          type: "boolean",
          description: "Whether this is the user's own account (default: true if no username specified)",
        },
      },
    },
    async execute(args): Promise<ActionResult> {
      const tweetCount = (args.tweetCount as number) || 50;
      const runId = crypto.randomUUID();
      let repo: ReturnType<typeof createXRepository> | null = null;

      try {
        repo = createXRepository(appContext.db);
        repo.insertActionRun({
          id: runId,
          actionName: "learn-brand-voice",
          status: "running",
          inputJson: JSON.stringify(args),
          startedAt: new Date(),
        });
      } catch { /* best effort */ }

      // Step 1: Get profile info
      const profileArgs = args.username ? [String(args.username)] : [];
      const profileResult = await runTwitterCli("profile", profileArgs);
      if (!profileResult.success) {
        try { repo?.completeActionRun(runId, "error", null, profileResult.stderr); } catch { /* */ }
        return {
          status: "error",
          error: `Failed to fetch profile: ${profileResult.stderr}. Please check X login status first.`,
        };
      }
      const profiles = parseYamlRecords(profileResult.stdout);
      const profile = profiles[0];
      if (!profile || !profile["screen_name"]) {
        try { repo?.completeActionRun(runId, "error", null, "Could not parse profile data"); } catch { /* */ }
        return {
          status: "error",
          error: "Could not parse profile data. Please ensure you are logged in to X.",
        };
      }

      const username = profile["screen_name"]!;
      const isOwn = args.isOwn !== undefined ? Boolean(args.isOwn) : !args.username;

      // Update brand voice status to learning
      try {
        repo?.upsertBrandVoice({
          accountHandle: username,
          isOwn,
          learnStatus: "learning",
          learnProgress: 10,
        });
      } catch { /* best effort */ }

      // Step 2: Fetch recent tweets
      const tweetsResult = await runTwitterCli(
        "tweets",
        [username],
        { limit: String(tweetCount) },
        180_000,
      );
      if (!tweetsResult.success) {
        try {
          repo?.upsertBrandVoice({ accountHandle: username, learnStatus: "error", learnProgress: 0 });
          repo?.completeActionRun(runId, "error", null, tweetsResult.stderr);
        } catch { /* */ }
        return {
          status: "error",
          error: `Failed to fetch tweets for @${username}: ${tweetsResult.stderr}`,
        };
      }
      const tweets = parseYamlRecords(tweetsResult.stdout);

      try {
        repo?.upsertBrandVoice({ accountHandle: username, learnProgress: 40 });
      } catch { /* best effort */ }

      // Step 3: Use an agent to analyze voice and create the memory file
      const memoryFilePath = `memory/x-${username}-brand-voice.md`;
      const analysisPrompt = `Analyze the following X (Twitter) profile and recent tweets to create a comprehensive brand voice profile.

## Profile
- Username: @${username}
- Name: ${profile["name"] || "N/A"}
- Bio: ${profile["bio"] || "N/A"}
- Followers: ${profile["followers"] || "0"}
- Following: ${profile["following"] || "0"}
- Total Tweets: ${profile["tweets"] || "0"}

## Recent Tweets (${tweets.length} tweets)
${tweets.map((t, i) => `
### Tweet ${i + 1}
- Text: ${t["text"] || ""}
- Likes: ${t["likes"] || "0"}
- Retweets: ${t["retweets"] || "0"}
- Replies: ${t["replies"] || "0"}
- Views: ${t["views"] || "0"}
- Is Retweet: ${t["is_retweet"] || "false"}
`).join("\n")}

Based on this data, create a detailed brand voice profile. Write the analysis as a memory file in Markdown format that covers:

1. **Voice & Tone**: How does this person communicate? (formal/informal, serious/humorous, technical/casual)
2. **Topics & Themes**: What subjects do they frequently discuss?
3. **Writing Style**: Sentence length, use of emojis, hashtags, mentions, thread usage
4. **Engagement Patterns**: What types of content get the most engagement?
5. **Language**: Primary language(s), slang patterns, vocabulary level
6. **Content Format**: Do they prefer short tweets, long threads, quote tweets, links?
7. **Posting Patterns**: Frequency, timing observations
8. **Key Phrases & Expressions**: Recurring phrases or stylistic signatures
9. **Audience Interaction Style**: How they respond to followers, tone in replies
10. **Content Strategy Recommendations**: What seems to work best for their audience

Write the file to: ${memoryFilePath}

Make sure the file is comprehensive and actionable — future agents will load this file before creating content or replies for this account.`;

      try {
        repo?.upsertBrandVoice({ accountHandle: username, learnProgress: 50 });
      } catch { /* best effort */ }

      let analysisResult = "";
      for await (const msg of agentRunner.run({
        agentName: "content-editor",
        prompt: analysisPrompt,
      })) {
        if (msg.type === "result") {
          analysisResult = String(msg.content ?? "");
        }
      }

      // Step 4: Update brand voice status to complete
      const data = {
        username,
        tweetsAnalyzed: tweets.length,
        memoryFile: memoryFilePath,
        isOwn,
        message: `Brand voice profile created for @${username} based on ${tweets.length} tweets. Memory file saved at ${memoryFilePath}`,
        analysis: analysisResult,
      };

      try {
        repo?.upsertBrandVoice({
          accountHandle: username,
          isOwn,
          learnStatus: "complete",
          learnProgress: 100,
          memoryFilePath,
          tweetsAnalyzed: tweets.length,
        });
        repo?.completeActionRun(runId, "success", JSON.stringify({ username, tweetsAnalyzed: tweets.length, memoryFile: memoryFilePath }));
      } catch { /* best effort */ }

      return { status: "ok", data };
    },
  };
}
