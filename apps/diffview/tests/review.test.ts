import { afterAll, afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  chmod,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const home = await mkdtemp(join(tmpdir(), "diffview-review-"));
const original = {
  HOME: process.env.HOME,
  ROME_PROFILE: process.env.ROME_PROFILE,
  PATH: process.env.PATH,
};
process.env.HOME = home;
process.env.ROME_PROFILE = "review";
const { createApiHandler } = await import("../src/api/index");
const snapshot = await import("../src/lib/snapshot");
const { GitError } = await import("../src/lib/git");
const handler = createApiHandler({} as never);
let counter = 0;
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of [
    "DIFFVIEW_DIFF_CAP",
    "DIFFVIEW_MAX_FILES",
    "DIFFVIEW_UNTRACKED_BUDGET",
  ])
    delete process.env[key];
  process.env.PATH = original.PATH;
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
async function fixture() {
  const repo = join(home, ".rome/review/projects", `r${counter++}`);
  await mkdir(repo, { recursive: true });
  const g = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
  const write = (path: string, value: string) =>
    writeFile(join(repo, path), value);
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Test");
  g("config", "user.email", "test@example.invalid");
  await write("seed.txt", "seed\n");
  g("add", ".");
  g("commit", "-qm", "root");
  const call = async (route: string, query: Record<string, string> = {}) => {
    const res = await handler.handle({
      caller: { kind: "guardian" },
      method: "GET",
      path: [route],
      query: new URLSearchParams({ repo, mode: "uncommitted", ...query }),
    } as never);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { repo, g, write, call };
}

test("failed view construction has no unhandled derived rejection and can retry", async () => {
  const { write, call } = await fixture();
  await write("seed.txt", "edited\n");
  const errors: unknown[] = [];
  const onError = (e: unknown) => errors.push(e);
  process.on("unhandledRejection", onError);
  try {
    vi.spyOn(snapshot, "buildSnapshot").mockRejectedValueOnce(
      new GitError("command_failed"),
    );
    assert.equal((await call("files")).status, 400);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(errors, []);
    assert.equal((await call("files")).status, 200);
  } finally {
    process.off("unhandledRejection", onError);
  }
});

for (const mode of ["branch", "ref"])
  test(`${mode}: moving only the base invalidates have and keeps old pages/expanded patches pinned`, async () => {
    const { g, write, call } = await fixture();
    const root = g("rev-parse", "HEAD");
    g("checkout", "-qb", "feature");
    for (let i = 0; i < 4; i++) await write(`f${i}.txt`, `feature ${i}\n`);
    g("add", ".");
    g("commit", "-qm", "feature");
    const feature = g("rev-parse", "HEAD");
    process.env.DIFFVIEW_DIFF_CAP = "1"; // force page construction, not stored snapshot text
    const q = { mode, base: "main", ref: "main", target: "head" };
    const first = await call("files", q);
    assert.equal(first.status, 200);
    assert.equal(first.body.files.length, 4);
    // Cache one old page, leave a different cursor uncached.
    await call("patches", { ...q, fp: first.body.fingerprint, cursor: "0" });
    const status = g("status", "--porcelain=v2"),
      index = g("ls-files", "--stage");
    g("update-ref", "refs/heads/main", feature);
    const cachedOld = await call("patches", {
      ...q,
      fp: first.body.fingerprint,
      cursor: "0",
    });
    assert.match(cachedOld.body.patches["f0.txt"].patch, /\+feature 0/);
    const uncachedOld = await call("patches", {
      ...q,
      fp: first.body.fingerprint,
      cursor: "1",
    });
    assert.match(uncachedOld.body.patches["f1.txt"].patch, /\+feature 1/);
    const expanded = await call("patch", {
      ...q,
      fp: first.body.fingerprint,
      path: "f1.txt",
      unified: "30",
    });
    assert.match(expanded.body.patch, /\+feature 1/);
    const second = await call("files", { ...q, have: first.body.fingerprint });
    assert.equal(second.status, 200);
    assert.equal(second.body.unchanged, undefined);
    assert.notEqual(second.body.fingerprint, first.body.fingerprint);
    assert.deepEqual(second.body.files, []);
    assert.deepEqual(
      (
        await call("patches", {
          ...q,
          fp: second.body.fingerprint,
          cursor: "0",
        })
      ).body.patches,
      {},
    );
    assert.equal(
      (await call("files", { ...q, have: second.body.fingerprint })).body
        .unchanged,
      true,
    );
    assert.equal(g("status", "--porcelain=v2"), status);
    assert.equal(g("ls-files", "--stage"), index);
    assert.equal(g("rev-parse", "HEAD"), feature);
    assert.notEqual(root, feature);
  });

test("paged lazy untracked files deliver actual contents within the byte budget", async () => {
  const { write, call } = await fixture();
  process.env.DIFFVIEW_MAX_FILES = "1";
  process.env.DIFFVIEW_UNTRACKED_BUDGET = "1";
  for (let i = 0; i < 12; i++)
    await write(
      `u${String(i).padStart(2, "0")}.txt`,
      `${i}:` + "x".repeat(250_000) + "\n",
    );
  const first = await call("files");
  assert.equal(first.status, 200);
  const seen = new Set<string>();
  let page = first.body.page;
  for (;;) {
    const entries = Object.entries<any>(page.patches);
    assert.ok(entries.length > 0);
    assert.ok(
      entries.reduce((n, [, patch]) => n + Buffer.byteLength(patch.patch), 0) <=
        1024 * 1024,
    );
    for (const [path, patch] of entries) {
      assert.ok(!seen.has(path));
      seen.add(path);
      assert.match(patch.patch, /\+\d+:x+/);
      assert.equal(patch.truncated, false);
    }
    if (page.next === null) break;
    const next = await call("patches", {
      fp: first.body.fingerprint,
      cursor: String(page.next),
    });
    assert.equal(next.status, 200);
    page = next.body;
  }
  assert.equal(seen.size, 12);
});

// A fake gh emits only fixture data; real Git fetch/diff operations still run against a local bare remote.
async function fakeGh(repo: string, upstream?: string) {
  const g = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
  const source = upstream || g("remote", "get-url", "origin");
  g(
    "config",
    "url." + source + ".insteadOf",
    "https://github.com/fixture/upstream.git",
  );
  const bin = join(repo, ".git", "test-bin");
  await mkdir(bin);
  await writeFile(join(repo, ".git", "gh-source"), source);
  const file = join(bin, "gh");
  await writeFile(
    file,
    `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');
const root=p.dirname(p.dirname(__dirname)),dir=p.join(root,'.git'),isApi=process.argv[2]==='api',n=isApi?process.argv.find(a=>a.startsWith('repos/')).split('/').at(-1):process.argv[4];
if(fs.existsSync(p.join(dir,'gh-fail')))process.exit(1);
if(process.argv[3]==='view'){if(process.argv.at(-1)!=='url')process.exit(2);process.stdout.write(JSON.stringify({url:'https://github.com/fixture/upstream/pull/'+n}));}
else if(isApi){
 const source=fs.readFileSync(p.join(dir,'gh-source'),'utf8');
 const sha=(ref)=>{try{return cp.execFileSync('git',['--git-dir='+source,'rev-parse','--verify',ref],{stdio:['ignore','pipe','ignore']}).toString().trim()}catch{return cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim()}};
 const override=fs.existsSync(p.join(dir,'gh-head-override'))?fs.readFileSync(p.join(dir,'gh-head-override'),'utf8'):undefined;
 process.stdout.write(JSON.stringify({baseRefName:'main',baseRefOid:sha('refs/heads/main'),headRefOid:override||sha('refs/pull/'+n+'/head'),url:'https://github.com/fixture/upstream/pull/'+n}));
}else if(process.argv[3]==='diff')process.stdout.write(fs.readFileSync(p.join(dir,'gh-diff'),'utf8'));
else process.exit(1);
`,
  );
  await chmod(file, 0o755);
  process.env.PATH = bin + ":" + original.PATH;
}

test("PR fetch refreshes base and head without changing user refs; explicit refresh bypasses PR TTL", async () => {
  const { repo, g, write, call } = await fixture();
  const oldBase = g("rev-parse", "HEAD");
  const remote = join(home, `remote-${counter}.git`);
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
  g("remote", "add", "origin", remote);
  g("push", "-q", "origin", "main");
  const index = g("ls-files", "--stage");
  await write("upstream.txt", "upstream only\n");
  g("add", ".");
  g("commit", "-qm", "upstream advanced");
  const base = g("rev-parse", "HEAD");
  g("push", "-q", "origin", "main");
  g("checkout", "-qb", "feature");
  await write("feature.txt", "PR v1\n");
  g("add", ".");
  g("commit", "-qm", "PR v1");
  g("push", "-q", "origin", "HEAD:refs/pull/1/head");
  g("checkout", "-q", "main");
  g("reset", "--hard", oldBase);
  g("update-ref", "refs/remotes/origin/main", oldBase);
  g("update-ref", "refs/diffview/pr/1", oldBase); // legacy app ref must not collide with new namespace
  await fakeGh(repo);
  const first = await call("files", { mode: "pr", pr: "1" });
  assert.equal(first.status, 200);
  assert.deepEqual(
    first.body.files.map((f: any) => f.path),
    ["feature.txt"],
  );
  assert.match(first.body.page.patches["feature.txt"].patch, /\+PR v1/);
  assert.equal(g("rev-parse", "main"), oldBase);
  assert.equal(g("rev-parse", "origin/main"), oldBase);
  assert.equal(g("ls-files", "--stage"), index);
  assert.equal(g("for-each-ref", "--format=%(refname)", "refs/diffview/"), "");
  // Advance the remote from a second clone while the local checkout stays entirely unchanged.
  const author = join(home, `author-${counter}`);
  execFileSync("git", ["clone", "-q", remote, author]);
  const a = (...args: string[]) =>
    execFileSync("git", args, { cwd: author, stdio: "pipe" });
  a("config", "user.name", "Test");
  a("config", "user.email", "test@example.invalid");
  a("fetch", "origin", "refs/pull/1/head");
  a("checkout", "-q", "FETCH_HEAD");
  await writeFile(join(author, "feature.txt"), "PR v2\n");
  a("add", ".");
  a("commit", "-qm", "PR v2");
  a("push", "-q", "origin", "HEAD:refs/pull/1/head");
  const next = await call("files", {
    mode: "pr",
    pr: "1",
    have: first.body.fingerprint,
    refresh: "1",
  });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.fingerprint, first.body.fingerprint);
  assert.match(next.body.page.patches["feature.txt"].patch, /\+PR v2/);
  await writeFile(join(author, "feature.txt"), "PR v3\n");
  a("add", ".");
  a("commit", "-qm", "PR v3");
  a("push", "-q", "origin", "HEAD:refs/pull/1/head");
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  const polled = await call("files", {
    mode: "pr",
    pr: "1",
    have: next.body.fingerprint,
  });
  assert.equal(polled.status, 200);
  assert.notEqual(polled.body.fingerprint, next.body.fingerprint);
  assert.match(polled.body.page.patches["feature.txt"].patch, /\+PR v3/);
  const old = await call("patch", {
    mode: "pr",
    pr: "1",
    fp: first.body.fingerprint,
    path: "feature.txt",
    unified: "40",
  });
  assert.match(old.body.patch, /\+PR v1/);
  assert.equal(g("rev-parse", "origin/main"), oldBase);
  assert.equal(g("status", "--porcelain"), "");
});

