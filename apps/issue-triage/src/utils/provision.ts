/**
 * Label provisioning for Issue Triage.
 *
 * Provisioning happens ONCE when a repo is added (and can be re-run on demand).
 * For each ENABLED concept dimension (type, priority, flags — NOT area) and each
 * canonical concept, we detect whether the repo already has a label that covers
 * the concept (synonym match via `normalizeLabel`). If so we REUSE that exact
 * existing label name; otherwise we CREATE the recommended flat label. The
 * resulting per-repo `LabelMap` (concept -> actual repo label name) is persisted
 * and used at triage time. Triage NEVER creates labels.
 */
import { createLabel, fetchRepoLabels, type RepoLabel } from "./github.js";
import {
  CONCEPT_DIMENSIONS,
  CONCEPTS_BY_DIMENSION,
  type ConceptDimension,
  type DimensionsEnabled,
  type LabelMap,
  matchLabelToConcept,
} from "./taxonomy.js";

/** A concept the repo does not yet cover — the recommended label to create. */
export interface ProvisionCreateEntry {
  name: string;
  color: string;
  description: string;
  concept: string;
  dimension: ConceptDimension;
}

export interface ProvisionPlan {
  /** Namespaced concept key (`dimension:concept`) -> EXISTING repo label name. */
  reuse: Record<string, string>;
  /** Recommended labels to create for concepts with no existing match. */
  create: ProvisionCreateEntry[];
}

export interface ProvisionResult {
  labelMap: LabelMap;
  created: string[];
  reused: string[];
}

/** Build the namespaced concept key used in ProvisionPlan.reuse. */
export function conceptKey(dimension: ConceptDimension, concept: string): string {
  return `${dimension}:${concept}`;
}

/**
 * Pure planning function: given the repo's existing labels and which dimensions
 * are enabled, decide which concepts reuse an existing label and which need a
 * new recommended label created. No I/O.
 */
export function planProvision(existingLabels: RepoLabel[], dims: DimensionsEnabled): ProvisionPlan {
  const reuse: Record<string, string> = {};
  const create: ProvisionCreateEntry[] = [];

  for (const dimension of CONCEPT_DIMENSIONS) {
    if (!dims[dimension]) continue;
    for (const concept of CONCEPTS_BY_DIMENSION[dimension]) {
      // Find the first existing label that maps to this concept.
      const match = existingLabels.find(
        (l) => matchLabelToConcept(dimension, l.name)?.concept === concept.concept,
      );
      if (match) {
        reuse[conceptKey(dimension, concept.concept)] = match.name;
      } else {
        create.push({
          name: concept.name,
          color: concept.color,
          description: concept.description,
          concept: concept.concept,
          dimension,
        });
      }
    }
  }

  return { reuse, create };
}

function setMapEntry(map: LabelMap, dimension: ConceptDimension, concept: string, label: string): void {
  let bucket = map[dimension];
  if (!bucket) {
    bucket = {};
    map[dimension] = bucket;
  }
  bucket[concept] = label;
}

/**
 * Apply a provisioning plan. When `autoCreate` is true, create the recommended
 * labels for concepts with no existing match (idempotent — a 422 already-exists
 * is treated as success by `createLabel`). Returns the resolved label map plus
 * the created/reused label-name lists. When `autoCreate` is false, only reused
 * concepts appear in the map.
 */
export function applyProvision(repoSlug: string, plan: ProvisionPlan, autoCreate: boolean): ProvisionResult {
  const labelMap: LabelMap = {};
  const created: string[] = [];
  const reused: string[] = [];

  // Reused (existing) labels — parse the namespaced key back into dimension+concept.
  for (const [key, labelName] of Object.entries(plan.reuse)) {
    const idx = key.indexOf(":");
    if (idx < 0) continue;
    const dimension = key.slice(0, idx) as ConceptDimension;
    const concept = key.slice(idx + 1);
    setMapEntry(labelMap, dimension, concept, labelName);
    reused.push(labelName);
  }

  if (autoCreate) {
    for (const entry of plan.create) {
      const newly = createLabel(repoSlug, {
        name: entry.name,
        color: entry.color,
        description: entry.description,
      });
      setMapEntry(labelMap, entry.dimension, entry.concept, entry.name);
      if (newly) created.push(entry.name);
      else reused.push(entry.name);
    }
  }

  return { labelMap, created, reused };
}

/**
 * Convenience: fetch the repo's labels, plan, and apply. Returns both the plan
 * and the result so the caller can persist the map and surface a summary.
 */
export function provisionRepo(
  repoSlug: string,
  dims: DimensionsEnabled,
  autoCreate: boolean,
): { plan: ProvisionPlan; result: ProvisionResult } {
  const existing = fetchRepoLabels(repoSlug);
  const plan = planProvision(existing, dims);
  const result = applyProvision(repoSlug, plan, autoCreate);
  return { plan, result };
}
