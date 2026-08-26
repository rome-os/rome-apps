export interface AiAgentScanConfig {
  scanName: string;
  queries: string[];
  subreddits: string[];
  sort: "new" | "relevance" | "comments";
  time: "hour" | "day" | "week" | "month" | "year" | "all";
  limitPerQuery: number;
  interRequestDelayMs: number;
}

export const DEFAULT_AI_AGENT_SCAN_CONFIG: AiAgentScanConfig = {
  scanName: "ai_agents",
  queries: [
    '"AI agent" OR "AI agents" OR "agentic AI"',
    '"LLM agent" OR "coding agent" OR "browser agent"',
    '"multi-agent" OR "multi agent" OR "agent orchestration"',
    '"autonomous agent" OR "AI workflow" OR "agent workflow"',
  ],
  subreddits: [
    "artificial",
    "LocalLLaMA",
    "MachineLearning",
    "OpenAI",
    "singularity",
    "programming",
    "technology",
  ],
  sort: "new",
  time: "week",
  limitPerQuery: 15,
  interRequestDelayMs: 1_200,
};

export function resolveAiAgentScanConfig(
  overrides: Partial<AiAgentScanConfig> = {},
): AiAgentScanConfig {
  return {
    ...DEFAULT_AI_AGENT_SCAN_CONFIG,
    ...overrides,
    queries: overrides.queries ?? DEFAULT_AI_AGENT_SCAN_CONFIG.queries,
    subreddits: overrides.subreddits ?? DEFAULT_AI_AGENT_SCAN_CONFIG.subreddits,
  };
}
