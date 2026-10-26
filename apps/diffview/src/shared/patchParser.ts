import { parsePatchFiles as parsePierrePatchFiles } from "@pierre/diffs";
import { quoteDiffPath } from "../lib/patchFormat.js";

const header =
  /^diff --git ("a\/(?:[^"\\]|\\.)*"|a\/.+?) ("b\/(?:[^"\\]|\\.)*"|b\/.+?)$/;
const quote = (path: string) =>
  path.startsWith('"') || path === "/dev/null"
    ? path
    : quoteDiffPath(path, true);

/** Protect pathname whitespace from the pinned parser's trim(), without touching hunks. */
export function parserSafePatch(text: string) {
  return text.replace(
    /^diff --git [^\n]*(?:\n(?!@@|diff --git )[^\n]*)*/gm,
    (metadata) =>
      metadata.replace(/^.*\n|^.+$/gm, (line) => {
        const end = line.endsWith("\n") ? "\n" : "";
        const value = end ? line.slice(0, -1) : line;
        if (value.startsWith("diff --git ")) {
          const match = header.exec(value);
          return match
            ? `diff --git ${quote(match[1])} ${quote(match[2])}${end}`
            : line;
        }
        const match =
          /^(--- |\+\+\+ |rename from |rename to |copy from |copy to )(.*)$/.exec(
            value,
          );
        if (!match) return line;
        // Git uses a tab separator after unquoted ---/+++ names containing spaces.
        const path =
          match[1] === "--- " || match[1] === "+++ "
            ? match[2].split("\t")[0]
            : match[2];
        return match[1] + quote(path) + end;
      }),
  );
}

export function parsePatchFiles(
  ...args: Parameters<typeof parsePierrePatchFiles>
) {
  return parsePierrePatchFiles(parserSafePatch(args[0]), args[1], args[2]);
}
