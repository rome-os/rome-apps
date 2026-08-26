import { describe, expect, it, vi } from "vitest";
import type { RomeAppContext } from "@rome-os/app-runtime";
import { createAction } from "./workflow-action.js";
import { buildSeoWorkflowPrompt, validateSeoWorkflowArgs } from "./workflows.js";

describe("seo workflow prompts", () => {
  it("builds a keyword research prompt with the expected inputs and skills", () => {
    const prompt = buildSeoWorkflowPrompt("keyword_research", {
      seed: "project management software",
      audience: "small teams",
      competitors: "asana.com,monday.com",
    });

    expect(prompt).toContain('Handle the SEO workflow "Keyword Research".');
    expect(prompt).toContain("- keyword-research");
    expect(prompt).toContain("- competitor-analysis");
    expect(prompt).toContain("- seed: project management software");
    expect(prompt).toContain("- audience: small teams");
    expect(prompt).toContain("- competitors: asana.com,monday.com");
    expect(prompt).toContain(
      "Do not write files or persist memory unless the user explicitly asks for that.",
    );
  });

  it("validates required fields", () => {
    expect(validateSeoWorkflowArgs("write_content", { topic: "React perf" })).toBe(
      "keyword is required",
    );
    expect(
      validateSeoWorkflowArgs("write_content", {
        topic: "React perf",
        keyword: "react performance optimization",
      }),
    ).toBeNull();
  });
});

describe("seo workflow action", () => {
  it("delegates to summon with the seo agent and generated prompt", async () => {
    const runAction = vi.fn().mockResolvedValue({
      status: "ok",
      data: { result: "done", sessionId: "seo-session" },
    });

    const action = createAction(
      {
        name: "audit_page",
        type: "custom",
        description: "Run a page audit",
        complexity: "moderate",
        speed: "moderate",
        reliability: "high",
        sideEffects: "write",
      },
      {
        appContext: {
          runAction,
        } as unknown as RomeAppContext,
      },
    );

    const result = await action.execute({
      source: "https://example.com/post",
      keyword: "content audit",
      sessionId: "resume-seo",
    });

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith("summon", {
      agentName: "seo",
      prompt: expect.stringContaining('Handle the SEO workflow "Audit Page".'),
      sessionId: "resume-seo",
    });
    expect(result).toEqual({
      status: "ok",
      data: { result: "done", sessionId: "seo-session" },
    });
  });

  it("returns an input error when required arguments are missing", async () => {
    const runAction = vi.fn();

    const action = createAction(
      {
        name: "audit_domain",
        type: "custom",
        description: "Run a domain audit",
        complexity: "moderate",
        speed: "moderate",
        reliability: "high",
        sideEffects: "write",
      },
      {
        appContext: {
          runAction,
        } as unknown as RomeAppContext,
      },
    );

    await expect(action.execute({})).resolves.toEqual({
      status: "error",
      error: "domain is required",
    });
    expect(runAction).not.toHaveBeenCalled();
  });
});
