import { createAppLogger } from "@rome-os/app-runtime";
import { randomUUID } from "node:crypto";
import type { LarkRepository } from "../db/repositories/lark.js";
import { AUTH_SCOPE_GROUPS } from "../shared/catalog.js";
import { runCli, parseOutput } from "./runner.js";
import { LarkError, safeFailure } from "./policy.js";
interface LiveJob {
  abort: AbortController;
  verificationUrl?: string;
}
const log = createAppLogger("lark:setup");
const liveJobs = new Map<string, LiveJob>();
export function verificationLink(text: string): string | undefined {
  for (const match of text.matchAll(/https:\/\/[^\s<>"'\\]+/g)) {
    try {
      const u = new URL(match[0]);
      if (
        [
          "open.feishu.cn",
          "open.larksuite.com",
          "open.larkoffice.com",
          "accounts.feishu.cn",
          "accounts.larksuite.com",
          "accounts.larkoffice.com",
        ].includes(u.hostname) &&
        !u.username &&
        !u.password &&
        (/\/page\/cli/.test(u.pathname) ||
          /device|verify|auth/i.test(u.pathname))
      )
        return u.toString();
    } catch {}
  }
}
export function publicJob(repo: LarkRepository) {
  const job = repo.latestJob();
  if (!job) return null;
  return {
    ...job,
    verificationUrl:
      job.state === "running"
        ? liveJobs.get(job.id)?.verificationUrl
        : undefined,
  };
}
export function startSetup(
  repo: LarkRepository,
  input: {
    kind: "existing" | "new" | "auth";
    brand: "feishu" | "lark";
    locale: "zh" | "en";
    appId?: string;
    appSecret?: string;
    groups?: string[];
  },
  runner: typeof runCli = runCli,
) {
  const id = randomUUID();
  let args: string[], stdin: string | undefined;
  if (input.kind === "existing") {
    if (
      !/^cli_[a-zA-Z0-9]+$/.test(input.appId ?? "") ||
      !/^[a-zA-Z0-9_-]{10,256}$/.test(input.appSecret ?? "")
    )
      throw new LarkError("invalid_app_credentials");
    args = [
      "config",
      "init",
      `--app-id=${input.appId}`,
      "--app-secret-stdin",
      `--brand=${input.brand}`,
      `--lang=${input.locale}`,
    ];
    stdin = input.appSecret;
  } else if (input.kind === "new")
    args = [
      "config",
      "init",
      "--new",
      `--brand=${input.brand}`,
      `--lang=${input.locale}`,
    ];
  else {
    const groups = input.groups;
    if (
      !groups?.length ||
      groups.length > Object.keys(AUTH_SCOPE_GROUPS).length ||
      groups.some((g) => !Object.hasOwn(AUTH_SCOPE_GROUPS, g))
    )
      throw new LarkError("invalid_scope_groups");
    const scopes = [
      ...new Set(
        groups.flatMap(
          (g) => AUTH_SCOPE_GROUPS[g as keyof typeof AUTH_SCOPE_GROUPS],
        ),
      ),
    ];
    args = ["auth", "login", `--scope=${scopes.join(" ")}`, "--json"];
  }
  repo.beginJob(id, input.kind);
  const live: LiveJob = { abort: new AbortController() };
  liveJobs.set(id, live);
  let buffer = "";
  // Only the official CLI owns credentials. Raw output and challenges are never persisted.
  const completion = runner(args, {
    stdin,
    timeoutMs: 10 * 60 * 1000,
    maxBytes: 256000,
    signal: live.abort.signal,
    onChunk: (chunk) => {
      buffer = (buffer + chunk).slice(-12000);
      live.verificationUrl ??= verificationLink(buffer);
    },
  })
    .then((result) => {
      if (result.exitCode !== 0) parseOutput(result);
      if (input.kind !== "auth") repo.updatePreferences({ brand: input.brand });
      repo.finishJob(id, "completed");
    })
    .catch((error) => {
      repo.finishJob(
        id,
        error instanceof LarkError && error.code === "cancelled"
          ? "cancelled"
          : "failed",
        safeFailure(error).code,
      );
    })
    .finally(() => {
      buffer = "";
      liveJobs.delete(id);
    });
  void completion.catch(() => {
    log.error("setup state persistence failed", { jobId: id });
  });
  return { id, kind: input.kind, state: "running" };
}
export function cancelSetup(repo: LarkRepository, id: string) {
  const job = repo.job(id);
  if (!job || job.state !== "running") throw new LarkError("setup_not_running");
  const live = liveJobs.get(id);
  if (live) live.abort.abort();
  else repo.finishJob(id, "interrupted", "runtime_restarted");
}
