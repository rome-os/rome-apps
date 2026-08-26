import { isIP } from "node:net";
import { TextDecoder } from "node:util";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { RomeAppApiHandler, RomeAppApiRequest, RomeAppContext } from "@rome-os/app-runtime";
import { createCompanyResearchDbSchema } from "../db/schema.js";
import {
  buildCompanyResearchReportSections,
  normalizeCompanySearchQuery,
  scoreCompanySearchCandidate,
  type CompanySearchCandidate,
} from "../lib/dashboard.js";

const SEARCHABLE_RUN_STATUSES = ["success", "partial"] as const;
const DEFAULT_SEARCH_LIMIT = 18;
const DEFAULT_RUN_LIMIT = 8;
const WEBSITE_TITLE_FETCH_TIMEOUT_MS = 8_000;
const WEBSITE_TITLE_MAX_BYTES = 256 * 1024;

const ROLE_TYPE_ORDER = {
  founder: 0,
  key_executive: 1,
  board_member: 2,
  employee: 3,
  alumni: 4,
} as const;

const INVESTOR_ROLE_ORDER = {
  lead: 0,
  participant: 1,
  existing: 2,
  other: 3,
} as const;

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function decodeJsonBody(request: RomeAppApiRequest): Record<string, unknown> {
  if (!request.body || request.body.length === 0) {
    return {};
  }

  const raw = new TextDecoder().decode(request.body);
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function clampLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(parsed, max));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function getLatestMetric(metrics: Array<{ metricYear: number }>): { metricYear: number } | null {
  return metrics[0] ?? null;
}

function normalizeCompanyWebsiteUrl(value: unknown): URL {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("website_url is required");
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("website_url must use http or https");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("website_url must include a public hostname");
  }
  if (isIP(hostname) !== 0) {
    throw new Error("website_url must use a public domain name");
  }

  return url;
}

function normalizeDomainFromUrl(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

function normalizeTitle(title: string): string {
  return decodeHtmlEntities(title)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return null;
  }

  const title = normalizeTitle(match[1]);
  return title.length > 0 ? title : null;
}

async function readResponsePrefix(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (totalBytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }

    const availableBytes = maxBytes - totalBytes;
    const chunk = value.byteLength > availableBytes ? value.slice(0, availableBytes) : value;
    chunks.push(chunk);
    totalBytes += chunk.byteLength;

    if (value.byteLength > availableBytes) {
      await reader.cancel();
      break;
    }
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  );
}

async function fetchWebsiteTitle(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBSITE_TITLE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Rome Company Research/0.1",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Website returned ${response.status}`);
    }

    const html = await readResponsePrefix(response, WEBSITE_TITLE_MAX_BYTES);
    const title = extractTitle(html);
    if (!title) {
      throw new Error("Website title was not found");
    }
    return title;
  } finally {
    clearTimeout(timeout);
  }
}

type DashboardFinancingRound = {
  id: string;
  roundType: string;
  roundLabel: string | null;
  announcedAt: string | null;
  amountRaised: number | null;
  amountRaisedCurrency: string | null;
  preMoneyValuation: number | null;
  preMoneyValuationCurrency: string | null;
  postMoneyValuation: number | null;
  postMoneyValuationCurrency: string | null;
  totalCapitalRaised: number | null;
  totalCapitalRaisedCurrency: string | null;
  investors: DashboardRoundInvestor[];
};

type DashboardRoundInvestor = {
  id: string;
  entityId: string;
  displayName: string;
  entityType: string;
  investorType: string | null;
  investorRole: string;
  websiteUrl: string | null;
};

function buildValuationEntry(round: DashboardFinancingRound) {
  if (round.postMoneyValuation !== null) {
    return {
      financingRoundId: round.id,
      roundType: round.roundType,
      roundLabel: round.roundLabel,
      announcedAt: round.announcedAt,
      amountRaised: round.amountRaised,
      amountRaisedCurrency: round.amountRaisedCurrency,
      valuation: round.postMoneyValuation,
      valuationCurrency: round.postMoneyValuationCurrency,
      valuationBasis: "post_money" as const,
    };
  }

  if (round.preMoneyValuation !== null) {
    return {
      financingRoundId: round.id,
      roundType: round.roundType,
      roundLabel: round.roundLabel,
      announcedAt: round.announcedAt,
      amountRaised: round.amountRaised,
      amountRaisedCurrency: round.amountRaisedCurrency,
      valuation: round.preMoneyValuation,
      valuationCurrency: round.preMoneyValuationCurrency,
      valuationBasis: "pre_money" as const,
    };
  }

  return null;
}

function buildLatestFinancingRound(round: DashboardFinancingRound | null) {
  if (!round) {
    return null;
  }

  const valuation = buildValuationEntry(round);

  return {
    financingRoundId: round.id,
    roundType: round.roundType,
    roundLabel: round.roundLabel,
    announcedAt: round.announcedAt,
    amountRaised: round.amountRaised,
    amountRaisedCurrency: round.amountRaisedCurrency,
    totalCapitalRaised: round.totalCapitalRaised,
    totalCapitalRaisedCurrency: round.totalCapitalRaisedCurrency,
    valuation: valuation?.valuation ?? null,
    valuationCurrency: valuation?.valuationCurrency ?? null,
    valuationBasis: valuation?.valuationBasis ?? null,
    investors: round.investors,
  };
}

function buildValuationHistory(financingRounds: DashboardFinancingRound[]) {
  return financingRounds
    .map((round) => buildValuationEntry(round))
    .filter(
      (round): round is NonNullable<ReturnType<typeof buildValuationEntry>> => round !== null,
    );
}

function sortRoles<
  T extends { roleType: string; isCurrent: boolean | null; fullName: string | null },
>(roles: T[]): T[] {
  return [...roles].sort((left, right) => {
    const currentDelta = Number(right.isCurrent ?? false) - Number(left.isCurrent ?? false);
    if (currentDelta !== 0) {
      return currentDelta;
    }

    const roleDelta =
      (ROLE_TYPE_ORDER[left.roleType as keyof typeof ROLE_TYPE_ORDER] ?? 99) -
      (ROLE_TYPE_ORDER[right.roleType as keyof typeof ROLE_TYPE_ORDER] ?? 99);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    return (left.fullName ?? "").localeCompare(right.fullName ?? "");
  });
}

