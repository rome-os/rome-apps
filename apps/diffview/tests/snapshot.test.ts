import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rename, mkdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { files, fingerprintInfo, git, patch, type Mode } from "../src/lib/git";
import {
  buildSnapshot,
  parseDiffText,
  patchData,
  pageOf,
  buildPage,
  isPageable,
  toEntry,
} from "../src/lib/snapshot";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "diffview-snap-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "t"]);
  await git(repo, ["config", "user.email", "t@example.invalid"]);
  await writeFile(join(repo, "plain.txt"), "a\nb\nc\nd\ne\nf\ng\nh\n");
  await writeFile(join(repo, "sp ace.txt"), "x\ny\n");
  await writeFile(join(repo, "文件.md"), "一\n二\n");
  await writeFile(join(repo, "gone.txt"), "bye\n");
  await writeFile(join(repo, "old.txt"), "l1\nl2\nl3\nl4\n");
  await writeFile(join(repo, "bin.dat"), Buffer.from([0, 1, 2]));
  await writeFile(join(repo, "run.sh"), "echo hi\n");
  await git(repo, ["add", "--", "."]);
  await git(repo, ["commit", "-m", "init"]);
  await writeFile(join(repo, "plain.txt"), "a\nb\nC\nd\ne\nf\nG\nh\ni\n");
  await writeFile(join(repo, "sp ace.txt"), "x\nY\n");
  await writeFile(join(repo, "文件.md"), "一\n三\n");
  await rm(join(repo, "gone.txt"));
  await rename(join(repo, "old.txt"), join(repo, "new.txt"));
  await writeFile(join(repo, "new.txt"), "l1\nl2\nL3\nl4\nl5\n");
  await writeFile(join(repo, "bin.dat"), Buffer.from([0, 9, 9, 9]));
  await chmod(join(repo, "run.sh"), 0o755);
  await git(repo, ["add", "old.txt", "new.txt", "gone.txt"]).catch(() => {});
  await writeFile(join(repo, "untracked.txt"), "u1\nu2\n");
  await writeFile(join(repo, "untracked.bin"), Buffer.from([0, 5]));
  return { root, repo };
}
const MODES: Mode[] = [
  { mode: "uncommitted", filter: "all" },
  { mode: "uncommitted", filter: "staged" },
  { mode: "uncommitted", filter: "unstaged" },
];

test("one-diff snapshot matches the per-file path for every file and mode", async () => {
  const { root, repo } = await fixture();
  try {
    for (const m of MODES) {
      const info = await fingerprintInfo(repo);
      const snap = await buildSnapshot(repo, m, 3, info);
      const legacy = await files(repo, m);
      assert.deepEqual(
        snap.files.map((f) => f.path),
        legacy.map((f) => f.path),
        JSON.stringify(m),
      );
      for (const l of legacy) {
        const s = snap.files.find((f) => f.path === l.path)!;
        for (const k of [
          "status",
          "added",
          "deleted",
          "binary",
          "oldPath",
          "untracked",
        ] as const)
          assert.equal(
            s[k] ?? null,
            l[k] ?? null,
            `${m.filter} ${l.path} ${k}`,
          );
        if (l.binary || l.untracked) continue;
        const old = await patch(repo, m, l.path, 3, false, l);
        const now = patchData(s, false);
        assert.equal(now.patch, old.patch, `${m.filter} ${l.path} patch text`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("line totals come from the working tree and handle deletions", async () => {
  const { root, repo } = await fixture();
  try {
    const snap = await buildSnapshot(
      repo,
      { mode: "uncommitted", filter: "all" },
      3,
      await fingerprintInfo(repo),
    );
    const by = Object.fromEntries(snap.files.map((f) => [f.path, f]));
    assert.equal(by["plain.txt"].totalLines, 9);
    assert.equal(by["new.txt"].totalLines, 5);
    assert.equal(by["gone.txt"].totalLines, 0);
    assert.equal(by["untracked.txt"].totalLines, 2);
    assert.equal(by["bin.dat"].binary, true);
    assert.equal(by["untracked.bin"].binary, true);
    assert.equal(by["new.txt"].oldPath, "old.txt");
    assert.equal(by["sp ace.txt"].status, "M");
    assert.equal(by["文件.md"].status, "M");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blob-side comparisons count lines with one batch", async () => {
  const { root, repo } = await fixture();
  try {
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "second"]);
    const snap = await buildSnapshot(
      repo,
      { mode: "ref", ref: "HEAD~1", dots: "two", target: "head" },
      3,
      await fingerprintInfo(repo),
    );
    const by = Object.fromEntries(snap.files.map((f) => [f.path, f]));
    assert.equal(by["plain.txt"].totalLines, 9);
    assert.equal(by["new.txt"].totalLines, 5);
    assert.equal(by["gone.txt"].totalLines, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parser reads names with spaces, renames, new, deleted and binary blocks", () => {
  const text = [
    "diff --git a/old.txt b/new.txt",
    "similarity index 80%",
    "rename from old.txt",
    "rename to new.txt",
    "index 111..222 100644",
    "--- a/old.txt",
    "+++ b/new.txt",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-gone",
    "+here",
    "diff --git a/sp ace.txt b/sp ace.txt",
    "new file mode 100644",
    "index 0000000..333",
    "--- /dev/null",
    "+++ b/sp ace.txt",
    "@@ -0,0 +1 @@",
    "+hello",
    "diff --git a/bin.dat b/bin.dat",
    "index 444..555 100644",
    "Binary files a/bin.dat and b/bin.dat differ",
    "",
  ].join("\n");
  const { entries } = parseDiffText(text);
  assert.deepEqual(
    entries.map((e) => [
      e.path,
      e.oldPath,
      e.status,
      e.added,
      e.deleted,
      e.binary,
    ]),
    [
      ["new.txt", "old.txt", "R", 1, 1, false],
      ["sp ace.txt", undefined, "A", 1, 0, false],
      ["bin.dat", undefined, "M", 0, 0, true],
    ],
  );
});

test("pages hold only text diffs, in order, with every cap applied", async () => {
  const { root, repo } = await fixture();
  try {
    await writeFile(join(repo, "huge.txt"), "line\n".repeat(30000));
    const snap = await buildSnapshot(
      repo,
      { mode: "uncommitted", filter: "all" },
      3,
      await fingerprintInfo(repo),
    );
    const eligible = snap.files.filter(isPageable);
    assert.ok(eligible.every((f) => !f.binary && !f.collapsed));
    assert.ok(!eligible.some((f) => f.path === "bin.dat"));
    assert.ok(!eligible.some((f) => f.path === "huge.txt")); // collapsed: loads on request
    const page = pageOf(eligible, 0);
    assert.equal(page.end, eligible.length);
    assert.ok(page.patches["plain.txt"].patch.includes("@@"));
    assert.equal(toEntry(snap.files[0]).patch, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a diff too large to hold is paged by path, never by file request", async () => {
  const { root, repo } = await fixture();
  try {
    for (const m of MODES) {
      const info = await fingerprintInfo(repo);
      const snap = await buildSnapshot(repo, m, 3, info);
      const list = (await files(repo, m)).filter(isPageable);
      const page = await buildPage(repo, m, 3, info, list);
      for (const f of page) {
        const want = snap.files.find((x) => x.path === f.path)!;
        assert.equal(f.patch, want.patch, `${m.filter} ${f.path} patch`);
        assert.equal(
          f.totalLines,
          want.totalLines,
          `${m.filter} ${f.path} lines`,
        );
      }
      assert.deepEqual(
        page.map((f) => f.path).sort(),
        list.map((f) => f.path).sort(),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
