---
name: check-technical
description: Run a quick technical SEO health check for a given URL or domain
argument-hint: "<URL or domain>"
allowed-tools: ["WebFetch"]
parameters:
  - name: target
    type: string
    required: true
    description: URL or domain to check
---

# Check Technical Command

A focused **technical SEO health check** covering infrastructure, performance, and crawlability. Complements `/seo:audit-page` which covers content quality + on-page SEO.

## Usage

```
/seo:check-technical https://example.com
/seo:check-technical https://example.com/specific-page
/seo:check-technical example.com
```

**Arguments:**
- URL or domain (required)

## Workflow

1. **Determine Scope** -- Single page vs site-wide check based on input (full URL vs bare domain).
2. **Run Technical SEO Audit** -- Invoke `technical-seo-checker`. Audits all areas: crawlability, HTTPS/security, page speed/Core Web Vitals, mobile responsiveness, URL/redirect health, infrastructure.
3. **Compile Output** -- Format results with weighted overall score and prioritized action list.

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECHNICAL SEO CHECK: [URL or Domain]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OVERALL TECHNICAL SCORE: XX/100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION SCORES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[6 area scores: Crawlability, HTTPS, Page Speed, Mobile, URL Health, Infrastructure]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE WEB VITALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LCP / INP / CLS / TTFB with pass/fail status

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIORITY ACTION LIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL / IMPORTANT / MINOR items with specific fixes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTION CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[ ] [Action items]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTE: For content quality + on-page SEO, run: /seo:audit-page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Tips

- Prioritize Core Web Vitals -- they directly impact rankings
- Use Google PageSpeed Insights and Search Console for data without integrations
- Re-run after infrastructure changes

## Related Skills

- [technical-seo-checker](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/optimize/technical-seo-checker/SKILL.md) -- Comprehensive technical SEO audit
