# Architecture Review Checklist

Architecture-level review of a change. Grounded in community practice: Google
eng-practices ("the most important thing to cover in a review is the overall
design of the CL"), Single Source of Truth (SSOT), Occam's razor / KISS /
YAGNI, and *A Philosophy of Software Design* (complexity is the enemy; deep
modules, shallow interfaces).

## 1. Direction — Is the change architecturally correct?

"Good" means **globally optimal for the codebase**, not locally clean within
the diff. A tidy patch can still be the wrong move for the system.

- Does the change respect existing module boundaries and layering, or does it
  cut across them (e.g. business rules in a controller, UI state persisted in
  the data layer, transport concerns leaking into domain code)?
- Does it introduce a new coupling between modules that previously did not
  know each other? Is the dependency direction still correct (high-level
  modules must not start depending on low-level details)?
- Is this the simplest design that solves the *whole* problem? Watch for
  locally-optimal patches: adding a third ad-hoc cache instead of reusing the
  existing one, a parallel code path instead of extending the existing one,
  a workaround downstream when a small fix upstream removes the need entirely.
- Would a materially better global design exist at comparable cost? If yes,
  propose it concretely (a short sketch: which module owns what, what the
  call chain becomes). Do not hand-wave "consider refactoring".
- Does the change create a one-way door (public API shape, storage schema,
  wire format) that will be expensive to undo? One-way doors deserve stricter
  scrutiny than easily-reversible internals.

## 2. Entity review — APIs, fields, types, schemas

For **every** added or changed API endpoint, public method, field, type,
enum, config key, or DB column, ask:

- **SSOT (Single Source of Truth):** does the same fact now live in two
  places? Classic smells:
  - Two fields with the same meaning (`isActive` alongside
    `status === "active"`; `fullName` alongside `firstName`/`lastName`).
  - The same-meaning field duplicated on two classes/objects, both writable,
    with no designated owner.
  - A derived value stored instead of computed, requiring manual
    synchronization.
  - Duplicated enums/constants/validation rules in two layers that must now
    be kept in sync by hand.
  - An API response exposing the same data under two keys "for convenience".
  Every fact should have exactly one authoritative writer; more than one
  writer is a design smell.
- **Occam's razor:** is every new entity *necessary*? Could an existing
  field/type/endpoint be extended instead of adding a parallel one? Entities
  must not be multiplied beyond necessity.
- **YAGNI / speculative generality:** flag parameters nobody passes,
  abstraction layers with a single implementation and no concrete second
  consumer, options and modes added "for the future".
- **Semantics & naming:** does the new entity's meaning overlap or conflict
  with an existing one? Will a consumer be confused about which of two
  fields to read or write?
- **Contract compatibility:** for changed API/schema shapes — is it backward
  compatible? Who must migrate, and is the migration path stated?

## 3. Scope discipline — review the change, not the repository

- An architecture finding is only valid if it is **introduced by, or
  materially worsened by, this diff**.
- Pre-existing problems that the diff merely touches or sits next to are
  **out of scope**: do not report them as findings. At most, mention one in
  the summary as a non-blocking observation — never as P0/P1, and never as
  grounds for REQUEST_CHANGES.
- Judge alternatives against the codebase *as it is today*, not against an
  idealized rewrite. "Better" must be reachable at comparable cost.

## Severity mapping for architecture findings

| Finding | Typical severity |
|---|---|
| Wrong direction on a one-way door (public API / schema / wire format) | P0–P1 |
| Structurally wrong approach; a clearly better global design exists at similar cost | P1 |
| SSOT violation: duplicate-meaning field/entity, two writers of one fact | P1–P2 |
| Unnecessary entity / speculative generality (Occam's razor, YAGNI) | P2 |
| Boundary/layering blemish that is easy to reverse later | P2–P3 |