test("failed PR lookup retries immediately and fallback diff content versions invalidate have", async () => {
  const { repo, g, call } = await fixture();
  g("remote", "add", "origin", join(home, "absent.git"));
  await fakeGh(repo);
  const fail = join(repo, ".git", "gh-fail"),
    diff = join(repo, ".git", "gh-diff");
  await writeFile(fail, "fail");
  assert.equal((await call("files", { mode: "pr", pr: "2" })).status, 400);
  await rm(fail);
  const text = (version: string) =>
    `diff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+${version}\n`;
  await writeFile(diff, text("v1"));
  const first = await call("files", { mode: "pr", pr: "2" });
  assert.equal(first.status, 200);
  assert.match(first.body.page.patches["a.txt"].patch, /\+v1/);
  await writeFile(diff, text("v2"));
  const next = await call("files", {
    mode: "pr",
    pr: "2",
    have: first.body.fingerprint,
    refresh: "1",
  });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.fingerprint, first.body.fingerprint);
  assert.match(next.body.page.patches["a.txt"].patch, /\+v2/);
  await writeFile(diff, "");
  const empty = await call("files", { mode: "pr", pr: "2", refresh: "1" });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.files, []);
  assert.equal(await readFile(diff, "utf8"), "");
});

test("an evicted stale view is rejected rather than serving current patches under its old identity", async () => {
  const { g, write, call } = await fixture();
  g("checkout", "-qb", "feature");
  await write("feature.txt", "feature\n");
  g("add", ".");
  g("commit", "-qm", "feature");
  const q = { mode: "branch", base: "main" };
  const first = await call("files", q);
  for (let ctx = 10; ctx < 18; ctx++)
    assert.equal((await call("files", { ...q, ctx: String(ctx) })).status, 200);
  g("update-ref", "refs/heads/main", g("rev-parse", "HEAD"));
  const stale = await call("patches", {
    ...q,
    fp: first.body.fingerprint,
    cursor: "0",
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "stale_view");
  const current = await call("files", { ...q, have: first.body.fingerprint });
  assert.equal(current.status, 200);
  assert.deepEqual(current.body.files, []);
});

for (const config of ["diff.noprefix", "diff.mnemonicprefix"]) {
  for (const paged of [false, true])
    test(`${config}: canonical snapshot/page/expanded patch output (${paged ? "paged" : "snapshot"})`, async () => {
      const { g, write, call } = await fixture();
      g("config", config, "true");
      await write("seed.txt", "edited\n");
      if (paged) process.env.DIFFVIEW_DIFF_CAP = "1";
      const first = await call("files");
      assert.equal(first.status, 200);
      assert.equal(first.body.files[0].path, "seed.txt");
      assert.match(
        first.body.page.patches["seed.txt"].patch,
        /^diff --git a\/seed.txt b\/seed.txt/m,
      );
      const patch = await call("patch", {
        fp: first.body.fingerprint,
        path: "seed.txt",
        unified: "30",
      });
      assert.equal(patch.status, 200);
      assert.match(patch.body.patch, /\+edited/);
    });
}

test("unresolved conflicts stay visible in all local scopes, including paged mode", async () => {
  const { g, write, call } = await fixture();
  g("mv", "seed.txt", "conflict file.txt");
  g("commit", "-qm", "rename");
  g("checkout", "-qb", "side");
  await write("conflict file.txt", "side\n");
  g("add", ".");
  g("commit", "-qm", "side");
  g("checkout", "main");
  await write("conflict file.txt", "main\n");
  g("add", ".");
  g("commit", "-qm", "main");
  try {
    g("merge", "side");
  } catch {
    /* expected conflict */
  }
  const status = g("status", "--porcelain=v2"),
    index = g("ls-files", "--stage");
  for (const filter of ["all", "staged", "unstaged"]) {
    for (const paged of [false, true]) {
      if (paged) process.env.DIFFVIEW_DIFF_CAP = "1";
      else delete process.env.DIFFVIEW_DIFF_CAP;
      const first = await call("files", { filter, ctx: paged ? "4" : "3" });
      assert.equal(first.status, 200);
      const entry = first.body.files.find(
        (f: any) => f.path === "conflict file.txt",
      );
      assert.equal(entry?.conflicted, true);
      assert.equal(entry.status, "U");
      assert.equal(Object.keys(first.body.page.patches).length, 0);
      const patch = await call("patch", {
        filter,
        ctx: paged ? "4" : "3",
        fp: first.body.fingerprint,
        path: "conflict file.txt",
      });
      assert.equal(patch.status, 409);
      assert.equal(patch.body.error, "unmerged_conflict");
    }
  }
  assert.equal(g("status", "--porcelain=v2"), status);
  assert.equal(g("ls-files", "--stage"), index);
});

test("immutable comparisons ignore edits/index/untracked changes and skip worktree status", async () => {
  const { g, write, call } = await fixture();
  const root = g("rev-parse", "HEAD");
  g("checkout", "-qb", "feature");
  await write("seed.txt", "committed\n");
  g("add", ".");
  g("commit", "-qm", "feature");
  const head = g("rev-parse", "HEAD");
  g("remote", "add", "origin", "/nonexistent-test-remote");
  g("update-ref", "refs/remotes/origin/main", root);
  g("config", "branch.feature.remote", "origin");
  g("config", "branch.feature.merge", "refs/heads/main");
  const lib = await import("../src/lib/git");
  const status = vi
    .spyOn(lib, "fingerprintInfo")
    .mockRejectedValue(Error("pure comparisons must not inspect git status"));
  for (const q of [
    { mode: "branch", base: "main" },
    { mode: "ref", ref: "main", target: "head" },
    { mode: "commit", commit: head },
    { mode: "unpushed" },
  ]) {
    const first = await call("files", q);
    assert.equal(first.status, 200);
    await write("seed.txt", "index changes\n");
    g("add", "seed.txt");
    await write("seed.txt", "worktree changes\n");
    await write("untracked.txt", "new\n");
    const next = await call("files", { ...q, have: first.body.fingerprint });
    assert.equal(next.status, 200);
    assert.equal(next.body.unchanged, true);
  }
  assert.equal(status.mock.calls.length, 0);
  status.mockRestore();
  const q = { mode: "ref", ref: "main", target: "worktree" };
  const before = await call("files", q);
  await write("seed.txt", "new worktree changes\n");
  const after = await call("files", { ...q, have: before.body.fingerprint });
  assert.notEqual(after.body.fingerprint, before.body.fingerprint);
});

test("fork PR uses gh's repository, verifies head identity, cleans refs, and disables auto maintenance", async () => {
  const { repo, g, write, call } = await fixture();
  const root = g("rev-parse", "HEAD"),
    upstream = join(home, `upstream-${counter}.git`),
    origin = join(home, `fork-${counter}.git`);
  for (const remote of [upstream, origin])
    execFileSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
  g("remote", "add", "origin", origin);
  g("push", "-q", "origin", "main");
  g("push", "-q", upstream, "main");
  await write("upstream-pr.txt", "correct upstream PR\n");
  g("add", ".");
  g("commit", "-qm", "upstream PR");
  g("push", "-q", upstream, "HEAD:refs/pull/1/head");
  const head = g("rev-parse", "HEAD");
  g("reset", "--hard", root);
  await write("fork-pr.txt", "wrong same-number fork PR\n");
  g("add", ".");
  g("commit", "-qm", "fork PR");
  g("push", "-q", "origin", "HEAD:refs/pull/1/head");
  g("reset", "--hard", root);
  await fakeGh(repo, upstream);
  const bin = join(repo, ".git/test-bin"),
    log = join(repo, ".git/git-args");
  const realGit = execFileSync("which", ["git"], {
    env: { ...process.env, PATH: original.PATH },
  })
    .toString()
    .trim();
  await writeFile(
    join(bin, "git"),
    `#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');const r=cp.spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status||0);`,
  );
  await chmod(join(bin, "git"), 0o755);
  const first = await call("files", { mode: "pr", pr: "1" });
  assert.equal(first.status, 200);
  assert.deepEqual(
    first.body.files.map((f: any) => f.path),
    ["upstream-pr.txt"],
  );
  assert.equal(g("for-each-ref", "--format=%(refname)", "refs/diffview/"), "");
  // Metadata/ref race: reject the mismatching fetch and use the authoritative remote diff.
  await writeFile(join(repo, ".git/gh-head-override"), "a".repeat(40));
  await writeFile(
    join(repo, ".git/gh-diff"),
    `diff --git a/race.txt b/race.txt\nnew file mode 100644\n--- /dev/null\n+++ b/race.txt\n@@ -0,0 +1 @@\n+server fallback\n`,
  );
  const raced = await call("files", { mode: "pr", pr: "1", refresh: "1" });
  assert.equal(raced.status, 200);
  assert.equal(raced.body.files[0].path, "race.txt");
  assert.equal(g("for-each-ref", "--format=%(refname)", "refs/diffview/"), "");
  const lib = await import("../src/lib/git");
  const now = Date.now();
  g("update-ref", "refs/diffview/tmp/1-old/base", head);
  g("update-ref", `refs/diffview/tmp/${now}-active/head`, head);
  g("update-ref", "refs/heads/user-keep", root);
  await lib.pruneReviewRefs(repo, now);
  assert.equal(
    g("for-each-ref", "--format=%(refname)", "refs/diffview/tmp/1-old"),
    "",
  );
  assert.equal(g("rev-parse", `refs/diffview/tmp/${now}-active/head`), head);
  assert.equal(g("rev-parse", "refs/heads/user-keep"), root);
  await lib.git(repo, ["status", "--porcelain"]);
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  const fetches = calls.filter((args) => args.includes("fetch"));
  assert.ok(fetches.length >= 2);
  for (const args of fetches) {
    assert.ok(args.includes("gc.auto=0"));
    assert.ok(args.includes("maintenance.auto=false"));
    assert.ok(args.includes("--no-auto-maintenance"));
  }
}, 15000);

test("5001 changed paths still detect edits to dirty and untracked files", async () => {
  const { repo, write, call } = await fixture();
  await write("seed.txt", "dirty\n");
  for (let start = 0; start < 5000; start += 100)
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        write(`loose-${String(start + i).padStart(5, "0")}.txt`, "before\n"),
      ),
    );
  const first = await call("files");
  assert.equal(first.status, 200);
  assert.equal(first.body.files.length, 5001);
  const initial = await call("events");
  await write("seed.txt", "dirty content changed\n");
  const dirty = await call("events");
  assert.notEqual(dirty.body.fingerprint, initial.body.fingerprint);
  const changed = await call("files", { have: first.body.fingerprint });
  assert.equal(changed.status, 200);
  assert(!changed.body.unchanged);
  assert.match(
    changed.body.page.patches["seed.txt"]?.patch ??
      (await call("patch", { fp: changed.body.fingerprint, path: "seed.txt" }))
        .body.patch,
    /dirty content changed/,
  );
  await write("loose-04999.txt", "untracked content changed\n");
  const loose = await call("events");
  assert.notEqual(loose.body.fingerprint, dirty.body.fingerprint);
  assert.equal(
    (await call("files", { have: changed.body.fingerprint })).body.unchanged,
    undefined,
  );
}, 30000);

