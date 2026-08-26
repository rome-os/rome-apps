# Removal and Iteration Plan Template

## Priority Levels
- **P0**: Immediate removal needed (security risk, significant cost, blocking other work)
- **P1**: Remove in current sprint
- **P2**: Backlog / next iteration

## Safe to Remove Now

| Field | Details |
|-------|---------|
| **Location** | `path/to/file.ts:line` |
| **Rationale** | Why this should be removed |
| **Evidence** | Unused (no references), dead feature flag, deprecated API |
| **Impact** | None / Low — no active consumers |
| **Deletion steps** | 1. Remove code 2. Remove tests 3. Remove config |
| **Verification** | Run tests, check no runtime errors, monitor logs |

## Defer Removal (Plan Required)

| Field | Details |
|-------|---------|
| **Location** | `path/to/file.ts:line` |
| **Why defer** | Active consumers, needs migration, stakeholder sign-off |
| **Preconditions** | Feature flag off for 2 weeks, telemetry shows 0 usage |
| **Migration plan** | Steps for consumers to migrate |
| **Timeline** | Target date or sprint |
| **Rollback plan** | How to restore if issues found |

## Checklist Before Removal
- [ ] Searched codebase for all references
- [ ] Checked for dynamic/reflection-based usage
- [ ] Verified no external consumers (APIs, SDKs, docs)
- [ ] Tests updated/removed
- [ ] Documentation updated
- [ ] Team notified (if shared code)
