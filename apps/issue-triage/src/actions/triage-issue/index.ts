import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
  RomeSessionRef,
} from "@rome-os/app-runtime";
import { createTriageRepository, type TriageClassification } from "../../db/repositories/repo.js";
import {
  addLabelsToIssue,
  fetchIssue,
  fetchRepoLabels,
  normalizeRepoSlug,
  removeLabelFromIssue,
  validateRepoSlug,
} from "../../utils/github.js";
import { formatCliError } from "../../utils/cli-errors.js";
import { contentSignature } from "../../utils/hash.js";
import {
  DEFAULT_DIMENSIONS,
  FLAG_CONCEPT_NAMES,
  PRIORITY_CONCEPT_NAMES,
  TYPE_CONCEPT_NAMES,
  type DimensionsEnabled,
  type LabelMap,
} from "../../utils/taxonomy.js";

const log = createAppLogger("issue-triage:triage-issue");

interface TriageInput {
  repo?: string;
  issueNumber?: number;
  resultId?: string;
  actor?: string;
}

interface ClassifierOutput {
  type: string;
  priority: string;
  areas: string[];
  flags: string[];
  reasoning: string;
}

/** Parse the classifier agent's structured payload, tolerating a raw-text fallback. */
function parseClassifierOutput(data: unknown): { output: ClassifierOutput | null; result: string; romeSession: RomeSessionRef | null } {
  let output: ClassifierOutput | null = null;
  let result = "";
  let romeSession: RomeSessionRef | null = null;

  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.result === "string") result = d.result;
    if (d.romeSession && typeof d.romeSession === "object") romeSession = d.romeSession as RomeSessionRef;
    if (d.output && typeof d.output === "object") {
      output = coerceOutput(d.output as Record<string, unknown>);
    }
  }

  if (!output && result.trim()) {
    // Fallback: the agent replied with JSON text instead of submit_output.
    const jsonMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : result;
    try {
      const parsed = JSON.parse(jsonStr.trim());
      output = coerceOutput(parsed);
    } catch {
      output = null;
    }
  }

  return { output, result, romeSession };
}

function coerceOutput(raw: Record<string, unknown>): ClassifierOutput {
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    type: typeof raw.type === "string" ? raw.type : "",
    priority: typeof raw.priority === "string" ? raw.priority : "",
    areas: asStringArray(raw.areas),
    flags: asStringArray(raw.flags),
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
  };
}

function buildPrompt(
  repoSlug: string,
  issue: { number: number; title: string; body: string },
  dims: DimensionsEnabled,
  repoLabels: Array<{ name: string; description: string | null }>,
  customRules: string | null,
): string {
  const parts: string[] = [];
  parts.push(`Classify this GitHub issue for triage.\n`);
  parts.push(`**Repository:** ${repoSlug}`);
  parts.push(`**Issue #${issue.number}:** ${issue.title}\n`);
  parts.push(`**Issue body:**\n${issue.body?.trim() ? issue.body : "(no description provided)"}\n`);

  const enabled = Object.entries(dims)
    .filter(([, v]) => v)
    .map(([k]) => k);
  parts.push(`**Enabled dimensions:** ${enabled.length ? enabled.join(", ") : "(none)"}`);
  parts.push(
    `Only fill enabled dimensions. Choose CONCEPTS (not label names): ` +
      `type ∈ [bug, enhancement, documentation, question]; ` +
      `priority ∈ [low, medium, high, critical]; ` +
      `flags ⊆ [needs-triage, needs-info]. ` +
      `For a disabled type/priority return "none"; for disabled areas/flags return an empty array.\n`,
  );

  if (dims.area) {
    if (repoLabels.length) {
      const list = repoLabels
        .map((l) => `- ${l.name}${l.description ? ` — ${l.description}` : ""}`)
        .join("\n");
      parts.push(`**Existing repository labels (choose area labels ONLY from these names):**\n${list}\n`);
    } else {
      parts.push(`**Existing repository labels:** (none found — return an empty areas array)\n`);
    }
  }

  if (customRules && customRules.trim()) {
    parts.push(`**Custom triage rules (follow these):**\n${customRules}\n`);
  }

  parts.push(`## Task`);
  parts.push(
    `Assign the enabled dimensions by concept and call submit_output with { type, priority, areas, flags, reasoning }. ` +
      `Return "none" for a type/priority that is disabled or does not apply.`,
  );
  return parts.join("\n");
}