for (const setting of ["log", "diff"])
  test(`submodule=${setting}: snapshot, page and explicit patch preserve gitlink paths`, async () => {
    const { repo, g, call } = await fixture();
    const sub = join(repo, "child");
    await mkdir(sub);
    const sg = (...args: string[]) =>
      execFileSync("git", args, { cwd: sub, stdio: "pipe" }).toString().trim();
    sg("init", "-qb", "main");
    sg("config", "user.name", "Test");
    sg("config", "user.email", "test@example.invalid");
    await writeFile(join(sub, "inner.txt"), "one\n");
    sg("add", ".");
    sg("commit", "-qm", "one");
    const from = sg("rev-parse", "HEAD");
    g("update-index", "--add", "--cacheinfo", `160000,${from},child`);
    g("commit", "-qm", "add gitlink");
    await writeFile(join(sub, "inner.txt"), "two\n");
    sg("add", ".");
    sg("commit", "-qm", "two");
    const to = sg("rev-parse", "HEAD");
    g("update-index", "--cacheinfo", `160000,${to},child`);
    g("config", "diff.submodule", setting);
    const index = g("ls-files", "--stage"),
      status = g("status", "--porcelain=v2");
    for (const paged of [false, true]) {
      if (paged) process.env.DIFFVIEW_MAX_FILES = "1";
      // One additional dirty path forces paged mode at the changed-path threshold.
      await writeFile(join(repo, "seed.txt"), "changed\n");
      const q = { filter: "staged", ctx: paged ? "5" : "3" };
      const list = await call("files", q);
      assert.equal(list.status, 200);
      assert.deepEqual(
        list.body.files.map((f: any) => f.path),
        ["child"],
      );
      assert.match(list.body.page.patches.child.patch, /Subproject commit/);
      const page = await call("patches", {
        ...q,
        fp: list.body.fingerprint,
        cursor: "0",
      });
      assert.match(page.body.patches.child.patch, /Subproject commit/);
      const expanded = await call("patch", {
        ...q,
        fp: list.body.fingerprint,
        path: "child",
        anyway: "1",
      });
      assert.match(expanded.body.patch, /Subproject commit/);
      assert(!expanded.body.patch.includes("inner.txt"));
      assert.equal(g("ls-files", "--stage"), index);
    }
    // Only this test's deliberate seed edit changes status; API requests never do.
    await writeFile(join(repo, "seed.txt"), "seed\n");
    assert.equal(g("status", "--porcelain=v2"), status);
  });

