import { describe, expect, it } from "vitest";
import { buildPrompt, normalizeTypes, stripCodeFences, truncateTranscript } from "./artifacts.js";

describe("normalizeTypes", () => {
  it("keeps valid types in canonical order and de-dupes", () => {
    expect(normalizeTypes(["slides", "mindmap", "mindmap"])).toEqual(["mindmap", "slides"]);
  });
  it("drops invalid entries", () => {
    expect(normalizeTypes(["mindmap", "audio", 3])).toEqual(["mindmap"]);
  });
  it("returns empty for non-arrays", () => {
    expect(normalizeTypes("mindmap")).toEqual([]);
  });
});

describe("stripCodeFences", () => {
  it("removes a wrapping markdown fence", () => {
    expect(stripCodeFences("```markdown\n# Hi\n```" )).toBe("# Hi");
  });
  it("removes a wrapping html fence", () => {
    expect(stripCodeFences("```html\n<h1>Hi</h1>\n```")).toBe("<h1>Hi</h1>");
  });
  it("leaves unfenced content untouched", () => {
    expect(stripCodeFences("# Hi\n- a")).toBe("# Hi\n- a");
  });
  it("does not strip inner fences", () => {
    const md = "# Title\n\n```js\ncode\n```\n\nmore";
    expect(stripCodeFences(md)).toBe(md);
  });
});

describe("truncateTranscript", () => {
  it("does not truncate short text", () => {
    expect(truncateTranscript("hello", 100)).toEqual({ text: "hello", truncated: false });
  });
  it("truncates long text", () => {
    const long = "a".repeat(200);
    const out = truncateTranscript(long, 50);
    expect(out.truncated).toBe(true);
    expect(out.text).toHaveLength(50);
  });
});

describe("buildPrompt", () => {
  it("includes the language rule and transcript", () => {
    const p = buildPrompt("summary", { title: "T", transcript: "hello world", truncated: false });
    expect(p).toContain("LANGUAGE: Write the ENTIRE output in");
    expect(p).toContain("hello world");
    expect(p).toContain("Markdown");
  });
  it("notes truncation when set", () => {
    const p = buildPrompt("mindmap", { title: null, transcript: "x", truncated: true });
    expect(p).toContain("truncated");
  });
  it("asks for slide sections between the app's markers", () => {
    const p = buildPrompt("slides", { title: "T", transcript: "x", truncated: false });
    expect(p).toContain("@@SLIDES@@");
    expect(p).toContain('<section class="slide"');
  });
});
