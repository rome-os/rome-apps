import { existsSync, readFileSync, statSync } from "node:fs";
import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import {
  CUSTOM_PROMPT_MAX_LENGTH,
  SETTING_KEY_PUBLIC_ORIGIN,
  createStockDailyRepository,
} from "../db/repositories/stockDaily.js";
import { getPdfPathForReport } from "../lib/pdfRenderer.js";
import {
  downloadOriginForRequest,
  shareableOriginForRequest,
} from "../lib/publicOrigin.js";

type Frequency = "daily" | "weekdays" | "weekly" | "custom";

interface SaveScheduleBody {
  enabled?: boolean;
  tzid?: string;
  localTime?: string;
  frequency?: Frequency;
  weekday?: string;
  rrule?: string;
  notes?: string;
  sendEmail?: boolean;
  /** Custom recipient address; empty/omitted means "send to the guardian". */
  emailRecipient?: string | null;
}

/** Loose email shape check, mirroring the action-side validation. */
function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type JsonBody<T> = { ok: true; value: T } | { ok: false; reason: "empty" | "parse_error" };

function readJsonBody<T>(request: RomeAppApiRequest): JsonBody<T> {
  if (!request.body || request.body.byteLength === 0) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(request.body)) as T };
  } catch {
    return { ok: false, reason: "parse_error" };
  }
}

function weekdayToRruleDay(value?: string): string {
  const normalized = (value ?? "MO").toUpperCase();
  const allowed = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  return allowed.has(normalized) ? normalized : "MO";
}

