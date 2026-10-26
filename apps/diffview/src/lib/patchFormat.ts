/** Git's C-style pathname quoting, including control characters that cannot appear in headers. */
export function quoteDiffPath(path: string) {
  if (!/["\\\x00-\x1f\x7f]/.test(path)) return path;
  const escapes: Record<string, string> = {
    '"': '\\"',
    "\\": "\\\\",
    "\x07": "\\a",
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\v": "\\v",
    "\f": "\\f",
    "\r": "\\r",
  };
  return (
    '"' +
    path.replace(
      /["\\\x00-\x1f\x7f]/g,
      (c) => escapes[c] ?? "\\" + c.charCodeAt(0).toString(8).padStart(3, "0"),
    ) +
    '"'
  );
}
export function syntheticPatch(path: string, text: string, lines: number) {
  if (!lines) return "";
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  const from = quoteDiffPath("a/" + path),
    to = quoteDiffPath("b/" + path);
  return (
    `diff --git ${from} ${to}\nnew file mode 100644\n--- /dev/null\n+++ ${to}\n@@ -0,0 +1,${lines} @@\n` +
    parts.map((l) => "+" + l + "\n").join("") +
    (text && !text.endsWith("\n") ? "\\ No newline at end of file\n" : "")
  );
}
