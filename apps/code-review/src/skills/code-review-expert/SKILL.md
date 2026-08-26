---
name: code-review-expert
description: Senior engineer code review workflow — whole-picture understanding, mandatory beyond-the-diff verification, architecture-level review (SSOT, Occam's razor), SOLID, security, performance, and code quality, with P0-P3 severity classification.
tools: [Read, Glob, Grep, Bash]
---

# Code Review Expert

Senior engineer code review skill — delivers structured reviews covering architecture, SOLID principles, security, performance, error handling, and code quality.

This skill is the **single source of truth for the review workflow**. The `code-review-expert` agent's system prompt intentionally defers to it.

## Workflow

Follow these steps sequentially for every review:

### Step 1: Scope Changes via Git Diff
- Identify all modified, added, and deleted files
- Understand the intent of the changes from PR title/description
- Map out which components/modules are affected

### Step 2: Understand the Whole Picture and the Architecture
Build global context BEFORE judging any line of code:

1. **Project context**: browse the local clone (README, docs, directory layout,
   entry points, build config) to understand what the project does, its module
   boundaries, and its layering.
2. **Read the diff end-to-end**, then trace relationships FROM the diff:
   who calls the changed code, what the changed code calls, which data flows
   through it. Reconstruct the call chain around every changed public symbol.
3. **State the goal**: summarize in one or two sentences what this change is
   trying to achieve and how it intends to achieve it. Every later finding is
   judged against this goal.

#### Mandatory Verification (before forming any verdict)
For EVERY non-trivial changed file:
1. Read the FULL file — not just the diff hunks. Use the local clone when it
   is checked out at the PR head; if the clone is unavailable or is not at
   the PR head, fetch post-change file content via the `get-pr-diff` skill's
   full-file strategy (`contents?ref=<head SHA>`).
2. Grep for all call sites of every changed/added/removed public symbol;
   read the enclosing function of each call site.
3. For changed types/interfaces/schemas: locate every usage and confirm
   it still holds with the new shape.
4. For changed behavior: find the tests covering it; if none exist, say so.

A diff-only review is invalid. You may not assert correctness of code you
did not open.

**Large-PR escape hatch:** for very large PRs (hundreds of files, or a diff
beyond GitHub's limit), apply full verification to the prioritized subset of
files per the `get-pr-diff` skill's large-PR guidance, and explicitly state
in the review summary which files were NOT fully verified.

### Step 3: Architecture-Level Review
Refer to `references/architecture-review.md` for the detailed checklist.

1. **Direction**: is the change architecturally correct? Is there a better
   approach — where "better" means globally optimal for the codebase, not
   locally clean within the diff? If a materially better design exists at
   comparable cost, propose it concretely.
2. **Entities**: review every added/changed API, field, type, enum, config
   key, and DB column against software design philosophy — SSOT (no two
   fields/entities carrying the same meaning, one authoritative writer per
   fact) and Occam's razor (no entity multiplied beyond necessity, no
   speculative generality).
3. **Scope**: architecture findings must be introduced or materially worsened
   by THIS change. Pre-existing problems are out of scope — do not report
   them as findings.

### Step 4: Evaluate Design Principles (SOLID)
Refer to `references/solid-checklist.md` for detailed smell prompts.
- **SRP**: Does any file own unrelated concerns?
- **OCP**: Are there rigid switch/if blocks that should be extension points?
- **LSP**: Any subclass/implementation violations?
- **ISP**: Fat interfaces with unused methods?
- **DIP**: High-level modules depending on concrete implementations?

### Step 5: Identify Unused Code Candidates
- Dead code: unreachable, never-called, or commented-out code
- Deprecated APIs still in use
- Feature flags that are always on/off
- Refer to `references/removal-plan.md` for safe deletion process

### Step 6: Security Scanning
Refer to `references/security-checklist.md` for the full checklist.
- **XSS/Injection**: Unsafe HTML, SQL/NoSQL/command injection
- **Auth gaps**: Missing access checks, authorization gaps, IDOR
- **Secrets**: Hardcoded keys, tokens in code/logs
- **CSRF**: State-changing operations without CSRF protection when cookie/session auth is used
- **Race conditions**: TOCTOU, concurrent state, check-then-act
- **Input validation**: Missing sanitization, path traversal

### Step 7: Code Quality Assessment
Refer to `references/code-quality-checklist.md` for detailed patterns.
- **Error handling**: Swallowed exceptions, missing catch, async gaps
- **Performance**: N+1 queries, blocking I/O, missing cache, O(n^2) hot paths, unnecessary React/Vue re-renders, memory leaks
- **Boundary conditions**: Null/undefined, empty collections, off-by-one
- **Complexity & maintainability**: Long functions, deep nesting, duplicated logic, tight coupling, poor testability
- **Naming & clarity**: Magic numbers, unclear names, documentation gaps, commented-out code, sensitive logs

### Step 8: Report Findings
Classify each finding by severity:
- **P0 (Critical)**: Must block merge — security vulnerabilities, data loss risks
- **P1 (High)**: Should fix — bugs, significant design issues
- **P2 (Medium)**: Consider fixing — maintainability, code quality
- **P3 (Low)**: Optional — style, minor improvements

### Step 9: Deliver the Review
- **Non-interactive (summoned `code-review-expert` agent, e.g. automated PR
  review):** the output contract in the agent's system prompt takes precedence
  — submit the structured result via `submit_output`. Skip the markdown
  format below.
- **Interactive (chat):** present findings using the Output Format below and
  wait for explicit approval before suggesting fixes. Do NOT auto-apply
  changes.

## Output Format (interactive mode only)

```markdown
## Review Summary
[One paragraph overview]

### Findings
- **[P0/P1/P2/P3]** `category` — **Title**
  - File: `path/to/file`
  - Description
  - Suggested fix

### Verdict
APPROVE | REQUEST_CHANGES | COMMENT
```
