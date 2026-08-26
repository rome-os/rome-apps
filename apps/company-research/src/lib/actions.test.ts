import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionExecutionContext,
  type ActionExecutionStore,
} from "../test-utils/action-context.js";
import {
  getCurrentActionContext,
  type AppDbContext,
  type DrizzleDb,
  type Logger,
  type RomeAppContext,
} from "@rome-os/app-runtime";
import { createCompanyResearchDbSchema } from "../db/schema.js";
import {
  createCompanyResearchAddCompanyRelationshipAction,
  createCompanyResearchAddFinancingRoundAction,
  createCompanyResearchAddPersonRoleAction,
  createCompanyResearchAddProductAction,
  createCompanyResearchReadProvenanceAction,
  createCompanyResearchReadRowsAction,
  createCompanyResearchReadRunsAction,
  createCompanyResearchRunCompanyResearchAction,
  createCompanyResearchSearchCompaniesAction,
} from "./actions.js";

function applyMigration(sqlite: Database.Database, sql: string): void {
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      sqlite.exec(trimmed);
    }
  }
}

function createSilentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function insertCompanyFixture(
  db: DrizzleDb,
  schema: ReturnType<typeof createCompanyResearchDbSchema>,
  input: {
    id: string;
    canonicalName: string;
    domain?: string | null;
    websiteUrl?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  db.insert(schema.entities)
    .values({
      id: input.id,
      entityType: "company",
      displayName: input.canonicalName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run();
  db.insert(schema.companies)
    .values({
      id: input.id,
      canonicalName: input.canonicalName,
      domain: input.domain ?? null,
      websiteUrl: input.websiteUrl ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run();
}

function insertPersonFixture(
  db: DrizzleDb,
  schema: ReturnType<typeof createCompanyResearchDbSchema>,
  input: {
    id: string;
    fullName: string;
    linkedinUrl?: string | null;
    websiteUrl?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  db.insert(schema.entities)
    .values({
      id: input.id,
      entityType: "person",
      displayName: input.fullName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run();
  db.insert(schema.people)
    .values({
      id: input.id,
      fullName: input.fullName,
      linkedinUrl: input.linkedinUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run();
}

function createTestContext() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const migrationsDir = new URL("../db/migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrationFiles) {
    const migrationSql = readFileSync(new URL(file, migrationsDir), "utf8");
    applyMigration(sqlite, migrationSql);
  }

  const schema = createCompanyResearchDbSchema("company_research");
  const db = drizzle(sqlite, { schema }) as unknown as DrizzleDb;
  const appDb: AppDbContext = {
    connection: db,
    tablePrefix: "company_research",
    tableName(name: string) {
      return `company_research__${name}`;
    },
  };
  const appContext: RomeAppContext = {
    app: {
      id: "company-research",
      version: "0.1.0",
      description: "Company Research miniapp",
    },
    registry: null,
    db: appDb,
    log: createSilentLogger(),
    async runAction() {
      return { status: "ok" };
    },
    async listEvents() {
      return [];
    },
  };

  const now = new Date("2026-04-04T12:00:00.000Z");
  insertCompanyFixture(db, schema, {
    id: "company-1",
    canonicalName: "Acme Robotics",
    domain: "acme.example",
    websiteUrl: "https://acme.example",
    createdAt: now,
    updatedAt: now,
  });
  db.insert(schema.runs)
    .values({
      id: "run-1",
      companyId: "company-1",
      status: "success",
      promptVersion: "prompt-v1",
      extractorVersion: "extractor-v1",
      createdAt: now,
      completedAt: now,
    })
    .run();
  db.insert(schema.reports)
    .values({
      id: "report-1",
      companyId: "company-1",
      runId: "run-1",
      reportType: "company",
      reportContent: "Acme report",
      createdAt: now,
    })
    .run();
  db.insert(schema.runs)
    .values({
      id: "run-2",
      companyId: "company-1",
      status: "error",
      promptVersion: "prompt-v2",
      extractorVersion: "extractor-v2",
      error: "network timeout",
      createdAt: new Date("2026-04-05T12:00:00.000Z"),
      startedAt: new Date("2026-04-05T11:00:00.000Z"),
    })
    .run();

  return {
    sqlite,
    db,
    schema,
    appContext,
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function buildConfig(name: string, sideEffects: "read-only" | "write") {
  return {
    name,
    type: "custom" as const,
    description: name,
    complexity: "moderate" as const,
    speed: "fast" as const,
    reliability: "high" as const,
    sideEffects,
  };
}

async function runWithSharedContext<T>(sharedContext: Record<string, unknown>, fn: () => Promise<T>) {
  const store: ActionExecutionStore = {
    executionId: "exec-1",
    rootExecutionId: "root-1",
    initiator: "test",
    sharedContext,
  };
  return await actionExecutionContext.run(store, fn);
}

describe("company-research actions", () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    ctx.sqlite.close();
  });

  it("adds a product using shared company_id/run_id context", async () => {
    const action = createCompanyResearchAddProductAction(
      buildConfig("company_research_add_product", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await runWithSharedContext(
      {
        company_id: "company-1",
        run_id: "run-1",
      },
      () =>
        action.execute({
          product_name: "Atlas",
          product_category: "robotics",
          value_proposition: "Warehouse automation",
          is_primary: true,
          provenance: [
            {
              field_name: "product_name",
              citation_url: "https://example.com/product",
              confidence: "high",
            },
          ],
        }),
    );

    expect(result).toEqual({ status: "ok" });

    const productRows = ctx.db.select().from(ctx.schema.products).all();
    expect(productRows).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        productName: "Atlas",
        isPrimary: true,
      }),
    ]);

    const provenanceRows = ctx.db.select().from(ctx.schema.fieldProvenance).all();
    expect(provenanceRows).toHaveLength(1);
    expect(provenanceRows[0]).toMatchObject({
      runId: "run-1",
      tableName: "company_research__products",
      fieldName: "product_name",
    });
  });

  it("upserts a person by linkedin_url and inserts a company role", async () => {
    insertPersonFixture(ctx.db, ctx.schema, {
      id: "person-1",
      fullName: "Jane Founder",
      linkedinUrl: "https://www.linkedin.com/in/jane-founder",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    const action = createCompanyResearchAddPersonRoleAction(
      buildConfig("company_research_add_person_role", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await action.execute({
      company_id: "company-1",
      run_id: "run-1",
      person_name: "Jane Founder",
      linkedin_url: "https://www.linkedin.com/in/jane-founder/",
      website_url: "https://example.com/team/jane-founder",
      role_type: "founder",
      title: "CEO",
      provenance: [
        {
          field_name: "title",
          citation_url: "https://example.com/team",
        },
      ],
    });

    expect(result).toEqual({ status: "ok" });

    const peopleRows = ctx.db.select().from(ctx.schema.people).all();
    expect(peopleRows).toHaveLength(1);
    expect(peopleRows[0]).toMatchObject({
      id: "person-1",
      fullName: "Jane Founder",
      linkedinUrl: "https://www.linkedin.com/in/jane-founder",
      websiteUrl: "https://example.com/team/jane-founder",
    });

    const roleRows = ctx.db.select().from(ctx.schema.companyPersonRoles).all();
    expect(roleRows).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        personId: "person-1",
        runId: "run-1",
        roleType: "founder",
        title: "CEO",
      }),
    ]);

    const provenanceRows = ctx.db.select().from(ctx.schema.fieldProvenance).all();
    expect(provenanceRows).toHaveLength(1);
  });

  it("rejects a matched URL when person_name belongs to another person", async () => {
    insertPersonFixture(ctx.db, ctx.schema, {
      id: "person-1",
      fullName: "Jane Founder",
      websiteUrl: "https://example.com/team",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    const action = createCompanyResearchAddPersonRoleAction(
      buildConfig("company_research_add_person_role", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    await expect(
      action.execute({
        company_id: "company-1",
        run_id: "run-1",
        person_name: "John Founder",
        website_url: "https://example.com/team",
        role_type: "employee",
      }),
    ).rejects.toThrow(
      "the URL is already used by another person. Check if you use a general team url instead of the person's profile url",
    );
  });

  it("creates a person role even when no identity URLs are provided", async () => {
    const action = createCompanyResearchAddPersonRoleAction(
      buildConfig("company_research_add_person_role", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await action.execute({
      company_id: "company-1",
      run_id: "run-1",
      person_name: "Taylor Smith",
      role_type: "employee",
      title: "Researcher",
    });

    expect(result).toEqual({ status: "ok" });

    const peopleRows = ctx.db.select().from(ctx.schema.people).all();
    expect(peopleRows).toEqual([
      expect.objectContaining({
        fullName: "Taylor Smith",
        linkedinUrl: null,
        websiteUrl: null,
      }),
    ]);

    const roleRows = ctx.db.select().from(ctx.schema.companyPersonRoles).all();
    expect(roleRows).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        title: "Researcher",
      }),
    ]);
  });

  it("upserts a related company from website_url and inserts a relationship", async () => {
    const action = createCompanyResearchAddCompanyRelationshipAction(
      buildConfig("company_research_add_company_relationship", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await runWithSharedContext(
      {
        companyId: "company-1",
        runId: "run-1",
      },
      () =>
        action.execute({
          company_name: "Beta Systems",
          website_url: "https://www.beta.example/",
          relationship_type: "competitor",
          relationship_strength: "direct",
        }),
    );

    expect(result).toEqual({ status: "ok" });

    const relationshipRows = ctx.db.select().from(ctx.schema.companyRelationships).all();
    expect(relationshipRows).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        relationshipType: "competitor",
        relationshipStrength: "direct",
      }),
    ]);

    const companies = ctx.db.select().from(ctx.schema.companies).all();
    expect(companies).toHaveLength(2);
    expect(companies[1]).toMatchObject({
      canonicalName: "Beta Systems",
      domain: "beta.example",
    });
  });

  it("creates a relationship when only the related company name is provided", async () => {
    const action = createCompanyResearchAddCompanyRelationshipAction(
      buildConfig("company_research_add_company_relationship", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await action.execute({
      company_id: "company-1",
      run_id: "run-1",
      company_name: "Gamma Works",
      relationship_type: "customer",
    });

    expect(result).toEqual({ status: "ok" });

    const relationshipRows = ctx.db.select().from(ctx.schema.companyRelationships).all();
    expect(relationshipRows).toEqual([
      expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        relationshipType: "customer",
      }),
    ]);

    const companies = ctx.db.select().from(ctx.schema.companies).all();
    expect(companies).toHaveLength(2);
    expect(companies[1]).toMatchObject({
      canonicalName: "Gamma Works",
      domain: null,
      websiteUrl: null,
    });
  });

  it("upserts investors and inserts a financing round with join rows", async () => {
    const action = createCompanyResearchAddFinancingRoundAction(
      buildConfig("company_research_add_financing_round", "write"),
      {
        appContext: ctx.appContext,
      },
    );
    const readRowsAction = createCompanyResearchReadRowsAction(
      buildConfig("company_research_read_rows", "read-only"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await runWithSharedContext(
      {
        company_id: "company-1",
        run_id: "run-1",
      },
      () =>
        action.execute({
          round_type: "series_a",
          round_label: "Series A",
          announced_at: "2026-03-10",
          amount_raised: 25000000,
          amount_raised_currency: "USD",
          investors: [
            {
              investor_name: "North Star Ventures",
              website_url: "https://northstar.example/",
              investor_type: "venture_capital",
              investor_role: "lead",
            },
            {
              investor_name: "Altitude Capital",
              domain: "altitude.example",
              investor_role: "participant",
            },
          ],
          provenance: [
            {
              field_name: "amount_raised",
              citation_url: "https://example.com/funding",
              confidence: "high",
            },
          ],
        }),
    );

    expect(result).toEqual({ status: "ok" });

    const rowsResult = await readRowsAction.execute({
      table: "financing_rounds",
      filters: { company_id: "company-1", round_type: "series_a" },
      include_provenance: true,
    });

    expect(rowsResult.status).toBe("ok");
    expect((rowsResult.data as { rows: Array<{ roundType: string; provenance: unknown[] }> }).rows).toEqual([
      expect.objectContaining({
        roundType: "series_a",
        provenance: [expect.objectContaining({ fieldName: "amount_raised" })],
      }),
    ]);
    expect(ctx.db.select().from(ctx.schema.entities).all()).toHaveLength(3);
    expect(ctx.db.select().from(ctx.schema.financingRoundInvestors).all()).toEqual([
      expect.objectContaining({ investorRole: "lead" }),
      expect.objectContaining({ investorRole: "participant" }),
    ]);
  });

  it("runs company research, sanitizes markdown links, and updates schedule/run records", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const observedSharedContexts: Array<Record<string, unknown> | undefined> = [];
    const logEntries: Array<{ message: string; data?: Record<string, unknown> }> = [];
    let chatCallCount = 0;
    ctx.appContext.log = {
      debug() {},
      info(message, data) {
        logEntries.push({ message, data });
      },
      warn() {},
      error() {},
    };

    ctx.appContext.runAction = async (name: string, args: Record<string, unknown>) => {
      observedSharedContexts.push(getCurrentActionContext()?.sharedContext);

      if (name === "chatgpt_chat") {
        expect(args).toMatchObject({
          prompt: expect.any(String),
        });
        chatCallCount += 1;
        const prompt = args.prompt as string;
        const response = prompt.includes("content strategist and copywriter")
          ? "# Content\n\n[Campaign](https://content.example/post?utm_source=chatgpt.com&ref=weekly)"
          : prompt.includes("publicly available financial metrics")
            ? "# Financials\n\nNo public revenue disclosure"
            : prompt.includes("growth marketing strategist")
              ? {
                  response: "Customer traction summary",
                  sources: [
                    {
                      title: "Case Study",
                      url: "https://example.com/case?utm_source=chatgpt.com&utm_medium=social",
                    },
                  ],
                }
              : prompt.includes("leadership, team, and organizational structure")
                ? "# Team\n\n- Founder profile"
                : "# Company\n\n[Official](https://acme.example/?utm_source=chatgpt.com&utm_campaign=q2&x=1)";
        return { status: "ok", data: response };
      }

      if (name === "summon") {
        expect(args).toMatchObject({
          agentName: "assistant",
          prompt: expect.stringContaining("Fill the company-research structured tables"),
        });
        return {
          status: "ok",
          data: {
            sessionId: "session-1",
            result: '{"status":"done","inserted_counts":{"products":1},"notes":[]}',
          },
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await runWithSharedContext({ initiator_id: "seed" }, () =>
      action.execute({
        canonical_name: "Beta Labs",
        company_domain: "www.beta.example",
      }),
    );

    expect(result.status).toBe("ok");
    expect(chatCallCount).toBe(5);
    expect(observedSharedContexts).toHaveLength(6);
    expect(logEntries).toHaveLength(5);

    const runResult = result.data as {
      company: { id: string; domain: string };
      schedule_created: boolean;
      schedule: { companyId: string; cadenceMonths: number; nextRunAt: Date | null; lastRunAt: Date | null };
      run: {
        id: string;
        companyId: string;
        status: string;
        extractorOutput: string;
        reports: Array<{ reportType: string; reportContent: string }>;
      };
      tmp_result_markdown: string;
      result_markdown: string;
      agent_result: string;
    };

    expect(runResult.company).toMatchObject({
      domain: "beta.example",
    });
    expect(observedSharedContexts).toEqual(
      Array.from({ length: 6 }, () => ({
        initiator_id: "seed",
        company_id: runResult.company.id,
        companyId: runResult.company.id,
        run_id: runResult.run.id,
        runId: runResult.run.id,
      })),
    );
    expect(logEntries).toEqual(
      expect.arrayContaining(
        [
          { section: "company", queryIndex: 1 },
          { section: "team", queryIndex: 2 },
          { section: "marketing", queryIndex: 3 },
          { section: "financials", queryIndex: 4 },
          { section: "content", queryIndex: 5 },
        ].map(({ section, queryIndex }) =>
          expect.objectContaining({
            message: "chatgpt_chat finished",
            data: expect.objectContaining({
              companyId: runResult.company.id,
              runId: runResult.run.id,
              section,
              queryIndex,
              success: true,
              durationMs: expect.any(Number),
              resultDataLength: expect.any(Number),
              resultDataPreview: expect.any(String),
            }),
          }),
        ),
      ),
    );
    expect(logEntries.map((entry) => entry.data?.resultDataLength)).toEqual(
      expect.arrayContaining([
        "# Company\n\n[Official](https://acme.example/?utm_source=chatgpt.com&utm_campaign=q2&x=1)".length,
        "# Team\n\n- Founder profile".length,
        '{"response":"Customer traction summary","sources":[{"title":"Case Study","url":"https://example.com/case?utm_source=chatgpt.com&utm_medium=social"}]}'
          .length,
        "# Financials\n\nNo public revenue disclosure".length,
        "# Content\n\n[Campaign](https://content.example/post?utm_source=chatgpt.com&ref=weekly)"
          .length,
      ]),
    );
    expect(logEntries.map((entry) => entry.data?.resultDataPreview)).toEqual(
      expect.arrayContaining([
        "# Company\n\n[Official](https://acme.example/?utm_source=chatgpt.com&utm_campaign=q2&x=1)",
        "# Team\n\n- Founder profile",
        '{"response":"Customer traction summary","sources":[{"title":"Case Study","url":"https://example.com/case?utm_source=chatgpt.com&utm_medium=social"}]}',
        "# Financials\n\nNo public revenue disclosure",
        "# Content\n\n[Campaign](https://content.example/post?utm_source=chatgpt.com&ref=weekly)",
      ]),
    );
    expect(runResult.schedule_created).toBe(true);
    expect(runResult.tmp_result_markdown).toContain(
      "https://acme.example/?utm_source=chatgpt.com&utm_campaign=q2&x=1",
    );
    expect(runResult.result_markdown).toContain("https://acme.example/?x=1");
    expect(runResult.result_markdown).toContain("<content>\n# Content");
    expect(runResult.result_markdown).toContain("https://content.example/post?ref=weekly");
    expect(runResult.result_markdown).not.toContain("utm_source=chatgpt.com");
    expect(runResult.result_markdown).not.toContain("utm_campaign=q2");
    expect(runResult.result_markdown).not.toContain("utm_medium=social");
    expect(runResult.agent_result).toContain('"status":"done"');
    expect(runResult.schedule).toMatchObject({
      companyId: runResult.company.id,
      cadenceMonths: 3,
    });
    expect(runResult.schedule.lastRunAt).toBeInstanceOf(Date);
    expect(runResult.schedule.nextRunAt).toBeInstanceOf(Date);
    expect(runResult.run).toMatchObject({
      companyId: runResult.company.id,
      status: "success",
    });
    expect(runResult.run.reports).toEqual([
      expect.objectContaining({ reportType: "company" }),
      expect.objectContaining({ reportType: "team" }),
      expect.objectContaining({ reportType: "marketing" }),
      expect.objectContaining({ reportType: "content" }),
      expect.objectContaining({ reportType: "financials" }),
    ]);
    expect(runResult.run.reports.find((report) => report.reportType === "content")).toMatchObject({
      reportContent: expect.stringContaining("https://content.example/post?ref=weekly"),
    });
    expect(runResult.run.extractorOutput).toContain('"tmp_result_markdown"');

    for (const sharedContext of observedSharedContexts) {
      expect(sharedContext).toMatchObject({
        initiator_id: "seed",
        company_id: runResult.company.id,
        run_id: runResult.run.id,
      });
    }

    const companyRow = ctx.db.select().from(ctx.schema.companies).all().find((row) => row.id === runResult.company.id);
    expect(companyRow).toMatchObject({
      canonicalName: "Beta Labs",
      domain: "beta.example",
    });
  });

  it("limits company research chatgpt queries to five in-flight actions", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const pendingResolvers: Array<() => void> = [];
    let chatCallCount = 0;
    let inFlightChatCalls = 0;
    let maxInFlightChatCalls = 0;

    ctx.appContext.runAction = async (name: string) => {
      if (name === "chatgpt_chat") {
        chatCallCount += 1;
        inFlightChatCalls += 1;
        maxInFlightChatCalls = Math.max(maxInFlightChatCalls, inFlightChatCalls);

        await new Promise<void>((resolve) => {
          pendingResolvers.push(() => {
            inFlightChatCalls -= 1;
            resolve();
          });
        });

        return { status: "ok", data: "# Section\n\nGrounded research" };
      }

      if (name === "summon") {
        return {
          status: "ok",
          data: {
            result: '{"status":"done"}',
          },
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const resultPromise = action.execute({
      canonical_name: "Beta Labs",
      company_domain: "beta.example",
    });

    await vi.waitFor(() => {
      expect(chatCallCount).toBe(5);
      expect(maxInFlightChatCalls).toBe(5);
    });

    expect(pendingResolvers).toHaveLength(5);

    pendingResolvers.shift()?.();
    await vi.waitFor(() => {
      expect(chatCallCount).toBe(5);
      expect(maxInFlightChatCalls).toBe(5);
    });

    pendingResolvers.shift()?.();
    await vi.waitFor(() => {
      expect(chatCallCount).toBe(5);
      expect(maxInFlightChatCalls).toBe(5);
    });

    while (pendingResolvers.length > 0) {
      pendingResolvers.shift()?.();
    }

    const result = await resultPromise;
    expect(result.status).toBe("ok");
    expect(chatCallCount).toBe(5);
    expect(maxInFlightChatCalls).toBe(5);
  });

  it("retries a failed chatgpt research query once before succeeding", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const logEntries: Array<{ message: string; data?: Record<string, unknown> }> = [];
    let marketingAttempts = 0;
    let chatCallCount = 0;

    ctx.appContext.log = {
      debug() {},
      info(message, data) {
        logEntries.push({ message, data });
      },
      warn() {},
      error() {},
    };

    ctx.appContext.runAction = async (name: string, args: Record<string, unknown>) => {
      if (name === "chatgpt_chat") {
        chatCallCount += 1;
        const prompt = args.prompt as string;
        if (prompt.includes("growth marketing strategist")) {
          marketingAttempts += 1;
          if (marketingAttempts === 1) {
            return { status: "error", error: "temporary browser failure" };
          }

          return {
            status: "ok",
            data: {
              response: "Recovered marketing strategy summary",
              sources: [],
            },
          };
        }

        return { status: "ok", data: "# Section\n\nGrounded research" };
      }

      if (name === "summon") {
        return {
          status: "ok",
          data: {
            result: '{"status":"done"}',
          },
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await action.execute({
      canonical_name: "Beta Labs",
      company_domain: "beta.example",
    });

    expect(result.status).toBe("ok");
    expect(marketingAttempts).toBe(2);
    expect(chatCallCount).toBe(6);

    const runResult = result.data as { result_markdown: string };
    expect(runResult.result_markdown).toContain("Recovered marketing strategy summary");

    const marketingLogs = logEntries.filter(
      (entry) =>
        entry.message === "chatgpt_chat finished" && entry.data?.section === "marketing",
    );
    expect(marketingLogs).toHaveLength(2);
    expect(marketingLogs[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          queryIndex: 3,
          attempt: 1,
          success: false,
          retrying: true,
          error: "temporary browser failure",
        }),
      }),
    );
    expect(marketingLogs[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          queryIndex: 3,
          attempt: 2,
          success: true,
        }),
      }),
    );
  });

  it("retries an empty chatgpt response once before succeeding", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const logEntries: Array<{ message: string; data?: Record<string, unknown> }> = [];
    let marketingAttempts = 0;
    let chatCallCount = 0;

    ctx.appContext.log = {
      debug() {},
      info(message, data) {
        logEntries.push({ message, data });
      },
      warn() {},
      error() {},
    };

    ctx.appContext.runAction = async (name: string, args: Record<string, unknown>) => {
      if (name === "chatgpt_chat") {
        chatCallCount += 1;
        const prompt = args.prompt as string;
        if (prompt.includes("growth marketing strategist")) {
          marketingAttempts += 1;
          if (marketingAttempts === 1) {
            return {
              status: "ok",
              data: {
                response: "",
                sources: [],
              },
            };
          }

          return {
            status: "ok",
            data: {
              response: "Recovered marketing response",
              sources: [],
            },
          };
        }

        return { status: "ok", data: "# Section\n\nGrounded research" };
      }

      if (name === "summon") {
        return {
          status: "ok",
          data: {
            result: '{"status":"done"}',
          },
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await action.execute({
      canonical_name: "Beta Labs",
      company_domain: "beta.example",
    });

    expect(result.status).toBe("ok");
    expect(marketingAttempts).toBe(2);
    expect(chatCallCount).toBe(6);

    const runResult = result.data as { result_markdown: string };
    expect(runResult.result_markdown).toContain("Recovered marketing response");

    const marketingLogs = logEntries.filter(
      (entry) =>
        entry.message === "chatgpt_chat finished" && entry.data?.section === "marketing",
    );
    expect(marketingLogs).toHaveLength(2);
    expect(marketingLogs[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          queryIndex: 3,
          attempt: 1,
          success: true,
          retrying: true,
          resultDataPreview: '{"response":"","sources":[]}',
        }),
      }),
    );
    expect(marketingLogs[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          queryIndex: 3,
          attempt: 2,
          success: true,
        }),
      }),
    );
  });

  it("starts chatgpt research queries sequentially with randomized delays", async () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-04-05T12:00:00.000Z");
    vi.setSystemTime(baseTime);
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.95);

    const sectionStartOrder: Array<"company" | "team" | "marketing" | "financials" | "content"> = [];
    const sectionStartOffsets: number[] = [];

    ctx.appContext.runAction = async (name: string, args: Record<string, unknown>) => {
      if (name === "chatgpt_chat") {
        const prompt = args.prompt as string;
        const section = prompt.includes("publicly available financial metrics")
          ? "financials"
          : prompt.includes("content strategist and copywriter")
            ? "content"
          : prompt.includes("growth marketing strategist")
            ? "marketing"
            : prompt.includes("leadership, team, and organizational structure")
              ? "team"
              : "company";

        sectionStartOrder.push(section);
        sectionStartOffsets.push(Date.now() - baseTime.getTime());

        return {
          status: "ok",
          data: `# ${section[0].toUpperCase()}${section.slice(1)}\n\nGrounded research`,
        };
      }

      if (name === "summon") {
        return {
          status: "ok",
          data: {
            result: '{"status":"done"}',
          },
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const resultPromise = action.execute({
      canonical_name: "Beta Labs",
      company_domain: "beta.example",
    });

    await vi.advanceTimersByTimeAsync(7_350);
    const result = await resultPromise;

    expect(result.status).toBe("ok");
    expect(sectionStartOrder).toEqual(["company", "team", "marketing", "financials", "content"]);
    expect(sectionStartOffsets).toEqual([2250, 3000, 4500, 4500, 7350]);

    const runResult = result.data as { result_markdown: string };
    expect(runResult.result_markdown).toContain("<company>\n# Company\n\nGrounded research\n</company>");
    expect(runResult.result_markdown).toContain("<team>\n# Team\n\nGrounded research\n</team>");
    expect(runResult.result_markdown).toContain(
      "<marketing>\n# Marketing\n\nGrounded research\n</marketing>",
    );
    expect(runResult.result_markdown).toContain(
      "<content>\n# Content\n\nGrounded research\n</content>",
    );
    expect(runResult.result_markdown).toContain(
      "<financials>\n# Financials\n\nGrounded research\n</financials>",
    );
  });

  it("moves an existing schedule to a one-day retry point when the research run fails", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const previousLastRunAt = new Date("2026-01-04T12:00:00.000Z");
    const previousNextRunAt = new Date("2026-04-04T12:00:00.000Z");

    ctx.db.insert(ctx.schema.schedules)
      .values({
        id: "schedule-1",
        companyId: "company-1",
        cadenceMonths: 3,
        isActive: true,
        nextRunAt: previousNextRunAt,
        lastRunAt: previousLastRunAt,
        createdAt: new Date("2026-01-04T12:00:00.000Z"),
        updatedAt: new Date("2026-01-04T12:00:00.000Z"),
      })
      .run();

    let chatCallCount = 0;
    ctx.appContext.runAction = async (name: string) => {
      if (name === "chatgpt_chat") {
        chatCallCount += 1;
        return { status: "ok", data: "# Section\n\nGrounded research" };
      }

      if (name === "summon") {
        return {
          status: "error",
          error: "structured fill agent failed",
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const retryWindowStart = Date.now();
    const result = await action.execute({
      canonical_name: "Acme Robotics",
      company_domain: "acme.example",
    });
    const retryWindowEnd = Date.now();

    expect(result).toMatchObject({
      status: "error",
      error: "structured fill agent failed",
    });
    expect(chatCallCount).toBe(5);

    // status:"error" ActionResults no longer carry a data payload, so the
    // schedule move and the failed run are verified via persisted DB state.
    const persistedSchedule = ctx.db
      .select()
      .from(ctx.schema.schedules)
      .all()
      .find((row) => row.companyId === "company-1");
    expect(persistedSchedule).toBeDefined();
    // The pre-existing schedule was reused, not recreated.
    expect(persistedSchedule?.id).toBe("schedule-1");
    expect(persistedSchedule?.companyId).toBe("company-1");
    expect(persistedSchedule?.cadenceMonths).toBe(3);
    expect(persistedSchedule?.lastRunAt?.getTime()).toBe(previousLastRunAt.getTime());
    const nextRunAtMs = persistedSchedule?.nextRunAt?.getTime();
    const retryWindowFloor = retryWindowStart + ONE_DAY_MS - 1000;
    const retryWindowCeiling = retryWindowEnd + ONE_DAY_MS + 1000;
    expect(nextRunAtMs).toBeDefined();
    expect(nextRunAtMs).not.toBe(previousNextRunAt.getTime());
    expect(nextRunAtMs!).toBeGreaterThanOrEqual(retryWindowFloor);
    expect(nextRunAtMs!).toBeLessThanOrEqual(retryWindowCeiling);

    const failedRun = ctx.db
      .select()
      .from(ctx.schema.runs)
      .all()
      .find((row) => row.error === "structured fill agent failed");
    expect(failedRun).toMatchObject({
      companyId: "company-1",
      status: "error",
      error: "structured fill agent failed",
    });
  });

  it("moves a newly created schedule to a one-day retry point when the research run fails", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let chatCallCount = 0;
    ctx.appContext.runAction = async (name: string) => {
      if (name === "chatgpt_chat") {
        chatCallCount += 1;
        return { status: "ok", data: "# Section\n\nGrounded research" };
      }

      if (name === "summon") {
        return {
          status: "error",
          error: "structured fill agent failed",
        };
      }

      return { status: "error", error: `unexpected action ${name}` };
    };

    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const retryWindowStart = Date.now();
    const result = await action.execute({
      canonical_name: "Beta Labs",
      company_domain: "beta.example",
    });
    const retryWindowEnd = Date.now();

    expect(result).toMatchObject({
      status: "error",
      error: "structured fill agent failed",
    });
    expect(chatCallCount).toBe(5);

    // status:"error" ActionResults no longer carry a data payload, so the newly
    // created company/schedule and the failed run are verified via DB state.
    const company = ctx.db
      .select()
      .from(ctx.schema.companies)
      .all()
      .find((row) => row.domain === "beta.example");
    expect(company).toBeDefined();
    expect(company?.domain).toBe("beta.example");

    const persistedSchedule = ctx.db
      .select()
      .from(ctx.schema.schedules)
      .all()
      .find((row) => row.companyId === company!.id);
    // A schedule was newly created for the company under research.
    expect(persistedSchedule).toBeDefined();
    expect(persistedSchedule?.companyId).toBe(company!.id);
    expect(persistedSchedule?.cadenceMonths).toBe(3);
    expect(persistedSchedule?.lastRunAt).toBeNull();
    const nextRunAtMs = persistedSchedule?.nextRunAt?.getTime();
    const retryWindowFloor = retryWindowStart + ONE_DAY_MS - 1000;
    const retryWindowCeiling = retryWindowEnd + ONE_DAY_MS + 1000;
    expect(nextRunAtMs).toBeDefined();
    expect(nextRunAtMs!).toBeGreaterThanOrEqual(retryWindowFloor);
    expect(nextRunAtMs!).toBeLessThanOrEqual(retryWindowCeiling);

    const failedRun = ctx.db
      .select()
      .from(ctx.schema.runs)
      .all()
      .find((row) => row.companyId === company!.id);
    expect(failedRun).toMatchObject({
      companyId: company!.id,
      status: "error",
      error: "structured fill agent failed",
    });
  });

  it("requires company_domain for company research runs", async () => {
    const action = createCompanyResearchRunCompanyResearchAction(
      buildConfig("company_research_run_company_research", "write"),
      {
        appContext: ctx.appContext,
      },
    );

    const result = await action.execute({
      canonical_name: "Beta Labs",
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("company_domain is required");
  });

  it("reads typed rows and filtered companies, runs, and provenance", async () => {
    const addProductAction = createCompanyResearchAddProductAction(
      buildConfig("company_research_add_product", "write"),
      {
        appContext: ctx.appContext,
      },
    );
    await addProductAction.execute({
      company_id: "company-1",
      run_id: "run-1",
      id: "product-1",
      product_name: "Atlas",
      product_category: "robotics",
      is_primary: true,
      provenance: [
        {
          field_name: "product_category",
          citation_url: "https://example.com/product-category",
          confidence: "high",
        },
      ],
    });

    const readRowsAction = createCompanyResearchReadRowsAction(
      buildConfig("company_research_read_rows", "read-only"),
      {
        appContext: ctx.appContext,
      },
    );
    const searchCompaniesAction = createCompanyResearchSearchCompaniesAction(
      buildConfig("company_research_search_companies", "read-only"),
      {
        appContext: ctx.appContext,
      },
    );
    const readRunsAction = createCompanyResearchReadRunsAction(
      buildConfig("company_research_read_runs", "read-only"),
      {
        appContext: ctx.appContext,
      },
    );
    const readProvenanceAction = createCompanyResearchReadProvenanceAction(
      buildConfig("company_research_read_provenance", "read-only"),
      {
        appContext: ctx.appContext,
      },
    );

    const rowsResult = await readRowsAction.execute({
      table: "products",
      filters: { company_id: "company-1", is_primary: true },
    });
    const companiesResult = await searchCompaniesAction.execute({
      query: "Acme",
    });
    const runsResult = await readRunsAction.execute({
      company_id: "company-1",
      status: "success",
    });
    const provenanceResult = await readProvenanceAction.execute({
      table_name: "products",
      field_name: "product_category",
    });

    expect(rowsResult.status).toBe("ok");
    expect(companiesResult.status).toBe("ok");
    expect(runsResult.status).toBe("ok");
    expect(provenanceResult.status).toBe("ok");

    expect((rowsResult.data as { rows: Array<{ productName: string }> }).rows).toEqual([
      expect.objectContaining({ productName: "Atlas" }),
    ]);
    expect((companiesResult.data as { companies: Array<{ canonicalName: string }> }).companies).toEqual([
      expect.objectContaining({ canonicalName: "Acme Robotics" }),
    ]);
    expect((runsResult.data as { runs: Array<{ id: string }> }).runs).toEqual([
      expect.objectContaining({
        id: "run-1",
        reports: [expect.objectContaining({ reportType: "company", reportContent: "Acme report" })],
      }),
    ]);
    expect((provenanceResult.data as { provenance: Array<{ tableName: string }> }).provenance).toEqual([
      expect.objectContaining({ tableName: "company_research__products" }),
    ]);
  });
});
