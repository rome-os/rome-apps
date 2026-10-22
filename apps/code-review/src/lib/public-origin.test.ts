import { describe, expect, it } from "vitest";
import { prHistoryUrl, publicOriginFromHeaders } from "./public-origin.js";

describe("publicOriginFromHeaders", () => {
  it("prefers the forwarded public host and forces HTTPS", () => {
    expect(publicOriginFromHeaders({ "x-forwarded-host": "Yunfan.romeos.cc, proxy", host: "127.0.0.1:4141" })).toBe(
      "https://yunfan.romeos.cc",
    );
  });

  it("ignores local and malformed hosts", () => {
    expect(publicOriginFromHeaders({ host: "127.0.0.1:4141" })).toBeNull();
    expect(publicOriginFromHeaders({ host: "localhost:4141" })).toBeNull();
    expect(publicOriginFromHeaders({ host: "evil.com/path" })).toBeNull();
    expect(publicOriginFromHeaders({})).toBeNull();
  });
});

describe("prHistoryUrl", () => {
  it("builds the PR history page link", () => {
    expect(prHistoryUrl("https://yunfan.romeos.cc", "rome-os/rome", 816)).toBe(
      "https://yunfan.romeos.cc/apps/code-review/pr/rome-os/rome/816",
    );
  });
});
