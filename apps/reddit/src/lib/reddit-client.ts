import { randomUUID } from "node:crypto";

const REDDITWARP_INSTALLED_CLIENT_ID = "Jirijsc5rRo79AzJBUttyQ";
const DEVICE_ID = randomUUID();
const USER_AGENT = "nodejs:rome.reddit.app:v0.1.0 (installed-client)";

let cachedToken: { token: string; expiresAt: number } | null = null;

interface SnoowrapPost {
  id: string;
  title: string;
  subreddit: string | { display_name: string };
  author: string | { name: string };
  score: number;
  num_comments: number;
  permalink: string;
  url: string;
  selftext: string;
  created_utc: number;
}

interface SnoowrapInstance {
  config: (options: Record<string, unknown>) => void;
  search: (options: Record<string, unknown>) => Promise<SnoowrapPost[]>;
}

export interface RedditSearchPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  url?: string;
  selftext?: string;
  createdUtc: number;
}

function mapPost(post: SnoowrapPost): RedditSearchPost {
  return {
    id: post.id,
    title: post.title,
    subreddit: typeof post.subreddit === "string" ? post.subreddit : post.subreddit.display_name,
    author:
      typeof post.author === "string"
        ? post.author || "[deleted]"
        : post.author?.name || "[deleted]",
    score: post.score,
    numComments: post.num_comments,
    permalink: post.permalink,
    url: post.url || undefined,
    selftext: post.selftext || undefined,
    createdUtc: post.created_utc,
  };
}

async function fetchInstalledClientAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${REDDITWARP_INSTALLED_CLIENT_ID}:`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "https://oauth.reddit.com/grants/installed_client",
    device_id: DEVICE_ID,
  });

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Reddit token request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("Reddit token request returned no access token");
  }

  const expiresIn = payload.expires_in ?? 3_600;
  cachedToken = {
    token: payload.access_token,
    expiresAt: now + (expiresIn - 60) * 1_000,
  };

  return cachedToken.token;
}

async function createRedditClient(): Promise<SnoowrapInstance> {
  const accessToken = await fetchInstalledClientAccessToken();
  const module = (await import("snoowrap")) as unknown as {
    default: new (options: { userAgent: string; accessToken: string }) => SnoowrapInstance;
  };

  const client = new module.default({
    userAgent: USER_AGENT,
    accessToken,
  });

  // snoowrap starts its delay window at -Infinity, which triggers a noisy
  // TimeoutNegativeWarning on the first request when requestDelay is enabled.
  (client as unknown as { _nextRequestTimestamp: number })._nextRequestTimestamp = Date.now();

  client.config({
    requestDelay: 1_000,
  });

  return client;
}

export async function searchRedditPosts(options: {
  query: string;
  subreddit: string;
  sort?: "new" | "relevance" | "comments";
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
  limit?: number;
}): Promise<RedditSearchPost[]> {
  const client = await createRedditClient();
  const results = await client.search({
    query: options.query,
    subreddit: options.subreddit,
    sort: options.sort ?? "new",
    time: options.time ?? "week",
    limit: options.limit ?? 10,
  });

  return results.map(mapPost);
}