function buildRrule(frequency: Frequency, weekday?: string, custom?: string): string {
  if (frequency === "daily") return "FREQ=DAILY";
  if (frequency === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  if (frequency === "weekly") return `FREQ=WEEKLY;BYDAY=${weekdayToRruleDay(weekday)}`;
  const trimmed = custom?.trim();
  if (!trimmed?.startsWith("FREQ=")) throw new Error("custom_rrule_required");
  return trimmed;
}

function assertTime(value: string): void {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("invalid_time");
  const [h, m] = value.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error("invalid_time");
}

function reportPdfRelativePath(reportId: string): string {
  return `reports/${reportId}/pdf`;
}

function buildPdfDownloadUrl(origin: string | undefined, reportId: string): string | null {
  if (!origin) return null;
  return `${origin.replace(/\/+$/, "")}/api/apps/stock-daily/${reportPdfRelativePath(reportId)}`;
}

function serializeReport(
  report: ReturnType<ReturnType<typeof createStockDailyRepository>["getReport"]>,
  origin: string | undefined,
) {
  if (!report) return report;
  const pdfAvailable = Boolean(report.pdfPath && existsSync(report.pdfPath));
  return {
    ...report,
    sources: report.sourcesJson ? safeJsonArray(report.sourcesJson) : [],
    pdfAvailable,
    pdfDownloadPath: pdfAvailable ? reportPdfRelativePath(report.id) : null,
    pdfDownloadUrl: pdfAvailable ? buildPdfDownloadUrl(origin, report.id) : null,
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

class StockDailyApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");
    const repo = createStockDailyRepository(this.ctx.db);

    // Capture only shareable origins for out-of-band code paths (email). A
    // local dashboard request must not poison future messages with 127.0.0.1.
    const origin = downloadOriginForRequest(request);
    const shareableOrigin = shareableOriginForRequest(request);
    if (shareableOrigin) {
      const stored = repo.getSetting(SETTING_KEY_PUBLIC_ORIGIN);
      if (stored !== shareableOrigin) {
        try {
          repo.setSetting(SETTING_KEY_PUBLIC_ORIGIN, shareableOrigin);
        } catch {
          // Best-effort persistence — never fail a request because of it.
        }
      }
    }

    if (
      request.method === "GET" &&
      (request.path.length === 0 || (request.path.length === 1 && request.path[0] === "dashboard"))
    ) {
      const activeSchedule = repo.getActiveSchedule();
      const reports = repo.listReports(Number(request.query.get("limit") ?? "12"));
      const routines = await this.ctx.listRoutines().catch(() => []);
      const appInfo = this.ctx.app as { id?: string; appId?: string; version?: string };
      const savedCustomPrompt = repo.getCustomPrompt();
      return json({
        appId: appInfo.id ?? appInfo.appId ?? "stock-daily",
        version: appInfo.version ?? "0.1.0",
        publicOrigin: origin ?? null,
        activeSchedule,
        customPrompt: savedCustomPrompt ?? null,
        customPromptMaxLength: CUSTOM_PROMPT_MAX_LENGTH,
        reports: reports.map((report) => serializeReport(report, origin)),
        scheduledEvents: routines
          // Routines created by this app are bound to its report action. Match
          // on actionName rather than a name prefix: the routine's display name
          // is now human-readable ("Stock Daily report (...)"), while the
          // stock-daily-report-<id> identifier lives on the routine key.
          .filter((routine) => routine.actionName === "stock-daily_generate_report")
          .map((routine) => {
            const trigger = routine.trigger.type === "schedule" ? routine.trigger : null;
            return {
              id: routine.id,
              name: routine.name,
              enabled: routine.enabled,
              nextRunAt: routine.nextRunAt,
              localTime: trigger?.localTime ?? null,
              tzid: trigger?.tzid ?? null,
              rrule: trigger?.rrule ?? null,
            };
          }),
      });
    }

    if (request.method === "GET" && request.path[0] === "reports" && request.path.length === 2) {
      const report = repo.getReport(request.path[1]);
      if (!report) return json({ error: "not_found" }, { status: 404 });
      return json({ report: serializeReport(report, origin) });
    }

    if (
      request.method === "GET" &&
      request.path[0] === "reports" &&
      request.path.length === 3 &&
      request.path[2] === "pdf"
    ) {
      const report = repo.getReport(request.path[1]);
      if (!report) return json({ error: "not_found" }, { status: 404 });
      const pdfPath = report.pdfPath ?? getPdfPathForReport(report.id);
      if (!pdfPath || !existsSync(pdfPath)) {
        return json(
          { error: "pdf_not_available", message: report.pdfError ?? "PDF has not been generated yet" },
          { status: 404 },
        );
      }
      const buffer = readFileSync(pdfPath);
      const stats = statSync(pdfPath);
      const filenameSafe = `stock-daily-${report.reportDate}.pdf`;
      const filenameUtf8 = encodeURIComponent(`${report.title || filenameSafe}.pdf`);
      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(stats.size),
          "Content-Disposition": `attachment; filename="${filenameSafe}"; filename*=UTF-8''${filenameUtf8}`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }

    if (request.method === "POST" && route === "schedule") {
      const parsed = readJsonBody<SaveScheduleBody>(request);
      if (!parsed.ok) return json({ error: parsed.reason }, { status: 400 });

      try {
        const body = parsed.value;
        const enabled = body.enabled !== false;
        const tzid = body.tzid?.trim() || "America/Los_Angeles";
        const localTime = body.localTime?.trim() || "13:30";
        const frequency = body.frequency || "weekdays";
        assertTime(localTime);
        const rrule = buildRrule(frequency, body.weekday, body.rrule);
        const emailRecipient = body.emailRecipient?.trim() || null;
        if (emailRecipient && !isValidEmailAddress(emailRecipient)) {
          return json({ error: "invalid_email_recipient" }, { status: 400 });
        }
        const now = new Date();
        const id = crypto.randomUUID();
        const eventName = `stock-daily-report-${id}`;

        // Capture the routine backing the schedule we're about to replace, so
        // we can tear it down after deactivating its DB row — otherwise the old
        // recurring routine keeps firing alongside the new one.
        const previous = repo.getActiveSchedule();

        repo.deactivateActiveSchedules(now);
        repo.createSchedule({
          id,
          enabled,
          tzid,
          localTime,
          frequency,
          weekday: body.weekday,
          rrule,
          eventName: enabled ? eventName : null,
          sendEmail: body.sendEmail === true,
          emailRecipient,
          notes: body.notes?.slice(0, 1000),
          createdAt: now,
          updatedAt: now,
        });

        // Best-effort teardown of the previous routine. A failure (already gone,
        // in-flight run) must not block saving the new schedule.
        if (previous?.eventId) {
          try {
            await this.ctx.runAction("delete_routine", { routineId: previous.eventId });
          } catch {
            // ignore — the new schedule below is the source of truth
          }
        }

        let eventId: string | undefined;
        if (enabled) {
          // The platform `schedule_event` action was replaced by the routine
          // engine. A recurring stock report is zone-anchored (it tracks a
          // market session at a fixed wall-clock time), so the trigger pins the
          // timezone with tzMode "fixed" rather than following the guardian.
          const result = await this.ctx.runAction("create_routine", {
            name: `Stock Daily report (${frequency} ${localTime} ${tzid})`,
            key: eventName,
            trigger: {
              type: "schedule",
              tzid,
              tzMode: "fixed",
              localTime,
              rrule,
            },
            actionName: "stock-daily_generate_report",
            args: { scheduleId: id, manual: false },
          });
          if (result.status !== "ok") {
            throw new Error(
              result.status === "error" ? result.error : "create_routine did not complete",
            );
          }
          const data = result.data as { routineId?: string } | undefined;
          eventId = data?.routineId;
          repo.updateSchedule(id, { eventId, updatedAt: new Date() });
        }

        return json({ schedule: repo.getSchedule(id), eventId });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }

    if (request.method === "POST" && route === "trigger") {
      const active = repo.getActiveSchedule();
      const body = readJsonBody<{ reportDate?: string; customPrompt?: string }>(request);
      const reportDate = body.ok ? body.value.reportDate : undefined;
      // Only forward customPrompt when the caller actually supplied the key.
      // Omitting the key lets the action fall back to the saved custom prompt;
      // sending "" explicitly disables the saved prompt for this run.
      const args: Record<string, unknown> = {
        manual: true,
        scheduleId: active?.id,
        reportDate,
      };
      if (body.ok && typeof body.value.customPrompt === "string") {
        args.customPrompt = body.value.customPrompt.slice(0, CUSTOM_PROMPT_MAX_LENGTH);
      }
      const result = await this.ctx.runAction("stock-daily_generate_report", args);
      if (result.status !== "ok") {
        return json(
          { error: result.status === "error" ? result.error : "report generation did not complete" },
          { status: 500 },
        );
      }
      return json(result.data);
    }

    if (request.method === "GET" && route === "custom-prompt") {
      return json({
        customPrompt: repo.getCustomPrompt() ?? null,
        maxLength: CUSTOM_PROMPT_MAX_LENGTH,
      });
    }

    if (request.method === "POST" && route === "custom-prompt") {
      const parsed = readJsonBody<{ customPrompt?: string | null }>(request);
      if (!parsed.ok) return json({ error: parsed.reason }, { status: 400 });
      try {
        const incoming = parsed.value.customPrompt;
        if (incoming != null && typeof incoming !== "string") {
          return json({ error: "invalid_custom_prompt" }, { status: 400 });
        }
        repo.setCustomPrompt(incoming ?? null);
        return json({
          customPrompt: repo.getCustomPrompt() ?? null,
          maxLength: CUSTOM_PROMPT_MAX_LENGTH,
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }

    return json({ error: "not_found", message: `Unknown Stock Daily API route: /${route}` }, { status: 404 });
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new StockDailyApiHandler(ctx);
}
