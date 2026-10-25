import { test } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  symlink,
  rename,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRef,
  inside,
  allowedRepo,
  parseNumstat,
  parseRaw,
  diffArgs,
  files,
  patch,
  git,
  sha,
  fingerprint,
  scanRepos,
} from "../src/lib/git.ts";
test("refs reject options/control characters and accept commit expressions", () => {
  for (const r of ["", "-x", "--help", "a\nb", "a\0b", "a\tb", "a b"])
    assert.throws(() => validateRef(r));
  for (const r of ["HEAD~2", "origin/main", "refs/tags/v1", "a;touch"])
    assert.equal(validateRef(r), r);
});
test("path boundary is segment-aware", () => {
  assert(inside("/a/b", "/a/b/c"));
  assert(!inside("/a/b", "/a/bad"));
  assert(!inside("/a/b", "/a/x"));
});
test("NUL numstat handles renames, binary, tabs and newlines", () => {
  const m = parseNumstat(
    "3\t2\tfoo\tbar\n.txt\0-\t-\tbin\0" + "1\t0\t\0old\0new\0",
  );
  assert.equal(m.get("foo\tbar\n.txt")?.added, 3);
  assert(m.get("bin")?.binary);
  assert.equal(m.get("new")?.oldPath, "old");
});
test("raw handles rename pairs", () => {
  assert.deepEqual(
    parseRaw(":100644 100644 a b R100\0old\0new\0:000000 100644 a b A\0file\0"),
    [
      { path: "new", oldPath: "old", status: "R" },
      { path: "file", oldPath: undefined, status: "A" },
    ],
  );
});
test("mode to command mapping", () => {
  assert.deepEqual(diffArgs({ mode: "uncommitted", filter: "all" }), ["HEAD"]);
  assert.deepEqual(diffArgs({ mode: "uncommitted", filter: "staged" }), [
    "--cached",
  ]);
  assert.deepEqual(diffArgs({ mode: "uncommitted", filter: "unstaged" }), []);
  assert.deepEqual(diffArgs({ mode: "branch" }, "abc"), ["abc...HEAD"]);
  assert.deepEqual(diffArgs({ mode: "pr" }, "abc", "def"), ["abc...def"]);
  assert.deepEqual(diffArgs({ mode: "ref", dots: "two" }, "abc"), [
    "abc..HEAD",
  ]);
  assert.deepEqual(diffArgs({ mode: "ref", target: "worktree" }, "abc"), [
    "abc",
  ]);
});
test("real git fixture: allowlist, staged, unstaged, untracked, renamed, binary, branch/ref and fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "diffview-test-"));
  try {
    const repo = join(root, "repo");
    await mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.name", "Diffview Test"]);
    await git(repo, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(repo, "one.txt"), "one\ntwo\n");
    await writeFile(join(repo, "old.txt"), "rename me\n");
    await writeFile(join(repo, "binary.bin"), Buffer.from([0, 1, 2]));
    await git(repo, ["add", "--", "."]);
    await git(repo, ["commit", "-m", "initial"]);
    const base = await sha(repo, "HEAD");
    await git(repo, ["checkout", "-b", "feature"]);
    await writeFile(join(repo, "committed.txt"), "feature\n");
    await git(repo, ["add", "--", "."]);
    await git(repo, ["commit", "-m", "feature"]);
    await rename(join(repo, "old.txt"), join(repo, "new.txt"));
    await writeFile(join(repo, "one.txt"), "staged\ntwo\n");
    await git(repo, ["add", "--", "."]);
    await writeFile(join(repo, "one.txt"), "unstaged\ntwo\n");
    await writeFile(join(repo, "loose.txt"), "untracked\n");
    await writeFile(join(repo, "binary.bin"), Buffer.from([0, 2, 3]));
    assert.equal(await allowedRepo(repo, root), repo);
    await symlink(tmpdir(), join(root, "escape"));
    await assert.rejects(allowedRepo(join(root, "escape"), root));
    await assert.rejects(allowedRepo(root, root));
    assert.equal((await scanRepos(root)).length, 1);
    const all = await files(repo, { mode: "uncommitted", filter: "all" });
    assert(
      all.find(
        (f) =>
          f.path === "new.txt" && f.oldPath === "old.txt" && f.status === "R",
      ),
    );
    assert(all.find((f) => f.path === "binary.bin")?.binary);
    assert(all.find((f) => f.path === "loose.txt")?.untracked);
    assert(
      (await patch(repo, { mode: "uncommitted" }, "loose.txt")).patch.includes(
        "+untracked",
      ),
    );
    assert(
      (await patch(repo, { mode: "uncommitted" }, "one.txt")).patch.includes(
        "+unstaged",
      ),
    );
    const staged = await files(repo, { mode: "uncommitted", filter: "staged" });
    assert(!staged.some((f) => f.untracked));
    assert(
      (
        await patch(repo, { mode: "uncommitted", filter: "staged" }, "one.txt")
      ).patch.includes("+staged"),
    );
    assert(
      (
        await patch(
          repo,
          { mode: "uncommitted", filter: "unstaged" },
          "one.txt",
        )
      ).patch.includes("-staged"),
    );
    assert(
      (await files(repo, { mode: "branch", base: "main" })).some(
        (f) => f.path === "committed.txt",
      ),
    );
    assert(
      (await files(repo, { mode: "ref", ref: base, dots: "two" })).some(
        (f) => f.path === "committed.txt",
      ),
    );
    assert(
      (
        await files(repo, {
          mode: "ref",
          ref: base,
          dots: "three",
          target: "worktree",
        })
      ).some((f) => f.path === "one.txt"),
    );
    await assert.rejects(sha(repo, "--output=/tmp/x"));
    const before = await fingerprint(repo);
    await writeFile(join(repo, "one.txt"), "another\ntwo\n");
    assert.notEqual(await fingerprint(repo), before);
    await symlink("/etc/passwd", join(repo, "outside"));
    await assert.rejects(patch(repo, { mode: "uncommitted" }, "outside"));
    await assert.rejects(patch(repo, { mode: "uncommitted" }, "../etc/passwd"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("viewed identity excludes inactive mode and display parameters", async () => {
  const { comparisonIdentity } = await import("../src/shared/comparison.ts");
  const all = { mode: "uncommitted" as const, filter: "all" };
  assert.deepEqual(
    comparisonIdentity({ ...all, ref: "main", base: "other", dots: "two" }),
    comparisonIdentity(all),
  );
  assert.notDeepEqual(
    comparisonIdentity({ ...all, filter: "staged" }),
    comparisonIdentity(all),
  );
  assert.notDeepEqual(
    comparisonIdentity({ mode: "ref", ref: "main" }),
    comparisonIdentity({ mode: "ref", ref: "HEAD" }),
  );
});

test("compressed tree merges only file-free single-child folder chains", async () => {
  const { compressedTree } = await import("../src/shared/review.ts");
  const file = (path: string) => ({
    path,
    status: "M",
    added: 1,
    deleted: 1,
    binary: false,
    collapsed: false,
  });
  const tree = compressedTree([
    file("a/b/c/one.md"),
    file("a/b/c/two.md"),
    file("x/root.ts"),
    file("x/y/z/deep.ts"),
  ]);
  assert.equal(tree.folders[0].name, "a/b/c");
  assert.equal(tree.folders[0].path, "a/b/c/");
  assert.equal(tree.folders[0].files.length, 2);
  assert.equal(tree.folders[1].name, "x");
  assert.equal(tree.folders[1].folders[0].name, "y/z");
});
test("scroll spy uses ordered item offsets and handles sticky headers", async () => {
  const { activeFileAt } = await import("../src/shared/review.ts");
  const rows = [
    { id: "c", top: 300 },
    { id: "a", top: 0 },
    { id: "b", top: 100 },
  ];
  assert.equal(activeFileAt(rows, 0), "a");
  assert.equal(activeFileAt(rows, 60), "b");
  assert.equal(activeFileAt(rows, 310), "c");
  assert.equal(activeFileAt([], 0), undefined);
});
test("context grows incrementally by twenty and respects the hard cap", async () => {
  const { nextContext } = await import("../src/shared/review.ts");
  assert.equal(nextContext(3, "up"), 23);
  assert.equal(nextContext(23, "down"), 43);
  assert.equal(nextContext(9999), 10000);
  assert.equal(nextContext(3, "all"), 10000);
});

test("controlled item versions include collapse transitions without invalidating blob cache keys", async () => {
  const { reviewItemVersion, activeFileAt } =
    await import("../src/shared/review.ts");
  assert.notEqual(reviewItemVersion(123, false), reviewItemVersion(123, true));
  assert.equal(reviewItemVersion(123, false), 246);
  assert.equal(
    activeFileAt(
      [
        { id: "first", top: 0 },
        { id: "next", top: 44 },
      ],
      0,
      1,
    ),
    "first",
  );
});

import { homeRepo } from "../src/lib/git";
test("home repo: project that is itself a repo wins", () => {
  const repos = [
    { path: "/p/default", lastCommit: 1 },
    { path: "/p/default/a", lastCommit: 9 },
  ];
  assert.equal(homeRepo(repos, "/p/default"), "/p/default");
});
test("home repo: a single repo inside the project is unambiguous", () => {
  const repos = [
    { path: "/p/apps/x" },
    { path: "/p/default/a" },
    { path: "/p/default2/c" },
  ];
  assert.equal(homeRepo(repos, "/p/default"), "/p/default/a");
});
test("home repo: several repos inside a non-repo project are ambiguous", () => {
  const repos = [{ path: "/p/default/a" }, { path: "/p/default/b" }];
  assert.equal(homeRepo(repos, "/p/default"), "");
  assert.equal(homeRepo(repos, "/p/none"), "");
});

import { contentVersion } from "../src/shared/review";
test("a patch's version depends only on its text, so unchanged files keep their cache entries", () => {
  const a = "@@ -1 +1 @@\n-old\n+new\n";
  assert.equal(
    contentVersion(a),
    contentVersion("" + a),
    "same text, same version",
  );
  assert.notEqual(contentVersion(a), contentVersion(a.replace("new", "newer")));
  assert.notEqual(contentVersion(a), contentVersion(a + " "));
  assert.ok(
    Number.isSafeInteger(contentVersion(a) * 2 + 1),
    "fits the version arithmetic",
  );
  assert.ok(contentVersion("") > 0);
});
