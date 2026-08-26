import { getCurrentActionContext } from "@rome-os/app-runtime";
import type { Action, ActionConfig, ActionResult, AppActionRuntimeDeps } from "@rome-os/app-runtime";
import {
  COMPANY_RESEARCH_DEPARTMENTS,
  COMPANY_RESEARCH_ENTITY_TYPES,
  COMPANY_RESEARCH_EVENT_CATEGORIES,
  COMPANY_RESEARCH_ACTIVE_USER_TYPES,
  COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES,
  COMPANY_RESEARCH_FINANCING_ROUND_TYPES,
  COMPANY_RESEARCH_INVESTOR_TYPES,
  COMPANY_RESEARCH_PROVENANCE_CONFIDENCE,
  COMPANY_RESEARCH_READ_TABLES,
  COMPANY_RESEARCH_RELATIONSHIP_TYPES,
  COMPANY_RESEARCH_REPORTING_BASIS,
  COMPANY_RESEARCH_ROLE_TYPES,
  COMPANY_RESEARCH_RUN_STATUSES,
  COMPANY_RESEARCH_SOCIAL_PAGE_PLATFORMS,
} from "./contracts.js";
import { createCompanyResearchRepository } from "../db/repositories/company-research.js";

function success(data?: unknown): ActionResult {
  return data === undefined ? { status: "ok" } : { status: "ok", data };
}

type JsonObject = Record<string, unknown>;

type ScopedWriteActionOptions = {
  properties: Record<string, unknown>;
  required?: string[];
  execute: (
    repository: ReturnType<typeof createCompanyResearchRepository>,
    input: JsonObject,
  ) => unknown;
};

export { createCompanyResearchRunCompanyResearchAction } from "./run-company-research.js";

function assertObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("input must be an object");
  }
  return value as JsonObject;
}

