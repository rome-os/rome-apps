import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionConfig, AppActionRuntimeDeps } from "@rome-os/app-runtime";
const { repo, check } = vi.hoisted(() => ({
  repo: { get: vi.fn(), update: vi.fn() },
  check: vi.fn(),
}));
vi.mock("../../db/repositories/runs.js", () => ({
  createRunsRepository: () => repo,
}));
vi.mock("../../lib/safe-fetch.js", () => ({ checkPage: check }));
import { createAction } from "./index.js";
const runAction = vi.fn();
const action = () =>
  createAction(
    { name: "run_dashboard" } as ActionConfig,
    { appContext: { db: {}, runAction } } as unknown as AppActionRuntimeDeps,
  );
beforeEach(() => {
  vi.clearAllMocks();
  repo.get.mockReturnValue({
    id: "run",
    status: "pending",
    kind: "workflow",
    workflow: "optimize_meta",
    input: { source: "https://romeos.cc" },
  });
});
describe("persisted dashboard jobs", () => {
  it("rejects duplicate or missing jobs without invoking an agent", async () => {
    repo.get.mockReturnValue({ status: "running" });
    expect((await action().execute({ id: "run" })).status).toBe("error");
    expect(runAction).not.toHaveBeenCalled();
  });
  it("calls the unchanged public workflow and persists the final report", async () => {
    runAction.mockResolvedValue({
      status: "ok",
      data: { result: "# Report", sessionId: "session" },
    });
    expect((await action().execute({ id: "run" })).status).toBe("ok");
    expect(runAction).toHaveBeenCalledWith("seo:optimize_meta", {
      source: "https://romeos.cc",
    });
    expect(repo.update).toHaveBeenNthCalledWith(1, "run", {
      status: "running",
    });
    expect(repo.update).toHaveBeenLastCalledWith(
      "run",
      expect.objectContaining({
        status: "completed",
        report: "# Report",
        sessionId: "session",
      }),
    );
  });
  it("persists errors and empty reports as failed, never completed", async () => {
    runAction.mockResolvedValue({ status: "ok", data: { result: "" } });
    expect((await action().execute({ id: "run" })).status).toBe("error");
    expect(repo.update).toHaveBeenLastCalledWith(
      "run",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("empty report"),
      }),
    );
    runAction.mockResolvedValue({
      status: "error",
      error: "Provider unavailable",
    });
    await action().execute({ id: "run" });
    expect(repo.update).toHaveBeenLastCalledWith(
      "run",
      expect.objectContaining({
        status: "failed",
        error: "Provider unavailable",
      }),
    );
  });
  it("runs deterministic checks without invoking AI", async () => {
    repo.get.mockReturnValue({
      id: "run",
      status: "pending",
      kind: "check",
      input: { url: "https://romeos.cc/" },
    });
    check.mockResolvedValue({ score: 95 });
    expect((await action().execute({ id: "run" })).status).toBe("ok");
    expect(runAction).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenLastCalledWith(
      "run",
      expect.objectContaining({ status: "completed", result: { score: 95 } }),
    );
  });
  it("persists guarded fetch failures", async () => {
    repo.get.mockReturnValue({
      id: "run",
      status: "pending",
      kind: "check",
      input: { url: "https://example.com/" },
    });
    check.mockRejectedValue(new Error("Private address blocked"));
    await action().execute({ id: "run" });
    expect(repo.update).toHaveBeenLastCalledWith(
      "run",
      expect.objectContaining({
        status: "failed",
        error: "Private address blocked",
      }),
    );
  });
});
