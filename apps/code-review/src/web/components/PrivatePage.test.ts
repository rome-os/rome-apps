import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivatePage } from "./PrivatePage";

afterEach(() => vi.unstubAllGlobals());

describe("private app page", () => {
  it.each(["anonymous", "visitor"])("renders the real SDK identity control without owner controls for %s", kind => {
    vi.stubGlobal("window", {
      __ROME_APP_BOOTSTRAP__: { appId: "code-review", shell: { mode: "full" }, caller: { kind, email: "reader@example.com", accountId: "reader" } },
      location: { pathname: "/full/apps/code-review/settings", search: "", hash: "" },
    });
    const html = renderToStaticMarkup(createElement(PrivatePage));
    expect(html).toContain("This page is private to the owner");
    expect(html).toContain("Signing in does not grant access");
    expect(html).not.toContain("Re-review");
    if (kind === "anonymous") expect(html).toContain("Sign in");
    else expect(html).toContain("reader@example.com");
  });
});
