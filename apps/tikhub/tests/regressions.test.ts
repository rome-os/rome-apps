/** Bridge the independent offline Node suite into Rome Apps' root Vitest CI. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("TikHub isolated offline regressions (no live configuration or provider access)", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const sandbox = mkdtempSync(join(tmpdir(), "tikhub-offline-"));
  const home = join(sandbox, "home"), tmp = join(sandbox, "tmp");
  mkdirSync(home); mkdirSync(tmp);
  const run = promisify(execFile);
  const env = { HOME: home, TMPDIR: tmp };
  try {
    await run(process.execPath, [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", "tsconfig.test.json"], { cwd: root, env, timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    const files = readdirSync(join(root, ".test-dist/tests")).filter(f => f.endsWith(".node.js")).sort().map(f => join(root, ".test-dist/tests", f));
    assert.equal(files.length, 14);
    const { stdout, stderr } = await run(process.execPath, ["--import", fileURLToPath(new URL("./deny-network.mjs", import.meta.url)), "--test", ...files], { cwd: root, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    assert.doesNotMatch(stderr, /UNEXPECTED_NETWORK_TEST_GUARD/);
    assert.match(stdout, /tests 129/);
    assert.match(stdout, /fail 0/);
    console.info(stdout);
  } catch (error) {
    // This child only handles synthetic fixtures; preserve diagnostics for CI.
    const result = error as Error & { stdout?: string; stderr?: string };
    throw new Error([result.message, result.stdout, result.stderr].filter(Boolean).join("\n"));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}, 240_000);
