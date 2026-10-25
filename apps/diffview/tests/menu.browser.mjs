import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

// Match the shared radio-item geometry without turning Branch into a submenu.
async function scopeAlignment(view, branchSelected) {
  const local = view.getByRole("menuitemradio", {
    name: "未提交",
    exact: true,
  });
  const unpushed = view.getByRole("menuitemradio", { name: /未推送/ });
  const branch = view.getByRole("menuitem", { name: "分支", exact: true });
  const textBox = (item) =>
    item.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, right: rect.right };
      }
      throw new Error("Missing menu label");
    });
  const [localLabel, branchLabel, unpushedLabel] = await Promise.all([
    textBox(local),
    textBox(branch),
    textBox(unpushed),
  ]);
  assert.ok(
    Math.abs(localLabel.x - branchLabel.x) < 1,
    "Branch label must align with local scopes",
  );
  const hint = await unpushed.getByText("↑1", { exact: true }).boundingBox();
  assert.ok(
    hint.x - unpushedLabel.right >= 0 && hint.x - unpushedLabel.right <= 12,
    "Ahead count must sit beside Unpushed, not at the far edge",
  );
  const check = await (branchSelected ? branch : local)
    .locator("svg")
    .boundingBox();
  const row = await local.boundingBox();
  assert.ok(
    Math.abs(row.x + row.width - check.x - check.width - 8) < 1,
    "Selected indicator must use the shared right inset",
  );
  assert.equal(await branch.locator("svg").count(), branchSelected ? 1 : 0);
}

