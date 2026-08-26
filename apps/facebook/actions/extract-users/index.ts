import type {
  Action,
  ActionConfig,
  ActionResult,
  BrowserCapabilityDiscovery,
} from "@rome-os/app-runtime";
import {
  buildBrowserScriptExpression,
  runDiscoveredBrowserScript,
} from "@rome-os/app-runtime";

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);
const SCRAPER_SCRIPT_URL = new URL("./scraping_scripts/extract_users.js", import.meta.url);

export interface ExtractUsersDeps {
  capabilityDiscovery: BrowserCapabilityDiscovery;
}

interface ExtractedComment {
  name?: string;
  profileUrl?: string;
  comment?: string;
  postIndex?: number;
}

interface ExtractedPost {
  postIndex?: number;
  comments?: ExtractedComment[];
}

export function isSupportedFacebookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && FACEBOOK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeNumPosts(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("numPosts must be a positive number");
  }

  return Math.floor(value);
}

export function buildExtractionExpression(scriptSource: string, numPosts?: number): string {
  return buildBrowserScriptExpression({
    scriptSource,
    entrypointExpression: "extractFacebookCommenters",
    args: [{ maxPosts: numPosts }],
    autorunFlag: "__ROME_FACEBOOK_EXTRACT_USERS_AUTORUN__",
    missingEntrypointMessage:
      "extractFacebookCommenters is not defined after loading the scraper",
  });
}

function dedupeUsers(posts: ExtractedPost[]): Array<{
  name: string;
  profileUrl: string;
  comments: string[];
  postIndexes: number[];
}> {
  const users = new Map<
    string,
    {
      name: string;
      profileUrl: string;
      comments: string[];
      postIndexes: number[];
    }
  >();

  for (const post of posts) {
    for (const comment of post.comments ?? []) {
      if (!comment.name || !comment.profileUrl) {
        continue;
      }

      const key = `${comment.name}|||${comment.profileUrl}`;
      const current = users.get(key) ?? {
        name: comment.name,
        profileUrl: comment.profileUrl,
        comments: [],
        postIndexes: [],
      };

      if (comment.comment && !current.comments.includes(comment.comment)) {
        current.comments.push(comment.comment);
      }
      if (
        typeof comment.postIndex === "number" &&
        Number.isFinite(comment.postIndex) &&
        !current.postIndexes.includes(comment.postIndex)
      ) {
        current.postIndexes.push(comment.postIndex);
      }

      users.set(key, current);
    }
  }

  return Array.from(users.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export async function extractUsers(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  input: {
    url: string;
    numPosts?: number;
  },
): Promise<{
  url: string;
  numPosts?: number;
  browser: { name: string; browserUrl: string };
  posts: ExtractedPost[];
  users: Array<{
    name: string;
    profileUrl: string;
    comments: string[];
    postIndexes: number[];
  }>;
  counts: {
    posts: number;
    users: number;
    comments: number;
  };
}> {
  const browserRun = await runDiscoveredBrowserScript<ExtractedPost[]>(
    capabilityDiscovery,
    {
      pageUrl: input.url,
      scriptUrl: SCRAPER_SCRIPT_URL,
      entrypointExpression: "extractFacebookCommenters",
      args: [{ maxPosts: input.numPosts }],
      autorunFlag: "__ROME_FACEBOOK_EXTRACT_USERS_AUTORUN__",
      missingEntrypointMessage:
        "extractFacebookCommenters is not defined after loading the scraper",
    },
  );

  try {
    const { endpoint, result } = browserRun;
    const posts = Array.isArray(result) ? result : [];
    const users = dedupeUsers(posts);
    const commentCount = posts.reduce((sum, post) => sum + (post.comments?.length ?? 0), 0);

    return {
      url: input.url,
      numPosts: input.numPosts,
      browser: {
        name: endpoint.name,
        browserUrl: endpoint.browserUrl,
      },
      posts,
      users,
      counts: {
        posts: posts.length,
        users: users.length,
        comments: commentCount,
      },
    };
  } finally {
    await browserRun.close();
  }
}

export function createExtractUsersAction(
  config: ActionConfig,
  deps: ExtractUsersDeps,
): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Facebook page URL, for example https://www.facebook.com/sfmoma/",
        },
        numPosts: {
          type: "number",
          description: "Optional number of feed posts to inspect before stopping",
        },
      },
      required: ["url"],
    },
    execute: async (args: Record<string, unknown>): Promise<ActionResult> => {
      try {
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!url) {
          return { status: "error", error: "url is required" };
        }
        if (!isSupportedFacebookUrl(url)) {
          return { status: "error", error: "url must be a valid Facebook page URL" };
        }

        const numPosts = normalizeNumPosts(args.numPosts);
        const data = await extractUsers(deps.capabilityDiscovery, { url, numPosts });
        return { status: "ok", data };
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createAction(config: ActionConfig, deps: ExtractUsersDeps): Action {
  return createExtractUsersAction(config, deps);
}
