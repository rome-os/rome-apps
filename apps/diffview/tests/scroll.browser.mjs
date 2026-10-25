import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

test(
  "production viewer restores per-chat anchors after reload, close and context switches",
  { timeout: 90000 },
  async () => {
    const root = resolve("dist/web");
    const names = Array.from(
      { length: 65 },
      (_, i) => `src/file-${String(i).padStart(3, "0")}.ts`,
    );
    let removed;
    const patch = (path) => ({
      patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,9 +1,9 @@\n${Array.from({ length: 4 }, (_, i) => ` export const a${i} = ${i};\n`).join("")}-export const marker = "before";\n+export const marker = "after";\n${Array.from({ length: 4 }, (_, i) => ` export const b${i} = ${i};\n`).join("")}`,
      binary: false,
      collapsed: false,
      truncated: false,
      totalLines: 9,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const json = (value) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      };
      const paths = names.filter((path) => path !== removed);
      if (url.pathname.startsWith("/api/chat/sessions/")) {
        json({ projectPath: "default" });
        return;
      }
      if (url.pathname.startsWith("/api/apps/diffview/")) {
        const route = url.pathname.split("/").at(-1);
        if (route === "repos")
          json({
            repos: [
              {
                path: "/fixture",
                name: "fixture",
                base: "main",
                branch: "feature",
              },
            ],
            defaultRepo: "/fixture",
            homeRepo: "/fixture",
          });
        else if (route === "refs")
          json({
            branches: ["main", "feature"],
            tags: [],
            commits: [],
            prs: [],
            prState: "ok",
          });
        else if (route === "events") json({ fingerprint: "one", ms: 0 });
        else if (route === "files") {
          // A slow list must not overwrite the saved position with an initial zero.
          await new Promise((resolve) => setTimeout(resolve, 450));
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
              patches: Object.fromEntries(
                paths.slice(0, 8).map((path) => [path, patch(path)]),
              ),
              next: 8,
            },
            fingerprint: "one",
            head: "abc",
            base: "main",
            ms: 0,
          });
        } else if (route === "patches") {
          await new Promise((resolve) => setTimeout(resolve, 120));
          const start = Number(url.searchParams.get("cursor"));
          json({
            patches: Object.fromEntries(
              paths.slice(start, start + 12).map((path) => [path, patch(path)]),
            ),
            next: start + 12 < paths.length ? start + 12 : null,
          });
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
        res.end(`<!doctype html><html lang="en"><body style="margin:0"><div id="root" style="height:660px"></div><script type="module">
        const session = new URLSearchParams(location.search).get('session');
        window.__ROME_APP_BOOTSTRAP__ = {appId:'diffview',routeBase:'/',routePath:'',assetBase:'',apiBase:'/api/apps/diffview',globalParams:{chatSessionId:session}};
        const manifest = await (await fetch('/manifest.json')).json();
        for(const file of manifest.styles) { const link=document.createElement('link');link.rel='stylesheet';link.href='/'+file;document.head.append(link); }
        window.app = await import('/'+manifest.entry); await window.app.mount(document.getElementById('root'), window.__ROME_APP_BOOTSTRAP__);
      </script></body></html>`);
        return;
      }
      const file = resolve(root, "." + url.pathname);
      if (!file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
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
      } catch {
        res.writeHead(404).end();
      }
    });
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--no-sandbox"],
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 660 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const origin = `http://127.0.0.1:${server.address().port}`;
      const href = (session) =>
        `${origin}/?session=${session}#repo=%2Ffixture&mode=uncommitted&filter=all&base=main&target=worktree&unified=3`;
      const viewer = () =>
        page
          .locator("diffs-container")
          .first()
          .evaluate((element) => {
            let node = element.parentElement;
            while (
              node &&
              !(
                node.scrollHeight > node.clientHeight &&
                ["auto", "scroll"].includes(getComputedStyle(node).overflowY)
              )
            )
              node = node.parentElement;
            if (!node) throw Error("viewer missing");
            window.scrollViewer = node;
            return node.scrollTop;
          });
      const scroll = async (top) => {
        await viewer();
        await page.evaluate((top) => {
          window.scrollViewer.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true }),
          );
          window.scrollViewer.scrollTop = top;
        }, top);
        await page.waitForTimeout(400);
      };
      const saved = (session) =>
        page.evaluate(
          (session) =>
            JSON.parse(
              localStorage.getItem("diffview:scroll:v1:chat:" + session) ||
                "[]",
            ).at(-1)?.[1],
          session,
        );
      const ready = async () => {
        await page.locator("diffs-container").first().waitFor();
        await page.waitForTimeout(1600);
      };
      await page.goto(href("a"));
      await ready();
      await scroll(1250);
      const a = await saved("a");
      assert.ok(a?.top > 500, JSON.stringify(a));
      await page.reload();
      await ready();
      const reloaded = await viewer();
      assert.ok(
        Math.abs(reloaded - a.top) < 8,
        `reload ${reloaded} != ${a.top}`,
      );
      await page.goto(href("b"));
      await ready();
      assert.equal(await viewer(), 0);
      await scroll(450);
      const b = await saved("b");
      assert.ok(b?.top > 200);
      await page.goto(href("a"));
      await ready();
      assert.ok(Math.abs((await viewer()) - a.top) < 8);
      // Host can switch conversations without destroying the iframe.
      await page.evaluate(() =>
        window.postMessage(
          { type: "rome:global-params", params: { chatSessionId: "b" } },
          location.origin,
        ),
      );
      await ready();
      assert.ok(
        Math.abs((await viewer()) - b.top) < 8,
        "context switch restores B",
      );
      // Flush even when unmount happens before the 250ms storage throttle fires.
      await page.evaluate(() => {
        window.scrollViewer.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true }),
        );
        window.scrollViewer.scrollTop = 750;
      });
      await page.waitForTimeout(40);
      await page.evaluate(() => window.app.unmount());
      const closed = await saved("b");
      assert.ok(closed?.top >= 700, JSON.stringify(closed));
      await page.goto(href("b"));
      await ready();
      assert.ok(Math.abs((await viewer()) - closed.top) < 8, "close/reopen");
      await page
        .locator("nav")
        .getByRole("button", { name: /file-040.ts/ })
        .click();
      await page.waitForTimeout(1200);
      await viewer();
      await page.evaluate(() => {
        window.scrollViewer.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true }),
        );
        window.scrollViewer.scrollTop += 110;
      });
      await page.waitForTimeout(400);
      const distant = await saved("b");
      assert.equal(distant.file, "src/file-040.ts");
      await page.reload();
      await ready();
      await viewer();
      const offset = await page
        .getByRole("button", {
          name: "Collapse file: src/file-040.ts",
          exact: true,
        })
        .evaluate((e) => {
          const row = e.closest("diffs-container");
          return (
            window.scrollViewer.getBoundingClientRect().top -
            row.getBoundingClientRect().top
          );
        });
      assert.ok(
        Math.abs(offset - distant.offset) < 8,
        `lazy anchor ${offset} != ${distant.offset}`,
      );
      // Changing comparison and returning preserves each view independently.
      await page.evaluate(() => {
        const q = new URLSearchParams(location.hash.slice(1));
        q.set("filter", "staged");
        location.hash = q.toString();
      });
      await ready();
      assert.equal(await viewer(), 0);
      await scroll(550);
      await page.evaluate(() => {
        const q = new URLSearchParams(location.hash.slice(1));
        q.set("filter", "all");
        location.hash = q.toString();
      });
      await ready();
      await viewer();
      assert.ok(
        await page
          .getByRole("button", {
            name: "Collapse file: src/file-040.ts",
            exact: true,
          })
          .isVisible(),
      );
      removed = distant.file;
      await page.reload();
      await ready();
      assert.equal(await viewer(), 0, "deleted anchor falls back to top");
      assert.equal(errors.length, 0, errors.join("\n"));
      console.log(JSON.stringify({ a, b, reloaded, closed, errors }));
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
