---
name: keyword-research
description: Research and analyze keywords for a topic or niche
argument-hint: "<seed keyword or topic>"
parameters:
  - name: seed
    type: string
    required: true
    description: Seed keyword or topic
  - name: audience
    type: string
    required: false
    description: Target audience
  - name: goal
    type: string
    required: false
    description: "Business goal: traffic, leads, sales, awareness"
  - name: authority
    type: string
    required: false
    description: "Site authority level: low, medium, high"
  - name: competitors
    type: string
    required: false
    description: Competitor domains (comma-separated) for keyword gap analysis
---

# Keyword Research Command

Discovers high-value keywords from a seed topic, classifies intent, scores difficulty, and delivers a prioritized keyword strategy. Optionally includes competitive gap analysis.

## Usage

```
/seo:keyword-research "project management software"
/seo:keyword-research "vegan meal prep" audience="busy professionals"
/seo:keyword-research "cloud hosting" competitors="digitalocean.com,vultr.com"
/seo:keyword-research "email marketing" goal="leads" authority="low"
```

**Arguments:**
- Seed keyword or topic (required)
- `audience="target audience"` (optional)
- `goal="business goal"` (optional): traffic, leads, sales, awareness
- `authority="site authority"` (optional): low, medium, high (influences difficulty filtering)
- `competitors="domain1,domain2"` (optional): triggers competitor keyword gap analysis

## Workflow

1. **Run Keyword Research** -- Invoke `keyword-research` skill with all arguments. Generates seed keywords, expands to long-tail, classifies intent, scores difficulty, calculates opportunity score, identifies GEO opportunities, and maps topic clusters.
2. **Run Competitor Analysis** (if `competitors=` provided) -- Invoke `competitor-analysis` for keyword gap analysis. Identify keywords competitors rank for that user does not, find content gaps, and merge into the main report.
3. **Compile Keyword Strategy Report** -- Assemble findings into the format below.

## Output Format

```markdown
# Keyword Research Report: [Topic]

**Seed**: [keyword] | **Audience**: [audience] | **Goal**: [goal]

## Executive Summary
- Total keywords, high-priority opportunities, estimated traffic potential

## Top Keyword Opportunities

### Quick Wins (Low difficulty, High value)
| Keyword | Volume | Difficulty | Intent | Score |

### Growth Keywords (Medium difficulty, High volume)
| Keyword | Volume | Difficulty | Intent | Score |

### GEO Opportunities (AI-citation potential)
| Keyword | Query Type | AI Potential | Recommended Format |

## Topic Clusters
**Pillar**: [keyword] + cluster keywords with volume/difficulty

## Competitive Keyword Gaps
_(when competitors= provided)_
| Keyword | Competitor | Their Position | Opportunity |

## Content Calendar Recommendations
| Priority | Content Title | Target Keyword | Type | Est. Effort |

## Next Steps
1-3 action items
```

## Tips

- Include site authority level -- this filters out keywords too competitive for newer sites
- Providing competitor domains unlocks the most actionable insights (keyword gaps)
- Pair with `/seo:write-content` to immediately create content for top opportunities
- Re-run quarterly -- keyword dynamics shift as markets evolve

## Related Skills

- [keyword-research](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/research/keyword-research/SKILL.md) -- Keyword discovery and analysis
- [competitor-analysis](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/research/competitor-analysis/SKILL.md) -- Competitive analysis
- [content-gap-analysis](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/research/content-gap-analysis/SKILL.md) -- Find missing content opportunities
- [seo-content-writer](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/build/seo-content-writer/SKILL.md) -- Write content for target keywords
