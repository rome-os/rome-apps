export const COMPANY_RESEARCH_TABLES = [
  "companies",
  "schedules",
  "runs",
  "reports",
  "company_attributes",
  "company_social_pages",
  "entities",
  "people",
  "company_person_roles",
  "company_relationships",
  "financing_rounds",
  "financing_round_investors",
  "metrics",
  "job_posts",
  "notable_events",
  "products",
  "field_provenance",
] as const;

export const COMPANY_RESEARCH_WRITABLE_TABLES = [
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

export const COMPANY_RESEARCH_READABLE_TABLES = [
  ...COMPANY_RESEARCH_WRITABLE_TABLES,
  "reports",
  "entities",
  "financing_round_investors",
] as const;

export type CompanyResearchTable = (typeof COMPANY_RESEARCH_TABLES)[number];
export type CompanyResearchWritableTable = (typeof COMPANY_RESEARCH_WRITABLE_TABLES)[number];
export type CompanyResearchReadableTable = (typeof COMPANY_RESEARCH_READABLE_TABLES)[number];

export const COMPANY_SOCIAL_PAGE_PLATFORMS = [
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

export const COMPANY_RESEARCH_RUN_STATUSES = ["running", "success", "partial", "error"] as const;
export const COMPANY_RESEARCH_REPORT_TYPES = [
  "company",
  "team",
  "marketing",
  "content",
  "financials",
] as const;
export const COMPANY_PERSON_ROLE_TYPES = [
  "founder",
  "key_executive",
  "board_member",
  "employee",
  "alumni",
] as const;
export const COMPANY_DEPARTMENTS = [
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
export const COMPANY_RELATIONSHIP_TYPES = ["customer", "competitor"] as const;
export const COMPANY_RESEARCH_ENTITY_TYPES = ["company", "person"] as const;
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
export const COMPANY_RESEARCH_ACTIVE_USER_TYPES = ["dau", "wau", "mau", "unknown"] as const;
export const COMPANY_RESEARCH_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const COMPANY_RESEARCH_REPORTING_BASIS_VALUES = [
  "self_reported",
  "independently_verified",
  "third_party_reported",
  "derived_or_estimated",
  "other",
  "unknown",
] as const;

export type CompanyResearchRunStatus = (typeof COMPANY_RESEARCH_RUN_STATUSES)[number];
export type CompanyResearchReportType = (typeof COMPANY_RESEARCH_REPORT_TYPES)[number];
export type CompanySocialPagePlatform = (typeof COMPANY_SOCIAL_PAGE_PLATFORMS)[number];
export type CompanyPersonRoleType = (typeof COMPANY_PERSON_ROLE_TYPES)[number];
export type CompanyDepartment = (typeof COMPANY_DEPARTMENTS)[number];
export type CompanyRelationshipType = (typeof COMPANY_RELATIONSHIP_TYPES)[number];
export type CompanyResearchEntityType = (typeof COMPANY_RESEARCH_ENTITY_TYPES)[number];
export type CompanyResearchInvestorType = (typeof COMPANY_RESEARCH_INVESTOR_TYPES)[number];
export type CompanyResearchFinancingRoundType =
  (typeof COMPANY_RESEARCH_FINANCING_ROUND_TYPES)[number];
export type CompanyResearchFinancingInvestorRole =
  (typeof COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES)[number];
export type CompanyResearchEventCategory =
  (typeof COMPANY_RESEARCH_EVENT_CATEGORIES)[number];
export type CompanyResearchActiveUserType =
  (typeof COMPANY_RESEARCH_ACTIVE_USER_TYPES)[number];
export type CompanyResearchConfidenceValue =
  (typeof COMPANY_RESEARCH_CONFIDENCE_VALUES)[number];
export type CompanyResearchReportingBasisValue =
  (typeof COMPANY_RESEARCH_REPORTING_BASIS_VALUES)[number];

export interface CompanyResearchProvenanceInput {
  id?: string;
  run_id?: string;
  field_name?: string | null;
  as_of_date?: string | null;
  citation_url?: string | null;
  confidence?: CompanyResearchConfidenceValue | null;
  reporting_basis?: CompanyResearchReportingBasisValue | null;
  notes?: string | null;
}