function readOptionalString(record: JsonObject | undefined, fieldName: string): string | null {
  const value = record?.[fieldName];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalContextString(...fieldNames: string[]): string | null {
  const sharedContext = getCurrentActionContext()?.sharedContext;
  if (!sharedContext || typeof sharedContext !== "object" || Array.isArray(sharedContext)) {
    return null;
  }

  for (const fieldName of fieldNames) {
    const value = sharedContext[fieldName];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`sharedContext.${fieldName} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function withSharedScope(input: JsonObject): JsonObject {
  return {
    ...input,
    company_id:
      readOptionalString(input, "company_id") ??
      readOptionalContextString("company_id", "companyId") ??
      undefined,
    run_id:
      readOptionalString(input, "run_id") ?? readOptionalContextString("run_id", "runId") ?? undefined,
  };
}

const provenanceSchema = {
  type: "array",
  description:
    "Optional provenance rows inserted in the same transaction. field_name may be omitted or null to attach provenance to the whole row.",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      run_id: { type: "string" },
      field_name: { type: "string" },
      as_of_date: { type: "string", description: "YYYY-MM-DD" },
      citation_url: { type: "string" },
      confidence: {
        type: "string",
        enum: [...COMPANY_RESEARCH_PROVENANCE_CONFIDENCE],
      },
      reporting_basis: {
        type: "string",
        enum: [...COMPANY_RESEARCH_REPORTING_BASIS],
      },
      notes: { type: "string" },
    },
  },
};

const scopedWriteProperties = {
  company_id: {
    type: "string",
    description: "Optional. Defaults from sharedContext.company_id when available.",
  },
  run_id: {
    type: "string",
    description: "Optional. Defaults from sharedContext.run_id when available.",
  },
  provenance_run_id: {
    type: "string",
    description:
      "Optional provenance run ID override. Usually unnecessary when run_id is provided or available in shared context.",
  },
  provenance: provenanceSchema,
} as const;

function createScopedWriteAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
  options: ScopedWriteActionOptions,
): Action {
  const repository = createCompanyResearchRepository(deps.appContext.db);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        ...scopedWriteProperties,
        ...options.properties,
      },
      required: options.required ?? [],
      additionalProperties: false,
    },
    async execute(input): Promise<ActionResult> {
      options.execute(repository, withSharedScope(assertObject(input)));
      return success();
    },
  };
}

export function createCompanyResearchAddCompanyAttributesAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      common_name: { type: "string" },
      founding_date: { type: "string", description: "YYYY-MM-DD" },
      hq_location: { type: "string" },
      primary_geographies: { type: "array", items: { type: "string" } },
      company_stage: { type: "string" },
      business_model_type: { type: "string" },
      company_value_proposition: { type: "string" },
      industry_tags: { type: "array", items: { type: "string" } },
      market_category: { type: "string" },
      customer_segments_served: { type: "array", items: { type: "string" } },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    execute: (repository, input) => repository.addCompanyAttributes(input),
  });
}

export function createCompanyResearchAddCompanySocialPageAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      platform: {
        type: "string",
        enum: [...COMPANY_RESEARCH_SOCIAL_PAGE_PLATFORMS],
      },
      page_url: { type: "string" },
      handle: { type: "string" },
      is_official: { type: "boolean" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    required: ["page_url"],
    execute: (repository, input) => repository.addCompanySocialPage(input),
  });
}

export function createCompanyResearchAddPersonRoleAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      person_name: { type: "string" },
      linkedin_url: { type: "string", description: "The person's LinkedIn profile URL." },
      website_url: {
        type: "string",
        description:
          "The person's own profile page, personal website, or blog. Do not use a general team page or any page that includes multiple people. Leave empty if no personal page is found. If the URL already belongs to another stored person_name, the action errors.",
      },
      role_type: { type: "string", enum: [...COMPANY_RESEARCH_ROLE_TYPES] },
      title: { type: "string" },
      department: { type: "string", enum: [...COMPANY_RESEARCH_DEPARTMENTS] },
      bio: { type: "string" },
      is_current: { type: "boolean" },
      start_date: { type: "string", description: "YYYY-MM-DD" },
      end_date: { type: "string", description: "YYYY-MM-DD" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    required: ["person_name"],
    execute: (repository, input) => repository.addCompanyPersonRole(input),
  });
}

export function createCompanyResearchAddCompanyRelationshipAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      related_company_name: { type: "string" },
      company_name: { type: "string", description: "Alias for related_company_name." },
      related_company_domain: { type: "string" },
      domain: { type: "string", description: "Alias for related_company_domain." },
      related_company_website_url: { type: "string" },
      website_url: { type: "string", description: "Alias for related_company_website_url." },
      relationship_type: { type: "string", enum: [...COMPANY_RESEARCH_RELATIONSHIP_TYPES] },
      relationship_strength: { type: "string" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    execute: (repository, input) => repository.addCompanyRelationship(input),
  });
}

export function createCompanyResearchAddFinancingRoundAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      round_type: { type: "string", enum: [...COMPANY_RESEARCH_FINANCING_ROUND_TYPES] },
      round_label: { type: "string" },
      announced_at: { type: "string", description: "YYYY-MM-DD" },
      closed_at: { type: "string", description: "YYYY-MM-DD" },
      amount_raised: { type: "number" },
      amount_raised_currency: { type: "string" },
      pre_money_valuation: { type: "number" },
      pre_money_valuation_currency: { type: "string" },
      post_money_valuation: { type: "number" },
      post_money_valuation_currency: { type: "string" },
      total_capital_raised: { type: "number" },
      total_capital_raised_currency: { type: "string" },
      investors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            round_investor_id: { type: "string" },
            investor_name: { type: "string" },
            entity_type: { type: "string", enum: [...COMPANY_RESEARCH_ENTITY_TYPES] },
            domain: { type: "string" },
            website_url: { type: "string" },
            linkedin_url: { type: "string" },
            investor_type: { type: "string", enum: [...COMPANY_RESEARCH_INVESTOR_TYPES] },
            investor_role: { type: "string", enum: [...COMPANY_RESEARCH_FINANCING_INVESTOR_ROLES] },
            created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
            updated_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
          },
          additionalProperties: false,
        },
      },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    execute: (repository, input) => repository.addFinancingRound(input),
  });
}

export function createCompanyResearchAddMetricsAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      metric_year: { type: "number" },
      annual_revenue: { type: "number" },
      original_revenue_type: { type: "string" },
      original_revenue_value: {
        anyOf: [{ type: "string" }, { type: "number" }],
      },
      original_revenue_currency: { type: "string" },
      profit: { type: "number" },
      original_profit_type: { type: "string" },
      original_profit_value: {
        anyOf: [{ type: "string" }, { type: "number" }],
      },
      original_profit_currency: { type: "string" },
      headcount_total: { type: "number" },
      active_users: { type: "number" },
      active_users_type: {
        type: "string",
        enum: [...COMPANY_RESEARCH_ACTIVE_USER_TYPES],
      },
      paying_customers: { type: "number" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    required: ["metric_year"],
    execute: (repository, input) => repository.addMetrics(input),
  });
}

export function createCompanyResearchAddJobPostAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      job_title: { type: "string" },
      department: { type: "string", enum: [...COMPANY_RESEARCH_DEPARTMENTS] },
      location: { type: "string" },
      employment_type: { type: "string" },
      posted_at: { type: "string", description: "YYYY-MM-DD" },
      external_url: { type: "string" },
      description: { type: "string" },
      status: { type: "string" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    required: ["job_title"],
    execute: (repository, input) => repository.addJobPost(input),
  });
}

export function createCompanyResearchAddNotableEventAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      event_category: { type: "string", enum: [...COMPANY_RESEARCH_EVENT_CATEGORIES] },
      headline: { type: "string" },
      summary: { type: "string" },
      event_date: { type: "string", description: "YYYY-MM-DD" },
      external_url: { type: "string" },
      source_name: { type: "string" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    required: ["headline"],
    execute: (repository, input) => repository.addNotableEvent(input),
  });
}

export function createCompanyResearchAddProductAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  return createScopedWriteAction(config, deps, {
    properties: {
      id: { type: "string" },
      product_name: { type: "string" },
      product_category: { type: "string" },
      value_proposition: { type: "string" },
      target_customer_icp: { type: "string" },
      is_primary: { type: "boolean" },
      created_at: { type: "string", description: "ISO-8601 timestamp or epoch" },
    },
    required: ["product_name"],
    execute: (repository, input) => repository.addProduct(input),
  });
}

export function createCompanyResearchReadRowsAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const repository = createCompanyResearchRepository(deps.appContext.db);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          enum: [...COMPANY_RESEARCH_READ_TABLES],
          description: "Target typed table among company-research tables 4-15 plus investor lookup tables",
        },
        filters: {
          type: "object",
          description:
            "Optional filters. Common keys include id, ids, company_id, run_id, plus table-specific fields such as platform, person_id, related_company_id, round_type, investor_role, metric_year, status, event_category, and is_primary.",
        },
        include_provenance: {
          type: "boolean",
          description: "Attach matching field_provenance rows to each returned row.",
        },
        limit: {
          type: "number",
          description: "Maximum rows to return, default 50, max 200",
        },
      },
      required: ["table"],
    },
    async execute(input): Promise<ActionResult> {
      return success(repository.readRecords(input as Record<string, unknown>));
    },
  };
}

export function createCompanyResearchSearchCompaniesAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const repository = createCompanyResearchRepository(deps.appContext.db);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional explicit company IDs to read",
        },
        id: { type: "string" },
        query: {
          type: "string",
          description: "Case-insensitive partial match against canonical name, domain, or website URL",
        },
        domain: { type: "string" },
        website_url: { type: "string" },
        limit: { type: "number" },
      },
    },
    async execute(input): Promise<ActionResult> {
      return success(repository.searchCompanies(input as Record<string, unknown>));
    },
  };
}

export function createCompanyResearchReadRunsAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const repository = createCompanyResearchRepository(deps.appContext.db);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        company_id: { type: "string" },
        status: { type: "string", enum: [...COMPANY_RESEARCH_RUN_STATUSES] },
        prompt_version: { type: "string" },
        extractor_version: { type: "string" },
        scheduled_for_from: { type: "string", description: "ISO-8601 timestamp or epoch" },
        scheduled_for_to: { type: "string", description: "ISO-8601 timestamp or epoch" },
        started_at_from: { type: "string", description: "ISO-8601 timestamp or epoch" },
        started_at_to: { type: "string", description: "ISO-8601 timestamp or epoch" },
        completed_at_from: { type: "string", description: "ISO-8601 timestamp or epoch" },
        completed_at_to: { type: "string", description: "ISO-8601 timestamp or epoch" },
        limit: { type: "number" },
      },
    },
    async execute(input): Promise<ActionResult> {
      return success(repository.listRuns(input as Record<string, unknown>));
    },
  };
}

export function createCompanyResearchReadProvenanceAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const repository = createCompanyResearchRepository(deps.appContext.db);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        run_id: { type: "string" },
        table_name: {
          type: "string",
          description:
            "Short table key such as products or a physical table name such as company_research__products",
        },
        row_id: { type: "string" },
        field_name: { type: "string" },
        field_name_is_null: {
          type: "boolean",
          description: "Set true to read row-level provenance entries with no field_name",
        },
        citation_url: { type: "string" },
        confidence: {
          type: "string",
          enum: [...COMPANY_RESEARCH_PROVENANCE_CONFIDENCE],
        },
        reporting_basis: {
          type: "string",
          enum: [...COMPANY_RESEARCH_REPORTING_BASIS],
        },
        as_of_date_from: { type: "string", description: "YYYY-MM-DD" },
        as_of_date_to: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number" },
      },
    },
    async execute(input): Promise<ActionResult> {
      return success(repository.listProvenance(input as Record<string, unknown>));
    },
  };
}
