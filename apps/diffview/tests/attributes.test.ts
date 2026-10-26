import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attributeSource,
  categoryFromAttributes,
  classifyFiles,
  summarizeFiles,
} from "../src/lib/attributes";
import {
  comparison,
  files,
  git,
  traceStore,
  type FileEntry,
  type Mode,
  type Trace,
} from "../src/lib/git";

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "diffview-attributes-test-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Diffview Test"]);
  await git(repo, ["config", "user.email", "test@example.invalid"]);
  return { root, repo };
}

async function classified(repo: string, mode: Mode) {
  const resolved = await comparison(repo, mode);
  return classifyFiles(repo, mode, resolved, await files(repo, mode, resolved));
}

test("custom categories override standard Linguist attributes", () => {
  assert.equal(
    categoryFromAttributes({
      "diffview-category": "test",
      "linguist-generated": "set",
    }),
    "test",
  );
  assert.equal(
    categoryFromAttributes({ "linguist-generated": "true" }),
    "generated",
  );
  assert.equal(
    categoryFromAttributes({ "linguist-vendored": "set" }),
    "vendored",
  );
  assert.equal(
    categoryFromAttributes({ "linguist-documentation": "set" }),
    "documentation",
  );
  assert.equal(
    categoryFromAttributes({
      "diffview-category": "unknown",
      "linguist-generated": "unset",
    }),
    "primary",
  );
});

test("every comparison mode selects attributes from its actual right side", () => {
  const revision = { args: [], to: "target" };
  assert.deepEqual(
    attributeSource({ mode: "uncommitted", filter: "all" }, revision),
    { kind: "worktree" },
  );
  assert.deepEqual(
    attributeSource({ mode: "uncommitted", filter: "unstaged" }, revision),
    { kind: "worktree" },
  );
  assert.deepEqual(
    attributeSource({ mode: "uncommitted", filter: "staged" }, revision),
    { kind: "index" },
  );
  assert.deepEqual(
    attributeSource({ mode: "ref", ref: "main", target: "worktree" }, revision),
    { kind: "worktree" },
  );
  for (const mode of [
    { mode: "branch", base: "main" },
    { mode: "ref", ref: "main", target: "head" },
    { mode: "commit", commit: "target" },
    { mode: "unpushed" },
    { mode: "pr", pr: "1" },
  ] as Mode[])
    assert.deepEqual(attributeSource(mode, revision), {
      kind: "revision",
      revision: "target",
    });
  assert.deepEqual(
    attributeSource({ mode: "pr", pr: "1" }, { args: [], fallback: "" }),
    { kind: "unavailable" },
  );
});

