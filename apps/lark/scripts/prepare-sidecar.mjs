import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const root = resolve(".");
const version = "1.0.98";
const commit = "017b19a793ad71794a02887ede04757f3d82e10d";
const sourceSha =
  "d12af6463f83706c449b4e940e02929b73aa9692bc75944589a8bfdc35f56807";
const goSha =
  "65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40";
const binary = join(root, "vendor/lark-cli-sidecar-linux-amd64");
const metadata = join(root, "vendor/sidecar-build.json");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const manifest = JSON.parse(await readFile(metadata, "utf8"));
  if (
    manifest.version === version &&
    manifest.commit === commit &&
    manifest.buildVcs === false &&
    sha(await readFile(binary)) === manifest.sha256
  )
    process.exit(0);
} catch {}
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Sidecar build currently supports Linux x64 only");
const cache = join(root, ".build/sidecar");
await mkdir(cache, { recursive: true });
await mkdir(join(root, "vendor"), { recursive: true });
async function archive(url, path, expected) {
  try {
    if (sha(await readFile(path)) === expected) return;
  } catch {}
  const response = await fetch(url);
  if (!response.ok) throw new Error("Pinned dependency download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected)
    throw new Error("Pinned dependency checksum mismatch");
  await writeFile(path, bytes);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128000,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `Sidecar build failed: ${command}\n${String(result.stderr || result.error || "").slice(-3000)}`,
    );
}
const go = join(cache, "go/bin/go");
try {
  await access(go);
} catch {
  const path = join(cache, "go.tar.gz");
  await archive("https://go.dev/dl/go1.27.3.linux-amd64.tar.gz", path, goSha);
  run("tar", ["-xzf", path, "-C", cache]);
}
const source = join(cache, "source");
await mkdir(source, { recursive: true });
const tar = join(cache, "cli.tar.gz");
await archive(
  `https://codeload.github.com/larksuite/cli/tar.gz/${commit}`,
  tar,
  sourceSha,
);
run("tar", ["-xzf", tar, "--strip-components=1", "-C", source]);
const home = join(cache, "home");
await mkdir(home, { recursive: true });
run(
  go,
  [
    "build",
    "-mod=readonly",
    "-trimpath",
    "-buildvcs=false",
    "-tags",
    "authsidecar",
    "-ldflags",
    `-s -w -X github.com/larksuite/cli/internal/build.Version=${version} -X github.com/larksuite/cli/internal/build.Date=2026-10-13`,
    "-o",
    binary,
    ".",
  ],
  {
    cwd: source,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      GOPATH: join(cache, "gopath"),
      GOTOOLCHAIN: "local",
      CGO_ENABLED: "0",
      GOMAXPROCS: "2",
    },
  },
);
await copyFile(
  join(source, "LICENSE"),
  join(root, "vendor/LICENSE.larksuite-cli"),
);
await writeFile(
  metadata,
  JSON.stringify(
    {
      version,
      commit,
      tags: "authsidecar",
      toolchain: "go1.27.3",
      buildVcs: false,
      platform: "linux-amd64",
      sourceSha256: sourceSha,
      sha256: sha(await readFile(binary)),
    },
    null,
    2,
  ) + "\n",
);
