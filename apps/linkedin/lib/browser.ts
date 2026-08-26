import { CdpSession, pickBrowserEndpoint, type BrowserCapabilityDiscovery } from "@rome-os/app-runtime";

const DEFAULT_BROWSER_ENDPOINT = {
  name: "cdp-local-chromium",
  browserUrl: "http://127.0.0.1:9222",
};
const HTTP_TIMEOUT_MS = 10_000;
const PAGE_READY_TIMEOUT_MS = 30_000;
const DOM_STABLE_TIMEOUT_MS = 10_000;
const DOM_STABLE_POLL_MS = 500;
const INPUT_TYPING_DELAY_MS = 35;
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
    get: () => ["en-US", "en"],
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

export class LinkedinPage {
  constructor(
    public readonly session: CdpSession,
    public readonly endpoint: BrowserEndpoint,
    public readonly targetId: string,
  ) {}

  async initialize(browserVersion: string): Promise<void> {
    await this.session.send("Page.enable");
    await this.session.send("Runtime.enable");
    await this.session.send("DOM.enable");
    await this.session.send("Network.enable");
    await this.session.send("Page.bringToFront");
    await this.session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: STEALTH_SCRIPT,
    });
    await this.session.send("Network.setExtraHTTPHeaders", {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
      },
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
        const isVisible = (el) =>
          !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(isVisible);
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

  async clickByText(text: string, scopeSelector = "main"): Promise<boolean> {
    return (
      (await this.evaluateByValue<boolean>(`
        (() => {
          const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
          const isVisible = (el) =>
            !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
          const scope = document.querySelector(${JSON.stringify(scopeSelector)}) ?? document.body;
          const candidates = Array.from(
            scope.querySelectorAll("button, a, [role='button'], [role='menuitem'], li")
          );
          const match = candidates.find((el) => isVisible(el) && normalize(el.innerText || el.textContent) === ${JSON.stringify(
            text,
          )});
          if (!match) return false;
          match.scrollIntoView({ block: "center", inline: "center" });
          match.click();
          return true;
        })()
      `)) === true
    );
  }

  async focusElement(selector: string): Promise<boolean> {
    return (
      (await this.evaluateByValue<boolean>(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          return true;
        })()
      `)) === true
    );
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
    const updated = await this.evaluateByValue<boolean>(`
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
    if (!updated) {
      throw new Error(`Element not found: ${selector}`);
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

  async inputContentEditable(selector: string, text: string): Promise<void> {
    const focused = await this.focusElement(selector);
    if (!focused) {
      throw new Error(`Element not found: ${selector}`);
    }
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
      await sleep(20 + Math.floor(Math.random() * 40));
    }
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
  pageUrl = "about:blank",
): Promise<LinkedinPage> {
  const endpoint = await resolveBrowserEndpoint(capabilityDiscovery);
  const target = await createBrowserTarget(endpoint.browserUrl, pageUrl);
  if (!target.id || !target.webSocketDebuggerUrl) {
    throw new Error("CDP did not return a debuggable page target");
  }

  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  const page = new LinkedinPage(session, endpoint, target.id);
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

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  acceptLanguage: string;
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
      acceptLanguage: "en-US,en;q=0.9",
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
      acceptLanguage: "en-US,en;q=0.9",
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
    acceptLanguage: "en-US,en;q=0.9",
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

function readExceptionText(
  exceptionDetails: NonNullable<RuntimeEvaluateResponse<unknown>["exceptionDetails"]>,
): string {
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
