import { load } from "cheerio";

export interface Finding {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}
export interface Presence {
  url: string;
  found: boolean;
  status?: number;
  error?: string;
}
export interface PageTransport {
  url: string;
  finalUrl: string;
  status: number;
  redirects: string[];
  responseMs: number;
  xRobotsTag: string;
  robots: Presence;
  sitemap: Presence;
}
export interface PageCheck extends PageTransport {
  title: string;
  description: string;
  canonical: string;
  robotsMeta: string;
  lang: string;
  viewport: string;
  headings: { level: number; text: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLdTypes: string[];
  invalidJsonLd: number;
  images: { total: number; withAlt: number; emptyAlt: number };
  links: { internal: number; external: number };
  wordCount: number;
  score: number;
  findings: Finding[];
}

export function parsePage(html: string, transport: PageTransport): PageCheck {
  const $ = load(html);
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const metas: Record<string, string> = {};
  $("meta").each((_, el) => {
    const key = (
      $(el).attr("name") ||
      $(el).attr("property") ||
      ""
    ).toLowerCase();
    if (key && !(key in metas))
      metas[key] = $(el).attr("content")?.trim() || "";
  });
  const group = (prefix: string) =>
    Object.fromEntries(
      Object.entries(metas).filter(([k]) => k.startsWith(prefix)),
    );
  const headings: PageCheck["headings"] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    headings.push({ level: Number(el.tagName[1]), text: clean($(el).text()) });
  });
  let canonical = "";
  $("link[rel]").each((_, el) => {
    if (
      !canonical &&
      ($(el).attr("rel") || "").toLowerCase().split(/\s+/).includes("canonical")
    )
      canonical = $(el).attr("href") || "";
  });
  try {
    if (canonical) canonical = new URL(canonical, transport.finalUrl).href;
  } catch {
    /* preserve malformed value for diagnosis */
  }
  const types = new Set<string>();
  let invalidJsonLd = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const t of Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]])
      if (typeof t === "string") types.add(t);
    Object.values(obj).forEach(visit);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      invalidJsonLd++;
    }
  });
  const images = { total: $("img").length, withAlt: 0, emptyAlt: 0 };
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt !== undefined) images.withAlt++;
    if (alt !== undefined && !alt.trim()) images.emptyAlt++;
  });
  const links = { internal: 0, external: 0 };
  $("a[href]").each((_, el) => {
    try {
      const url = new URL($(el).attr("href")!, transport.finalUrl);
      if (!/^https?:$/.test(url.protocol)) return;
      links[
        url.origin === new URL(transport.finalUrl).origin
          ? "internal"
          : "external"
      ]++;
    } catch {
      /* malformed link */
    }
  });
  $("script,style,noscript,template,svg,[hidden]").remove();
  const text = clean($("body").text());
  const page: PageCheck = {
    ...transport,
    title: clean($("title").first().text()),
    description: metas.description || "",
    canonical,
    robotsMeta: [metas.robots, metas.googlebot].filter(Boolean).join(", "),
    lang: $("html").attr("lang") || "",
    viewport: metas.viewport || "",
    headings,
    og: group("og:"),
    twitter: group("twitter:"),
    jsonLdTypes: [...types],
    invalidJsonLd,
    images,
    links,
    wordCount: text ? text.split(/\s+/u).length : 0,
    score: 0,
    findings: [],
  };
  page.findings = scorePage(page);
  page.score = Math.round(
    (page.findings.reduce(
      (sum, f) =>
        sum + (f.status === "pass" ? 1 : f.status === "warn" ? 0.5 : 0),
      0,
    ) /
      page.findings.length) *
      100,
  );
  return page;
}

