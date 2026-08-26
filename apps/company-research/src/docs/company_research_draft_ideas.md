A good way to think about this is: **you are not extracting “facts about a company.” You are extracting a machine-readable model of the investment case.** For early startups, that model is mostly about **founder, market, velocity, and evidence of product pull**. For bigger companies, it shifts toward **repeatability, unit economics, governance, risk controls, and predictability**. That matches how venture/legal diligence materials and later-stage disclosure frameworks are organized: startup checklists emphasize business plan, team, product, market, IP, competition, risks, cap table, and financials, while public-company style analysis emphasizes liquidity, capital resources, results of operations, KPIs, and known trends or uncertainties. 

My suggestion is to extract data into **12 buckets** for every company, then change the weight by stage.

## 1. Company identity

This is the base layer.

Extract:

* legal entity names
* HQ / main geographies
* founding date
* ownership structure and subsidiaries
* business model type: SaaS, marketplace, fintech, biotech, services, hardware, etc.
* industry / subcategory tags
* current stage: pre-seed, seed, A, growth, pre-IPO, public
* fiscal year and reporting currency

Why it matters:
This lets you compare apples to apples and avoid mixing the operating company with holding entities or side businesses.

## 2. Problem, product, and value proposition

For smaller startups, this is one of the highest-signal buckets.

Extract:

* problem statement
* target customer / ICP
* product modules / SKUs
* core use case
* wedge product
* pricing model: seat, usage, subscription, transaction take rate, services
* deployment model: self-serve, sales-led, enterprise, channel
* product maturity: MVP, beta, GA
* evidence of value: ROI claims, time saved, cost reduced, conversion lift, etc.

Useful fields:

* “what job is being done?”
* “why now?”
* “why this team?”
* “why this product instead of incumbent workflow?”

For very early companies, a crisp product-value narrative is often more important than polished financials. Wilson Sonsini’s investor-readiness framework explicitly starts with mission/problem-solution, management team, viable products with clear value proposition, market opportunity, IP, competition, risks, and financial projections. 

## 3. Market and category structure

You want the market in a form you can test, not just TAM slides.

Extract:

* customer segments
* market size assumptions by segment
* average contract value / ticket size by segment
* buyer persona and budget owner
* replacement behavior: rip-and-replace, new budget, discretionary, compliance-driven
* competitor set: direct, adjacent, incumbent, in-house
* category maturity: emerging, fragmented, consolidating, mature
* regulatory or platform dependencies
* market timing catalysts

For early stage, emphasize:

* category creation vs category entry
* unmet need intensity
* founder-market fit
* speed of adoption

For larger companies, emphasize:

* market share
* penetration of core segment
* expansion adjacencies
* international whitespace
* pricing power

## 4. Team, org, and governance

Early on, this is a huge part of the bet. Later, it becomes about execution quality and controls.

Extract:

* founders, execs, and key operators
* prior wins / relevant domain depth
* org chart
* headcount by function
* hiring pace
* attrition of key leaders
* board composition
* observer rights
* founder ownership and vesting
* key-man dependency
* succession risk

For tiny startups:

* founder speed
* technical depth
* recruiting magnetism
* decision quality
* ability to learn quickly

For bigger companies:

* management bench
* functional ownership clarity
* CFO / finance maturity
* board independence
* governance quality

## 5. Customer base and distribution

This is where “story” starts turning into “evidence.”

Extract:

* number of customers
* customer logos
* customer concentration
* segment mix: SMB / mid-market / enterprise / public sector
* geography mix
* new vs expansion revenue
* distribution channels
* sales motion: founder-led, AEs, partnerships, marketplaces
* sales cycle length
* pipeline coverage
* win rate / loss rate
* partner dependency

For early companies:

* design partners
* pilots
* referenceability
* usage depth inside a few accounts
* founder-led sales effectiveness

For bigger companies:

* cohort quality
* segment expansion
* enterprise concentration risk
* renewal motion
* channel conflict

## 6. Product usage and retention

For software especially, this is often more real than bookings.

Extract:

* active users / active accounts
* activation rate
* time to first value
* frequency of use
* feature adoption by cohort
* stickiest workflows
* seat expansion / usage expansion
* churn reasons
* logo retention
* gross retention
* net revenue retention
* reactivation

