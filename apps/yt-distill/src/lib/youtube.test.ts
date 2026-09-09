import { describe, expect, it } from "vitest";
import { isYouTubeUrl, parseVideoId } from "./youtube.js";

describe("parseVideoId", () => {
  it("extracts the v param from a watch URL", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("handles youtu.be short links", () => {
    expect(parseVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("handles /shorts/ links", () => {
    expect(parseVideoId("https://www.youtube.com/shorts/abc123XYZ_-")).toBe("abc123XYZ_-");
  });
  it("accepts a bare id", () => {
    expect(parseVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects a non-YouTube URL", () => {
    expect(parseVideoId("https://vimeo.com/12345")).toBeNull();
  });
  it("rejects empty input", () => {
    expect(parseVideoId("   ")).toBeNull();
  });
});

describe("isYouTubeUrl", () => {
  it("is true for a valid link", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });
  it("is false for junk", () => {
    expect(isYouTubeUrl("not a url")).toBe(false);
  });
});
