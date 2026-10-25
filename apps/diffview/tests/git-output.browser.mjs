import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

test(
  "production UI preserves unresolved conflicts and parses configured diff prefixes",
  { timeout: 90000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "diffview-output-"));
    const original = {
      HOME: process.env.HOME,
      ROME_PROFILE: process.env.ROME_PROFILE,
    };
    process.env.HOME = home;
    process.env.ROME_PROFILE = "output";
    const repo = join(home, ".rome/output/projects/default/repo");
    await mkdir(repo, { recursive: true });
    const g = (...a) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...a], {
        cwd: repo,
        stdio: "pipe",
      })
        .toString()
        .trim();
    g("init", "-q", "-b", "main");
    g("config", "user.name", "Fixture");
    g("config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, "sample.txt"), "base\n");
    await writeFile(join(repo, "normal.txt"), "normal before\n");
    g("add", ".");
    g("commit", "-qm", "base");
    g("checkout", "-qb", "side");
    await writeFile(join(repo, "sample.txt"), "side\n");
    g("add", ".");
    g("commit", "-qm", "side");
    g("checkout", "-q", "main");
    await writeFile(join(repo, "sample.txt"), "main\n");
    g("add", ".");
    g("commit", "-qm", "main");
    try {
      g("merge", "side");
    } catch {
      /* deliberate unresolved merge */
    }
    await writeFile(join(repo, "normal.txt"), "normal after\n");
    const index = g("ls-files", "--stage"),
      status = g("status", "--porcelain=v2");
    const { createApiHandler } = await import("../dist/api/index.js");
    const handler = createApiHandler({});
    const root = resolve("dist/web"),
      errors = [];
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/api/apps/diffview/")) {
          const r = await handler.handle({
            caller: { kind: "guardian" },
            method: req.method,
            path: url.pathname.slice("/api/apps/diffview/".length).split("/"),
            query: url.searchParams,
          });
          res.writeHead(r.status, Object.fromEntries(r.headers));
          res.end(Buffer.from(await r.arrayBuffer()));
          return;
        }
        if (url.pathname === "/favicon.ico") {
          res.writeHead(204).end();
          return;
        }
        if (url.pathname === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<!doctype html><html lang="zh-CN"><body style="margin:0"><div id="root"></div><script type="module">window.__ROME_APP_BOOTSTRAP__={appId:'diffview',routeBase:'/',routePath:'',assetBase:'',apiBase:'/api/apps/diffview',shell:{locale:'zh',theme:'light',mode:'full'}};const m=await(await fetch('/manifest.json')).json();for(const f of m.styles){const l=document.createElement('link');l.rel='stylesheet';l.href='/'+f;document.head.append(l)}const app=await import('/'+m.entry);await app.mount(document.getElementById('root'),window.__ROME_APP_BOOTSTRAP__);</script></body></html>`,
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
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    });
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--no-sandbox"],
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      for (const setting of ["diff.noprefix", "diff.mnemonicprefix"]) {
        const page = await browser.newPage({
          viewport: { width: 447, height: 660 },
        });
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });

        g("config", "diff.noprefix", "false");
        g("config", "diff.mnemonicprefix", "false");
        g("config", setting, "true");
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?lang=zh#` +
            new URLSearchParams({
              repo,
              mode: "uncommitted",
              filter: "unstaged",
              unified: "3",
            }),
        );
        await page
          .getByText("合并冲突尚未解决，请在工作区处理。", { exact: true })
          .waitFor();
        await page.locator("diffs-container").first().waitFor();
        await page
          .getByRole("button", { name: "文件操作: sample.txt", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("menuitem", { name: "加载完整文件", exact: true })
            .getAttribute("aria-disabled"),
          "true",
        );
        assert.equal(
          await page
            .getByRole("menuitem", { name: "更多未变上下文", exact: true })
            .getAttribute("aria-disabled"),
          "true",
        );
        const result = await page.evaluate(async (repo) => {
          const r = await fetch(
            "/api/apps/diffview/files?" +
              new URLSearchParams({
                repo,
                mode: "uncommitted",
                filter: "unstaged",
              }),
          );
          return { status: r.status, body: await r.json() };
        }, repo);
        assert.equal(result.status, 200);
        assert.equal(
          result.body.files.find((f) => f.path === "sample.txt").conflicted,
          true,
        );
        assert.match(
          result.body.page.patches["normal.txt"].patch,
          /^diff --git a\/normal.txt b\/normal.txt/m,
        );
        assert.match(
          result.body.page.patches["normal.txt"].patch,
          /\+normal after/,
        );
        await page.close();
      }
      assert.deepEqual(errors, []);
      assert.equal(g("ls-files", "--stage"), index);
      assert.equal(g("status", "--porcelain=v2"), status);
      console.log(
        JSON.stringify({
          prefixConfigurations: 2,
          conflictVisible: true,
          errors,
        }),
      );
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
      await rm(home, { recursive: true, force: true });
      for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  },
);