test("unborn all mode compares the worktree to the empty tree, not just the index", async () => {
  const { repo, g, write, call } = await fixture();
  g("symbolic-ref", "HEAD", "refs/heads/unborn");
  await write("seed.txt", "staged\n");
  g("add", "seed.txt");
  await write("seed.txt", "unstaged after staging\n");
  const status = g("status", "--porcelain=v2"),
    index = g("ls-files", "--stage");
  for (const paged of [false, true]) {
    if (paged) process.env.DIFFVIEW_MAX_FILES = "1";
    await write("loose.txt", "untracked\n");
    for (const filter of ["all", "staged", "unstaged"]) {
      const q = { filter, ctx: paged ? "5" : "3" };
      const list = await call("files", q);
      assert.equal(list.status, 200);
      assert.match(
        list.body.page.patches["seed.txt"].patch,
        filter === "staged" ? /\+staged/ : /\+unstaged after staging/,
      );
      const expanded = await call("patch", {
        ...q,
        fp: list.body.fingerprint,
        path: "seed.txt",
        unified: "40",
      });
      assert.match(
        expanded.body.patch,
        filter === "staged" ? /\+staged/ : /\+unstaged after staging/,
      );
      if (filter !== "staged")
        assert(list.body.files.some((f: any) => f.path === "loose.txt"));
      assert.equal(g("ls-files", "--stage"), index);
    }
  }
  await rm(join(repo, "loose.txt"));
  assert.equal(g("status", "--porcelain=v2"), status);
});

