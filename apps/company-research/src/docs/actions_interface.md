# Company Research Actions Interface

This document describes the public action interface for the `company-research` app.

The actions are designed around the schema in [db_design.md](./db_design.md).

## General Rules

- All action input fields use `snake_case`.
- All action results use the standard Rome action envelope:

```json
{
  "success": true,
  "data": {}
}
```

- Table `2` (`company_research__schedules`) is managed programmatically and has no action interface.
- `field_name` in provenance is optional. When it is omitted or `null`, the provenance row applies to the whole row.
- For write actions, `company_id` and `run_id` are optional when they already exist in action `sharedContext` as `company_id` / `companyId` and `run_id` / `runId`. It is recommended not to provide them explicitly in that case.

## Table Aliases Used by Read APIs

The read layer uses the following logical table names:

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

When `table_name` is used in provenance reads, it may be either:

- one of the aliases above, such as `products`
- or a physical table name such as `company_research__products`

## Shared Provenance Shape for Write Actions

All write actions accept optional `provenance` and `provenance_run_id` fields.

```json
{
  "provenance_run_id": "run-1",
  "provenance": [
    {
      "field_name": "product_name",
      "citation_url": "https://example.com/product",
      "confidence": "high"
    },
    {
      "field_name": null,
      "reporting_basis": "third_party_reported",
      "notes": "row-level provenance"
    }
  ]
}
```

Each provenance object supports:

- `id`
- `run_id`
- `field_name`
- `as_of_date`
- `citation_url`
- `confidence`: `high | medium | low`
- `reporting_basis`: `self_reported | independently_verified | third_party_reported | derived_or_estimated | other | unknown`
- `notes`

## Orchestration Action

### `company_research_run_company_research`

Ensures the target company exists in table `1`, ensures a quarterly schedule exists in table `2`, creates a `running` row in table `3`, runs the four deep-research ChatGPT queries, normalizes the combined markdown into `result_markdown`, asks an agent to populate tables `4`-`15` with the predefined `company_research_add_*` actions, then updates tables `2` and `3` programmatically.

#### Input

```json
{
  "canonical_name": "Acme Robotics",
  "company_domain": "acme.example"
}
```

#### Output Notes

- Returns the ensured `company`, the final `schedule`, the updated `run`, plus `tmp_result_markdown`, `result_markdown`, and the extractor agent summary.
- The extractor agent receives `company_id` / `companyId` and `run_id` / `runId` via action `sharedContext`.

## Write Actions

All `company_research_add_*` actions return only `{ "success": true }` on success. The inserted or upserted row details are available through the typed read actions and are also written into the LLM context during extraction.

### `company_research_add_company_attributes`

Inserts one row into table `4` (`company_attributes`).

#### Input

```json
{
  "common_name": "Acme",
  "hq_location": "San Francisco, CA",
  "industry_tags": ["robotics", "logistics"]
}
```

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `common_name`
- `founding_date`
- `hq_location`
- `primary_geographies`
- `company_stage`
- `business_model_type`
- `company_value_proposition`
- `industry_tags`
- `market_category`
- `customer_segments_served`
- `created_at`
- `provenance_run_id`
- `provenance`

### `company_research_add_company_social_page`

Inserts one row into table `5` (`company_social_pages`).

Required fields:

- `page_url`

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `platform`
- `page_url`
- `handle`
- `is_official`
- `created_at`
- `provenance_run_id`
- `provenance`

### `company_research_add_person_role`

Upserts a person using `linkedin_url` or `website_url` when available, otherwise creates a new person row from `person_name`, then inserts one row into table `7` (`company_person_roles`).

`website_url` should only be the person's own profile page, personal website, or blog. Do not use a general team page or any page that includes multiple people. If no personal website or profile page is found, leave `website_url` empty.

If `linkedin_url` or `website_url` already matches an existing person but `person_name` does not match that stored person, the action returns an error instead of reusing the row.

Required fields:

- `person_name`

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `person_name`
- `linkedin_url`
- `website_url`
- `role_type`
- `title`
- `department`
- `bio`
- `is_current`
- `start_date`
- `end_date`
- `created_at`
- `provenance_run_id`
- `provenance`

#### Output Notes

On success the action returns only `{ "success": true }`. Read the typed tables separately if you need row details.

### `company_research_add_company_relationship`

Upserts the related company using normalized domain identity when available, otherwise creates a company row from the provided name/URL fallback, then inserts one row into table `8` (`company_relationships`).

Required fields:

- none

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `related_company_name` or `company_name`
- `related_company_domain` or `domain`
- `related_company_website_url` or `website_url`
- `relationship_type`
- `relationship_strength`
- `created_at`
- `provenance_run_id`
- `provenance`

#### Output Notes

On success the action returns only `{ "success": true }`. Read the typed tables separately if you need row details.