function sortRoundInvestors<T extends { investorRole: string; displayName: string }>(
  investors: T[],
): T[] {
  return [...investors].sort((left, right) => {
    const roleDelta =
      (INVESTOR_ROLE_ORDER[left.investorRole as keyof typeof INVESTOR_ROLE_ORDER] ?? 99) -
      (INVESTOR_ROLE_ORDER[right.investorRole as keyof typeof INVESTOR_ROLE_ORDER] ?? 99);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

class CompanyResearchApiHandler implements RomeAppApiHandler {
  private readonly db;
  private readonly tables;

  constructor(private readonly ctx: RomeAppContext) {
    this.db = ctx.db.connection;
    this.tables = createCompanyResearchDbSchema(ctx.db.tablePrefix);
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path;

    if (request.method === "GET" && route.length === 0) {
      return json({
        appId: this.ctx.app.id,
        version: this.ctx.app.version,
        status: "ok",
      });
    }

    if (request.method === "GET" && route.length === 1 && route[0] === "search") {
      return this.searchCompanies(request);
    }

    if (request.method === "POST" && route.length === 1 && route[0] === "research-from-url") {
      return this.startResearchFromUrl(request);
    }

    if (
      request.method === "GET" &&
      route.length === 3 &&
      route[0] === "companies" &&
      route[2] === "dashboard"
    ) {
      return this.getCompanyDashboard(route[1]!);
    }

    return json(
      {
        error: "not_found",
        appId: this.ctx.app.id,
        message: `Unknown Company Research app API route: /${route.join("/")}`,
      },
      { status: 404 },
    );
  }

  private async startResearchFromUrl(request: RomeAppApiRequest): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = decodeJsonBody(request);
    } catch (error) {
      return json(
        {
          error: "invalid_request",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }

    let websiteUrl: URL;
    try {
      websiteUrl = normalizeCompanyWebsiteUrl(body.website_url ?? body.websiteUrl ?? body.url);
    } catch (error) {
      return json(
        {
          error: "invalid_url",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }

    let companyName: string;
    try {
      companyName = await fetchWebsiteTitle(websiteUrl);
    } catch (error) {
      return json(
        {
          error: "title_fetch_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 422 },
      );
    }

    const domain = normalizeDomainFromUrl(websiteUrl);
    void this.ctx
      .runAction("company_research_run_company_research", {
        canonical_name: companyName,
        company_domain: domain,
      })
      .then((result) => {
        if (result.status !== "ok") {
          this.ctx.log.error("background company research failed", {
            companyName,
            domain,
            error: result.status === "error" ? result.error : null,
          });
        }
      })
      .catch((error) => {
        this.ctx.log.error("background company research crashed", {
          companyName,
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return json(
      {
        accepted: true,
        companyName,
        domain,
        websiteUrl: websiteUrl.toString(),
      },
      { status: 202 },
    );
  }

  private async searchCompanies(request: RomeAppApiRequest): Promise<Response> {
    const rawQuery = request.query.get("query") ?? request.query.get("q");
    const query = normalizeCompanySearchQuery(rawQuery);
    const limit = clampLimit(request.query.get("limit"), DEFAULT_SEARCH_LIMIT, 50);
    const searchableCompanyIds = this.db
      .select({ companyId: this.tables.runs.companyId })
      .from(this.tables.runs)
      .where(inArray(this.tables.runs.status, [...SEARCHABLE_RUN_STATUSES]));

    const companies = this.db
      .select()
      .from(this.tables.companies)
      .where(
        and(
          inArray(this.tables.companies.id, searchableCompanyIds),
          query
            ? or(
                like(this.tables.companies.canonicalName, `%${query}%`),
                like(this.tables.companies.domain, `%${query}%`),
                like(this.tables.companies.websiteUrl, `%${query}%`),
              )
            : undefined,
        ),
      )
      .orderBy(this.tables.companies.canonicalName)
      .limit(query ? 100 : limit)
      .all();

    // Attach latest successful run to each company, filter out those without one
    const companiesWithRuns = companies
      .map((company) => {
        const latestRun =
          this.db
            .select({
              id: this.tables.runs.id,
              status: this.tables.runs.status,
              startedAt: this.tables.runs.startedAt,
              completedAt: this.tables.runs.completedAt,
            })
            .from(this.tables.runs)
            .where(
              and(
                eq(this.tables.runs.companyId, company.id),
                inArray(this.tables.runs.status, [...SEARCHABLE_RUN_STATUSES]),
              ),
            )
            .orderBy(
              desc(this.tables.runs.completedAt),
              desc(this.tables.runs.startedAt),
              desc(this.tables.runs.createdAt),
            )
            .limit(1)
            .all()[0] ?? null;

        return { ...company, latestRun };
      })
      .filter((company) => company.latestRun !== null);

    const ranked = companiesWithRuns
      .map((company) => ({
        ...company,
        score: scoreCompanySearchCandidate(company satisfies CompanySearchCandidate, query),
      }))
      .filter((company) => (query ? company.score > 0 : true))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.canonicalName.localeCompare(right.canonicalName);
      })
      .slice(0, limit);

    // Count only companies with successful runs
    const allCompanyIds = this.db
      .select({ id: this.tables.companies.id })
      .from(this.tables.companies)
      .all();
    let researchedCount = 0;
    for (const { id } of allCompanyIds) {
      const hasRun = this.db
        .select({ id: this.tables.runs.id })
        .from(this.tables.runs)
        .where(
          and(
            eq(this.tables.runs.companyId, id),
            inArray(this.tables.runs.status, [...SEARCHABLE_RUN_STATUSES]),
          ),
        )
        .limit(1)
        .all();
      if (hasRun.length > 0) {
        researchedCount++;
      }
    }

    return json({
      query: rawQuery ?? "",
      normalizedQuery: query,
      trackedCompanies: researchedCount,
      count: ranked.length,
      companies: ranked,
    });
  }

  private async getCompanyDashboard(companyId: string): Promise<Response> {
    const company = this.db
      .select()
      .from(this.tables.companies)
      .where(eq(this.tables.companies.id, companyId))
      .limit(1)
      .all()[0];

    if (!company) {
      return json(
        {
          error: "not_found",
          appId: this.ctx.app.id,
          message: `Unknown company id: ${companyId}`,
        },
        { status: 404 },
      );
    }

    const [schedule, recentRuns] = await Promise.all([
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.schedules)
          .where(eq(this.tables.schedules.companyId, companyId))
          .limit(1)
          .all()[0] ?? null,
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.runs)
          .where(eq(this.tables.runs.companyId, companyId))
          .orderBy(
            desc(this.tables.runs.completedAt),
            desc(this.tables.runs.startedAt),
            desc(this.tables.runs.createdAt),
          )
          .limit(DEFAULT_RUN_LIMIT)
          .all(),
      ),
    ]);

    const activeRun =
      recentRuns.find((run) =>
        SEARCHABLE_RUN_STATUSES.includes(run.status as (typeof SEARCHABLE_RUN_STATUSES)[number]),
      ) ??
      recentRuns[0] ??
      null;

    if (!activeRun) {
      return json({
        company,
        schedule,
        activeRun: null,
        runs: recentRuns,
        reports: buildCompanyResearchReportSections([]),
        overview: {
          attributes: null,
          products: [],
          socialPages: [],
        },
        team: {
          people: [],
          jobPosts: [],
        },
        customersAndMetrics: {
          customers: [],
          competitors: [],
          notableEvents: [],
          metricHighlights: [],
        },
        financials: {
          latestMetric: null,
          metrics: [],
          rounds: [],
          latestRound: null,
          latestValuation: null,
          valuationHistory: [],
        },
      });
    }

    const runId = activeRun.id;
    const [
      attributesRow,
      socialPages,
      products,
      rawRoles,
      jobPosts,
      notableEvents,
      relationshipRows,
      metrics,
      financingRounds,
      reportRows,
    ] = await Promise.all([
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.companyAttributes)
          .where(
            and(
              eq(this.tables.companyAttributes.companyId, companyId),
              eq(this.tables.companyAttributes.runId, runId),
            ),
          )
          .limit(1)
          .all()[0] ?? null,
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.companySocialPages)
          .where(
            and(
              eq(this.tables.companySocialPages.companyId, companyId),
              eq(this.tables.companySocialPages.runId, runId),
            ),
          )
          .orderBy(this.tables.companySocialPages.platform)
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.products)
          .where(
            and(
              eq(this.tables.products.companyId, companyId),
              eq(this.tables.products.runId, runId),
            ),
          )
          .orderBy(desc(this.tables.products.isPrimary), this.tables.products.productName)
          .all(),
      ),
      Promise.resolve(
        this.db
          .select({
            id: this.tables.companyPersonRoles.id,
            companyId: this.tables.companyPersonRoles.companyId,
            personId: this.tables.companyPersonRoles.personId,
            runId: this.tables.companyPersonRoles.runId,
            roleType: this.tables.companyPersonRoles.roleType,
            title: this.tables.companyPersonRoles.title,
            department: this.tables.companyPersonRoles.department,
            bio: this.tables.companyPersonRoles.bio,
            isCurrent: this.tables.companyPersonRoles.isCurrent,
            startDate: this.tables.companyPersonRoles.startDate,
            endDate: this.tables.companyPersonRoles.endDate,
            createdAt: this.tables.companyPersonRoles.createdAt,
            fullName: this.tables.people.fullName,
            linkedinUrl: this.tables.people.linkedinUrl,
            websiteUrl: this.tables.people.websiteUrl,
          })
          .from(this.tables.companyPersonRoles)
          .leftJoin(
            this.tables.people,
            eq(this.tables.companyPersonRoles.personId, this.tables.people.id),
          )
          .where(
            and(
              eq(this.tables.companyPersonRoles.companyId, companyId),
              eq(this.tables.companyPersonRoles.runId, runId),
            ),
          )
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.jobPosts)
          .where(
            and(
              eq(this.tables.jobPosts.companyId, companyId),
              eq(this.tables.jobPosts.runId, runId),
            ),
          )
          .orderBy(desc(this.tables.jobPosts.postedAt), desc(this.tables.jobPosts.createdAt))
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.notableEvents)
          .where(
            and(
              eq(this.tables.notableEvents.companyId, companyId),
              eq(this.tables.notableEvents.runId, runId),
            ),
          )
          .orderBy(
            desc(this.tables.notableEvents.eventDate),
            desc(this.tables.notableEvents.createdAt),
          )
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.companyRelationships)
          .where(
            and(
              eq(this.tables.companyRelationships.companyId, companyId),
              eq(this.tables.companyRelationships.runId, runId),
            ),
          )
          .orderBy(this.tables.companyRelationships.relationshipType)
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.metrics)
          .where(
            and(eq(this.tables.metrics.companyId, companyId), eq(this.tables.metrics.runId, runId)),
          )
          .orderBy(desc(this.tables.metrics.metricYear))
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.financingRounds)
          .where(
            and(
              eq(this.tables.financingRounds.companyId, companyId),
              eq(this.tables.financingRounds.runId, runId),
            ),
          )
          .orderBy(
            desc(this.tables.financingRounds.announcedAt),
            desc(this.tables.financingRounds.createdAt),
          )
          .all(),
      ),
      Promise.resolve(
        this.db
          .select()
          .from(this.tables.reports)
          .where(eq(this.tables.reports.runId, runId))
          .all(),
      ),
    ]);

    const financingRoundInvestors = financingRounds.length
      ? this.db
          .select({
            id: this.tables.financingRoundInvestors.id,
            financingRoundId: this.tables.financingRoundInvestors.financingRoundId,
            entityId: this.tables.financingRoundInvestors.entityId,
            displayName: this.tables.entities.displayName,
            entityType: this.tables.entities.entityType,
            investorType: this.tables.financingRoundInvestors.investorType,
            investorRole: this.tables.financingRoundInvestors.investorRole,
            websiteUrl: sql<string | null>`coalesce(${this.tables.companies.websiteUrl}, ${this.tables.people.websiteUrl})`,
          })
          .from(this.tables.financingRoundInvestors)
          .innerJoin(
            this.tables.entities,
            eq(this.tables.financingRoundInvestors.entityId, this.tables.entities.id),
          )
          .leftJoin(
            this.tables.companies,
            eq(this.tables.companies.id, this.tables.entities.id),
          )
          .leftJoin(
            this.tables.people,
            eq(this.tables.people.id, this.tables.entities.id),
          )
          .where(
            inArray(
              this.tables.financingRoundInvestors.financingRoundId,
              financingRounds.map((round) => round.id),
            ),
          )
          .all()
      : [];

    const roundInvestorMap = new Map<string, DashboardRoundInvestor[]>();
    for (const investor of financingRoundInvestors) {
      const current = roundInvestorMap.get(investor.financingRoundId) ?? [];
      current.push({
        id: investor.id,
        entityId: investor.entityId,
        displayName: investor.displayName,
        entityType: investor.entityType,
        investorType: investor.investorType,
        investorRole: investor.investorRole,
        websiteUrl: investor.websiteUrl,
      });
      roundInvestorMap.set(investor.financingRoundId, current);
    }

    const financingRoundsWithInvestors = financingRounds.map((round) => ({
      ...round,
      investors: sortRoundInvestors(roundInvestorMap.get(round.id) ?? []),
    }));

    const relatedCompanies = relationshipRows.length
      ? this.db
          .select({
            id: this.tables.companies.id,
            canonicalName: this.tables.companies.canonicalName,
            domain: this.tables.companies.domain,
            websiteUrl: this.tables.companies.websiteUrl,
          })
          .from(this.tables.companies)
          .where(
            inArray(
              this.tables.companies.id,
              Array.from(new Set(relationshipRows.map((row) => row.relatedCompanyId))),
            ),
          )
          .all()
      : [];

    const relatedCompanyMap = new Map(relatedCompanies.map((entry) => [entry.id, entry]));

    const relationships = relationshipRows.map((row) => ({
      ...row,
      relatedCompany: relatedCompanyMap.get(row.relatedCompanyId) ?? null,
    }));

    const reports = buildCompanyResearchReportSections(reportRows);
    const attributes = attributesRow
      ? {
          ...attributesRow,
          primaryGeographies: normalizeStringArray(attributesRow.primaryGeographies),
          industryTags: normalizeStringArray(attributesRow.industryTags),
          customerSegmentsServed: normalizeStringArray(attributesRow.customerSegmentsServed),
        }
      : null;

    const sortedRoles = sortRoles(rawRoles);
    const metricHighlights = metrics.slice(0, 3);
    const valuationHistory = buildValuationHistory(financingRoundsWithInvestors);

    return json({
      company,
      schedule,
      activeRun,
      runs: recentRuns,
      reports,
      overview: {
        attributes,
        products,
        socialPages,
      },
      team: {
        people: sortedRoles,
        jobPosts,
      },
      customersAndMetrics: {
        customers: relationships.filter((row) => row.relationshipType === "customer"),
        competitors: relationships.filter((row) => row.relationshipType === "competitor"),
        notableEvents,
        metricHighlights,
      },
      financials: {
        latestMetric: getLatestMetric(metrics),
        metrics,
        rounds: financingRoundsWithInvestors,
        latestRound: buildLatestFinancingRound(financingRoundsWithInvestors[0] ?? null),
        latestValuation: valuationHistory[0] ?? null,
        valuationHistory,
      },
    });
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new CompanyResearchApiHandler(ctx);
}
