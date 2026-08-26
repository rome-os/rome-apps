import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AgentRunnerInterface,
  AppActionRuntimeDeps,
  AppDbContext,
} from "@rome-os/app-runtime";
import {
  CUSTOM_PROMPT_MAX_LENGTH,
  SETTING_KEY_PUBLIC_ORIGIN,
  createStockDailyRepository,
} from "../../db/repositories/stockDaily.js";
import { preparePdfAttachment } from "../../lib/pdfAttachment.js";
import { ANALYST_AGENT_PROMPT, buildReportRequest } from "../../lib/reportPrompt.js";
import { PdfRendererError, renderReportPdf } from "../../lib/pdfRenderer.js";
import {
  configuredShareableOrigin,
  isShareableOrigin,
} from "../../lib/publicOrigin.js";

const log = createAppLogger("stock-daily_generate_report");

/**
 * Loose email shape check — enough to catch obvious typos before handing the
 * address to the email channel adapter (which performs the real validation).
 */
export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Resolve the email recipient for a schedule. A saved custom address wins
 * when it looks like a valid email; otherwise fall back to the literal
 * "guardian", which the send_message action resolves to the guardian's
 * address through their channel mapping.
 */
function resolveEmailRecipient(emailRecipient: string | null | undefined): string {
  const custom = emailRecipient?.trim();
  if (custom && isValidEmailAddress(custom)) return custom;
  return "guardian";
}

interface GenerateReportInput {
  scheduleId?: string;
  manual?: boolean;
  reportDate?: string;
  /**
   * Optional one-shot custom prompt appended to the analyst agent prompt for
   * this run only. When omitted, the action falls back to the saved custom
   * prompt stored in stock_daily__settings (key = custom_prompt). Pass an
   * empty string explicitly to disable the saved prompt for a single run.
   */
  customPrompt?: string;
}

interface Deps {
  agentRunner: AgentRunnerInterface;
}

function todayInNewYork(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function summarize(content: string): string {
  const cleaned = content.replace(/\r/g, "").trim();
  const oneLine = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !line.startsWith("#") && !line.startsWith("|") && !/^[-*]\s*$/.test(line));
  return (oneLine ?? cleaned.slice(0, 220)).slice(0, 360);
}

function extractSources(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 80);
}

function messageText(msg: unknown): string {
  const item = msg as { type?: string; content?: unknown; text?: unknown; error?: unknown };
  if (typeof item.content === "string") return item.content;
  if (typeof item.text === "string") return item.text;
  return "";
}

function triggerLabel(value: string): string {
  if (value === "manual") return "Manual run";
  if (value === "scheduled") return "Scheduled run";
  return value;
}

/**
 * Resolve the last public origin observed by the API handler. The API
 * captures the request's Origin / X-Forwarded-* / Host header on every call
 * and persists the canonical form into stock_daily__settings, so we never
 * need an environment variable to know how to address the API server.
 */