test("nested attributes and NUL-delimited special paths classify in one batch", async () => {
  const { root, repo } = await repository();
  try {
    await mkdir(join(repo, "nested"));
    await writeFile(
      join(repo, ".gitattributes"),
      [
        "*.gen linguist-generated",
        "*.vend linguist-vendored",
        "docs/** linguist-documentation",
        "*.lock linguist-generated diffview-category=lockfile",
        "override.gen diffview-category=test",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(repo, "nested/.gitattributes"),
      "*.txt diffview-category=fixture\n",
    );
    for (const path of [
      "ordinary.ts",
      "built.gen",
      "third.vend",
      "deps.lock",
      "override.gen",
      "docs/guide.md",
      "nested/sp ace\tline\nname.txt",
    ]) {
      await mkdir(join(repo, path).split("/").slice(0, -1).join("/"), {
        recursive: true,
      });
      await writeFile(join(repo, path), "before\n");
    }
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    for (const path of [
      "ordinary.ts",
      "built.gen",
      "third.vend",
      "deps.lock",
      "override.gen",
      "docs/guide.md",
      "nested/sp ace\tline\nname.txt",
    ])
      await writeFile(join(repo, path), "after\n");

    const list = await classified(repo, {
      mode: "uncommitted",
      filter: "all",
    });
    assert.deepEqual(
      Object.fromEntries(list.map((file) => [file.path, file.category])),
      {
        "built.gen": "generated",
        "deps.lock": "lockfile",
        "docs/guide.md": "documentation",
        "nested/sp ace\tline\nname.txt": "fixture",
        "ordinary.ts": "primary",
        "override.gen": "test",
        "third.vend": "vendored",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("staged uses index attributes while all and unstaged use the working tree", async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(
      join(repo, ".gitattributes"),
      "*.ts diffview-category=test\n",
    );
    await writeFile(join(repo, "code.ts"), "before\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    await writeFile(join(repo, "code.ts"), "staged\n");
    await writeFile(
      join(repo, ".gitattributes"),
      "*.ts diffview-category=lockfile\n",
    );
    await git(repo, ["add", "-A"]);
    await writeFile(join(repo, "code.ts"), "worktree\n");
    await writeFile(
      join(repo, ".gitattributes"),
      "*.ts diffview-category=fixture\n",
    );

    const staged = await classified(repo, {
      mode: "uncommitted",
      filter: "staged",
    });
    const all = await classified(repo, { mode: "uncommitted", filter: "all" });
    const unstaged = await classified(repo, {
      mode: "uncommitted",
      filter: "unstaged",
    });
    assert.equal(
      staged.find((file) => file.path === "code.ts")?.category,
      "lockfile",
    );
    assert.equal(
      all.find((file) => file.path === "code.ts")?.category,
      "fixture",
    );
    assert.equal(
      unstaged.find((file) => file.path === "code.ts")?.category,
      "fixture",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical target attributes ignore unrelated current working-tree rules", async () => {
  const { root, repo } = await repository();
  try {
    await mkdir(join(repo, "src"));
    await writeFile(
      join(repo, ".gitattributes"),
      "src/*.ts diffview-category=test\n",
    );
    await writeFile(join(repo, "src/code.ts"), "one\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "first"]);
    const first = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await writeFile(
      join(repo, ".gitattributes"),
      "src/*.ts diffview-category=generated\n",
    );
    await writeFile(join(repo, "src/code.ts"), "two\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "second"]);
    const second = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const realIndex = await git(repo, ["ls-files", "--stage"]);
    await writeFile(
      join(repo, ".gitattributes"),
      "src/*.ts diffview-category=vendored\n",
    );

    const mode: Mode = {
      mode: "ref",
      ref: first,
      dots: "two",
      target: "head",
    };
    const resolved = await comparison(repo, mode);
    assert.equal(resolved.to, second);
    const list = await classifyFiles(
      repo,
      mode,
      resolved,
      await files(repo, mode, resolved),
    );
    assert.equal(
      list.find((file) => file.path === "src/code.ts")?.category,
      "generated",
    );
    assert.equal(await git(repo, ["ls-files", "--stage"]), realIndex);

    const unavailable = await classifyFiles(
      repo,
      { mode: "commit", commit: "missing" },
      { args: [], to: "0000000000000000000000000000000000000000" },
      [list.find((file) => file.path === "src/code.ts")!],
    );
    assert.equal(
      unavailable[0].category,
      "primary",
      "an unavailable target must not borrow vendored from the worktree",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleted paths use target rules and renames use their destination path", async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(
      join(repo, ".gitattributes"),
      "deleted.test diffview-category=test\nrenamed.fixture diffview-category=fixture\n",
    );
    await writeFile(join(repo, "deleted.test"), "deleted content\n");
    await writeFile(join(repo, "old.name"), "rename source\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    await rm(join(repo, "deleted.test"));
    await rename(join(repo, "old.name"), join(repo, "renamed.fixture"));
    await git(repo, ["add", "-A"]);
    const list = await classified(repo, { mode: "uncommitted", filter: "all" });
    assert.equal(
      list.find((file) => file.path === "deleted.test")?.category,
      "test",
    );
    const renamed = list.find((file) => file.path === "renamed.fixture");
    assert.equal(renamed?.oldPath, "old.name");
    assert.equal(renamed?.category, "fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repositories without attributes stay primary and totals retain all changes", async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(join(repo, "plain.ts"), "before\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    await writeFile(join(repo, "plain.ts"), "after\n");
    const list = await classified(repo, { mode: "uncommitted", filter: "all" });
    assert.equal(list[0].category, "primary");
    const synthetic: FileEntry[] = [
      { ...list[0], added: 2, deleted: 1 },
      {
        ...list[0],
        path: "generated.ts",
        category: "generated",
        added: 20,
        deleted: 10,
      },
      { ...list[0], path: "test.ts", category: "test", added: 4, deleted: 3 },
    ];
    assert.deepEqual(summarizeFiles(synthetic), {
      all: { files: 3, added: 26, deleted: 14 },
      primary: { files: 1, added: 2, deleted: 1 },
      supporting: { files: 2, added: 24, deleted: 13 },
      categories: {
        generated: { files: 1, added: 20, deleted: 10 },
        lockfile: { files: 0, added: 0, deleted: 0 },
        test: { files: 1, added: 4, deleted: 3 },
        fixture: { files: 0, added: 0, deleted: 0 },
        snapshot: { files: 0, added: 0, deleted: 0 },
        vendored: { files: 0, added: 0, deleted: 0 },
        documentation: { files: 0, added: 0, deleted: 0 },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("large path lists are classified in bounded batches, not one process per file", async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(
      join(repo, ".gitattributes"),
      "*.generated linguist-generated\n",
    );
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "attributes"]);
    const entries: FileEntry[] = Array.from({ length: 9000 }, (_, index) => ({
      path: `many/file-${index}.generated`,
      status: "M",
      added: 1,
      deleted: 1,
      binary: false,
      collapsed: false,
    }));
    const trace: Trace = {
      spawns: 0,
      spawnMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
    const result = await traceStore.run(trace, () =>
      classifyFiles(
        repo,
        { mode: "uncommitted", filter: "all" },
        { args: ["HEAD"] },
        entries,
      ),
    );
    assert.ok(result.every((file) => file.category === "generated"));
    assert.equal(trace.spawns, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
