import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const names = Array.from(
  { length: 420 },
  (_, i) => `src/file-${String(i).padStart(3, "0")}.ts`,
);
const patch = (path, marker = "after") => ({
  patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-export const marker = "before";\n+export const marker = "${marker}";\n`,
  binary: false,
  collapsed: false,
  truncated: false,
  totalLines: 1,
});
async function fixture(scenario) {
  const root = resolve(process.env.DIFFVIEW_TEST_WEB_ROOT || "dist/web");
  const counts = new Map(),
    cursors = [],
    errors = [];
  let eventSent;
  const eventReady = new Promise((r) => {
    eventSent = r;
  });
  let activePages = 0,
    maxPages = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const json = (value) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      };
      if (url.pathname.startsWith("/api/apps/diffview/")) {
        const route = url.pathname.split("/").at(-1);
        const paths = scenario === "hidden" ? names : [names[0]];
        if (route === "repos")
          json({
            repos: [
              {
                path: "/fixture",
                name: "fixture",
                base: "main",
                branch: "main",
              },
            ],
            defaultRepo: "/fixture",
            homeRepo: "/fixture",
          });
        else if (["refs", "revisions"].includes(route))
          json({
            branches: ["main"],
            tags: [],
            commits: [],
            prs: [],
            prState: "ok",
          });
        else if (route === "tracking")
          json({ state: "no_upstream", upstream: "", ahead: 0, behind: 0 });
        else if (route === "events") {
          if (scenario === "stale-event") await pause(900);
          json({
            fingerprint: scenario === "stale-event" ? "old" : "new",
            ms: 0,
          });
          eventSent();
        } else if (route === "files") {
          const key = url.searchParams.get("filter") || "all";
          const n = (counts.get(key) || 0) + 1;
          counts.set(key, n);
          if (scenario === "stale-list" && n === 1) {
            await eventReady;
            await pause(600);
          }
          const fp = scenario === "stale-list" && n === 1 ? "old" : "new";
          json({
            files: paths.map((path) => ({
              path,
              status: "M",
              added: 1,
              deleted: 1,
              binary: false,
              collapsed: false,
            })),
            page: {
              patches: { [paths[0]]: patch(paths[0], fp) },
              next: paths.length > 1 ? 1 : null,
            },
            fingerprint: fp,
            head: "abc",
            base: "main",
            ms: 0,
          });
        } else if (route === "patches") {
          activePages++;
          maxPages = Math.max(activePages, maxPages);
          const start = Number(url.searchParams.get("cursor"));
          cursors.push(start);
          await pause(100);
          const eligible = paths.filter((p) =>
            p.includes(url.searchParams.get("q") || ""),
          );
          json({
            patches: Object.fromEntries(
              eligible.slice(start, start + 150).map((p) => [p, patch(p)]),
            ),
            next: start + 150 < eligible.length ? start + 150 : null,
          });
          activePages--;
        } else if (route === "patch") json(patch(url.searchParams.get("path")));
        else json({});
        return;
      }
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<!doctype html><html lang="zh-CN"><body style="margin:0"><div id="root" style="height:660px"></div><script type="module">window.__ROME_APP_BOOTSTRAP__={appId:'diffview',routeBase:'/',routePath:'',assetBase:'',apiBase:'/api/apps/diffview',shell:{locale:'zh',theme:'light',mode:'full'}};const m=await(await fetch('/manifest.json')).json();for(const f of m.styles){const l=document.createElement('link');l.rel='stylesheet';l.href='/'+f;document.head.append(l)}const app=await import('/'+m.entry);await app.mount(document.getElementById('root'),window.__ROME_APP_BOOTSTRAP__);</script></body></html>`,
        );
        return;
      }
      const file = resolve(root, "." + url.pathname);
      if (!file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "application/json",
      );
      res.end(body);
    } catch (e) {
      errors.push(String(e));
      res.writeHead(500).end(String(e));
    }
  });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const page = await browser.newPage({
    viewport: { width: 1100, height: 660 },
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (scenario === "hidden")
    await page.addInitScript((names) => {
      localStorage.setItem(
        "diffview:prefs:v1",
        JSON.stringify({ hideViewed: true, showTree: false }),
      );
      localStorage.setItem(
        'diffview:viewed:/fixture:{"mode":"uncommitted","filter":"all"}:abc',
        JSON.stringify(names.slice(1, 201)),
      );
    }, names);
  const href = `http://127.0.0.1:${server.address().port}/?lang=zh#repo=%2Ffixture&mode=uncommitted&filter=all&base=main&unified=3`;
  return {
    page,
    href,
    counts,
    cursors,
    errors,
    get maxPages() {
      return maxPages;
    },
    close: async () => {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
}
test(
  "production paging skips 200 hidden viewed files without starving unread demand",
  { timeout: 30000 },
  async () => {
    const f = await fixture("hidden");
    try {
      await f.page.goto(f.href);
      await expect
        .poll(() => f.cursors.includes(201), { timeout: 8000 })
        .toBe(true);
      await f.page
        .getByRole("button", { name: `已读: ${names[201]}`, exact: true })
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: `已读: ${names[1]}`, exact: true })
          .count(),
        0,
      );
      assert.equal(f.maxPages, 1);
      const settled = f.cursors.length;
      await pause(900);
      assert.equal(
        f.cursors.length,
        settled,
        "idle viewer must not drain all pages",
      );
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);
for (const scenario of ["stale-list", "stale-event"])
  test(
    `production freshness reconciles ${scenario} once without an invalidation loop`,
    { timeout: 30000 },
    async () => {
      const f = await fixture(scenario);
      try {
        await f.page.goto(f.href);
        await expect
          .poll(() => f.counts.get("all") || 0, { timeout: 8000 })
          .toBe(2);
        await f.page.locator("diffs-container").first().waitFor();
        await pause(3800);
        assert.equal(f.counts.get("all"), 2);
        if (scenario === "stale-list") {
          await f.page
            .getByRole("button", { name: "比较版本", exact: true })
            .click();
          await f.page
            .getByRole("menuitemradio", { name: "未暂存", exact: true })
            .click();
          await expect
            .poll(() => f.counts.get("unstaged") || 0, { timeout: 8000 })
            .toBe(2);
          await pause(900);
          assert.equal(f.counts.get("unstaged"), 2);
        }
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );
