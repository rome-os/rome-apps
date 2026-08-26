import os from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import {
  CdpSession,
  type BrowserCapabilityDiscovery,
  type CurrentActionContext,
  getCurrentActionContext,
  pickBrowserEndpoint,
} from "@rome-os/app-runtime";

const DEFAULT_BROWSER_ENDPOINT = {
  name: "cdp-local-chromium",
  browserUrl: "http://127.0.0.1:9222",
};
const HTTP_TIMEOUT_MS = 10_000;
const PAGE_READY_TIMEOUT_MS = 30_000;
const DOM_STABLE_TIMEOUT_MS = 10_000;
const DOM_STABLE_POLL_MS = 500;
const INPUT_TYPING_DELAY_MS = 50;
const STEALTH_SCRIPT = `
(() => {
  const wd = Object.getOwnPropertyDescriptor(Navigator.prototype, "webdriver");
  if (wd && wd.get) {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: new Proxy(wd.get, { apply: () => false }),
      configurable: true,
    });
  }

  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = { connect: () => {}, sendMessage: () => {} };
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: "disabled",
        INSTALLED: "installed",
        NOT_INSTALLED: "not_installed",
      },
      RunningState: {
        CANNOT_RUN: "cannot_run",
        READY_TO_RUN: "ready_to_run",
        RUNNING: "running",
      },
      getDetails() {},
      getIsInstalled() {},
      installState() {
        return "not_installed";
      },
      runningState() {
        return "cannot_run";
      },
    };
  }

  Object.defineProperty(navigator, "vendor", {
    get: () => "Google Inc.",
    configurable: true,
  });
  Object.defineProperty(navigator, "languages", {
    get: () => ["zh-CN", "zh", "en-US", "en"],
    configurable: true,
  });

  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  }
})();
`.trim();

interface JsonNewTarget {
  id?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface RuntimeEvaluateResponse<TValue> {
  result: {
    type?: string;
    subtype?: string;
    value?: TValue;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
}

interface BrowserPageTarget {
  id: string;
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

export interface BrowserEndpoint {
  name: string;
  browserUrl: string;
}

interface PageReadyProbe {
  readyState?: string;
  href?: string;
}

export interface OpenPageOptions {
  persist?: boolean;
}

export class XhsPage {
  constructor(
    public readonly session: CdpSession,
    public readonly endpoint: BrowserEndpoint,
    public readonly targetId: string,
    private readonly persistent: boolean,
  ) {}

  async initialize(browserVersion: string): Promise<void> {
    await this.session.send("Page.enable");
    await this.session.send("Runtime.enable");
    await this.session.send("DOM.enable");
    await this.session.send("Page.bringToFront");
    await this.session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: STEALTH_SCRIPT,
    });
    await this.session.send("Emulation.setUserAgentOverride", buildUserAgentOverride(browserVersion));
    await this.session.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await this.evaluate("(() => { try { " + STEALTH_SCRIPT + " } catch { /* noop */ } })()");
  }

  async navigate(url: string): Promise<void> {
    await this.session.send("Page.navigate", { url });
    await this.waitForLoad();
  }

  async waitForLoad(timeoutMs = PAGE_READY_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const probe = await this.evaluateByValue<PageReadyProbe>(
          "({ readyState: document.readyState, href: location.href })",
        );
        if (probe.href && probe.href !== "about:blank" && probe.readyState === "complete") {
          return;
        }
      } catch {
        // Retry until the page settles.
      }
      await sleep(500);
    }
    throw new Error(`Timed out waiting for page load after ${timeoutMs}ms`);
  }

  async waitDomStable(timeoutMs = DOM_STABLE_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let previousSnapshot = "";
    while (Date.now() < deadline) {
      const snapshot = String(
        await this.evaluateByValue(
          "document.body ? `${document.body.innerHTML.length}:${document.body.innerText.length}` : ''",
        ),
      );
      if (snapshot && snapshot === previousSnapshot) {
        return;
      }
      previousSnapshot = snapshot;
      await sleep(DOM_STABLE_POLL_MS);
    }
  }

  async evaluateByValue<TValue>(expression: string): Promise<TValue> {
    const response = await this.session.send<RuntimeEvaluateResponse<TValue>>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(readExceptionText(response.exceptionDetails));
    }
    return response.result.value as TValue;
  }

  async evaluate(expression: string): Promise<unknown> {
    return await this.evaluateByValue(expression);
  }

  async hasElement(selector: string): Promise<boolean> {
    return (
      (await this.evaluateByValue<boolean>(
        `document.querySelector(${JSON.stringify(selector)}) !== null`,
      )) === true
    );
  }

  async waitForElement(selector: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.hasElement(selector)) {
        return;
      }
      await sleep(300);
    }
    throw new Error(`Element not found: ${selector}`);
  }

  async clickElement(selector: string): Promise<void> {
    const point = await this.evaluateByValue<{ x: number; y: number } | null>(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center" });
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()
    `);
    if (!point) {
      throw new Error(`Element not found or not clickable: ${selector}`);
    }
    const x = point.x + randomOffset();
    const y = point.y + randomOffset();
    await this.mouseMove(x, y);
    await sleep(50);
    await this.mouseClick(x, y);
  }

  async hoverElement(selector: string): Promise<void> {
    const point = await this.evaluateByValue<{ x: number; y: number } | null>(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()
    `);
    if (!point) {
      throw new Error(`Element not found: ${selector}`);
    }
    await this.mouseMove(point.x, point.y);
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await this.session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
  }

  async mouseClick(x: number, y: number, button = "left"): Promise<void> {
    await this.session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount: 1,
    });
    await this.session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount: 1,
    });
  }

  async inputText(selector: string, text: string): Promise<void> {
    await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        const descriptor =
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ??
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
        descriptor?.set?.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
  }

  async selectAllText(selector: string): Promise<void> {
    await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        if (typeof el.select === "function") {
          el.select();
          return true;
        }
        document.execCommand("selectAll");
        return true;
      })()
    `);
  }

  async inputContentEditable(selector: string, text: string): Promise<void> {
    await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        return true;
      })()
    `);
    await sleep(100);
    await this.dispatchModifiedKey("a", "KeyA", 2);
    await this.pressKey("Backspace", "Backspace", 8);
    await sleep(100);
    for (const character of text) {
      if (character === "\n") {
        await this.pressKey("Enter", "Enter", 13);
      } else {
        await this.typeText(character, 0);
      }
      await sleep(30 + Math.floor(Math.random() * 50));
    }
  }

  async typeText(text: string, delayMs = INPUT_TYPING_DELAY_MS): Promise<void> {
    for (const character of text) {
      await this.session.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: character,
      });
      await this.session.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        text: character,
      });
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  async pressKey(key: string, code: string, windowsVirtualKeyCode?: number): Promise<void> {
    await this.session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode,
    });
    await this.session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode,
    });
  }

  async getElementText(selector: string): Promise<string> {
    const result = await this.evaluateByValue<string | null>(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.textContent ?? "" : null;
      })()
    `);
    return result ?? "";
  }

  async getElementsCount(selector: string): Promise<number> {
    const count = await this.evaluateByValue<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    return Number.isFinite(count) ? count : 0;
  }

  async scrollElementIntoView(selector: string): Promise<void> {
    await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      })()
    `);
  }

  async scrollNthElementIntoView(selector: string, index: number): Promise<void> {
    await this.evaluate(`
      (() => {
        const els = document.querySelectorAll(${JSON.stringify(selector)});
        const el = els[${index}] ?? null;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      })()
    `);
  }

  async setFileInput(selector: string, files: string[]): Promise<void> {
    const documentResult = await this.session.send<{
      root: { nodeId: number };
    }>("DOM.getDocument", { depth: 0 });
    const queryResult = await this.session.send<{ nodeId?: number }>("DOM.querySelector", {
      nodeId: documentResult.root.nodeId,
      selector,
    });
    if (!queryResult.nodeId) {
      throw new Error(`Element not found: ${selector}`);
    }
    await this.session.send("DOM.setFileInputFiles", {
      nodeId: queryResult.nodeId,
      files,
    });
  }

  async removeElement(selector: string): Promise<void> {
    await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.remove();
      })()
    `);
  }

  async disconnect(): Promise<void> {
    await this.session.close();
  }

  async closeTarget(): Promise<void> {
    try {
      await this.session.close();
    } finally {
      await closeBrowserTarget(this.endpoint.browserUrl, this.targetId);
    }
  }

  isPersistent(): boolean {
    return this.persistent;
  }

  private async dispatchModifiedKey(key: string, code: string, modifiers: number): Promise<void> {
    await this.session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      modifiers,
    });
    await this.session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      modifiers,
    });
  }
}

export async function resolveBrowserEndpoint(
  capabilityDiscovery: BrowserCapabilityDiscovery,
): Promise<BrowserEndpoint> {
  return (
    pickBrowserEndpoint(capabilityDiscovery.getBrowserEndpoints()) ?? DEFAULT_BROWSER_ENDPOINT
  );
}

export async function openBrowserPage(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  options: OpenPageOptions = {},
): Promise<XhsPage> {
  const endpoint = await resolveBrowserEndpoint(capabilityDiscovery);
  const target = await createBrowserTarget(endpoint.browserUrl, "about:blank");
  if (!target.id || !target.webSocketDebuggerUrl) {
    throw new Error("CDP did not return a debuggable page target");
  }

  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  const page = new XhsPage(session, endpoint, target.id, options.persist === true);
  await page.initialize(await getBrowserVersion(endpoint.browserUrl));
  return page;
}

export async function connectToPersistentPage(
  capabilityDiscovery: BrowserCapabilityDiscovery,
  targetId: string,
): Promise<XhsPage> {
  const endpoint = await resolveBrowserEndpoint(capabilityDiscovery);
  const targets = await listBrowserTargets(endpoint.browserUrl);
  const target = targets.find((entry) => entry.id === targetId);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Persistent Xiaohongshu page is no longer available");
  }

  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  const page = new XhsPage(session, endpoint, target.id, true);
  await page.initialize(await getBrowserVersion(endpoint.browserUrl));
  return page;
}

export async function listBrowserTargets(browserUrl: string): Promise<BrowserPageTarget[]> {
  return await fetchJson<BrowserPageTarget[]>(`${normalizeBrowserUrl(browserUrl)}/json/list`);
}

export async function createBrowserTarget(
  browserUrl: string,
  pageUrl: string,
): Promise<JsonNewTarget> {
  const endpoint = `${normalizeBrowserUrl(browserUrl)}/json/new?${encodeURIComponent(pageUrl)}`;
  let response = await fetch(endpoint, {
    method: "PUT",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (response.status === 405) {
    response = await fetch(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }
  if (!response.ok) {
    throw new Error(`Failed to open a CDP page at ${browserUrl}: ${response.status}`);
  }
  return (await response.json()) as JsonNewTarget;
}

export async function closeBrowserTarget(browserUrl: string, targetId: string): Promise<void> {
  try {
    await fetch(`${normalizeBrowserUrl(browserUrl)}/json/close/${encodeURIComponent(targetId)}`, {
      method: "GET",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    // Best effort cleanup.
  }
}

export async function downloadRemoteFile(
  url: string,
  suggestedName?: string,
): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const tempDir = await mkdtemp(join(os.tmpdir(), "rome-xhs-media-"));
  const arrayBuffer = await response.arrayBuffer();
  const extension =
    inferExtension(url, response.headers.get("content-type")) ||
    extname(suggestedName ?? "") ||
    ".bin";
  const fileName = sanitizeFileName(suggestedName || basename(new URL(url).pathname) || "asset");
  const targetPath = join(tempDir, `${stripExtension(fileName)}${extension}`);
  await writeFile(targetPath, Buffer.from(arrayBuffer));
  return targetPath;
}

export function resolveFileInputPath(
  inputPath: string,
  actionContext: CurrentActionContext | undefined = getCurrentActionContext(),
): string {
  if (isHttpUrl(inputPath)) {
    return inputPath;
  }
  if (isAbsolute(inputPath)) {
    return inputPath;
  }

  const threadRoot = resolveThreadRoot(actionContext);
  const resolvedPath = resolve(threadRoot, inputPath);
  const relativePath = resolvedPath.slice(threadRoot.length + (threadRoot.endsWith(sep) ? 0 : 1));
  if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new Error("relative media paths must stay within the current thread directory");
  }
  return resolvedPath;
}

export async function ensureTempDir(name: string): Promise<string> {
  const path = join(os.tmpdir(), name);
  await mkdir(path, { recursive: true });
  return path;
}

function normalizeBrowserUrl(browserUrl: string): string {
  return browserUrl.endsWith("/") ? browserUrl.slice(0, -1) : browserUrl;
}

async function fetchJson<TResult>(url: string): Promise<TResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return (await response.json()) as TResult;
}

async function getBrowserVersion(browserUrl: string): Promise<string> {
  const version = await fetchJson<{ Browser?: string }>(
    `${normalizeBrowserUrl(browserUrl)}/json/version`,
  );
  const browser = version.Browser?.trim() ?? "";
  return browser.includes("/") ? browser.split("/", 2)[1] ?? "146.0.0.0" : "146.0.0.0";
}

function buildUserAgentOverride(version: string): {
  userAgent: string;
  platform: string;
  userAgentMetadata: Record<string, unknown>;
} {
  const major = version.split(".")[0]!;
  const brands = [
    { brand: "Chromium", version: major },
    { brand: "Google Chrome", version: major },
    { brand: "Not-A.Brand", version: "24" },
  ];
  const fullVersionList = [
    { brand: "Chromium", version },
    { brand: "Google Chrome", version },
    { brand: "Not-A.Brand", version: "24.0.0.0" },
  ];

  if (process.platform === "darwin") {
    return {
      userAgent:
        `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ` +
        `(KHTML, like Gecko) Chrome/${version} Safari/537.36`,
      platform: "MacIntel",
      userAgentMetadata: {
        brands,
        fullVersionList,
        platform: "macOS",
        platformVersion: "14.5.0",
        architecture: process.arch === "arm64" ? "arm" : "x86",
        model: "",
        mobile: false,
        bitness: "64",
        wow64: false,
      },
    };
  }

  if (process.platform === "win32") {
    return {
      userAgent:
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
        `(KHTML, like Gecko) Chrome/${version} Safari/537.36`,
      platform: "Win32",
      userAgentMetadata: {
        brands,
        fullVersionList,
        platform: "Windows",
        platformVersion: "15.0.0",
        architecture: "x86",
        model: "",
        mobile: false,
        bitness: "64",
        wow64: false,
      },
    };
  }

  return {
    userAgent:
      `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    platform: "Linux x86_64",
    userAgentMetadata: {
      brands,
      fullVersionList,
      platform: "Linux",
      platformVersion: "6.5.0",
      architecture: "x86",
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
  };
}

function readExceptionText(exceptionDetails: NonNullable<RuntimeEvaluateResponse<unknown>["exceptionDetails"]>): string {
  return String(
    exceptionDetails.exception?.description ??
      exceptionDetails.exception?.value ??
      exceptionDetails.text ??
      "Unknown runtime evaluation error",
  );
}

function randomOffset(): number {
  return Math.random() * 6 - 3;
}

function stripExtension(value: string): string {
  const extension = extname(value);
  return extension ? value.slice(0, -extension.length) : value;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_") || "asset";
}

function inferExtension(url: string, contentType: string | null): string | null {
  const pathname = new URL(url).pathname;
  const pathExtension = extname(pathname);
  if (pathExtension) {
    return pathExtension;
  }
  if (!contentType) {
    return null;
  }
  if (contentType.includes("jpeg")) {
    return ".jpg";
  }
  if (contentType.includes("png")) {
    return ".png";
  }
  if (contentType.includes("webp")) {
    return ".webp";
  }
  if (contentType.includes("gif")) {
    return ".gif";
  }
  if (contentType.includes("mp4")) {
    return ".mp4";
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function resolveThreadRoot(actionContext?: CurrentActionContext): string {
  const runtimeThreadPath = actionContext?.channelContext?.threadPath?.trim();
  if (runtimeThreadPath) {
    if (!isAbsolute(runtimeThreadPath)) {
      throw new Error("threadPath is invalid for relative media path resolution");
    }
    return runtimeThreadPath;
  }

  const projectName = normalizePathSegment(actionContext?.channelContext?.projectName, "projectName");
  const threadId = normalizePathSegment(actionContext?.channelContext?.threadId, "threadId");
  return join("/home/user", projectName, ".threads", threadId);
}

function normalizePathSegment(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${fieldName} is required when using a relative media path`);
  }
  if (trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`${fieldName} is invalid for relative media path resolution`);
  }
  return trimmed;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
