import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDiscoveredBrowserScriptMock } = vi.hoisted(() => ({
  runDiscoveredBrowserScriptMock: vi.fn(),
}));

vi.mock("@rome-os/app-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rome-os/app-runtime")>();
  return {
    ...actual,
    runDiscoveredBrowserScript: runDiscoveredBrowserScriptMock,
  };
});

import {
  buildExtractionExpression,
  createExtractUsersAction,
  extractUsers,
} from "./index.js";

describe("extract_users action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds an expression that passes the post limit to the scraper", () => {
    const expression = buildExtractionExpression(
      "async function extractFacebookCommenters() { return []; }",
      3,
    );

    expect(expression).toContain('globalThis["__ROME_FACEBOOK_EXTRACT_USERS_AUTORUN__"] = false;');
    expect(expression).toContain("__romeBrowserScriptEntrypoint({ maxPosts: 3 })");
  });

  it("runs the scraper in a discovered CDP page and returns structured results", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    runDiscoveredBrowserScriptMock.mockResolvedValue({
      endpoint: {
        name: "cdp-local-chromium",
        browserUrl: "http://127.0.0.1:9222",
      },
      close,
      result: [
        {
          postIndex: 1,
          comments: [
            {
              name: "Alice",
              profileUrl: "https://www.facebook.com/alice",
              comment: "First",
              postIndex: 1,
            },
            {
              name: "Alice",
              profileUrl: "https://www.facebook.com/alice",
              comment: "Second",
              postIndex: 1,
            },
          ],
        },
        {
          postIndex: 2,
          comments: [
            {
              name: "Bob",
              profileUrl: "https://www.facebook.com/bob",
              comment: "Hello",
              postIndex: 2,
            },
          ],
        },
      ],
    });

    const result = await extractUsers(
      {
        getBrowserEndpoints: () => [],
      } as never,
      {
        url: "https://www.facebook.com/sfmoma/",
        numPosts: 2,
      },
    );

    expect(runDiscoveredBrowserScriptMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pageUrl: "https://www.facebook.com/sfmoma/",
        entrypointExpression: "extractFacebookCommenters",
        args: [{ maxPosts: 2 }],
        autorunFlag: "__ROME_FACEBOOK_EXTRACT_USERS_AUTORUN__",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(result.browser.name).toBe("cdp-local-chromium");
    expect(result.counts).toEqual({ posts: 2, users: 2, comments: 3 });
    expect(result.users).toEqual([
      {
        name: "Alice",
        profileUrl: "https://www.facebook.com/alice",
        comments: ["First", "Second"],
        postIndexes: [1],
      },
      {
        name: "Bob",
        profileUrl: "https://www.facebook.com/bob",
        comments: ["Hello"],
        postIndexes: [2],
      },
    ]);
  });

  it("validates the input URL before opening a CDP session", async () => {
    const action = createExtractUsersAction(
      {
        name: "extract_users",
        type: "custom",
        description: "Extract users from Facebook",
        complexity: "moderate",
        speed: "slow",
        reliability: "medium",
        sideEffects: "read-only",
      },
      {
        capabilityDiscovery: {} as never,
      },
    );

    const result = await action.execute({
      url: "https://example.com/not-facebook",
    });

    expect(result).toEqual({
      status: "error",
      error: "url must be a valid Facebook page URL",
    });
    expect(runDiscoveredBrowserScriptMock).not.toHaveBeenCalled();
  });
});
