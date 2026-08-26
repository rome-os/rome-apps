import { randomUUID } from "crypto";

const CLIENT_ID = "Jirijsc5rRo79AzJBUttyQ";
const DEVICE_ID = randomUUID();
const USER_AGENT = "nodejs:rome-reddit:v1.0.0 (anonymous)";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchAnonymousToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const postData =
    `grant_type=${encodeURIComponent("https://oauth.reddit.com/grants/installed_client")}` +
    `&device_id=${DEVICE_ID}`;

  const auth = Buffer.from(`${CLIENT_ID}:`).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: postData,
  });

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error(`Reddit token error: ${JSON.stringify(data)}`);
  }

  const expiresIn = data.expires_in ?? 3600;
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (expiresIn - 60) * 1000,
  };

  return cachedToken.token;
}

type SnoowrapInstance = {
  search: (opts: Record<string, unknown>) => Promise<SnoowrapPost[]>;
  getHot: (sub: string, opts: Record<string, unknown>) => Promise<SnoowrapPost[]>;
  getNew: (sub: string, opts: Record<string, unknown>) => Promise<SnoowrapPost[]>;
  getTop: (sub: string, opts: Record<string, unknown>) => Promise<SnoowrapPost[]>;
  config: (opts: Record<string, unknown>) => void;
};

interface SnoowrapPost {
  id: string;
  title: string;
  subreddit: { display_name: string };
  author: { name: string };
  score: number;
  num_comments: number;
  permalink: string;
  selftext: string;
  created_utc: number;
}

async function createRedditClient(): Promise<SnoowrapInstance> {
  const accessToken = await fetchAnonymousToken();

  // snoowrap is CJS, need dynamic import
  const mod = await import("snoowrap");
  const Snoowrap = mod.default;

  const client = new Snoowrap({
    userAgent: USER_AGENT,
    accessToken,
  }) as unknown as SnoowrapInstance;

  client.config({ requestDelay: 1000, continueAfterRatelimitError: true });
  return client;
}

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  selftext: string;
  createdUtc: number;
}

function mapPost(post: SnoowrapPost): RedditPost {
  return {
    id: post.id,
    title: post.title,
    subreddit: typeof post.subreddit === "string" ? post.subreddit : post.subreddit.display_name,
    author: typeof post.author === "string" ? post.author : post.author.name,
    score: post.score,
    numComments: post.num_comments,
    permalink: post.permalink,
    selftext: post.selftext,
    createdUtc: post.created_utc,
  };
}

export async function searchReddit(
  query: string,
  opts?: {
    subreddit?: string;
    sort?: string;
    time?: string;
    limit?: number;
  },
): Promise<RedditPost[]> {
  const client = await createRedditClient();
  const results = await client.search({
    query,
    subreddit: opts?.subreddit,
    sort: opts?.sort ?? "relevance",
    time: opts?.time ?? "all",
    limit: opts?.limit ?? 25,
  });
  return results.map(mapPost);
}

export async function getSubredditPosts(
  action: "hot" | "new" | "top",
  opts: {
    subreddit: string;
    limit?: number;
    time?: string;
  },
): Promise<RedditPost[]> {
  const client = await createRedditClient();
  const limit = opts.limit ?? 25;

  let results: SnoowrapPost[];
  switch (action) {
    case "hot":
      results = await client.getHot(opts.subreddit, { limit });
      break;
    case "new":
      results = await client.getNew(opts.subreddit, { limit });
      break;
    case "top":
      results = await client.getTop(opts.subreddit, { limit, time: opts.time ?? "day" });
      break;
  }
  return results.map(mapPost);
}
