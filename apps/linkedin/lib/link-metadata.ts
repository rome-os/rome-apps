export type ReferenceKind =
  | "person"
  | "company"
  | "job"
  | "feed_post"
  | "article"
  | "newsletter"
  | "school"
  | "conversation"
  | "external";

export interface Reference {
  kind: ReferenceKind;
  url: string;
  text?: string;
  context?: string;
}

export interface RawReference {
  href?: string;
  text?: string;
  aria_label?: string;
  title?: string;
  heading?: string;
  in_article?: boolean;
  in_nav?: boolean;
  in_footer?: boolean;
}

const GENERIC_LABELS = new Set([
  "show all",
  "follow",
  "following",
  "connect",
  "send",
  "like",
  "comment",
  "repost",
  "post",
  "play",
  "pause",
  "fullscreen",
  "close",
  "manage notifications",
  "view my newsletter",
  "my newsletter",
]);

const CONTEXT_LABELS = new Set([
  "about",
  "experience",
  "education",
  "interests",
  "honors",
  "languages",
  "featured",
  "contact info",
]);

const SECTION_CONTEXTS: Record<string, string> = {
  experience: "experience",
  education: "education",
  interests: "interests",
  honors: "honors",
  languages: "languages",
  contact_info: "contact info",
  job_posting: "job posting",
  inbox: "inbox",
  conversation: "conversation",
};

const DEFAULT_REFERENCE_CAP = 12;
const REFERENCE_CAPS: Record<string, number> = {
  main_profile: 12,
  about: 12,
  experience: 12,
  education: 12,
  interests: 12,
  honors: 12,
  languages: 12,
  posts: 12,
  jobs: 8,
  search_results: 15,
  job_posting: 8,
  contact_info: 8,
  inbox: 30,
  conversation: 12,
};

