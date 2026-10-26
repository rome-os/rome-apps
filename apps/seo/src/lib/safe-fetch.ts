import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import { parsePage, type Presence } from "./page-check.js";

const MAX_BYTES = 2 * 1024 * 1024;
export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function validateUrl(input: string): URL {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol))
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (url.username || url.password)
    throw new Error("URLs with credentials are not supported.");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("Only standard web ports (80 and 443) are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new Error("Local and private network addresses are blocked.");
  url.hash = "";
  return url;
}

/** Validate every DNS answer and pin the selected answer to the actual socket.
 * A fresh dispatcher per hop prevents pooled sockets and DNS rebinding bypasses.
 * TLS still verifies the original hostname. No ambient cookies or auth are sent.
 */
export async function safeFetch(input: string, timeoutMs = 10_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  const redirects: string[] = [];
  const started = Date.now();
  let url = validateUrl(input);
  for (let hop = 0; hop <= 5; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const answers = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("Request timed out."));
        else
          signal.addEventListener(
            "abort",
            () => reject(new Error("Request timed out.")),
            { once: true },
          );
      }),
    ]);
    if (!answers.length || answers.some((a) => !isPublicAddress(a.address)))
      throw new Error(
        "Local, private, and reserved network addresses are blocked.",
      );
    const chosen = answers[0];
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [chosen]);
          else callback(null, chosen.address, chosen.family);
        },
      },
    });
    try {
      const response = await fetch(url, {
        signal,
        redirect: "manual",
        dispatcher,
        headers: {
          "User-Agent": "RomeSEO/0.3 (+https://romeos.cc)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/xml",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect has no destination.");
        if (hop === 5) throw new Error("Too many redirects (maximum 5).");
        redirects.push(url.href);
        url = validateUrl(new URL(location, url).href);
        continue;
      }
      if (Number(response.headers.get("content-length")) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error("Response exceeds the 2 MB size limit.");
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) {
          await response.body?.cancel().catch(() => {});
          throw new Error("Response exceeds the 2 MB size limit.");
        }
        chunks.push(chunk);
      }
      return {
        text: Buffer.concat(chunks).toString("utf8"),
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        xRobotsTag: response.headers.get("x-robots-tag") || "",
        finalUrl: url.href,
        redirects,
        responseMs: Date.now() - started,
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Too many redirects.");
}

export async function checkPage(input: string) {
  const page = await safeFetch(input);
  if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(page.contentType))
    throw new Error(
      `Expected an HTML page, received ${page.contentType || "no content type"}.`,
    );
  const origin = new URL(page.finalUrl).origin;
  let robotsText = "";
  const presence = async (
    url: string,
    kind: "robots" | "sitemap",
  ): Promise<Presence> => {
    try {
      const r = await safeFetch(url, 6000);
      const valid =
        r.status === 200 &&
        (kind === "robots"
          ? !/<(?:!doctype|html)\b/i.test(r.text) &&
            /(?:^|\n)\s*(?:user-agent|sitemap)\s*:/i.test(r.text)
          : /<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(r.text));
      if (kind === "robots" && valid) robotsText = r.text;
      return { url: r.finalUrl, found: valid, status: r.status };
    } catch (error) {
      return {
        url,
        found: false,
        error: error instanceof Error ? error.message : "Could not fetch file",
      };
    }
  };
  const [robots, defaultSitemap] = await Promise.all([
    presence(`${origin}/robots.txt`, "robots"),
    presence(`${origin}/sitemap.xml`, "sitemap"),
  ]);
  let sitemap = defaultSitemap;
  if (!sitemap.found) {
    const declared = robotsText.match(/^\s*sitemap:\s*(\S+)/im)?.[1];
    if (declared && declared !== `${origin}/sitemap.xml`)
      sitemap = await presence(declared, "sitemap");
  }
  const { text, contentType: _contentType, ...transport } = page;
  return parsePage(text, { url: input, ...transport, robots, sitemap });
}
