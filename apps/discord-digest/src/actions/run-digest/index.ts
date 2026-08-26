import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  createAppLogger,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AgentRunnerInterface,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { isAllowedDiscordAttachmentUrl } from "../../attachments/extract.js";
import { createDigestRepository } from "../../db/repositories/digest.js";

const execFileAsync = promisify(execFile);
const MAX_PRS_PER_REPO = 50;
const VALID_REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const GITHUB_TOKEN_FILE = process.env.ROME_GITHUB_TOKEN_FILE?.trim() || "/run/rome/github-oauth-token";

async function readGithubAccessToken(): Promise<string | null> {
  try {
    const token = (await readFile(GITHUB_TOKEN_FILE, "utf8")).trim();
    return token || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

interface GithubPr {
  number: number;
  title: string;
  state: string;
  url: string;
  author?: { login?: string } | null;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  isDraft?: boolean;
  additions?: number;
  deletions?: number;
  labels?: { name: string }[];
}

async function fetchPrsForRepo(token: string, repoSlug: string, sinceIso: string): Promise<{ prs: GithubPr[]; error?: string }> {
  if (!VALID_REPO_SLUG.test(repoSlug)) {
    return { prs: [], error: `Invalid repo slug: ${repoSlug}` };
  }
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "all",
        "--limit",
        String(MAX_PRS_PER_REPO),
        "--search",
        `updated:>=${sinceIso}`,
        "--json",
        "number,title,state,url,author,createdAt,updatedAt,closedAt,mergedAt,isDraft,additions,deletions,labels",
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 30_000, env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } },
    );
    const parsed = JSON.parse(stdout) as GithubPr[];
    return { prs: Array.isArray(parsed) ? parsed : [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { prs: [], error: message };
  }
}

function formatPr(repoSlug: string, pr: GithubPr): string {
  const author = pr.author?.login ?? "unknown";
  const status = pr.mergedAt
    ? "merged"
    : pr.state?.toLowerCase() === "closed"
      ? "closed"
      : pr.isDraft
        ? "draft"
        : "open";
  const labels = pr.labels?.map((l) => l.name).filter(Boolean).join(", ");
  const stats =
    typeof pr.additions === "number" && typeof pr.deletions === "number"
      ? ` +${pr.additions}/-${pr.deletions}`
      : "";
  const updated = pr.updatedAt ? ` updated=${pr.updatedAt}` : "";
  const merged = pr.mergedAt ? ` merged=${pr.mergedAt}` : pr.closedAt ? ` closed=${pr.closedAt}` : "";
  return `- [${repoSlug}#${pr.number}] (${status}) ${pr.title} — @${author}${stats}${labels ? ` [${labels}]` : ""}${updated}${merged}\n  ${pr.url}`;
}

async function buildGithubPrSection(repos: string[], windowHours: number): Promise<string> {
  if (repos.length === 0) return "";
  const token = await readGithubAccessToken();
  if (!token) {
    return [
      "## GitHub pull requests",
      `_GitHub is not connected in Rome (Settings → Integrations). Skipped PR activity for: ${repos.join(", ")}._`,
    ].join("\n\n");
  }
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const results = await Promise.all(repos.map((slug) => fetchPrsForRepo(token, slug, sinceIso).then((r) => ({ slug, ...r }))));

  const sections: string[] = [
    "## GitHub pull requests",
    `Pull requests updated since ${sinceIso} (last ${windowHours} hours) in the user-selected repos. Summarize what's shipping, what's stuck, and notable activity. Group by repo when there are multiple repos; mention numbers and authors.`,
  ];
  for (const { slug, prs, error } of results) {
    if (error) {
      sections.push(`### ${slug}\n_Could not fetch PRs: ${error}_`);
      continue;
    }
    if (prs.length === 0) {
      sections.push(`### ${slug}\n_No PR activity in this window._`);
      continue;
    }
    sections.push(`### ${slug}\n${prs.map((pr) => formatPr(slug, pr)).join("\n")}`);
  }
  return sections.join("\n\n");
}

const log = createAppLogger("discord-digest_run_digest");

