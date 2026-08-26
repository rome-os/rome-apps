import { describe, expect, it } from "vitest";
import { calcTitleLength } from "./title-utils.js";

describe("calcTitleLength", () => {
  it("counts Chinese characters as one unit each", () => {
    expect(calcTitleLength("你好世界")).toBe(4);
  });

  it("counts ascii pairs as one unit", () => {
    expect(calcTitleLength("hello")).toBe(3);
  });

  it("handles mixed Chinese and ascii text", () => {
    expect(calcTitleLength("你好hello")).toBe(5);
  });
});
