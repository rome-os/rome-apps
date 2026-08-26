import { readFileSync } from "node:fs";
import {
  runWithCurrentActionContext,
  type Action,
  type ActionConfig,
  type ActionResult,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { createCompanyResearchRepository } from "../db/repositories/company-research.js";

type JsonObject = Record<string, unknown>;
type ResearchSectionKey = "company" | "team" | "marketing" | "financials" | "content";
type ResearchSectionSpec = {
  key: ResearchSectionKey;
  queryIndex: number;
};

const CHATGPT_CHAT_START_DELAY_MAX_MS = 3_000;
const CHATGPT_CHAT_MAX_ATTEMPTS = 2;
const CHATGPT_CHAT_MAX_PARALLEL_ACTIONS = 5;
const CHATGPT_CHAT_LOG_PREVIEW_MAX_CHARS = 500;
const RESEARCH_SECTIONS: readonly ResearchSectionSpec[] = [
  { key: "company", queryIndex: 1 },
  { key: "team", queryIndex: 2 },
  { key: "marketing", queryIndex: 3 },
  { key: "financials", queryIndex: 4 },
  { key: "content", queryIndex: 5 },
];

const COMPANY_RESEARCH_QUERY_TEMPLATES: Record<ResearchSectionKey, string> = {
  company: readFileSync(
    new URL("../docs/query_1_company_product_market.md", import.meta.url),
    "utf8",
  ),
  team: readFileSync(
    new URL("../docs/query_2_team_governance.md", import.meta.url),
    "utf8",
  ),
  marketing: readFileSync(
    new URL("../docs/query_3_marketing_strategy.md", import.meta.url),
    "utf8",
  ),
  financials: readFileSync(
    new URL("../docs/query_4_financials_financing.md", import.meta.url),
    "utf8",
  ),
  content: readFileSync(
    new URL("../docs/query_5_content_strategy.md", import.meta.url),
    "utf8",
  ),
};

const COMPANY_RESEARCH_PROMPT_VERSION = "company-research-prompts/v5";
const COMPANY_RESEARCH_EXTRACTOR_VERSION = "company-research-agent/v3";

function assertObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("input must be an object");
  }
  return value as JsonObject;
}

function readRequiredString(record: JsonObject, fieldName: string): string {
  const value = record[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

async function runWithScopedSharedContext<T>(
  sharedContext: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  return await runWithCurrentActionContext({ sharedContext }, fn);
}

function buildResearchPrompt(template: string, canonicalName: string, domain: string): string {
  return template
    .replace(/\{COMPANY_NAME\}/g, canonicalName)
    .replace(/\{COMPANY_DOMAIN\}/g, domain);
}

function waitForRandomStartDelay(maxDelayMs: number): Promise<void> {
  const delayMs = Math.floor(Math.random() * (maxDelayMs + 1));
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function mapWithOrderedLaunchConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  beforeStart: (item: T, index: number) => Promise<void>,
  mapItem: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const maxConcurrency = Math.min(Math.max(1, concurrency), items.length);
  const results = new Array<TResult>(items.length);
  const inFlight = new Set<Promise<void>>();

  for (const [index, item] of items.entries()) {
    while (inFlight.size >= maxConcurrency) {
      await Promise.race(inFlight);
    }

    await beforeStart(item, index);

    const task = (async () => {
      results[index] = await mapItem(item, index);
    })();

    const trackedTask = task.finally(() => {
      inFlight.delete(trackedTask);
    });
    inFlight.add(trackedTask);
  }

  await Promise.all(inFlight);
  return results;
}

function normalizeChatGptMarkdown(data: unknown): string {
  if (typeof data === "string") {
    return data.trim();
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("chatgpt_chat returned an unsupported result shape");
  }

  const typed = data as {
    response?: unknown;
    sources?: Array<{ title?: unknown; url?: unknown }> | unknown;
  };
  const response = typeof typed.response === "string" ? typed.response.trim() : "";
  const sources = Array.isArray(typed.sources)
    ? typed.sources
        .map((source) => {
          if (!source || typeof source !== "object" || Array.isArray(source)) {
            return null;
          }
          const typedSource = source as { title?: unknown; url?: unknown };
          const title =
            typeof typedSource.title === "string" && typedSource.title.trim().length > 0
              ? typedSource.title.trim()
              : "Source";
          const url = typeof typedSource.url === "string" ? typedSource.url.trim() : "";
          return url ? `- [${title}](${url})` : `- ${title}`;
        })
        .filter((value): value is string => value !== null)
    : [];

  return [response, sources.length > 0 ? `Sources:\n${sources.join("\n")}` : ""]
    .filter((value: string) => value.trim().length > 0)
    .join("\n\n")
    .trim();
}

function stringifyResultForLog(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  try {
    const stringified = JSON.stringify(data);
    return typeof stringified === "string" ? stringified : String(data);
  } catch {
    return String(data);
  }
}

function previewLogValue(value: string, maxChars: number): string {
  return value.slice(0, maxChars);
}

function hasEmptyChatGptResponse(data: unknown): boolean {
  if (typeof data === "string") {
    return data.trim().length === 0;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }

  const typed = data as { response?: unknown };
  return typeof typed.response === "string" && typed.response.trim().length === 0;
}

function stripUtmParams(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    const normalizedSearchParams = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      if (key.toLowerCase().startsWith("utm_")) {
        continue;
      }
      normalizedSearchParams.append(key, value);
    }
    url.search = normalizedSearchParams.toString();
    return url.toString();
  } catch {
    return urlValue;
  }
}

