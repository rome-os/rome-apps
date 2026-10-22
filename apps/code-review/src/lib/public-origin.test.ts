import { describe, expect, it } from "vitest";
import { originToRemember, prHistoryUrl, publicOriginFromHeaders } from "./public-origin.js";

describe("publicOriginFromHeaders", () => {
  it("uses HTTPS for Rome Cloud hosts even when the edge forwards http", () => {
    expect(
      publicOriginFromHeaders({ "x-forwarded-host": "Yunfan.romeos.cc, proxy", "x-forwarded-proto": "http" }, "romeos.cc"),
    ).toBe("https://yunfan.romeos.cc");
  });

  it("follows X-Forwarded-Proto on self-hosted instances", () => {
    expect(publicOriginFromHeaders({ host: "rome.example.com", "x-forwarded-proto": "https" }, undefined)).toBe(
      "https://rome.example.com",
    );
    expect(publicOriginFromHeaders({ host: "192.168.1.20:4141" }, undefined)).toBe("http://192.168.1.20:4141");
  });

  it("ignores loopback and malformed hosts", () => {
    expect(publicOriginFromHeaders({ host: "127.0.0.1:4141" }, "romeos.cc")).toBeNull();
    expect(publicOriginFromHeaders({ host: "localhost:4141" }, "romeos.cc")).toBeNull();
    expect(publicOriginFromHeaders({ host: "evil.com/path" }, "romeos.cc")).toBeNull();
    expect(publicOriginFromHeaders({}, "romeos.cc")).toBeNull();
  });
});

describe("prHistoryUrl", () => {
  it("builds the PR history page link", () => {
    expect(prHistoryUrl("https://yunfan.romeos.cc", "rome-os/rome", 816)).toBe(
      "https://yunfan.romeos.cc/apps/code-review/pr/rome-os/rome/816",
    );
  });
});

describe("originToRemember", () => {
  const headers = { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" };

  it("learns the origin from a signed-in guardian browser session", () => {
    expect(originToRemember({ caller: { kind: "guardian", via: "cookie" }, headers })).toBe("https://attacker.example");
  });

  it("never lets visitors, anonymous callers, or loopback tools set it", () => {
    expect(originToRemember({ caller: { kind: "visitor" }, headers })).toBeNull();
    expect(originToRemember({ caller: { kind: "anonymous" }, headers })).toBeNull();
    expect(originToRemember({ caller: { kind: "guardian", via: "loopback" }, headers })).toBeNull();
  });
});
