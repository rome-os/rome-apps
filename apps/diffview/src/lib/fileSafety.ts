import { realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { relative, isAbsolute, sep } from "node:path";
function within(root: string, path: string) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}
/** Verify descriptor identity on every platform; use /proc as an additional Linux check. */
export async function verifyOpenedFile(
  repo: string,
  path: string,
  expected: Stats,
  handle: FileHandle,
  resolvePath: (path: string) => Promise<string> = realpath,
) {
  const actual = await handle.stat();
  if (
    !actual.isFile() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino
  )
    throw Error("file_identity_changed");
  // Re-resolve the checked pathname after opening to detect parent-directory substitutions.
  const current = await resolvePath(path);
  if (current !== path || !within(repo, current))
    throw Error("file_location_changed");
  try {
    const opened = await resolvePath("/proc/self/fd/" + handle.fd);
    if (!within(repo, opened)) throw Error("opened_file_outside_repo");
  } catch (error) {
    // macOS/other platforms without procfs still require the descriptor/path identity checks.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
  return actual;
}