function sanitizeResultMarkdown(markdown: string): string {
  return markdown.replace(/https?:\/\/[^\s<>"')\]]+/g, (match) => stripUtmParams(match));
}

function sanitizeResearchSections(
  sections: Partial<Record<ResearchSectionKey, string>>,
): Partial<Record<ResearchSectionKey, string>> {
  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [key, sanitizeResultMarkdown(value)]),
  ) as Partial<Record<ResearchSectionKey, string>>;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDayOfMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfMonth));
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatCombinedResearchMarkdown(sections: Record<ResearchSectionKey, string>): string {
  return `<company>
${sections.company}
</company>
<team>
${sections.team}
</team>
<marketing>
${sections.marketing}
</marketing>
<content>
${sections.content}
</content>
<financials>
${sections.financials}
</financials>`;
}

function buildRunReportRows(
  sections: Partial<Record<ResearchSectionKey, string>>,
): Array<{ reportType: ResearchSectionKey; reportContent: string }> {
  return RESEARCH_SECTIONS.flatMap(({ key }) => {
    const reportContent = sections[key];
    return reportContent
      ? [
          {
            reportType: key,
            reportContent,
          },
        ]
      : [];
  });
}

function extractSummonResultText(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }

  const typed = data as { result?: unknown };
  return typeof typed.result === "string" ? typed.result : "";
}

function buildStructuredFillPrompt(input: {
  canonicalName: string;
  domain: string;
  companyId: string;
  runId: string;
  resultMarkdown: string;
}): string {
  return `Fill the company-research structured tables for ${input.canonicalName} (${input.domain}).

Use the predefined company_research_add_* actions to populate the typed company-research tables from the research markdown below.

Rules:
- sharedContext already includes company_id=${input.companyId} and run_id=${input.runId}; prefer relying on sharedContext instead of repeating them.
- Only insert grounded facts supported by the markdown and its cited links.
- Do not invent or infer unsupported values.
- Create at most one company_attributes row.
- Add rows only when there is enough evidence.
- Include provenance citation_url whenever a source link is available, plus confidence when reasonably clear.
- Use company_research_add_person_role for founders, executives, board members, and alumni.
- Use company_research_add_company_relationship for customers and competitors.
- Use company_research_add_financing_round for financing rounds and investor entities.
- Use company_research_add_metrics only for specific disclosed periods and values.
- Use company_research_add_job_post, company_research_add_notable_event, and company_research_add_product when grounded in the report.

After inserting the structured rows, return a brief JSON-like summary with what you added and what you skipped.

Research markdown:
${input.resultMarkdown}`;
}

export function createCompanyResearchRunCompanyResearchAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const repository = createCompanyResearchRepository(deps.appContext.db);

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        canonical_name: { type: "string" },
        company_domain: { type: "string" },
      },
      required: ["canonical_name", "company_domain"],
      additionalProperties: false,
    },
    async execute(input): Promise<ActionResult> {
      try {
        const args = assertObject(input);
        const canonicalName = readRequiredString(args, "canonical_name");
        const normalizedDomain = readRequiredString(args, "company_domain")
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/.*$/, "");

        const company = repository.ensureCompany({
          canonicalName,
          domain: normalizedDomain,
          websiteUrl: `https://${normalizedDomain}`,
        }) as { id: string };
        const companyId = company.id;

        const now = new Date();
        const ensuredSchedule = repository.ensureSchedule({
          companyId,
          cadenceMonths: 3,
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        }) as {
          created: boolean;
          schedule: { id: string; cadenceMonths: number };
        };

        const run = repository.createRun({
          companyId,
          status: "running",
          scheduledFor: now,
          startedAt: now,
          promptVersion: COMPANY_RESEARCH_PROMPT_VERSION,
          extractorVersion: COMPANY_RESEARCH_EXTRACTOR_VERSION,
          createdAt: now,
        }) as { id: string };

        const runId = run.id;
        const scopedSharedContext = {
          company_id: companyId,
          companyId,
          run_id: runId,
          runId,
        };

        let tmpResultMarkdown = "";
        let resultMarkdown = "";
        let agentResult = "";
        let sanitizedSections: Partial<Record<ResearchSectionKey, string>> = {};

        try {
          const sections = await runWithScopedSharedContext(scopedSharedContext, async () => {
            const formattedSections = Object.fromEntries(
              await mapWithOrderedLaunchConcurrency(
                RESEARCH_SECTIONS,
                CHATGPT_CHAT_MAX_PARALLEL_ACTIONS,
                async () => {
                  await waitForRandomStartDelay(CHATGPT_CHAT_START_DELAY_MAX_MS);
                },
                async ({ key, queryIndex }) => {
                  const prompt = buildResearchPrompt(
                    COMPANY_RESEARCH_QUERY_TEMPLATES[key],
                    canonicalName,
                    normalizedDomain,
                  );

                  for (let attempt = 1; attempt <= CHATGPT_CHAT_MAX_ATTEMPTS; attempt += 1) {
                    const queryStartedAt = Date.now();
                    const queryResult = await deps.appContext.runAction("chatgpt_chat", {
                      prompt,
                    });
                    const queryData =
                      queryResult.status === "ok" ? queryResult.data : undefined;
                    const queryError =
                      queryResult.status === "error" ? queryResult.error : undefined;
                    const resultDataForLog = stringifyResultForLog(queryData);
                    const shouldRetry =
                      attempt < CHATGPT_CHAT_MAX_ATTEMPTS &&
                      (queryResult.status !== "ok" || hasEmptyChatGptResponse(queryData));

                    deps.appContext.log.info("chatgpt_chat finished", {
                      companyId,
                      runId,
                      section: key,
                      queryIndex,
                      attempt,
                      success: queryResult.status === "ok",
                      durationMs: Date.now() - queryStartedAt,
                      resultDataLength: resultDataForLog.length,
                      resultDataPreview: previewLogValue(
                        resultDataForLog,
                        CHATGPT_CHAT_LOG_PREVIEW_MAX_CHARS,
                      ),
                      retrying: shouldRetry || undefined,
                      error: queryResult.status === "ok" ? undefined : (queryError ?? null),
                    });

                    if (shouldRetry) {
                      continue;
                    }

                    if (queryResult.status !== "ok") {
                      throw new Error(queryError ?? `query ${queryIndex} failed`);
                    }

                    return [key, normalizeChatGptMarkdown(queryResult.data)] as const;
                  }

                  throw new Error(`query ${queryIndex} failed`);
                },
              ),
            ) as Record<ResearchSectionKey, string>;

            sanitizedSections = sanitizeResearchSections(formattedSections);
            tmpResultMarkdown = formatCombinedResearchMarkdown(formattedSections);
            resultMarkdown = formatCombinedResearchMarkdown(
              sanitizedSections as Record<ResearchSectionKey, string>,
            );

            const summonResult = await deps.appContext.runAction("summon", {
              agentName: "assistant",
              prompt: buildStructuredFillPrompt({
                canonicalName,
                domain: normalizedDomain,
                companyId,
                runId,
                resultMarkdown,
              }),
            });
            if (summonResult.status !== "ok") {
              throw new Error(
                (summonResult.status === "error" ? summonResult.error : undefined) ??
                  "structured fill agent failed",
              );
            }

            agentResult = extractSummonResultText(summonResult.data);
            return sanitizedSections as Record<ResearchSectionKey, string>;
          });

          const completedAt = new Date();
          const schedule = repository.updateSchedule(companyId, {
            lastRunAt: completedAt,
            nextRunAt: addMonths(completedAt, ensuredSchedule.schedule.cadenceMonths),
            updatedAt: completedAt,
          });
          repository.replaceRunReports({
            companyId,
            runId,
            reports: buildRunReportRows(sections).map((report) => ({
              ...report,
              createdAt: completedAt,
            })),
          });
          const updatedRun = repository.updateRun(runId, {
            status: "success",
            completedAt,
            extractorOutput: JSON.stringify({
              tmp_result_markdown: tmpResultMarkdown,
              result_markdown: resultMarkdown,
              agent_result: agentResult,
              sections,
            }),
            error: null,
          });

          return {
            status: "ok",
            data: {
              company,
              schedule_created: ensuredSchedule.created,
              schedule,
              run: updatedRun,
              tmp_result_markdown: tmpResultMarkdown,
              result_markdown: resultMarkdown,
              agent_result: agentResult,
            },
          };
        } catch (error) {
          const completedAt = new Date();
          const message = error instanceof Error ? error.message : String(error);
          const schedule = repository.updateSchedule(companyId, {
            nextRunAt: addDays(completedAt, 1),
            updatedAt: completedAt,
          });
          if (Object.keys(sanitizedSections).length > 0) {
            repository.replaceRunReports({
              companyId,
              runId,
              reports: buildRunReportRows(sanitizedSections).map((report) => ({
                ...report,
                createdAt: completedAt,
              })),
            });
          }
          repository.updateRun(runId, {
            status: "error",
            completedAt,
            extractorOutput:
              tmpResultMarkdown || agentResult
                ? JSON.stringify({
                    tmp_result_markdown: tmpResultMarkdown,
                    result_markdown: resultMarkdown,
                    agent_result: agentResult,
                  })
                : null,
            error: message,
          });

          return {
            status: "error",
            error: message,
          };
        }
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
