export interface SeoWorkflowField {
  name: string;
  description: string;
  required?: boolean;
}

export interface SeoWorkflowSpec {
  title: string;
  summary: string;
  skills: string[];
  fields: SeoWorkflowField[];
  workflow: string[];
  deliverable: string[];
}

export const SEO_WORKFLOWS: Record<string, SeoWorkflowSpec> = {
  audit_domain: {
    title: "Audit Domain",
    summary: "Run a CITE domain authority audit with competitor and domain-type context.",
    skills: ["domain-authority-auditor", "backlink-analyzer"],
    fields: [
      { name: "domain", description: "Domain to audit", required: true },
      { name: "type", description: "Optional domain type weighting hint" },
      { name: "competitors", description: "Optional competitor domains for comparison" },
    ],
    workflow: [
      "Identify or confirm the domain type and apply the right CITE weighting profile.",
      "Run the domain-authority-auditor workflow and use backlink-analyzer detail where it improves the diagnosis.",
      "If competitors are provided, compare authority gaps and explain which gaps matter most.",
    ],
    deliverable: [
      "Return the CITE score, veto status, dimension breakdown, top improvements, and an action plan.",
      "Call out what data is fetched versus inferred from the user's input.",
    ],
  },
  audit_page: {
    title: "Audit Page",
    summary: "Run an on-page SEO audit plus a CORE-EEAT content-quality audit.",
    skills: ["on-page-seo-auditor", "content-quality-auditor"],
    fields: [
      { name: "source", description: "URL or pasted content to audit", required: true },
      { name: "keyword", description: "Optional target keyword for relevance scoring" },
    ],
    workflow: [
      "Evaluate on-page SEO first, including structure, keywords, links, media, and obvious technical issues.",
      "Then run the content-quality-auditor workflow with a clear verdict: SHIP, FIX, or BLOCK.",
      "Merge the findings into one prioritized fix list instead of returning two disconnected reports.",
    ],
    deliverable: [
      "Return section scores, CORE-EEAT findings, veto items if any, and a concrete action checklist.",
      "Recommend a technical follow-up only if the page issues extend beyond content and on-page work.",
    ],
  },
  check_technical: {
    title: "Check Technical",
    summary: "Run a focused technical SEO health check for a page or domain.",
    skills: ["technical-seo-checker"],
    fields: [{ name: "target", description: "URL or domain to inspect", required: true }],
    workflow: [
      "Determine whether the request is page-specific or domain-wide.",
      "Audit crawlability, HTTPS, performance, mobile readiness, URL health, and infrastructure signals.",
      "Prioritize fixes by severity and likely ranking impact.",
    ],
    deliverable: [
      "Return an overall technical score, section breakdown, Core Web Vitals view, and a fix checklist.",
    ],
  },
  generate_schema: {
    title: "Generate Schema",
    summary: "Generate JSON-LD structured data for a target page or content description.",
    skills: ["schema-markup-generator"],
    fields: [
      { name: "schema_type", description: "Requested Schema.org type", required: true },
      { name: "source", description: "Optional URL, content, or page description" },
    ],
    workflow: [
      "Identify the most specific schema type that fits the request and note any useful companion schemas.",
      "Gather the required and recommended properties from the provided source.",
      "Generate valid JSON-LD and explain implementation and validation steps.",
    ],
    deliverable: [
      "Return the markup, validation notes, rich-result eligibility, and implementation guidance.",
    ],
  },
  keyword_research: {
    title: "Keyword Research",
    summary: "Research keyword opportunities, intent, difficulty, and topic clusters.",
    skills: ["keyword-research", "competitor-analysis", "content-gap-analysis"],
    fields: [
      { name: "seed", description: "Seed keyword or topic", required: true },
      { name: "audience", description: "Optional target audience" },
      {
        name: "goal",
        description: "Optional business goal such as traffic, leads, sales, or awareness",
      },
      { name: "authority", description: "Optional site authority level" },
      { name: "competitors", description: "Optional competitor domains for gap analysis" },
    ],
    workflow: [
      "Expand the seed topic into realistic keyword clusters and classify search intent.",
      "Score opportunities with explicit reasoning, not vague labels.",
      "If competitors are provided, add keyword-gap and content-gap findings that change the strategy.",
    ],
    deliverable: [
      "Return quick wins, growth opportunities, GEO opportunities, topic clusters, and a short content plan.",
    ],
  },
  optimize_meta: {
    title: "Optimize Meta",
    summary: "Improve titles, descriptions, and social tags for CTR and search visibility.",
    skills: ["meta-tags-optimizer", "seo-content-writer"],
    fields: [
      { name: "source", description: "URL or page details", required: true },
      { name: "keyword", description: "Optional target keyword" },
      { name: "mode", description: "Optional mode such as a/b-test" },
    ],
    workflow: [
      "Assess the current title, meta description, and social tags if they are available.",
      "Generate improved variants with clear rationale, keyword use, and character-length discipline.",
      "If mode is a/b-test, include a sensible experiment setup instead of only more copy options.",
    ],
    deliverable: [
      "Return current-state analysis, recommended variants, and implementation-ready HTML tags.",
    ],
  },
  report: {
    title: "Performance Report",
    summary: "Generate a period-based SEO and GEO performance report.",
    skills: ["performance-reporter", "domain-authority-auditor", "content-quality-auditor"],
    fields: [
      { name: "domain", description: "Domain to report on", required: true },
      { name: "period", description: "Reporting period", required: true },
      { name: "comparison", description: "Optional comparison period" },
      { name: "format", description: "Optional output format such as detailed or executive" },
    ],
    workflow: [
      "Build the report around the requested period and comparison window.",
      "Summarize wins, concerns, and opportunities across traffic, rankings, authority, technical health, GEO, and content.",
      "If the user requests an executive format, compress the output to the highest-signal findings and action plan.",
    ],
    deliverable: [
      "Return a stakeholder-ready report with prioritized next steps and explicit assumptions where data is incomplete.",
    ],
  },
  setup_alert: {
    title: "Setup Alert",
    summary: "Design alerting rules and playbooks for SEO and GEO monitoring.",
    skills: ["alert-manager", "rank-tracker"],
    fields: [
      { name: "alert_type", description: "Alert type to configure", required: true },
      { name: "threshold", description: "Optional numeric or qualitative threshold" },
      { name: "keywords", description: "Optional keyword scope" },
      { name: "severity", description: "Optional alert severity" },
    ],
    workflow: [
      "Interpret the requested alert package or single alert type.",
      "Define threshold logic, scope, notification strategy, and false-positive handling.",
      "Provide a response playbook instead of stopping at configuration details.",
    ],
    deliverable: [
      "Return active alert definitions, notification guidance, testing steps, and incident playbooks.",
    ],
  },
  write_content: {
    title: "Write Content",
    summary: "Create SEO content and then run a GEO optimization pass.",
    skills: ["seo-content-writer", "geo-content-optimizer", "content-quality-auditor"],
    fields: [
      { name: "topic", description: "Content topic", required: true },
      { name: "keyword", description: "Primary target keyword", required: true },
      { name: "type", description: "Optional content type such as blog post or landing page" },
    ],
    workflow: [
      "Draft the content with a clear search intent match and a practical structure.",
      "Run a GEO pass to improve quotability, factual density, definitions, and AI-friendly formatting.",
      "Include metadata and a brief self-check so the user can ship or revise with confidence.",
    ],
    deliverable: [
      "Return the finished content, meta description, SEO metadata, and GEO improvement notes.",
    ],
  },
};