Bessemer explicitly treats ARR as the main scaling metric for cloud companies and highlights gross retention, net retention, and a product-specific North Star metric as critical signals of product value and scale. It also notes typical long-run cloud benchmarks such as roughly 65–70% gross margins and strong net retention around 120% on average at larger scale. ([Bessemer Venture Partners][1])

That implies a stage lens:

* **Pre-seed/seed:** activation, engagement, reference calls, product love
* **Series A/B:** retention, expansion, ICP fit, repeatability
* **Growth:** segment-level NRR, churn decomposition, multi-product attach, margin durability

## 7. Financials and quality of revenue

This bucket matters at every stage, but what counts changes.

Extract:

* revenue by month/quarter
* recurring vs non-recurring revenue
* ARR / MRR where relevant
* bookings / billings
* deferred revenue
* gross profit and gross margin
* contribution margin
* EBITDA / operating income
* free cash flow
* burn and runway
* revenue concentration
* seasonality
* one-time items
* services mix vs software mix

For small startups:

* cash in bank
* monthly burn
* runway
* revenue proof points
* whether reported revenue is actually recurring
* whether services revenue is masking weak product pull

For bigger companies:

* revenue recognition quality
* margin durability
* cash conversion
* capex needs
* working capital behavior
* segment reporting
* forecast accuracy

For public or near-public companies, SEC MD&A is a useful template: focus on **liquidity, capital resources, results of operations, unusual items, KPIs, and known trends or uncertainties** that could affect future performance. ([SEC][2])

## 8. Unit economics and efficiency

This becomes much more important once go-to-market is repeatable.

Extract:

* CAC
* CAC payback
* LTV
* LTV/CAC
* gross margin-adjusted payback
* sales efficiency / magic number
* burn multiple
* revenue per employee
* gross profit per employee
* R&D, S&M, G&A as % of revenue

For early stage, I would track these but not over-trust them unless the motion is already repeatable. For growth-stage software, they become central because the question is no longer “can this sell?” but “can this scale efficiently?” Bessemer’s cloud benchmarks specifically frame ARR growth, retention, margins, and operating-efficiency ratios as the backbone of scaling analysis. ([Bessemer Venture Partners][1])

## 9. Capitalization, financing, and shareholder structure

This is often under-extracted and can completely change the outcome.

Extract:

* cap table
* common / preferred / option pool / warrants
* SAFEs / notes / conversion caps
* liquidation preferences
* participation rights
* pro rata rights
* anti-dilution terms
* dividend rights
* debt facilities and covenants
* founder vesting
* employee option strike prices
* secondary sales
* major investor roster
* post-money history by round

This is not just legal housekeeping. It affects incentives, downside outcomes, and who controls future financing.

Cooley GO provides sample cap tables and a sample VC due-diligence request list, and Y Combinator’s Series A diligence checklist is explicitly framed around the information a company should have ready once a term sheet is signed. ([Cooley GO][3])

## 10. Legal, IP, and compliance

This matters earlier than many investors think.

Extract:

* incorporation and charter docs
* board and stockholder approvals
* stock ledger
* IP assignments from founders/employees/contractors
* patents / trademarks / open-source exposure
* material contracts
* customer and vendor terms
* litigation / threatened claims
* privacy / security posture
* regulatory licenses
* employment classification issues
* sanctions / export controls if relevant

Early-stage emphasis:

* is the IP actually owned by the company?
* were equity issuances properly approved?
* are contractors a hidden risk?
* is there one giant customer contract with strange terms?

Later-stage emphasis:

* privacy/security program maturity
* audit and internal controls
* regulatory exams
* cross-border compliance
* litigation reserve exposure

## 11. Risks, dependencies, and failure modes

This is where you extract the “what can break?” fields.

Extract:

* single points of failure
* customer concentration
* cloud / platform dependency
* founder dependency
* regulatory dependency
* supply chain dependency
* pricing pressure
* adverse selection risk
* fraud / credit / chargeback risk
* model risk for AI companies
* data rights / training-data exposure
* geopolitical risk
* reputational risk

This bucket is stage-sensitive:

* tiny startup: founder, product, and financing risk
* scaling startup: GTM, retention, and hiring risk
* larger company: governance, compliance, concentration, and execution risk