const DUPLICATE_HALVES_RE = /^(?<value>.+?)\s+(?<same>.+)$/u;
const WHITESPACE_RE = /\s+/gu;
const CONNECTIONS_FOLLOW_RE = /\bconnections follow this page\b/i;
const COMPANY_PATH_RE = /^\/company\/([^/?#]+)/u;
const PERSON_PATH_RE = /^\/in\/([^/?#]+)/u;
const SCHOOL_PATH_RE = /^\/school\/([^/?#]+)/u;
const JOB_PATH_RE = /^\/jobs\/view\/(\d+)/u;
const NEWSLETTER_PATH_RE = /^\/newsletters\/([^/?#]+)/u;
const PULSE_PATH_RE = /^\/pulse\/([^/?#]+)/u;
const FEED_PATH_RE = /^\/feed\/update\/([^/?#]+)/u;
const MESSAGING_THREAD_PATH_RE = /^\/messaging\/thread\/([^/?#]+)/u;
const MAX_REDIRECT_UNWRAP_DEPTH = 5;

export function buildReferences(rawReferences: RawReference[], sectionName: string): Reference[] {
  const cap = REFERENCE_CAPS[sectionName] ?? DEFAULT_REFERENCE_CAP;
  const normalized: Reference[] = [];

  for (const raw of rawReferences) {
    const reference = normalizeReference(raw, sectionName);
    if (reference) {
      normalized.push(reference);
    }
  }

  return dedupeReferences(normalized, cap);
}

export function dedupeReferences(references: Reference[], cap = DEFAULT_REFERENCE_CAP): Reference[] {
  const result: Reference[] = [];
  const seen = new Set<string>();

  for (const reference of references) {
    const key = `${reference.kind}|${reference.url}|${reference.text ?? ""}|${reference.context ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(reference);
    if (result.length >= cap) {
      break;
    }
  }

  return result;
}

export function normalizeReference(raw: RawReference, sectionName: string): Reference | null {
  if (raw.in_nav || raw.in_footer) {
    return null;
  }

  const href = normalizeUrl(raw.href ?? "");
  if (!href) {
    return null;
  }

  const classified = classifyLink(href);
  if (!classified) {
    return null;
  }

  const text = chooseReferenceText(raw, classified.kind);
  if (!text && classified.kind !== "feed_post" && classified.kind !== "external") {
    return null;
  }

  const context = deriveContext(sectionName, raw, classified.kind);
  return {
    kind: classified.kind,
    url: classified.url,
    ...(text ? { text } : {}),
    ...(context ? { context } : {}),
  };
}

export function normalizeUrl(href: string, depth = 0): string | null {
  if (depth > MAX_REDIRECT_UNWRAP_DEPTH) {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme && !["http", "https"].includes(scheme)) {
    return null;
  }

  if (isLinkedinHost(parsed.hostname) && parsed.pathname === "/redir/redirect/") {
    const target = parsed.searchParams.get("url")?.trim();
    if (!target) {
      return null;
    }
    return normalizeUrl(target, depth + 1);
  }

  parsed.hash = "";
  return parsed.toString();
}

export function classifyLink(href: string): { kind: ReferenceKind; url: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }

  const path = parsed.pathname || "/";
  if (!isLinkedinHost(parsed.hostname)) {
    parsed.search = "";
    parsed.hash = "";
    return { kind: "external", url: parsed.toString() };
  }

  if (isLinkedinChrome(path)) {
    return null;
  }

  const personMatch = PERSON_PATH_RE.exec(path);
  if (personMatch) {
    const suffix = path.slice(personMatch[0].length).replace(/^\/+/u, "");
    const firstSuffixSegment = suffix.split("/", 1)[0];
    if (["overlay", "details", "recent-activity"].includes(firstSuffixSegment)) {
      return null;
    }
    return { kind: "person", url: `/in/${personMatch[1]}/` };
  }

  const companyMatch = COMPANY_PATH_RE.exec(path);
  if (companyMatch) {
    return { kind: "company", url: `/company/${companyMatch[1]}/` };
  }

  const schoolMatch = SCHOOL_PATH_RE.exec(path);
  if (schoolMatch) {
    return { kind: "school", url: `/school/${schoolMatch[1]}/` };
  }

  const jobMatch = JOB_PATH_RE.exec(path);
  if (jobMatch) {
    return { kind: "job", url: `/jobs/view/${jobMatch[1]}/` };
  }

  const newsletterMatch = NEWSLETTER_PATH_RE.exec(path);
  if (newsletterMatch) {
    return { kind: "newsletter", url: `/newsletters/${newsletterMatch[1]}/` };
  }

  const pulseMatch = PULSE_PATH_RE.exec(path);
  if (pulseMatch) {
    return { kind: "article", url: `/pulse/${pulseMatch[1]}/` };
  }

  const feedMatch = FEED_PATH_RE.exec(path);
  if (feedMatch) {
    return { kind: "feed_post", url: `/feed/update/${feedMatch[1]}/` };
  }

  const threadMatch = MESSAGING_THREAD_PATH_RE.exec(path);
  if (threadMatch) {
    return { kind: "conversation", url: `/messaging/thread/${threadMatch[1]}/` };
  }

  return null;
}

function chooseReferenceText(raw: RawReference, kind: ReferenceKind): string | null {
  const candidates = [raw.text ?? "", raw.aria_label ?? "", raw.title ?? ""];

  for (const candidate of candidates) {
    const cleaned = cleanLabel(candidate, kind);
    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function cleanLabel(value: string, kind: ReferenceKind): string | null {
  const cleaned = value.replace(WHITESPACE_RE, " ").trim();
  if (!cleaned) {
    return null;
  }
  if (GENERIC_LABELS.has(cleaned.toLowerCase())) {
    return null;
  }
  if (CONNECTIONS_FOLLOW_RE.test(cleaned)) {
    return null;
  }
  if (cleaned.length > 280) {
    return kind === "external" || kind === "feed_post" ? cleaned.slice(0, 280) : null;
  }

  const duplicateHalves = DUPLICATE_HALVES_RE.exec(cleaned);
  if (duplicateHalves?.groups?.value && duplicateHalves.groups.value === duplicateHalves.groups.same) {
    return duplicateHalves.groups.value;
  }

  return cleaned;
}

function deriveContext(
  sectionName: string,
  raw: RawReference,
  kind: ReferenceKind,
): string | undefined {
  const directContext = SECTION_CONTEXTS[sectionName];
  if (directContext) {
    return directContext;
  }

  const heading = raw.heading?.replace(WHITESPACE_RE, " ").trim().toLowerCase();
  if (!heading || CONTEXT_LABELS.has(heading)) {
    return undefined;
  }
  if (kind === "external" && heading.length > 80) {
    return undefined;
  }
  return heading;
}

function isLinkedinHost(host: string): boolean {
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

function isLinkedinChrome(path: string): boolean {
  return (
    path === "/" ||
    path.startsWith("/feed/") ||
    path.startsWith("/jobs/search/") ||
    path.startsWith("/learning/") ||
    path.startsWith("/notifications/") ||
    path.startsWith("/mynetwork/")
  );
}
