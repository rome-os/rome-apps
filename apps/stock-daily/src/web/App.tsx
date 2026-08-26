import "./styles.css";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  fetchAppApi,
  getBootstrap,
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Mail,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  TrendingUp,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Types ────────────────────────────────────────────────────────────────────

type Frequency = "daily" | "weekdays" | "weekly" | "custom";

interface ScheduleRecord {
  id: string;
  enabled: boolean;
  tzid: string;
  localTime: string;
  frequency: Frequency;
  weekday?: string | null;
  rrule: string;
  eventName?: string | null;
  eventId?: string | null;
  sendEmail?: boolean;
  emailRecipient?: string | null;
  updatedAt: string | number | Date;
}

interface ReportRecord {
  id: string;
  scheduleId?: string | null;
  status: "in_progress" | "completed" | "failed" | string;
  triggerType: string;
  reportDate: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  error?: string | null;
  sources?: string[];
  pdfPath?: string | null;
  pdfSizeBytes?: number | null;
  pdfError?: string | null;
  pdfAvailable?: boolean;
  pdfDownloadPath?: string | null;
  pdfDownloadUrl?: string | null;
  createdAt: string | number | Date;
  completedAt?: string | number | Date | null;
}

interface ScheduledEventSummary {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt?: string | number | Date | null;
  localTime: string;
  tzid: string;
  rrule?: string | null;
}

interface DashboardData {
  appId: string;
  version: string;
  activeSchedule?: ScheduleRecord | null;
  customPrompt?: string | null;
  customPromptMaxLength?: number;
  reports: ReportRecord[];
  scheduledEvents: ScheduledEventSummary[];
}

const DEFAULT_CUSTOM_PROMPT_MAX = 8000;

// ── Utils ────────────────────────────────────────────────────────────────────

function normalize(value: DashboardData): DashboardData {
  return {
    ...value,
    reports: Array.isArray(value.reports) ? value.reports : [],
    scheduledEvents: Array.isArray(value.scheduledEvents) ? value.scheduledEvents : [],
  };
}

