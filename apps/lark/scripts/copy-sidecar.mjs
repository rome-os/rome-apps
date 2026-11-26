import { readFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
const manifest = JSON.parse(
  await readFile("vendor/sidecar-build.json", "utf8"),
);
const binary = "lark-cli-sidecar-linux-amd64";
const bytes = await readFile(`vendor/${binary}`);
if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256)
  throw new Error("Sidecar binary checksum mismatch");
await mkdir("dist/vendor", { recursive: true });
await copyFile(`vendor/${binary}`, `dist/vendor/${binary}`);
await chmod(`dist/vendor/${binary}`, 0o755);
await copyFile("vendor/sidecar-build.json", "dist/vendor/sidecar-build.json");
