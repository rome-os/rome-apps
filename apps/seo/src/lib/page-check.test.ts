import { describe, expect, it } from "vitest";
import { parsePage, type PageTransport } from "./page-check.js";
const transport: PageTransport = {
  url: "https://example.com/page",
  finalUrl: "https://example.com/page",
  status: 200,
  redirects: [],
  responseMs: 80,
  xRobotsTag: "",
  robots: { url: "https://example.com/robots.txt", found: true },
  sitemap: { url: "https://example.com/sitemap.xml", found: true },
};
const healthy = `<html lang="en"><head><title>A practical guide to better page SEO</title><meta NAME="description" content="A practical guide with clear steps for improving page metadata, headings, images, and search visibility."><meta name="viewport" content="width=device-width,initial-scale=1"><meta property="og:title" content="A guide"><meta property="og:description" content="Read it"><meta property="og:image" content="/cover.png"><meta name="twitter:card" content="summary_large_image"><link rel="alternate canonical" href="/page"><script type="application/ld+json">{"@graph":[{"@type":["Article","WebPage"],"author":{"@type":"Person"}}]}</script></head><body><h1>A guide</h1><h2>Steps</h2><p>${"useful content ".repeat(100)}</p><img src="a.png" alt="A diagram"><img alt="" src="decoration.png"><a href="/about">About</a><a href="https://other.com">Other</a><a href="mailto:x@example.com">Mail</a><script>invisible script words</script><style>invisible style words</style></body></html>`;
describe("deterministic page parser and scoring", () => {
  it("extracts metadata, graph types, image coverage, HTTP links, and heading outline", () => {
    const p = parsePage(healthy, transport);
    expect(p.title).toBe("A practical guide to better page SEO");
    expect(p.canonical).toBe("https://example.com/page");
    expect(p.jsonLdTypes).toEqual(["Article", "WebPage", "Person"]);
    expect(p.images).toEqual({ total: 2, withAlt: 2, emptyAlt: 1 });
    expect(p.links).toEqual({ internal: 1, external: 1 });
    expect(p.headings.map((h) => h.level)).toEqual([1, 2]);
    expect(p.og["og:image"]).toBe("/cover.png");
    expect(p.twitter["twitter:card"]).toBe("summary_large_image");
    expect(p.score).toBe(100);
    expect(p.findings).toHaveLength(17);
    expect(p.findings.every((f) => f.status === "pass")).toBe(true);
  });
  it("decodes entities, normalizes whitespace, ignores scripts and style text", () => {
    const p = parsePage(
      "<title>Title &amp;   more</title><body><p>Hello   world</p><script>many fake words here</script><style>many fake words here</style><div hidden>hidden text</div></body>",
      transport,
    );
    expect(p.title).toBe("Title & more");
    expect(p.wordCount).toBe(2);
  });
  it("handles malformed HTML, missing tags, invalid JSON-LD and heading skips", () => {
    const p = parsePage(
      '<h1>A<h3>Skipped</h3><img><script type="application/ld+json">not JSON</script>',
      transport,
    );
    expect(p.invalidJsonLd).toBe(1);
    expect(p.findings.find((f) => f.key === "outline")?.status).toBe("warn");
    expect(p.findings.find((f) => f.key === "title")?.status).toBe("fail");
    expect(p.findings.find((f) => f.key === "alt")?.status).toBe("warn");
    expect(
      p.findings.filter((f) => f.status !== "pass").every((f) => f.fix),
    ).toBe(true);
  });
  it.each(["noindex, follow", "googlebot: noindex", "none"])(
    "detects restrictive X-Robots-Tag: %s",
    (value) => {
      const p = parsePage(healthy, { ...transport, xRobotsTag: value });
      expect(p.findings.find((f) => f.key === "indexing")?.status).toBe("fail");
    },
  );
  it("applies the most restrictive of repeated robots meta tags", () => {
    const p = parsePage(
      '<meta name="robots" content="index, follow"><meta name="robots" content="noindex"><title>t</title>',
      transport,
    );
    expect(p.robotsMeta).toBe("index, follow, noindex");
    expect(p.findings.find((f) => f.key === "indexing")?.status).toBe("fail");
  });
  it("detects googlebot meta, unsuccessful responses, missing crawl files, and long redirects", () => {
    const p = parsePage(
      '<meta name="googlebot" content="NOINDEX"><title>short</title>',
      {
        ...transport,
        status: 404,
        redirects: ["http://example.com", "https://example.com"],
        robots: { ...transport.robots, found: false },
        sitemap: { ...transport.sitemap, found: false },
      },
    );
    for (const key of ["indexing", "status"])
      expect(p.findings.find((f) => f.key === key)?.status).toBe("fail");
    for (const key of ["redirects", "robots", "sitemap", "title"])
      expect(p.findings.find((f) => f.key === key)?.status).toBe("warn");
    expect(p.score).toBeLessThan(60);
  });
  it("produces reproducible scores and does not treat nofollow as noindex", () => {
    const p = parsePage(healthy, { ...transport, xRobotsTag: "nofollow" });
    expect(p.score).toBe(parsePage(healthy, transport).score);
    expect(p.findings.find((f) => f.key === "indexing")?.status).toBe("pass");
  });
});
