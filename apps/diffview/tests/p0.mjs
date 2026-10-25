import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let workers = 0;
page.on("worker", () => workers++);
await page.addInitScript(() => {
  window.tasks = [];
  new PerformanceObserver((l) =>
    window.tasks.push(
      ...l
        .getEntries()
        .map((e) => ({ start: e.startTime, duration: e.duration })),
    ),
  ).observe({ type: "longtask", buffered: true });
  window.phases = [];
  window.started = performance.now();
  const walk = () => {
    const r = document.querySelector("#host")?.shadowRoot;
    for (const d of r?.querySelectorAll("diffs-container") ?? []) {
      if (d.shadowRoot?.textContent?.includes("fresh")) {
        if (!window.phases.some((x) => x.phase === "text"))
          window.phases.push({
            phase: "text",
            ms: performance.now() - window.started,
          });
        if (
          d.shadowRoot.querySelector(
            'span[style*="--diffs-token-light"],span[style*="var(--diffs-token-"]',
          ) &&
          !window.phases.some((x) => x.phase === "highlight")
        )
          window.phases.push({
            phase: "highlight",
            ms: performance.now() - window.started,
          });
      }
    }
    if (window.phases.length < 2) requestAnimationFrame(walk);
  };
  requestAnimationFrame(walk);
});
await page.goto("http://localhost:4179/?p0=1");
await page.waitForTimeout(3500);
const initial = await page.evaluate(() => ({
  phases: window.phases,
  tasks: window.tasks,
  html: document.querySelector("#host").shadowRoot.innerHTML.slice(-600),
}));
const scroll = await page.evaluate(async () => {
  const r = document.querySelector("#host").shadowRoot;
  const el = [...r.querySelectorAll("div")].find(
    (d) =>
      d.scrollHeight > d.clientHeight + 1000 &&
      getComputedStyle(d).overflowY === "auto",
  );
  if (!el) return { error: "no scroll container" };
  const frames = [];
  const start = performance.now();
  let prev = start;
  window.tasks = [];
  for (let i = 0; i < 900; i++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frames.push(now - prev);
    prev = now;
    el.scrollTop = Math.min(
      el.scrollHeight - el.clientHeight,
      i * Math.ceil((el.scrollHeight - el.clientHeight) / 899),
    );
  }
  return {
    frames,
    tasks: window.tasks,
    height: el.scrollHeight,
    mounted: r.querySelectorAll("diffs-container").length,
    duration: performance.now() - start,
  };
});
console.log(JSON.stringify({ workers, errors, initial, scroll }, null, 2));
await page.screenshot({ path: "/tmp/diffview-p0.png" });
await browser.close();
