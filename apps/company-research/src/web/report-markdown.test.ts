import { describe, expect, it } from "vitest";

import { renderReportMarkdown } from "./report-markdown";

describe("renderReportMarkdown", () => {
  it("renders markdown syntax without blanket escaping", () => {
    const html = renderReportMarkdown("# Heading\n\n**Bold** and [Link](https://example.com)");

    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain('<a href="https://example.com">Link</a>');
  });

  it("escapes raw html instead of rendering it", () => {
    const html = renderReportMarkdown('Before <script>alert("xss")</script> after');

    expect(html).toContain("Before &lt;script&gt;alert(\"xss\")&lt;/script&gt; after");
    expect(html).not.toContain("<script>");
  });

  it("keeps citation pills for reference-style links", () => {
    const html = renderReportMarkdown("([Source][1])\n\n[1]: https://example.com");

    expect(html).toContain('class="citation-pill" data-citation="true"');
    expect(html).not.toContain("(<a class=\"citation-pill\"");
  });
});
