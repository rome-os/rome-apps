export interface CliErrorMessages {
  notFound?: string;
  permissionDenied?: string;
  authenticationFailed?: string;
  invalidRequest?: string;
  rateLimit?: string;
  network?: string;
  missingGh?: string;
  missingGit?: string;
  timeout?: string;
  repositoryNotFound?: string;
}

const DEFAULT_MESSAGES: Required<CliErrorMessages> = {
  notFound: "Not found. The repository or PR may not exist, or you may lack access.",
  permissionDenied: "Permission denied. Check that your GitHub token has the required permissions.",
  authenticationFailed: "Authentication failed. Run 'gh auth login' to re-authenticate.",
  invalidRequest: "Invalid request. The data sent to GitHub was rejected (e.g. invalid commit SHA or file path).",
  rateLimit: "GitHub API rate limit exceeded. Please wait a few minutes and try again.",
  network: "Network error. Could not reach GitHub. Check your internet connection.",
  missingGh: "The 'gh' CLI tool is not installed or not in PATH.",
  missingGit: "The 'git' command is not installed or not in PATH.",
  timeout: "Command timed out. The operation took too long to complete.",
  repositoryNotFound: "Repository not found. Check the repository URL and your access permissions.",
};

function commandMissing(raw: string, command: "gh" | "git"): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s|['"\`])${escaped}(?:['"\`])?: command not found`, "i").test(raw)
    || new RegExp(`spawnSync\\s+${escaped}\\s+ENOENT`, "i").test(raw)
    || new RegExp(`spawn\\s+${escaped}\\s+ENOENT`, "i").test(raw);
}

function firstMeaningfulLine(raw: string): string | undefined {
  return raw
    .split("\n")
    .find((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0
        && !trimmed.startsWith("at ")
        && !line.startsWith("    ");
    })
    ?.trim();
}

export function sanitizeCliError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/https:\/\/[^@\s]+@/g, "https://***@");
}

export function formatCliError(
  err: unknown,
  context: string,
  messages: CliErrorMessages = {},
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const msg = { ...DEFAULT_MESSAGES, ...messages };

  if (raw.includes("Could not resolve to a PullRequest")) {
    return `${context}: PR not found. Check that the PR number and repository are correct.`;
  }
  if (raw.includes("HTTP 404")) {
    return `${context}: ${msg.notFound}`;
  }
  if (lower.includes("rate limit") || raw.includes("HTTP 429")) {
    return `${context}: ${msg.rateLimit}`;
  }
  if (raw.includes("HTTP 403") || raw.includes("Resource not accessible")) {
    return `${context}: ${msg.permissionDenied}`;
  }
  if (raw.includes("HTTP 401") || lower.includes("authentication")) {
    return `${context}: ${msg.authenticationFailed}`;
  }
  if (raw.includes("HTTP 422")) {
    return `${context}: ${msg.invalidRequest}`;
  }
  if (raw.includes("ETIMEDOUT") || lower.includes("timed out")) {
    return `${context}: ${msg.timeout}`;
  }
  if (raw.includes("Could not resolve host") || raw.includes("ECONNREFUSED")) {
    return `${context}: ${msg.network}`;
  }
  if (commandMissing(raw, "gh")) {
    return `${context}: ${msg.missingGh}`;
  }
  if (commandMissing(raw, "git")) {
    return `${context}: ${msg.missingGit}`;
  }
  if (raw.includes("fatal: repository") && raw.includes("not found")) {
    return `${context}: ${msg.repositoryNotFound}`;
  }

  const fallback = firstMeaningfulLine(raw) || raw.substring(0, 200);
  return `${context}: ${sanitizeCliError(fallback)}`;
}
