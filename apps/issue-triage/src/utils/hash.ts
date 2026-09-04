import { createHash } from "crypto";

/** Stable short signature of an issue's title + body, for de-duplicating re-fires. */
export function contentSignature(title: string, body: string): string {
  return createHash("sha256")
    .update(`${title ?? ""}\n\n${body ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}
