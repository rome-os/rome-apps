import { afterAll as after, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ROOT comes from $HOME when the modules load: one sandbox home for the file, set before importing.
const home = await mkdtemp(join(tmpdir(), "diffview-memory-"));
const originalHome = process.env.HOME;
const originalProfile = process.env.ROME_PROFILE;
process.env.HOME = home;
process.env.ROME_PROFILE = "t";
const { createApiHandler } = await import("../src/api/index");
const git = await import("../src/lib/git");
const { buildSnapshot, loadUntrackedPatch } =
  await import("../src/lib/snapshot");
const handler = createApiHandler({} as never);
let counter = 0;
after(async () => {
  await rm(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.ROME_PROFILE;
  else process.env.ROME_PROFILE = originalProfile;
});

async function repo() {
  const dir = join(home, ".rome", "t", "projects", `r${counter++}`);
  await mkdir(dir, { recursive: true });
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.invalid");
  await writeFile(join(dir, "seed.txt"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "init");
  return { dir, g };
}
async function call(
  dir: string,
  route: string,
  q: Record<string, string> = {},
) {
  const res = await handler.handle({
    caller: { kind: "guardian" },
    method: "GET",
    path: route.split("/"),
    query: new URLSearchParams({
      repo: dir,
      mode: "uncommitted",
      ctx: "3",
      ...q,
    }),
  } as never);
  return { status: res.status, body: (await res.json()) as any };
}
const lines = (n: number, tag: string) =>
  Array.from(
    { length: n },
    (_, i) => `${tag} line ${i} ${"x".repeat(40)}`,
  ).join("\n") + "\n";

test("untracked files beyond the memory budget are read from disk when asked for, not kept", async () => {
  process.env.DIFFVIEW_UNTRACKED_BUDGET = "20000"; // room for a handful of files only
  try {
    const { dir } = await repo();
    for (let i = 0; i < 40; i++)
      await writeFile(
        join(dir, `u${String(i).padStart(2, "0")}.txt`),
        lines(200, `f${i}`),
      );
    const info = await git.fingerprintInfo(dir);
    const snap = await buildSnapshot(
      dir,
      { mode: "uncommitted", filter: "all" },
      3,
      info,
    );
    const kept = snap.files.filter((f) => f.untracked && f.patch);
    const lazy = snap.files.filter((f) => f.untracked && f.lazy);
    const retained = snap.files.reduce((n, f) => n + f.patch.length, 0);
    assert.ok(
      retained <= 20000,
      `snapshot kept ${retained} bytes of patch text`,
    );
    assert.ok(lazy.length > 20, "most files are not held in memory");
    assert.equal(kept.length + lazy.length, 40);
    // Nothing is lost: every page still carries every file's real content.
    const first = await call(dir, "files");
    const seen = new Map<string, string>(
      Object.entries<any>(first.body.page.patches).map(([p, v]) => [
        p,
        v.patch,
      ]),
    );
    let cursor: number | null = first.body.page.next;
    while (cursor !== null) {
      const page = await call(dir, "patches", {
        cursor: String(cursor),
        fp: first.body.fingerprint,
      });
      for (const [p, v] of Object.entries<any>(page.body.patches))
        seen.set(p, v.patch);
      cursor = page.body.next;
    }
    assert.equal(seen.size, 40);
    for (let i = 0; i < 40; i++) {
      const name = `u${String(i).padStart(2, "0")}.txt`;
      assert.ok(
        seen.get(name)?.includes(`+f${i} line 199`),
        `${name} has its own content`,
      );
    }
  } finally {
    delete process.env.DIFFVIEW_UNTRACKED_BUDGET;
  }
});
test("a lazily held untracked file still loads in full on request", async () => {
  process.env.DIFFVIEW_UNTRACKED_BUDGET = "1";
  try {
    const { dir } = await repo();
    await writeFile(join(dir, "one.txt"), lines(300, "only"));
    await writeFile(join(dir, "big.txt"), lines(3000, "big")); // collapsed by size
    const first = await call(dir, "files");
    const list = first.body.files.map((f: any) => f.path);
    assert.deepEqual(list.sort(), ["big.txt", "one.txt"]);
    const pageHas = first.body.page.patches;
    assert.ok(
      pageHas["one.txt"].patch.includes("+only line 299"),
      "paged from disk",
    );
    assert.equal(
      pageHas["big.txt"],
      undefined,
      "a collapsed file is not paged",
    );
    const asked = await call(dir, "patch", {
      path: "big.txt",
      unified: "3",
      fp: first.body.fingerprint,
    });
    assert.equal(asked.status, 200);
    assert.ok(asked.body.patch.includes("+big line 2999"));
    assert.equal(asked.body.truncated, false);
    const direct = await loadUntrackedPatch(dir, "big.txt", false);
    assert.equal(direct.patch, asked.body.patch);
  } finally {
    delete process.env.DIFFVIEW_UNTRACKED_BUDGET;
  }
});
test("line totals of non-ASCII blobs are exact (cat-file replies are bytes, not text)", async () => {
  const { dir, g } = await repo();
  await writeFile(join(dir, "文件.md"), "一\n二\n三\n");
  await writeFile(join(dir, "ascii.txt"), "a\nb\nc\nd\n");
  g("add", "-A");
  g("commit", "-qm", "base");
  await writeFile(join(dir, "文件.md"), "一\n二\n三\n四\n五\n");
  await writeFile(join(dir, "ascii.txt"), "a\nb\nc\nd\ne\nf\n");
  g("add", "-A");
  g("commit", "-qm", "edit");
  const info = await git.fingerprintInfo(dir);
  const snap = await buildSnapshot(
    dir,
    { mode: "ref", ref: "HEAD~1", dots: "two", target: "head" },
    3,
    info,
  );
  const by = Object.fromEntries(snap.files.map((f) => [f.path, f]));
  assert.equal(by["文件.md"].totalLines, 5);
  assert.equal(
    by["ascii.txt"].totalLines,
    6,
    "a non-ASCII file must not corrupt the next file's count",
  );
});
test("mapLimit never runs more than the limit at once and keeps order", async () => {
  let active = 0,
    peak = 0;
  const out = await git.mapLimit(
    Array.from({ length: 50 }, (_, i) => i),
    7,
    async (i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return i * 2;
    },
  );
  assert.equal(peak, 7);
  assert.deepEqual(
    out,
    Array.from({ length: 50 }, (_, i) => i * 2),
  );
});
test("several tabs asking for the fingerprint at once share one git status", async () => {
  const { dir } = await repo();
  await writeFile(join(dir, "x.txt"), "x\n");
  const trace = { spawns: 0, spawnMs: 0, cacheHits: 0, cacheMisses: 0 };
  const results = await git.traceStore.run(trace, () =>
    Promise.all(Array.from({ length: 8 }, () => git.fingerprintInfo(dir))),
  );
  assert.equal(new Set(results.map((r) => r.hash)).size, 1);
  assert.equal(trace.spawns, 1, "one process, not eight");
  // Sharing is only for concurrent calls: a later edit is still seen.
  await writeFile(join(dir, "y.txt"), "y\n");
  assert.notEqual((await git.fingerprintInfo(dir)).hash, results[0].hash);
});
test("a huge set of changed paths is fingerprinted without a stat per file", async () => {
  const { dir } = await repo();
  for (let d = 0; d < 30; d++) {
    await mkdir(join(dir, `d${d}`));
    for (let i = 0; i < 200; i++)
      await writeFile(join(dir, `d${d}`, `f${i}.txt`), "x\n");
  }
  const info = await git.fingerprintInfo(dir); // 6,000 untracked paths, past the 5,000 limit
  assert.equal(info.untracked.length, 6000);
  assert.equal(info.hash.length, 64);
});
test("a tiny view budget evicts old views but every request still works", async () => {
  process.env.DIFFVIEW_VIEW_BUDGET = "1000";
  try {
    const a = await repo(),
      b = await repo();
    await writeFile(join(a.dir, "a.txt"), lines(100, "a"));
    await writeFile(join(b.dir, "b.txt"), lines(100, "b"));
    const fa = await call(a.dir, "files");
    await call(b.dir, "files"); // building b pushes a over the budget
    // a's view was dropped; asking for its page with the old fingerprint rebuilds it.
    const page = await call(a.dir, "patches", {
      cursor: "0",
      fp: fa.body.fingerprint,
    });
    assert.equal(page.status, 200);
    assert.ok(page.body.patches["a.txt"].patch.includes("+a line 99"));
  } finally {
    delete process.env.DIFFVIEW_VIEW_BUDGET;
  }
});
