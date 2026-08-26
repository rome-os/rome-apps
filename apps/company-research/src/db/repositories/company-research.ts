import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createCompanyResearchDbSchema } from "../schema.js";
import {
  COMPANY_DEPARTMENTS,
  COMPANY_RESEARCH_ACTIVE_USER_TYPES,
  COMPANY_RESEARCH_ENTITY_TYPES,
  COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES,
  COMPANY_RESEARCH_FINANCING_ROUND_TYPES,
  COMPANY_RESEARCH_INVESTOR_TYPES,
  COMPANY_PERSON_ROLE_TYPES,
  COMPANY_RELATIONSHIP_TYPES,
  COMPANY_RESEARCH_CONFIDENCE_VALUES,
  COMPANY_RESEARCH_EVENT_CATEGORIES,
  COMPANY_RESEARCH_READABLE_TABLES,
  COMPANY_RESEARCH_REPORT_TYPES,
  COMPANY_RESEARCH_REPORTING_BASIS_VALUES,
  COMPANY_RESEARCH_RUN_STATUSES,
  COMPANY_RESEARCH_TABLES,
  COMPANY_RESEARCH_WRITABLE_TABLES,
  COMPANY_SOCIAL_PAGE_PLATFORMS,
  type CompanyResearchReadableTable,
  type CompanyResearchReportType,
  type CompanyResearchTable,
  type CompanyResearchWritableTable,
} from "../../lib/types.js";

type JsonObject = Record<string, unknown>;

export interface CompanyResearchWriteRowRequest {
  table: CompanyResearchWritableTable;
  row: Record<string, unknown>;
  runId?: string;
  provenance?: Record<string, unknown>[];
}

export interface CompanyResearchReadRowsRequest {
  table: CompanyResearchReadableTable;
  filters?: Record<string, unknown>;
  limit?: number;
  includeProvenance?: boolean;
}

export interface CompanySearchRequest {
  id?: string;
  ids?: string[];
  query?: string;
  domain?: string;
  websiteUrl?: string;
  limit?: number;
}

export interface CompanyRunsReadRequest {
  id?: string;
  ids?: string[];
  companyId?: string;
  status?: string;
  promptVersion?: string;
  extractorVersion?: string;
  scheduledForFrom?: string;
  scheduledForTo?: string;
  startedAtFrom?: string;
  startedAtTo?: string;
  completedAtFrom?: string;
  completedAtTo?: string;
  limit?: number;
}

export interface CompanyProvenanceReadRequest {
  id?: string;
  ids?: string[];
  runId?: string;
  tableName?: string;
  rowId?: string;
  fieldName?: string;
  fieldNameIsNull?: boolean;
  citationUrl?: string;
  confidence?: string;
  reportingBasis?: string;
  asOfDateFrom?: string;
  asOfDateTo?: string;
  limit?: number;
}

export interface EnsureCompanyRequest {
  canonicalName: string;
  domain: string;
  websiteUrl?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EnsureScheduleRequest {
  companyId: string;
  cadenceMonths: number;
  isActive?: boolean;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateCompanyResearchRunRequest {
  id?: string;
  companyId: string;
  status: (typeof COMPANY_RESEARCH_RUN_STATUSES)[number];
  scheduledFor?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  promptVersion?: string | null;
  extractorVersion?: string | null;
  extractorOutput?: string | null;
  error?: string | null;
  createdAt?: Date;
}

export interface UpdateCompanyResearchRunRequest {
  status?: (typeof COMPANY_RESEARCH_RUN_STATUSES)[number];
  scheduledFor?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  promptVersion?: string | null;
  extractorVersion?: string | null;
  extractorOutput?: string | null;
  error?: string | null;
}

export interface ReplaceCompanyResearchRunReportsRequest {
  companyId: string;
  runId: string;
  reports: Array<{
    id?: string;
    reportType: CompanyResearchReportType;
    reportContent: string;
    createdAt?: Date;
  }>;
}

export interface UpdateCompanyResearchScheduleRequest {
  cadenceMonths?: number;
  isActive?: boolean;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  updatedAt?: Date;
}

function assertObject(value: unknown, fieldName: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as JsonObject;
}

function readOptionalString(record: JsonObject, fieldName: string): string | null {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalStringFromAliases(record: JsonObject, fieldNames: string[]): string | null {
  for (const fieldName of fieldNames) {
    const value = readOptionalString(record, fieldName);
    if (value) {
      return value;
    }
  }
  return null;
}

function readRequiredString(record: JsonObject, fieldName: string): string {
  const value = readOptionalString(record, fieldName);
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function readOptionalStringArray(record: JsonObject, fieldName: string): string[] | null {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${fieldName}[${index}] must be a string`);
    }
    return item.trim();
  });
}

function readOptionalInteger(record: JsonObject, fieldName: string): number | null {
  const value = record[fieldName];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return value;
}

function readOptionalNumberLikeString(record: JsonObject, fieldName: string): string | null {
  const value = record[fieldName];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`${fieldName} must be a number or numeric string`);
    }
    return trimmed;
  }
  throw new Error(`${fieldName} must be a number or numeric string`);
}

function readOptionalBoolean(record: JsonObject, fieldName: string): boolean | null {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function readOptionalEnum<T extends readonly string[]>(
  record: JsonObject,
  fieldName: string,
  values: T,
): T[number] | null {
  const value = readOptionalString(record, fieldName);
  if (!value) {
    return null;
  }
  if (!values.includes(value as T[number])) {
    throw new Error(`${fieldName} must be one of: ${values.join(", ")}`);
  }
  return value as T[number];
}

function readOptionalDateString(record: JsonObject, fieldName: string): string | null {
  const value = readOptionalString(record, fieldName);
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD date string`);
  }
  return value;
}

function readOptionalTimestamp(record: JsonObject, fieldName: string): Date | null {
  const value = record[fieldName];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${fieldName} must be a valid ISO timestamp or epoch`);
    }
    return parsed;
  }
  throw new Error(`${fieldName} must be a valid timestamp`);
}

function readOptionalStringFilter(record: JsonObject | undefined, fieldName: string): string | undefined {
  if (!record) {
    return undefined;
  }
  return readOptionalString(record, fieldName) ?? undefined;
}

function readOptionalBooleanFilter(record: JsonObject | undefined, fieldName: string): boolean | undefined {
  if (!record) {
    return undefined;
  }
  return readOptionalBoolean(record, fieldName) ?? undefined;
}

function readOptionalIntegerFilter(record: JsonObject | undefined, fieldName: string): number | undefined {
  if (!record) {
    return undefined;
  }
  return readOptionalInteger(record, fieldName) ?? undefined;
}

function readOptionalDateFilter(record: JsonObject | undefined, fieldName: string): string | undefined {
  if (!record) {
    return undefined;
  }
  return readOptionalDateString(record, fieldName) ?? undefined;
}

function readOptionalStringArrayFilter(
  record: JsonObject | undefined,
  fieldName: string,
): string[] | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${fieldName}[${index}] must be a string`);
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new Error(`${fieldName}[${index}] must not be empty`);
    }
    return trimmed;
  });
}

function normalizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const normalizedSearchParams = new URLSearchParams();
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (key.toLowerCase().startsWith("utm_")) {
        continue;
      }
      normalizedSearchParams.append(key, paramValue);
    }
    url.search = normalizedSearchParams.toString();
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeDomain(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalizeHost = (host: string): string | null => {
    const normalized = host.trim().toLowerCase().replace(/^www\./, "");
    return normalized.length > 0 ? normalized : null;
  };

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return normalizeHost(parsed.hostname);
  } catch {
    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, "");
    const host = withoutScheme.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
    return normalizeHost(host);
  }
}

function normalizeSearchQuery(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? `%${trimmed}%` : undefined;
}

function normalizePersonNameForMatch(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function camelToSnakeKey(value: string): string {
  return value.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeys(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      camelToSnakeKey(key),
      normalizeKeys(entry),
    ]),
  );
}

function resolveLimit(raw: unknown, fallback: number = 50): number {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error("limit must be an integer");
  }
  return Math.max(1, Math.min(raw, 200));
}

function expectWritableTable(value: unknown): CompanyResearchWritableTable {
  if (typeof value !== "string" || !COMPANY_RESEARCH_WRITABLE_TABLES.includes(value as never)) {
    throw new Error(`table must be one of: ${COMPANY_RESEARCH_WRITABLE_TABLES.join(", ")}`);
  }
  return value as CompanyResearchWritableTable;
}

function expectReadableTable(value: unknown): CompanyResearchReadableTable {
  if (typeof value !== "string" || !COMPANY_RESEARCH_READABLE_TABLES.includes(value as never)) {
    throw new Error(`table must be one of: ${COMPANY_RESEARCH_READABLE_TABLES.join(", ")}`);
  }
  return value as CompanyResearchReadableTable;
}

export class CompanyResearchRepository {
  private readonly tables;
  private readonly physicalTableNames: Record<CompanyResearchTable, string>;

  constructor(
    private readonly db: DrizzleDb,
    private readonly tablePrefix: string,
  ) {
    this.tables = createCompanyResearchDbSchema(tablePrefix);
    this.physicalTableNames = {
      entities: `${tablePrefix}__entities`,
      companies: `${tablePrefix}__companies`,
      schedules: `${tablePrefix}__schedules`,
      runs: `${tablePrefix}__runs`,
      reports: `${tablePrefix}__reports`,
      company_attributes: `${tablePrefix}__company_attributes`,
      company_social_pages: `${tablePrefix}__company_social_pages`,
      people: `${tablePrefix}__people`,
      company_person_roles: `${tablePrefix}__company_person_roles`,
      company_relationships: `${tablePrefix}__company_relationships`,
      financing_rounds: `${tablePrefix}__financing_rounds`,
      financing_round_investors: `${tablePrefix}__financing_round_investors`,
      metrics: `${tablePrefix}__metrics`,
      job_posts: `${tablePrefix}__job_posts`,
      notable_events: `${tablePrefix}__notable_events`,
      products: `${tablePrefix}__products`,
      field_provenance: `${tablePrefix}__field_provenance`,
    };
  }

  insertRecordWithProvenance(input: JsonObject): {
    table: CompanyResearchWritableTable;
    record: unknown;
    provenance: unknown[];
    provenanceCount: number;
  } {
    const table = expectWritableTable(input.table);
    const record = assertObject(input.record, "record");
    const provenance = Array.isArray(input.provenance) ? input.provenance : [];
    const provenanceRunId = readOptionalString(input, "provenance_run_id");

    const result = this.db.transaction((tx) => {
      const inserted = this.insertRecordByTable(tx, table, record);
      const insertedProvenance = this.insertProvenanceRows(tx, {
        table,
        rowId: inserted.id,
        runId: inserted.runId,
        provenanceRunId,
        provenance,
      });

      return {
        table,
        record: inserted.row,
        provenance: insertedProvenance,
        provenanceCount: insertedProvenance.length,
      };
    });

    return result;
  }

  addCompanyAttributes(input: JsonObject) {
    return this.insertRecordWithProvenance({
      table: "company_attributes",
      record: {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        common_name: readOptionalString(input, "common_name") ?? undefined,
        founding_date: readOptionalDateString(input, "founding_date") ?? undefined,
        hq_location: readOptionalString(input, "hq_location") ?? undefined,
        primary_geographies: readOptionalStringArray(input, "primary_geographies") ?? undefined,
        company_stage: readOptionalString(input, "company_stage") ?? undefined,
        business_model_type: readOptionalString(input, "business_model_type") ?? undefined,
        company_value_proposition:
          readOptionalString(input, "company_value_proposition") ?? undefined,
        industry_tags: readOptionalStringArray(input, "industry_tags") ?? undefined,
        market_category: readOptionalString(input, "market_category") ?? undefined,
        customer_segments_served:
          readOptionalStringArray(input, "customer_segments_served") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      },
      provenance_run_id: readOptionalString(input, "provenance_run_id") ?? undefined,
      provenance: Array.isArray(input.provenance) ? input.provenance : undefined,
    });
  }

  addCompanySocialPage(input: JsonObject) {
    return this.insertRecordWithProvenance({
      table: "company_social_pages",
      record: {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        platform: readOptionalString(input, "platform") ?? undefined,
        page_url: readRequiredString(input, "page_url"),
        handle: readOptionalString(input, "handle") ?? undefined,
        is_official: readOptionalBoolean(input, "is_official") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      },
      provenance_run_id: readOptionalString(input, "provenance_run_id") ?? undefined,
      provenance: Array.isArray(input.provenance) ? input.provenance : undefined,
    });
  }

  addCompanyPersonRole(input: JsonObject) {
    const fullName = readRequiredString(input, "person_name");
    const linkedinUrl = normalizeUrl(readOptionalString(input, "linkedin_url"));
    const websiteUrl = normalizeUrl(readOptionalString(input, "website_url"));

    return this.db.transaction((tx) => {
      const person = this.upsertPerson(tx, {
        fullName,
        linkedinUrl,
        websiteUrl,
        createdAt: readOptionalTimestamp(input, "person_created_at") ?? new Date(),
        updatedAt: readOptionalTimestamp(input, "person_updated_at") ?? new Date(),
      });

      const inserted = this.insertCompanyPersonRoles(tx, {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        person_id: person.id,
        run_id: readRequiredString(input, "run_id"),
        role_type: readOptionalString(input, "role_type") ?? undefined,
        title: readOptionalString(input, "title") ?? undefined,
        department: readOptionalString(input, "department") ?? undefined,
        bio: readOptionalString(input, "bio") ?? undefined,
        is_current: readOptionalBoolean(input, "is_current") ?? undefined,
        start_date: readOptionalDateString(input, "start_date") ?? undefined,
        end_date: readOptionalDateString(input, "end_date") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      });

      const insertedProvenance = this.insertProvenanceRows(tx, {
        table: "company_person_roles",
        rowId: inserted.id,
        runId: inserted.runId,
        provenanceRunId: readOptionalString(input, "provenance_run_id"),
        provenance: Array.isArray(input.provenance) ? input.provenance : [],
      });

      return {
        table: "company_person_roles" as const,
        person,
        record: inserted.row,
        provenance: insertedProvenance,
        provenanceCount: insertedProvenance.length,
      };
    });
  }

  addCompanyRelationship(input: JsonObject) {
    const relatedCompanyWebsiteUrl = normalizeUrl(
      readOptionalStringFromAliases(input, ["related_company_website_url", "website_url"]),
    );
    const relatedCompanyDomain = normalizeDomain(
      readOptionalStringFromAliases(input, ["related_company_domain", "domain"]),
    );
    const relatedCompanyName =
      readOptionalStringFromAliases(input, ["related_company_name", "company_name"]) ??
      relatedCompanyDomain ??
      relatedCompanyWebsiteUrl ??
      "Unknown company";
    const domain = relatedCompanyDomain ?? normalizeDomain(relatedCompanyWebsiteUrl);

    return this.db.transaction((tx) => {
      const relatedCompany = this.upsertCompany(tx, {
        canonicalName: relatedCompanyName,
        domain,
        websiteUrl: relatedCompanyWebsiteUrl,
        createdAt: readOptionalTimestamp(input, "related_company_created_at") ?? new Date(),
        updatedAt: readOptionalTimestamp(input, "related_company_updated_at") ?? new Date(),
      });

      const inserted = this.insertCompanyRelationships(tx, {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        related_company_id: relatedCompany.id,
        run_id: readRequiredString(input, "run_id"),
        relationship_type: readOptionalString(input, "relationship_type") ?? undefined,
        relationship_strength: readOptionalString(input, "relationship_strength") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      });

      const insertedProvenance = this.insertProvenanceRows(tx, {
        table: "company_relationships",
        rowId: inserted.id,
        runId: inserted.runId,
        provenanceRunId: readOptionalString(input, "provenance_run_id"),
        provenance: Array.isArray(input.provenance) ? input.provenance : [],
      });

      return {
        table: "company_relationships" as const,
        relatedCompany,
        record: inserted.row,
        provenance: insertedProvenance,
        provenanceCount: insertedProvenance.length,
      };
    });
  }

  addFinancingRound(input: JsonObject) {
    const investorInputs = Array.isArray(input.investors) ? input.investors : [];

    return this.db.transaction((tx) => {
      const inserted = this.insertFinancingRounds(tx, {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        round_type: readOptionalString(input, "round_type") ?? undefined,
        round_label: readOptionalString(input, "round_label") ?? undefined,
        announced_at: readOptionalDateString(input, "announced_at") ?? undefined,
        closed_at: readOptionalDateString(input, "closed_at") ?? undefined,
        amount_raised: readOptionalInteger(input, "amount_raised") ?? undefined,
        amount_raised_currency: readOptionalString(input, "amount_raised_currency") ?? undefined,
        pre_money_valuation: readOptionalInteger(input, "pre_money_valuation") ?? undefined,
        pre_money_valuation_currency:
          readOptionalString(input, "pre_money_valuation_currency") ?? undefined,
        post_money_valuation: readOptionalInteger(input, "post_money_valuation") ?? undefined,
        post_money_valuation_currency:
          readOptionalString(input, "post_money_valuation_currency") ?? undefined,
        total_capital_raised: readOptionalInteger(input, "total_capital_raised") ?? undefined,
        total_capital_raised_currency:
          readOptionalString(input, "total_capital_raised_currency") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      });

      const entities = investorInputs.map((item, index) => {
        const investorInput = assertObject(item, `investors[${index}]`);
        const websiteUrl = normalizeUrl(readOptionalString(investorInput, "website_url"));
        const domain =
          normalizeDomain(readOptionalString(investorInput, "domain")) ?? normalizeDomain(websiteUrl);
        const investorName =
          readOptionalString(investorInput, "investor_name") ?? readOptionalString(investorInput, "name") ?? domain ?? websiteUrl ?? "Unknown investor";
        const entity = this.upsertFinancingEntity(tx, {
          investorName,
          domain,
          websiteUrl,
          linkedinUrl: normalizeUrl(readOptionalString(investorInput, "linkedin_url")),
          entityType: readOptionalEnum(
            investorInput,
            "entity_type",
            COMPANY_RESEARCH_ENTITY_TYPES,
          ),
          investorType: readOptionalEnum(
            investorInput,
            "investor_type",
            COMPANY_RESEARCH_INVESTOR_TYPES,
          ),
          createdAt: readOptionalTimestamp(investorInput, "created_at") ?? new Date(),
          updatedAt: readOptionalTimestamp(investorInput, "updated_at") ?? new Date(),
        });
        const investorType = readOptionalEnum(
          investorInput,
          "investor_type",
          COMPANY_RESEARCH_INVESTOR_TYPES,
        );
        const roundInvestor = this.insertFinancingRoundInvestors(tx, {
          id: readOptionalString(investorInput, "round_investor_id") ?? undefined,
          financing_round_id: inserted.id,
          entity_id: entity.id,
          investor_type: investorType ?? undefined,
          investor_role: readOptionalString(investorInput, "investor_role") ?? undefined,
          created_at: readOptionalTimestamp(investorInput, "created_at") ?? undefined,
        });

        return {
          entity,
          roundInvestor: roundInvestor.row,
        };
      });

      const insertedProvenance = this.insertProvenanceRows(tx, {
        table: "financing_rounds",
        rowId: inserted.id,
        runId: inserted.runId,
        provenanceRunId: readOptionalString(input, "provenance_run_id"),
        provenance: Array.isArray(input.provenance) ? input.provenance : [],
      });

      return {
        table: "financing_rounds" as const,
        record: inserted.row,
        entities: entities.map((entry) => entry.entity),
        financingRoundInvestors: entities.map((entry) => entry.roundInvestor),
        provenance: insertedProvenance,
        provenanceCount: insertedProvenance.length,
      };
    });
  }