export function scorePage(p: PageCheck): Finding[] {
  const list: Finding[] = [];
  const add = (
    key: string,
    label: string,
    status: Finding["status"],
    detail: string,
    fix?: string,
  ) =>
    list.push({
      key,
      label,
      status,
      detail,
      ...(status !== "pass" && fix ? { fix } : {}),
    });
  add(
    "status",
    "HTTP response",
    p.status >= 200 && p.status < 300 ? "pass" : "fail",
    `HTTP ${p.status}`,
    "Serve a successful 200 response for an indexable page.",
  );
  add(
    "https",
    "Secure connection",
    p.finalUrl.startsWith("https:") ? "pass" : "warn",
    new URL(p.finalUrl).protocol,
    "Redirect this page to HTTPS.",
  );
  add(
    "title",
    "Page title",
    !p.title
      ? "fail"
      : p.title.length < 30 || p.title.length > 60
        ? "warn"
        : "pass",
    p.title ? `${p.title.length} characters · ${p.title}` : "No title found",
    "Write a unique, descriptive title. Around 30–60 characters is a useful starting point; display width varies.",
  );
  add(
    "description",
    "Meta description",
    !p.description
      ? "fail"
      : p.description.length < 70 || p.description.length > 160
        ? "warn"
        : "pass",
    p.description
      ? `${p.description.length} characters · ${p.description}`
      : "No description found",
    "Summarize the page's value in roughly 70–160 characters. Search engines may rewrite it.",
  );
  const h1 = p.headings.filter((h) => h.level === 1);
  add(
    "h1",
    "Primary heading",
    h1.length === 1 ? "pass" : h1.length ? "warn" : "fail",
    `${h1.length} H1 heading${h1.length === 1 ? "" : "s"}`,
    "Give the page one clear, descriptive main heading.",
  );
  const skips = p.headings.some(
    (h, i) => i > 0 && h.level > p.headings[i - 1].level + 1,
  );
  add(
    "outline",
    "Heading hierarchy",
    skips ? "warn" : "pass",
    skips ? "Heading levels are skipped" : "No skipped heading levels",
    "Nest sections in order: H1, then H2, then H3.",
  );
  add(
    "canonical",
    "Canonical URL",
    /^https?:\/\//.test(p.canonical) ? "pass" : "warn",
    p.canonical || "No canonical found",
    "Add an absolute canonical URL for the preferred version of this page.",
  );
  const robots = `${p.robotsMeta}, ${p.xRobotsTag}`;
  add(
    "indexing",
    "Indexing directives",
    /(?:^|[\s,:])(?:noindex|none)(?:$|[\s,;])/i.test(robots) ? "fail" : "pass",
    robots.replace(/^, |, $/g, "") || "No restrictive indexing directive found",
    "Remove noindex only if this page should appear in search. It may be intentional.",
  );
  add(
    "lang",
    "Document language",
    p.lang ? "pass" : "warn",
    p.lang || "No lang attribute",
    "Set the html lang attribute to the page's language.",
  );
  add(
    "viewport",
    "Mobile viewport",
    /width\s*=\s*device-width/i.test(p.viewport) ? "pass" : "warn",
    p.viewport || "No viewport found",
    'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  );
  add(
    "social",
    "Social sharing tags",
    ["og:title", "og:description", "og:image"].every((k) => p.og[k])
      ? "pass"
      : "warn",
    `${Object.keys(p.og).length} Open Graph · ${Object.keys(p.twitter).length} Twitter tags`,
    "Add og:title, og:description and og:image; add twitter:card for X previews.",
  );
  add(
    "schema",
    "Structured data",
    p.invalidJsonLd ? "warn" : p.jsonLdTypes.length ? "pass" : "warn",
    `${p.jsonLdTypes.join(", ") || "No JSON-LD types"}${p.invalidJsonLd ? ` · ${p.invalidJsonLd} invalid block(s)` : ""}`,
    "Add relevant, valid JSON-LD. Presence alone does not establish rich-result eligibility.",
  );
  add(
    "alt",
    "Image alternatives",
    p.images.withAlt === p.images.total ? "pass" : "warn",
    `${p.images.withAlt}/${p.images.total} images have an alt attribute · ${p.images.emptyAlt} empty`,
    "Describe informative images in alt text. Empty alt is appropriate for decorative images.",
  );
  add(
    "content",
    "Text content",
    p.wordCount >= 150 ? "pass" : "warn",
    `${p.wordCount.toLocaleString()} words in server HTML`,
    "Check that useful page content is present in HTML. Word count is not a ranking target.",
  );
  add(
    "redirects",
    "Redirect chain",
    p.redirects.length <= 1 ? "pass" : "warn",
    `${p.redirects.length} redirect(s)`,
    "Link directly to the final URL and avoid multi-hop redirects.",
  );
  add(
    "robots",
    "robots.txt",
    p.robots.found ? "pass" : "warn",
    p.robots.found
      ? "File found; crawl rules not evaluated"
      : p.robots.error || `Not found (HTTP ${p.robots.status ?? "unknown"})`,
    "Provide a robots.txt at the origin root. This check does not determine whether this URL is allowed.",
  );
  add(
    "sitemap",
    "XML sitemap",
    p.sitemap.found ? "pass" : "warn",
    p.sitemap.found
      ? "XML sitemap found"
      : p.sitemap.error || `Not found (HTTP ${p.sitemap.status ?? "unknown"})`,
    "Publish an XML sitemap and reference it in robots.txt. This check does not verify page membership.",
  );
  return list;
}
