import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";

test(
  "production handles type changes, quoted paths, reserved keys and oversized pages without losing ordinary files",
  { timeout: 90000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "diffview-path-safety-"));
    const old = {
      HOME: process.env.HOME,
      ROME_PROFILE: process.env.ROME_PROFILE,
      MAX: process.env.DIFFVIEW_MAX_FILES,
    };
    process.env.HOME = home;
    process.env.ROME_PROFILE = "paths";
    const repo = join(home, ".rome/paths/projects/default/repo");
    await mkdir(repo, { recursive: true });
    const g = (...args) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd: repo,
        stdio: "pipe",
      })
        .toString()
        .trim();
    g("init", "-qb", "main");
    g("config", "user.name", "Fixture");
    g("config", "user.email", "test@example.invalid");
    await writeFile(join(repo, "00-regular.txt"), "before\n");
    await symlink("00-regular.txt", join(repo, "01-link.txt"));
    await writeFile(
      join(repo, "huge.txt"),
      "a".repeat(33 * 1024 * 1024) + "\n",
    );
    await writeFile(join(repo, "z.txt"), "normal before\n");
    g("add", ".");
    g("commit", "-qm", "base");
    await rm(join(repo, "00-regular.txt"));
    await symlink("z.txt", join(repo, "00-regular.txt"));
    await rm(join(repo, "01-link.txt"));
    await writeFile(join(repo, "01-link.txt"), "regular now\n");

    await writeFile(join(repo, "z.txt"), "normal after\n");
    for (const path of [
      "__proto__",
      "constructor",
      "toString",
      "line\nbreak.ts",
      'quote"name.ts',
      "tab\tname.ts",
    ])
      await writeFile(join(repo, path), "export const value = 1;\n");
    const index = g("ls-files", "--stage"),
      status = g("status", "--porcelain=v2");
    const { createApiHandler } = await import(
      process.env.DIFFVIEW_TEST_API_ROOT || "../dist/api/index.js"
    );
    const handler = createApiHandler({});
    const root = resolve(process.env.DIFFVIEW_TEST_WEB_ROOT || "dist/web"),
      errors = [],
      requests = [];
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/api/apps/diffview/")) {
          requests.push(url);
          const r = await handler.handle({
            caller: { kind: "guardian" },
            method: "GET",
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
        const path = resolve(root, "." + url.pathname);
        if (!path.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        const body = await readFile(path);
        res.setHeader(
          "Content-Type",
          path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : "application/json",
        );
        res.end(body);
      } catch (error) {
        errors.push(String(error));
        res.writeHead(500).end(String(error));
      }
    });
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--no-sandbox"],
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      for (const paged of [false, true]) {
        if (paged) {
          process.env.DIFFVIEW_MAX_FILES = "1";
          await writeFile(
            join(repo, "huge.txt"),
            "b".repeat(33 * 1024 * 1024) + "\n",
          );
        } else delete process.env.DIFFVIEW_MAX_FILES;
        const page = await browser.newPage({
          viewport: { width: 1100, height: 900 },
        });
        page.setDefaultTimeout(10000);
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        const href =
          `http://127.0.0.1:${server.address().port}/?lang=zh#` +
          new URLSearchParams({
            repo,
            mode: "uncommitted",
            filter: "all",
            unified: paged ? "5" : "3",
          });
        await page.goto(href);
        const payload = JSON.parse(
          await page.evaluate(async (repo) => {
            const r = await fetch(
              "/api/apps/diffview/files?" +
                new URLSearchParams({ repo, mode: "uncommitted" }),
            );
            const b = await r.json();
            return JSON.stringify({
              status: r.status,
              files: b.files,
              patches: b.page?.patches,
            });
          }, repo),
        );
        assert.equal(payload.status, 200);
        assert.equal(
          new Set(payload.files.map((f) => f.path)).size,
          payload.files.length,
        );
        assert.equal(payload.files.filter((f) => f.typeChanged).length, 2);
        if (paged) assert.equal(payload.patches["huge.txt"].truncated, true);
        assert(Object.hasOwn(payload.patches, "__proto__"));
        await page
          .getByRole("button", { name: "文件操作: __proto__", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "更多未变上下文", exact: true })
          .click();
        await expect
          .poll(
            () =>
              requests.some(
                (u) =>
                  u.pathname.endsWith("/patch") &&
                  u.searchParams.get("path") === "__proto__" &&
                  u.searchParams.get("unified") === "23",
              ),
            { timeout: 10000 },
          )
          .toBe(true);
        // Jump via the ordinary file tree so normal content after placeholders remains reachable.
        await page
          .getByRole("navigation", { name: "文件", exact: true })
          .getByTitle("z.txt", { exact: true })
          .click();
        await page
          .getByRole("button", { name: "文件操作: z.txt", exact: true })
          .waitFor();
        assert.equal(
          await page.getByRole("main", { name: "Diff", exact: true }).count(),
          1,
        );
        assert.deepEqual(errors, []);
        await page.close();
      }
      await writeFile(
        join(repo, "huge.txt"),
        "a".repeat(33 * 1024 * 1024) + "\n",
      );
      assert.equal(g("ls-files", "--stage"), index);
      assert.equal(g("status", "--porcelain=v2"), status);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
      await rm(home, { recursive: true, force: true });
      for (const [key, value] of Object.entries({
        HOME: old.HOME,
        ROME_PROFILE: old.ROME_PROFILE,
        DIFFVIEW_MAX_FILES: old.MAX,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
