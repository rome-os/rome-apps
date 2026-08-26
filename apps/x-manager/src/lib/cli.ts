/**
 * Thin wrapper around `opencli twitter` commands.
 * All X/Twitter browser automation flows go through this module.
 */
import { execFile } from "node:child_process";
import { createAppLogger } from "@rome-os/app-runtime";

const log = createAppLogger("x-cli");

const DEFAULT_TIMEOUT_MS = 120_000;
const CDP_ENDPOINT = "http://127.0.0.1:9222";

export interface CliResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run an `opencli twitter <subcommand>` with the given positional args and
 * named options. Always requests YAML output for machine-readable parsing.
 * Uses `--cdp-endpoint` for direct browser automation without the extension.
 */
export async function runTwitterCli(
  subcommand: string,
  positionalArgs: string[] = [],
  options: Record<string, string | boolean> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CliResult> {
  // Place --cdp-endpoint BEFORE the site name so opencli picks it up as a
  // global option, then the twitter subcommand and its positional args.
  const args = ["--cdp-endpoint", CDP_ENDPOINT, "twitter", subcommand, ...positionalArgs];

  // Always request yaml output for structured parsing
  if (!options["format"] && !options["f"]) {
    args.push("-f", "yaml");
  }

  for (const [key, value] of Object.entries(options)) {
    if (value === true) {
      args.push(`--${key}`);
    } else if (value !== false && value !== "") {
      args.push(`--${key}`, String(value));
    }
  }

  log.info(`running: opencli ${args.join(" ")}`);

  return new Promise((resolve) => {
    execFile(
      "opencli",
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
      (error, stdout, stderr) => {
        if (error) {
          log.warn(`opencli twitter ${subcommand} failed`, { error: error.message, stderr });
          resolve({ success: false, stdout: stdout ?? "", stderr: stderr ?? error.message });
        } else {
          resolve({ success: true, stdout: stdout ?? "", stderr: stderr ?? "" });
        }
      },
    );
  });
}

/**
 * Parse YAML-ish output from opencli into an array of record objects.
 * opencli yaml output uses `- key: value` for list items with subsequent
 * indented `key: value` lines belonging to the same record.
 */
export function parseYamlRecords(output: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;

  for (const line of output.split("\n")) {
    // New record starts with `- key: value`
    const listItemMatch = line.match(/^- (\w[\w_]*?):\s*(.*)$/);
    if (listItemMatch) {
      if (current && Object.keys(current).length > 0) {
        records.push(current);
      }
      current = {};
      current[listItemMatch[1]!.trim()] = listItemMatch[2]!.trim();
      continue;
    }

    // Continuation line: `  key: value` (indented, belongs to current record)
    const continuationMatch = line.match(/^\s+(\w[\w_]*?):\s*(.*)$/);
    if (continuationMatch && current) {
      current[continuationMatch[1]!.trim()] = continuationMatch[2]!.trim();
      continue;
    }
  }

  // Push the last record
  if (current && Object.keys(current).length > 0) {
    records.push(current);
  }

  return records;
}

/**
 * Parse JSON output from opencli.
 */
export function parseJsonOutput<T = unknown>(output: string): T | null {
  try {
    return JSON.parse(output) as T;
  } catch {
    return null;
  }
}