export function getSeoWorkflowSpec(actionName: string): SeoWorkflowSpec {
  const spec = SEO_WORKFLOWS[actionName];
  if (!spec) {
    throw new Error(`Unknown SEO workflow: ${actionName}`);
  }
  return spec;
}

export function buildSeoWorkflowPrompt(actionName: string, args: Record<string, unknown>): string {
  const spec = getSeoWorkflowSpec(actionName);
  const providedFields = spec.fields
    .map((field) => {
      const value = normalizeString(args[field.name]);
      return value ? `- ${field.name}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);

  return [
    `Handle the SEO workflow "${spec.title}".`,
    spec.summary,
    "",
    "Prefer these SEO app skills:",
    ...spec.skills.map((skill) => `- ${skill}`),
    "",
    "Inputs:",
    ...(providedFields.length > 0 ? providedFields : ["- none provided"]),
    "",
    "Workflow:",
    ...spec.workflow.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Deliverable requirements:",
    ...spec.deliverable.map((item) => `- ${item}`),
    "",
    "Constraints:",
    "- Make reasonable assumptions for optional inputs instead of blocking on minor gaps.",
    "- Distinguish user-provided inputs from fetched or inferred findings.",
    "- Use web tools when the task depends on live pages, domains, or search results.",
    "- Do not write files or persist memory unless the user explicitly asks for that.",
  ].join("\n");
}

export function validateSeoWorkflowArgs(
  actionName: string,
  args: Record<string, unknown>,
): string | null {
  const spec = getSeoWorkflowSpec(actionName);
  for (const field of spec.fields) {
    if (!field.required) {
      continue;
    }

    const value = normalizeString(args[field.name]);
    if (!value) {
      return `${field.name} is required`;
    }
  }

  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