  private inferFinancingEntityType(input: {
    entityType: (typeof COMPANY_RESEARCH_ENTITY_TYPES)[number] | null;
    domain: string | null;
    websiteUrl: string | null;
    linkedinUrl: string | null;
    investorType: (typeof COMPANY_RESEARCH_INVESTOR_TYPES)[number] | null;
  }) {
    if (input.entityType) {
      return input.entityType;
    }
    if (input.linkedinUrl || input.investorType === "angel") {
      return "person";
    }
    if (input.domain || input.websiteUrl) {
      return "company";
    }
    return "company";
  }

  private upsertFinancingEntity(
    tx: DrizzleDb,
    input: {
      investorName: string;
      domain: string | null;
      websiteUrl: string | null;
      linkedinUrl: string | null;
      entityType: (typeof COMPANY_RESEARCH_ENTITY_TYPES)[number] | null;
      investorType: (typeof COMPANY_RESEARCH_INVESTOR_TYPES)[number] | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    const inferredType = this.inferFinancingEntityType({
      entityType: input.entityType,
      domain: input.domain,
      websiteUrl: input.websiteUrl,
      linkedinUrl: input.linkedinUrl,
      investorType: input.investorType,
    });

    if (inferredType === "person") {
      return this.selectEntitySnapshotById(
        tx,
        this.upsertPerson(tx, {
          fullName: input.investorName,
          linkedinUrl: input.linkedinUrl,
          websiteUrl: input.websiteUrl,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        }).id,
      );
    }

    return this.selectEntitySnapshotById(
      tx,
      this.upsertCompany(tx, {
        canonicalName: input.investorName,
        domain: input.domain,
        websiteUrl: input.websiteUrl,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      }).id,
    );
  }

  addMetrics(input: JsonObject) {
    return this.insertRecordWithProvenance({
      table: "metrics",
      record: {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        metric_year: readOptionalInteger(input, "metric_year") ?? undefined,
        annual_revenue: readOptionalInteger(input, "annual_revenue") ?? undefined,
        original_revenue_type: readOptionalString(input, "original_revenue_type") ?? undefined,
        original_revenue_value:
          readOptionalNumberLikeString(input, "original_revenue_value") ?? undefined,
        original_revenue_currency:
          readOptionalString(input, "original_revenue_currency") ?? undefined,
        profit: readOptionalInteger(input, "profit") ?? undefined,
        original_profit_type: readOptionalString(input, "original_profit_type") ?? undefined,
        original_profit_value:
          readOptionalNumberLikeString(input, "original_profit_value") ?? undefined,
        original_profit_currency:
          readOptionalString(input, "original_profit_currency") ?? undefined,
        headcount_total: readOptionalInteger(input, "headcount_total") ?? undefined,
        active_users: readOptionalInteger(input, "active_users") ?? undefined,
        active_users_type:
          readOptionalEnum(input, "active_users_type", COMPANY_RESEARCH_ACTIVE_USER_TYPES) ??
          undefined,
        paying_customers: readOptionalInteger(input, "paying_customers") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      },
      provenance_run_id: readOptionalString(input, "provenance_run_id") ?? undefined,
      provenance: Array.isArray(input.provenance) ? input.provenance : undefined,
    });
  }

  addJobPost(input: JsonObject) {
    return this.insertRecordWithProvenance({
      table: "job_posts",
      record: {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        job_title: readRequiredString(input, "job_title"),
        department: readOptionalString(input, "department") ?? undefined,
        location: readOptionalString(input, "location") ?? undefined,
        employment_type: readOptionalString(input, "employment_type") ?? undefined,
        posted_at: readOptionalDateString(input, "posted_at") ?? undefined,
        external_url: readOptionalString(input, "external_url") ?? undefined,
        description: readOptionalString(input, "description") ?? undefined,
        status: readOptionalString(input, "status") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      },
      provenance_run_id: readOptionalString(input, "provenance_run_id") ?? undefined,
      provenance: Array.isArray(input.provenance) ? input.provenance : undefined,
    });
  }

  addNotableEvent(input: JsonObject) {
    return this.insertRecordWithProvenance({
      table: "notable_events",
      record: {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        event_category: readOptionalString(input, "event_category") ?? undefined,
        headline: readRequiredString(input, "headline"),
        summary: readOptionalString(input, "summary") ?? undefined,
        event_date: readOptionalDateString(input, "event_date") ?? undefined,
        external_url: readOptionalString(input, "external_url") ?? undefined,
        source_name: readOptionalString(input, "source_name") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      },
      provenance_run_id: readOptionalString(input, "provenance_run_id") ?? undefined,
      provenance: Array.isArray(input.provenance) ? input.provenance : undefined,
    });
  }

  addProduct(input: JsonObject) {
    return this.insertRecordWithProvenance({
      table: "products",
      record: {
        id: readOptionalString(input, "id") ?? undefined,
        company_id: readRequiredString(input, "company_id"),
        run_id: readRequiredString(input, "run_id"),
        product_name: readRequiredString(input, "product_name"),
        product_category: readOptionalString(input, "product_category") ?? undefined,
        value_proposition: readOptionalString(input, "value_proposition") ?? undefined,
        target_customer_icp: readOptionalString(input, "target_customer_icp") ?? undefined,
        is_primary: readOptionalBoolean(input, "is_primary") ?? undefined,
        created_at: readOptionalTimestamp(input, "created_at") ?? undefined,
      },
      provenance_run_id: readOptionalString(input, "provenance_run_id") ?? undefined,
      provenance: Array.isArray(input.provenance) ? input.provenance : undefined,
    });
  }

  readRecords(input: JsonObject): {
    table: CompanyResearchReadableTable;
    rows: unknown[];
    count: number;
    includeProvenance: boolean;
  } {
    const table = expectReadableTable(input.table);
    const filters = input.filters ? assertObject(input.filters, "filters") : undefined;
    const includeProvenance = readOptionalBoolean(input, "include_provenance") ?? false;
    const limit = resolveLimit(input.limit, 50);

    const rows = this.readRowsByTable(table, filters, limit);
    if (!includeProvenance || rows.length === 0) {
      return {
        table,
        rows,
        count: rows.length,
        includeProvenance,
      };
    }

    const rowIds = rows
      .map((row) => (row as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string");
    const provenanceRows =
      rowIds.length > 0 ? this.listProvenanceForRows(this.physicalTableNames[table], rowIds) : [];
    const grouped = new Map<string, unknown[]>();

    for (const provenance of provenanceRows) {
      const rowId = (provenance as { rowId: string }).rowId;
      const bucket = grouped.get(rowId);
      if (bucket) {
        bucket.push(provenance);
      } else {
        grouped.set(rowId, [provenance]);
      }
    }

    const rowsWithProvenance = rows.map((row) => ({
      ...(row as Record<string, unknown>),
      provenance: grouped.get((row as { id: string }).id) ?? [],
    }));

    return {
      table,
      rows: rowsWithProvenance,
      count: rowsWithProvenance.length,
      includeProvenance,
    };
  }

  searchCompanies(input: JsonObject = {}): { companies: unknown[]; count: number } {
    const ids = readOptionalStringArrayFilter(input, "ids");
    const id = readOptionalString(input, "id");
    const domain = readOptionalString(input, "domain");
    const websiteUrl = normalizeUrl(readOptionalString(input, "website_url"));
    const query = normalizeSearchQuery(readOptionalString(input, "query") ?? undefined);
    const limit = resolveLimit(input.limit, 50);

    const conditions: SQL<unknown>[] = [];
    if (id) {
      conditions.push(eq(this.tables.companies.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.companies.id, ids));
    }
    if (domain) {
      conditions.push(eq(this.tables.companies.domain, domain));
    }
    if (websiteUrl) {
      conditions.push(eq(this.tables.companies.websiteUrl, websiteUrl));
    }
    if (query) {
      conditions.push(
        or(
          like(this.tables.companies.canonicalName, query),
          like(this.tables.companies.domain, query),
          like(this.tables.companies.websiteUrl, query),
        )!,
      );
    }

    let statement = this.db
      .select()
      .from(this.tables.companies)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(this.tables.companies.canonicalName)
      .$dynamic();
    statement = statement.limit(limit);
    const companies = statement.all();

    return {
      companies,
      count: companies.length,
    };
  }

  ensureCompany(input: EnsureCompanyRequest) {
    const canonicalName = input.canonicalName.trim();
    if (canonicalName.length === 0) {
      throw new Error("canonicalName is required");
    }

    const domain = normalizeDomain(input.domain);
    if (!domain) {
      throw new Error("domain is required");
    }

    const websiteUrl =
      normalizeUrl(input.websiteUrl ?? null) ?? normalizeUrl(`https://${domain}`);
    const createdAt = input.createdAt ?? new Date();
    const updatedAt = input.updatedAt ?? createdAt;

    const company = this.db.transaction((tx) => {
      const existingByDomain = tx
        .select()
        .from(this.tables.companies)
        .where(eq(this.tables.companies.domain, domain))
        .all()[0];
      const existingByCanonicalNameWithoutDomain = existingByDomain
        ? undefined
        : tx
            .select()
            .from(this.tables.companies)
            .where(
              and(
                eq(this.tables.companies.canonicalName, canonicalName),
                isNull(this.tables.companies.domain),
              ),
            )
            .all()[0];
      const existing = existingByDomain ?? existingByCanonicalNameWithoutDomain;

      if (!existing) {
        return this.upsertCompany(tx, {
          canonicalName,
          domain,
          websiteUrl,
          createdAt,
          updatedAt,
        });
      }

      return this.upsertCompany(tx, {
        canonicalName,
        domain: existing.domain ?? domain,
        websiteUrl: existing.websiteUrl ?? websiteUrl,
        createdAt: existing.createdAt,
        updatedAt,
      });
    });

    return company;
  }

  getScheduleByCompanyId(companyId: string) {
    return (
      this.db
        .select()
        .from(this.tables.schedules)
        .where(eq(this.tables.schedules.companyId, companyId))
        .all()[0] ?? null
    );
  }

  ensureSchedule(input: EnsureScheduleRequest) {
    const cadenceMonths = input.cadenceMonths;
    if (!Number.isInteger(cadenceMonths) || cadenceMonths <= 0) {
      throw new Error("cadenceMonths must be a positive integer");
    }

    const existing = this.getScheduleByCompanyId(input.companyId);
    if (existing) {
      return {
        created: false,
        schedule: existing,
      };
    }

    const createdAt = input.createdAt ?? new Date();
    const updatedAt = input.updatedAt ?? createdAt;
    const id = uuid();
    this.db
      .insert(this.tables.schedules)
      .values({
        id,
        companyId: input.companyId,
        cadenceMonths,
        isActive: input.isActive ?? true,
        nextRunAt: input.nextRunAt ?? null,
        lastRunAt: input.lastRunAt ?? null,
        createdAt,
        updatedAt,
      })
      .run();

    return {
      created: true,
      schedule: this.getScheduleByCompanyId(input.companyId)!,
    };
  }

  createRun(input: CreateCompanyResearchRunRequest) {
    const id = input.id ?? uuid();
    const createdAt = input.createdAt ?? new Date();
    this.db
      .insert(this.tables.runs)
      .values({
        id,
        companyId: input.companyId,
        status: input.status,
        scheduledFor: input.scheduledFor ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        promptVersion: input.promptVersion ?? null,
        extractorVersion: input.extractorVersion ?? null,
        extractorOutput: input.extractorOutput ?? null,
        error: input.error ?? null,
        createdAt,
      })
      .run();

    return this.attachReportsToRuns(
      this.db.select().from(this.tables.runs).where(eq(this.tables.runs.id, id)).all(),
    )[0];
  }

  updateRun(id: string, input: UpdateCompanyResearchRunRequest) {
    this.db
      .update(this.tables.runs)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
        ...(input.promptVersion !== undefined ? { promptVersion: input.promptVersion } : {}),
        ...(input.extractorVersion !== undefined
          ? { extractorVersion: input.extractorVersion }
          : {}),
        ...(input.extractorOutput !== undefined
          ? { extractorOutput: input.extractorOutput }
          : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
      })
      .where(eq(this.tables.runs.id, id))
      .run();

    return this.attachReportsToRuns(
      this.db.select().from(this.tables.runs).where(eq(this.tables.runs.id, id)).all(),
    )[0];
  }

  replaceRunReports(input: ReplaceCompanyResearchRunReportsRequest) {
    const normalizedReports = input.reports.map((report) => ({
      id: report.id ?? uuid(),
      companyId: input.companyId,
      runId: input.runId,
      reportType: report.reportType,
      reportContent: report.reportContent,
      createdAt: report.createdAt ?? new Date(),
    }));

    this.db.transaction((tx) => {
      tx.delete(this.tables.reports).where(eq(this.tables.reports.runId, input.runId)).run();
      if (normalizedReports.length > 0) {
        tx.insert(this.tables.reports).values(normalizedReports).run();
      }
    });

    return this.readReports({ run_id: input.runId }, normalizedReports.length || 50);
  }

  updateSchedule(companyId: string, input: UpdateCompanyResearchScheduleRequest) {
    this.db
      .update(this.tables.schedules)
      .set({
        ...(input.cadenceMonths !== undefined ? { cadenceMonths: input.cadenceMonths } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.nextRunAt !== undefined ? { nextRunAt: input.nextRunAt } : {}),
        ...(input.lastRunAt !== undefined ? { lastRunAt: input.lastRunAt } : {}),
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(this.tables.schedules.companyId, companyId))
      .run();

    return this.getScheduleByCompanyId(companyId);
  }

  listRuns(input: JsonObject = {}): { runs: unknown[]; count: number } {
    const ids = readOptionalStringArrayFilter(input, "ids");
    const conditions: SQL<unknown>[] = [];
    const id = readOptionalString(input, "id");
    if (id) {
      conditions.push(eq(this.tables.runs.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.runs.id, ids));
    }

    const companyId = readOptionalString(input, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.runs.companyId, companyId));
    }

    const status = readOptionalEnum(input, "status", COMPANY_RESEARCH_RUN_STATUSES);
    if (status) {
      conditions.push(eq(this.tables.runs.status, status));
    }

    const promptVersion = readOptionalString(input, "prompt_version");
    if (promptVersion) {
      conditions.push(eq(this.tables.runs.promptVersion, promptVersion));
    }

    const extractorVersion = readOptionalString(input, "extractor_version");
    if (extractorVersion) {
      conditions.push(eq(this.tables.runs.extractorVersion, extractorVersion));
    }

    const scheduledForFrom = readOptionalTimestamp(input, "scheduled_for_from");
    if (scheduledForFrom) {
      conditions.push(gte(this.tables.runs.scheduledFor, scheduledForFrom));
    }

    const scheduledForTo = readOptionalTimestamp(input, "scheduled_for_to");
    if (scheduledForTo) {
      conditions.push(lte(this.tables.runs.scheduledFor, scheduledForTo));
    }

    const startedAtFrom = readOptionalTimestamp(input, "started_at_from");
    if (startedAtFrom) {
      conditions.push(gte(this.tables.runs.startedAt, startedAtFrom));
    }

    const startedAtTo = readOptionalTimestamp(input, "started_at_to");
    if (startedAtTo) {
      conditions.push(lte(this.tables.runs.startedAt, startedAtTo));
    }

    const completedAtFrom = readOptionalTimestamp(input, "completed_at_from");
    if (completedAtFrom) {
      conditions.push(gte(this.tables.runs.completedAt, completedAtFrom));
    }

    const completedAtTo = readOptionalTimestamp(input, "completed_at_to");
    if (completedAtTo) {
      conditions.push(lte(this.tables.runs.completedAt, completedAtTo));
    }

    let statement = this.db
      .select()
      .from(this.tables.runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.runs.completedAt), desc(this.tables.runs.startedAt))
      .$dynamic();
    statement = statement.limit(resolveLimit(input.limit, 50));
    const runs = this.attachReportsToRuns(statement.all());

    return {
      runs,
      count: runs.length,
    };
  }