// Production UI + production API; every Git operation is confined to this disposable sandbox.
test(
  "scope menu, local history, tracking and branch controls in standalone/sidebar",
  { timeout: 120000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "diffview-menu-"));
    const original = {
      HOME: process.env.HOME,
      ROME_PROFILE: process.env.ROME_PROFILE,
    };
    process.env.HOME = home;
    process.env.ROME_PROFILE = "menu";
    const repo = join(
      home,
      ".rome/menu/projects/default/repository-with-a-deliberately-long-name",
    );
    await mkdir(repo, { recursive: true });
    const otherRepo = join(home, ".rome/menu/projects/other");
    await mkdir(otherRepo, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], {
      cwd: otherRepo,
      stdio: "pipe",
    });
    const g = (...args) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
    g("init", "-b", "main");
    g("config", "user.name", "Diff Test");
    g("config", "user.email", "test@example.invalid");
    await writeFile(join(repo, "initial.txt"), "initial\n");
    g("add", ".");
    g("commit", "-m", "Initial commit");
    const initial = g("rev-parse", "HEAD");
    for (let i = 0; i < 42; i++)
      g("commit", "--allow-empty", "-m", `Checkpoint ${i}`);
    const base = g("rev-parse", "HEAD"),
      branch = "feature/a-deliberately-long-branch-name-to-test-truncation";
    g("checkout", "-b", branch);
    g("remote", "add", "origin", "/nonexistent/diffview-test-remote");
    g("update-ref", "refs/remotes/origin/feature", base);
    g("config", `branch.${branch}.remote`, "origin");
    g("config", `branch.${branch}.merge`, "refs/heads/feature");
    await writeFile(join(repo, "local.txt"), "local feature\n");
    g("add", "local.txt");
    g("commit", "-m", "Local feature");
    const feature = g("rev-parse", "HEAD");
    await writeFile(join(repo, "initial.txt"), "staged\n");
    g("add", "initial.txt");
    await writeFile(join(repo, "initial.txt"), "unstaged\n");
    await writeFile(join(repo, "loose.txt"), "untracked\n");
    const index = g("ls-files", "--stage"),
      status = g("status", "--porcelain=v2");
    const { createApiHandler } = await import("../dist/api/index.js");
    const handler = createApiHandler({});
    const root = resolve(
        fileURLToPath(new URL("../dist/web/", import.meta.url)),
      ),
      requests = [];
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        if (u.pathname === "/host") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<html><body style="margin:0"><iframe src="/?lang=zh#${new URLSearchParams({ repo, mode: "uncommitted", unified: "3" })}" style="border:0;width:447px;height:660px"></iframe></body></html>`,
          );
          return;
        }
        if (u.pathname.startsWith("/api/apps/diffview/")) {
          requests.push(u.pathname);
          const r = await handler.handle({
            caller: { kind: "guardian" },
            method: req.method,
            path: u.pathname.slice("/api/apps/diffview/".length).split("/"),
            query: u.searchParams,
          });
          res.writeHead(r.status, Object.fromEntries(r.headers));
          res.end(Buffer.from(await r.arrayBuffer()));
          return;
        }
        if (u.pathname === "/favicon.ico") {
          res.writeHead(204).end();
          return;
        }
        if (u.pathname === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end(`<!doctype html><html lang="${u.searchParams.get("lang") === "en" ? "en" : "zh-CN"}" class="dark"><body style="margin:0"><div id="root"></div><script type="module">
   window.__ROME_APP_BOOTSTRAP__={appId:'diffview',routeBase:'/',routePath:'',assetBase:'',apiBase:'/api/apps/diffview'};
   const m=await(await fetch('/manifest.json')).json();for(const f of m.styles){const l=document.createElement('link');l.rel='stylesheet';l.href='/'+f;document.head.append(l)}
   window.app=await import('/'+m.entry);await app.mount(document.getElementById('root'),window.__ROME_APP_BOOTSTRAP__);
  </script></body></html>`);
          return;
        }
        const file = resolve(root, "." + u.pathname);
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
        res.writeHead(500).end(String(e));
      }
    });
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--no-sandbox"],
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const width of [360, 447, 1100]) {
        const page = await browser.newPage({
            viewport: { width, height: 720 },
          }),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error" && !m.text().includes("409 (Conflict)"))
            errors.push(m.text());
        });
        await page.goto(
          width === 447
            ? origin + "/host"
            : origin +
                "/?lang=zh#" +
                new URLSearchParams({
                  repo,
                  mode: "uncommitted",
                  unified: "3",
                }),
        );
        const v =
          width === 447 ? page.frames().find((f) => f.parentFrame()) : page;
        const shot = async (label) => {
          if (process.env.DIFFVIEW_MENU_SCREENSHOTS)
            await page.screenshot({
              path: join(
                process.env.DIFFVIEW_MENU_SCREENSHOTS,
                `${label}-${width}.png`,
              ),
              fullPage: true,
            });
        };
        const scope = v.getByRole("button", { name: "比较版本", exact: true }),
          file = (name) =>
            v.getByRole("button", { name: "折叠文件: " + name, exact: true });
        await v.locator("diffs-container").first().waitFor();
        const scopeSizing = await scope.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            grow: style.flexGrow,
            shrink: style.flexShrink,
            alignment: style.justifySelf,
          };
        });
        assert.deepEqual(scopeSizing, {
          grow: "0",
          shrink: "1",
          alignment: "start",
        });
        const bounds = async () => {
          await v.waitForTimeout(150);
          const r = await v.evaluate(() => {
            const menu = document.querySelector('[role="menu"]'),
              els = [
                ...document.querySelectorAll(
                  'header[aria-label="变更工具栏"] button',
                ),
                ...(menu ? [menu] : []),
              ];
            return {
              width: innerWidth,
              doc: document.documentElement.scrollWidth,
              boxes: els.map((e) => {
                const r = e.getBoundingClientRect();
                return {
                  x: r.x,
                  right: r.right,
                  width: r.width,
                  label: e.getAttribute("aria-label"),
                };
              }),
            };
          });
          assert.ok(r.doc <= r.width + 1, JSON.stringify(r));
          assert.ok(
            r.boxes.every(
              (b) => b.x >= -1 && b.right <= r.width + 1 && b.width >= 16,
            ),
            JSON.stringify(r),
          );
        };
        // Ordinary project links work without React-fiber probing or private host stores.
        await v
          .getByRole("button", { name: "文件操作: initial.txt", exact: true })
          .click();
        const projectLink = v.getByRole("menuitem", {
          name: "在新标签页打开",
          exact: true,
        });
        await projectLink.waitFor();
        assert.match(
          await projectLink.getAttribute("href"),
          /\/projects\/default\/repository-with-a-deliberately-long-name\/initial.txt$/,
        );
        assert.equal(await projectLink.getAttribute("target"), "_blank");
        assert.match(await projectLink.getAttribute("rel"), /noopener/);
        if (width === 447)
          assert.equal(
            await v
              .getByRole("menuitem", { name: "打开文件", exact: true })
              .count(),
            0,
          );
        await v.locator("main").press("Escape");
        const overlap = await v
          .locator('header[aria-label="变更工具栏"] button')
          .evaluateAll((buttons) => {
            const boxes = buttons.map((button) =>
              button.getBoundingClientRect(),
            );
            return boxes.some((a, i) =>
              boxes.some(
                (b, j) =>
                  j > i &&
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
              ),
            );
          });
        assert.equal(overlap, false, "toolbar controls must not overlap");
        const repoButton = v.getByRole("button", { name: "仓库", exact: true });
        await repoButton.click();
        await v.getByText("关联仓库", { exact: true }).waitFor();
        await v.getByText("其它仓库", { exact: true }).waitFor();
        await bounds();
        const rows = v.locator('[role="menu"] [role="menuitemradio"]');
        assert.deepEqual(await rows.allTextContents(), [
          "default/repository-with-a-deliberately-long-name",
          "other",
        ]);
        assert.equal(await rows.first().getAttribute("aria-checked"), "true");
        await rows.last().click();
        await repoButton.click();
        assert.equal(
          await v
            .getByRole("menuitemradio", { name: "other", exact: true })
            .getAttribute("aria-checked"),
          "true",
        );
        await v
          .getByRole("menuitemradio", {
            name: "default/repository-with-a-deliberately-long-name",
            exact: true,
          })
          .click();
        assert.equal(
          await v
            .getByRole("button", { name: /回到.*仓库|Back to.*repository/ })
            .count(),
          0,
        );
        await bounds();
        await scope.click();
        await v.getByRole("menuitemradio", { name: /未推送/ }).waitFor();
        const entries = await v
          .locator('[role="menu"] [role^="menuitem"]')
          .allTextContents();
        assert.deepEqual(
          entries.map((s) => s.replace(/↑1/, "").trim()),
          ["未推送", "未提交", "已暂存", "未暂存", "分支"],
        );
        assert.equal(await v.getByText("上一轮", { exact: true }).count(), 0);
        await bounds();
        await scopeAlignment(v, false);
        await shot("root");
        await v.getByRole("menuitemradio", { name: /未推送/ }).click();
        await file("local.txt").waitFor();
        assert.equal(await file("initial.txt").count(), 0);
        const endpoints = v.getByRole("button", {
          name: "分支选择器",
          exact: true,
        });
        assert.equal(await endpoints.count(), 0);
        await scope.click();
        await v
          .getByRole("menuitemradio", { name: "已暂存", exact: true })
          .click();
        await file("initial.txt").waitFor();
        assert.equal(await file("loose.txt").count(), 0);
        await scope.click();
        await v
          .getByRole("menuitemradio", { name: "未暂存", exact: true })
          .click();
        await file("loose.txt").waitFor();
        await scope.click();
        const branchAction = v.getByRole("menuitem", {
          name: "分支",
          exact: true,
        });
        assert.equal(
          await branchAction.locator(".lucide-chevron-right").count(),
          0,
        );
        assert.equal(
          await v
            .getByRole("menuitem", { name: "已提交", exact: true })
            .count(),
          0,
        );
        await branchAction.click();
        await endpoints.waitFor();
        assert.equal(
          await v.getByRole("menu").count(),
          0,
          "Branch only reveals the selector; it must not open a popup",
        );
        assert.equal(
          await v
            .getByRole("textbox", { name: "分支、标签或提交", exact: true })
            .count(),
          0,
        );
        await scope.click();
        await scopeAlignment(v, true);
        await shot("branch-selected");
        await v.getByRole("menu").press("Escape");
        await endpoints.click();
        await v.getByRole("menuitem", { name: "已提交", exact: true }).click();
        await v.getByRole("menuitemradio", { name: /Local feature/ }).waitFor();
        await bounds();
        await shot("history");
        await v
          .getByRole("menuitem", { name: "更早的提交", exact: true })
          .click();
        await v
          .getByRole("menuitemradio", { name: /Initial commit/ })
          .waitFor();
        await v
          .getByRole("menuitem", { name: "更新的提交", exact: true })
          .click();
        await v.getByRole("menuitemradio", { name: /Local feature/ }).click();
        await file("local.txt").waitFor();
        assert.match(
          await endpoints.textContent(),
          new RegExp(feature.slice(0, 7)),
        );
        assert.match(await scope.textContent(), /^分支/);
        assert.equal(await endpoints.count(), 1);
        await endpoints.click();
        await v.getByRole("menuitem", { name: "已提交", exact: true }).click();
        const input = v.getByRole("textbox", { name: "选择提交", exact: true });
        await input.fill(initial);
        await input.press("Enter");
        await file("initial.txt").waitFor();
        await v.evaluate(() => location.reload());
        await file("initial.txt").waitFor();
        assert.match(
          await endpoints.textContent(),
          new RegExp(initial.slice(0, 7)),
        );
        await endpoints.click();
        await v.getByRole("menuitem", { name: /^基准/ }).click();
        await v
          .getByRole("textbox", { name: "分支、标签或提交", exact: true })
          .waitFor();
        await bounds();
        await v
          .getByRole("menuitemradio", { name: "HEAD", exact: true })
          .click();
        await v
          .getByRole("menuitemradio", { name: "main", exact: true })
          .click();
        await endpoints.waitFor();
        await bounds();
        await shot("branch");
        assert.match(await endpoints.textContent(), /main.*HEAD/);
        await endpoints.click();
        await v
          .getByRole("menuitemradio", { name: "工作区", exact: true })
          .click();
        await v
          .getByRole("menuitemradio", { name: "两点比较", exact: true })
          .click();
        await v.locator("main").press("Escape");
        await file("initial.txt").waitFor();
        assert.match(await endpoints.textContent(), /工作区.*两点比较/);
        await scope.click();
        const local = v.getByRole("menuitemradio", {
          name: "未提交",
          exact: true,
        });
        await local.focus();
        await local.press("Enter");
        assert.equal(await endpoints.count(), 0);
        if (width === 1100) {
          // A page/patch view can expire while another comparison is open. Recover with a
          // fresh list, not an infinite error or patches stamped with the stale fingerprint.
          let injected = false;
          await page.route("**/api/apps/diffview/patch?*", async (route) => {
            if (injected) return route.continue();
            injected = true;
            await route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ error: "stale_view" }),
            });
          });
          await v
            .getByRole("button", { name: "文件操作: initial.txt", exact: true })
            .click();
          const recovered = page.waitForRequest((request) => {
            const u = new URL(request.url());
            return u.pathname.endsWith("/files") && !u.searchParams.has("have");
          });
          await v
            .getByRole("menuitem", { name: "更多未变上下文", exact: true })
            .click();
          await recovered;
          await file("initial.txt").waitFor();
          assert.equal(injected, true);
          await page.unroute("**/api/apps/diffview/patch?*");
          // Explicit refresh carries server-side intent. On wide layouts it is the
          // toolbar button; the options-menu copy exists only on compact layouts.
          const forced = page.waitForRequest((request) => {
            const u = new URL(request.url());
            return (
              u.pathname.endsWith("/files") &&
              u.searchParams.get("refresh") === "1"
            );
          });
          await v.getByRole("button", { name: "刷新", exact: true }).click();
          await forced;
        }
        await bounds();
        if (process.env.DIFFVIEW_MENU_SCREENSHOTS)
          await page.screenshot({
            path: join(
              process.env.DIFFVIEW_MENU_SCREENSHOTS,
              `menu-${width}.png`,
            ),
            fullPage: true,
          });
        assert.deepEqual(errors, []);
        await page.close();
      }
      const emptyCommit = await browser.newPage({
        viewport: { width: 447, height: 660 },
      });
      await emptyCommit.goto(
        origin +
          "/#" +
          new URLSearchParams({ repo, mode: "commit", commit: "" }),
      );
      await emptyCommit
        .getByRole("button", { name: "选择提交", exact: true })
        .click();
      await emptyCommit
        .getByRole("menuitemradio", { name: /Local feature/ })
        .waitFor();
      await emptyCommit
        .getByRole("menuitem", { name: "返回: 已提交", exact: true })
        .click();
      await emptyCommit
        .getByRole("menuitem", { name: "已提交", exact: true })
        .waitFor();
      await emptyCommit.close();
      assert.ok(
        !requests.some((r) => r.endsWith("/refs")),
        "normal scopes must not query GitHub PRs",
      );
      assert.equal(g("ls-files", "--stage"), index);
      assert.equal(g("status", "--porcelain=v2"), status);
      g("config", "--unset", `branch.${branch}.remote`);
      const p = await browser.newPage({
        viewport: { width: 447, height: 660 },
      });
      await p.goto(
        origin + "/#" + new URLSearchParams({ repo, mode: "unpushed" }),
      );
      await p
        .getByText("当前分支没有设置跟踪上游。", { exact: true })
        .waitFor();
      await p.getByRole("button", { name: "比较版本", exact: true }).click();
      assert.equal(
        await p
          .getByRole("menuitemradio", { name: /未推送/ })
          .getAttribute("aria-disabled"),
        "true",
      );
      await p.close();
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
      await rm(home, { recursive: true, force: true });
      for (const [k, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[k];
        else process.env[k] = value;
      }
    }
  },
);