test("fallback advertises limits, matches spaced names, and rejects context/full-file expansion", async () => {
  const { repo, g, call } = await fixture();
  g("remote", "add", "origin", join(home, "absent-fallback.git"));
  await fakeGh(repo);
  const text =
    "diff --git a/space name.ts b/space name.ts\nindex 1111111..2222222 100644\n--- a/space name.ts\t\n+++ b/space name.ts\t\n@@ -10 +10 @@\n-before\n+after\n";
  await writeFile(join(repo, ".git/gh-diff"), text);
  for (const paged of [false, true]) {
    if (paged)
      vi.spyOn(snapshot, "buildSnapshot").mockRejectedValueOnce(
        new GitError("output_limit"),
      );
    const q = { mode: "pr", pr: "6", ctx: paged ? "5" : "3" };
    const list = await call("files", q);
    assert.equal(list.status, 200);
    assert.equal(list.body.fallback, true);
    assert.deepEqual(
      list.body.files.map((f: any) => f.path),
      ["space name.ts"],
    );
    const normal = await call("patch", {
      ...q,
      fp: list.body.fingerprint,
      path: "space name.ts",
    });
    assert.equal(normal.status, 200);
    assert.match(normal.body.patch, /\+after/);
    for (const extra of [{ unified: "23" }, { anyway: "1" }]) {
      const denied = await call("patch", {
        ...q,
        fp: list.body.fingerprint,
        path: "space name.ts",
        ...extra,
      });
      assert.equal(denied.status, 400);
      assert.equal(denied.body.error, "fallback_context_unavailable");
    }
  }
});

