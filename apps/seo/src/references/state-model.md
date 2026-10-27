# State Model

Plan C standardizes where reusable project state belongs. All state follows a three-tier temperature model with automatic lifecycle management.

## Temperature Tiers

### HOT — `memory/hot-cache.md`

- Capacity: 80 lines max
- Loaded automatically by SessionStart hook every session
- Content: project goals, hero keywords (max 10), primary competitors (max 5), active veto items, unresolved open loops from `memory/open-loops.md`
- Promotion trigger: finding referenced by 2 or more skills, or mentioned in 2 or more consecutive sessions
- Demotion trigger: 30 days unreferenced — move entry out of hot-cache.md, content remains in its WARM file

### WARM — `memory/<category>/<skill>/`

- Capacity: 200 lines per file
- Loaded on demand when a skill matches the topic
- Paths follow the Durable State definitions below
- Promotion trigger: referenced 3 or more times within 7 days — extract core conclusion (max 3 lines) to HOT
- Demotion trigger: 90 days unreferenced — move file to `memory/archive/` with date prefix `YYYY-MM-DD-`

### COLD — `memory/archive/`

- No capacity limit
- Queried only when `memory-management` is explicitly invoked
- Never auto-deleted, only archived
- Filename format: `YYYY-MM-DD-original-filename.md`

### Lifecycle Rules

```
2+ skill references within 7 days     → WARM promotes to HOT (extract ≤3 lines)
3+ references within 7 days            → WARM promotes to HOT
30 days unreferenced                   → HOT demotes to WARM
90 days unreferenced                   → WARM demotes to COLD
```

## Durable State

### `memory/decisions.md`

Store:

- major strategic choices
- accepted tradeoffs
- abandoned directions worth remembering

### `memory/open-loops.md`

Store:

- unresolved blockers
- missing evidence
- follow-up tasks
- risks that should not be forgotten

### `memory/glossary.md`

Store:

- project terminology
- internal acronyms
- shorthand labels
- segment definitions
- historical naming context

### `memory/entities/`

Store:

- canonical names
- sameAs and profile links
- entity type
- topic associations
- disambiguation notes
- knowledge-base status

Only `entity-optimizer` should write canonical records here. Other skills should keep raw entity leads in their own category notes until canonicalization is needed.

### `memory/research/`

Common subfolders:

- `keywords/`
- `competitors/`
- `serp/`
- `content-gaps/`

Store:

- keyword opportunities
- competitor findings
- SERP notes
- content gap summaries

### `memory/content/`

Common subfolders:

- `briefs/`
- `calendar/`
- `published/`

Store:

- content briefs
- approved angles
- meta tag decisions
- schema notes
- refresh plans

### `memory/audits/`

Common subfolders:

- `content/`
- `domain/`
- `technical/`
- `internal-linking/`

Store:

- audit summaries
- veto items
- prioritized fixes
- pass/fail gate decisions

### `memory/monitoring/`

Common subfolders:

- `rank-history/`
- `reports/`
- `alerts/`
- `snapshots/`

Store:

- ranking deltas
- alert history
- backlink changes
- stakeholder reporting summaries
- dated supporting CSV or export files when helpful

## Writing Guidance

When a skill describes state updates, it should:

- prefer summaries over raw dumps
- distinguish facts from assumptions
- note missing data explicitly
- avoid inventing data when tools are unavailable
- keep raw exports beside the dated summary they support

## Ownership

- `memory-management` is the sole executor of WARM → COLD archival operations
- `entity-optimizer` is the sole writer of canonical records in `memory/entities/<name>.md`
- Other skills write entity candidates to `memory/entities/candidates.md` only
- `content-quality-auditor` owns publish-readiness state in `memory/audits/content/`
- `domain-authority-auditor` owns citation-trust state in `memory/audits/domain/`

See [skill-contract.md](https://github.com/aaron-he-zhu/seo-geo-claude-skills/blob/main/references/skill-contract.md) for the full protocol-layer vs execution-layer behavior matrix.
