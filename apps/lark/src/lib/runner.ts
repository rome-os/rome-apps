import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { LarkError, redact } from "./policy.js";
const require = createRequire(import.meta.url);
export interface RunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
export interface RunnerOptions {
  stdin?: string;
  timeoutMs?: number;
  maxBytes?: number;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
}
export interface CliPaths {
  binary: string;
  config: string;
  data: string;
  workspace: string;
}
export function cliPaths(): CliPaths {
  const profile = process.env.ROME_PROFILE || "default";
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new LarkError("invalid_profile");
  const root = join(homedir(), ".rome", profile, "apps", "data", "lark");
  return {
    binary: join(
      dirname(require.resolve("@larksuite/cli/package.json")),
      "bin",
      process.platform === "win32" ? "lark-cli.exe" : "lark-cli",
    ),
    config: join(root, "cli-config"),
    data: join(root, "cli-data"),
    workspace: join(root, "workspace"),
  };
}
export function cliEnvironment(paths: CliPaths): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: homedir(),
    LANG: "en_US.UTF-8",
    TZ: process.env.TZ || "Asia/Shanghai",
    CI: "1",
    TERM: "dumb",
    NO_COLOR: "1",
    LARKSUITE_CLI_CONFIG_DIR: paths.config,
    LARKSUITE_CLI_DATA_DIR: paths.data,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
  };
}
export async function runCli(
  args: string[],
  options: RunnerOptions = {},
  paths = cliPaths(),
): Promise<RunnerResult> {
  await Promise.all(
    [paths.config, paths.data, paths.workspace].map((p) =>
      mkdir(p, { recursive: true, mode: 0o700 }),
    ),
  );
  if (options.signal?.aborted) throw new LarkError("cancelled", "", true);
  return new Promise((resolve, reject) => {
    const child = spawn(paths.binary, args, {
      shell: false,
      cwd: paths.workspace,
      env: cliEnvironment(paths),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      failure: LarkError | undefined;
    const stop = (code: string) => {
      if (failure) return;
      failure = new LarkError(code, "", true);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      killTimer.unref();
    };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs ?? 45000);
    timer.unref();
    const abort = () => stop("cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    function collect(kind: "stdout" | "stderr", chunk: string): void {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxBytes ?? 2 * 1024 * 1024)) {
        stop("output_limit");
        return;
      }
      const s = chunk;
      if (kind === "stdout") stdout += s;
      else stderr += s;
      options.onChunk?.(s);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => collect("stdout", c));
    child.stderr.on("data", (c: string) => collect("stderr", c));
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.on("error", () => {
      cleanup();
      reject(new LarkError("cli_unavailable"));
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) {
        reject(failure);
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin ?? "");
  });
}
export function parseOutput(result: RunnerResult): unknown {
  if (result.exitCode !== 0) {
    let envelope: Record<string, unknown> | undefined;
    for (const stream of [result.stderr, result.stdout]) {
      try {
        const v = JSON.parse(stream);
        if (v?.error) envelope = v;
      } catch {}
      if (!envelope) {
        const start = stream.lastIndexOf('{\n  "ok": false');
        if (start >= 0)
          try {
            envelope = JSON.parse(stream.slice(start));
          } catch {}
      }
    }
    const e = envelope?.error as Record<string, unknown> | undefined;
    const kind = typeof e?.type === "string" ? e.type : "cli";
    const subtype = typeof e?.subtype === "string" ? e.subtype : "failed";
    const detail = {
      missingScopes: e?.missing_scopes,
      consoleUrl:
        typeof e?.console_url === "string" &&
        /^https:\/\/open\.(feishu\.cn|larksuite\.com|larkoffice\.com)\//.test(
          e.console_url,
        )
          ? e.console_url
          : undefined,
      exitCode: result.exitCode,
    };
    throw new LarkError(`${kind}.${subtype}`, JSON.stringify(redact(detail)));
  }
  try {
    const value = JSON.parse(result.stdout);
    if (value?.ok === false) throw new LarkError("cli.reported_failure");
    return redact(value);
  } catch (error) {
    if (error instanceof LarkError) throw error;
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  try {
    return { items: lines.map((s) => redact(JSON.parse(s))), format: "ndjson" };
  } catch {}
  throw new LarkError("invalid_cli_output");
}
