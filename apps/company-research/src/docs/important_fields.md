# Important Commonly Available Fields

Selected from `deep_research.md` using two filters:

- important for understanding the company quickly
- commonly available from public sources for many companies

This list intentionally excludes many low-availability fields such as GRR, NRR, churn, activation, exact TAM, burn, runway, and private-company revenue unless specifically disclosed.

## 1. Company Identity and Footprint

1. `common_name`
   Why: The primary lookup key across websites, databases, and press coverage.
2. `founding_date`
   Why: Useful for stage, maturity, and cohort comparisons.
3. `hq_location`
   Why: Usually public and helpful for geography, hiring, and regulatory context.
4. `primary_geographies`
   Why: Shows where the company actually operates, not just where it is incorporated.

## 2. Product and Positioning

5. `primary_product_name`
   Why: Anchors all downstream product, pricing, and comparison research.
6. `product_category`
   Why: One of the fastest ways to classify the company.
7. `value_proposition`
   Why: High-signal summary of what the product does and why customers buy it.
8. `target_customer_icp`
   Why: Critical for understanding GTM motion and market fit.
9. `deployment_or_sales_model`
   Why: Commonly visible from product and pricing pages and very useful commercially.

## 3. Market and Commercial Context

10. `business_model_type`
    Why: Distinguishes SaaS, marketplace, services, fintech infrastructure, and similar models.
11. `industry_tags`
    Why: Makes cross-company filtering and clustering much easier.
12. `market_category`
    Why: Better than a broad industry label for competitive analysis.
13. `customer_segments_served`
    Why: Usually inferable from company materials and highly relevant to GTM.
14. `direct_competitors`
    Why: Important for positioning and often discoverable from comparison pages and analyst coverage.

## 4. Team and Governance

15. `founders`
    Why: Founder identity and background are usually public and highly decision-relevant.
16. `key_executives`
    Why: Executive team quality and shape are commonly available on leadership pages and LinkedIn.
17. `board_members`
    Why: Often public after institutional financing and useful for governance context.
18. `headcount_total`
    Why: One of the best rough signals of company scale when financials are missing.

## 5. Traction and Financing

19. `notable_customer_logos`
    Why: Usually easier to verify than customer counts and strong evidence of commercial traction.
20. `latest_financing_round`
    Why: Among the most available and useful signals for stage, investor support, and momentum.

## Notes

- If you need a first-pass extraction schema, these 20 fields are the best default shortlist.
- If you need a second-pass diligence schema, add harder-to-find fields like customer count, hiring pace, total capital raised, major investors, ARR, retention, and cash metrics.
- For every saved field, also keep:
  - `as_of_date`
  - `source_type`
  - `source_reference`
  - `confidence`
  - `notes`
