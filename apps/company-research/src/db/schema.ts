import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  COMPANY_RESEARCH_DEPARTMENTS,
  COMPANY_RESEARCH_ENTITY_TYPES,
  COMPANY_RESEARCH_EVENT_CATEGORIES,
  COMPANY_RESEARCH_ACTIVE_USER_TYPES,
  COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES,
  COMPANY_RESEARCH_FINANCING_ROUND_TYPES,
  COMPANY_RESEARCH_INVESTOR_TYPES,
  COMPANY_RESEARCH_PROVENANCE_CONFIDENCE,
  COMPANY_RESEARCH_RELATIONSHIP_TYPES,
  COMPANY_RESEARCH_REPORTING_BASIS,
  COMPANY_RESEARCH_REPORT_TYPES,
  COMPANY_RESEARCH_ROLE_TYPES,
  COMPANY_RESEARCH_RUN_STATUSES,
  COMPANY_RESEARCH_SOCIAL_PAGE_PLATFORMS,
} from "../lib/contracts.js";

export function createCompanyResearchDbSchema(tablePrefix: string = "company_research") {
  const entities = sqliteTable(
    `${tablePrefix}__entities`,
    {
      id: text("id").primaryKey(),
      entityType: text("entity_type", { enum: COMPANY_RESEARCH_ENTITY_TYPES }).notNull(),
      displayName: text("display_name").notNull(),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__entities__entity_type_idx`).on(table.entityType),
      index(`${tablePrefix}__entities__display_name_idx`).on(table.displayName),
    ],
  );

  const companies = sqliteTable(
    `${tablePrefix}__companies`,
    {
      id: text("id")
        .primaryKey()
        .references(() => entities.id),
      canonicalName: text("canonical_name").notNull(),
      domain: text("domain"),
      websiteUrl: text("website_url"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__companies__domain_unique`).on(table.domain),
      uniqueIndex(`${tablePrefix}__companies__website_url_unique`).on(table.websiteUrl),
      index(`${tablePrefix}__companies__canonical_name_idx`).on(table.canonicalName),
    ],
  );

  const schedules = sqliteTable(
    `${tablePrefix}__schedules`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      cadenceMonths: integer("cadence_months").notNull(),
      isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
      nextRunAt: integer("next_run_at", { mode: "timestamp" }),
      lastRunAt: integer("last_run_at", { mode: "timestamp" }),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__schedules__company_id_unique`).on(table.companyId),
      index(`${tablePrefix}__schedules__is_active_next_run_at_idx`).on(
        table.isActive,
        table.nextRunAt,
      ),
    ],
  );

  const runs = sqliteTable(
    `${tablePrefix}__runs`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      status: text("status", { enum: COMPANY_RESEARCH_RUN_STATUSES }).notNull(),
      scheduledFor: integer("scheduled_for", { mode: "timestamp" }),
      startedAt: integer("started_at", { mode: "timestamp" }),
      completedAt: integer("completed_at", { mode: "timestamp" }),
      promptVersion: text("prompt_version"),
      extractorVersion: text("extractor_version"),
      extractorOutput: text("extractor_output"),
      error: text("error"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__runs__company_id_completed_at_idx`).on(table.companyId, table.completedAt),
      index(`${tablePrefix}__runs__status_started_at_idx`).on(table.status, table.startedAt),
    ],
  );

  const reports = sqliteTable(
    `${tablePrefix}__reports`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      reportType: text("report_type", { enum: COMPANY_RESEARCH_REPORT_TYPES }).notNull(),
      reportContent: text("report_content").notNull(),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__reports__run_report_type_unique`).on(table.runId, table.reportType),
      index(`${tablePrefix}__reports__company_run_idx`).on(table.companyId, table.runId),
      index(`${tablePrefix}__reports__report_type_idx`).on(table.reportType),
    ],
  );

  const companyAttributes = sqliteTable(
    `${tablePrefix}__company_attributes`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      commonName: text("common_name"),
      foundingDate: text("founding_date"),
      hqLocation: text("hq_location"),
      primaryGeographies: text("primary_geographies", { mode: "json" }),
      companyStage: text("company_stage"),
      businessModelType: text("business_model_type"),
      companyValueProposition: text("company_value_proposition"),
      industryTags: text("industry_tags", { mode: "json" }),
      marketCategory: text("market_category"),
      customerSegmentsServed: text("customer_segments_served", { mode: "json" }),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__company_attributes__company_id_run_id_unique`).on(
        table.companyId,
        table.runId,
      ),
      index(`${tablePrefix}__company_attributes__company_id_run_id_idx`).on(table.companyId, table.runId),
    ],
  );

  const companySocialPages = sqliteTable(
    `${tablePrefix}__company_social_pages`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      platform: text("platform", { enum: COMPANY_RESEARCH_SOCIAL_PAGE_PLATFORMS }).notNull(),
      pageUrl: text("page_url").notNull(),
      handle: text("handle"),
      isOfficial: integer("is_official", { mode: "boolean" }).notNull().default(true),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__company_social_pages__company_platform_run_unique`).on(
        table.companyId,
        table.platform,
        table.runId,
      ),
      index(`${tablePrefix}__company_social_pages__company_platform_idx`).on(table.companyId, table.platform),
      uniqueIndex(`${tablePrefix}__company_social_pages__page_url_unique`).on(table.pageUrl),
    ],
  );

  const people = sqliteTable(
    `${tablePrefix}__people`,
    {
      id: text("id")
        .primaryKey()
        .references(() => entities.id),
      fullName: text("full_name").notNull(),
      linkedinUrl: text("linkedin_url"),
      websiteUrl: text("website_url"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__people__full_name_idx`).on(table.fullName),
      uniqueIndex(`${tablePrefix}__people__linkedin_url_unique`).on(table.linkedinUrl),
      uniqueIndex(`${tablePrefix}__people__website_url_unique`).on(table.websiteUrl),
    ],
  );

  const companyPersonRoles = sqliteTable(
    `${tablePrefix}__company_person_roles`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      personId: text("person_id")
        .notNull()
        .references(() => people.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      roleType: text("role_type", { enum: COMPANY_RESEARCH_ROLE_TYPES }).notNull(),
      title: text("title"),
      department: text("department", { enum: COMPANY_RESEARCH_DEPARTMENTS }),
      bio: text("bio"),
      isCurrent: integer("is_current", { mode: "boolean" }),
      startDate: text("start_date"),
      endDate: text("end_date"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__company_person_roles__company_role_type_idx`).on(
        table.companyId,
        table.roleType,
      ),
      index(`${tablePrefix}__company_person_roles__company_is_current_idx`).on(
        table.companyId,
        table.isCurrent,
      ),
      index(`${tablePrefix}__company_person_roles__person_id_idx`).on(table.personId),
      uniqueIndex(`${tablePrefix}__company_person_roles__company_person_role_title_run_unique`).on(
        table.companyId,
        table.personId,
        table.roleType,
        table.title,
        table.runId,
      ),
    ],
  );

  const companyRelationships = sqliteTable(
    `${tablePrefix}__company_relationships`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      relatedCompanyId: text("related_company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      relationshipType: text("relationship_type", {
        enum: COMPANY_RESEARCH_RELATIONSHIP_TYPES,
      }).notNull(),
      relationshipStrength: text("relationship_strength"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__company_relationships__company_relationship_type_idx`).on(
        table.companyId,
        table.relationshipType,
      ),
      index(`${tablePrefix}__company_relationships__related_company_id_idx`).on(table.relatedCompanyId),
      uniqueIndex(`${tablePrefix}__company_relationships__company_related_type_run_unique`).on(
        table.companyId,
        table.relatedCompanyId,
        table.relationshipType,
        table.runId,
      ),
    ],
  );

  const financingRounds = sqliteTable(
    `${tablePrefix}__financing_rounds`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      roundType: text("round_type", { enum: COMPANY_RESEARCH_FINANCING_ROUND_TYPES }).notNull(),
      roundLabel: text("round_label"),
      announcedAt: text("announced_at"),
      closedAt: text("closed_at"),
      amountRaised: integer("amount_raised"),
      amountRaisedCurrency: text("amount_raised_currency"),
      preMoneyValuation: integer("pre_money_valuation"),
      preMoneyValuationCurrency: text("pre_money_valuation_currency"),
      postMoneyValuation: integer("post_money_valuation"),
      postMoneyValuationCurrency: text("post_money_valuation_currency"),
      totalCapitalRaised: integer("total_capital_raised"),
      totalCapitalRaisedCurrency: text("total_capital_raised_currency"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__financing_rounds__company_round_date_run_unique`).on(
        table.companyId,
        table.roundType,
        table.announcedAt,
        table.runId,
      ),
      index(`${tablePrefix}__financing_rounds__company_announced_at_idx`).on(
        table.companyId,
        table.announcedAt,
      ),
      index(`${tablePrefix}__financing_rounds__company_round_type_idx`).on(
        table.companyId,
        table.roundType,
      ),
    ],
  );

  const financingRoundInvestors = sqliteTable(
    `${tablePrefix}__financing_round_investors`,
    {
      id: text("id").primaryKey(),
      financingRoundId: text("financing_round_id")
        .notNull()
        .references(() => financingRounds.id),
      entityId: text("entity_id")
        .notNull()
        .references(() => entities.id),
      investorType: text("investor_type", { enum: COMPANY_RESEARCH_INVESTOR_TYPES }),
      investorRole: text("investor_role", { enum: COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES })
        .notNull()
        .default("participant"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__financing_round_investors__round_investor_role_unique`).on(
        table.financingRoundId,
        table.entityId,
        table.investorRole,
      ),
      index(`${tablePrefix}__financing_round_investors__round_idx`).on(table.financingRoundId),
      index(`${tablePrefix}__financing_round_investors__entity_idx`).on(table.entityId),
    ],
  );

  const metrics = sqliteTable(
    `${tablePrefix}__metrics`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      metricYear: integer("metric_year").notNull(),
      annualRevenue: integer("annual_revenue"),
      originalRevenueType: text("original_revenue_type"),
      originalRevenueValue: text("original_revenue_value"),
      originalRevenueCurrency: text("original_revenue_currency"),
      profit: integer("profit"),
      originalProfitType: text("original_profit_type"),
      originalProfitValue: text("original_profit_value"),
      originalProfitCurrency: text("original_profit_currency"),
      headcountTotal: integer("headcount_total"),
      activeUsers: integer("active_users"),
      activeUsersType: text("active_users_type", { enum: COMPANY_RESEARCH_ACTIVE_USER_TYPES }),
      payingCustomers: integer("paying_customers"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      uniqueIndex(`${tablePrefix}__metrics__company_year_run_unique`).on(
        table.companyId,
        table.metricYear,
        table.runId,
      ),
      index(`${tablePrefix}__metrics__company_year_idx`).on(table.companyId, table.metricYear),
    ],
  );

  const jobPosts = sqliteTable(
    `${tablePrefix}__job_posts`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      jobTitle: text("job_title").notNull(),
      department: text("department", { enum: COMPANY_RESEARCH_DEPARTMENTS }),
      location: text("location"),
      employmentType: text("employment_type"),
      postedAt: text("posted_at"),
      externalUrl: text("external_url"),
      description: text("description"),
      status: text("status"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__job_posts__company_posted_at_idx`).on(table.companyId, table.postedAt),
      index(`${tablePrefix}__job_posts__company_status_idx`).on(table.companyId, table.status),
      uniqueIndex(`${tablePrefix}__job_posts__company_role_fingerprint_unique`).on(
        table.companyId,
        table.jobTitle,
        table.employmentType,
        table.department,
        table.location,
      ),
    ],
  );

  const notableEvents = sqliteTable(
    `${tablePrefix}__notable_events`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      eventCategory: text("event_category", { enum: COMPANY_RESEARCH_EVENT_CATEGORIES }).notNull(),
      headline: text("headline").notNull(),
      summary: text("summary"),
      eventDate: text("event_date"),
      externalUrl: text("external_url"),
      sourceName: text("source_name"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__notable_events__company_category_event_date_idx`).on(
        table.companyId,
        table.eventCategory,
        table.eventDate,
      ),
      uniqueIndex(`${tablePrefix}__notable_events__company_category_external_url_unique`).on(
        table.companyId,
        table.eventCategory,
        table.externalUrl,
      ),
    ],
  );

  const products = sqliteTable(
    `${tablePrefix}__products`,
    {
      id: text("id").primaryKey(),
      companyId: text("company_id")
        .notNull()
        .references(() => companies.id),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      productName: text("product_name").notNull(),
      productCategory: text("product_category"),
      valueProposition: text("value_proposition"),
      targetCustomerIcp: text("target_customer_icp"),
      isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__products__company_is_primary_idx`).on(table.companyId, table.isPrimary),
      index(`${tablePrefix}__products__company_product_name_idx`).on(table.companyId, table.productName),
      uniqueIndex(`${tablePrefix}__products__company_product_name_run_unique`).on(
        table.companyId,
        table.productName,
        table.runId,
      ),
    ],
  );

  const fieldProvenance = sqliteTable(
    `${tablePrefix}__field_provenance`,
    {
      id: text("id").primaryKey(),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      tableName: text("table_name").notNull(),
      rowId: text("row_id").notNull(),
      fieldName: text("field_name"),
      asOfDate: text("as_of_date"),
      citationUrl: text("citation_url"),
      confidence: text("confidence", { enum: COMPANY_RESEARCH_PROVENANCE_CONFIDENCE }),
      reportingBasis: text("reporting_basis", { enum: COMPANY_RESEARCH_REPORTING_BASIS }),
      notes: text("notes"),
      createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    },
    (table) => [
      index(`${tablePrefix}__field_provenance__table_row_idx`).on(table.tableName, table.rowId),
      index(`${tablePrefix}__field_provenance__run_id_idx`).on(table.runId),
      index(`${tablePrefix}__field_provenance__table_field_idx`).on(table.tableName, table.fieldName),
      uniqueIndex(`${tablePrefix}__field_provenance__natural_key_unique`).on(
        table.tableName,
        table.rowId,
        table.fieldName,
        table.runId,
      ),
    ],
  );

  return {
    entities,
    companies,
    schedules,
    runs,
    reports,
    companyAttributes,
    companySocialPages,
    people,
    companyPersonRoles,
    companyRelationships,
    financingRounds,
    financingRoundInvestors,
    metrics,
    jobPosts,
    notableEvents,
    products,
    fieldProvenance,
  };
}

const defaultSchema = createCompanyResearchDbSchema();

export const entities = defaultSchema.entities;
export const companies = defaultSchema.companies;
export const schedules = defaultSchema.schedules;
export const runs = defaultSchema.runs;
export const reports = defaultSchema.reports;
export const companyAttributes = defaultSchema.companyAttributes;
export const companySocialPages = defaultSchema.companySocialPages;
export const people = defaultSchema.people;
export const companyPersonRoles = defaultSchema.companyPersonRoles;
export const companyRelationships = defaultSchema.companyRelationships;
export const financingRounds = defaultSchema.financingRounds;
export const financingRoundInvestors = defaultSchema.financingRoundInvestors;
export const metrics = defaultSchema.metrics;
export const jobPosts = defaultSchema.jobPosts;
export const notableEvents = defaultSchema.notableEvents;
export const products = defaultSchema.products;
export const fieldProvenance = defaultSchema.fieldProvenance;
