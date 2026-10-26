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
  const repoPath =
    scenario === "version-link" ? "/projects/default/fixture" : "/fixture";
  let trackingState = scenario === "tracking" ? "ready" : "no_upstream";
  let trackingHead = "abc";
  const forFile = (path, marker) => {
    const result = patch(path, marker);
    if (scenario === "fallback")
      result.patch = result.patch.replace("@@ -1 +1 @@", "@@ -10 +10 @@");
    return result;
  };
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
                path: repoPath,
                name: "fixture",
                base: "main",
                branch: "main",
              },
            ],
            defaultRepo: repoPath,
            homeRepo: repoPath,
          });
        else if (["refs", "revisions"].includes(route))
          json({
            branches: ["main"],
            tags: [],
            commits: [],
            prs:
              scenario === "fallback"
                ? [
                    {
                      number: 7,
                      title: "Fixture PR",
                      baseRefName: "main",
                      headRefName: "feature",
                    },
                  ]
                : [],
            prState: "ready",
          });
        else if (route === "tracking")
          json({
            state: trackingState,
            upstream: trackingState === "ready" ? "origin/main" : "",
            head: trackingHead,
            upstreamHead: "base",
            ahead: trackingState === "ready" ? 1 : 0,
            behind: 0,
          });
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
            fallback: scenario === "fallback",
            files: paths.map((path) => ({
              path,
              status: "M",
              added: 1,
              deleted: 1,
              binary: false,
              collapsed: false,
            })),
            page: {
              patches: { [paths[0]]: forFile(paths[0], fp) },
              next: paths.length > 1 ? 1 : null,
            },
            fingerprint: fp,
            head: trackingHead,
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
              eligible.slice(start, start + 150).map((p) => [p, forFile(p)]),
            ),
            next: start + 150 < eligible.length ? start + 150 : null,
          });
          activePages--;
        } else if (route === "patch")
          json(forFile(url.searchParams.get("path")));
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
  const href = `http://127.0.0.1:${server.address().port}/?lang=zh#repo=${encodeURIComponent(repoPath)}&mode=${scenario === "tracking" ? "unpushed" : scenario === "fallback" ? "pr" : "uncommitted"}&pr=${scenario === "fallback" ? "7" : ""}&filter=all&base=main&unified=3`;
  return {
    page,
    href,
    counts,
    setTracking: (state, head = trackingHead) => {
      trackingState = state;
      trackingHead = head;
    },
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

for (const unavailable of ["no_upstream", "detached"])
  test(
    `production Unpushed hides retained results when tracking becomes ${unavailable}`,
    { timeout: 65000 },
    async () => {
      const f = await fixture("tracking");
      try {
        await f.page.goto(f.href);
        await f.page
          .getByRole("button", { name: `已读: ${names[0]}`, exact: true })
          .waitFor();
        f.setTracking(unavailable);
        await f.page
          .getByText(
            unavailable === "no_upstream"
              ? "当前分支没有设置跟踪上游。"
              : "当前处于游离 HEAD，没有跟踪上游。",
            { exact: true },
          )
          .waitFor({ timeout: 23000 });
        assert.equal(await f.page.locator("diffs-container").count(), 0);
        assert(
          !/\+1/.test(
            await f.page
              .getByRole("button", { name: "比较版本", exact: true })
              .innerText(),
          ),
        );
        assert.equal(
          await f.page
            .getByRole("button", { name: `已读: ${names[0]}`, exact: true })
            .count(),
          0,
        );
        const count = f.counts.get("all");
        await pause(1000);
        assert.equal(f.counts.get("all"), count);
        if (unavailable === "no_upstream") {
          f.setTracking("ready", "new-head");
          await f.page
            .getByRole("button", { name: `已读: ${names[0]}`, exact: true })
            .waitFor({ timeout: 23000 });
          assert(
            (f.counts.get("all") || 0) > count,
            "new tracking HEAD must get its own list query",
          );
        }
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );

test(
  "production PR fallback labels degraded hunks and disables context/full-file actions",
  { timeout: 30000 },
  async () => {
    const f = await fixture("fallback");
    try {
      await f.page.goto(f.href);
      await f.page
        .getByText("仅显示 GitHub 提供的差异；无法展开上下文或加载完整文件。", {
          exact: true,
        })
        .waitFor();
      await f.page
        .getByRole("button", { name: `文件操作: ${names[0]}`, exact: true })
        .click();
      for (const name of ["加载完整文件", "更多未变上下文"])
        assert.equal(
          await f.page
            .getByRole("menuitem", { name, exact: true })
            .getAttribute("aria-disabled"),
          "true",
        );
      await f.page.keyboard.press("Escape");
      const expanders = f.page
        .locator("diffs-container")
        .locator('button[title="展开 20 行"]');
      assert((await expanders.count()) > 0);
      for (const button of await expanders.all())
        assert(await button.isDisabled());
      await f.page
        .getByRole("button", { name: "审阅选项", exact: true })
        .click();
      assert(await f.page.locator("#dv-context").isDisabled());
      assert.equal(
        await f.page
          .getByRole("menuitemcheckbox", {
            name: "折叠未变上下文",
            exact: true,
          })
          .getAttribute("aria-disabled"),
        "true",
      );
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);

test(
  "production file menus never link reviewed commit/index versions to the local checkout",
  { timeout: 45000 },
  async () => {
    const f = await fixture("version-link");
    try {
      for (const q of [
        { mode: "branch", open: false },
        { mode: "commit", commit: "abc", open: false },
        { mode: "pr", pr: "7", open: false },
        { mode: "ref", target: "head", open: false },
        { mode: "uncommitted", filter: "staged", open: false },
        { mode: "ref", target: "worktree", open: true },
        { mode: "uncommitted", filter: "all", open: true },
      ]) {
        const url = new URL(f.href),
          hash = new URLSearchParams(url.hash.slice(1));
        for (const [k, v] of Object.entries(q))
          if (k !== "open") hash.set(k, v);
        url.hash = hash.toString();
        // A fresh document avoids treating a hash-only navigation as an app state event.
        await f.page.goto("about:blank");
        await f.page.goto(url.href);
        await f.page
          .getByRole("button", { name: `文件操作: ${names[0]}`, exact: true })
          .click();
        const link = f.page.getByRole("menuitem", {
          name: "在新标签页打开",
          exact: true,
        });
        const local = f.page.getByRole("menuitem", {
          name: "打开文件",
          exact: true,
        });
        if (q.open) {
          assert.equal(await link.count(), 1);
          assert.match(
            await link.getAttribute("href"),
            /\/projects\/.*file-000\.ts$/,
          );
          assert.equal(await local.count(), 1);
        } else {
          assert.equal(await link.count(), 0, JSON.stringify(q));
          assert.equal(await local.count(), 0, JSON.stringify(q));
        }
        await f.page.keyboard.press("Escape");
      }
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);
