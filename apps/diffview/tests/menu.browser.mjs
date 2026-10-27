import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

async function expectFocused(locator, message) {
  assert.equal(
    await locator.evaluate((element) => element === document.activeElement),
    true,
    message,
  );
}

// Match the shared radio-item geometry while Branch and PR use the trailing drill rail.
async function scopeAlignment(view, branchSelected) {
  const local = view.getByRole("menuitemradio", {
    name: "未提交",
    exact: true,
  });
  const unpushed = view.getByRole("menuitemradio", { name: /未推送/ });
  const branch = view.getByRole("menuitem", { name: /^分支 · / });
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
    .locator(".lucide-check")
    .boundingBox();
  const row = await (branchSelected ? branch : local).boundingBox();
  assert.ok(
    branchSelected
      ? check.x + check.width < row.x + row.width - 8
      : Math.abs(row.x + row.width - check.x - check.width - 8) < 1,
    "Selected indicator must stay in its trailing rail",
  );
  assert.equal(
    await branch.locator(".lucide-check").count(),
    branchSelected ? 1 : 0,
  );
  assert.equal(await branch.locator(".lucide-chevron-right").count(), 1);
}

// Both drill-down entries share the local radio rows' text and trailing-icon rails.
async function revisionAlignment(view, committed = false) {
  const popup = await view.getByRole("menu").boundingBox();
  assert.ok(
    Math.abs(popup.width - 224) < 1,
    "Revision settings use the compact 14rem width",
  );
  const base = view.getByRole("menuitem", { name: /^基准/ });
  const history = view.getByRole("menuitem", { name: "已提交", exact: true });
  const geometry = (item) =>
    item.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return rect.x;
      }
      throw new Error("Missing menu label");
    });
  const left = await geometry(base);
  assert.ok(
    Math.abs(left - (await geometry(history))) < 1,
    "Revision entries share a left edge",
  );
  const arrow = await base.locator(".lucide-chevron-right").boundingBox();
  const historyArrow = await history
    .locator(".lucide-chevron-right")
    .boundingBox();
  assert.ok(
    Math.abs(arrow.x - historyArrow.x) < 1,
    "Drill arrows share a trailing column",
  );
  const row = await base.boundingBox();
  assert.ok(Math.abs(row.x + row.width - arrow.x - arrow.width - 8) < 1);
  for (const item of await view
    .locator('[role="menu"] [data-slot="dropdown-menu-label"]')
    .all()) {
    assert.ok(
      Math.abs(left - (await geometry(item))) < 1,
      "All section labels align with the drill-down rows",
    );
  }
  const segmentedGroups = view.locator('[role="menu"] [data-review-segments]');
  assert.equal(
    await segmentedGroups.count(),
    2,
    "Target and comparison method each use one segmented group",
  );
  for (const group of await segmentedGroups.all()) {
    const radios = group.getByRole("menuitemradio");
    assert.equal(await radios.count(), 2);
    const [first, second] = await Promise.all([
      radios.nth(0).boundingBox(),
      radios.nth(1).boundingBox(),
    ]);
    assert.ok(first && second);
    assert.ok(
      Math.abs(first.y - second.y) < 1 &&
        Math.abs(first.height - second.height) < 1 &&
        Math.abs(first.width - second.width) < 1,
      "Each segmented choice is an equal-width horizontal pair",
    );
    assert.ok(
      first.x + first.width <= second.x + 1,
      "Segmented choices must not wrap or overlap",
    );
  }
  if (committed) {
    const check = await history.locator(".lucide-check").boundingBox();
    assert.ok(
      check.x > left && check.x + check.width <= historyArrow.x,
      "Committed selection stays on the right without moving its label",
    );
  }
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
    g("update-ref", "refs/remotes/origin/main", base);
    g("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    g("config", `branch.${branch}.remote`, "origin");
    g("config", `branch.${branch}.merge`, "refs/heads/feature");
    await writeFile(join(repo, "local.txt"), "local feature\n");
    g("add", "local.txt");
    g("commit", "-m", "Local feature");
    const feature = g("rev-parse", "HEAD");
    await writeFile(join(repo, "initial.txt"), "staged\n");
    g("add", "initial.txt");
    await writeFile(join(repo, "initial.txt"), "unstaged\n");
    await writeFile(join(repo, "loose.test.ts"), "untracked\n");
    const index = g("ls-files", "--stage"),
      status = g("status", "--porcelain=v2");
    const { createApiHandler } = await import("../dist/api/index.js");
    const handler = createApiHandler({});
    const root = resolve(
      fileURLToPath(new URL("../dist/web/", import.meta.url)),
    );
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
        let refsRequests = 0;
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.endsWith("/refs")) refsRequests++;
        });
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error" && !m.text().includes("409 (Conflict)"))
            errors.push(m.text());
        });
        await page.route("**/api/apps/diffview/refs?*", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              branches: ["main", branch],
              commits: [],
              tags: [],
              currentBranchPr: {
                number: 30,
                title: "Current branch PR",
                baseRefName: "main",
                headRefName: branch,
                updatedAt: "2026-10-27T10:00:00Z",
                isCrossRepository: false,
              },
              prs: [
                {
                  number: 18,
                  title: "Other branch PR",
                  baseRefName: "main",
                  headRefName: "refactor/code-review-ui-library",
                  updatedAt: "2026-10-27T09:00:00Z",
                  isCrossRepository: false,
                },
              ],
              prState: "ready",
            }),
          }),
        );
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
        let refsRequestsAtScopeChecks = refsRequests;
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
        assert.equal(
          await repoButton.locator(".lucide-chevron-down").count(),
          0,
          "Repository trigger does not need a decorative down arrow",
        );
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
        assert.equal(
          await scope.locator(".lucide-chevron-down").count(),
          0,
          "Comparison trigger does not need a decorative down arrow",
        );
        assert.match(
          (await scope.textContent()).replace(/\s/g, ""),
          /未提交\+2−1/,
          "The toolbar always shows all-change totals",
        );
        assert.deepEqual(
          await scope.evaluate((element) =>
            [...element.querySelectorAll("span")]
              .filter(
                (span) =>
                  span.children.length === 0 &&
                  /^[+−]\d+$/.test(span.textContent),
              )
              .map((span) => span.style.minWidth),
          ),
          ["2ch", "2ch"],
          "Each diff count reserves at least two characters",
        );
        assert.equal(
          await v
            .getByRole("button", { name: "分支选择器", exact: true })
            .count(),
          0,
          "The separate revision trigger is removed",
        );
        await scope.click();
        await v.getByRole("menuitemradio", { name: /未推送/ }).waitFor();
        const changeSummary = v.getByLabel("变更统计", { exact: true });
        assert.equal(
          await v.getByText("变更统计", { exact: true }).count(),
          0,
          "The summary has an accessible name but no redundant visible heading",
        );
        assert.match(await changeSummary.textContent(), /主要变更 · 1\+1−1/);
        assert.match(await changeSummary.textContent(), /辅助变更 · 1\+1−0/);
        assert.match(await changeSummary.textContent(), /全部变更 · 2\+2−1/);
        const entries = await v
          .locator('[role="menu"] [role^="menuitem"]')
          .allTextContents();
        assert.deepEqual(
          entries.map((s) => s.replace(/↑1/, "").trim()),
          [
            "未推送",
            "未提交",
            "已暂存",
            "未暂存",
            `分支 · ${branch}`,
            "拉取请求 · #30",
          ],
        );
        const markedRows = [
          v.getByRole("menuitemradio", { name: /未推送/ }),
          v.getByRole("menuitemradio", { name: "未提交", exact: true }),
          v.getByRole("menuitemradio", { name: "已暂存", exact: true }),
          v.getByRole("menuitemradio", { name: "未暂存", exact: true }),
          v.getByRole("menuitem", { name: `分支 · ${branch}`, exact: true }),
          v.getByRole("menuitem", {
            name: "拉取请求 · #30",
            exact: true,
          }),
        ];
        for (const row of markedRows)
          assert.equal(
            await row.evaluate(
              (element) => getComputedStyle(element).whiteSpace,
            ),
            "nowrap",
            `${await row.textContent()} must remain on one line`,
          );
        assert.deepEqual(
          await changeSummary
            .locator(":scope > div")
            .evaluateAll((rows) =>
              rows.map((row) => getComputedStyle(row).whiteSpace),
            ),
          ["nowrap", "nowrap", "nowrap"],
          "All three change-summary rows must remain on one line",
        );
        // Returning from the other repository starts one repository-level refs request.
        // Let that activation settle before asserting that scope-only changes add none.
        await page.waitForTimeout(100);
        refsRequestsAtScopeChecks = refsRequests;
        const [prBox, summaryBox] = await Promise.all([
          v
            .getByRole("menuitem", {
              name: "拉取请求 · #30",
              exact: true,
            })
            .boundingBox(),
          changeSummary.boundingBox(),
        ]);
        assert.ok(
          summaryBox.y >= prBox.y + prBox.height,
          "Change totals stay at the bottom so changing numbers cannot move scope rows",
        );
        assert.equal(await v.getByText("上一轮", { exact: true }).count(), 0);
        await bounds();
        await scopeAlignment(v, false);
        assert.equal(
          await v
            .getByRole("menuitem", {
              name: `分支 · ${branch}`,
              exact: true,
            })
            .getByText(`· ${branch}`, { exact: true })
            .evaluate((element) =>
              element.classList.contains("text-muted-foreground"),
            ),
          true,
          "Selected branch value is visually secondary to the row label",
        );
        await shot("root");
        await v.getByRole("menuitemradio", { name: /未推送/ }).click();
        await file("local.txt").waitFor();
        assert.equal(await file("initial.txt").count(), 0);
        await scope.click();
        await v
          .getByRole("menuitemradio", { name: "已暂存", exact: true })
          .click();
        await file("initial.txt").waitFor();
        assert.equal(await file("loose.test.ts").count(), 0);
        await scope.click();
        await v
          .getByRole("menuitemradio", { name: "未暂存", exact: true })
          .click();
        await file("loose.test.ts").waitFor();
        await scope.click();
        const branchAction = v.getByRole("menuitem", {
          name: `分支 · ${branch}`,
          exact: true,
        });
        assert.equal(
          await branchAction.locator(".lucide-chevron-right").count(),
          1,
        );
        assert.equal(
          await v
            .getByRole("menuitem", { name: "已提交", exact: true })
            .count(),
          0,
        );
        await branchAction.click();
        const branchBack = v.getByRole("menuitem", {
          name: "返回: 分支",
          exact: true,
        });
        await branchBack.waitFor();
        assert.equal(await branchBack.getAttribute("title"), "分支");
        assert.equal(
          await branchBack.evaluate(
            (element) => getComputedStyle(element).whiteSpace,
          ),
          "nowrap",
        );
        const targetLabel = v
          .locator('[data-slot="dropdown-menu-label"]')
          .filter({ hasText: branch });
        await targetLabel.waitFor();
        assert.equal(await targetLabel.getAttribute("title"), branch);
        assert.equal(
          await targetLabel.evaluate(
            (element) => getComputedStyle(element).whiteSpace,
          ),
          "nowrap",
        );
        assert.equal(
          await targetLabel
            .locator("span")
            .last()
            .evaluate((element) => getComputedStyle(element).textOverflow),
          "ellipsis",
        );
        await revisionAlignment(v);
        if (width === 447) {
          const baseItem = v.getByRole("menuitem", { name: /^基准/ });
          const historyItem = v.getByRole("menuitem", {
            name: "已提交",
            exact: true,
          });
          const worktreeItem = v.getByRole("menuitemradio", {
            name: "工作区",
            exact: true,
          });
          const headItem = v.getByRole("menuitemradio", {
            name: "HEAD",
            exact: true,
          });
          await branchBack.focus();
          await branchBack.press("ArrowDown");
          await expectFocused(baseItem, "Base is keyboard reachable");
          await baseItem.press("ArrowDown");
          await expectFocused(historyItem, "History is keyboard reachable");
          await historyItem.press("ArrowDown");
          await expectFocused(
            worktreeItem,
            "The first target segment is keyboard reachable",
          );
          await worktreeItem.press("ArrowDown");
          await expectFocused(
            headItem,
            "The second target segment is keyboard reachable",
          );
          await headItem.press("Enter");
          assert.equal(await headItem.getAttribute("aria-checked"), "true");
          await headItem.press("ArrowUp");
          await worktreeItem.press("Enter");
          assert.equal(await worktreeItem.getAttribute("aria-checked"), "true");
        }
        assert.equal(await v.getByRole("menu").count(), 1);
        assert.equal(
          await v
            .getByRole("textbox", { name: "分支、标签或提交", exact: true })
            .count(),
          0,
        );
        await bounds();
        await shot("branch-settings");
        await v.getByRole("menuitem", { name: "已提交", exact: true }).click();
        await v.getByRole("menuitemradio", { name: /Local feature/ }).waitFor();
        await bounds();
        assert.ok(
          Math.abs((await v.getByRole("menu").boundingBox()).width - 320) < 1,
          "Commit history keeps the wider 20rem layout",
        );
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
          await scope.textContent(),
          new RegExp(feature.slice(0, 7)),
        );
        assert.equal(
          await v
            .getByRole("button", { name: "分支选择器", exact: true })
            .count(),
          0,
        );
        await scope.click();
        await v.getByRole("menuitem", { name: "分支", exact: true }).click();
        await bounds();
        await revisionAlignment(v, true);
        await shot("revision-committed");
        await v.getByRole("menuitem", { name: "已提交", exact: true }).click();
        const input = v.getByRole("textbox", { name: "选择提交", exact: true });
        await input.fill(initial);
        await input.press("Enter");
        await file("initial.txt").waitFor();
        await v.evaluate(() => location.reload());
        await file("initial.txt").waitFor();
        assert.match(
          await scope.textContent(),
          new RegExp(initial.slice(0, 7)),
        );
        await scope.click();
        await v.getByRole("menuitem", { name: "分支", exact: true }).click();
        await v.getByRole("menuitem", { name: /^基准/ }).click();
        await v
          .getByRole("textbox", { name: "分支、标签或提交", exact: true })
          .waitFor();
        await bounds();
        assert.ok(
          Math.abs((await v.getByRole("menu").boundingBox()).width - 320) < 1,
          "Branch names keep the wider 20rem layout",
        );
        await v
          .getByRole("menuitemradio", { name: "HEAD", exact: true })
          .click();
        await v
          .getByRole("menuitemradio", { name: "main", exact: true })
          .click();
        await bounds();
        await shot("branch");
        assert.match(await scope.textContent(), /^main/);
        await scope.click();
        await v
          .getByRole("menuitem", { name: `分支 · ${branch}`, exact: true })
          .click();
        await v
          .getByRole("menuitemradio", { name: "工作区", exact: true })
          .click();
        await v
          .getByRole("menuitemradio", { name: "两点比较", exact: true })
          .click();
        await v.locator("main").press("Escape");
        await file("initial.txt").waitFor();
        assert.match(
          (await scope.getAttribute("title")) || "",
          /工作区.*直接对比/,
        );
        await scope.click();
        const local = v.getByRole("menuitemradio", {
          name: "未提交",
          exact: true,
        });
        await local.focus();
        await local.press("Enter");
        await scope.click();
        await v.getByRole("menuitem", { name: /^分支 · / }).click();
        await v
          .getByRole("menuitemradio", { name: "工作区", exact: true })
          .waitFor();
        await v.getByRole("menu").press("Escape");
        assert.match(await scope.textContent(), /^origin\/main/);
        assert.doesNotMatch(
          (await scope.getAttribute("title")) || "",
          /直接对比/,
        );
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
        assert.ok(
          refsRequests <=
            refsRequestsAtScopeChecks + 1 + (width === 1100 ? 1 : 0),
          "scope changes reuse a repository-level bounded branch/PR DTO instead of fanning out by row",
        );
        let releasePrFiles;
        const prFilesGate =
          width === 447
            ? new Promise((resolve) => {
                releasePrFiles = resolve;
              })
            : Promise.resolve();
        await page.route("**/api/apps/diffview/files?*", async (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get("mode") !== "pr") return route.continue();
          await prFilesGate;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              files: [],
              totals: {
                primary: { files: 0, added: 0, deleted: 0 },
                supporting: { files: 0, added: 0, deleted: 0 },
                all: { files: 0, added: 0, deleted: 0 },
                categories: {},
              },
              fingerprint: "test-pr",
              head: "head",
              base: "base",
              pullRequest: {
                number: 18,
                baseRefName: "main",
                headRefName: "refactor/code-review-ui-library",
              },
            }),
          });
        });
        await scope.click();
        await v
          .getByRole("menuitem", { name: "拉取请求 · #30", exact: true })
          .click();
        const prInput = v.getByRole("textbox", {
          name: "PR 编号",
          exact: true,
        });
        await prInput.waitFor();
        assert.equal(await v.getByRole("menu").count(), 1);
        await v
          .getByRole("menuitem", { name: "返回: 拉取请求", exact: true })
          .click();
        assert.equal(
          await v
            .getByRole("menuitem", {
              name: "拉取请求 · #30",
              exact: true,
            })
            .count(),
          1,
        );
        await v.getByRole("menu").press("Escape");
        await scope.click();
        await v
          .getByRole("menuitem", { name: "拉取请求 · #30", exact: true })
          .click();
        await v
          .getByRole("textbox", { name: "PR 编号", exact: true })
          .fill("18");
        const prFilesResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith("/files") &&
            url.searchParams.get("mode") === "pr"
          );
        });
        await v
          .getByRole("textbox", { name: "PR 编号", exact: true })
          .press("Enter");
        assert.match(await scope.textContent(), /^#18/);
        if (width === 447) {
          assert.match(
            (await scope.textContent()).replace(/\s/g, ""),
            /^#18\+2−1/,
            "The previous indicator stays in place while the new diff loads",
          );
          await v.waitForTimeout(2500);
          assert.match((await scope.textContent()).replace(/\s/g, ""), /\+2−1/);
          await v.waitForFunction(() => {
            const trigger = document.querySelector(
              'button[aria-label="比较版本"]',
            );
            return trigger && !trigger.textContent.includes("+2");
          });
          releasePrFiles();
        }
        await prFilesResponse;
        await v.waitForFunction(() => {
          const trigger = document.querySelector(
            'button[aria-label="比较版本"]',
          );
          return trigger && !trigger.textContent.includes("+2");
        });
        await scope.click();
        await v
          .getByRole("menuitem", {
            name: "分支 · refactor/code-review-ui-library",
            exact: true,
          })
          .waitFor();
        await v
          .getByRole("menuitem", { name: "拉取请求 · #18", exact: true })
          .waitFor();
        await shot("pr-linked");
        await v
          .getByRole("menuitemradio", { name: "未提交", exact: true })
          .click();
        await scope.click();
        await v
          .getByRole("menuitem", { name: `分支 · ${branch}`, exact: true })
          .waitFor();
        await v
          .getByRole("menuitem", { name: "拉取请求 · #30", exact: true })
          .waitFor();
        await v.getByRole("menu").press("Escape");
        await v.getByRole("button", { name: "审阅选项", exact: true }).click();
        assert.equal(
          await v
            .getByRole("menuitem", { name: /Pull Request|拉取请求/ })
            .count(),
          0,
          "PR selection no longer lives in the ambiguous overflow menu",
        );
        await v.getByRole("menu").press("Escape");
        await page.unroute("**/api/apps/diffview/refs?*");
        await page.unroute("**/api/apps/diffview/files?*");
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
      const failedPrs = await browser.newPage({
        viewport: { width: 447, height: 660 },
      });
      await failedPrs.route("**/api/apps/diffview/refs?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "internal" }),
        }),
      );
      await failedPrs.goto(
        origin +
          "/?lang=zh#" +
          new URLSearchParams({ repo, mode: "uncommitted", unified: "3" }),
      );
      const failedScope = failedPrs.getByRole("button", {
        name: "比较版本",
        exact: true,
      });
      await failedScope.waitFor();
      await failedScope.click();
      await failedPrs
        .getByRole("menuitem", { name: `分支 · ${branch}`, exact: true })
        .click();
      await failedPrs.getByRole("menuitem", { name: /^基准/ }).click();
      await failedPrs
        .getByRole("menuitemradio", { name: branch, exact: true })
        .waitFor();
      await failedPrs.getByRole("menu").press("Escape");
      await failedScope.click();
      await failedPrs
        .getByRole("menuitem", { name: "拉取请求", exact: true })
        .click();
      await failedPrs
        .getByRole("menuitem", { name: "无法读取仓库。 · 重试", exact: true })
        .waitFor();
      assert.equal(
        await failedPrs.getByRole("status", { name: "加载中…" }).count(),
        0,
      );
      await failedPrs.close();
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