  listProvenance(input: JsonObject = {}): {
    provenance: unknown[];
    count: number;
  } {
    const ids = readOptionalStringArrayFilter(input, "ids");
    const conditions: SQL<unknown>[] = [];
    const id = readOptionalString(input, "id");
    if (id) {
      conditions.push(eq(this.tables.fieldProvenance.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.fieldProvenance.id, ids));
    }

    const runId = readOptionalString(input, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.fieldProvenance.runId, runId));
    }

    const tableName = readOptionalString(input, "table_name");
    if (tableName) {
      conditions.push(eq(this.tables.fieldProvenance.tableName, this.resolveTableNameFilter(tableName)));
    }

    const rowId = readOptionalString(input, "row_id");
    if (rowId) {
      conditions.push(eq(this.tables.fieldProvenance.rowId, rowId));
    }

    const fieldName = readOptionalString(input, "field_name");
    if (fieldName) {
      conditions.push(eq(this.tables.fieldProvenance.fieldName, fieldName));
    }

    const fieldNameIsNull = readOptionalBoolean(input, "field_name_is_null");
    if (fieldNameIsNull === true) {
      conditions.push(isNull(this.tables.fieldProvenance.fieldName));
    }

    const citationUrl = normalizeUrl(readOptionalString(input, "citation_url"));
    if (citationUrl) {
      conditions.push(eq(this.tables.fieldProvenance.citationUrl, citationUrl));
    }

    const confidence = readOptionalEnum(input, "confidence", COMPANY_RESEARCH_CONFIDENCE_VALUES);
    if (confidence) {
      conditions.push(eq(this.tables.fieldProvenance.confidence, confidence));
    }

    const reportingBasis = readOptionalEnum(
      input,
      "reporting_basis",
      COMPANY_RESEARCH_REPORTING_BASIS_VALUES,
    );
    if (reportingBasis) {
      conditions.push(eq(this.tables.fieldProvenance.reportingBasis, reportingBasis));
    }

    const asOfDateFrom = readOptionalDateString(input, "as_of_date_from");
    if (asOfDateFrom) {
      conditions.push(gte(this.tables.fieldProvenance.asOfDate, asOfDateFrom));
    }

    const asOfDateTo = readOptionalDateString(input, "as_of_date_to");
    if (asOfDateTo) {
      conditions.push(lte(this.tables.fieldProvenance.asOfDate, asOfDateTo));
    }

    let statement = this.db
      .select()
      .from(this.tables.fieldProvenance)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.fieldProvenance.createdAt))
      .$dynamic();
    statement = statement.limit(resolveLimit(input.limit, 100));
    const provenance = statement.all();

    return {
      provenance,
      count: provenance.length,
    };
  }

  private insertRecordByTable(
    tx: DrizzleDb,
    table: CompanyResearchWritableTable,
    record: JsonObject,
  ): { id: string; runId: string | null; row: unknown } {
    switch (table) {
      case "company_attributes":
        return this.insertCompanyAttributes(tx, record);
      case "company_social_pages":
        return this.insertCompanySocialPages(tx, record);
      case "people":
        return this.insertPeople(tx, record);
      case "company_person_roles":
        return this.insertCompanyPersonRoles(tx, record);
      case "company_relationships":
        return this.insertCompanyRelationships(tx, record);
      case "financing_rounds":
        return this.insertFinancingRounds(tx, record);
      case "metrics":
        return this.insertMetrics(tx, record);
      case "job_posts":
        return this.insertJobPosts(tx, record);
      case "notable_events":
        return this.insertNotableEvents(tx, record);
      case "products":
        return this.insertProducts(tx, record);
    }
  }

  private insertProvenanceRows(
    tx: DrizzleDb,
    input: {
      table: CompanyResearchWritableTable;
      rowId: string;
      runId: string | null;
      provenanceRunId: string | null;
      provenance: unknown[];
    },
  ): unknown[] {
    const effectiveRunId = input.runId ?? input.provenanceRunId;
    return input.provenance.map((item, index) => {
      const parsed = assertObject(item, `provenance[${index}]`);
      const runId = readOptionalString(parsed, "run_id") ?? effectiveRunId;
      if (!runId) {
        throw new Error(
          "provenance_run_id is required when inserting provenance for rows without a run_id",
        );
      }

      const provenanceId = readOptionalString(parsed, "id") ?? uuid();
      const values = {
        id: provenanceId,
        runId,
        tableName: this.physicalTableNames[input.table],
        rowId: input.rowId,
        fieldName: readOptionalString(parsed, "field_name"),
        asOfDate: readOptionalDateString(parsed, "as_of_date"),
        citationUrl: normalizeUrl(readOptionalString(parsed, "citation_url")),
        confidence: readOptionalEnum(parsed, "confidence", COMPANY_RESEARCH_CONFIDENCE_VALUES),
        reportingBasis: readOptionalEnum(
          parsed,
          "reporting_basis",
          COMPANY_RESEARCH_REPORTING_BASIS_VALUES,
        ),
        notes: readOptionalString(parsed, "notes"),
        createdAt: readOptionalTimestamp(parsed, "created_at") ?? new Date(),
      };
      tx.insert(this.tables.fieldProvenance).values(values).run();
      return tx
        .select()
        .from(this.tables.fieldProvenance)
        .where(eq(this.tables.fieldProvenance.id, provenanceId))
        .all()[0];
    });
  }

  private upsertPerson(
    tx: DrizzleDb,
    input: {
      fullName: string;
      linkedinUrl: string | null;
      websiteUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    const linkedinMatch = input.linkedinUrl
      ? tx
          .select()
          .from(this.tables.people)
          .where(eq(this.tables.people.linkedinUrl, input.linkedinUrl))
          .all()[0]
      : undefined;
    const websiteMatch = input.websiteUrl
      ? tx
          .select()
          .from(this.tables.people)
          .where(eq(this.tables.people.websiteUrl, input.websiteUrl))
          .all()[0]
      : undefined;

    if (
      linkedinMatch &&
      websiteMatch &&
      linkedinMatch.id !== websiteMatch.id
    ) {
      throw new Error("linkedin_url and website_url matched different people");
    }

    const existing = linkedinMatch ?? websiteMatch;
    if (!existing) {
      const id = uuid();
      tx.insert(this.tables.entities)
        .values({
          id,
          entityType: "person",
          displayName: input.fullName,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .run();
      tx.insert(this.tables.people)
        .values({
          id,
          fullName: input.fullName,
          linkedinUrl: input.linkedinUrl,
          websiteUrl: input.websiteUrl,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .run();
      return tx.select().from(this.tables.people).where(eq(this.tables.people.id, id)).all()[0];
    }

    if (normalizePersonNameForMatch(existing.fullName) !== normalizePersonNameForMatch(input.fullName)) {
      throw new Error(
        "the URL is already used by another person. Check if you use a general team url instead of the person's profile url",
      );
    }

    this.upsertEntityRow(tx, {
      id: existing.id,
      entityType: "person",
      displayName: input.fullName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });

    tx.update(this.tables.people)
      .set({
        fullName: input.fullName,
        linkedinUrl: existing.linkedinUrl ?? input.linkedinUrl,
        websiteUrl: existing.websiteUrl ?? input.websiteUrl,
        updatedAt: input.updatedAt,
      })
      .where(eq(this.tables.people.id, existing.id))
      .run();

    return tx
      .select()
      .from(this.tables.people)
      .where(eq(this.tables.people.id, existing.id))
      .all()[0];
  }

  private upsertCompany(
    tx: DrizzleDb,
    input: {
      canonicalName: string;
      domain: string | null;
      websiteUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    const existingByDomain = input.domain
      ? tx.select().from(this.tables.companies).where(eq(this.tables.companies.domain, input.domain)).all()[0]
      : undefined;
    const existingByWebsiteUrl = input.websiteUrl
      ? tx
          .select()
          .from(this.tables.companies)
          .where(eq(this.tables.companies.websiteUrl, input.websiteUrl))
          .all()[0]
      : undefined;
    if (
      existingByDomain &&
      existingByWebsiteUrl &&
      existingByDomain.id !== existingByWebsiteUrl.id
    ) {
      throw new Error("domain and website_url matched different companies");
    }
    const existingByCanonicalNameWithoutDomain = existingByDomain || existingByWebsiteUrl
      ? undefined
      : tx
          .select()
          .from(this.tables.companies)
          .where(
            and(
              eq(this.tables.companies.canonicalName, input.canonicalName),
              isNull(this.tables.companies.domain),
            ),
          )
          .all()[0];
    const existing = existingByDomain ?? existingByWebsiteUrl ?? existingByCanonicalNameWithoutDomain;

    if (!existing) {
      const id = uuid();
      tx.insert(this.tables.entities)
        .values({
          id,
          entityType: "company",
          displayName: input.canonicalName,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .run();
      tx.insert(this.tables.companies)
        .values({
          id,
          canonicalName: input.canonicalName,
          domain: input.domain,
          websiteUrl: input.websiteUrl,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .run();
      return tx
        .select()
        .from(this.tables.companies)
        .where(eq(this.tables.companies.id, id))
        .all()[0];
    }

    this.upsertEntityRow(tx, {
      id: existing.id,
      entityType: "company",
      displayName: input.canonicalName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });

    tx.update(this.tables.companies)
      .set({
        canonicalName: input.canonicalName,
        domain: existing.domain ?? input.domain,
        websiteUrl: existing.websiteUrl ?? input.websiteUrl,
        updatedAt: input.updatedAt,
      })
      .where(eq(this.tables.companies.id, existing.id))
      .run();

    return tx
      .select()
      .from(this.tables.companies)
      .where(eq(this.tables.companies.id, existing.id))
      .all()[0];
  }

  private upsertEntityRow(
    tx: DrizzleDb,
    input: {
      id: string;
      entityType: (typeof COMPANY_RESEARCH_ENTITY_TYPES)[number];
      displayName: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    const existing = tx
      .select()
      .from(this.tables.entities)
      .where(eq(this.tables.entities.id, input.id))
      .all()[0];

    if (!existing) {
      tx.insert(this.tables.entities)
        .values({
          id: input.id,
          entityType: input.entityType,
          displayName: input.displayName,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .run();
      return tx
        .select()
        .from(this.tables.entities)
        .where(eq(this.tables.entities.id, input.id))
        .all()[0];
    }

    tx.update(this.tables.entities)
      .set({
        entityType: input.entityType,
        displayName: input.displayName,
        updatedAt: input.updatedAt,
      })
      .where(eq(this.tables.entities.id, existing.id))
      .run();

    return tx
      .select()
      .from(this.tables.entities)
      .where(eq(this.tables.entities.id, existing.id))
      .all()[0];
  }

  private selectEntitySnapshotById(tx: DrizzleDb, id: string) {
    return tx
      .select({
        id: this.tables.entities.id,
        entityType: this.tables.entities.entityType,
        displayName: this.tables.entities.displayName,
        domain: this.tables.companies.domain,
        websiteUrl: sql<string | null>`coalesce(${this.tables.companies.websiteUrl}, ${this.tables.people.websiteUrl})`,
        fullName: this.tables.people.fullName,
        linkedinUrl: this.tables.people.linkedinUrl,
        createdAt: this.tables.entities.createdAt,
        updatedAt: this.tables.entities.updatedAt,
      })
      .from(this.tables.entities)
      .leftJoin(this.tables.companies, eq(this.tables.companies.id, this.tables.entities.id))
      .leftJoin(this.tables.people, eq(this.tables.people.id, this.tables.entities.id))
      .where(eq(this.tables.entities.id, id))
      .all()[0];
  }

  private readRowsByTable(
    table: CompanyResearchReadableTable,
    filters: JsonObject | undefined,
    limit: number,
  ): unknown[] {
    switch (table) {
      case "company_attributes":
        return this.readCompanyAttributes(filters, limit);
      case "company_social_pages":
        return this.readCompanySocialPages(filters, limit);
      case "reports":
        return this.readReports(filters, limit);
      case "entities":
        return this.readEntities(filters, limit);
      case "people":
        return this.readPeople(filters, limit);
      case "company_person_roles":
        return this.readCompanyPersonRoles(filters, limit);
      case "company_relationships":
        return this.readCompanyRelationships(filters, limit);
      case "financing_rounds":
        return this.readFinancingRounds(filters, limit);
      case "financing_round_investors":
        return this.readFinancingRoundInvestors(filters, limit);
      case "metrics":
        return this.readMetrics(filters, limit);
      case "job_posts":
        return this.readJobPosts(filters, limit);
      case "notable_events":
        return this.readNotableEvents(filters, limit);
      case "products":
        return this.readProducts(filters, limit);
    }
  }

  private insertCompanyAttributes(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      commonName: readOptionalString(record, "common_name"),
      foundingDate: readOptionalDateString(record, "founding_date"),
      hqLocation: readOptionalString(record, "hq_location"),
      primaryGeographies: readOptionalStringArray(record, "primary_geographies"),
      companyStage: readOptionalString(record, "company_stage"),
      businessModelType: readOptionalString(record, "business_model_type"),
      companyValueProposition: readOptionalString(record, "company_value_proposition"),
      industryTags: readOptionalStringArray(record, "industry_tags"),
      marketCategory: readOptionalString(record, "market_category"),
      customerSegmentsServed: readOptionalStringArray(record, "customer_segments_served"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.companyAttributes).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx
        .select()
        .from(this.tables.companyAttributes)
        .where(eq(this.tables.companyAttributes.id, id))
        .all()[0],
    };
  }

  private insertCompanySocialPages(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      platform: readOptionalEnum(record, "platform", COMPANY_SOCIAL_PAGE_PLATFORMS) ?? "other",
      pageUrl: normalizeUrl(readRequiredString(record, "page_url"))!,
      handle: readOptionalString(record, "handle"),
      isOfficial: readOptionalBoolean(record, "is_official") ?? true,
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.companySocialPages).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx
        .select()
        .from(this.tables.companySocialPages)
        .where(eq(this.tables.companySocialPages.id, id))
        .all()[0],
    };
  }

  private insertPeople(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const createdAt = readOptionalTimestamp(record, "created_at") ?? new Date();
    const values = {
      id,
      fullName: readRequiredString(record, "full_name"),
      linkedinUrl: normalizeUrl(readOptionalString(record, "linkedin_url")),
      websiteUrl: normalizeUrl(readOptionalString(record, "website_url")),
      createdAt,
      updatedAt: readOptionalTimestamp(record, "updated_at") ?? createdAt,
    };
    this.upsertEntityRow(tx, {
      id,
      entityType: "person",
      displayName: values.fullName,
      createdAt,
      updatedAt: values.updatedAt,
    });
    tx.insert(this.tables.people).values(values).run();
    return {
      id,
      runId: null,
      row: tx.select().from(this.tables.people).where(eq(this.tables.people.id, id)).all()[0],
    };
  }

  private insertCompanyPersonRoles(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      personId: readRequiredString(record, "person_id"),
      runId: readRequiredString(record, "run_id"),
      roleType: readOptionalEnum(record, "role_type", COMPANY_PERSON_ROLE_TYPES) ?? "employee",
      title: readOptionalString(record, "title"),
      department: readOptionalEnum(record, "department", COMPANY_DEPARTMENTS),
      bio: readOptionalString(record, "bio"),
      isCurrent: readOptionalBoolean(record, "is_current"),
      startDate: readOptionalDateString(record, "start_date"),
      endDate: readOptionalDateString(record, "end_date"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.companyPersonRoles).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx
        .select()
        .from(this.tables.companyPersonRoles)
        .where(eq(this.tables.companyPersonRoles.id, id))
        .all()[0],
    };
  }

  private insertCompanyRelationships(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      relatedCompanyId: readRequiredString(record, "related_company_id"),
      runId: readRequiredString(record, "run_id"),
      relationshipType:
        readOptionalEnum(record, "relationship_type", COMPANY_RELATIONSHIP_TYPES) ?? "competitor",
      relationshipStrength: readOptionalString(record, "relationship_strength"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.companyRelationships).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx
        .select()
        .from(this.tables.companyRelationships)
        .where(eq(this.tables.companyRelationships.id, id))
        .all()[0],
    };
  }

  private insertFinancingRounds(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      roundType:
        readOptionalEnum(record, "round_type", COMPANY_RESEARCH_FINANCING_ROUND_TYPES) ?? "other",
      roundLabel: readOptionalString(record, "round_label"),
      announcedAt: readOptionalDateString(record, "announced_at"),
      closedAt: readOptionalDateString(record, "closed_at"),
      amountRaised: readOptionalInteger(record, "amount_raised"),
      amountRaisedCurrency: readOptionalString(record, "amount_raised_currency"),
      preMoneyValuation: readOptionalInteger(record, "pre_money_valuation"),
      preMoneyValuationCurrency: readOptionalString(record, "pre_money_valuation_currency"),
      postMoneyValuation: readOptionalInteger(record, "post_money_valuation"),
      postMoneyValuationCurrency: readOptionalString(record, "post_money_valuation_currency"),
      totalCapitalRaised: readOptionalInteger(record, "total_capital_raised"),
      totalCapitalRaisedCurrency: readOptionalString(record, "total_capital_raised_currency"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.financingRounds).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx
        .select()
        .from(this.tables.financingRounds)
        .where(eq(this.tables.financingRounds.id, id))
        .all()[0],
    };
  }

  private insertFinancingRoundInvestors(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      financingRoundId: readRequiredString(record, "financing_round_id"),
      entityId: readRequiredString(record, "entity_id"),
      investorType: readOptionalEnum(record, "investor_type", COMPANY_RESEARCH_INVESTOR_TYPES),
      investorRole:
        readOptionalEnum(record, "investor_role", COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES) ??
        "participant",
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.financingRoundInvestors).values(values).run();
    return {
      id,
      runId: null,
      row: tx
        .select()
        .from(this.tables.financingRoundInvestors)
        .where(eq(this.tables.financingRoundInvestors.id, id))
        .all()[0],
    };
  }

  private insertMetrics(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const metricYear = readOptionalInteger(record, "metric_year");
    if (metricYear === null) {
      throw new Error("metric_year is required");
    }
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      metricYear,
      annualRevenue: readOptionalInteger(record, "annual_revenue"),
      originalRevenueType: readOptionalString(record, "original_revenue_type"),
      originalRevenueValue: readOptionalNumberLikeString(record, "original_revenue_value"),
      originalRevenueCurrency: readOptionalString(record, "original_revenue_currency"),
      profit: readOptionalInteger(record, "profit"),
      originalProfitType: readOptionalString(record, "original_profit_type"),
      originalProfitValue: readOptionalNumberLikeString(record, "original_profit_value"),
      originalProfitCurrency: readOptionalString(record, "original_profit_currency"),
      headcountTotal: readOptionalInteger(record, "headcount_total"),
      activeUsers: readOptionalInteger(record, "active_users"),
      activeUsersType: readOptionalEnum(
        record,
        "active_users_type",
        COMPANY_RESEARCH_ACTIVE_USER_TYPES,
      ),
      payingCustomers: readOptionalInteger(record, "paying_customers"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.metrics).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx.select().from(this.tables.metrics).where(eq(this.tables.metrics.id, id)).all()[0],
    };
  }

  private insertJobPosts(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      jobTitle: readRequiredString(record, "job_title"),
      department: readOptionalEnum(record, "department", COMPANY_DEPARTMENTS),
      location: readOptionalString(record, "location"),
      employmentType: readOptionalString(record, "employment_type"),
      postedAt: readOptionalDateString(record, "posted_at"),
      externalUrl: normalizeUrl(readOptionalString(record, "external_url")),
      description: readOptionalString(record, "description"),
      status: readOptionalString(record, "status"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.jobPosts).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx.select().from(this.tables.jobPosts).where(eq(this.tables.jobPosts.id, id)).all()[0],
    };
  }

  private insertNotableEvents(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      eventCategory:
        readOptionalEnum(record, "event_category", COMPANY_RESEARCH_EVENT_CATEGORIES) ?? "other",
      headline: readRequiredString(record, "headline"),
      summary: readOptionalString(record, "summary"),
      eventDate: readOptionalDateString(record, "event_date"),
      externalUrl: normalizeUrl(readOptionalString(record, "external_url")),
      sourceName: readOptionalString(record, "source_name"),
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.notableEvents).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx
        .select()
        .from(this.tables.notableEvents)
        .where(eq(this.tables.notableEvents.id, id))
        .all()[0],
    };
  }

  private insertProducts(tx: DrizzleDb, record: JsonObject) {
    const id = readOptionalString(record, "id") ?? uuid();
    const values = {
      id,
      companyId: readRequiredString(record, "company_id"),
      runId: readRequiredString(record, "run_id"),
      productName: readRequiredString(record, "product_name"),
      productCategory: readOptionalString(record, "product_category"),
      valueProposition: readOptionalString(record, "value_proposition"),
      targetCustomerIcp: readOptionalString(record, "target_customer_icp"),
      isPrimary: readOptionalBoolean(record, "is_primary") ?? false,
      createdAt: readOptionalTimestamp(record, "created_at") ?? new Date(),
    };
    tx.insert(this.tables.products).values(values).run();
    return {
      id,
      runId: values.runId,
      row: tx.select().from(this.tables.products).where(eq(this.tables.products.id, id)).all()[0],
    };
  }

  private readCompanyAttributes(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.companyAttributes.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.companyAttributes.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.companyAttributes.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.companyAttributes.runId, runId));
    }
    const commonName = normalizeSearchQuery(readOptionalStringFilter(filters, "common_name"));
    if (commonName) {
      conditions.push(like(this.tables.companyAttributes.commonName, commonName));
    }
    const marketCategory = normalizeSearchQuery(readOptionalStringFilter(filters, "market_category"));
    if (marketCategory) {
      conditions.push(like(this.tables.companyAttributes.marketCategory, marketCategory));
    }

    let statement = this.db
      .select()
      .from(this.tables.companyAttributes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.companyAttributes.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readCompanySocialPages(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.companySocialPages.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.companySocialPages.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.companySocialPages.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.companySocialPages.runId, runId));
    }
    const platform = readOptionalEnum(filters ?? {}, "platform", COMPANY_SOCIAL_PAGE_PLATFORMS);
    if (platform) {
      conditions.push(eq(this.tables.companySocialPages.platform, platform));
    }
    const handle = normalizeSearchQuery(readOptionalStringFilter(filters, "handle"));
    if (handle) {
      conditions.push(like(this.tables.companySocialPages.handle, handle));
    }
    const isOfficial = readOptionalBooleanFilter(filters, "is_official");
    if (isOfficial !== undefined) {
      conditions.push(eq(this.tables.companySocialPages.isOfficial, isOfficial));
    }

    let statement = this.db
      .select()
      .from(this.tables.companySocialPages)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.companySocialPages.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readEntities(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.entities.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.entities.id, ids));
    }
    const entityType = readOptionalEnum(filters ?? {}, "entity_type", COMPANY_RESEARCH_ENTITY_TYPES);
    if (entityType) {
      conditions.push(eq(this.tables.entities.entityType, entityType));
    }
    const displayName = normalizeSearchQuery(readOptionalStringFilter(filters, "display_name"));
    if (displayName) {
      conditions.push(like(this.tables.entities.displayName, displayName));
    }
    const domain = normalizeDomain(readOptionalStringFilter(filters, "domain") ?? null);
    if (domain) {
      conditions.push(eq(this.tables.companies.domain, domain));
    }
    const websiteUrl = normalizeUrl(readOptionalStringFilter(filters, "website_url") ?? null);
    if (websiteUrl) {
      conditions.push(
        or(
          eq(this.tables.companies.websiteUrl, websiteUrl),
          eq(this.tables.people.websiteUrl, websiteUrl),
        )!,
      );
    }
    const linkedinUrl = normalizeUrl(readOptionalStringFilter(filters, "linkedin_url") ?? null);
    if (linkedinUrl) {
      conditions.push(eq(this.tables.people.linkedinUrl, linkedinUrl));
    }

    let statement = this.db
      .select({
        id: this.tables.entities.id,
        entityType: this.tables.entities.entityType,
        displayName: this.tables.entities.displayName,
        domain: this.tables.companies.domain,
        websiteUrl: sql<string | null>`coalesce(${this.tables.companies.websiteUrl}, ${this.tables.people.websiteUrl})`,
        fullName: this.tables.people.fullName,
        linkedinUrl: this.tables.people.linkedinUrl,
        createdAt: this.tables.entities.createdAt,
        updatedAt: this.tables.entities.updatedAt,
      })
      .from(this.tables.entities)
      .leftJoin(this.tables.companies, eq(this.tables.companies.id, this.tables.entities.id))
      .leftJoin(this.tables.people, eq(this.tables.people.id, this.tables.entities.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(this.tables.entities.displayName)
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readPeople(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.people.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.people.id, ids));
    }
    const fullName = normalizeSearchQuery(readOptionalStringFilter(filters, "full_name"));
    if (fullName) {
      conditions.push(like(this.tables.people.fullName, fullName));
    }
    const linkedinUrl = normalizeUrl(readOptionalStringFilter(filters, "linkedin_url") ?? null);
    if (linkedinUrl) {
      conditions.push(eq(this.tables.people.linkedinUrl, linkedinUrl));
    }
    const websiteUrl = normalizeUrl(readOptionalStringFilter(filters, "website_url") ?? null);
    if (websiteUrl) {
      conditions.push(eq(this.tables.people.websiteUrl, websiteUrl));
    }

    let statement = this.db
      .select()
      .from(this.tables.people)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(this.tables.people.fullName)
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readCompanyPersonRoles(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.companyPersonRoles.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.companyPersonRoles.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.companyPersonRoles.companyId, companyId));
    }
    const personId = readOptionalStringFilter(filters, "person_id");
    if (personId) {
      conditions.push(eq(this.tables.companyPersonRoles.personId, personId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.companyPersonRoles.runId, runId));
    }
    const roleType = readOptionalEnum(filters ?? {}, "role_type", COMPANY_PERSON_ROLE_TYPES);
    if (roleType) {
      conditions.push(eq(this.tables.companyPersonRoles.roleType, roleType));
    }
    const department = readOptionalEnum(filters ?? {}, "department", COMPANY_DEPARTMENTS);
    if (department) {
      conditions.push(eq(this.tables.companyPersonRoles.department, department));
    }
    const isCurrent = readOptionalBooleanFilter(filters, "is_current");
    if (isCurrent !== undefined) {
      conditions.push(eq(this.tables.companyPersonRoles.isCurrent, isCurrent));
    }
    const title = normalizeSearchQuery(readOptionalStringFilter(filters, "title"));
    if (title) {
      conditions.push(like(this.tables.companyPersonRoles.title, title));
    }

    let statement = this.db
      .select()
      .from(this.tables.companyPersonRoles)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.companyPersonRoles.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readCompanyRelationships(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.companyRelationships.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.companyRelationships.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.companyRelationships.companyId, companyId));
    }
    const relatedCompanyId = readOptionalStringFilter(filters, "related_company_id");
    if (relatedCompanyId) {
      conditions.push(eq(this.tables.companyRelationships.relatedCompanyId, relatedCompanyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.companyRelationships.runId, runId));
    }
    const relationshipType = readOptionalEnum(
      filters ?? {},
      "relationship_type",
      COMPANY_RELATIONSHIP_TYPES,
    );
    if (relationshipType) {
      conditions.push(eq(this.tables.companyRelationships.relationshipType, relationshipType));
    }
    const relationshipStrength = normalizeSearchQuery(
      readOptionalStringFilter(filters, "relationship_strength"),
    );
    if (relationshipStrength) {
      conditions.push(like(this.tables.companyRelationships.relationshipStrength, relationshipStrength));
    }

    let statement = this.db
      .select()
      .from(this.tables.companyRelationships)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.companyRelationships.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readFinancingRounds(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.financingRounds.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.financingRounds.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.financingRounds.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.financingRounds.runId, runId));
    }
    const roundType = readOptionalEnum(
      filters ?? {},
      "round_type",
      COMPANY_RESEARCH_FINANCING_ROUND_TYPES,
    );
    if (roundType) {
      conditions.push(eq(this.tables.financingRounds.roundType, roundType));
    }
    const roundLabel = normalizeSearchQuery(readOptionalStringFilter(filters, "round_label"));
    if (roundLabel) {
      conditions.push(like(this.tables.financingRounds.roundLabel, roundLabel));
    }
    const announcedAtFrom = readOptionalDateFilter(filters, "announced_at_from");
    if (announcedAtFrom) {
      conditions.push(gte(this.tables.financingRounds.announcedAt, announcedAtFrom));
    }
    const announcedAtTo = readOptionalDateFilter(filters, "announced_at_to");
    if (announcedAtTo) {
      conditions.push(lte(this.tables.financingRounds.announcedAt, announcedAtTo));
    }

    let statement = this.db
      .select()
      .from(this.tables.financingRounds)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        desc(this.tables.financingRounds.announcedAt),
        desc(this.tables.financingRounds.createdAt),
      )
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readFinancingRoundInvestors(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.financingRoundInvestors.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.financingRoundInvestors.id, ids));
    }
    const financingRoundId = readOptionalStringFilter(filters, "financing_round_id");
    if (financingRoundId) {
      conditions.push(eq(this.tables.financingRoundInvestors.financingRoundId, financingRoundId));
    }
    const entityId =
      readOptionalStringFilter(filters, "entity_id") ??
      readOptionalStringFilter(filters, "investor_id");
    if (entityId) {
      conditions.push(eq(this.tables.financingRoundInvestors.entityId, entityId));
    }
    const investorType = readOptionalEnum(filters ?? {}, "investor_type", COMPANY_RESEARCH_INVESTOR_TYPES);
    if (investorType) {
      conditions.push(eq(this.tables.financingRoundInvestors.investorType, investorType));
    }
    const investorRole = readOptionalEnum(
      filters ?? {},
      "investor_role",
      COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES,
    );
    if (investorRole) {
      conditions.push(eq(this.tables.financingRoundInvestors.investorRole, investorRole));
    }

    let statement = this.db
      .select()
      .from(this.tables.financingRoundInvestors)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.financingRoundInvestors.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readMetrics(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.metrics.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.metrics.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.metrics.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.metrics.runId, runId));
    }
    const metricYear = readOptionalIntegerFilter(filters, "metric_year");
    if (metricYear !== undefined) {
      conditions.push(eq(this.tables.metrics.metricYear, metricYear));
    }

    let statement = this.db
      .select()
      .from(this.tables.metrics)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.metrics.metricYear), desc(this.tables.metrics.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readJobPosts(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.jobPosts.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.jobPosts.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.jobPosts.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.jobPosts.runId, runId));
    }
    const department = readOptionalEnum(filters ?? {}, "department", COMPANY_DEPARTMENTS);
    if (department) {
      conditions.push(eq(this.tables.jobPosts.department, department));
    }
    const status = readOptionalStringFilter(filters, "status");
    if (status) {
      conditions.push(eq(this.tables.jobPosts.status, status));
    }
    const employmentType = readOptionalStringFilter(filters, "employment_type");
    if (employmentType) {
      conditions.push(eq(this.tables.jobPosts.employmentType, employmentType));
    }
    const jobTitle = normalizeSearchQuery(readOptionalStringFilter(filters, "job_title"));
    if (jobTitle) {
      conditions.push(like(this.tables.jobPosts.jobTitle, jobTitle));
    }
    const postedAfter = readOptionalDateFilter(filters, "posted_at_from");
    if (postedAfter) {
      conditions.push(gte(this.tables.jobPosts.postedAt, postedAfter));
    }
    const postedBefore = readOptionalDateFilter(filters, "posted_at_to");
    if (postedBefore) {
      conditions.push(lte(this.tables.jobPosts.postedAt, postedBefore));
    }

    let statement = this.db
      .select()
      .from(this.tables.jobPosts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.jobPosts.postedAt), desc(this.tables.jobPosts.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readNotableEvents(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.notableEvents.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.notableEvents.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.notableEvents.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.notableEvents.runId, runId));
    }
    const eventCategory = readOptionalEnum(
      filters ?? {},
      "event_category",
      COMPANY_RESEARCH_EVENT_CATEGORIES,
    );
    if (eventCategory) {
      conditions.push(eq(this.tables.notableEvents.eventCategory, eventCategory));
    }
    const sourceName = normalizeSearchQuery(readOptionalStringFilter(filters, "source_name"));
    if (sourceName) {
      conditions.push(like(this.tables.notableEvents.sourceName, sourceName));
    }
    const headline = normalizeSearchQuery(readOptionalStringFilter(filters, "headline"));
    if (headline) {
      conditions.push(like(this.tables.notableEvents.headline, headline));
    }
    const eventDateFrom = readOptionalDateFilter(filters, "event_date_from");
    if (eventDateFrom) {
      conditions.push(gte(this.tables.notableEvents.eventDate, eventDateFrom));
    }
    const eventDateTo = readOptionalDateFilter(filters, "event_date_to");
    if (eventDateTo) {
      conditions.push(lte(this.tables.notableEvents.eventDate, eventDateTo));
    }

    let statement = this.db
      .select()
      .from(this.tables.notableEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.notableEvents.eventDate), desc(this.tables.notableEvents.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readProducts(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.products.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.products.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.products.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.products.runId, runId));
    }
    const productName = normalizeSearchQuery(readOptionalStringFilter(filters, "product_name"));
    if (productName) {
      conditions.push(like(this.tables.products.productName, productName));
    }
    const productCategory = normalizeSearchQuery(readOptionalStringFilter(filters, "product_category"));
    if (productCategory) {
      conditions.push(like(this.tables.products.productCategory, productCategory));
    }
    const isPrimary = readOptionalBooleanFilter(filters, "is_primary");
    if (isPrimary !== undefined) {
      conditions.push(eq(this.tables.products.isPrimary, isPrimary));
    }

    let statement = this.db
      .select()
      .from(this.tables.products)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.products.isPrimary), this.tables.products.productName)
      .$dynamic();
    statement = statement.limit(limit);
    return statement.all();
  }

  private readReports(filters: JsonObject | undefined, limit: number) {
    const conditions: SQL<unknown>[] = [];
    const ids = readOptionalStringArrayFilter(filters, "ids");
    const id = readOptionalStringFilter(filters, "id");
    if (id) {
      conditions.push(eq(this.tables.reports.id, id));
    }
    if (ids && ids.length > 0) {
      conditions.push(inArray(this.tables.reports.id, ids));
    }
    const companyId = readOptionalStringFilter(filters, "company_id");
    if (companyId) {
      conditions.push(eq(this.tables.reports.companyId, companyId));
    }
    const runId = readOptionalStringFilter(filters, "run_id");
    if (runId) {
      conditions.push(eq(this.tables.reports.runId, runId));
    }
    const reportType = readOptionalEnum(filters ?? {}, "report_type", COMPANY_RESEARCH_REPORT_TYPES);
    if (reportType) {
      conditions.push(eq(this.tables.reports.reportType, reportType));
    }

    let statement = this.db
      .select()
      .from(this.tables.reports)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(this.tables.reports.createdAt))
      .$dynamic();
    statement = statement.limit(limit);
    return this.sortReports(statement.all());
  }

  private listProvenanceForRows(tableName: string, rowIds: string[]) {
    return this.db
      .select()
      .from(this.tables.fieldProvenance)
      .where(
        and(
          eq(this.tables.fieldProvenance.tableName, tableName),
          inArray(this.tables.fieldProvenance.rowId, rowIds),
        ),
      )
      .orderBy(desc(this.tables.fieldProvenance.createdAt))
      .all();
  }

  private sortReports<T extends { reportType: string; id: string }>(reports: T[]): T[] {
    const reportTypeOrder = new Map<string, number>(
      COMPANY_RESEARCH_REPORT_TYPES.map((reportType, index) => [reportType, index]),
    );

    return [...reports].sort((left, right) => {
      const leftOrder = reportTypeOrder.get(left.reportType) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = reportTypeOrder.get(right.reportType) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (left.reportType !== right.reportType) {
        return left.reportType.localeCompare(right.reportType);
      }
      return left.id.localeCompare(right.id);
    });
  }

  private attachReportsToRuns<T extends { id: string }>(runs: T[]): Array<T & { reports: unknown[] }> {
    if (runs.length === 0) {
      return [];
    }

    const runIds = runs.map((run) => run.id);
    const reportRows = this.sortReports(
      this.db
        .select()
        .from(this.tables.reports)
        .where(inArray(this.tables.reports.runId, runIds))
        .all(),
    );

    type ReportRow = (typeof reportRows)[number];
    const reportsByRunId = new Map<string, ReportRow[]>();
    for (const reportRow of reportRows) {
      const current = reportsByRunId.get(reportRow.runId) ?? [];
      current.push(reportRow);
      reportsByRunId.set(reportRow.runId, current);
    }

    return runs.map((run) => ({
      ...run,
      reports: reportsByRunId.get(run.id) ?? [],
    }));
  }

  private resolveTableNameFilter(value: string): string {
    if ((COMPANY_RESEARCH_TABLES as readonly string[]).includes(value)) {
      return this.physicalTableNames[value as CompanyResearchTable];
    }
    return value;
  }

  writeRowWithProvenance(request: CompanyResearchWriteRowRequest) {
    const normalizedRecord = normalizeKeys(request.row) as JsonObject;
    return this.insertRecordWithProvenance({
      table: request.table,
      record:
        request.runId && normalizedRecord.run_id === undefined
          ? {
              ...normalizedRecord,
              run_id: request.runId,
            }
          : normalizedRecord,
      provenance_run_id: request.runId,
      provenance: normalizeKeys(request.provenance ?? []),
    });
  }

  readRows(request: CompanyResearchReadRowsRequest) {
    return this.readRecords({
      table: request.table,
      filters: normalizeKeys(request.filters ?? {}),
      limit: request.limit,
      include_provenance: request.includeProvenance ?? false,
    }).rows;
  }

  readRuns(request: CompanyRunsReadRequest) {
    return this.listRuns(normalizeKeys(request) as JsonObject).runs;
  }

  readProvenance(request: CompanyProvenanceReadRequest) {
    return this.listProvenance(normalizeKeys(request) as JsonObject).provenance;
  }
}

export function createCompanyResearchRepository(db: AppDbContext): CompanyResearchRepository {
  return new CompanyResearchRepository(db.connection, db.tablePrefix);
}
