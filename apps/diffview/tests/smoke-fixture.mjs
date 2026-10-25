import { mkdir, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
const dir = join(homedir(), ".rome/default/projects/default/diffview-smoke");
await mkdir(dir, { recursive: true });
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status) throw Error(r.stderr);
  return r.stdout;
};
git("init", "-b", "main");
git("config", "user.name", "Diff View Fixture");
git("config", "user.email", "fixture@example.invalid");
await mkdir(join(dir, "src"), { recursive: true });
await writeFile(
  join(dir, "src/main.ts"),
  'export const value = 1;\nexport const label = "before";\n',
);
await writeFile(join(dir, "old.txt"), "rename me\n");
await writeFile(join(dir, "image.bin"), Buffer.from([0, 1, 2]));
git("add", "--", ".");
git("commit", "-m", "Fixture baseline");
git("switch", "-c", "feature");
await writeFile(join(dir, "src/feature.ts"), "export const feature = true;\n");
git("add", "--", ".");
git("commit", "-m", "Fixture branch change");
await rename(join(dir, "old.txt"), join(dir, "renamed.txt"));
await writeFile(
  join(dir, "src/main.ts"),
  'export const value = 2;\nexport const label = "staged";\n',
);
git("add", "--", ".");
await writeFile(
  join(dir, "src/main.ts"),
  'export const value = 3;\nexport const label = "unstaged";\n',
);
await writeFile(join(dir, "notes.md"), "# Review notes\nUntracked content.\n");
await writeFile(join(dir, "package-lock.json"), '{"lockfileVersion": 3}\n');
await writeFile(join(dir, "image.bin"), Buffer.from([0, 3, 4]));
console.log(dir);
