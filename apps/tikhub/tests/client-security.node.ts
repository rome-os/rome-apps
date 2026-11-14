import { test } from "node:test";
import assert from "node:assert/strict";
import { tikhubRequest, __resetLimiter } from "../src/lib/client.js";
import { createServer } from "node:http";
import { once } from "node:events";

const KEY = "review_synthetic_key_not_real_1234";
function options(fetchImpl: typeof fetch) {
  __resetLimiter();
  return { baseUrl: "https://api.tikhub.io", apiKey: KEY, timeoutMs: 1000, maxRetries: 3, qps: 10, sleep: async () => {}, fetchImpl };
}

test("a sent request with an unknown result is never automatically replayed", async () => {
  let sent = 0;
  const r = await tikhubRequest(options((async () => { sent++; throw new Error(`response lost ${KEY}`); }) as typeof fetch), { method: "POST", path: "/api/v1/mock" });
  assert.equal(sent, 1);
  assert.equal(r.attempts, 1);
  assert.equal(JSON.stringify(r).includes(KEY), false);
});

test("JSON-escaped API keys and credential fields do not leave the HTTP client", async () => {
  const escaped = KEY.replaceAll("_", "\\u005f");
  const r = await tikhubRequest(options((async () => new Response(`{"code":200,"data":{"message":"${escaped}","cookie":"synthetic-private-cookie","proxy":"http://user:synthetic-password@proxy.invalid"}}`)) as typeof fetch), { method: "GET", path: "/api/v1/mock" });
  const text = JSON.stringify(r);
  for (const secret of [KEY, "synthetic-private-cookie", "synthetic-password"]) assert.equal(text.includes(secret), false);
});

test("provider error bodies are withheld even when a credential is obfuscated", async () => {
  const encoded = Buffer.from(KEY).toString("base64");
  const r = await tikhubRequest(options((async () => Response.json({ message: encoded, request_id: encoded }, { status: 401 })) as typeof fetch), { method: "GET", path: "/api/v1/mock" });
  assert.equal(JSON.stringify(r).includes(encoded), false);
  assert.equal(r.payload, null);
  assert.equal(r.requestId, null);
});

test("redirects are not followed and sensitive bodies cannot move origins", async () => {
  let redirectMode: RequestRedirect | undefined;
  const r = await tikhubRequest(options((async (_url, init) => { redirectMode = init?.redirect; return new Response("", { status: 307, headers: { location: "https://attacker.invalid" } }); }) as typeof fetch), { method: "POST", path: "/api/v1/mock", body: { mock: true } });
  assert.equal(redirectMode, "manual");
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
});

test("response reading stops at a hard byte bound instead of only trimming the preview", async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const r = await tikhubRequest(options((async () => new Response(stream)) as typeof fetch), { method: "GET", path: "/api/v1/mock" });
  assert.equal(r.ok, false);
  assert.ok(reads < 12);
  assert.equal(cancelled, true);
});

test("a timeout after sending is unknown and is not retried", async () => {
  let sent = 0;
  const r = await tikhubRequest({ ...options((async (_url, init) => {
    sent++;
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("synthetic", "AbortError")), { once: true }));
  }) as typeof fetch), timeoutMs: 25 }, { method: "GET", path: "/api/v1/mock" });
  assert.equal(sent, 1);
  assert.equal(r.outcomeUnknown, true);
});

test("only anonymous fixed metadata retries, and long Retry-After never gets shortened", async () => {
  let n = 0;
  const delays: number[] = [];
  const opts = { ...options((async (_url, init) => {
    assert.equal((init!.headers as Record<string, string>).Authorization, undefined);
    n++;
    return Response.json({ code: n < 3 ? 503 : 200 }, { status: n < 3 ? 503 : 200 });
  }) as typeof fetch), sleep: async (ms: number) => { delays.push(ms); } };
  const res = await tikhubRequest(opts, { method: "GET", path: "/openapi.json", anonymous: true });
  assert.equal(res.attempts, 3);
  assert.deepEqual(delays.filter((x) => x >= 1000), [1000, 2000]);
  const limited = await tikhubRequest(options((async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } })) as typeof fetch), { method: "GET", path: "/openapi.json", anonymous: true });
  assert.equal(limited.attempts, 1);
});

test("native Node fetch does not forward a synthetic POST body through a cross-origin 307", async () => {
  let forwarded = 0;
  const sink = createServer((_req, res) => { forwarded++; res.end("{}"); });
  sink.listen(0, "127.0.0.1"); await once(sink, "listening");
  const sinkPort = (sink.address() as { port: number }).port;
  const source = createServer((_req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${sinkPort}/sink` }); res.end(); });
  source.listen(0, "127.0.0.1"); await once(source, "listening");
  try {
    const sourcePort = (source.address() as { port: number }).port;
    const res = await tikhubRequest({ ...options(fetch), baseUrl: `http://127.0.0.1:${sourcePort}`, maxRetries: 3 }, { method: "POST", path: "/api/v1/synthetic", body: { cookie: "synthetic-only" } });
    assert.equal(res.httpStatus, 307);
    assert.equal(res.ok, false);
    assert.equal(forwarded, 0);
  } finally { source.closeAllConnections(); sink.closeAllConnections(); source.close(); sink.close(); }
});
