# Company Research DB Design

## Goal

Support three use cases at the same time:

1. run deep company research on a schedule such as every 3 months
2. render the exact past report for a given run
3. render current overview data and historical trends from structured fields

The recommended design is:

- keep each research run immutable
- keep the full raw report for point-in-time viewing
- store extracted data in typed domain tables, not a generic EAV table
- keep one generic provenance table for field-level metadata such as citation URL, `as_of_date`, and confidence

This keeps the main data model queryable and explicit, while still preserving the per-field evidence needed for research data.

## Main Design Choice

Do not use a generic `attributes` or `metric_points` table.

Instead, use:

- typed domain tables for products, entities, people, relationships, financing rounds, metrics, job posts, notable events, company social pages, and company attributes
- immutable `research_runs` rows to preserve the exact report at each point in time
- a single generic `field_provenance` table for per-field metadata

The generic provenance table is still needed because even when the values live in typed columns, the citation, `as_of_date`, confidence, and notes often differ by field.

## Tables

### 1. `company_research__companies`

Canonical company registry. This should include both:

- primary companies you actively research
- related companies that appear as customers or competitors

Suggested columns:

- `id` PK and FK -> `entities.id`
- `canonical_name` text not null
- `domain` text
- `website_url` text
- `created_at`
- `updated_at`

Suggested constraints and indexes:

- unique index on `domain` when present
- optional unique index on normalized `website_url`
- index on `canonical_name`

### 2. `company_research__schedules`

Drives recurring research.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `cadence_months` integer not null
- `is_active` boolean not null default true
- `next_run_at` timestamp
- `last_run_at` timestamp
- `created_at`
- `updated_at`

Suggested defaults:

- use `cadence_months = 3` for quarterly deep research

Suggested constraints and indexes:

- unique index on `(company_id)` if you want one active schedule per company
- index on `(is_active, next_run_at)`

### 3. `company_research__runs`

Immutable record of each deep research execution. This is the anchor for point-in-time rendering.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `status` text enum: `running | success | partial | error`
- `scheduled_for` timestamp
- `started_at` timestamp
- `completed_at` timestamp
- `prompt_version` text
- `extractor_version` text
- `report_markdown` text
- `extractor_output` text
- `error` text
- `created_at`

Suggested constraints and indexes:

- index on `(company_id, completed_at desc)`
- index on `(status, started_at desc)`

Notes:

- `report_markdown` is the simplest artifact for rendering the exact historical report. The format is:
```
<company>
 ...company_overview_md...
</company>
<team>
 ...team_report_md...
</team>
<marketing>
 ...marketing_report_md...
</marketing>
<financials>
 ...financial_report_md...
</financials>
```
- `extractor_output` is optional extractor output text used for debugging extraction changes over time

### 4. `company_research__company_attributes`

Stores the remaining company-level fields from `important_fields.md`.

One row per `company_id + run_id`.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `common_name` text
- `founding_date` date
- `hq_location` text
- `primary_geographies` json text
- `company_stage` text
- `business_model_type` text
- `company_value_proposition` text
- `industry_tags` json text
- `market_category` text
- `customer_segments_served` json text
- `created_at`

Suggested constraints and indexes:

- unique index on `(company_id, run_id)`
- index on `(company_id, run_id desc)`

Notes:

- `primary_geographies`, `industry_tags`, and `customer_segments_served` should be JSON arrays
- `hq_location` can stay as a single string for now; split into city/country later only if the dashboard needs faceted geographic filtering
- keep repeatable external identities such as official social pages in a separate typed table rather than adding more URL columns or JSON blobs here

### 5. `company_research__company_social_pages`

Stores the company's official external social/profile pages.

One row per `company_id + platform + run_id`.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `platform` text enum: `linkedin | x | instagram | facebook | youtube | tiktok | crunchbase | github | other`
- `page_url` text not null
- `handle` text
- `is_official` boolean not null default true
- `created_at`

Suggested constraints and indexes:

- unique index on `(company_id, platform, run_id)`
- index on `(company_id, platform)`
- optional unique index on `(page_url)` when normalized

Notes:

- this is a better fit than storing social URLs inside `company_attributes`
- social pages are repeatable structured facts, not one opaque company blob
- a separate table makes it easy to add new platforms without schema churn in the main attributes row
- it also keeps per-platform provenance clean, especially when one platform is verified and another is only inferred
- set `is_official = false` for relevant but non-canonical pages such as legacy, regional, product-specific, or not-yet-confirmed accounts
- if you later need multiple pages per platform, relax the unique key to include `page_url`