const MAX_HISTORY_PROMPT_CHARS = 60_000;
const MAX_MANIFEST_ENTRIES = 100;
const MAX_LINK_MANIFEST_ENTRIES = 80;
const MAX_LINK_CONTEXT_CHARS = 220;

interface RunDigestInput {
  configId?: string;
  channel?: string;
  threadId?: string;
  windowHours?: number;
  style?: string;
  send?: boolean;
  githubRepos?: string[];
}

interface SummarizerOutput {
  markdown?: string;
  messageCountEstimate?: number;
}

interface HistoryAttachment {
  type?: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
  caption?: string;
  localPath?: string;
  size?: number;
}

interface HistoryMessage {
  id?: string;
  displayName?: string;
  timestamp?: string | Date;
  text?: string;
  attachments?: HistoryAttachment[];
}

interface SharedLink {
  url: string;
  displayUrl: string;
  domain: string;
  count: number;
  senders: string[];
  firstSeen?: string;
  lastSeen?: string;
  // Internal only: small windows around the URL are used to infer signals.
  // They are intentionally not emitted in the Link index, because the original
  // message history already contains the surrounding conversation.
  contexts: string[];
  signals: string[];
}

interface FetchHistoryData {
  content?: string;
  messageCount?: number;
  windowHours?: number;
  messages?: HistoryMessage[];
}

type RunDigestDeps = AppActionRuntimeDeps<{ agentRunner: AgentRunnerInterface }>;

function friendlyFetchHistoryError(channel: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.includes("Channel adapter not running") || raw.includes("not configured or not running")) {
    const label = channel === "discord" ? "Discord" : `Channel adapter "${channel}"`;
    return `${label} is not connected in Rome yet. Open Settings → Channels, connect Discord with a bot token, invite the bot to the server, and give it View Channel + Read Message History permissions before running Preview.`;
  }
  return `fetch_channel_history failed: ${raw || "unknown error"}`;
}

function extractHistoryContent(history: unknown): string {
  if (typeof history === "string") return history;
  if (history && typeof history === "object") {
    const data = history as FetchHistoryData;
    if (typeof data.content === "string") return data.content;
  }
  return JSON.stringify(history, null, 2);
}

function normalizeAttachmentPlaceholders(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const attachmentOnly = line.match(/^(?<prefix>\[[^\]]+\]\s+\*\*[^*]+\*\*:\s*)(?:FILE|File|file)\s+\[attachments:\s*(?<files>[^\]]+)\]\s*$/u);
      if (attachmentOnly?.groups) {
        return `${attachmentOnly.groups.prefix}shared file(s): ${attachmentOnly.groups.files}`;
      }

      const emptyAttachment = line.match(/^(?<prefix>\[[^\]]+\]\s+\*\*[^*]+\*\*:\s*)\[attachments:\s*(?<files>[^\]]+)\]\s*$/u);
      if (emptyAttachment?.groups) {
        return `${emptyAttachment.groups.prefix}shared file(s): ${emptyAttachment.groups.files}`;
      }

      return line.replace(/\b(?:FILE|File|file)\s+(\[attachments:\s*[^\]]+\])/gu, "shared file(s) $1");
    })
    .join("\n");
}

