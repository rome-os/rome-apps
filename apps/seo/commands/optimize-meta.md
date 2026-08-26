---
name: optimize-meta
description: Optimize title tags, meta descriptions, and Open Graph tags for a page
argument-hint: "<URL or page details>"
parameters:
  - name: source
    type: string
    required: true
    description: URL or page details to optimize
  - name: keyword
    type: string
    required: false
    description: Target keyword
  - name: mode
    type: string
    required: false
    description: "Set to 'a/b-test' to generate multiple variants for testing"
---

# Optimize Meta Command

Analyzes and enhances **title tags, meta descriptions, and social media tags** to maximize click-through rates and search visibility.

## Usage

```
/seo:optimize-meta https://example.com/landing-page
/seo:optimize-meta title="Current Title" keyword="target keyword"
/seo:optimize-meta https://example.com/blog-post target="best practices"
/seo:optimize-meta url="..." mode="a/b-test"
```

**Arguments:**
- URL or page details (required)
- `keyword="target keyword"` (optional but recommended)
- `target="focus topic"` (alternative to keyword)
- `mode="a/b-test"` (generates multiple variants for testing)

## Workflow

1. **Analyze Current Meta Tags** -- Invoke `meta-tags-optimizer` with URL/details and target keyword. Evaluates title tag, meta description, and Open Graph/Twitter Card tags for length, keyword placement, CTR appeal, and completeness.
2. **Generate Optimized Variants** -- Produce 3-5 title tag variants and 3-5 meta description variants with scoring. Optionally invoke `seo-content-writer` title formula methodology for additional CTR-optimized variants.
3. **Compile Output** -- Format results with before/after comparison, implementation code, and A/B test recommendations (if mode="a/b-test").

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
META TAG OPTIMIZATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PAGE: [URL or Title]
TARGET KEYWORD: [keyword]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT META TAGS ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TITLE TAG: X/10 -- current value, length, issues
META DESCRIPTION: X/10 -- current value, length, issues
SOCIAL TAGS: X/10 -- OG/Twitter status

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTIMIZED TITLE TAG VARIANTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RECOMMENDED + 2-3 variants with length, score, rationale

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTIMIZED META DESCRIPTION VARIANTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RECOMMENDED + 1-2 variants with length, score

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPLEMENTATION CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Copy-paste HTML: title, meta description, OG tags, Twitter Card tags]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A/B TEST RECOMMENDATIONS (when mode="a/b-test")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Test setup, control vs variant, hypothesis]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Tips

- Front-load primary keyword in the first half of the title tag
- Include one clear call-to-action in every meta description
- Add year to title tags for recurring topics (+3-8% CTR)
- Test title variants for at least 4 weeks before declaring a winner

## Related Skills

- [meta-tags-optimizer](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/build/meta-tags-optimizer/SKILL.md) -- Full meta tag optimization workflow
- [seo-content-writer](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/build/seo-content-writer/SKILL.md) -- SEO-optimized content creation