### 6. `company_research__entities`

Shared identity registry for parties that may appear in financing data and other cross-table joins.

Suggested columns:

- `id` PK
- `entity_type` text enum: `company | person`
- `display_name` text not null
- `created_at`
- `updated_at`

Suggested constraints and indexes:

- index on `entity_type`
- index on `display_name`

Notes:

- this replaces a standalone `investors` table
- `companies.id` and `people.id` should reuse the same primary key value as `entities.id`
- `financing_round_investors.entity_id` should point here so the same investor can be modeled as either a company or a person
- keep subtype-specific fields such as company domains and person website URLs in the subtype tables, not on `entities`

### 7. `company_research__people`

Global people registry. Keep identity separate from role facts.

Suggested columns:

- `id` PK and FK -> `entities.id`
- `full_name` text not null
- `linkedin_url` text
- `website_url` text
- `created_at`
- `updated_at`

Suggested constraints and indexes:

- index on `full_name`
- unique index on `linkedin_url` when present

Why separate this from roles:

- the same person may appear in multiple roles over time
- the same person may be connected to more than one company

### 8. `company_research__company_person_roles`

Stores founders, key executives, board members, and alumni.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `person_id` FK -> `people.id`
- `run_id` FK -> `runs.id`
- `role_type` text enum: `founder | key_executive | board_member | employee | alumni`
- `title` text
- `department` text enum: `board | executive | engineering | product | design | data | research | sales | marketing | partnerships | customer_success | support | operations | finance | legal | people | recruiting | it | security | other | unknown`
- `bio` text
- `is_current` boolean
- `start_date` date
- `end_date` date
- `created_at`

Suggested constraints and indexes:

- index on `(company_id, role_type)`
- index on `(company_id, is_current)`
- index on `(person_id)`
- optional unique index on `(company_id, person_id, role_type, title, run_id)`

Notes:

- `alumni` rows usually have `is_current = false`
- if the same person is both founder and executive, keep two role rows
- use one canonical department taxonomy across both people-role and job-post data
- use `board` for directors, `executive` for company-wide leadership, and `unknown` when the source does not support a reliable mapping

### 9. `company_research__company_relationships`

