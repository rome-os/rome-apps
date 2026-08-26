import { marked } from "marked";

const reportMarkdownRenderer = new marked.Renderer();
const defaultReportLinkRenderer = reportMarkdownRenderer.link.bind(reportMarkdownRenderer);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isReferenceStyleLink(raw: string): boolean {
  return /^\[[^\]]+\](?:\[[^\]]*\])?$/.test(raw.trim());
}

reportMarkdownRenderer.link = (token) => {
  const html = defaultReportLinkRenderer(token);
  if (!isReferenceStyleLink(token.raw)) {
    return html;
  }
  return html.replace("<a ", '<a class="citation-pill" data-citation="true" ');
};

reportMarkdownRenderer.html = ({ text }) => escapeHtml(text);

function stripCitationPillParens(html: string): string {
  return html.replace(/\(\s*(<a class="citation-pill"[\s\S]*?<\/a>)\s*\)/g, "$1");
}

export function renderReportMarkdown(markdown: string): string {
  const html = marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer: reportMarkdownRenderer,
  }) as string;
  return stripCitationPillParens(html);
}
