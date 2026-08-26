import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  migrations: { table: "__drizzle_migrations_app_company_research" },
  tablesFilter: [
    "company_research__entities",
    "company_research__companies",
    "company_research__schedules",
    "company_research__runs",
    "company_research__company_attributes",
    "company_research__company_social_pages",
    "company_research__people",
    "company_research__company_person_roles",
    "company_research__company_relationships",
    "company_research__financing_rounds",
    "company_research__financing_round_investors",
    "company_research__metrics",
    "company_research__job_posts",
    "company_research__notable_events",
    "company_research__products",
    "company_research__field_provenance",
  ]
});
