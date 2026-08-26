import { describe, expect, it } from "vitest";
import { formatCliError } from "./cli-errors.js";

describe("formatCliError", () => {
  it("reports command-specific ENOENT failures", () => {
    expect(formatCliError(new Error("spawnSync git ENOENT"), "Clone failed")).toContain(
      "The 'git' command is not installed",
    );
    expect(formatCliError(new Error("spawnSync gh ENOENT"), "Fetch failed")).toContain(
      "The 'gh' CLI tool is not installed",
    );
  });

  it("does not report unrelated ENOENT errors as a missing gh install", () => {
    const message = formatCliError(new Error("ENOENT: no such file or directory, open '/tmp/gh'"), "Read failed");

    expect(message).toContain("ENOENT: no such file or directory");
    expect(message).not.toContain("The 'gh' CLI");
  });

  it("keeps timeout errors distinct from generic network errors", () => {
    expect(formatCliError(new Error("connect ETIMEDOUT 140.82.113.4"), "Fetch failed")).toContain(
      "Command timed out",
    );
  });

  it("matches authentication errors case-insensitively", () => {
    expect(formatCliError(new Error("remote: Authentication failed"), "Fetch failed")).toContain(
      "Authentication failed",
    );
  });

  it("classifies HTTP 403 rate limits before generic permission errors", () => {
    const message = formatCliError(
      new Error("GraphQL: API rate limit exceeded for user. (HTTP 403)"),
      "Fetch failed",
    );

    expect(message).toContain("GitHub API rate limit exceeded");
    expect(message).not.toContain("Permission denied");
  });

  it("redacts embedded credentials in fallback output", () => {
    const message = formatCliError(
      new Error("fatal: unable to access 'https://ghp_secret@github.com/acme/repo.git/'"),
      "Clone failed",
    );

    expect(message).toContain("https://***@github.com/acme/repo.git");
    expect(message).not.toContain("ghp_secret");
  });
});
