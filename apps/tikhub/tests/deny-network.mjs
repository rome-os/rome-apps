// Isolation guard only. Never print request arguments, headers or bodies.
// The existing redirect regression owns two random-port synthetic HTTP servers.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.port !== "4141" && url.pathname === "/api/v1/synthetic" && init?.method === "POST" && init?.redirect === "manual") {
    process.stderr.write("SYNTHETIC_LOOPBACK_FIXTURE_FETCH\n");
    return nativeFetch(input, init);
  }
  process.stderr.write("UNEXPECTED_NETWORK_TEST_GUARD\n");
  throw new Error("Unexpected real fetch is blocked in isolated validation");
};