function formatDate(value?: string | number | Date | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function frequencyLabel(freq?: string, weekday?: string | null): string {
  if (freq === "daily") return "Daily";
  if (freq === "weekdays") return "Weekdays";
  if (freq === "weekly") return `Weekly on ${weekday ?? "MO"}`;
  if (freq === "custom") return "Custom RRULE";
  return "Not configured";
}

function triggerLabel(value: string): string {
  if (value === "manual") return "Manual";
  if (value === "schedule" || value === "scheduled") return "Scheduled";
  return value;
}

function buildPdfDownloadUrl(
  report: Pick<ReportRecord, "id" | "pdfDownloadPath" | "pdfDownloadUrl">,
): string {
  // Inside the app UI, prefer the current authenticated app API base. Absolute
  // URLs are still exposed by the API for out-of-band messages, but opening
  // those from a local dashboard can require a separate hosted-domain login.
  const bootstrap = getBootstrap();
  const sub = report.pdfDownloadPath ?? `reports/${report.id}/pdf`;
  if (sub) return `${bootstrap.apiBase}/${sub.replace(/^\/+/, "")}`;
  if (report.pdfDownloadUrl) return report.pdfDownloadUrl;
  return `${bootstrap.apiBase}/reports/${report.id}/pdf`;
}

function formatBytes(value?: number | null): string {
  if (!value || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Status badge (narrow categorical-color exception, per guideline §1) ─────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    in_progress:
      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  const labels: Record<string, string> = {
    completed: "Completed",
    in_progress: "Generating",
    failed: "Failed",
  };
  const cls = styles[status] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ── Markdown (react-markdown + remark-gfm, token-styled components) ─────────

function MarkdownView({ content }: { content: string }) {
  return (
    <div className="space-y-4 text-sm leading-7 text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 text-lg font-semibold text-foreground">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold text-foreground">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-3 text-sm font-semibold text-muted-foreground">{children}</h4>
          ),
          p: ({ children }) => <p className="text-foreground/90">{children}</p>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1.5 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children, className }) => {
            const isBlock = (className || "").includes("language-");
            if (isBlock) {
              return (
                <code className="font-mono text-xs">{children}</code>
              );
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted text-muted-foreground">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-t first:border-t-0">{children}</tr>,
          th: ({ children, style }) => (
            <th className="px-3 py-2 font-medium" style={style}>
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td className="px-3 py-2 align-top" style={style}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Routing helpers ─────────────────────────────────────────────────────────

type Route =
  | { name: "list" }
  | { name: "detail"; id: string };

function pathToRoute(path: string): Route {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { name: "list" };
  const segments = trimmed.split("/");
  if (segments[0] === "reports" && segments[1]) {
    return { name: "detail", id: decodeURIComponent(segments[1]) };
  }
  return { name: "list" };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => pathToRoute(getCurrentAppPath()));
  useEffect(
    () =>
      subscribeToAppPath((path) => {
        setRoute(pathToRoute(path));
      }),
    [],
  );
  return route;
}

// ── Shared form-control classes (inlined per reference app) ─────────────────

const INPUT_CLS =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const LABEL_CLS = "text-xs font-medium text-muted-foreground";

const DEFAULT_FORM = {
  enabled: true,
  tzid: "America/Los_Angeles",
  localTime: "13:30",
  frequency: "weekdays" as Frequency,
  weekday: "MO",
  rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  sendEmail: false,
  emailRecipient: "",
};

const COMMON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/Los_Angeles", label: "America/Los_Angeles · Pacific Time" },
  { value: "America/New_York", label: "America/New_York · Eastern Time" },
  { value: "America/Chicago", label: "America/Chicago · Central Time" },
  { value: "America/Denver", label: "America/Denver · Mountain Time" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "Europe/London · London" },
  { value: "Europe/Berlin", label: "Europe/Berlin · Berlin" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai · Shanghai" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo · Tokyo" },
  { value: "Asia/Singapore", label: "Asia/Singapore · Singapore" },
];

// ── Toggle switch (button-backed, styled) ───────────────────────────────────

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ── Section header (used inside the settings card) ─────────────────────────

function SectionHeader({
  icon,
  title,
  control,
}: {
  icon: ReactNode;
  title: string;
  control?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {control}
    </div>
  );
}

// ── On/off state tag (shown on the settings card header) ───────────────────

function StateTag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        on
          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          on ? "bg-green-600 dark:bg-green-400" : "bg-muted-foreground/50"
        }`}
      />
      {label} {on ? "on" : "off"}
    </span>
  );
}

// ── Settings card: custom prompt + schedule + notification ─────────────────

function SettingsCard({
  form,
  setForm,
  saving,
  onSave,
  customPrompt,
  onCustomPromptChange,
  savedCustomPrompt,
  customPromptMaxLength,
  loading,
  clearing,
  onLoadCustomPrompt,
  onClearCustomPrompt,
}: {
  form: typeof DEFAULT_FORM;
  setForm: (next: typeof DEFAULT_FORM) => void;
  saving: boolean;
  onSave: () => void;
  customPrompt: string;
  onCustomPromptChange: (next: string) => void;
  savedCustomPrompt: string;
  customPromptMaxLength: number;
  loading: boolean;
  clearing: boolean;
  onLoadCustomPrompt: () => void;
  onClearCustomPrompt: () => void;
}) {
  const hasSaved = savedCustomPrompt.trim().length > 0;
  const dirty = customPrompt !== savedCustomPrompt;
  const overLimit = customPrompt.length > customPromptMaxLength;
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <CardHeader className={open ? "pb-3" : undefined}>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Settings
            </span>
            <span className="flex items-center gap-2">
              <StateTag on={form.enabled} label="Scheduled run" />
              <StateTag on={form.sendEmail} label="Email" />
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </span>
          </CardTitle>
        </CardHeader>
      </button>
      {open && (
      <CardContent>
        <div className="space-y-6">
          {/* 1 · Custom prompt */}
          <section className="space-y-3">
            <SectionHeader
              icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
              title="Custom Prompt"
            />
            <textarea
              className={`${INPUT_CLS} min-h-[120px] resize-y font-mono leading-relaxed`}
              placeholder="Example: Focus on NVDA after-hours moves and add a short watchlist for tomorrow; include a brief note on China ADRs."
              value={customPrompt}
              onChange={(e) => onCustomPromptChange(e.target.value)}
              disabled={loading}
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className={overLimit ? "text-destructive" : undefined}>
                  {customPrompt.length} / {customPromptMaxLength}
                </span>
                {hasSaved ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                    Saved{dirty ? " · current text differs from saved" : ""}
                  </span>
                ) : (
                  <span>No saved custom prompt</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLoadCustomPrompt}
                  disabled={loading || !hasSaved}
                  title="Load the saved prompt into the editor above"
                >
                  <Upload />
                  Load saved
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearCustomPrompt}
                  disabled={loading || clearing || (!hasSaved && customPrompt.length === 0)}
                  title="Clear the editor and delete the saved prompt"
                >
                  {clearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Clear
                </Button>
              </div>
            </div>
            {overLimit ? (
              <p className="text-xs text-destructive">
                Prompt exceeds the length limit. Keep it within {customPromptMaxLength} characters.
              </p>
            ) : null}
          </section>

          <hr className="border-border" />

          {/* 2 · Scheduled run */}
          <section className="space-y-3">
            <SectionHeader
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
              title="Scheduled Run"
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(next) => setForm({ ...form, enabled: next })}
                  label="Enable scheduled report"
                />
              }
            />
            <div
              className={`grid grid-cols-1 gap-4 md:grid-cols-5 ${
                form.enabled ? "" : "pointer-events-none opacity-50"
              }`}
            >
              <div className="space-y-1 md:col-span-2">
                <label className={LABEL_CLS}>Timezone</label>
                <select
                  className={INPUT_CLS}
                  value={form.tzid}
                  disabled={!form.enabled}
                  onChange={(e) => setForm({ ...form, tzid: e.target.value })}
                >
                  {COMMON_TIMEZONES.some((tz) => tz.value === form.tzid) ? null : (
                    <option value={form.tzid}>{form.tzid}</option>
                  )}
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className={LABEL_CLS}>Run time</label>
                <input
                  className={INPUT_CLS}
                  type="time"
                  value={form.localTime}
                  disabled={!form.enabled}
                  onChange={(e) => setForm({ ...form, localTime: e.target.value })}
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <label className={LABEL_CLS}>Frequency</label>
                <select
                  className={INPUT_CLS}
                  value={form.frequency}
                  disabled={!form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, frequency: e.target.value as Frequency })
                  }
                >
                  <option value="weekdays">Weekdays</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom RRULE</option>
                </select>
              </div>

              {form.frequency === "weekly" && (
                <div className="space-y-1 md:col-span-2">
                  <label className={LABEL_CLS}>Weekday</label>
                  <select
                    className={INPUT_CLS}
                    value={form.weekday}
                    disabled={!form.enabled}
                    onChange={(e) => setForm({ ...form, weekday: e.target.value })}
                  >
                    <option value="MO">Monday</option>
                    <option value="TU">Tuesday</option>
                    <option value="WE">Wednesday</option>
                    <option value="TH">Thursday</option>
                    <option value="FR">Friday</option>
                    <option value="SA">Saturday</option>
                    <option value="SU">Sunday</option>
                  </select>
                </div>
              )}

              {form.frequency === "custom" && (
                <div className="space-y-1 md:col-span-5">
                  <label className={LABEL_CLS}>RRULE</label>
                  <input
                    className={`${INPUT_CLS} font-mono`}
                    value={form.rrule}
                    disabled={!form.enabled}
                    onChange={(e) => setForm({ ...form, rrule: e.target.value })}
                  />
                </div>
              )}
            </div>
          </section>

          <hr className="border-border" />

          {/* 3 · Notification */}
          <section className="space-y-3">
            <SectionHeader
              icon={<Mail className="h-4 w-4 text-muted-foreground" />}
              title="Notification"
              control={
                <Switch
                  checked={form.sendEmail}
                  onChange={(next) => setForm({ ...form, sendEmail: next })}
                  label="Send report by email"
                />
              }
            />
            {form.sendEmail && (
              <div className="space-y-1 md:max-w-md">
                <label className={LABEL_CLS}>Recipient email</label>
                <input
                  className={INPUT_CLS}
                  type="email"
                  placeholder="Leave empty to send to you (guardian)"
                  value={form.emailRecipient}
                  onChange={(e) => setForm({ ...form, emailRecipient: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to the guardian's email address when left empty.
                </p>
              </div>
            )}
          </section>

          <div className="flex justify-end border-t pt-4">
            <Button onClick={onSave} disabled={loading || saving || overLimit} size="sm">
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      </CardContent>
      )}
    </Card>
  );
}

// ── List view ───────────────────────────────────────────────────────────────

function ListView({
  data,
  loading,
  error,
  triggering,
  saving,
  form,
  setForm,
  onRefresh,
  onTrigger,
  onSaveSettings,
  onDismissError,
  customPrompt,
  setCustomPrompt,
  savedCustomPrompt,
  customPromptMaxLength,
  customPromptClearing,
  onLoadCustomPrompt,
  onClearCustomPrompt,
}: {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  triggering: boolean;
  saving: boolean;
  form: typeof DEFAULT_FORM;
  setForm: (next: typeof DEFAULT_FORM) => void;
  onRefresh: () => void;
  onTrigger: () => void;
  onSaveSettings: () => void;
  onDismissError: () => void;
  customPrompt: string;
  setCustomPrompt: (next: string) => void;
  savedCustomPrompt: string;
  customPromptMaxLength: number;
  customPromptClearing: boolean;
  onLoadCustomPrompt: () => void;
  onClearCustomPrompt: () => void;
}) {
  const reports = data?.reports ?? [];
  const nextEvent = data?.scheduledEvents.find((e) => e.enabled);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-1 h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Stock Daily</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              English US stock market daily close reports
              {data && (
                <span className="ml-1 text-xs">
                  · {reports.length} reports · Frequency{" "}
                  {frequencyLabel(data.activeSchedule?.frequency, data.activeSchedule?.weekday)}
                  {nextEvent ? ` · Next ${formatDate(nextEvent.nextRunAt)}` : ""}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onRefresh} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
          <Button onClick={onTrigger} disabled={triggering} size="sm">
            {triggering ? <Loader2 className="animate-spin" /> : <Play />}
            {triggering ? "Generating…" : "Generate manually"}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
          <button onClick={onDismissError} className="ml-3 shrink-0 text-xs underline">
            dismiss
          </button>
        </div>
      )}

      <div className="space-y-6">
        <SettingsCard
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={onSaveSettings}
          customPrompt={customPrompt}
          onCustomPromptChange={setCustomPrompt}
          savedCustomPrompt={savedCustomPrompt}
          customPromptMaxLength={customPromptMaxLength}
          loading={loading && !data}
          clearing={customPromptClearing}
          onLoadCustomPrompt={onLoadCustomPrompt}
          onClearCustomPrompt={onClearCustomPrompt}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Report History
            </CardTitle>
            <CardDescription>Click any row to view the full report.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading && !data ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : reports.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No reports yet. Click “Generate manually” in the header to create one.
              </p>
            ) : (
              <div className="-mx-2 divide-y">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-accent"
                  >
                    <button
                      type="button"
                      onClick={() => navigateToApp(`reports/${report.id}`)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{report.reportDate}</span>
                          <StatusBadge status={report.status} />
                          {report.pdfAvailable ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              <FileText className="h-3 w-3" />
                              PDF
                            </span>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            · {triggerLabel(report.triggerType)} ·{" "}
                            {formatDate(report.completedAt || report.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                          {report.summary || report.error || report.title}
                        </p>
                      </div>
                    </button>
                    {report.pdfAvailable ? (
                      <a
                        href={buildPdfDownloadUrl(report)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title={`Download PDF (${formatBytes(report.pdfSizeBytes)})`}
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </a>
                    ) : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

// ── Detail view ─────────────────────────────────────────────────────────────

function DetailView({ id }: { id: string }) {
  const [report, setReport] = useState<ReportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAppApi(`reports/${id}`);
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { report: ReportRecord };
      setReport(body.report ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToApp("")}
            className="-ml-2 mb-2 text-muted-foreground"
          >
            <ArrowLeft />
            Back to list
          </Button>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <TrendingUp className="h-5 w-5 text-primary" />
            {report?.title ?? (loading ? "Loading…" : "Report Details")}
          </h1>
          {report && (
            <p className="mt-1 text-sm text-muted-foreground">
              {triggerLabel(report.triggerType)} ·{" "}
              {formatDate(report.completedAt || report.createdAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {report && <StatusBadge status={report.status} />}
          {report?.pdfAvailable ? (
            <Button asChild variant="outline" size="sm" title={`Download PDF (${formatBytes(report.pdfSizeBytes)})`}>
              <a href={buildPdfDownloadUrl(report)} target="_blank" rel="noreferrer">
                <Download />
                Download PDF
              </a>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {report?.status === "completed" && !report?.pdfAvailable && report?.pdfError ? (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            PDF generation failed: {report.pdfError}
          </span>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-6">
          {loading && !report ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : !report ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">Report not found</p>
            </div>
          ) : report.status === "failed" ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-center gap-2 font-medium">
                <XCircle className="h-4 w-4 shrink-0" />
                Report generation failed
              </div>
              {report.error && (
                <p className="whitespace-pre-wrap text-destructive/90">{report.error}</p>
              )}
            </div>
          ) : report.status === "in_progress" ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Report generation is in progress. Data collection and verification may take a few minutes. Click Refresh to check progress.
            </div>
          ) : report.content ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                Report saved. Key facts include source links; unavailable datapoints are marked “No reliable data available”.
              </div>
              <MarkdownView content={report.content} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">Report content is empty</p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

// ── App root (routes between list and detail) ──────────────────────────────

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const route = useRoute();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  // Working copy of the custom prompt textarea. Independent from the persisted
  // value so the guardian can run one-shot prompts without saving.
  const [customPrompt, setCustomPrompt] = useState("");
  const [savedCustomPrompt, setSavedCustomPrompt] = useState("");
  const [customPromptMaxLength, setCustomPromptMaxLength] = useState(
    DEFAULT_CUSTOM_PROMPT_MAX,
  );
  const [customPromptSaving, setCustomPromptSaving] = useState(false);
  const [customPromptClearing, setCustomPromptClearing] = useState(false);
  // Track whether the textarea has been user-edited so a dashboard refresh
  // doesn't clobber unsaved input.
  const [customPromptTouched, setCustomPromptTouched] = useState(false);

  const handleCustomPromptChange = useCallback((next: string) => {
    setCustomPrompt(next);
    setCustomPromptTouched(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAppApi("dashboard?limit=50");
      if (!response.ok) throw new Error(await response.text());
      const next = normalize((await response.json()) as DashboardData);
      setData(next);
      if (next.activeSchedule) {
        setForm({
          enabled: next.activeSchedule.enabled,
          tzid: next.activeSchedule.tzid,
          localTime: next.activeSchedule.localTime,
          frequency: next.activeSchedule.frequency,
          weekday: next.activeSchedule.weekday ?? "MO",
          rrule: next.activeSchedule.rrule,
          sendEmail: next.activeSchedule.sendEmail === true,
          emailRecipient: next.activeSchedule.emailRecipient ?? "",
        });
      }
      const saved = next.customPrompt ?? "";
      setSavedCustomPrompt(saved);
      if (typeof next.customPromptMaxLength === "number") {
        setCustomPromptMaxLength(next.customPromptMaxLength);
      }
      // Only auto-fill the textarea if the user hasn't touched it yet.
      setCustomPrompt((prev) => (customPromptTouched ? prev : saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [customPromptTouched]);

  const saveCustomPrompt = useCallback(async () => {
    setCustomPromptSaving(true);
    setError(null);
    try {
      const response = await fetchAppApi("custom-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPrompt }),
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as {
        customPrompt: string | null;
        maxLength?: number;
      };
      const saved = body.customPrompt ?? "";
      setSavedCustomPrompt(saved);
      setCustomPrompt(saved);
      setCustomPromptTouched(false);
      if (typeof body.maxLength === "number") setCustomPromptMaxLength(body.maxLength);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomPromptSaving(false);
    }
  }, [customPrompt]);

  const loadCustomPrompt = useCallback(() => {
    setCustomPrompt(savedCustomPrompt);
    setCustomPromptTouched(false);
  }, [savedCustomPrompt]);

  const clearCustomPrompt = useCallback(async () => {
    setCustomPromptClearing(true);
    setError(null);
    try {
      const response = await fetchAppApi("custom-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPrompt: null }),
      });
      if (!response.ok) throw new Error(await response.text());
      setSavedCustomPrompt("");
      setCustomPrompt("");
      setCustomPromptTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomPromptClearing(false);
    }
  }, []);

  const saveSchedule = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetchAppApi("schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await response.text());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  // Single "Save settings": persist the custom prompt first, then the
  // schedule + notification config. Errors from either surface via setError.
  const saveSettings = useCallback(async () => {
    await saveCustomPrompt();
    await saveSchedule();
  }, [saveCustomPrompt, saveSchedule]);

  const triggerNow = useCallback(async () => {
    setTriggering(true);
    setError(null);
    try {
      // Always send the textarea contents (possibly "") so the run uses
      // exactly what's on screen. An empty string explicitly disables the
      // saved prompt for this single run.
      const response = await fetchAppApi("trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPrompt }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { reportId?: string };
      await load();
      if (result.reportId) navigateToApp(`reports/${result.reportId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggering(false);
    }
  }, [customPrompt, load]);

  useEffect(() => {
    void load();
  }, [load]);

  if (route.name === "detail") {
    return <DetailView id={route.id} />;
  }

  return (
    <ListView
      data={data}
      loading={loading}
      error={error}
      triggering={triggering}
      saving={saving || customPromptSaving}
      form={form}
      setForm={setForm}
      onRefresh={() => void load()}
      onTrigger={() => void triggerNow()}
      onSaveSettings={() => void saveSettings()}
      onDismissError={() => setError(null)}
      customPrompt={customPrompt}
      setCustomPrompt={handleCustomPromptChange}
      savedCustomPrompt={savedCustomPrompt}
      customPromptMaxLength={customPromptMaxLength}
      customPromptClearing={customPromptClearing}
      onLoadCustomPrompt={loadCustomPrompt}
      onClearCustomPrompt={() => void clearCustomPrompt()}
    />
  );
}
