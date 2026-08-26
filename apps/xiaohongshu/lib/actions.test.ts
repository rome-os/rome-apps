import { describe, expect, it } from "vitest";
import { createXiaohongshuAction } from "./actions.js";

const baseConfig = {
  name: "test",
  type: "custom" as const,
  description: "test",
  complexity: "moderate" as const,
  speed: "slow" as const,
  reliability: "medium" as const,
  sideEffects: "write" as const,
};

const deps = {
  capabilityDiscovery: {
    getBrowserEndpoints: () => [],
  },
};

describe("createXiaohongshuAction", () => {
  it("validates required search arguments before touching the browser", async () => {
    const action = createXiaohongshuAction("search-feeds", baseConfig, deps);
    await expect(action.execute({})).resolves.toEqual({
      status: "error",
      error: "keyword is required",
    });
  });

  it("requires a reply target for reply-comment", async () => {
    const action = createXiaohongshuAction("reply-comment", baseConfig, deps);
    await expect(
      action.execute({
        feedId: "feed",
        xsecToken: "token",
        content: "hello",
      }),
    ).resolves.toEqual({
      status: "error",
      error: "commentId or userId is required",
    });
  });
});
