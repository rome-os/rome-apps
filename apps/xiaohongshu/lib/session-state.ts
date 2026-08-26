import os from "node:os";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATE_DIR = join(os.tmpdir(), "rome-xiaohongshu");

interface PersistentPageState {
  browserUrl: string;
  targetId: string;
}

function statePath(browserUrl: string): string {
  const key = browserUrl.replace(/[^A-Za-z0-9]+/g, "_");
  return join(STATE_DIR, `${key}.json`);
}

export async function loadPersistentPageTarget(browserUrl: string): Promise<string | null> {
  try {
    const raw = await readFile(statePath(browserUrl), "utf8");
    const parsed = JSON.parse(raw) as PersistentPageState;
    return parsed.targetId || null;
  } catch {
    return null;
  }
}

export async function savePersistentPageTarget(
  browserUrl: string,
  targetId: string,
): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    statePath(browserUrl),
    JSON.stringify({ browserUrl, targetId } satisfies PersistentPageState),
    "utf8",
  );
}

export async function clearPersistentPageTarget(browserUrl: string): Promise<void> {
  try {
    await unlink(statePath(browserUrl));
  } catch {
    // Ignore missing state.
  }
}
