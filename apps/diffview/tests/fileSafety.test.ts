import { test } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  open,
  lstat,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyOpenedFile } from "../src/lib/fileSafety";
test("portable descriptor checks succeed without procfs but reject identity/location substitutions", async () => {
  const root = await mkdtemp(join(tmpdir(), "diff-file-safety-"));
  const path = join(root, "safe.txt");
  await writeFile(path, "safe");
  const expected = await lstat(path),
    handle = await open(path, "r");
  const noProc = async (p: string) => {
    if (p.startsWith("/proc/"))
      throw Object.assign(Error("no proc"), { code: "ENOENT" });
    return realpath(p);
  };
  try {
    assert.equal(
      (await verifyOpenedFile(root, path, expected, handle, noProc)).size,
      4,
    );
    assert.equal(
      (await verifyOpenedFile(root, path, expected, handle)).size,
      4,
    );
    await assert.rejects(
      verifyOpenedFile(
        root,
        path,
        { ...expected, ino: expected.ino + 1 } as never,
        handle,
        noProc,
      ),
    );
    await assert.rejects(
      verifyOpenedFile(
        root,
        path,
        expected,
        handle,
        async () => "/outside/replaced.txt",
      ),
    );
    await assert.rejects(
      verifyOpenedFile(root, path, expected, handle, async (p) =>
        p.startsWith("/proc/") ? "/outside/opened.txt" : path,
      ),
    );
    await assert.rejects(
      verifyOpenedFile(root, path, expected, handle, async (p) => {
        if (p.startsWith("/proc/"))
          throw Object.assign(Error("denied"), { code: "EACCES" });
        return path;
      }),
    );
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});
