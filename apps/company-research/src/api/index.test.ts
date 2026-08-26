import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppDbContext,
  DrizzleDb,
  Logger,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createCompanyResearchDbSchema } from "../db/schema.js";
import { createApiHandler } from "./index.js";

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

function createTestContext(): {
  sqlite: Database.Database;
  db: DrizzleDb;
  schema: ReturnType<typeof createCompanyResearchDbSchema>;
  appContext: RomeAppContext;
} {
  const sqlite = new Database(":memory:");
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

  return {
    sqlite,
    db,
    schema,
    appContext: {
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
    },
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

function insertRunFixture(
  db: DrizzleDb,
  schema: ReturnType<typeof createCompanyResearchDbSchema>,
  input: {
    id: string;
    companyId: string;
    status: "running" | "success" | "partial" | "error";
    createdAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
  },
) {
  db.insert(schema.runs)
    .values({
      id: input.id,
      companyId: input.companyId,
      status: input.status,
      createdAt: input.createdAt,
      startedAt: input.startedAt ?? input.createdAt,
      completedAt: input.completedAt ?? null,
    })
    .run();
}

describe("CompanyResearchApiHandler", () => {
  let sqlite: Database.Database;
  let db: DrizzleDb;
  let schema: ReturnType<typeof createCompanyResearchDbSchema>;
  let appContext: RomeAppContext;

  beforeEach(() => {
    ({ sqlite, db, schema, appContext } = createTestContext());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sqlite.close();
  });

  it("fetches a website title and starts company research in the background", async () => {
    const runAction = vi.fn(async () => ({ status: "ok" }));
    appContext.runAction = runAction;
    const fetchMock = vi.fn(async () => {
      return new Response("<html><head><title>Acme &amp; Co</title></head><body></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const handler = createApiHandler(appContext);
    const response = await handler.handle({
      method: "POST",
      path: ["research-from-url"],
      headers: {},
      query: new URLSearchParams(),
      body: Buffer.from(JSON.stringify({ website_url: "acme.example/company" })),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      companyName: "Acme & Co",
      domain: "acme.example",
      websiteUrl: "https://acme.example/company",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://acme.example/company"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/html,application/xhtml+xml",
        }),
      }),
    );
    expect(runAction).toHaveBeenCalledWith("company_research_run_company_research", {
      canonical_name: "Acme & Co",
      company_domain: "acme.example",
    });
  });

  it("does not start company research when the website title cannot be fetched", async () => {
    const runAction = vi.fn(async () => ({ status: "ok" }));
    appContext.runAction = runAction;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>No title</body></html>", { status: 200 })),
    );

    const handler = createApiHandler(appContext);
    const response = await handler.handle({
      method: "POST",
      path: ["research-from-url"],
      headers: {},
      query: new URLSearchParams(),
      body: Buffer.from(JSON.stringify({ website_url: "https://missing-title.example" })),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "title_fetch_failed",
    });
    expect(runAction).not.toHaveBeenCalled();
  });

  it("searches researched companies before applying the empty-query limit", async () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    for (let index = 0; index < 8; index++) {
      insertCompanyFixture(db, schema, {
        id: `unresearched-${index}`,
        canonicalName: `Aardvark Prospect ${index}`,
        domain: `aardvark-${index}.example`,
        createdAt: now,
        updatedAt: now,
      });
    }
    insertCompanyFixture(db, schema, {
      id: "researched-1",
      canonicalName: "Zeta Research",
      domain: "zeta.example",
      createdAt: now,
      updatedAt: now,
    });
    insertCompanyFixture(db, schema, {
      id: "researched-2",
      canonicalName: "Zing Research",
      domain: "zing.example",
      createdAt: now,
      updatedAt: now,
    });
    insertRunFixture(db, schema, {
      id: "run-zeta",
      companyId: "researched-1",
      status: "success",
      createdAt: now,
      completedAt: now,
    });
    insertRunFixture(db, schema, {
      id: "run-zing",
      companyId: "researched-2",
      status: "partial",
      createdAt: now,
      completedAt: now,
    });

    const handler = createApiHandler(appContext);
    const response = await handler.handle({
      method: "GET",
      path: ["search"],
      headers: {},
      query: new URLSearchParams({ limit: "2" }),
    });
    const payload = (await response.json()) as {
      trackedCompanies: number;
      count: number;
      companies: Array<{ canonicalName: string; latestRun: { status: string } | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.trackedCompanies).toBe(2);
    expect(payload.count).toBe(2);
    expect(payload.companies).toEqual([
      expect.objectContaining({
        canonicalName: "Zeta Research",
        latestRun: expect.objectContaining({ status: "success" }),
      }),
      expect.objectContaining({
        canonicalName: "Zing Research",
        latestRun: expect.objectContaining({ status: "partial" }),
      }),
    ]);
  });

  it("returns latest revenue, profit, and valuation history for the dashboard financials payload", async () => {
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
        reportType: "financials",
        reportContent: "# Financials\n\nAcme financials",
        createdAt: now,
      })
      .run();

    db.insert(schema.metrics)
      .values({
        id: "metric-2025",
        companyId: "company-1",
        runId: "run-1",
        metricYear: 2025,
        annualRevenue: 42_000_000,
        originalRevenueType: "revenue",
        originalRevenueValue: "42M",
        originalRevenueCurrency: "USD",
        profit: 7_500_000,
        originalProfitType: "ebitda",
        originalProfitValue: "7.5M",
        originalProfitCurrency: "USD",
        headcountTotal: 180,
        activeUsers: 125_000,
        activeUsersType: "mau",
        payingCustomers: 3_400,
        createdAt: now,
      })
      .run();

    db.insert(schema.financingRounds)
      .values([
        {
          id: "round-seed",
          companyId: "company-1",
          runId: "run-1",
          roundType: "seed",
          roundLabel: "Seed",
          announcedAt: "2023-03-15",
          amountRaised: 8_000_000,
          amountRaisedCurrency: "USD",
          postMoneyValuation: 32_000_000,
          postMoneyValuationCurrency: "USD",
          createdAt: now,
        },
        {
          id: "round-series-a",
          companyId: "company-1",
          runId: "run-1",
          roundType: "series_a",
          roundLabel: "Series A",
          announcedAt: "2024-07-01",
          amountRaised: 25_000_000,
          amountRaisedCurrency: "USD",
          preMoneyValuation: 95_000_000,
          preMoneyValuationCurrency: "USD",
          createdAt: now,
        },
        {
          id: "round-debt",
          companyId: "company-1",
          runId: "run-1",
          roundType: "debt",
          roundLabel: "Debt facility",
          announcedAt: "2025-09-10",
          amountRaised: 15_000_000,
          amountRaisedCurrency: "USD",
          createdAt: now,
        },
      ])
      .run();

    db.insert(schema.entities)
      .values([
        {
          id: "investor-company-1",
          entityType: "company",
          displayName: "North Star Ventures",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "investor-company-2",
          entityType: "company",
          displayName: "Signal Peak Capital",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    db.insert(schema.financingRoundInvestors)
      .values([
        {
          id: "round-investor-1",
          financingRoundId: "round-series-a",
          entityId: "investor-company-1",
          investorType: "venture_capital",
          investorRole: "lead",
          createdAt: now,
        },
        {
          id: "round-investor-2",
          financingRoundId: "round-series-a",
          entityId: "investor-company-2",
          investorType: "venture_capital",
          investorRole: "participant",
          createdAt: now,
        },
      ])
      .run();

    const handler = createApiHandler(appContext);
    const request: RomeAppApiRequest = {
      method: "GET",
      path: ["companies", "company-1", "dashboard"],
      headers: {},
      query: new URLSearchParams(),
    };

    const response = await handler.handle(request);
    const payload = (await response.json()) as {
      financials: {
        latestMetric: {
          annualRevenue: number;
          profit: number;
          metricYear: number;
          activeUsers: number | null;
          activeUsersType: string | null;
          payingCustomers: number | null;
        } | null;
        rounds: Array<{
          id: string;
          investors: Array<{
            displayName: string;
            investorRole: string;
            investorType: string | null;
          }>;
        }>;
        latestRound: {
          financingRoundId: string;
          amountRaised: number | null;
          totalCapitalRaised: number | null;
          valuation: number | null;
          valuationBasis: string | null;
          roundLabel: string | null;
        } | null;
        latestValuation: {
          financingRoundId: string;
          valuation: number;
          valuationBasis: string;
          roundLabel: string | null;
        } | null;
        valuationHistory: Array<{
          financingRoundId: string;
          valuation: number;
          valuationBasis: string;
          roundLabel: string | null;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.financials.latestMetric).toMatchObject({
      metricYear: 2025,
      annualRevenue: 42_000_000,
      profit: 7_500_000,
      activeUsers: 125_000,
      activeUsersType: "mau",
      payingCustomers: 3_400,
    });
    expect(payload.financials.latestRound).toMatchObject({
      financingRoundId: "round-debt",
      amountRaised: 15_000_000,
      totalCapitalRaised: null,
      valuation: null,
      valuationBasis: null,
      roundLabel: "Debt facility",
    });
    expect(payload.financials.latestValuation).toMatchObject({
      financingRoundId: "round-series-a",
      valuation: 95_000_000,
      valuationBasis: "pre_money",
      roundLabel: "Series A",
    });
    expect(payload.financials.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "round-series-a",
          investors: [
            expect.objectContaining({
              displayName: "North Star Ventures",
              investorRole: "lead",
              investorType: "venture_capital",
            }),
            expect.objectContaining({
              displayName: "Signal Peak Capital",
              investorRole: "participant",
              investorType: "venture_capital",
            }),
          ],
        }),
      ]),
    );
    expect(payload.financials.valuationHistory).toEqual([
      expect.objectContaining({
        financingRoundId: "round-series-a",
        valuation: 95_000_000,
        valuationBasis: "pre_money",
      }),
      expect.objectContaining({
        financingRoundId: "round-seed",
        valuation: 32_000_000,
        valuationBasis: "post_money",
      }),
    ]);
  });

  it("returns the latest round total capital raised when it is stored", async () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    insertCompanyFixture(db, schema, {
      id: "company-2",
      canonicalName: "Northstar Bio",
      domain: "northstar.example",
      websiteUrl: "https://northstar.example",
      createdAt: now,
      updatedAt: now,
    });

    db.insert(schema.runs)
      .values({
        id: "run-2",
        companyId: "company-2",
        status: "success",
        promptVersion: "prompt-v1",
        extractorVersion: "extractor-v1",
        createdAt: now,
        completedAt: now,
      })
      .run();
    db.insert(schema.reports)
      .values({
        id: "report-2",
        companyId: "company-2",
        runId: "run-2",
        reportType: "financials",
        reportContent: "# Financials\n\nNorthstar financials",
        createdAt: now,
      })
      .run();

    db.insert(schema.financingRounds)
      .values({
        id: "round-series-b",
        companyId: "company-2",
        runId: "run-2",
        roundType: "series_b",
        roundLabel: "Series B",
        announcedAt: "2025-01-20",
        amountRaised: 40_000_000,
        amountRaisedCurrency: "USD",
        postMoneyValuation: 220_000_000,
        postMoneyValuationCurrency: "USD",
        totalCapitalRaised: 68_000_000,
        totalCapitalRaisedCurrency: "USD",
        createdAt: now,
      })
      .run();

    const handler = createApiHandler(appContext);
    const request: RomeAppApiRequest = {
      method: "GET",
      path: ["companies", "company-2", "dashboard"],
      headers: {},
      query: new URLSearchParams(),
    };

    const response = await handler.handle(request);
    const payload = (await response.json()) as {
      financials: {
        latestRound: {
          financingRoundId: string;
          amountRaised: number | null;
          totalCapitalRaised: number | null;
          valuation: number | null;
          valuationBasis: string | null;
        } | null;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.financials.latestRound).toMatchObject({
      financingRoundId: "round-series-b",
      amountRaised: 40_000_000,
      totalCapitalRaised: 68_000_000,
      valuation: 220_000_000,
      valuationBasis: "post_money",
    });
  });
});
