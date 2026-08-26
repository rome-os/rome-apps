import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

function getChannelAttachmentDir(): string {
  const profile = process.env.ROME_PROFILE?.trim() || "default";
  return join(homedir(), ".rome", profile, "memory", "channel-attachments", "stock-daily");
}

export async function preparePdfAttachment(opts: {
  reportId: string;
  reportDate: string;
  sourcePath: string;
}): Promise<string> {
  const dir = getChannelAttachmentDir();
  await mkdir(dir, { recursive: true });
  const fileName = `stock-daily-${safeSegment(opts.reportDate)}-${safeSegment(opts.reportId)}.pdf`;
  const target = join(dir, fileName);
  await copyFile(opts.sourcePath, target);
  return target;
}
