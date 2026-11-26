import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseOutput,
  runCli,
  cliPaths,
  type CliPaths,
} from "../src/lib/runner.js";
import { COMMANDS } from "../src/shared/catalog.js";
import { prepareInvocation } from "../src/lib/policy.js";
test("JSON, stderr errors, NDJSON and success-with-failure contracts", () => {
  assert.deepEqual(
    parseOutput({
      exitCode: 0,
      stdout: '{"ok":true,"data":{"id":1}}',
      stderr: "progress",
    }),
    { ok: true, data: { id: 1 } },
  );
  assert.deepEqual(
    parseOutput({ exitCode: 0, stdout: '{"a":1}\n{"a":2}\n', stderr: "" }),
    { items: [{ a: 1 }, { a: 2 }], format: "ndjson" },
  );
  assert.throws(
    () =>
      parseOutput({
        exitCode: 3,
        stdout: "",
        stderr:
          '{"ok":false,"error":{"type":"config","subtype":"not_configured","message":"do not echo synthetic secret"}}',
      }),
    /config.not_configured/,
  );
  assert.throws(
    () => parseOutput({ exitCode: 0, stdout: '{"ok":false}', stderr: "" }),
    /cli.reported_failure/,
  );
  assert.throws(
    () =>
      parseOutput({ exitCode: 0, stdout: "unstructured output", stderr: "" }),
    /invalid_cli_output/,
  );
  assert.throws(
    () => parseOutput({ exitCode: 1, stdout: "", stderr: "synthetic secret" }),
    (error) => !String(error).includes("synthetic secret"),
  );
});
test("runner enforces timeout, cancellation, output caps and intact UTF-8", async () => {
  const root = await mkdtemp(join(tmpdir(), "lark-runner-test-"));
  const script = join(root, "fixture.mjs");
  await writeFile(
    script,
    'if(process.argv[2]==="wait")setInterval(()=>{},1000);else if(process.argv[2]==="large")process.stdout.write("x".repeat(10000));else {process.stdout.write(Buffer.from([0xe4]));setTimeout(()=>process.stdout.write(Buffer.from([0xb8,0xad])),20);}',
  );
  const paths: CliPaths = {
    binary: process.execPath,
    config: join(root, "config"),
    data: join(root, "data"),
    workspace: join(root, "workspace"),
  };
  try {
    const value = await runCli([script], {}, paths);
    assert.equal(value.stdout, "中");
    await assert.rejects(
      runCli([script, "wait"], { timeoutMs: 100 }, paths),
      /timeout/,
    );
    await assert.rejects(
      runCli([script, "large"], { maxBytes: 500 }, paths),
      /output_limit/,
    );
    const abort = new AbortController();
    const result = runCli([script, "wait"], { signal: abort.signal }, paths);
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(result, /cancelled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("all reviewed examples match the installed official CLI flag surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "lark-official-contract-"));
  const paths = {
    ...cliPaths(),
    config: join(root, "config"),
    data: join(root, "data"),
    workspace: join(root, "workspace"),
  };
  try {
    const version = await runCli(["--version"], {}, paths);
    assert.equal(version.stdout.trim(), "lark-cli version 1.0.98");
    for (const spec of COMMANDS) {
      const invocation = prepareInvocation(
        spec.id,
        spec.identities[0]!,
        spec.example,
      );
      const out = await runCli(
        [...invocation.argv, "--help"],
        { stdin: invocation.stdin },
        paths,
      );
      assert.equal(out.exitCode, 0, `${spec.id}: ${out.stderr}`);
      assert(out.stdout.includes("Usage:"), spec.id);
      assert(!out.stderr.includes("unknown flag"), spec.id);
    }
    const noAuth = await runCli(["auth", "status", "--json"], {}, paths);
    assert.equal(noAuth.exitCode, 3);
    assert.throws(() => parseOutput(noAuth), /config.not_configured/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
