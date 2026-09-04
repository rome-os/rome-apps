/**
 * Small helpers to turn raw `gh`/`git` CLI failures into readable, secret-free
 * messages for the dashboard and the triage_results.error column.
 */
const DEFAULT_MESSAGES = {
  notFound: "Not found. The repository or issue may not exist, or you may lack access.",
  permissionDenied: "Permission denied. Check that your GitHub token has the required permissions.",
  authenticationFailed: "Authentication failed. Connect GitHub (gh auth login) and try again.",
  invalidRequest: "Invalid request. The data sent to GitHub was rejected.",
  rateLimit: "GitHub API rate limit exceeded. Please wait a few minutes and try again.",
  network: "Network error. Could not reach GitHub. Check your internet connection.",
  missingGh: "The 'gh' CLI tool is not installed or not in PATH.",
  timeout: "Command timed out. The operation took too long to complete.",
  repositoryNotFound: "Repository not found. Check the repository slug and your access permissions.",
};

function commandMissing(raw: string): boolean {
  return /(?:^|\s|['"`])gh(?:['"`])?: command not found/i.test(raw)
    || /spawn(?:Sync)?\s+gh\s+ENOENT/i.test(raw);
}

function firstMeaningfulLine(raw: string): string | undefined {
  return raw
    .split("\n")
    .find((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("at ") && !line.startsWith("    ");
    })
    ?.trim();
}

/** Strip embedded credentials from a raw error string. */
export function sanitizeCliError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/https:\/\/[^@\s]+@/g, "https://***@");
}

export function formatCliError(err: unknown, context: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const m = DEFAULT_MESSAGES;

  if (raw.includes("HTTP 404")) return `${context}: ${m.notFound}`;
  if (lower.includes("rate limit") || raw.includes("HTTP 429")) return `${context}: ${m.rateLimit}`;
  if (raw.includes("HTTP 403") || raw.includes("Resource not accessible")) return `${context}: ${m.permissionDenied}`;
  if (raw.includes("HTTP 401") || lower.includes("authentication")) return `${context}: ${m.authenticationFailed}`;
  if (raw.includes("HTTP 422")) return `${context}: ${m.invalidRequest}`;
  if (raw.includes("ETIMEDOUT") || lower.includes("timed out")) return `${context}: ${m.timeout}`;
  if (raw.includes("Could not resolve host") || raw.includes("ECONNREFUSED")) return `${context}: ${m.network}`;
  if (commandMissing(raw)) return `${context}: ${m.missingGh}`;
  if (raw.includes("fatal: repository") && raw.includes("not found")) return `${context}: ${m.repositoryNotFound}`;

  const fallback = firstMeaningfulLine(raw) || raw.substring(0, 200);
  return `${context}: ${sanitizeCliError(fallback)}`;
}
