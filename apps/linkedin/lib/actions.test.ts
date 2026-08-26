import { describe, expect, it } from "vitest";
import { createLinkedinAction } from "./actions.js";
import { detectConnectionState } from "./connection.js";
import { parseCompanySections, parsePersonSections } from "./fields.js";

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

describe("createLinkedinAction", () => {
  it("validates required person profile arguments before opening a browser", async () => {
    const action = createLinkedinAction("get-person-profile", baseConfig, deps);
    await expect(action.execute({})).resolves.toEqual({
      status: "error",
      error: "linkedin_username is required",
    });
  });

  it("requires an identifier for get-conversation", async () => {
    const action = createLinkedinAction("get-conversation", baseConfig, deps);
    await expect(action.execute({})).resolves.toEqual({
      status: "error",
      error: "Provide at least one of linkedin_username or thread_id",
    });
  });
});

describe("parse sections", () => {
  it("always includes the default person section", () => {
    expect(parsePersonSections("experience").requested).toEqual(
      new Set(["main_profile", "experience"]),
    );
  });

  it("reports unknown company sections", () => {
    expect(parseCompanySections("posts,unknown")).toEqual({
      requested: new Set(["about", "posts"]),
      unknown: ["unknown"],
    });
  });
});

describe("detectConnectionState", () => {
  it("detects a connectable profile", () => {
    expect(detectConnectionState("Jane Doe\n2nd\nMessage\nConnect\nAbout\nStuff")).toBe(
      "connectable",
    );
  });
});