test("PR fetching reuses a matching SSH remote, not a same-repo-name fork or synthetic HTTPS", async () => {
  const { repo, g, write, call } = await fixture();
  const root = g("rev-parse", "HEAD"),
    bare = join(home, `ssh-${counter}.git`);
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", bare]);
  g("push", "-q", bare, "main");
  await write("ssh.txt", "SSH PR\n");
  g("add", ".");
  g("commit", "-qm", "PR");
  g("push", "-q", bare, "HEAD:refs/pull/1/head");
  g("reset", "--hard", root);
  g("remote", "add", "origin", "git@github.com:some-fork/upstream.git");
  g("remote", "add", "upstream", "git@github.com:fixture/upstream.git");
  await fakeGh(repo, bare);
  const bin = join(repo, ".git/test-bin"),
    realGit = execFileSync("which", ["git"], {
      env: { ...process.env, PATH: original.PATH },
    })
      .toString()
      .trim();
  const log = join(repo, ".git/fetch-sources");
  await writeFile(
    join(bin, "git"),
    `#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');let a=process.argv.slice(2);if(a.includes('fetch')){const i=a.indexOf('--');fs.appendFileSync(${JSON.stringify(log)},a[i+1]+'\\n');if(a[i+1]!=='upstream')process.exit(1);a[i+1]=${JSON.stringify(bare)}}const r=cp.spawnSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});process.exit(r.status??1);`,
  );
  await chmod(join(bin, "git"), 0o755);
  const list = await call("files", { mode: "pr", pr: "1" });
  assert.equal(list.status, 200);
  assert.equal(list.body.fallback, false);
  assert.deepEqual(
    list.body.files.map((f: any) => f.path),
    ["ssh.txt"],
  );
  assert.equal((await readFile(log, "utf8")).trim(), "upstream");
  assert.equal(g("for-each-ref", "--format=%(refname)", "refs/diffview/"), "");
  const { remoteRepository, prFetchSource } = await import("../src/lib/git");
  for (const url of [
    "git@github.com:Fixture/Upstream.git",
    "ssh://git@github.com:2222/fixture/upstream.git",
    "https://github.com/fixture/upstream.git",
  ])
    assert.equal(remoteRepository(url), "github.com/fixture/upstream");
  assert.notEqual(
    remoteRepository("git@other.example:fixture/upstream.git"),
    "github.com/fixture/upstream",
  );
  assert.equal(
    await prFetchSource(repo, "https://github.com/elsewhere/other.git"),
    "https://github.com/elsewhere/other.git",
  );
});

