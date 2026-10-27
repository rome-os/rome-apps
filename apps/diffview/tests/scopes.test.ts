import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  git,
  files,
  patch,
  sha,
  tracking,
  comparison,
  history,
  GitError,
} from "../src/lib/git";
import { normalizeMode } from "../src/shared/mode";
import { comparisonIdentity, worktreeSide } from "../src/shared/comparison";
import { pickChatState } from "../src/shared/prefs";

async function fixture(
  run: (
    repo: string,
    commit: (path: string, body: string) => Promise<string>,
  ) => Promise<void>,
) {
  const repo = await mkdtemp(join(tmpdir(), "diffview-scopes-"));
  try {
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.name", "Diff Test"]);
    await git(repo, ["config", "user.email", "test@example.invalid"]);
    const commit = async (path: string, body: string) => {
      await writeFile(join(repo, path), body);
      await git(repo, ["add", "--", path]);
      await git(repo, ["commit", "-m", `change ${path}`]);
      return sha(repo, "HEAD");
    };
    await run(repo, commit);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}
const code = (expected: string) => (error: unknown) =>
  error instanceof GitError && error.code === expected;
async function upstream(repo: string, commit: string) {
  await git(repo, [
    "remote",
    "add",
    "origin",
    "/nonexistent/diffview-test-remote",
  ]);
  await git(repo, ["update-ref", "refs/remotes/origin/main", commit]);
  await git(repo, ["config", "branch.main.remote", "origin"]);
  await git(repo, ["config", "branch.main.merge", "refs/heads/main"]);
}

test("new comparison modes survive URL normalization and conversation persistence without inactive parameters", () => {
  const state = normalizeMode({ mode: "commit", commit: "abc123" });
  assert.equal(state.commit, "abc123");
  assert.equal(pickChatState(state).mode, "commit");
  assert.equal(pickChatState(state).commit, "abc123");
  assert.equal(normalizeMode({ mode: "unpushed" }).mode, "unpushed");
  assert.deepEqual(
    comparisonIdentity({ mode: "unpushed", ref: "wrong", target: "worktree" }),
    { mode: "unpushed" },
  );
  assert.notDeepEqual(
    comparisonIdentity({ mode: "commit", commit: "abc" }),
    comparisonIdentity({ mode: "commit", commit: "def" }),
  );
});

test("unpushed excludes staged, unstaged and untracked changes, never fetches, and does not touch the index", async () =>
  fixture(async (repo, commit) => {
    const initial = await commit("initial.txt", "initial\n");
    await upstream(repo, initial);
    await commit("local.txt", "local commit\n");
    await writeFile(join(repo, "initial.txt"), "staged\n");
    await git(repo, ["add", "--", "initial.txt"]);
    await writeFile(join(repo, "initial.txt"), "unstaged\n");
    await writeFile(join(repo, "loose.txt"), "untracked\n");
    const index = await git(repo, ["ls-files", "--stage"]);
    const info = await tracking(repo);
    assert.equal(info.state, "ready");
    assert.equal(info.branch, "main");
    assert.equal(info.upstream, "origin/main");
    assert.equal(info.ahead, 1);
    assert.equal(info.behind, 0);
    assert.deepEqual(
      (await files(repo, { mode: "unpushed" })).map((f) => f.path),
      ["local.txt"],
    );
    assert.match(
      (await patch(repo, { mode: "unpushed" }, "local.txt")).patch,
      /\+local commit/,
    );
    assert.equal(await git(repo, ["ls-files", "--stage"]), index);
  }));

test("tracking distinguishes unborn, no upstream, gone upstream and detached HEAD, without default-base fallback", async () =>
  fixture(async (repo, commit) => {
    assert.equal((await tracking(repo)).state, "unborn");
    assert.equal((await tracking(repo)).branch, "main");
    await commit("initial.txt", "initial\n");
    assert.equal((await tracking(repo)).state, "no_upstream");
    assert.equal((await tracking(repo)).branch, "main");
    await assert.rejects(
      comparison(repo, { mode: "unpushed" }),
      code("no_upstream"),
    );
    await upstream(repo, await sha(repo, "HEAD"));
    await git(repo, ["update-ref", "-d", "refs/remotes/origin/main"]);
    assert.equal((await tracking(repo)).state, "upstream_missing");
    await git(repo, ["checkout", "--detach"]);
    assert.equal((await tracking(repo)).state, "detached");
    assert.equal((await tracking(repo)).branch, "");
    await assert.rejects(
      comparison(repo, { mode: "unpushed" }),
      code("detached"),
    );
  }));

for (const branch of ["main", "heads/release"])
  test(`branch/tag collisions preserve exact checkout identity and Unpushed: ${branch}`, async () =>
    fixture(async (repo, commit) => {
      const initial = await commit("initial.txt", "initial\n");
      await upstream(repo, initial);
      if (branch !== "main") {
        await git(repo, ["checkout", "-b", branch]);
        await git(repo, ["config", `branch.${branch}.remote`, "origin"]);
        await git(repo, [
          "config",
          `branch.${branch}.merge`,
          "refs/heads/main",
        ]);
      }
      await git(repo, ["tag", branch]);
      await commit("local.txt", "local commit\n");
      const info = await tracking(repo);
      assert.equal(info.branch, branch);
      assert.equal(info.state, "ready");
      assert.equal(info.upstream, "origin/main");
      assert.equal(info.ahead, 1);
      assert.deepEqual(
        (await files(repo, { mode: "unpushed" })).map((f) => f.path),
        ["local.txt"],
      );
    }));

test("divergence shows only local-side changes; behind-only and pushed branches are empty", async () =>
  fixture(async (repo, commit) => {
    const initial = await commit("initial.txt", "initial\n");
    await upstream(repo, initial);
    const local = await commit("local.txt", "local\n");
    await git(repo, ["checkout", "--detach", initial]);
    const remote = await commit("remote.txt", "remote\n");
    await git(repo, ["checkout", "main"]);
    await git(repo, ["update-ref", "refs/remotes/origin/main", remote]);
    assert.deepEqual(
      [(await tracking(repo)).ahead, (await tracking(repo)).behind],
      [1, 1],
    );
    assert.deepEqual(
      (await files(repo, { mode: "unpushed" })).map((f) => f.path),
      ["local.txt"],
    );
    await git(repo, ["update-ref", "refs/remotes/origin/main", local]);
    assert.equal((await files(repo, { mode: "unpushed" })).length, 0);
    await git(repo, ["reset", "--hard", initial]);
    assert.deepEqual(
      [(await tracking(repo)).ahead, (await tracking(repo)).behind],
      [0, 1],
    );
    assert.equal((await files(repo, { mode: "unpushed" })).length, 0);
  }));

test("single commits include root commits, exclude later dirty files and use the first parent of merge commits", async () =>
  fixture(async (repo, commit) => {
    const initial = await commit("initial.txt", "initial\n");
    assert.deepEqual(
      (await files(repo, { mode: "commit", commit: initial })).map(
        (f) => f.path,
      ),
      ["initial.txt"],
    );
    await git(repo, ["checkout", "-b", "side"]);
    await commit("side.txt", "side\n");
    await git(repo, ["checkout", "main"]);
    await commit("main.txt", "main\n");
    await git(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
    const merge = await sha(repo, "HEAD");
    await writeFile(join(repo, "initial.txt"), "dirty\n");
    const m = { mode: "commit" as const, commit: merge };
    assert.deepEqual(
      (await files(repo, m)).map((f) => f.path),
      ["side.txt"],
    );
    assert.match((await patch(repo, m, "side.txt")).patch, /\+side/);
    await assert.rejects(
      comparison(repo, { mode: "commit", commit: "--help" }),
      code("invalid_ref"),
    );
    await assert.rejects(
      comparison(repo, { mode: "commit", commit: "missing-commit" }),
      code("invalid_ref"),
    );
  }));

test("history has bounded pages, exact hashes/titles/dates, and works on empty repositories", async () =>
  fixture(async (repo, commit) => {
    assert.deepEqual(await history(repo), { commits: [], next: null });
    const first = await commit("one.txt", "one\n");
    for (let i = 0; i < 42; i++)
      await git(repo, ["commit", "--allow-empty", "-m", `标题 ${i}\twith tab`]);
    const page = await history(repo);
    assert.equal(page.commits.length, 40);
    assert.equal(page.next, 40);
    assert.match(page.commits[0].title, /标题 41\twith tab/);
    assert.ok(page.commits[0].timestamp > 0);
    const last = await history(repo, page.next!);
    assert.equal(last.commits.length, 3);
    assert.equal(last.next, null);
    assert.equal(last.commits.at(-1)?.sha, first);
    await assert.rejects(history(repo, -1), code("invalid_cursor"));
  }));

test("opening a local copy is available only for a working-tree right side", () => {
  for (const mode of ["branch", "commit", "pr", "unpushed"] as const)
    assert.equal(worktreeSide({ mode }), false);
  assert.equal(worktreeSide({ mode: "uncommitted", filter: "staged" }), false);
  for (const filter of ["all", "unstaged"])
    assert.equal(worktreeSide({ mode: "uncommitted", filter }), true);
  assert.equal(worktreeSide({ mode: "ref", target: "head" }), false);
  assert.equal(worktreeSide({ mode: "ref", target: "worktree" }), true);
});
