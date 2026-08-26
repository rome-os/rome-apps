import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createCompanyResearchDbSchema } from "../schema.js";
import { createCompanyResearchRepository } from "./company-research.js";

function createTestContext(): {
  sqlite: Database.Database;
  db: DrizzleDb;
  appDb: AppDbContext;
  tables: ReturnType<typeof createCompanyResearchDbSchema>;
} {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const migrationsDir = new URL("../migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrationFiles) {
    const migrationSql = readFileSync(new URL(file, migrationsDir), "utf8");
    for (const statement of migrationSql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        sqlite.exec(trimmed);
      }
    }
  }

  const tables = createCompanyResearchDbSchema("company_research");
  const db = drizzle(sqlite, { schema: tables }) as unknown as DrizzleDb;
  const appDb: AppDbContext = {
    connection: db,
    tablePrefix: "company_research",
    tableName(name: string) {
      return `company_research__${name}`;
    },
  };

  return { sqlite, db, appDb, tables };
}

function insertCompanyFixture(
  db: DrizzleDb,
  tables: ReturnType<typeof createCompanyResearchDbSchema>,
  input: {
    id: string;
    canonicalName: string;
    domain?: string | null;
    websiteUrl?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  db.insert(tables.entities)
    .values({
      id: input.id,
      entityType: "company",
      displayName: input.canonicalName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run();
  db.insert(tables.companies)
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
  tables: ReturnType<typeof createCompanyResearchDbSchema>,
  input: {
    id: string;
    fullName: string;
    linkedinUrl?: string | null;
    websiteUrl?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  db.insert(tables.entities)
    .values({
      id: input.id,
      entityType: "person",
      displayName: input.fullName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run();
  db.insert(tables.people)
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

describe("CompanyResearchRepository", () => {
  let sqlite: Database.Database;
  let db: DrizzleDb;
  let appDb: AppDbContext;
  let tables: ReturnType<typeof createCompanyResearchDbSchema>;

  beforeEach(() => {
    ({ sqlite, db, appDb, tables } = createTestContext());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts a product row and multiple provenance rows in one transaction", async () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        scheduledFor: new Date("2026-01-02T00:00:00Z"),
        startedAt: new Date("2026-01-02T01:00:00Z"),
        completedAt: new Date("2026-01-02T02:00:00Z"),
        promptVersion: "v1",
        extractorVersion: "e1",
        extractorOutput: "{}",
        error: null,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();

    const writeResult = await repo.addProduct({
      company_id: "company-1",
      run_id: "run-1",
      product_name: "Atlas",
      product_category: "research",
      is_primary: true,
      provenance: [
        {
          field_name: "product_name",
          citation_url: "https://example.com/products/atlas/",
          confidence: "high",
        },
        {
          citation_url: "https://example.com/company",
          reporting_basis: "third_party_reported",
          notes: "Row-level provenance",
        },
      ],
    });

    expect(writeResult.table).toBe("products");
    expect(writeResult.provenanceCount).toBe(2);

    const readResult = await repo.readRecords({
      table: "products",
      filters: {
        company_id: "company-1",
      },
      include_provenance: true,
    });

    expect(readResult.count).toBe(1);
    expect(readResult.rows[0]).toMatchObject({
      productName: "Atlas",
      companyId: "company-1",
      runId: "run-1",
      isPrimary: true,
    });
    expect((readResult.rows[0] as { provenance: Array<{ fieldName: string | null }> }).provenance).toHaveLength(2);
  });

  it("upserts people from identity urls when adding company person roles", async () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();
    insertPersonFixture(db, tables, {
      id: "person-1",
      fullName: "Jane Doe",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await repo.addCompanyPersonRole({
      company_id: "company-1",
      run_id: "run-1",
      person_name: "Jane Doe",
      linkedin_url: "https://www.linkedin.com/in/jane-doe/?utm_source=chatgpt.com&utm_medium=email",
      website_url: "https://example.com/team/jane-doe?utm_campaign=q2&utm_content=bio#intro",
      role_type: "key_executive",
      title: "CTO",
      provenance: [
        {
          field_name: "title",
          citation_url: "https://example.com/team/jane-doe?utm_campaign=q2&utm_content=bio#intro",
        },
      ],
    });

    expect(result).toMatchObject({
      table: "company_person_roles",
      person: expect.objectContaining({
        id: "person-1",
        fullName: "Jane Doe",
        linkedinUrl: "https://www.linkedin.com/in/jane-doe",
        websiteUrl: "https://example.com/team/jane-doe",
      }),
      record: expect.objectContaining({
        companyId: "company-1",
        personId: "person-1",
        runId: "run-1",
        title: "CTO",
      }),
      provenanceCount: 1,
      provenance: [expect.objectContaining({ citationUrl: "https://example.com/team/jane-doe" })],
    });
  });

  it("rejects a matched person URL when the provided name belongs to another person", () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();
    insertPersonFixture(db, tables, {
      id: "person-1",
      fullName: "Jane Doe",
      websiteUrl: "https://example.com/team",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(() =>
      repo.addCompanyPersonRole({
        company_id: "company-1",
        run_id: "run-1",
        person_name: "John Doe",
        website_url: "https://example.com/team",
        role_type: "employee",
      }),
    ).toThrow(
      "the URL is already used by another person. Check if you use a general team url instead of the person's profile url",
    );
  });

  it("stores paying customer counts when adding metrics", async () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();

    const result = await repo.addMetrics({
      company_id: "company-1",
      run_id: "run-1",
      metric_year: 2025,
      annual_revenue: 42_000_000,
      active_users: 125_000,
      active_users_type: "mau",
      paying_customers: 3_400,
      provenance: [
        {
          field_name: "paying_customers",
          citation_url: "https://example.com/customers",
          confidence: "high",
        },
      ],
    });

    expect(result).toMatchObject({
      table: "metrics",
      record: expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        metricYear: 2025,
        annualRevenue: 42_000_000,
        activeUsers: 125_000,
        activeUsersType: "mau",
        payingCustomers: 3_400,
      }),
      provenanceCount: 1,
      provenance: [expect.objectContaining({ fieldName: "paying_customers" })],
    });

    const metrics = db.select().from(tables.metrics).all();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      payingCustomers: 3_400,
    });
  });

  it("upserts related companies by normalized domain when adding relationships", async () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();

    const result = await repo.addCompanyRelationship({
      company_id: "company-1",
      run_id: "run-1",
      company_name: "Beta Labs",
      website_url: "https://www.beta.example/",
      relationship_type: "competitor",
      relationship_strength: "notable",
    });

    expect(result).toMatchObject({
      table: "company_relationships",
      relatedCompany: expect.objectContaining({
        canonicalName: "Beta Labs",
        domain: "beta.example",
      }),
      record: expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        relationshipType: "competitor",
        relationshipStrength: "notable",
      }),
    });

    const companies = db.select().from(tables.companies).all();
    expect(companies).toHaveLength(2);
    expect(companies[1]).toMatchObject({ domain: "beta.example" });
  });

  it("upserts investors and inserts financing round join rows", async () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();

    const result = await repo.addFinancingRound({
      company_id: "company-1",
      run_id: "run-1",
      round_type: "series_a",
      round_label: "Series A",
      announced_at: "2026-01-15",
      amount_raised: 18000000,
      amount_raised_currency: "USD",
      investors: [
        {
          investor_name: "North Star Ventures",
          website_url: "https://northstar.example/",
          investor_type: "venture_capital",
          investor_role: "lead",
        },
        {
          investor_name: "North Star Ventures",
          domain: "northstar.example",
          investor_role: "participant",
        },
      ],
      provenance: [
        {
          field_name: "amount_raised",
          citation_url: "https://example.com/series-a",
        },
      ],
    });

    expect(result).toMatchObject({
      table: "financing_rounds",
      provenanceCount: 1,
      record: expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        roundType: "series_a",
        amountRaised: 18000000,
      }),
      entities: [
        expect.objectContaining({
          displayName: "North Star Ventures",
          entityType: "company",
          domain: "northstar.example",
        }),
        expect.objectContaining({
          displayName: "North Star Ventures",
          entityType: "company",
          domain: "northstar.example",
        }),
      ],
      financingRoundInvestors: [
        expect.objectContaining({ investorRole: "lead" }),
        expect.objectContaining({ investorRole: "participant" }),
      ],
    });

    const entities = db.select().from(tables.entities).all();
    expect(entities).toHaveLength(2);

    const rounds = repo.readRows({
      table: "financing_rounds",
      filters: { company_id: "company-1", round_type: "series_a" },
      includeProvenance: true,
    });
    expect(rounds).toEqual([
      expect.objectContaining({
        roundType: "series_a",
        amountRaised: 18000000,
        provenance: [expect.objectContaining({ fieldName: "amount_raised" })],
      }),
    ]);

    const roundInvestors = repo.readRows({
      table: "financing_round_investors",
      filters: { investor_role: "lead" },
    });
    expect(roundInvestors).toHaveLength(1);
  });

  it("supports company search, run filters, and provenance filters", async () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    insertCompanyFixture(db, tables, {
      id: "company-2",
      canonicalName: "Beta Labs",
      domain: "beta.example",
      websiteUrl: "https://beta.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    db.insert(tables.runs)
      .values([
        {
          id: "run-1",
          companyId: "company-1",
          status: "success",
          scheduledFor: new Date("2026-01-02T00:00:00Z"),
          startedAt: new Date("2026-01-02T01:00:00Z"),
          completedAt: new Date("2026-01-02T02:00:00Z"),
          promptVersion: "v1",
          extractorVersion: "e1",
          extractorOutput: "{}",
          error: null,
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
        {
          id: "run-2",
          companyId: "company-2",
          status: "error",
          scheduledFor: new Date("2026-02-02T00:00:00Z"),
          startedAt: new Date("2026-02-02T01:00:00Z"),
          completedAt: new Date("2026-02-02T02:00:00Z"),
          promptVersion: "v2",
          extractorVersion: "e2",
          extractorOutput: null,
          error: "boom",
          createdAt: new Date("2026-02-02T00:00:00Z"),
        },
      ])
      .run();
    db.insert(tables.reports)
      .values({
        id: "report-1",
        companyId: "company-1",
        runId: "run-1",
        reportType: "company",
        reportContent: "Company overview",
        createdAt: new Date("2026-01-02T02:05:00Z"),
      })
      .run();

    db.insert(tables.products)
      .values({
        id: "product-1",
        companyId: "company-1",
        runId: "run-1",
        productName: "Atlas",
        productCategory: "research",
        valueProposition: "Automates company research",
        targetCustomerIcp: "B2B ops teams",
        isPrimary: true,
        createdAt: new Date("2026-01-02T02:30:00Z"),
      })
      .run();

    db.insert(tables.fieldProvenance)
      .values([
        {
          id: "prov-1",
          runId: "run-1",
          tableName: "company_research__products",
          rowId: "product-1",
          fieldName: "product_name",
          asOfDate: "2026-01-01",
          citationUrl: "https://example.com/products/atlas",
          confidence: "high",
          reportingBasis: "self_reported",
          notes: null,
          createdAt: new Date("2026-01-02T02:31:00Z"),
        },
      ])
      .run();

    expect(repo.searchCompanies({ query: "Acme" }).count).toBe(1);
    expect(repo.listRuns({ company_id: "company-1", status: "success" })).toMatchObject({
      count: 1,
      runs: [
        expect.objectContaining({
          id: "run-1",
          reports: [expect.objectContaining({ reportType: "company", reportContent: "Company overview" })],
        }),
      ],
    });
    expect(repo.listProvenance({ table_name: "products", field_name: "product_name" }).count).toBe(1);
  });

  it("syncs the entity mirror when ensureCompany updates an existing company", () => {
    const repo = createCompanyResearchRepository(appDb);
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const updatedAt = new Date("2026-02-01T00:00:00Z");

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt,
      updatedAt: createdAt,
    });

    db.update(tables.entities)
      .set({
        displayName: "Stale Acme Name",
        updatedAt: createdAt,
      })
      .where(eq(tables.entities.id, "company-1"))
      .run();

    const company = repo.ensureCompany({
      canonicalName: "Acme Intelligence",
      domain: "acme.example",
      updatedAt,
    });

    const entity = db.select().from(tables.entities).where(eq(tables.entities.id, "company-1")).all()[0];

    expect(company).toMatchObject({
      id: "company-1",
      canonicalName: "Acme Intelligence",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      updatedAt,
    });
    expect(entity).toMatchObject({
      id: "company-1",
      entityType: "company",
      displayName: "Acme Intelligence",
      createdAt,
      updatedAt,
    });
  });

  it("propagates request.runId into generic writes when row.run_id is omitted", () => {
    const repo = createCompanyResearchRepository(appDb);

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .run();

    const result = repo.writeRowWithProvenance({
      table: "products",
      runId: "run-1",
      row: {
        companyId: "company-1",
        productName: "Atlas",
        isPrimary: true,
      },
      provenance: [
        {
          fieldName: "productName",
          citationUrl: "https://example.com/products/atlas",
        },
      ],
    });

    expect(result).toMatchObject({
      table: "products",
      provenanceCount: 1,
      record: expect.objectContaining({
        companyId: "company-1",
        runId: "run-1",
        productName: "Atlas",
        isPrimary: true,
      }),
    });
  });

  it("enforces unique indexes declared by the schema in the migrations", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    insertCompanyFixture(db, tables, {
      id: "company-1",
      canonicalName: "Acme AI",
      domain: "acme.example",
      websiteUrl: "https://acme.example",
      createdAt: now,
      updatedAt: now,
    });
    db.insert(tables.runs)
      .values({
        id: "run-1",
        companyId: "company-1",
        status: "success",
        promptVersion: "v1",
        extractorVersion: "e1",
        createdAt: now,
      })
      .run();

    db.insert(tables.companySocialPages)
      .values({
        id: "social-1",
        companyId: "company-1",
        runId: "run-1",
        platform: "linkedin",
        pageUrl: "https://www.linkedin.com/company/acme-ai",
        createdAt: now,
      })
      .run();
    expect(() =>
      db.insert(tables.companySocialPages)
        .values({
          id: "social-2",
          companyId: "company-1",
          runId: "run-1",
          platform: "x",
          pageUrl: "https://www.linkedin.com/company/acme-ai",
          createdAt: now,
        })
        .run(),
    ).toThrow(/unique/i);

    insertPersonFixture(db, tables, {
      id: "person-1",
      fullName: "Jane Doe",
      websiteUrl: "https://example.com/team/jane-doe",
      createdAt: now,
      updatedAt: now,
    });
    expect(() =>
      insertPersonFixture(db, tables, {
        id: "person-2",
        fullName: "Jane Doe Duplicate",
        websiteUrl: "https://example.com/team/jane-doe",
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/unique/i);

    db.insert(tables.entities)
      .values({
        id: "investor-1",
        entityType: "company",
        displayName: "North Star Ventures",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(tables.companies)
      .values({
        id: "investor-1",
        canonicalName: "North Star Ventures",
        websiteUrl: "https://northstar.example",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(() =>
      insertCompanyFixture(db, tables, {
        id: "investor-2",
        canonicalName: "North Star Ventures II",
        websiteUrl: "https://northstar.example",
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/unique/i);

    db.insert(tables.jobPosts)
      .values({
        id: "job-1",
        companyId: "company-1",
        runId: "run-1",
        jobTitle: "Engineer",
        employmentType: "full-time",
        department: "engineering",
        location: "Remote",
        externalUrl: "https://example.com/jobs/engineer",
        createdAt: now,
      })
      .run();
    db.insert(tables.jobPosts)
      .values({
        id: "job-2",
        companyId: "company-1",
        runId: "run-1",
        jobTitle: "Engineer II",
        employmentType: "full-time",
        department: "engineering",
        location: "Remote",
        externalUrl: "https://example.com/jobs/engineer",
        createdAt: now,
      })
      .run();
    expect(() =>
      db.insert(tables.jobPosts)
        .values({
          id: "job-3",
          companyId: "company-1",
          runId: "run-1",
          jobTitle: "Engineer",
          employmentType: "full-time",
          department: "engineering",
          location: "Remote",
          externalUrl: "https://example.com/jobs/engineer-2",
          createdAt: now,
        })
        .run(),
    ).toThrow(/unique/i);

    db.insert(tables.notableEvents)
      .values({
        id: "event-1",
        companyId: "company-1",
        runId: "run-1",
        eventCategory: "product_launch",
        headline: "Launch 1",
        externalUrl: "https://example.com/news/launch",
        createdAt: now,
      })
      .run();
    expect(() =>
      db.insert(tables.notableEvents)
        .values({
          id: "event-2",
          companyId: "company-1",
          runId: "run-1",
          eventCategory: "product_launch",
          headline: "Launch 2",
          externalUrl: "https://example.com/news/launch",
          createdAt: now,
        })
        .run(),
    ).toThrow(/unique/i);

    db.insert(tables.financingRounds)
      .values({
        id: "round-1",
        companyId: "company-1",
        runId: "run-1",
        roundType: "series_a",
        announcedAt: "2026-01-15",
        createdAt: now,
      })
      .run();
    db.insert(tables.financingRoundInvestors)
      .values({
        id: "round-investor-1",
        financingRoundId: "round-1",
        entityId: "investor-1",
        investorRole: "lead",
        createdAt: now,
      })
      .run();
    expect(() =>
      db.insert(tables.financingRoundInvestors)
        .values({
          id: "round-investor-2",
          financingRoundId: "round-1",
          entityId: "investor-1",
          investorRole: "lead",
          createdAt: now,
        })
        .run(),
    ).toThrow(/unique/i);

    db.insert(tables.fieldProvenance)
      .values({
        id: "prov-1",
        runId: "run-1",
        tableName: "company_research__products",
        rowId: "product-1",
        fieldName: "product_name",
        createdAt: now,
      })
      .run();
    expect(() =>
      db.insert(tables.fieldProvenance)
        .values({
          id: "prov-2",
          runId: "run-1",
          tableName: "company_research__products",
          rowId: "product-1",
          fieldName: "product_name",
          createdAt: now,
        })
        .run(),
    ).toThrow(/unique/i);
  });
});
