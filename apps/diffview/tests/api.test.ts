import { afterAll as after, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ROOT is derived from $HOME when the API module loads, so every test shares one sandbox home
// (set before the dynamic import) and gets its own repository inside it.
const home = await mkdtemp(join(tmpdir(), "diffview-api-"));
const originalHome = process.env.HOME;
const originalProfile = process.env.ROME_PROFILE;
process.env.HOME = home;
process.env.ROME_PROFILE = "t";
const { createApiHandler } = await import("../src/api/index");
const handler = createApiHandler({} as never);
let counter = 0;
after(async () => {
  await rm(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.ROME_PROFILE;
  else process.env.ROME_PROFILE = originalProfile;
});

async function boot(diffCap?: string, maxFiles?: string) {
  if (diffCap) process.env.DIFFVIEW_DIFF_CAP = diffCap;
  else delete process.env.DIFFVIEW_DIFF_CAP;
  if (maxFiles) process.env.DIFFVIEW_MAX_FILES = maxFiles;
  else delete process.env.DIFFVIEW_MAX_FILES;
  const repo = join(home, ".rome", "t", "projects", `repo${counter++}`);
  await mkdir(repo, { recursive: true });
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  g("init", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.invalid");
  const body = (n: number, tag: string) =>
    Array.from({ length: 40 }, (_, i) => `${tag} line ${n}-${i}`).join("\n") +
    "\n";
  for (let i = 0; i < 300; i++)
    await writeFile(
      join(repo, `f${String(i).padStart(3, "0")}.txt`),
      body(i, "old"),
    );
  g("add", "-A");
  g("commit", "-m", "init");
  for (let i = 0; i < 300; i++)
    await writeFile(
      join(repo, `f${String(i).padStart(3, "0")}.txt`),
      body(i, "new"),
    );
  const call = async (route: string, q: Record<string, string>) => {
    const res = await handler.handle({
      caller: { kind: "guardian" },
      method: "GET",
      path: route.split("/"),
      query: new URLSearchParams({ repo, mode: "uncommitted", ctx: "3", ...q }),
    } as never);
    return {
      status: res.status,
      body: (await res.json()) as any,
      headers: res.headers,
    };
  };
  return { repo, call };
}

test("a small diff: one list request carries the first page, later pages continue it", async () => {
  const { call } = await boot();
  try {
    const first = await call("files", {});
    assert.equal(first.status, 200);
    assert.equal(first.body.files.length, 300);
    const paths = Object.keys(first.body.page.patches);
    assert.ok(
      paths.length > 0 && paths.length < 300,
      "first page is cropped, not the whole diff",
    );
    assert.equal(first.body.page.next, paths.length);
    // Following pages are cut from memory with the fingerprint: no git process at all.
    const seen = new Set(paths);
    let cursor: number | null = first.body.page.next;
    while (cursor !== null) {
      const page = await call("patches", {
        cursor: String(cursor),
        fp: first.body.fingerprint,
      });
      assert.equal(page.status, 200);
      assert.match(page.headers.get("Server-Timing")!, /0 spawns/);
      for (const p of Object.keys(page.body.patches)) {
        assert.ok(!seen.has(p), "no file is delivered twice");
        seen.add(p);
      }
      cursor = page.body.next;
    }
    assert.equal(seen.size, 300);
  } finally {
    delete process.env.DIFFVIEW_DIFF_CAP;
    delete process.env.DIFFVIEW_MAX_FILES;
  }
});

test("a diff too large to hold is still paged, one git diff per page, never per file", async () => {
  const { call } = await boot("20000");
  try {
    const first = await call("files", {});
    assert.equal(first.status, 200);
    assert.equal(first.body.files.length, 300);
    const seen = new Map<string, string>(
      Object.entries(first.body.page.patches).map(([p, v]: any) => [
        p,
        v.patch,
      ]),
    );
    let cursor: number | null = first.body.page.next;
    let pages = 1;
    while (cursor !== null) {
      const page = await call("patches", {
        cursor: String(cursor),
        fp: first.body.fingerprint,
      });
      assert.equal(page.status, 200);
      // Page cost is bounded: the page's diff plus a line-count batch, whatever its file count.
      const spawns = Number(
        /(\d+) spawns/.exec(page.headers.get("Server-Timing")!)![1],
      );
      assert.ok(spawns <= 3, `page used ${spawns} git processes`);
      for (const [p, v] of Object.entries<any>(page.body.patches))
        seen.set(p, v.patch);
      cursor = page.body.next;
      pages++;
    }
    assert.ok(pages > 1 && pages < 30, `delivered in ${pages} pages`);
    assert.equal(seen.size, 300);
    for (const [path, patch] of seen) {
      assert.ok(
        patch.includes(`+++ b/${path}`),
        `${path} patch is the file's own`,
      );
      assert.ok(patch.includes("+new line"), `${path} carries its changes`);
    }
  } finally {
    delete process.env.DIFFVIEW_DIFF_CAP;
    delete process.env.DIFFVIEW_MAX_FILES;
  }
});

test("a page cursor outside the sequence is rejected", async () => {
  const { call } = await boot();
  try {
    const first = await call("files", {});
    const bad = await call("patches", {
      cursor: "9999",
      fp: first.body.fingerprint,
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "invalid_cursor");
    const neg = await call("patches", {
      cursor: "-1",
      fp: first.body.fingerprint,
    });
    assert.equal(neg.status, 400);
  } finally {
    delete process.env.DIFFVIEW_DIFF_CAP;
    delete process.env.DIFFVIEW_MAX_FILES;
  }
});

test("a comparison with many changed files is paged from the start, without computing the whole diff", async () => {
  const { call } = await boot(undefined, "100");
  try {
    const first = await call("files", {});
    assert.equal(first.status, 200);
    assert.equal(first.body.files.length, 300);
    // The list is built from numstat/raw only: no whole-diff process.
    const seen = new Map<string, string>(
      Object.entries<any>(first.body.page.patches).map(([p, v]) => [
        p,
        v.patch,
      ]),
    );
    let cursor: number | null = first.body.page.next;
    while (cursor !== null) {
      const page = await call("patches", {
        cursor: String(cursor),
        fp: first.body.fingerprint,
      });
      assert.equal(page.status, 200);
      const spawns = Number(
        /(\d+) spawns/.exec(page.headers.get("Server-Timing")!)![1],
      );
      assert.ok(spawns <= 3, `page used ${spawns} git processes`);
      for (const [p, v] of Object.entries<any>(page.body.patches))
        seen.set(p, v.patch);
      cursor = page.body.next;
    }
    assert.equal(seen.size, 300);
    for (const [path, patch] of seen)
      assert.ok(patch.includes(`+++ b/${path}`), path);
  } finally {
    delete process.env.DIFFVIEW_MAX_FILES;
  }
});

test("pages honour a server-side filter and may start at any cursor", async () => {
  const { call } = await boot();
  const first = await call("files", {});
  const fp = first.body.fingerprint;
  const filtered = await call("patches", { cursor: "0", fp, q: "F25" });
  assert.equal(filtered.status, 200);
  assert.deepEqual(
    Object.keys(filtered.body.patches).sort(),
    Array.from({ length: 10 }, (_, i) => `f25${i}.txt`),
  );
  assert.equal(filtered.body.next, null);
  // Starting mid-sequence is one request, with no earlier page needed.
  const tail = await call("patches", { cursor: "5", fp, q: "f25" });
  assert.deepEqual(
    Object.keys(tail.body.patches).sort(),
    Array.from({ length: 5 }, (_, i) => `f25${i + 5}.txt`),
  );
  const mid = await call("patches", { cursor: "250", fp });
  assert.ok(Object.keys(mid.body.patches)[0].startsWith("f25"));
  assert.match(mid.headers.get("Server-Timing")!, /0 spawns/);
});

test("a refresh that already holds the current list gets a tiny unchanged reply", async () => {
  const { call } = await boot();
  const first = await call("files", {});
  const again = await call("files", { have: first.body.fingerprint });
  assert.equal(again.body.unchanged, true);
  assert.equal(again.body.files, undefined);
  const stale = await call("files", { have: "not-the-current-fingerprint" });
  assert.equal(stale.body.files.length, 300);
  const events = await call("events", {});
  assert.equal(typeof events.body.ms, "number");
});

test("comparing a base with no ref chosen uses the default branch, and reports when it is HEAD's own commit", async () => {
  const { repo, call } = await boot();
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  // On the default branch itself: the base *is* HEAD, so committed work has nothing to compare.
  const onBase = await call("files", { mode: "ref", ref: "", target: "head" });
  assert.equal(onBase.status, 200);
  assert.deepEqual(onBase.body.compare, { ref: "main", same: true });
  assert.equal(onBase.body.files.length, 0);
  // The working tree is the way out: same base, but the uncommitted edits show up.
  const withWork = await call("files", {
    mode: "ref",
    ref: "",
    target: "worktree",
  });
  assert.equal(withWork.body.files.length, 300);
  // A branch with its own commit is no longer "the same".
  g("checkout", "-b", "feature");
  g("add", "-A");
  g("commit", "-m", "work");
  const onFeature = await call("files", {
    mode: "ref",
    ref: "",
    target: "head",
  });
  assert.deepEqual(onFeature.body.compare, { ref: "main", same: false });
  assert.equal(onFeature.body.files.length, 300);
  // Local-changes mode carries no comparison metadata.
  const local = await call("files", { mode: "uncommitted" });
  assert.equal(local.body.compare, undefined);
});

test("local revisions/history/tracking APIs and commit pages are read-only and independent of GitHub", async () => {
  const { repo, call } = await boot();
  const g = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
  const root = g("rev-parse", "HEAD");
  const index = g("ls-files", "--stage");
  const revisions = await call("revisions", {});
  assert.equal(revisions.status, 200);
  assert.deepEqual(revisions.body.prs, []);
  assert.ok(revisions.body.branches.includes("main"));
  const commits = await call("history", {});
  assert.equal(commits.body.commits[0].sha, root);
  assert.equal((await call("tracking", {})).body.state, "no_upstream");
  assert.equal(
    (await call("files", { mode: "unpushed" })).body.error,
    "no_upstream",
  );
  assert.equal((await call("history", { cursor: "-1" })).status, 400);
  const selected = await call("files", { mode: "commit", commit: root });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.files.length, 300);
  const page = await call("patches", {
    mode: "commit",
    commit: root,
    fp: selected.body.fingerprint,
    cursor: String(selected.body.page.next),
  });
  assert.equal(page.status, 200);
  assert.ok(Object.keys(page.body.patches).length > 0);
  assert.equal(g("ls-files", "--stage"), index);
});

test("moving a selected commit alias invalidates conditional refresh even when HEAD/worktree do not change", async () => {
  const { repo, call } = await boot();
  const g = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
  const root = g("rev-parse", "HEAD");
  g("add", "--", "f000.txt");
  g("commit", "-m", "second");
  const second = g("rev-parse", "HEAD");
  g("update-ref", "refs/heads/selected", root);
  const initial = await call("files", { mode: "commit", commit: "selected" });
  assert.equal(initial.body.files.length, 300);
  g("update-ref", "refs/heads/selected", second);
  const updated = await call("files", {
    mode: "commit",
    commit: "selected",
    have: initial.body.fingerprint,
  });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.body.fingerprint, initial.body.fingerprint);
  assert.equal(updated.body.unchanged, undefined);
  assert.deepEqual(
    updated.body.files.map((f: { path: string }) => f.path),
    ["f000.txt"],
  );
});
