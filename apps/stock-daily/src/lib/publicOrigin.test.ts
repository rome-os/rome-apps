import { describe, expect, it } from "vitest";
import {
  configuredShareableOrigin,
  downloadOriginForRequest,
  isShareableOrigin,
  shareableOriginForRequest,
} from "./publicOrigin.js";
import type { RomeAppApiRequest } from "@rome-os/app-runtime";

function request(headers: Record<string, string>): RomeAppApiRequest {
  return {
    method: "GET",
    path: [],
    query: new URLSearchParams(),
    headers,
  } as RomeAppApiRequest;
}

describe("stock-daily public origin resolution", () => {
  it("does not treat loopback or private origins as shareable", () => {
    expect(isShareableOrigin("http://127.0.0.1:4141")).toBe(false);
    expect(isShareableOrigin("http://localhost:4141")).toBe(false);
    expect(isShareableOrigin("https://192.168.1.10")).toBe(false);
    expect(isShareableOrigin("https://ray.romeos.cc")).toBe(true);
  });

  it("prefers configured public origins over a local dashboard request", () => {
    const env = { ROME_PUBLIC_ORIGIN: "https://ray.romeos.cc" } as NodeJS.ProcessEnv;
    const local = request({ Host: "127.0.0.1:4141" });
    expect(downloadOriginForRequest(local, env)).toBe("https://ray.romeos.cc");
    expect(shareableOriginForRequest(local, env)).toBe("https://ray.romeos.cc");
  });

  it("refuses to persist local origins when no public origin is configured", () => {
    const local = request({ Origin: "http://127.0.0.1:4141" });
    expect(downloadOriginForRequest(local, {} as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:4141");
    expect(shareableOriginForRequest(local, {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("derives a cloud origin from Pantheon slug and domain", () => {
    const env = { PANTHEON_SLUG: "ray", PANTHEON_DOMAIN: "romeos.cc" } as NodeJS.ProcessEnv;
    expect(configuredShareableOrigin(env)).toBe("https://ray.romeos.cc");
  });
});