function collectStructuredAttachments(history: unknown): { message: HistoryMessage; attachment: HistoryAttachment }[] {
  if (!history || typeof history !== "object") return [];
  const data = history as FetchHistoryData;
  if (!Array.isArray(data.messages)) return [];

  const collected: { message: HistoryMessage; attachment: HistoryAttachment }[] = [];
  for (const message of data.messages) {
    if (!message || !Array.isArray(message.attachments)) continue;
    for (const attachment of message.attachments) {
      if (attachment && typeof attachment === "object") collected.push({ message, attachment });
    }
  }
  return collected;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentLabel(attachment: HistoryAttachment): string {
  const parts = [attachment.type ?? "file"];
  if (attachment.fileName) parts.push(attachment.fileName);
  if (attachment.mimeType) parts.push(attachment.mimeType);
  if (typeof attachment.size === "number" && Number.isFinite(attachment.size)) parts.push(formatBytes(attachment.size));
  return parts.join(" · ");
}

function truncateForPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trim()}\n...[truncated ${value.length - maxChars} chars]`;
}

// Build a metadata-only manifest of shared files. We deliberately do NOT
// extract excerpts here: the summarizer agent reads a file on demand via the
// `discord-digest_read_attachment` tool, so irrelevant attachments cost nothing.
function buildAttachmentManifest(history: unknown): string {
  const attachments = collectStructuredAttachments(history).slice(0, MAX_MANIFEST_ENTRIES);
  if (attachments.length === 0) return "";

  const lines: string[] = [
    "## Shared files (attachments)",
    "Discord FILE placeholders in the history above mean someone shared an attachment; they are not literal message text.",
    "To read a file's contents, invoke the `discord-digest_read_attachment` action. Actions are called via the `execute_action` tool with `action_name: \"discord-digest_read_attachment\"` and `json_args: { url, fileName?, mimeType?, offset?, limit? }`. It returns extracted text for text files and PDF/Word documents, and supports `offset`/`limit` (1-based line range) for paging through large files.",
    "Decide for yourself which files (if any) are worth reading — use the surrounding conversation, filenames, types, sizes, and captions as your guide. Reading is optional; each read uses one of your turns, so prioritize.",
    "Text files and PDF/Word documents can be read. Images and other binaries cannot — describe those by their metadata only.",
  ];

  for (const [index, { message, attachment }] of attachments.entries()) {
    const when = message.timestamp ? new Date(message.timestamp).toISOString() : "unknown time";
    const who = message.displayName ?? "unknown sender";
    const caption = attachment.caption ? ` caption=${JSON.stringify(attachment.caption)}` : "";
    const url = attachment.url ? ` url=${attachment.url}` : " (no url — cannot be read)";
    lines.push(`- File ${index + 1}: ${attachmentLabel(attachment)} — shared by ${who} at ${when}.${caption}${url}`);
  }

  return lines.join("\n");
}

function trimUrlCandidate(raw: string): string {
  let value = raw.trim();
  // Drop common punctuation that Discord/users put after a URL in prose.
  while (/[.,!?;:'"\u2019\u201d>\]\u3011\u300b]+$/u.test(value)) value = value.slice(0, -1);
  // For Markdown/autolinks like "(https://example.com/foo)", remove only
  // unmatched closing brackets so legitimate URL parentheses survive.
  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
  ];
  for (const [open, close] of pairs) {
    while (value.endsWith(close)) {
      const opens = [...value].filter((char) => char === open).length;
      const closes = [...value].filter((char) => char === close).length;
      if (closes <= opens) break;
      value = value.slice(0, -1);
    }
  }
  return value;
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/\bhttps?:\/\/[^\s<>"'`]+/giu) ?? [];
  const urls: string[] = [];
  for (const match of matches) {
    const candidate = trimUrlCandidate(match);
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.username || url.password) continue;
      if (isAllowedDiscordAttachmentUrl(url.href)) continue;
      url.hash = "";
      urls.push(url.href);
    } catch {
      // Ignore malformed URL-like text.
    }
  }
  return urls;
}

const TRACKING_QUERY_PREFIXES = ["utm_"];
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
]);

function linkDedupeKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_QUERY_KEYS.has(lower) || TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.href;
}