function buildPdfDownloadUrl(
  db: AppDbContext,
  reportId: string,
): string | undefined {
  try {
    const repo = createStockDailyRepository(db);
    const stored = repo.getSetting(SETTING_KEY_PUBLIC_ORIGIN);
    const origin = configuredShareableOrigin() ?? (isShareableOrigin(stored) ? stored : undefined);
    if (!origin) return undefined;
    return `${origin.replace(/\/+$/, "")}/api/apps/stock-daily/reports/${reportId}/pdf`;
  } catch (err) {
    log.warn("failed to read public origin from settings", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function buildEmailBody(opts: {
  reportTitle: string;
  summary: string;
  markdown: string;
  pdfUrl?: string;
  pdfAttached: boolean;
  pdfMissing: boolean;
}): string {
  const lines: string[] = [];
  if (opts.summary) {
    lines.push(`**${opts.summary}**`);
    lines.push("");
  }
  if (opts.pdfAttached) {
    lines.push("📎 The full PDF report is attached to this email.");
  } else if (opts.pdfUrl) {
    lines.push(`📎 [Download the PDF report](${opts.pdfUrl}) (login may be required).`);
  } else if (opts.pdfMissing) {
    lines.push("⚠️ PDF generation failed. The full report is included below.");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(opts.markdown);
  return lines.join("\n");
}

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps<Deps>,
): Action {
  const { appContext, agentRunner } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        scheduleId: { type: "string", description: "Optional active schedule id for scheduled runs." },
        manual: { type: "boolean", description: "Whether the run was manually triggered." },
        reportDate: { type: "string", description: "Optional YYYY-MM-DD report date override." },
        customPrompt: {
          type: "string",
          description:
            "Optional one-shot custom prompt appended to the analyst agent prompt for this run only. " +
            "When omitted, the action falls back to the saved custom prompt. " +
            "Pass empty string to disable the saved prompt for a single run.",
        },
      },
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<ActionResult> {
      const args = input as GenerateReportInput;
      const repo = createStockDailyRepository(appContext.db);
      const triggerType = args.manual ? "manual" : "scheduled";

      // Resolve the schedule (if any) up front — used for the sendEmail flag.
      const schedule = args.scheduleId ? repo.getSchedule(args.scheduleId) : repo.getActiveSchedule();

      if (args.scheduleId && !args.manual) {
        if (!schedule || !schedule.enabled || schedule.deactivatedAt) {
          log.info("skipping inactive scheduled run", { scheduleId: args.scheduleId });
          return { status: "ok", data: { skipped: true, reason: "inactive_schedule" } };
        }
      }

      const reportDate = args.reportDate || todayInNewYork();
      const id = crypto.randomUUID();
      const now = new Date();
      const title = `US Stock Market Daily Close Report | ${reportDate}`;

      repo.createReport({
        id,
        scheduleId: args.scheduleId,
        status: "in_progress",
        triggerType,
        reportDate,
        title,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      try {
        // Resolve the effective custom prompt for this run.
        //  - input.customPrompt === undefined → fall back to the saved prompt
        //  - input.customPrompt === ""         → explicit opt-out (no custom prompt)
        //  - otherwise                         → use the provided value (capped)
        const savedCustomPrompt = repo.getCustomPrompt();
        const effectiveCustomPrompt =
          typeof args.customPrompt === "string"
            ? args.customPrompt.trim().length > 0
              ? args.customPrompt.slice(0, CUSTOM_PROMPT_MAX_LENGTH)
              : undefined
            : savedCustomPrompt;

        const promptSections: string[] = [ANALYST_AGENT_PROMPT, "", buildReportRequest(reportDate)];
        if (effectiveCustomPrompt) {
          promptSections.push(
            "",
            "Additional instructions from the guardian (apply on top of the structure above; never violate the source-citation or no-fabrication rules):",
            effectiveCustomPrompt,
          );
        }
        const prompt = promptSections.join("\n");
        log.info("agent prompt prepared", {
          reportId: id,
          customPromptApplied: Boolean(effectiveCustomPrompt),
          customPromptSource:
            typeof args.customPrompt === "string"
              ? args.customPrompt.trim().length > 0
                ? "request"
                : "disabled"
              : savedCustomPrompt
                ? "saved"
                : "none",
          customPromptChars: effectiveCustomPrompt?.length ?? 0,
        });
        let streamed = "";
        let final = "";

        for await (const msg of agentRunner.run({
          agentName: "stock-daily-analyst",
          prompt,
          sharedContext: { reportDate, triggerType, reportId: id },
        })) {
          const type = (msg as { type?: string }).type;
          if (type === "text") streamed += messageText(msg);
          if (type === "result") final = messageText(msg) || final;
          if (type === "error") {
            const error = (msg as { error?: unknown }).error;
            throw new Error(typeof error === "string" ? error : JSON.stringify(error));
          }
        }

        const content = (final || streamed).trim();
        if (!content) throw new Error("agent returned empty report");
        const completedAt = new Date();
        const sources = extractSources(content);
        const finalTitle = content.match(/US Stock Market Daily Close Report \| \d{4}-\d{2}-\d{2}/)?.[0] ?? title;
        const finalSummary = summarize(content);

        repo.updateReport(id, {
          status: "completed",
          title: finalTitle,
          summary: finalSummary,
          content,
          sourcesJson: JSON.stringify(sources),
          completedAt,
          updatedAt: completedAt,
        });

        log.info("report completed", { reportId: id, sources: sources.length });

        // Render the PDF after the markdown is committed. PDF failure must not
        // fail the whole run — we record the error and keep the markdown report.
        let pdfPath: string | undefined;
        let pdfSizeBytes: number | undefined;
        let pdfError: string | undefined;
        try {
          const result = await renderReportPdf({
            reportId: id,
            title: finalTitle,
            reportDate,
            triggerLabel: triggerLabel(triggerType),
            completedAtIso: completedAt.toISOString(),
            markdown: content,
          });
          pdfPath = result.path;
          pdfSizeBytes = result.sizeBytes;
          repo.updateReport(id, {
            pdfPath,
            pdfSizeBytes,
            pdfError: null,
            updatedAt: new Date(),
          });
          log.info("pdf rendered", { reportId: id, pdfPath, pdfSizeBytes });
        } catch (err) {
          pdfError =
            err instanceof PdfRendererError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          repo.updateReport(id, {
            pdfError,
            updatedAt: new Date(),
          });
          log.error("pdf render failed", { reportId: id, error: pdfError });
        }

        // Optionally email the report when the schedule has it enabled. The
        // recipient defaults to the guardian (resolved by send_message via
        // `to: "guardian"`); a custom address saved on the schedule wins.
        let emailSent = false;
        let emailRecipient: string | undefined;
        let emailPdfLink: string | undefined;
        if (schedule?.sendEmail) {
          const to = resolveEmailRecipient(schedule.emailRecipient);
          emailRecipient = to;
          const pdfUrl = pdfPath ? buildPdfDownloadUrl(appContext.db, id) : undefined;
          emailPdfLink = pdfUrl;
          let pdfAttachmentPath: string | undefined;
          if (pdfPath) {
            try {
              pdfAttachmentPath = await preparePdfAttachment({
                reportId: id,
                reportDate,
                sourcePath: pdfPath,
              });
            } catch (err) {
              log.warn("failed to prepare pdf attachment; falling back to link-only email", {
                reportId: id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          const text = buildEmailBody({
            reportTitle: finalTitle,
            summary: finalSummary,
            markdown: content,
            pdfUrl,
            pdfAttached: Boolean(pdfAttachmentPath),
            pdfMissing: !pdfPath,
          });
          const attachments = pdfAttachmentPath
            ? [
                {
                  type: "document",
                  source: pdfAttachmentPath,
                  caption: finalTitle,
                },
              ]
            : undefined;
          try {
            await appContext.runAction("send_message", {
              channel: "email",
              to,
              subject: finalTitle,
              text,
              attachments,
            });
            emailSent = true;
            log.info("report sent via email", {
              reportId: id,
              to,
              pdfUrl,
              pdfAttached: Boolean(pdfAttachmentPath),
            });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            log.error("failed to send report email", {
              reportId: id,
              to,
              error,
            });
            if (attachments) {
              try {
                await appContext.runAction("send_message", {
                  channel: "email",
                  to,
                  subject: finalTitle,
                  text: `${text}\n\n⚠️ PDF attachment upload failed (${error}). Open the Stock Daily app to download it.`,
                });
                emailSent = true;
                log.info("fallback report email sent without attachment", { reportId: id, to, pdfUrl });
              } catch (fallbackErr) {
                log.error("failed to send fallback report email", {
                  reportId: id,
                  to,
                  error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
                });
              }
            }
          }
        }

        return {
          status: "ok",
          data: {
            reportId: id,
            status: "completed",
            emailSent,
            emailRecipient,
            emailPdfLink,
            pdfPath,
            pdfSizeBytes,
            pdfError,
          },
        };
      } catch (err) {
        const failedAt = new Date();
        const message = err instanceof Error ? err.message : String(err);
        repo.updateReport(id, {
          status: "failed",
          error: message,
          completedAt: failedAt,
          updatedAt: failedAt,
        });
        log.error("report generation failed", { reportId: id, error: message });
        return { status: "error", error: message };
      }
    },
  };
}