Stores company-to-company relationships for customers and competitors.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `related_company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `relationship_type` text enum: `customer | competitor`
- `relationship_strength` text
- `created_at`

Suggested constraints and indexes:

- index on `(company_id, relationship_type)`
- index on `(related_company_id)`
- optional unique index on `(company_id, related_company_id, relationship_type, run_id)`

Notes:

- use the same `companies` table for the related entity instead of storing plain strings
- `relationship_strength` can be values such as `direct`, `notable`, or `mentioned`

### 10. `company_research__financing_rounds`

Stores one financing round row per company, round, and research run.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `round_type` text enum: `pre_seed | seed | series_a | series_b | series_c | series_d_plus | venture | growth_equity | debt | grant | secondary | post_ipo_equity | undisclosed | other`
- `round_label` text
- `announced_at` date
- `closed_at` date
- `amount_raised` integer
- `amount_raised_currency` text
- `pre_money_valuation` integer
- `pre_money_valuation_currency` text
- `post_money_valuation` integer
- `post_money_valuation_currency` text
- `total_capital_raised` integer
- `total_capital_raised_currency` text
- `created_at`

Suggested constraints and indexes:

- unique index on `(company_id, round_type, announced_at, run_id)`
- index on `(company_id, announced_at desc)`
- index on `(company_id, round_type)`

Notes:

- `round_label` preserves the human-readable label when the source uses wording such as `Series A extension` or `strategic round`
- store disclosed money values as integers plus explicit currency codes; do not assume USD when the source does not say so
- keep round-level provenance on this row, even when separate investor rows are created

### 11. `company_research__financing_round_investors`

Join table between financing rounds and investor entities.

Suggested columns:

- `id` PK
- `financing_round_id` FK -> `financing_rounds.id`
- `entity_id` FK -> `entities.id`
- `investor_type` text enum: `venture_capital | private_equity | corporate | angel | family_office | government | accelerator | bank | other | unknown`
- `investor_role` text enum: `lead | participant | existing | other`
- `created_at`

Suggested constraints and indexes:

- unique index on `(financing_round_id, entity_id, investor_role)`
- index on `(financing_round_id)`
- index on `(entity_id)`

Notes:

- use one row per investor entity named in a round
- keep `investor_type` on this row so identity and classification can evolve independently
- use `lead` for lead/co-lead investors and `participant` for all other newly named investors unless the source supports a stronger distinction

### 12. `company_research__metrics`

Stores the trendable company metrics requested.

One row per `company_id + metric_year + run_id`.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `metric_year` integer not null
- `annual_revenue` integer USD
- `original_revenue_type` text enum: `arr | mrr | revenue`
- `original_revenue_value` numeric
- `original_revenue_currency` text
- `profit` integer USD
- `original_profit_type` text
- `original_profit_value` numeric
- `original_profit_currency` text
- `headcount_total` integer
- `active_users` integer
- `active_users_type` text enum: `dau | wau | mau | unknown`
- `paying_customers` integer
- `created_at`

Suggested constraints and indexes:

- unique index on `(company_id, metric_year, run_id)`
- index on `(company_id, metric_year desc)`

Notes:

- `annual_revenue` is the normalized annualized revenue in USD used for charts
- `original_revenue_type` records whether the public source disclosed ARR, MRR, or revenue
- `original_revenue_value` preserves the raw disclosed value
- `profit` is the normalized profit in USD used for charts
- `original_profit_type` is recommended because public sources often mean different things by "profit" such as gross profit, EBITDA, operating income, or net income
- `original_profit_value` preserves the raw disclosed value
- `active_users` preserves the disclosed active-user count for that period and is not annualized
- `active_users_type` distinguishes `DAU`, `WAU`, `MAU`, or `unknown` when the source gives a user count without a clear cadence
- when `active_users_type = unknown`, downstream UI can show the count but hide the cadence label
- `paying_customers` preserves a disclosed customer or subscriber count for the same period when the company shares one
- store normalized money fields as integer USD values and avoid floating-point for original disclosed values

### 13. `company_research__job_posts`

Stores open role listings.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `job_title` text not null
- `department` text enum: `board | executive | engineering | product | design | data | research | sales | marketing | partnerships | customer_success | support | operations | finance | legal | people | recruiting | it | security | other | unknown`
- `location` text
- `employment_type` text
- `posted_at` date
- `external_url` text
- `description` text
- `status` text
- `created_at`

Suggested constraints and indexes:

- index on `(company_id, posted_at desc)`
- index on `(company_id, status)`
- unique index on `(company_id, job_title, employment_type, department, location)`

Notes:

- use one row per open role
- `job_title` is the canonical role label for this table
- map raw job board department labels into the closest canonical department value above

### 14. `company_research__notable_events`

Stores notable company news and timeline events.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `event_category` text enum: `hiring | layoff | exec_change | funding | product_launch | partnership | regulatory | acquisition | other`
- `headline` text not null
- `summary` text
- `event_date` date
- `external_url` text
- `source_name` text
- `created_at`

Suggested constraints and indexes:

- index on `(company_id, event_category, event_date desc)`
- optional unique index on `(company_id, event_category, external_url)` when `external_url` is present

Notes:

- use one row per event/article/announcement
- this table is intentionally general and optimized for qualitative timeline/news retrieval, not structured event analytics

### 15. `company_research__products`

Stores product-level structured data.

Suggested columns:

- `id` PK
- `company_id` FK -> `companies.id`
- `run_id` FK -> `runs.id`
- `product_name` text not null
- `product_category` text
- `value_proposition` text
- `target_customer_icp` text
- `is_primary` boolean not null default false
- `created_at`

Suggested constraints and indexes:

- index on `(company_id, is_primary)`
- index on `(company_id, product_name)`
- optional unique index on `(company_id, product_name, run_id)`

Notes:

- use `is_primary = true` for the main product surfaced in overview pages
- additional products can still be stored for multi-product companies

### 16. `company_research__field_provenance`

This is the one generic metadata table that should remain.

It stores metadata for any specific field on any row in the typed domain tables.

Suggested columns:

- `id` PK
- `run_id` FK -> `runs.id`
- `table_name` text not null
- `row_id` text not null
- `field_name` text
- `as_of_date` date
- `citation_url` text
- `confidence` text enum: `high | medium | low`
- `reporting_basis` text enum: `self_reported | independently_verified | third_party_reported | derived_or_estimated | other | unknown`
- `notes` text
- `created_at`

Notes:

- `confidence` is derived from the credibility of the cited source
- `reporting_basis` captures how the value entered the record:
  - `self_reported`: stated by the company, founder, or internal company material
  - `independently_verified`: verified by a credible external party; put the verifier identity in `citation_url` and/or `notes`
  - `third_party_reported`: reported by an external source, but not clearly independently verified
  - `derived_or_estimated`: inferred, modeled, or calculated from other evidence
  - `other`: known provenance that does not fit the standard categories
  - `unknown`: provenance not yet classified

Suggested constraints and indexes:

- index on `(table_name, row_id)`
- index on `(run_id)`
- index on `(table_name, field_name)`
- optional unique index on `(table_name, row_id, field_name, run_id)`

Why this table is needed:

- `company_attributes.common_name` may have a different citation and `as_of_date` than `company_attributes.market_category`
- `metrics.annual_revenue` may come from one source while `metrics.active_users` or `metrics.headcount_total` comes from another
- `products.product_category` and `products.value_proposition` often come from different URLs
- when `field_name` is `null`, the provenance row applies to the entire referenced row rather than one specific field

Without this table, you would need to add `*_citation_url`, `*_as_of_date`, `*_confidence`, and `*_notes` columns for every individual field, which becomes brittle very quickly.

## Temporal Model

Use an append-only model.

Rules:

- never update historical rows in place after a run succeeds
- each extraction run inserts a new `runs` row
- each typed table inserts rows tied to that `run_id`
- each field-level metadata record also points to that `run_id`

This gives two views of the world:

- point-in-time report view: read from `runs.report_markdown`
- current dashboard view: read the latest successful rows per company from the typed tables

## How To Query Current State

Recommended pattern:

- `runs` is the source of truth for run ordering
- for current overview pages, select the latest successful `run_id` per company
- read the matching `company_attributes`, `company_social_pages`, primary `products`, current `company_person_roles`, current `company_relationships`, latest `financing_rounds` plus joined `entities`, latest `metrics`, recent `job_posts`, and recent `notable_events`

You can later add SQL views such as:

- `company_research__latest_company_attributes_v`
- `company_research__latest_company_social_pages_v`
- `company_research__latest_products_v`
- `company_research__latest_people_v`
- `company_research__latest_relationships_v`
- `company_research__latest_financing_rounds_v`
- `company_research__latest_metrics_v`
- `company_research__latest_job_posts_v`
- `company_research__latest_notable_events_v`

## How To Query Trends

Use the typed `metrics` table for trend charts.

Examples:

- valuation-style revenue trend: `annual_revenue` by `metric_year`
- profit trend: `profit` by `metric_year`
- active-user trend: `active_users` by `metric_year`, segmented by `active_users_type` when present
- headcount trend: `headcount_total` by `metric_year`

Use `financing_rounds` plus `financing_round_investors` for financing-history timelines and investor-roster views.

## Recommended Natural Keys

These help dedup repeated extractions from similar runs.

- `company_attributes`: `(company_id, run_id)`
- `company_social_pages`: `(company_id, platform, run_id)`
- `company_person_roles`: `(company_id, person_id, role_type, title, run_id)`
- `company_relationships`: `(company_id, related_company_id, relationship_type, run_id)`
- `companies`: prefer `domain`; otherwise normalized `website_url`
- `people`: prefer `linkedin_url`; otherwise normalized `website_url`
- `financing_rounds`: `(company_id, round_type, announced_at, run_id)`
- `financing_round_investors`: `(financing_round_id, entity_id, investor_role)`
- `metrics`: `(company_id, metric_year, run_id)`
- `job_posts`: use `(company_id, job_title, employment_type, department, location)`
- `notable_events`: prefer `(company_id, event_category, external_url)` when URL exists
- `products`: `(company_id, product_name, run_id)`

## Recommended Implementation Notes

- Use SQLite and Drizzle to match the rest of the Rome app storage pattern.
- Store JSON arrays in `text(..., { mode: "json" })` columns for:
  - `primary_geographies`
  - `industry_tags`
  - `customer_segments_served`
- Use timestamps for `created_at`, `started_at`, `completed_at`, and scheduling fields.
- Use exact numeric storage for money values.
- Normalize URLs before saving them to provenance rows and `company_social_pages.page_url`.

## Summary

The recommended design is:

- `companies`
- `schedules`
- `runs`
- `company_attributes`
- `company_social_pages`
- `entities`
- `people`
- `company_person_roles`
- `company_relationships`
- `financing_rounds`
- `financing_round_investors`
- `metrics`
- `job_posts`
- `notable_events`
- `products`
- `field_provenance`

This is the simplest design that still supports:

- quarterly deep-research refresh
- exact historical report rendering
- typed dashboard queries
- trend charts
- per-field citations and confidence
