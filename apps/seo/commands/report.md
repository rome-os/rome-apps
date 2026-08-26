---
name: report
description: Generate a comprehensive SEO and GEO performance report
argument-hint: "<domain> <time period>"
parameters:
  - name: domain
    type: string
    required: true
    description: Domain to report on
  - name: period
    type: string
    required: true
    description: "Time period: last-month, last-quarter, Q[N]-[YYYY], [YYYY-MM-DD] to [YYYY-MM-DD], last-30-days, last-90-days"
  - name: comparison
    type: string
    required: false
    description: "Comparison period: vs previous-quarter, vs last-year, vs previous-period"
  - name: format
    type: string
    required: false
    description: "Output format: detailed (default) or executive (condensed for stakeholders)"
---

# Report Command

A comprehensive **SEO and GEO performance report** that aggregates data across all channels, identifies trends, and delivers actionable recommendations prioritized by impact.

## Usage

```
/seo:report example.com last-month
/seo:report example.com last-quarter vs previous-quarter
/seo:report example.com [YYYY-MM-DD] to [YYYY-MM-DD]
/seo:report example.com last-90-days format=executive
```

**Arguments:**
- Domain (required)
- Time period (required): `last-month`, `last-quarter`, `Q[N]-[YYYY]`, `[YYYY-MM-DD] to [YYYY-MM-DD]`, `last-30-days`, `last-90-days`
- Comparison period (optional): `vs previous-quarter`, `vs last-year`, `vs previous-period`
- `format=executive` (optional): Condensed summary for stakeholders (default: `detailed`)

## Workflow

1. **Generate Performance Report** -- Invoke `performance-reporter` with domain, time period, and comparison period. Collects data across all channels (organic traffic, rankings, backlinks, GEO visibility, technical health), computes period-over-period changes, identifies wins/concerns/opportunities, and produces detailed section analysis.
2. **Include CITE/CORE-EEAT Context** (optional) -- If `domain-authority-auditor` or `content-quality-auditor` have been run previously for this domain, include latest scores for trend tracking.
3. **Compile Output** -- Format results below. For `format=executive`, include only Executive Summary and Prioritized Action Plan.

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEO & GEO PERFORMANCE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DOMAIN: [domain]
PERIOD: [date range]
COMPARISON: [vs period]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PERFORMANCE SNAPSHOT: key metrics with period-over-period changes
KEY WINS / CRITICAL CONCERNS / STRATEGIC RECOMMENDATIONS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DETAILED FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Organic Traffic Performance
2. Keyword Rankings & Visibility
3. Domain Authority (CITE Score)
4. Backlink Profile Health
5. Technical SEO Health
6. GEO Performance
7. Content Performance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIORITIZED ACTION PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

P0 CRITICAL / P1 HIGH / P2 MEDIUM / P3 LOW

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APPENDIX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Data Sources, Methodology, Historical Trends, Competitor Benchmarking

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Tips

- Compare to same period last year to account for seasonality
- Use `format=executive` for stakeholder presentations
- Verify analytics tracking is firing correctly before investigating drops
- Focus on trend analysis over absolute numbers when using manual data

## Related Skills

- [performance-reporter](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/monitor/performance-reporter/SKILL.md) -- Comprehensive performance reporting
- [domain-authority-auditor](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/cross-cutting/domain-authority-auditor/SKILL.md) -- CITE domain authority scoring
- [content-quality-auditor](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/cross-cutting/content-quality-auditor/SKILL.md) -- CORE-EEAT content quality scoring
