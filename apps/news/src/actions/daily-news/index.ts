import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
  PersonMappingRepository,
} from "@rome-os/app-runtime";

const log = createAppLogger("daily_news");

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface DailyNewsDeps {
  personMappingRepo: PersonMappingRepository;
}

type DailyNewsRuntimeDeps = AppActionRuntimeDeps<DailyNewsDeps>;

// ---------------------------------------------------------------------------
// News fetching helpers
// ---------------------------------------------------------------------------

interface NewsItem {
  title: string;
  link: string;
}

/** Parse RSS XML and extract <item> title + link pairs. */
function parseRssItems(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const titleMatch = content.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/);
    const linkMatch = content.match(/<link>(.*?)<\/link>/);
    if (titleMatch && linkMatch) {
      items.push({
        title: (titleMatch[1] || titleMatch[2]).trim(),
        link: linkMatch[1].trim(),
      });
    }
  }
  return items;
}

/** Fetch top stories from the HackerNews API (tech news fallback). */
async function fetchHackerNews(limit: number): Promise<NewsItem[]> {
  const res = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!res.ok) throw new Error(`HN API error: ${res.status}`);
  const ids = (await res.json()) as number[];
  const topIds = ids.slice(0, limit);

  const stories = await Promise.all(
    topIds.map(async (id) => {
      const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!storyRes.ok) return null;
      const story = (await storyRes.json()) as {
        title: string;
        url?: string;
        id: number;
      };
      return {
        title: story.title,
        link: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
      };
    }),
  );

  return stories.filter((s): s is NewsItem => s !== null);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatNewsDigest(googleNews: NewsItem[], hackerNews: NewsItem[]): string {
  const lines: string[] = ["\u2600\uFE0F *Good Morning! Here's your daily news digest:*\n"];

  if (googleNews.length > 0) {
    lines.push("\uD83D\uDCF0 *Top Headlines*");
    for (const item of googleNews.slice(0, 8)) {
      lines.push(`\u2022 [${item.title}](${item.link})`);
    }
    lines.push("");
  }

  if (hackerNews.length > 0) {
    lines.push("\uD83D\uDCBB *Tech & HackerNews*");
    for (const item of hackerNews.slice(0, 5)) {
      lines.push(`\u2022 [${item.title}](${item.link})`);
    }
    lines.push("");
  }

  lines.push("_Have a great day!_ \uD83D\uDE80");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Action factory
// ---------------------------------------------------------------------------

export function createDailyNewsAction(config: ActionConfig, deps: DailyNewsRuntimeDeps): Action {
  return {
    config,
    // No inputSchema — not agent-callable
    async execute(_args: Record<string, unknown>): Promise<ActionResult> {
      try {
        const guardians = await deps.personMappingRepo.findByBondLevel("guardian");
        if (guardians.length === 0) {
          log.warn("no guardian found, skipping news digest");
          return { status: "error", error: "No guardian found in person mappings" };
        }

        const guardian = guardians[0];
        const telegramMapping = guardian.channelMappings.find((m) => m.channel === "telegram");
        if (!telegramMapping) {
          log.warn("guardian has no Telegram mapping, skipping news digest");
          return { status: "error", error: "Guardian has no Telegram channel mapping" };
        }

        const channelUserId = telegramMapping.channelUserId;

        let googleNews: NewsItem[] = [];
        try {
          const rssRes = await fetch("https://news.google.com/rss", {
            headers: { "User-Agent": "Rome-Agent/1.0" },
          });
          if (rssRes.ok) {
            const xml = await rssRes.text();
            googleNews = parseRssItems(xml);
          }
        } catch (err) {
          log.warn("Failed to fetch Google News RSS", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        let hackerNews: NewsItem[] = [];
        try {
          hackerNews = await fetchHackerNews(5);
        } catch (err) {
          log.warn("Failed to fetch HackerNews", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        if (googleNews.length === 0 && hackerNews.length === 0) {
          log.warn("No news fetched from any source");
          return { status: "error", error: "Failed to fetch news from all sources" };
        }

        const text = formatNewsDigest(googleNews, hackerNews);
        await deps.appContext.runAction("send_message", {
          channel: "telegram",
          threadId: channelUserId,
          text,
          channelUserId,
        });

        log.info("sent daily news digest", {
          googleNewsCount: googleNews.length,
          hackerNewsCount: hackerNews.length,
        });

        return {
          status: "ok",
          data: {
            googleNewsCount: googleNews.length,
            hackerNewsCount: hackerNews.length,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error("daily_news failed", { error: errorMsg });
        return { status: "error", error: errorMsg };
      }
    },
  };
}

export function createAction(
  config: ActionConfig,
  deps: DailyNewsRuntimeDeps,
): Action {
  return createDailyNewsAction(config, deps);
}