export function createAction(config: ActionConfig, deps: AppActionRuntimeDeps): Action {
  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "GitHub repo (owner/name or URL)" },
        issueNumber: { type: "number", description: "Issue number to triage" },
        resultId: { type: "string", description: "Existing queued triage_results row id to update in place" },
        actor: { type: "string", description: "What triggered this triage (webhook:opened | manual | batch ...)" },
      },
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const typed = input as TriageInput;
      const db = createTriageRepository(deps.appContext.db);

      if (!typed.repo || !typed.issueNumber) {
        return { status: "error", error: "repo and issueNumber are required." };
      }
      const repoSlug = normalizeRepoSlug(typed.repo);
      const issueNumber = Number(typed.issueNumber);
      try {
        validateRepoSlug(repoSlug);
      } catch (err) {
        return { status: "error", error: err instanceof Error ? err.message : String(err) };
      }

      // Resolve or create the result row.
      let result = typed.resultId ? db.getResult(typed.resultId) : undefined;
      if (result && (result.repo !== repoSlug || result.issueNumber !== issueNumber)) {
        result = undefined;
      }
      if (!result) {
        result = db.createQueuedResult({ repo: repoSlug, issueNumber, actor: typed.actor ?? "manual" });
      }
      const resultId = result.id;
      db.markRunning(resultId);

      log.info("Starting triage", { repo: repoSlug, issueNumber, resultId });

      try {
        // 1. Fetch the issue.
        const issue = fetchIssue(repoSlug, issueNumber);
        db.updateResultMeta(resultId, { issueTitle: issue.title, issueUrl: issue.htmlUrl });

        if (issue.isPullRequest) {
          db.completeResult(resultId, { status: "skipped", error: "Target is a pull request, not an issue." });
          return { status: "ok", data: { resultId, skipped: true, reason: "pull_request" } };
        }

        // 2. Settings + candidate label universe.
        const settings = db.getRepoSettings(repoSlug);
        const dims: DimensionsEnabled = settings?.dimensionsEnabled ?? { ...DEFAULT_DIMENSIONS };
        const customRules = settings?.customRules ?? null;
        // Resolved concept -> repo label map (from provisioning). Triage NEVER
        // creates labels; it can only apply labels that already resolve here.
        const labelMap: LabelMap = settings?.labelMap ?? {};

        const repoLabels = fetchRepoLabels(repoSlug);
        const repoLabelByLower = new Map(repoLabels.map((l) => [l.name.toLowerCase(), l.name] as const));

        // 3. Summon the classifier.
        const prompt = buildPrompt(repoSlug, issue, dims, repoLabels, customRules);
        const summon = await deps.appContext.runAction("system:summon", {
          agentName: "issue-triage:issue-classifier",
          prompt,
        });
        if (summon.status !== "ok") {
          const err = summon.status === "error" ? summon.error : `summon returned ${summon.status}`;
          db.completeResult(resultId, { status: "failed", error: `Classifier agent failed: ${err}` });
          return { status: "error", error: `Classifier agent failed: ${err}` };
        }

        const { output, romeSession } = parseClassifierOutput(summon.data);
        if (romeSession) {
          try {
            db.setResultRomeSession(resultId, romeSession);
          } catch (err) {
            log.warn("Failed to persist rome session", { resultId, error: String(err) });
          }
        }
        if (!output) {
          db.completeResult(resultId, { status: "failed", error: "Classifier returned no usable output." });
          return { status: "error", error: "Classifier returned no usable output." };
        }

        // 4. Map the classifier's CONCEPTS to concrete repo labels via the
        //    resolved label map. A concept with no mapped label is skipped —
        //    triage never creates labels. Classification records CONCEPTS.
        const finalLabels = new Set<string>();
        const classification: TriageClassification = { type: null, priority: null, areas: [], flags: [] };

        const typeMap = labelMap.type ?? {};
        const priorityMap = labelMap.priority ?? {};
        const flagsMap = labelMap.flags ?? {};

        if (dims.type && output.type && output.type !== "none" && TYPE_CONCEPT_NAMES.includes(output.type)) {
          classification.type = output.type;
          const mapped = typeMap[output.type];
          if (mapped) finalLabels.add(mapped);
        }
        if (dims.priority && output.priority && output.priority !== "none" && PRIORITY_CONCEPT_NAMES.includes(output.priority)) {
          classification.priority = output.priority;
          const mapped = priorityMap[output.priority];
          if (mapped) finalLabels.add(mapped);
        }
        if (dims.flags) {
          for (const flag of output.flags) {
            if (FLAG_CONCEPT_NAMES.includes(flag)) {
              classification.flags.push(flag);
              const mapped = flagsMap[flag];
              if (mapped) finalLabels.add(mapped);
            }
          }
        }
        if (dims.area) {
          for (const area of output.areas) {
            // Area labels must resolve to an EXISTING repo label (case-insensitive).
            const resolved = repoLabelByLower.get(area.toLowerCase());
            if (resolved) {
              finalLabels.add(resolved);
              classification.areas.push(resolved);
            }
          }
        }

        // Triage never creates labels; createdLabels is always empty now.
        const createdLabels: string[] = [];
        const finalList = [...finalLabels];

        // 5. Replace prior bot-owned type/priority labels that changed, then apply.
        //    Only remove labels that are VALUES in this repo's labelMap for the
        //    type/priority dimensions — never touch unrelated labels.
        const botTypePriorityLabels = new Set<string>([
          ...Object.values(typeMap),
          ...Object.values(priorityMap),
        ]);
        for (const current of issue.labels) {
          if (botTypePriorityLabels.has(current) && !finalLabels.has(current)) {
            removeLabelFromIssue(repoSlug, issueNumber, current);
          }
        }

        if (finalList.length > 0) {
          addLabelsToIssue(repoSlug, issueNumber, finalList);
        }

        db.completeResult(resultId, {
          status: "succeeded",
          appliedLabels: finalList,
          createdLabels,
          reasoning: output.reasoning || null,
          classification,
        });

        log.info("Triage completed", { repo: repoSlug, issueNumber, resultId, applied: finalList, created: createdLabels });

        return {
          status: "ok",
          data: {
            resultId,
            repo: repoSlug,
            issueNumber,
            appliedLabels: finalList,
            createdLabels,
            classification,
          },
        };
      } catch (err: unknown) {
        const errorMsg = formatCliError(err, `Failed to triage issue #${issueNumber} in ${repoSlug}`);
        db.completeResult(resultId, { status: "failed", error: errorMsg });
        log.error("Triage failed", { repo: repoSlug, issueNumber, resultId, error: errorMsg });
        return { status: "error", error: errorMsg };
      }
    },
  };
}

/** Recompute a content signature for an issue (exported for reuse/testing). */
export function issueSignature(title: string, body: string): string {
  return contentSignature(title, body);
}