function compactContext(text: string, url: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  const index = normalized.indexOf(url);
  if (index < 0) return truncateForPrompt(normalized, MAX_LINK_CONTEXT_CHARS);
  const start = Math.max(0, index - Math.floor(MAX_LINK_CONTEXT_CHARS / 2));
  const end = Math.min(normalized.length, index + url.length + Math.floor(MAX_LINK_CONTEXT_CHARS / 2));
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function timestampToIso(timestamp?: string | Date): string | undefined {
  if (!timestamp) return undefined;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function displayUrl(value: string): string {
  if (value.length <= 240) return value;
  try {
    const url = new URL(value);
    const base = `${url.origin}${url.pathname}`;
    return base.length <= 220 ? `${base}?…` : `${base.slice(0, 220)}…`;
  } catch {
    return `${value.slice(0, 220)}…`;
  }
}

function addSharedLink(
  links: Map<string, SharedLink>,
  rawUrl: string,
  options: { sender?: string; timestamp?: string; context?: string },
): void {
  let key: string;
  let parsed: URL;
  try {
    key = linkDedupeKey(rawUrl);
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  const existing = links.get(key);
  const sender = options.sender?.trim() || "unknown sender";
  const context = options.context?.trim();
  if (existing) {
    existing.count += 1;
    if (!existing.senders.includes(sender)) existing.senders.push(sender);
    if (options.timestamp) existing.lastSeen = options.timestamp;
    if (context && !existing.contexts.includes(context) && existing.contexts.length < 3) existing.contexts.push(context);
    return;
  }

  links.set(key, {
    url: rawUrl,
    displayUrl: displayUrl(rawUrl),
    domain: parsed.hostname.toLowerCase(),
    count: 1,
    senders: [sender],
    firstSeen: options.timestamp,
    lastSeen: options.timestamp,
    contexts: context ? [context] : [],
    signals: [],
  });
}

function contextSignals(text: string): string[] {
  const lowered = text.toLowerCase();
  const signals: string[] = [];
  if (/(?:\u770b|\u9605\u8bfb|\u53c2\u8003|\u94fe\u63a5|\u6587\u6863|\u63d0\u6848|\u65b9\u6848|\u516c\u544a|\u6765\u6e90|\u539f\u6587|review|read|see|check|source|announce|proposal|spec|doc|rfc)/iu.test(lowered)) {
    signals.push("context asks readers to inspect it");
  }
  if (/(?:\u51b3\u5b9a|\u7ed3\u8bba|\u963b\u585e|\u95ee\u9898|bug|fix|release|decision|blocked|issue|problem|incident|launch)/iu.test(lowered)) {
    signals.push("near decision/problem language");
  }
  return signals;
}

function inferLinkSignals(link: SharedLink): string[] {
  const url = new URL(link.url);
  const path = url.pathname.toLowerCase();
  const domain = link.domain;
  const signals = new Set<string>();

  if (link.count > 1) signals.add(`mentioned ${link.count}x`);
  if (domain === "github.com" && /\/(?:pull|issues)\/\d+/u.test(path)) signals.add("GitHub PR/issue");
  else if (domain === "github.com") signals.add("GitHub link");
  if (/(^|\.)docs\.google\.com$/u.test(domain) || /(^|\.)notion\.site$/u.test(domain) || /(^|\.)notion\.so$/u.test(domain)) {
    signals.add("document link");
  }
  if (/(^|\.)figma\.com$/u.test(domain)) signals.add("design link");
  if (path.endsWith(".pdf")) signals.add("PDF");
  if (path.endsWith(".md") || path.endsWith(".txt") || path.endsWith(".json")) signals.add("text-like file");
  for (const context of link.contexts) {
    for (const signal of contextSignals(context)) signals.add(signal);
  }

  return [...signals];
}

function collectSharedLinks(history: unknown): SharedLink[] {
  const links = new Map<string, SharedLink>();
  if (history && typeof history === "object" && Array.isArray((history as FetchHistoryData).messages)) {
    for (const message of (history as FetchHistoryData).messages ?? []) {
      const parts = [message.text, ...(message.attachments ?? []).map((attachment) => attachment.caption)].filter(
        (part): part is string => typeof part === "string" && part.trim().length > 0,
      );
      const combined = parts.join("\n");
      if (!combined) continue;
      const sender = message.displayName ?? "unknown sender";
      const timestamp = timestampToIso(message.timestamp);
      for (const url of extractUrlsFromText(combined)) {
        addSharedLink(links, url, {
          sender,
          timestamp,
          context: compactContext(combined, url),
        });
      }
    }
  }

  if (links.size === 0) {
    for (const line of extractHistoryContent(history).split("\n")) {
      if (!line.trim()) continue;
      const sender = line.match(/^\[[^\]]+\]\s+\*\*(?<sender>[^*]+)\*\*:/u)?.groups?.sender;
      for (const url of extractUrlsFromText(line)) {
        addSharedLink(links, url, {
          sender,
          context: compactContext(line, url),
        });
      }
    }
  }

  const result = [...links.values()].map((link) => ({ ...link, signals: inferLinkSignals(link) }));
  return result.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

// Build a compact index of ordinary web links. As with attachments, we do not
// expand every URL up front: the summarizer decides which links need inspection
// and reads them progressively via `discord-digest_read_link`.
//
// The index deliberately omits surrounding context snippets. Those snippets are
// already present in the channel history above; repeating them here wastes
// prompt budget. We keep only normalized link metadata and relevance hints.
function buildLinkManifest(history: unknown): string {
  const links = collectSharedLinks(history).slice(0, MAX_LINK_MANIFEST_ENTRIES);
  if (links.length === 0) return "";

  const lines: string[] = [
    "## Link index",
    "Compact index of ordinary http(s) links found in the channel history. It avoids repeating surrounding message text; use the original history for context. Discord attachment CDN URLs are listed separately as files, not here.",
    "To inspect a link, invoke the `discord-digest_read_link` action. Actions are called via the `execute_action` tool with `action_name: \"discord-digest_read_link\"` and `json_args: { url, mode?, offset?, limit? }`.",
    "`mode: \"metadata\"` returns title/description/content-type/final URL when available. `mode: \"excerpt\"` returns readable text lines for public HTML/text/PDF links and supports `offset`/`limit` paging.",
    "Inspect links only when the surrounding discussion, link type, repetition, or decision/problem signals make the link important to the digest. Prefer metadata first, then read excerpts only if the metadata/original message context is not enough.",
    "If you did not inspect a link, do not summarize its contents; only say that a link was shared or infer cautiously from the surrounding conversation. If inspection fails, mention that it was unavailable only when relevant.",
  ];

  for (const [index, link] of links.entries()) {
    const senders = link.senders.slice(0, 4).join(", ");
    const extraSenders = link.senders.length > 4 ? ` +${link.senders.length - 4} more` : "";
    const when =
      link.firstSeen && link.lastSeen && link.firstSeen !== link.lastSeen
        ? ` first=${link.firstSeen} last=${link.lastSeen}`
        : link.firstSeen
          ? ` at=${link.firstSeen}`
          : "";
    const signals = link.signals.length > 0 ? ` signals=${link.signals.join(", ")}` : "";
    lines.push(
      `- L${index + 1}: ${link.displayUrl} — domain=${link.domain}; mentioned=${link.count}x by ${senders}${extraSenders}.${when}${signals}`,
    );
  }

  return lines.join("\n");
}

function buildHistoryContext(history: unknown): string {
  const content = normalizeAttachmentPlaceholders(extractHistoryContent(history));
  const manifest = buildAttachmentManifest(history);
  const linkManifest = buildLinkManifest(history);
  const combined = [content, manifest, linkManifest].filter((part) => part.trim().length > 0).join("\n\n---\n\n");
  return truncateForPrompt(combined, MAX_HISTORY_PROMPT_CHARS);
}

function fallbackSummary(history: unknown, windowHours: number): string {
  const text = normalizeAttachmentPlaceholders(extractHistoryContent(history));
  if (!text || text.trim().length < 20) {
    return `**Discord digest**\n\nNo meaningful channel activity found in the last ${windowHours} hours.`;
  }
  return `**Discord digest**\n\nI found recent activity from the last ${windowHours} hours, but the summarizer did not return a structured digest. Here is a compact excerpt:\n\n${text.slice(0, 1200)}`;
}

export function createAction(config: ActionConfig, deps: RunDigestDeps): Action {
  const { agentRunner, appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        configId: { type: "string", description: "Saved digest configuration ID" },
        channel: { type: "string", description: "Channel adapter name; defaults to discord" },
        threadId: { type: "string", description: "Discord channel/thread ID to summarize" },
        windowHours: { type: "number", description: "How many hours back to summarize" },
        style: { type: "string", description: "Tone guidance for the summary" },
        send: { type: "boolean", description: "Whether to send the digest back to Discord" },
        githubRepos: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of GitHub repos (owner/repo) whose recent PR activity should be included in the digest.",
        },
      },
      additionalProperties: false,
    },

    async execute(rawInput: Record<string, unknown>): Promise<ActionResult> {
      const input = rawInput as RunDigestInput;
      const repo = createDigestRepository(appContext.db);
      const saved = input.configId ? repo.getConfig(input.configId) : undefined;

      if (input.configId && !saved) {
        return { status: "error", error: `No Discord Digest config found for ${input.configId}` };
      }
      if (saved && !saved.active) {
        return { status: "ok", data: { skipped: true, reason: "config_inactive", configId: saved.id } };
      }

      const channel = input.channel ?? saved?.channel ?? "discord";
      const threadId = input.threadId ?? saved?.threadId;
      const windowHours = Number(input.windowHours ?? saved?.windowHours ?? 24);
      const style = input.style ?? saved?.style ?? "friendly";
      const shouldSend = Boolean(input.send ?? saved?.sendAsBot ?? true);
      const githubRepos = (input.githubRepos ?? saved?.githubRepos ?? []).filter(
        (slug): slug is string => typeof slug === "string" && VALID_REPO_SLUG.test(slug),
      );

      if (!threadId || !threadId.trim()) {
        return { status: "error", error: "threadId is required. Paste a Discord channel ID in the app UI." };
      }
      if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > 168) {
        return { status: "error", error: "windowHours must be between 1 and 168." };
      }

      const run = repo.createRun({ configId: saved?.id ?? null, channel, threadId, windowHours });
      log.info("starting discord digest run", { runId: run.id, configId: saved?.id, threadId, windowHours });

      try {
        const history = await appContext.runAction("fetch_channel_history", {
          channel,
          threadId,
          windowHours,
          // Opt in to the structured `messages` array so buildAttachmentManifest
          // can read per-message attachment metadata (url/fileName/mimeType) and
          // advertise each file's url to the agent. Without this the action
          // returns only the flattened `content` string and no file can be read.
          includeMessages: true,
        });
        if (history.status !== "ok") {
          const friendly = friendlyFetchHistoryError(channel, history.status === "error" ? history.error : undefined);
          repo.failRun(run.id, friendly);
          return { status: "error", error: friendly };
        }

        const historyContext = buildHistoryContext(history.data);
        const githubSection = await buildGithubPrSection(githubRepos, windowHours);
        let structured: SummarizerOutput | undefined;
        let resultText = "";
        const prompt = [
          `Summarize this Discord channel for a periodic bot digest.`,
          `Tone/style: ${style}.`,
          `Time window: last ${windowHours} hours.`,
          `Channel/thread ID: ${threadId}.`,
          "Create a single Discord-ready markdown message. Start with a short bold localized title meaning 'Channel digest' in the channel's dominant language.",
          "Keep the whole message under 1800 characters. Refine and distill — capture only the essential points, not every message.",
          "",
          githubSection
            ? "If GitHub PR activity is included below, weave it into the digest under its own short section (e.g. **GitHub PRs**) — call out merged PRs, notable open PRs, and authors. Keep it brief."
            : "",
          "",
          "Channel history follows:",
          historyContext,
          githubSection ? `\n\n---\n\n${githubSection}` : "",
        ].join("\n");

        for await (const msg of agentRunner.run({ agentName: "discord-digest-summarizer", prompt })) {
          if (msg.type === "structured_output") {
            structured = msg.payload as SummarizerOutput;
          } else if (msg.type === "result") {
            resultText = String(msg.content ?? "");
          } else if (msg.type === "error") {
            const failed = repo.failRun(run.id, `Summarizer failed: ${msg.error}`);
            return { status: "error", error: failed.error ?? "Summarizer failed" };
          }
        }

        const summary = (
          structured?.markdown ||
          resultText ||
          fallbackSummary(history.data, windowHours)
        ).trim();

        if (shouldSend) {
          const sent = await appContext.runAction("send_message", {
            channel,
            threadId,
            text: summary,
          });
          if (sent.status !== "ok") {
            const failed = repo.failRun(run.id, `send_message failed: ${sent.status === "error" ? sent.error : "unknown error"}`);
            return { status: "error", error: failed.error ?? "send_message failed" };
          }
        }

        const finished = repo.finishRun(run.id, summary, shouldSend);
        if (saved) repo.markConfigRun(saved.id);
        return {
          status: "ok",
          data: {
            run: finished,
            summary,
            sent: shouldSend,
            messageCountEstimate: structured?.messageCountEstimate,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        repo.failRun(run.id, message);
        log.error("discord digest run failed", { runId: run.id, error: message });
        return { status: "error", error: message };
      }
    },
  };
}
