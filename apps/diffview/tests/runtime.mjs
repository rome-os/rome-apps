import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
// Safe installed-app regression. Never changes fixture files or credentials.
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = await browser.contexts()[0].newPage();
const repo = "/home/rome/.rome/default/projects/default/diffview-smoke";
const errors = [],
  patchRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/diffview/patch?"))
    patchRequests.push(new URL(r.url()).searchParams);
});
let attrs,
  wasViewed = false,
  initialViewed;
try {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    "http://127.0.0.1:4141/apps/diffview#" +
      new URLSearchParams({
        repo,
        mode: "uncommitted",
        filter: "all",
        ref: "HEAD",
        base: "main",
        unified: "3",
      }),
  );
  attrs = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    class: document.documentElement.className,
    style: document.documentElement.getAttribute("style"),
  }));
  await page.evaluate(() => (document.documentElement.lang = "zh-CN"));
  const app = page.locator('[data-app-id="diffview"]');
  const viewed = () =>
    app.getByRole("button", { name: "已读: src/main.ts", exact: true });
  await viewed().waitFor();
  initialViewed = (await viewed().getAttribute("aria-pressed")) === "true";
  await page.waitForTimeout(900);
  for (let i = 0; i < 3; i++) {
    await app.getByRole("button", { name: "比较范围", exact: true }).click();
    await app.getByRole("menuitemradio", { name: "分支", exact: true }).click();
    await page.waitForTimeout(300);
    await app.getByRole("button", { name: "比较范围", exact: true }).click();
    await app
      .getByRole("menuitemradio", { name: "未提交", exact: true })
      .click();
    await page.waitForTimeout(300);
    assert.equal(await app.locator("main").count(), 1);
  }
  await app.getByRole("button", { name: "并排", exact: true }).click();
  assert.equal(
    await app
      .getByRole("button", { name: "统一", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await app
    .getByRole("button", { name: "文件操作: src/main.ts", exact: true })
    .click();
  await app
    .getByRole("menuitem", { name: "更多未变上下文", exact: true })
    .click();
  await page.waitForTimeout(800);
  assert(
    patchRequests.some(
      (q) => q.get("path") === "src/main.ts" && q.get("unified") === "23",
    ),
  );
  assert.equal(await app.locator("main").count(), 1);
  const visibleLines = () =>
    viewed().evaluate(
      (button) =>
        button
          .closest("diffs-container")
          .shadowRoot.querySelectorAll("[data-line-type]").length,
    );
  await page.waitForTimeout(500);
  if ((await viewed().getAttribute("aria-pressed")) === "true")
    await viewed().click();
  const header = () =>
    app.getByRole("button", { name: "折叠文件: src/main.ts", exact: true });
  if ((await visibleLines()) === 0) {
    await app
      .getByRole("button", { name: "展开文件: src/main.ts", exact: true })
      .click();
    await page.waitForTimeout(300);
  }
  assert((await visibleLines()) > 0);
  await header().click();
  await page.waitForTimeout(350);
  assert.equal(await visibleLines(), 0);
  assert(
    (await viewed().evaluate(
      (b) => b.closest("diffs-container").getBoundingClientRect().height,
    )) <= 45,
  );
  await app
    .getByRole("button", { name: "展开文件: src/main.ts", exact: true })
    .click();
  await page.waitForTimeout(350);
  assert((await visibleLines()) > 0);
  wasViewed = (await viewed().getAttribute("aria-pressed")) === "true";
  if (!wasViewed) await viewed().click();
  await page.waitForTimeout(350);
  assert.equal(await visibleLines(), 0);
  await app.getByRole("button", { name: "隐藏已读文件", exact: true }).click();
  assert.equal(await viewed().count(), 0);
  await app.getByRole("button", { name: "隐藏已读文件", exact: true }).click();
  assert.equal(await viewed().getAttribute("aria-pressed"), "true");
  if (!wasViewed) await viewed().click();
  if (initialViewed && (await viewed().getAttribute("aria-pressed")) !== "true")
    await viewed().click();
  const divider = app.getByRole("separator", {
    name: "调整文件树宽度",
    exact: true,
  });
  await divider.focus();
  const before = await app
    .locator("aside")
    .evaluate((e) => e.getBoundingClientRect().width);
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await app.locator("aside").evaluate((e) => e.getBoundingClientRect().width),
    Math.min(420, before + 20),
  );
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => (document.documentElement.lang = "en"));
  await page.waitForTimeout(300);
  assert.equal(
    await app
      .getByRole("button", { name: "Comparison scope", exact: true })
      .count(),
    1,
  );
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  });
  await page.waitForTimeout(300);
  assert.equal(await app.locator("main").count(), 1);
  await page.setViewportSize({ width: 375, height: 812 });
  await app
    .getByRole("button", { name: "Close file tree", exact: true })
    .click();
  assert.equal(await app.locator("aside").count(), 0);
  const width = await app
    .locator("main")
    .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  assert(width.scroll <= width.width + 1, JSON.stringify(width));
  await app.getByRole("button", { name: "Folders", exact: true }).click();
  assert.equal(await app.locator("aside").count(), 1);
  await app.locator("aside").getByTitle("src/main.ts", { exact: true }).click();
  assert.equal(await app.locator("aside").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: modes, split, +20 context, viewed filter, resize, language/theme, 375px drawer; errors=0",
  );
} finally {
  if (attrs)
    await page
      .evaluate((a) => {
        document.documentElement.lang = a.lang;
        document.documentElement.className = a.class;
        if (a.style === null) document.documentElement.removeAttribute("style");
        else document.documentElement.setAttribute("style", a.style);
      }, attrs)
      .catch(() => {});
  await page.close();
  await browser.close();
}
