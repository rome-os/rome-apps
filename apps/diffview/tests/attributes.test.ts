import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attributeSource,
  categoryForPath,
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

test("standard attributes and conservative path rules have stable precedence", () => {
  assert.equal(
    categoryForPath("pnpm-lock.yaml", { "linguist-vendored": "set" }),
    "vendored",
  );
  assert.equal(
    categoryForPath("pnpm-lock.yaml", { "linguist-documentation": "true" }),
    "documentation",
  );
  assert.equal(
    categoryForPath("pnpm-lock.yaml", { "linguist-generated": "set" }),
    "lockfile",
  );
  assert.equal(
    categoryForPath("tests/output.snap", { "linguist-generated": "true" }),
    "generated",
  );
  assert.equal(
    categoryForPath("tests/output.snap", { "linguist-generated": "false" }),
    "snapshot",
  );
  assert.equal(categoryForPath("fixtures/example.test.ts"), "fixture");
  assert.equal(categoryForPath("src/example.spec.tsx"), "test");
  assert.equal(categoryForPath("src/example.ts"), "primary");
});

test("ambiguous names stay primary and legacy custom attributes are ignored", async () => {
  for (const path of [
    "src/contest.ts",
    "src/locksmith.ts",
    "src/generated.ts",
    "vendor/client.ts",
    "docs/readme.md",
    "README.md",
    "dist/bundle.js",
    "data.json",
  ])
    assert.equal(categoryForPath(path), "primary", path);

  const { root, repo } = await repository();
  try {
    await writeFile(
      join(repo, ".gitattributes"),
      "ordinary.ts diffview-category=test\n",
    );
    await writeFile(join(repo, "ordinary.ts"), "before\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    await writeFile(join(repo, "ordinary.ts"), "after\n");
    const list = await classified(repo, { mode: "uncommitted", filter: "all" });
    assert.equal(
      list.find((file) => file.path === "ordinary.ts")?.category,
      "primary",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
        "pnpm-lock.yaml linguist-generated",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(repo, "nested/.gitattributes"),
      "*.txt linguist-documentation\n",
    );
    for (const path of [
      "ordinary.ts",
      "built.gen",
      "third.vend",
      "pnpm-lock.yaml",
      "docs/guide.md",
      "nested/sp ace\tline\nname.txt",
      "tests/unit.test.ts",
      "fixtures/input.json",
      "__snapshots__/view.snap",
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
      "pnpm-lock.yaml",
      "docs/guide.md",
      "nested/sp ace\tline\nname.txt",
      "tests/unit.test.ts",
      "fixtures/input.json",
      "__snapshots__/view.snap",
    ])
      await writeFile(join(repo, path), "after\n");

    const list = await classified(repo, {
      mode: "uncommitted",
      filter: "all",
    });
    assert.deepEqual(
      Object.fromEntries(list.map((file) => [file.path, file.category])),
      {
        "__snapshots__/view.snap": "snapshot",
        "built.gen": "generated",
        "docs/guide.md": "documentation",
        "fixtures/input.json": "fixture",
        "nested/sp ace\tline\nname.txt": "documentation",
        "ordinary.ts": "primary",
        "pnpm-lock.yaml": "lockfile",
        "tests/unit.test.ts": "test",
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
      "*.ts linguist-documentation\n",
    );
    await writeFile(join(repo, "code.ts"), "before\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    await writeFile(join(repo, "code.ts"), "staged\n");
    await writeFile(join(repo, ".gitattributes"), "*.ts linguist-generated\n");
    await git(repo, ["add", "-A"]);
    await writeFile(join(repo, "code.ts"), "worktree\n");
    await writeFile(join(repo, ".gitattributes"), "*.ts linguist-vendored\n");

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
      "generated",
    );
    assert.equal(
      all.find((file) => file.path === "code.ts")?.category,
      "vendored",
    );
    assert.equal(
      unstaged.find((file) => file.path === "code.ts")?.category,
      "vendored",
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
      "src/*.ts linguist-documentation\n",
    );
    await writeFile(join(repo, "src/code.ts"), "one\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "first"]);
    const first = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await writeFile(
      join(repo, ".gitattributes"),
      "src/*.ts linguist-generated\n",
    );
    await writeFile(join(repo, "src/code.ts"), "two\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "second"]);
    const second = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const realIndex = await git(repo, ["ls-files", "--stage"]);
    await writeFile(
      join(repo, ".gitattributes"),
      "src/*.ts linguist-vendored\n",
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

test("deleted paths and rename destinations use conservative path rules", async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(join(repo, "deleted.test.ts"), "deleted content\n");
    await writeFile(join(repo, "old.name"), "rename source\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "base"]);
    await rm(join(repo, "deleted.test.ts"));
    await mkdir(join(repo, "fixtures"));
    await rename(join(repo, "old.name"), join(repo, "fixtures/renamed.txt"));
    await git(repo, ["add", "-A"]);
    const list = await classified(repo, { mode: "uncommitted", filter: "all" });
    assert.equal(
      list.find((file) => file.path === "deleted.test.ts")?.category,
      "test",
    );
    const renamed = list.find((file) => file.path === "fixtures/renamed.txt");
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
