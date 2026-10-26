import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

// Exercise the production module graph, not just a mock Worker. Rslib can share
// a worker entry with the UI and accidentally run its message handler on Window.
for (const sidebar of [false, true]) {
  test(
    `built ${sidebar ? "sidebar iframe" : "standalone"} isolates worker handlers and releases workers on unmount`,
    { timeout: 90000 },
    async () => {
      const root = resolve("dist/web");
      const server = createServer(async (req, res) => {
        const path = new URL(req.url, "http://localhost").pathname;
        if (path === "/host") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<html><body>Chat host<iframe src="/?p0=1" width="447" height="660"></iframe></body></html>',
          );
          return;
        }
        if (path === "/favicon.ico") {
          res.writeHead(204).end();
          return;
        }
        if (path === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<!doctype html><html lang="en"><body><div id="app" style="height:600px"></div></body></html>',
          );
          return;
        }
        const file = resolve(root, "." + path);
        if (!file.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        try {
          const body = await readFile(file);
          res.setHeader(
            "Content-Type",
            file.endsWith(".js") ? "text/javascript" : "text/css",
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
          viewport: { width: 447, height: 660 },
        });
        const errors = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          window.__probe = { reflected: 0, created: 0, active: 0, replies: 0 };
          const post = window.postMessage.bind(window);
          window.postMessage = function (data, ...args) {
            // Bound the OLD bug: without this, a single seed can OOM the test browser.
            if (data?.type === "error" && ++window.__probe.reflected > 20)
              return;
            return post(data, ...args);
          };
          const NativeWorker = window.Worker;
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              window.__probe.created++;
              window.__probe.active++;
              this.addEventListener("message", (event) => {
                if (event.data?.type === "success") window.__probe.replies++;
              });
            }
            terminate() {
              if (!this.__terminated) {
                this.__terminated = true;
                window.__probe.active--;
              }
              return super.terminate();
            }
          };
        });
        await page.goto(
          `http://127.0.0.1:${server.address().port}/${sidebar ? "host" : "?p0=1"}`,
        );
        const target = sidebar
          ? page.frames().find((frame) => frame.parentFrame())
          : page;
        assert.ok(target, "sidebar iframe must be present");
        await target.evaluate(async () => {
          window.__app = await import("/index.js");
          await window.__app.mount(document.getElementById("app"), {});
        });
        await page.waitForTimeout(3000);
        // Window messages from the host/SDK must never enter the diff worker protocol.
        await target.evaluate(() =>
          window.postMessage({ type: "host-probe" }, "*"),
        );
        await page.waitForTimeout(200);
        const first = await target.evaluate(() => ({ ...window.__probe }));
        await target.evaluate(() => window.__app.unmount());
        await page.waitForTimeout(100);
        await target.evaluate(() =>
          window.postMessage({ type: "after-unmount" }, "*"),
        );
        await page.waitForTimeout(100);
        const closed = await target.evaluate(() => ({ ...window.__probe }));
        console.log(
          JSON.stringify({ first, closed, errors: errors.slice(0, 4) }),
        );
        assert.equal(
          first.reflected,
          0,
          "worker error responses reflected into Window: " +
            JSON.stringify(first),
        );
        assert.equal(errors.length, 0, errors.slice(0, 4).join("\n"));
        assert.equal(first.active, 2, "two real workers must be running");
        assert.ok(
          first.replies > 2,
          "workers must initialize AND highlight actual diffs",
        );
        assert.equal(
          closed.active,
          0,
          "all workers must terminate when the app closes",
        );
        assert.equal(
          closed.reflected,
          0,
          "no orphan message listener after close",
        );
        for (let i = 0; i < 3; i++) {
          await target.evaluate(() =>
            window.__app.mount(document.getElementById("app"), {}),
          );
          await target.waitForFunction(() => window.__probe.active === 2);
          await page.waitForTimeout(250);
          await target.evaluate(() => window.__app.unmount());
          await page.waitForTimeout(100);
          assert.equal(await target.evaluate(() => window.__probe.active), 0);
        }
        assert.equal(errors.length, 0, errors.slice(0, 4).join("\n"));
      } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
}