### `company_research_add_financing_round`

Upserts investor entities through tables `6` (`entities`) plus the matching subtype table (`companies` or `people`), inserts one row into table `10` (`financing_rounds`), and inserts related join rows into table `11` (`financing_round_investors`).

Required fields:

- none

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `round_type`
- `round_label`
- `announced_at`
- `closed_at`
- `amount_raised`
- `amount_raised_currency`
- `pre_money_valuation`
- `pre_money_valuation_currency`
- `post_money_valuation`
- `post_money_valuation_currency`
- `total_capital_raised`
- `total_capital_raised_currency`
- `investors`
- `created_at`
- `provenance_run_id`
- `provenance`

Each `investors[]` item supports:

- `round_investor_id`
- `investor_name`
- `entity_type`
- `domain`
- `website_url`
- `linkedin_url`
- `investor_type`
- `investor_role`
- `created_at`
- `updated_at`

#### Output Notes

On success the action returns only `{ "success": true }`. Read the typed tables separately if you need row details.

### `company_research_add_metrics`

Inserts one row into table `12` (`metrics`).

Required fields:

- `metric_year`

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `metric_year`
- `annual_revenue`
- `original_revenue_type`
- `original_revenue_value`
- `original_revenue_currency`
- `profit`
- `original_profit_type`
- `original_profit_value`
- `original_profit_currency`
- `headcount_total`
- `active_users`
- `active_users_type`
- `paying_customers`
- `created_at`
- `provenance_run_id`
- `provenance`

### `company_research_add_job_post`

Inserts one row into table `13` (`job_posts`).

Required fields:

- `job_title`

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `job_title`
- `department`
- `location`
- `employment_type`
- `posted_at`
- `external_url`
- `description`
- `status`
- `created_at`
- `provenance_run_id`
- `provenance`

### `company_research_add_notable_event`

Inserts one row into table `14` (`notable_events`).

Required fields:

- `headline`

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `event_category`
- `headline`
- `summary`
- `event_date`
- `external_url`
- `source_name`
- `created_at`
- `provenance_run_id`
- `provenance`

### `company_research_add_product`

Inserts one row into table `15` (`products`).

Required fields:

- `product_name`

Supported row fields:

- `id`
- `company_id`
- `run_id`
- `product_name`
- `product_category`
- `value_proposition`
- `target_customer_icp`
- `is_primary`
- `created_at`
- `provenance_run_id`
- `provenance`

## Read Actions

### `company_research_read_rows`

Reads rows from tables `4-15` plus the shared `entities` lookup table and financing-round join table.

#### Input

```json
{
  "table": "products",
  "filters": {
    "company_id": "company-1",
    "is_primary": true
  },
  "include_provenance": true,
  "limit": 50
}
```

#### Supported Filter Style

Common filters:

- `id`
- `ids`
- `company_id`
- `run_id`

Table-specific filters:

- `company_social_pages`: `platform`, `handle`, `is_official`
- `people`: `full_name`, `linkedin_url`, `website_url`
- `company_person_roles`: `person_id`, `role_type`, `department`, `is_current`, `title`
- `company_relationships`: `related_company_id`, `relationship_type`, `relationship_strength`
- `entities`: `display_name`, `entity_type`, `domain`, `website_url`, `linkedin_url`
- `financing_rounds`: `round_type`, `round_label`, `announced_at_from`, `announced_at_to`
- `financing_round_investors`: `financing_round_id`, `entity_id`, `investor_id`, `investor_type`, `investor_role`
- `metrics`: `metric_year`
- `job_posts`: `department`, `status`, `employment_type`, `job_title`, `posted_at_from`, `posted_at_to`
- `notable_events`: `event_category`, `headline`, `source_name`, `event_date_from`, `event_date_to`
- `products`: `product_name`, `product_category`, `is_primary`

### `company_research_search_companies`

Searches table `1` (`company_research__companies`).

Supported fields:

- `id`
- `ids`
- `query`
- `domain`
- `website_url`
- `limit`

### `company_research_read_runs`

Reads table `3` (`company_research__runs`) using optional filters.

Supported fields:

- `id`
- `ids`
- `company_id`
- `status`
- `prompt_version`
- `extractor_version`
- `scheduled_for_from`
- `scheduled_for_to`
- `started_at_from`
- `started_at_to`
- `completed_at_from`
- `completed_at_to`
- `limit`

### `company_research_read_provenance`

Reads table `16` (`company_research__field_provenance`) using optional filters.

Supported fields:

- `id`
- `ids`
- `run_id`
- `table_name`
- `row_id`
- `field_name`
- `field_name_is_null`
- `citation_url`
- `confidence`
- `reporting_basis`
- `as_of_date_from`
- `as_of_date_to`
- `limit`
