import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { marked } from "marked";
import puppeteer, { type Browser, type LaunchOptions } from "puppeteer-core";

// Common system Chrome / Chromium locations. We pick the first existing one.
const CANDIDATE_CHROME_PATHS = [
  process.env.STOCK_DAILY_CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter((p): p is string => typeof p === "string" && p.length > 0);

function resolveChromeExecutable(): string | undefined {
  for (const candidate of CANDIDATE_CHROME_PATHS) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function getPdfStorageDir(): string {
  const profile = process.env.ROME_PROFILE?.trim() || "default";
  return join(homedir(), ".rome", profile, "data", "stock-daily");
}

export function getPdfPathForReport(reportId: string): string {
  return join(getPdfStorageDir(), `${reportId}.pdf`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a markdown report body into a self-contained HTML document tuned for
 * print/PDF output with a clean English-first font stack.
 */
export function buildReportHtml(opts: {
  title: string;
  reportDate: string;
  triggerLabel: string;
  completedAtIso?: string;
  markdown: string;
}): string {
  const bodyHtml = marked.parse(opts.markdown, { async: false, gfm: true, breaks: false }) as string;
  const generatedAt = opts.completedAtIso
    ? new Date(opts.completedAtIso).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        hour12: false,
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}</title>
<style>
  :root {
    --fg: #0f172a;
    --muted: #475569;
    --border: #e2e8f0;
    --accent: #2563eb;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: var(--fg);
    background: #ffffff;
    font-family: Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.7;
  }
  body { padding: 28pt 32pt 36pt; }
  header.cover {
    border-bottom: 1px solid var(--border);
    padding-bottom: 14pt;
    margin-bottom: 18pt;
  }
  header.cover h1 {
    font-size: 22pt;
    margin: 0 0 6pt;
    letter-spacing: 0.5pt;
  }
  header.cover .meta {
    color: var(--muted);
    font-size: 10pt;
    display: flex;
    flex-wrap: wrap;
    gap: 8pt 16pt;
  }
  h1, h2, h3, h4 { color: var(--fg); page-break-after: avoid; }
  h1 { font-size: 20pt; margin: 18pt 0 10pt; }
  h2 { font-size: 16pt; margin: 18pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid var(--border); }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; color: var(--muted); }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0 6pt 22pt; padding: 0; }
  li { margin: 2pt 0; }
  blockquote {
    margin: 8pt 0;
    padding: 4pt 12pt;
    border-left: 3pt solid var(--accent);
    background: #f8fafc;
    color: var(--muted);
  }
  hr { border: none; border-top: 1px solid var(--border); margin: 14pt 0; }
  code {
    font-family: "JetBrains Mono", "Source Code Pro", Consolas, monospace;
    font-size: 10pt;
    background: #f1f5f9;
    padding: 1pt 4pt;
    border-radius: 3pt;
  }
  pre {
    background: #f8fafc;
    border: 1px solid var(--border);
    border-radius: 4pt;
    padding: 8pt 10pt;
    overflow-x: auto;
  }
  pre code { background: transparent; padding: 0; }
  a { color: var(--accent); text-decoration: none; word-break: break-all; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0;
    font-size: 10.5pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6pt 8pt;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f1f5f9; font-weight: 600; }
  tr { page-break-inside: avoid; }
  footer.footer {
    margin-top: 28pt;
    padding-top: 10pt;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 9pt;
  }
  @page {
    size: A4;
    margin: 16mm 14mm 18mm;
  }
</style>
</head>
<body>
  <header class="cover">
    <h1>${escapeHtml(opts.title)}</h1>
    <div class="meta">
      <span>Report date: ${escapeHtml(opts.reportDate)}</span>
      <span>Trigger: ${escapeHtml(opts.triggerLabel)}</span>
      ${generatedAt ? `<span>Generated at: ${escapeHtml(generatedAt)}</span>` : ""}
    </div>
  </header>
  <main>${bodyHtml}</main>
  <footer class="footer">
    Stock Daily · Automatically generated by Rome · Key facts include source links; unavailable datapoints are marked “No reliable data available”.
  </footer>
</body>
</html>`;
}

export interface RenderPdfResult {
  path: string;
  sizeBytes: number;
}

export class PdfRendererError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PdfRendererError";
  }
}

/**
 * Render a report's markdown into a PDF on disk using a system Chrome/Chromium
 * installation via puppeteer-core. We deliberately avoid bundling Chromium so
 * the app install footprint stays small. If no Chrome binary can be found, a
 * PdfRendererError is thrown and the caller should record the failure but
 * leave the markdown report intact.
 */
export async function renderReportPdf(opts: {
  reportId: string;
  title: string;
  reportDate: string;
  triggerLabel: string;
  completedAtIso?: string;
  markdown: string;
}): Promise<RenderPdfResult> {
  const chromePath = resolveChromeExecutable();
  if (!chromePath) {
    throw new PdfRendererError(
      "No usable Chrome/Chromium executable was found. Install Chrome or set STOCK_DAILY_CHROME_PATH.",
    );
  }

  const outputPath = getPdfPathForReport(opts.reportId);
  await mkdir(dirname(outputPath), { recursive: true });

  const html = buildReportHtml({
    title: opts.title,
    reportDate: opts.reportDate,
    triggerLabel: opts.triggerLabel,
    completedAtIso: opts.completedAtIso,
    markdown: opts.markdown,
  });

  const launchOptions: LaunchOptions = {
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  };

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    await page.emulateMediaType("print");
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
    });
    await writeFile(outputPath, pdfBuffer);
  } catch (err) {
    throw new PdfRendererError(
      err instanceof Error ? err.message : String(err),
      err,
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  const stats = await stat(outputPath);
  return { path: outputPath, sizeBytes: stats.size };
}