test("PR fetch never recurses into initialized submodules or changes their refs/FETCH_HEAD", async () => {
  const { repo, g, call } = await fixture();
  const subSource = join(home, `sub-source-${counter}`),
    subRemote = join(home, `sub-remote-${counter}.git`),
    parentRemote = join(home, `parent-${counter}.git`);
  await mkdir(subSource);
  const run = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
  const sg = (...args: string[]) => run(subSource, ...args);
  sg("init", "-qb", "main");
  sg("config", "user.name", "Test");
  sg("config", "user.email", "test@example.invalid");
  await writeFile(join(subSource, "inner.txt"), "old\n");
  sg("add", ".");
  sg("commit", "-qm", "old");
  const oldSub = sg("rev-parse", "HEAD");
  execFileSync("git", ["clone", "--bare", "-q", subSource, subRemote]);
  g(
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    subRemote,
    "s",
  );
  g("commit", "-qm", "submodule");
  execFileSync("git", ["clone", "--bare", "-q", repo, parentRemote]);
  const sub = join(repo, "s"),
    subGit = g("-C", "s", "rev-parse", "--absolute-git-dir");
  g("config", "fetch.recurseSubmodules", "on-demand");
  run(sub, "config", "fetch.recurseSubmodules", "on-demand");
  run(sub, "config", "fetch.prune", "true");
  await rm(join(subGit, "FETCH_HEAD"), { force: true });
  const before = {
    refs: run(sub, "show-ref"),
    head: run(sub, "rev-parse", "HEAD"),
    index: await readFile(join(subGit, "index")),
  };
  // The missing submodule commit and PR commit are created outside this checkout.
  await writeFile(join(subSource, "inner.txt"), "new\n");
  sg("add", ".");
  sg("commit", "-qm", "new");
  sg("push", "-q", subRemote, "main");
  const newSub = sg("rev-parse", "HEAD");
  assert.throws(() => run(sub, "cat-file", "-e", newSub));
  const author = join(home, `parent-author-${counter}`);
  execFileSync("git", ["clone", "-q", parentRemote, author]);
  run(author, "config", "user.name", "Test");
  run(author, "config", "user.email", "test@example.invalid");
  run(author, "update-index", "--cacheinfo", `160000,${newSub},s`);
  run(author, "commit", "-qm", "move submodule");
  run(author, "push", "-q", parentRemote, "HEAD:refs/pull/1/head");
  await fakeGh(repo, parentRemote);
  const list = await call("files", { mode: "pr", pr: "1" });
  assert.equal(list.status, 200);
  assert.equal(list.body.fallback, false);
  assert.deepEqual(
    list.body.files.map((f: any) => f.path),
    ["s"],
  );
  assert.match(
    list.body.page.patches.s.patch,
    new RegExp("Subproject commit " + newSub),
  );
  assert.equal(run(sub, "rev-parse", "origin/main"), oldSub);
  assert.equal(run(sub, "show-ref"), before.refs);
  assert.equal(run(sub, "rev-parse", "HEAD"), before.head);
  assert.deepEqual(await readFile(join(subGit, "index")), before.index);
  await assert.rejects(readFile(join(subGit, "FETCH_HEAD")), {
    code: "ENOENT",
  });
  assert.equal(g("for-each-ref", "--format=%(refname)", "refs/diffview/"), "");
}, 30000);
