/**
 * Canonical-concept taxonomy for Issue Triage.
 *
 * The app no longer creates Kubernetes-style slash labels during triage.
 * Instead, each classification dimension is defined as a set of CANONICAL
 * CONCEPTS. Each concept carries a recommended flat GitHub-style label name, a
 * color, a description, and a list of synonyms. When a repo is added, we detect
 * whether one of the repo's EXISTING labels already covers a concept (via
 * synonym matching, using `normalizeLabel`), and reuse it; otherwise the
 * recommended flat label is created once. During triage we only ever apply
 * labels that already resolve through this map — we never create labels.
 *
 * Colors are 6-hex without a leading `#`, as the GitHub labels API expects.
 * Area/component labels are NEVER part of this set — they come only from the
 * repo's existing labels.
 */

/** One dimension of classification. */
export type Dimension = "type" | "priority" | "area" | "flags";

/** Dimensions that carry a canonical-concept set (area is repo-defined only). */
export type ConceptDimension = "type" | "priority" | "flags";

/** A single canonical concept within a dimension. */
export interface Concept {
  /** Stable concept id used everywhere in code + the classifier enums. */
  concept: string;
  /** Recommended flat label name to create when no existing label matches. */
  name: string;
  /** GitHub label color (6-hex, no leading '#'). */
  color: string;
  /** Human description used when creating the label. */
  description: string;
  /** Synonyms (any form) that an existing repo label may take. */
  synonyms: string[];
}

export const TYPE_CONCEPTS: Concept[] = [
  {
    concept: "bug",
    name: "bug",
    color: "d73a4a",
    description: "Something is broken or not working as intended",
    synonyms: ["bug", "defect", "kind/bug", "type/bug"],
  },
  {
    concept: "enhancement",
    name: "enhancement",
    color: "a2eeef",
    description: "New feature or request / improvement to existing behavior",
    synonyms: [
      "enhancement",
      "feature",
      "feature request",
      "feat",
      "kind/feature",
      "type/feature",
      "type/enhancement",
    ],
  },
  {
    concept: "documentation",
    name: "documentation",
    color: "0075ca",
    description: "Documentation additions or corrections",
    synonyms: ["documentation", "docs", "doc", "type/docs"],
  },
  {
    concept: "question",
    name: "question",
    color: "d876e3",
    description: "A question or request for support",
    synonyms: ["question", "support", "help", "type/question"],
  },
];

export const PRIORITY_CONCEPTS: Concept[] = [
  {
    concept: "low",
    name: "priority: low",
    color: "c2e0c6",
    description: "Low priority",
    synonyms: ["priority/low", "priority: low", "low priority", "p3", "p4"],
  },
  {
    concept: "medium",
    name: "priority: medium",
    color: "fbca04",
    description: "Medium priority",
    synonyms: ["priority/medium", "priority: medium", "medium priority", "p2"],
  },
  {
    concept: "high",
    name: "priority: high",
    color: "e99695",
    description: "High priority",
    synonyms: ["priority/high", "priority: high", "high priority", "p1"],
  },
  {
    concept: "critical",
    name: "priority: critical",
    color: "b60205",
    description: "Critical - needs immediate attention",
    synonyms: ["priority/critical", "critical", "urgent", "p0", "sev0", "sev1"],
  },
];

export const FLAG_CONCEPTS: Concept[] = [
  {
    concept: "needs-triage",
    name: "needs-triage",
    color: "ededed",
    description: "Awaiting triage / needs a maintainer to categorize",
    synonyms: ["needs-triage", "needs triage", "triage", "untriaged"],
  },
  {
    concept: "needs-info",
    name: "needs-info",
    color: "fef2c0",
    description: "More information is required from the reporter",
    synonyms: [
      "needs-info",
      "needs more info",
      "needs more information",
      "more-information-needed",
      "awaiting response",
      "needs-repro",
    ],
  },
];

/** Concept sets keyed by the dimension they belong to. */
export const CONCEPTS_BY_DIMENSION: Record<ConceptDimension, Concept[]> = {
  type: TYPE_CONCEPTS,
  priority: PRIORITY_CONCEPTS,
  flags: FLAG_CONCEPTS,
};

/** The ordered concept dimensions that get provisioned (area is excluded). */
export const CONCEPT_DIMENSIONS: ConceptDimension[] = ["type", "priority", "flags"];

/** Concept-name enum lists used by the triage worker to validate classifier output. */
export const TYPE_CONCEPT_NAMES = TYPE_CONCEPTS.map((c) => c.concept);
export const PRIORITY_CONCEPT_NAMES = PRIORITY_CONCEPTS.map((c) => c.concept);
export const FLAG_CONCEPT_NAMES = FLAG_CONCEPTS.map((c) => c.concept);

/**
 * Resolved per-repo label map: canonical concept -> the actual repo label name
 * (either reused or created). Only concepts that resolved appear. Persisted as
 * JSON TEXT in repo_settings.label_map.
 */
export type LabelMap = Partial<Record<ConceptDimension, Record<string, string>>>;

export interface DimensionsEnabled {
  type: boolean;
  priority: boolean;
  area: boolean;
  flags: boolean;
}

export const DEFAULT_DIMENSIONS: DimensionsEnabled = {
  type: true,
  priority: true,
  area: true,
  flags: true,
};

/**
 * Normalize a label for synonym matching: lowercase, strip a single leading
 * `namespace/` or `namespace:` prefix, then strip all non-alphanumeric
 * characters. So `type/bug`, `Type: Bug`, and `kind/bug` all normalize to
 * `bug`; `priority: high` and `priority/high` both normalize to `high`.
 */
export function normalizeLabel(s: string): string {
  let out = (s ?? "").toLowerCase().trim();
  // Strip one leading `namespace/` or `namespace:` prefix (e.g. `type/`, `priority:`).
  out = out.replace(/^[a-z0-9][a-z0-9._-]*\s*[/:]\s*/, "");
  // Strip all non-alphanumeric characters.
  out = out.replace(/[^a-z0-9]/g, "");
  return out;
}

/** Precomputed normalized-synonym sets, per concept, per dimension. */
const NORMALIZED_SYNONYMS: Record<ConceptDimension, Array<{ concept: Concept; norms: Set<string> }>> = {
  type: TYPE_CONCEPTS.map((c) => ({ concept: c, norms: new Set(c.synonyms.map(normalizeLabel)) })),
  priority: PRIORITY_CONCEPTS.map((c) => ({ concept: c, norms: new Set(c.synonyms.map(normalizeLabel)) })),
  flags: FLAG_CONCEPTS.map((c) => ({ concept: c, norms: new Set(c.synonyms.map(normalizeLabel)) })),
};

/**
 * Find which concept (if any) an existing repo label matches within a given
 * concept dimension, using normalized synonym matching. Returns null if none.
 */
export function matchLabelToConcept(dimension: ConceptDimension, labelName: string): Concept | null {
  const norm = normalizeLabel(labelName);
  if (!norm) return null;
  for (const entry of NORMALIZED_SYNONYMS[dimension]) {
    if (entry.norms.has(norm)) return entry.concept;
  }
  return null;
}
