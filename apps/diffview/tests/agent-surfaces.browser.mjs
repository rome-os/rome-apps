import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { chromium } from "@playwright/test";
import { setCurrentActionContextResolver } from "@rome-os/app-runtime";

test(
  "built sidebar and registered cards: isolation, restore, manual race, pinned refs",
  { timeout: 150000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "diffview-agent-browser-")),
      oldHome = process.env.HOME,
      oldProfile = process.env.ROME_PROFILE;
    process.env.HOME = home;
    process.env.ROME_PROFILE = "test";
    const { ROOT } = await import("../dist/lib/git.js");
    const { selectionStore } = await import("../dist/lib/selectionStore.js");
    const { createViewAction } = await import("../dist/lib/agentAction.js");
    const { createApiHandler } = await import("../dist/api/index.js");
    const raw = new Database(join(home, "db.sqlite"));
    raw.exec(
      await readFile(
        new URL(
          "../src/db/migrations/0000_agent_surfaces.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const db = {
        connection: drizzle(raw),
        tableName: (n) => "diffview__" + n,
        tablePrefix: "diffview__",
      },
      ctx = { db },
      store = selectionStore(db);
    const a = join(ROOT, "default", "repo a"),
      b = join(ROOT, "other", "repo b");
    for (const repo of [a, b]) {
      await mkdir(repo, { recursive: true });
      const g = (...args) =>
        execFileSync("git", args, { cwd: repo, stdio: "pipe" })
          .toString()
          .trim();
      g("init", "-b", "main");
      g("config", "user.name", "Fixture");
      g("config", "user.email", "test@example.invalid");
      await writeFile(join(repo, "file.txt"), "old\n");
      g("add", ".");
      g("commit", "-m", "initial");
      await writeFile(join(repo, "file.txt"), "new\n");
      g("commit", "-am", "next");
      await writeFile(join(repo, "file.txt"), "working\n");
    }
    const select = createViewAction("select", {}, { appContext: ctx }),
      card = createViewAction("card", {}, { appContext: ctx });
    setCurrentActionContextResolver(() => ({
      actorKind: "guardian",
      channelContext: { channel: "webchat", threadId: "one" },
    }));
    const handler = createApiHandler(ctx),
      root = resolve("dist/web");
    let delay = false,
      release;
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        if (u.pathname === "/theme.css") {
          res.setHeader("Content-Type", "text/css");
          res.end(
            await readFile(
              new URL("./fixtures/rome-ember-theme.css", import.meta.url),
            ),
          );
          return;
        }
        if (u.pathname.startsWith("/api/chat/sessions/")) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ projectPath: "default" }));
          return;
        }
        if (u.pathname.startsWith("/api/apps/diffview/")) {
          if (
            u.pathname.endsWith("/selection/one") &&
            req.method === "GET" &&
            delay
          ) {
            const snapshot = store.read("one");
            delay = false;
            await new Promise((r) => (release = r));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(snapshot));
            return;
          }
          if (u.pathname.endsWith("/refs")) {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                prs: [],
                prState: "ready",
                currentBranch: "main",
              }),
            );
            return;
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const r = await handler.handle({
            caller: { kind: "guardian" },
            method: req.method,
            path: u.pathname.slice("/api/apps/diffview/".length).split("/"),
            query: u.searchParams,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          res.writeHead(r.status, Object.fromEntries(r.headers));
          res.end(Buffer.from(await r.arrayBuffer()));
          return;
        }
        if (u.pathname === "/host") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<iframe style="width:447px;height:720px" src="/panel?chat=${u.searchParams.get("chat") || "one"}"></iframe>`,
          );
          return;
        }
        if (["/panel", "/card"].includes(u.pathname)) {
          const chat = u.searchParams.get("chat") || "one",
            id = u.searchParams.get("id");
          res.setHeader("Content-Type", "text/html");
          res.end(`<!doctype html><html lang="zh-CN" data-theme="ember"><head><link rel="stylesheet" href="/theme.css"></head><body style="margin:0"><div id="root"></div><script type="module">
   const bootstrap={appId:'diffview',routeBase:'/',routePath:'',assetBase:'',apiBase:'/api/apps/diffview',globalParams:{chatSessionId:${JSON.stringify(chat)}},shell:{locale:'zh-CN',theme:'light',themeName:'ember',mode:'embedded'}};
   window.__ROME_APP_BOOTSTRAP__=bootstrap;
   const m=await(await fetch('/manifest.json')).json();for(const f of m.styles){const l=document.createElement('link');l.rel='stylesheet';l.href='/'+f;document.head.append(l)}
   window.app=await import('/'+m.entry);window.addEventListener('rome:host-navigate',e=>window.lastNavigation=e.detail);
   ${id ? `await app.mountComponent(document.getElementById('root'),'comparison-card',{bootstrap,props:{cardId:${JSON.stringify(id)}},host:{resolved:false,submit(){throw Error('must not suspend')},dismiss(){throw Error('must not suspend')}}});` : `await app.mount(document.getElementById('root'),bootstrap);`}
   </script></body></html>`);
          return;
        }
        if (u.pathname === "/favicon.ico") {
          res.writeHead(204).end();
          return;
        }
        const file = resolve(root, "." + u.pathname);
        if (!file.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "application/json",
        );
        res.end(await readFile(file));
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
    const context = await browser.newContext({ deviceScaleFactor: 2 }),
      errors = [];
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    const until = async (fn, label) => {
      for (let i = 0; i < 180; i++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("Timed out: " + label);
    };
    const frame = (p) => p.frames().find((f) => f.url().includes("/panel?"));
    const repoOf = (p) =>
      frame(p)
        .getByRole("button", { name: "仓库", exact: true })
        .getAttribute("title", { timeout: 1500 });
    const hasRepo = async (p, r) => {
      try {
        return (await repoOf(p))?.includes(r);
      } catch {
        return false;
      }
    };
    try {
      const one = await context.newPage(),
        two = await context.newPage();
      await one.goto(origin + "/host?chat=one");
      await two.goto(origin + "/host?chat=two");
      await until(
        async () => (await hasRepo(one, a)) && (await hasRepo(two, a)),
        "Default repo",
      );
      assert.equal((await select.execute({ repo: b })).status, "ok");
      await until(() => hasRepo(one, b), "opened panel follows action");
      assert.ok(await hasRepo(two, a));
      await one.close();
      assert.equal(
        (
          await select.execute({
            repo: b,
            kind: "refs",
            base: "HEAD~1",
            target: "HEAD",
            dots: "two",
          })
        ).status,
        "ok",
      );
      const reopened = await context.newPage();
      await reopened.goto(origin + "/host?chat=one");
      await until(() => hasRepo(reopened, b), "closed panel restores target");
      await until(
        async () =>
          (await frame(reopened).evaluate(() => location.hash)).includes(
            "toRef=",
          ),
        "pinned target",
      );
      assert.ok(await hasRepo(two, a));
      delay = true;
      await until(() => !!release, "capture old poll");
      const view = frame(reopened);
      await view.getByRole("button", { name: "仓库", exact: true }).click();
      await view
        .getByRole("menuitemradio")
        .filter({ hasText: "repo a" })
        .click();
      await until(
        () => store.read("one").state?.repo === a,
        "persist manual intent",
      );
      release();
      release = undefined;
      await new Promise((r) => setTimeout(r, 1600));
      assert.ok(await hasRepo(reopened, a));
      const shown = await card.execute({
        repo: b,
        kind: "refs",
        base: "HEAD~1",
        target: "HEAD",
        dots: "three",
      });
      assert.equal(shown.status, "show_widget");
      assert.equal(store.read("one").state.repo, a);
      const cardPage = await context.newPage();
      await cardPage.goto(origin + "/card?id=" + shown.widget.props.cardId);
      await cardPage
        .getByRole("button", { name: "在 Diffview 打开", exact: true })
        .waitFor();
      assert.ok(
        (await cardPage.locator("body").innerText()).includes("HEAD~1"),
      );
      await cardPage
        .getByRole("button", { name: "在 Diffview 打开", exact: true })
        .click();
      await until(
        async () => !!(await cardPage.evaluate(() => window.lastNavigation)),
        "SDK navigation",
      );
      const nav = await cardPage.evaluate(() => window.lastNavigation);
      assert.ok(nav.path.includes("one"));
      assert.equal(nav.state.widgets[0].appId, "diffview");
      await until(() => hasRepo(reopened, b), "card target");
      assert.ok(await hasRepo(two, a));
      const workspace = await card.execute({ repo: b });
      const wp = await context.newPage();
      await wp.goto(origin + "/card?id=" + workspace.widget.props.cardId);
      await wp
        .getByRole("button", { name: "在 Diffview 打开", exact: true })
        .waitFor();
      assert.ok(
        !(await wp.locator("body").innerText()).includes("不是不可变快照"),
      );
      await wp.getByRole("button", { name: "卡片详情", exact: true }).click();
      assert.ok(
        (await wp.getByRole("dialog").innerText()).includes("不是不可变快照"),
      );
      assert.equal(
        await wp.evaluate(() => window.lastNavigation),
        undefined,
        "details must not open the sidebar",
      );
      await wp.keyboard.press("Escape");
      await wp.setViewportSize({ width: 300, height: 260 });
      await wp.screenshot({
        path: "/tmp/diffview-agent-workspace-card.zh.png",
      });
      await wp.evaluate(() => (document.documentElement.lang = "en"));
      await wp
        .getByRole("button", { name: "Open in Diffview", exact: true })
        .waitFor();
      assert.equal(
        await wp
          .getByRole("button", { name: "在 Diffview 打开", exact: true })
          .count(),
        0,
      );
      await wp.screenshot({ path: "/tmp/diffview-agent-workspace-card.png" });
      // Compact card: actual narrow layouts, overflow, keyboard, error and exact disclosure.
      const fixtureId = "00000000-0000-4000-8000-000000000001";
      const original = store.card(workspace.widget.props.cardId);
      store.putCard(fixtureId, "one", {
        ...original,
        name: "rome-apps-diffview-agent",
        branch: "feat/diffview-agent-surfaces",
        totals: { files: 35, added: 204, deleted: 28, binary: 0 },
        staged: { files: 0, added: 0, deleted: 0, binary: 0 },
        unstaged: { files: 15, added: 204, deleted: 28, binary: 0 },
        untracked: 20,
        conflicts: 0,
        stable: true,
      });
      await wp.evaluate(() => (document.documentElement.lang = "zh-CN"));
      await wp.goto(origin + "/card?id=" + fixtureId);
      await wp.getByTestId("card-totals").waitFor();
      const face = wp.getByTestId("comparison-card");
      assert.ok(
        (
          await face.evaluate((e) =>
            getComputedStyle(e).getPropertyValue("--success"),
          )
        ).trim(),
        "theme fixture must provide inherited host tokens",
      );
      assert.ok((await face.innerText()).includes("未暂存 15 · 未跟踪 20"));
      assert.ok(!(await face.innerText()).includes("已暂存 0"));
      assert.ok(!(await face.innerText()).includes(original.repo));
      for (const width of [240, 300, 384]) {
        await wp.setViewportSize({ width, height: 300 });
        const size = await face.evaluate((e) => ({
          width: e.getBoundingClientRect().width,
          height: e.getBoundingClientRect().height,
          scroll: e.scrollWidth,
          client: e.clientWidth,
        }));
        assert.ok(
          size.width <= width && size.height <= 165,
          JSON.stringify(size),
        );
        assert.ok(size.scroll <= size.client, "card must not overflow");
        const stats = await wp
          .getByTestId("card-totals")
          .evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
        assert.ok(stats.scroll <= stats.client, "stats must not overflow");
      }
      await wp.setViewportSize({ width: 300, height: 300 });
      await face.screenshot({ path: "/tmp/diffview-compact-card.zh.png" });
      await wp.keyboard.press("Tab");
      const openButton = wp.getByRole("button", {
        name: "在 Diffview 打开",
        exact: true,
      });
      assert.equal(
        await openButton.evaluate((e) => e === e.getRootNode().activeElement),
        true,
      );
      await wp.keyboard.press("Tab");
      await wp.keyboard.press("Enter");
      assert.ok(
        (await wp.getByRole("dialog").innerText()).includes(original.repo),
      );
      await wp.keyboard.press("Escape");
      await until(
        async () =>
          await wp
            .getByRole("button", { name: "卡片详情" })
            .evaluate((e) => e === e.getRootNode().activeElement),
        "popover restores focus after close animation",
      );
      let releaseOpen;
      await wp.route("**/cards/*/open", async (route) => {
        await new Promise((r) => (releaseOpen = r));
        await route.fulfill({ status: 500, body: "open failed" });
      });
      await openButton.click({ position: { x: 8, y: 8 } });
      await until(() => !!releaseOpen, "pending card open");
      assert.equal(await openButton.isDisabled(), true);
      releaseOpen();
      await wp.getByRole("alert").waitFor();
      assert.equal(await openButton.isEnabled(), true);
      await wp.unroute("**/cards/*/open");
      await openButton.press("Enter");
      await until(
        async () => !!(await wp.evaluate(() => window.lastNavigation)),
        "keyboard opens card",
      );
      await wp.evaluate(() => {
        document.documentElement.lang = "en";
        document.documentElement.classList.add("dark");
      });
      await wp
        .getByRole("button", { name: "Open in Diffview", exact: true })
        .waitFor();
      await face.screenshot({ path: "/tmp/diffview-compact-card.en-dark.png" });
      const largeId = "00000000-0000-4000-8000-000000000002";
      store.putCard(largeId, "one", {
        ...original,
        name: "really-long-repo-".repeat(10),
        branch: "branch/".repeat(25),
        stable: false,
        conflicts: 2,
        totals: {
          files: 123456,
          added: 98765432,
          deleted: 34567890,
          binary: 3,
        },
      });
      await wp.goto(origin + "/card?id=" + largeId);
      await wp.getByTestId("card-totals").waitFor();
      assert.equal(
        await wp.getByRole("img", { name: /工作区采样需注意/ }).count(),
        1,
      );
      await wp.getByRole("button", { name: "卡片详情" }).click();
      assert.ok(
        (await wp.getByRole("dialog").innerText()).includes("98765432"),
      );
      assert.ok(
        (await wp.getByRole("dialog").innerText()).includes("统计可能不一致"),
      );
      await wp.keyboard.press("Escape");
      const largeStats = await wp
        .getByTestId("card-totals")
        .evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
      assert.ok(largeStats.scroll <= largeStats.client);
      await wp
        .getByTestId("comparison-card")
        .screenshot({ path: "/tmp/diffview-compact-card.large.png" });
      await wp.goto(origin + "/card?id=00000000-0000-4000-8000-000000000003");
      await wp.getByRole("alert").waitFor();
      assert.equal(
        await wp.getByRole("button", { name: "在 Diffview 打开" }).count(),
        0,
      );
      // Rebind the same iframe through the SDK host-context wire while an old
      // chat poll is held. An old response cannot leak into the newly bound chat.
      delay = true;
      await until(() => !!release, "capture poll before host rebind");
      await reopened.evaluate(() =>
        document
          .querySelector("iframe")
          .contentWindow.postMessage(
            { type: "rome:global-params", params: { chatSessionId: "two" } },
            location.origin,
          ),
      );
      await until(() => hasRepo(reopened, a), "host rebind to second chat");
      release();
      release = undefined;
      await new Promise((r) => setTimeout(r, 1400));
      assert.ok(
        await hasRepo(reopened, a),
        "old chat poll cannot overwrite rebound chat",
      );
      await reopened.evaluate(() =>
        document
          .querySelector("iframe")
          .contentWindow.postMessage(
            { type: "rome:global-params", params: { chatSessionId: "one" } },
            location.origin,
          ),
      );
      await until(
        () => hasRepo(reopened, b),
        "restore original chat after rebind",
      );
      assert.deepEqual(errors, []);
      console.log(
        "PASS built App + real Git + isolated SQLite: opened/closed Default cross-project sidebars, two chats, late-poll/manual race, registered cards, pinned refs, SDK navigation, locale; page errors=0",
      );
    } finally {
      release?.();
      setCurrentActionContextResolver(null);
      await context.close();
      await browser.close();
      await new Promise((r) => server.close(r));
      raw.close();
      await rm(home, { recursive: true, force: true });
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldProfile === undefined) delete process.env.ROME_PROFILE;
      else process.env.ROME_PROFILE = oldProfile;
    }
  },
);
