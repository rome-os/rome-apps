export const COMPANY_RESEARCH_WRITE_TABLES = [
  "company_attributes",
  "company_social_pages",
  "people",
  "company_person_roles",
  "company_relationships",
  "financing_rounds",
  "metrics",
  "job_posts",
  "notable_events",
  "products",
] as const;

export type CompanyResearchWriteTable = (typeof COMPANY_RESEARCH_WRITE_TABLES)[number];

export const COMPANY_RESEARCH_READ_TABLES = [
  ...COMPANY_RESEARCH_WRITE_TABLES,
  "reports",
  "entities",
  "financing_round_investors",
] as const;

export type CompanyResearchReadTable = (typeof COMPANY_RESEARCH_READ_TABLES)[number];

export function isCompanyResearchWriteTable(value: unknown): value is CompanyResearchWriteTable {
  return (
    typeof value === "string" &&
    (COMPANY_RESEARCH_WRITE_TABLES as readonly string[]).includes(value)
  );
}

export function isCompanyResearchReadTable(value: unknown): value is CompanyResearchReadTable {
  return (
    typeof value === "string" &&
    (COMPANY_RESEARCH_READ_TABLES as readonly string[]).includes(value)
  );
}

export const COMPANY_RESEARCH_RUN_STATUSES = [
  "running",
  "success",
  "partial",
  "error",
] as const;

export const COMPANY_RESEARCH_REPORT_TYPES = [
  "company",
  "team",
  "marketing",
  "content",
  "financials",
] as const;

export const COMPANY_RESEARCH_SOCIAL_PAGE_PLATFORMS = [
  "linkedin",
  "x",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "crunchbase",
  "github",
  "other",
] as const;

export const COMPANY_RESEARCH_ROLE_TYPES = [
  "founder",
  "key_executive",
  "board_member",
  "employee",
  "alumni",
] as const;

export const COMPANY_RESEARCH_DEPARTMENTS = [
  "board",
  "executive",
  "engineering",
  "product",
  "design",
  "data",
  "research",
  "sales",
  "marketing",
  "partnerships",
  "customer_success",
  "support",
  "operations",
  "finance",
  "legal",
  "people",
  "recruiting",
  "it",
  "security",
  "other",
  "unknown",
] as const;

export const COMPANY_RESEARCH_RELATIONSHIP_TYPES = ["customer", "competitor"] as const;

export const COMPANY_RESEARCH_ENTITY_TYPES = [
  "company",
  "person",
] as const;

export const COMPANY_RESEARCH_INVESTOR_TYPES = [
  "venture_capital",
  "private_equity",
  "corporate",
  "angel",
  "family_office",
  "government",
  "accelerator",
  "bank",
  "other",
  "unknown",
] as const;

export const COMPANY_RESEARCH_FINANCING_ROUND_TYPES = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "venture",
  "growth_equity",
  "debt",
  "grant",
  "secondary",
  "post_ipo_equity",
  "undisclosed",
  "other",
] as const;

export const COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES = [
  "lead",
  "participant",
  "existing",
  "other",
] as const;

export const COMPANY_RESEARCH_PROVENANCE_CONFIDENCE = [
  "high",
  "medium",
  "low",
] as const;

export const COMPANY_RESEARCH_REPORTING_BASIS = [
  "self_reported",
  "independently_verified",
  "third_party_reported",
  "derived_or_estimated",
  "other",
  "unknown",
] as const;

export const COMPANY_RESEARCH_EVENT_CATEGORIES = [
  "hiring",
  "layoff",
  "exec_change",
  "funding",
  "product_launch",
  "partnership",
  "regulatory",
  "acquisition",
  "other",
] as const;

export const COMPANY_RESEARCH_ACTIVE_USER_TYPES = [
  "dau",
  "wau",
  "mau",
  "unknown",
] as const;
