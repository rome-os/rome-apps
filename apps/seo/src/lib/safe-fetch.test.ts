import { beforeEach, describe, expect, it, vi } from "vitest";
const { dns, fetcher, connections } = vi.hoisted(() => ({
  dns: vi.fn(),
  fetcher: vi.fn(),
  connections: [] as any[],
}));
vi.mock("node:dns/promises", () => ({ lookup: dns }));
vi.mock("undici", () => ({
  fetch: fetcher,
  Agent: class {
    constructor(options: unknown) {
      connections.push(options);
    }
    async close() {}
  },
}));
import {
  checkPage,
  isPublicAddress,
  safeFetch,
  validateUrl,
} from "./safe-fetch.js";
beforeEach(() => {
  vi.clearAllMocks();
  connections.length = 0;
  dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
describe("network guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
    "2001:db8::1",
  ])("blocks private/reserved IP %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(false),
  );
  it.each([
    "file:///etc/passwd",
    "ftp://example.com",
    "http://localhost",
    "http://service.local",
    "http://127.1",
    "http://2130706433",
    "http://[::1]",
    "https://user:pass@example.com",
    "http://example.com:4141",
  ])("rejects unsafe URL %s", (url) =>
    expect(() => validateUrl(url)).toThrow(),
  );
  it("pins the validated DNS address to the socket without changing the requested hostname", async () => {
    fetcher.mockResolvedValue(
      new Response("<html/>", { headers: { "Content-Type": "text/html" } }),
    );
    await safeFetch("https://example.com");
    const callback = vi.fn();
    connections[0].connect.lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(fetcher.mock.calls[0][0].hostname).toBe("example.com");
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
  });
  it("blocks mixed public/private DNS responses", async () => {
    dns.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.1.1", family: 4 },
    ]);
    await expect(safeFetch("https://example.com")).rejects.toThrow(/blocked/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("revalidates redirect destinations", async () => {
    fetcher.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      }),
    );
    await expect(safeFetch("https://example.com")).rejects.toThrow(/blocked/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("caps redirect chains", async () => {
    fetcher.mockImplementation(
      async () =>
        new Response(null, { status: 301, headers: { location: "/next" } }),
    );
    await expect(safeFetch("https://example.com")).rejects.toThrow(
      /Too many redirects/,
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it("enforces timeout during DNS resolution", async () => {
    dns.mockReturnValue(new Promise(() => {}));
    await expect(safeFetch("https://example.com", 10)).rejects.toThrow(
      /timed out/,
    );
  });
  it("caps advertised and streamed response sizes", async () => {
    fetcher.mockResolvedValue(
      new Response("", { headers: { "content-length": "3000000" } }),
    );
    await expect(safeFetch("https://example.com")).rejects.toThrow(/2 MB/);
    fetcher.mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(safeFetch("https://example.com")).rejects.toThrow(/2 MB/);
  });
  it("rejects non-HTML and does not treat a soft-404 HTML page as a sitemap", async () => {
    fetcher.mockResolvedValueOnce(
      new Response("PDF", { headers: { "content-type": "application/pdf" } }),
    );
    await expect(checkPage("https://example.com")).rejects.toThrow(
      /Expected an HTML/,
    );
    fetcher.mockImplementation(
      async () =>
        new Response("<!doctype html><html><h1>Home</h1></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    const p = await checkPage("https://example.com");
    expect(p.sitemap.found).toBe(false);
    expect(p.robots.found).toBe(false);
    expect(p).not.toHaveProperty("text");
  });
});
