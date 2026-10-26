import { test } from "vitest";
import assert from "node:assert/strict";
import { parserSafePatch, parsePatchFiles } from "../src/shared/patchParser";

test("parser adapter quotes metadata only, retaining exact whitespace and hunk bytes", () => {
  const head =
    "diff --git a/foo  b/foo \nindex 1111111..2222222 100644\n--- a/foo \t\n+++ b/foo \t\n";
  const hunks =
    "@@ -1,2 +1,2 @@\n--- literal removed text \n+++ literal added text \n unchanged \n";
  const text = head + hunks;
  assert(parserSafePatch(text).endsWith(hunks));
  assert.equal(parserSafePatch(parserSafePatch(text)), parserSafePatch(text));
  const file = parsePatchFiles(text, "test", true)[0].files[0];
  assert.equal(file.name, "foo ");
  assert.equal(file.prevName, undefined);
});

test("parser adapter preserves mode-only and quoted control/Unicode names", () => {
  const modes = "diff --git a/foo  b/foo \nold mode 100644\nnew mode 100755\n";
  assert.equal(parsePatchFiles(modes, "test", true)[0].files[0].name, "foo ");
  const quoted =
    'diff --git "a/中文\\nname " "b/中文\\nname "\nold mode 100644\nnew mode 100755\n';
  assert.equal(parserSafePatch(quoted), quoted);
  assert.equal(
    parsePatchFiles(quoted, "test", true)[0].files[0].name,
    "中文\nname ",
  );
});