## 12. Catalysts, milestones, and valuation context

This is the investor-facing synthesis layer.

Extract:

* next 3–5 milestones
* hiring gaps that unlock growth
* product launches
* renewals / expansions
* financing need timing
* regulatory decisions
* margin inflection points
* exit paths
* public comps / private comps
* last round valuation and terms
* valuation method used: ARR multiple, EBITDA multiple, DCF, SOTP, etc.

For very early stage:

* milestone = “de-risk the thesis”

For later stage:

* milestone = “improve predictability and multiple”

---

# How the emphasis changes by company size

## Pre-seed / very small startup

Most important:

* founder quality
* speed of execution
* problem clarity
* product wedge
* user love
* market timing
* cap table cleanliness
* burn/runway

Less important:

* polished dashboards
* mature CAC math
* formal budgeting sophistication

Main question:
**Is there enough evidence that this team can discover and capture a real market?**

## Seed / Series A

Most important:

* ICP clarity
* early repeatability
* retention/cohort quality
* pipeline formation
* initial GTM motion
* org buildout
* legal hygiene
* financing overhang

Main question:
**Is this moving from “interesting product” to “repeatable company”?**

## Series B / growth

Most important:

* segment-level ARR growth
* NRR / GRR
* CAC efficiency
* burn multiple
* forecastability
* management depth
* security/compliance readiness
* concentration and renewal risk

Main question:
**Can this compound efficiently, or is growth being bought expensively?**

## Late-stage / pre-IPO / larger private company

Most important:

* accounting quality
* margin durability
* liquidity and capital resources
* internal controls
* governance
* KPIs by segment
* known trends / uncertainties
* litigation / regulatory exposure
* dilution and stock-based comp

Main question:
**Is this a scalable, governable, predictable institution rather than just a fast-growing asset?**

---

# A practical extraction schema

If you want this to be structured, I would literally build these tables:

1. `company_profile`
2. `products`
3. `market_segments`
4. `management_and_board`
5. `customers_and_pipeline`
6. `usage_and_retention`
7. `financials_periodic`
8. `unit_economics`
9. `capitalization_and_securities`
10. `legal_and_compliance`
11. `risks_and_dependencies`
12. `milestones_and_valuation`

Each field should ideally have:

* value
* date as-of
* source
* confidence
* notes / caveats

That last part matters because startup data is often messy, stale, or defined inconsistently.

---

# Sector-specific extensions

The universal schema is not enough for every company.

For SaaS / AI software:

* ARR, NRR, GRR, payback, burn multiple, usage intensity, model cost per workload, gross margin by product

For marketplaces:

* GMV, take rate, supply density, repeat rate, liquidity by geography, cohort maturity, fraud/loss rates

For fintech:

* approval rates, default/loss rates, fraud, interchange/take rate, capital requirements, regulatory licenses, bank/platform dependency

For biotech / deep tech:

* IP estate, clinical/regulatory milestones, trial design, technical validation, manufacturing readiness, cash runway to next inflection

For hardware:

* BOM, gross margin by generation, supply chain concentration, warranty/returns, manufacturing yield, working capital intensity

---

# The meta-fields investors often forget

These are high value:

* **data quality score**
* **definition of each metric**
* **source freshness**
* **the reporting basis for the metric** (`self_reported`, `independently_verified`, `third_party_reported`, `system_observed`, `derived_or_estimated`, `other`, `unknown`)
* **what changed since last round**
* **top 5 unresolved diligence questions**

That turns your research from “notes” into an actual investment decision system.

The cleanest heuristic is:

* **small startup:** extract data that helps judge *possibility*
* **mid-stage company:** extract data that helps judge *repeatability*
* **larger company:** extract data that helps judge *predictability and control*

If you want, I can turn this into a **due diligence template / spreadsheet schema** you can use company by company.

[1]: https://www.bvp.com/atlas/scaling-to-100-million "Scaling to $100 Million - Bessemer Venture Partners"
[2]: https://www.sec.gov/rules-regulations/2003/12/commission-guidance-regarding-managements-discussion-analysis-financial-condition-results-operations?utm_source=chatgpt.com "Commission Guidance Regarding Management's ..."
[3]: https://www.cooleygo.com/documents/ "Generate and Download Legal Documents | Cooley GO"
