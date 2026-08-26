import "./styles.css";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { fetchAppApi, type RomeAppBootstrap } from "@rome-os/app-web-sdk";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Copy,
  Hash,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DigestConfig {
  id: string;
  name: string;
  channel: string;
  threadId: string;
  windowHours: number;
  style: string;
  sendAsBot: boolean;
  active: boolean;
  tzid: string;
  localTime: string;
  rrule: string;
  scheduleNote: string | null;
  githubRepos: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastScheduledAt: string | null;
}

interface DigestRun {
  id: string;
  configId: string | null;
  channel: string;
  threadId: string;
  windowHours: number;
  status: string;
  sent: boolean;
  summary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface AppState {
  configs: DigestConfig[];
  runs: DigestRun[];
}

interface DeleteDigestResponse {
  success?: boolean;
  error?: string;
  routineIds?: string[];
  deletedRoutineIds?: string[];
  routineDeleteFailures?: Array<{ routineId: string; error: string }>;
}

interface ChannelStatus {
  discord?: {
    configured: boolean;
    botUsername: string | null;
    guardianLinked?: boolean;
  };
}

const schedulePresets = [
  { label: "Daily", rrule: "FREQ=DAILY;INTERVAL=1", help: "Every morning." },
  { label: "Weekdays", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", help: "Mon–Fri rhythm." },
  { label: "Weekly", rrule: "FREQ=WEEKLY;INTERVAL=1", help: "A slower recap." },
];

const fieldClass =
  "w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-2.5 text-sm shadow-inner shadow-slate-100/60 outline-none ring-indigo-200 transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4";

function shortDate(value?: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusClass(status: string): string {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function scheduleLabel(config: DigestConfig): string {
  if (config.scheduleNote) return config.scheduleNote;
  return "Not scheduled";
}

const fallbackTimezones = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const timezoneOptions: string[] = (() => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const supported = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : null;
  return supported && supported.length > 0 ? supported : fallbackTimezones;
})();

function rruleLabel(rrule: string): string {
  return schedulePresets.find((preset) => preset.rrule === rrule)?.label ?? "Custom";
}

function renderWithIntegrationsLink(message: string): React.ReactNode {
  const target = "Settings → Integrations";
  const index = message.indexOf(target);
  if (index === -1) return message;
  return (
    <>
      {message.slice(0, index)}
      <a className="font-semibold underline hover:text-rose-900" href="/settings/integrations">
        {target}
      </a>
      {message.slice(index + target.length)}
    </>
  );
}

function describeWorking(working: string | null, configs: DigestConfig[]): string | null {
  if (!working) return null;
  const [op, id] = working.split(":");
  const config = id ? configs.find((c) => c.id === id) : undefined;
  const name = config?.name ?? "digest";
  switch (op) {
    case "save":
      return "Saving your digest settings…";
    case "preview":
      return `Reading recent messages and drafting a preview for "${name}"… this usually takes 10–30 seconds.`;
    case "send":
      return `Posting "${name}" to Discord…`;
    case "schedule":
      return `Creating the recurring schedule for "${name}"…`;
    case "delete":
      return `Removing "${name}" and any recurring schedules…`;
    default:
      return "Working…";
  }
}

const setupSteps = [
  {
    icon: Bot,
    title: "Connect Discord",
    body: (
      <>
        In <a className="font-semibold text-white underline" href="/settings/channels">Settings → Channels</a>, connect the bot and invite it to your server with <span className="font-medium text-white">View Channel</span>, <span className="font-medium text-white">Read History</span>, and <span className="font-medium text-white">Send Messages</span>.
      </>
    ),
  },
  {
    icon: Hash,
    title: "Add a channel",
    body: (
      <>
        Right-click the channel in Discord → <span className="font-medium text-white">Copy Channel ID</span>, then paste it into the form on the left along with a window and tone.
        <span className="mt-1.5 block rounded-lg bg-white/5 px-2 py-1.5 text-[11px] leading-4 text-slate-300">
          <span className="font-semibold text-white">Don't see "Copy Channel ID"?</span> Enable Developer Mode first.
          <span className="mt-1 block">
            <span className="font-medium text-white">Desktop / Web:</span> click the gear icon next to your username → <span className="font-medium text-white">Developer</span> → toggle <span className="font-medium text-white">Developer Mode</span> on.
          </span>
          <span className="mt-0.5 block">
            <span className="font-medium text-white">Mobile (iOS / Android):</span> <span className="font-medium text-white">Settings → App Settings → Advanced Settings</span> → toggle <span className="font-medium text-white">Developer Mode</span> on.
          </span>
        </span>
      </>
    ),
  },
  {
    icon: Sparkles,
    title: "Preview, then schedule",
    body: (
      <>
        Hit <span className="font-medium text-white">Preview</span> to see a draft, <span className="font-medium text-white">Send</span> to post it now, or <span className="font-medium text-white">Schedule</span> to run it daily/weekly on autopilot.
      </>
    ),
  },
];

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [state, setState] = useState<AppState>({ configs: [], runs: [] });
  const [channelStatus, setChannelStatus] = useState<ChannelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    threadId: string;
    windowHours: number;
    style: string;
    tzid: string;
    localTime: string;
    rrule: string;
    sendAsBot: boolean;
    githubRepos: string[];
  }>({
    name: "Team channel digest",
    threadId: "",
    windowHours: 24,
    style: "friendly, concise, and action-oriented",
    tzid: "Asia/Shanghai",
    localTime: "09:00",
    rrule: "FREQ=DAILY;INTERVAL=1",
    sendAsBot: true,
    githubRepos: [],
  });
  const [githubRepos, setGithubRepos] = useState<string[] | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [repoFilter, setRepoFilter] = useState("");

  const discordConnected = channelStatus?.discord?.configured !== false;
  const discordBotLabel = channelStatus?.discord?.botUsername ? `@${channelStatus.discord.botUsername}` : "Discord bot";
  const completedRuns = state.runs.filter((run) => run.status === "completed").length;
  const failedRuns = state.runs.filter((run) => run.status === "failed").length;
  const scheduledConfigs = state.configs.filter((config) => Boolean(config.scheduleNote)).length;

  const latestRunByConfig = useMemo(() => {
    const map = new Map<string, DigestRun>();
    for (const run of state.runs) {
      if (run.configId && !map.has(run.configId)) map.set(run.configId, run);
    }
    return map;
  }, [state.runs]);

  async function loadChannelStatus(): Promise<void> {
    try {
      const response = await fetch("/api/channels/status", { cache: "no-store" });
      if (!response.ok) return;
      setChannelStatus((await response.json()) as ChannelStatus);
    } catch {
      // The digest can still render if the dashboard status endpoint is unavailable.
    }
  }

  async function loadGithubRepos(): Promise<void> {
    setGithubLoading(true);
    setGithubError(null);
    try {
      const response = await fetchAppApi("github/repos");
      const payload = (await response.json()) as { repos?: string[]; warnings?: string[]; error?: string };
      if (!response.ok || payload.error) {
        setGithubError(payload.error ?? `Failed to list repos (status ${response.status})`);
        setGithubRepos([]);
        return;
      }
      setGithubRepos(payload.repos ?? []);
      if (payload.warnings && payload.warnings.length > 0) {
        setGithubError(`Some repos could not be listed: ${payload.warnings.join("; ")}`);
      }
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : String(err));
      setGithubRepos([]);
    } finally {
      setGithubLoading(false);
    }
  }

  async function loadState(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [response] = await Promise.all([fetchAppApi("state"), loadChannelStatus()]);
      const data = (await response.json()) as AppState;
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(): Promise<void> {
    setSaveError(null);
    if (!form.threadId.trim()) {
      setSaveError("Paste a Discord channel ID first. See the setup guide on the right.");
      return;
    }
    setWorking("save");
    setError(null);
    setNotice(null);
    try {
      const response = await fetchAppApi("configs", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save digest");
      setNotice(discordConnected
        ? "Saved. Preview it, then schedule once the tone looks right."
        : "Saved. Connect Discord in Settings → Channels, then come back to preview it.");
      setForm((current) => ({ ...current, threadId: "", githubRepos: [] }));
      await loadState();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  async function runConfig(id: string, send: boolean): Promise<void> {
    if (!discordConnected) {
      setError("Discord is not connected in Rome yet. Open Settings → Channels, connect Discord, invite the bot to the server, then try Preview again.");
      return;
    }
    setWorking(`${send ? "send" : "preview"}:${id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchAppApi(`configs/${id}/run`, {
        method: "POST",
        body: JSON.stringify({ send }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Digest run failed");
      setNotice(send ? "Digest sent to Discord." : "Preview generated and saved below.");
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  async function sendConfig(config: DigestConfig, latest: DigestRun | undefined): Promise<void> {
    if (!discordConnected) {
      setError("Discord is not connected in Rome yet. Open Settings → Channels, connect Discord, invite the bot to the server, then try Send again.");
      return;
    }

    const reusablePreview =
      latest && latest.configId === config.id && latest.status === "completed" && latest.summary && !latest.sent
        ? latest
        : null;

    // No fresh preview to reuse — generate and post in one step (old behavior).
    if (!reusablePreview) {
      await runConfig(config.id, true);
      return;
    }

    setWorking(`send:${config.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchAppApi(`configs/${config.id}/send`, {
        method: "POST",
        body: JSON.stringify({ runId: reusablePreview.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Could not send digest");
      setNotice("Sent the previewed digest to Discord — exactly what you saw above.");
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  async function scheduleConfig(id: string): Promise<void> {
    if (!discordConnected) {
      setError("Discord is not connected in Rome yet. Open Settings → Channels, connect Discord, invite the bot to the server, then schedule the digest.");
      return;
    }
    setWorking(`schedule:${id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchAppApi(`configs/${id}/schedule`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Could not schedule digest");
      const bound = payload.data?.binding?.bound;
      setNotice(
        bound
          ? "Schedule created. Future runs post to Discord automatically, and chatting in this channel now routes to the digest summarizer."
          : "Schedule created. Future runs will post to Discord automatically.",
      );
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  async function deleteConfig(config: DigestConfig): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${config.name}"?\n\nThis hides the digest, disables future digest runs, and removes any recurring schedule created for it. Run history stays available.`,
    );
    if (!confirmed) return;

    setWorking(`delete:${config.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchAppApi(`configs/${config.id}`, { method: "DELETE" });
      const payload = (await response.json()) as DeleteDigestResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Could not delete digest");

      const routineIds = payload.routineIds ?? [];
      const deletedRoutineIds = payload.deletedRoutineIds ?? [];
      const routineDeleteFailures = payload.routineDeleteFailures ?? [];
      if (routineDeleteFailures.length > 0) {
        setNotice(
          `Deleted "${config.name}" and made it inactive. ${routineDeleteFailures.length} schedule deletion${routineDeleteFailures.length === 1 ? "" : "s"} failed, but any remaining run will skip because the digest is inactive.`,
        );
      } else if (deletedRoutineIds.length > 0) {
        setNotice(`Deleted "${config.name}" and removed ${deletedRoutineIds.length} recurring schedule${deletedRoutineIds.length === 1 ? "" : "s"}.`);
      } else if (routineIds.length > 0) {
        setNotice(`Deleted "${config.name}" and removed the recurring schedule.`);
      } else {
        setNotice(`Deleted "${config.name}".`);
      }
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  useEffect(() => {
    void loadState();
  }, []);

  return (
    <main className="min-h-full overflow-hidden bg-[radial-gradient(circle_at_12%_0%,rgba(129,140,248,0.22),transparent_34%),radial-gradient(circle_at_90%_8%,rgba(56,189,248,0.18),transparent_30%),linear-gradient(180deg,#f8fbff_0%,#f6f7fb_52%,#eef2f7_100%)] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-5">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-xl shadow-indigo-100/50 backdrop-blur sm:p-6">
            <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-200/40 blur-3xl" />
            <div className="relative flex flex-col gap-5">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">
                  <Sparkles className="h-3.5 w-3.5" /> Discord Digest
                </div>
                <h1 className="mt-4 whitespace-nowrap text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl lg:text-4xl">
                  Summaries without the sprawl.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
                  Turn noisy Discord channels into short, scheduled recaps with preview, send, and run history in one calm workspace.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:min-w-80">
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 text-center shadow-sm">
                  <div className="text-2xl font-semibold">{state.configs.length}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">Digests</div>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 text-center shadow-sm">
                  <div className="text-2xl font-semibold">{scheduledConfigs}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">Scheduled</div>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 text-center shadow-sm">
                  <div className="text-2xl font-semibold">{completedRuns}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">Runs</div>
                </div>
              </div>
            </div>
          </div>

          {channelStatus?.discord?.configured === false && (
            <div className="rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900 shadow-sm">
              <div className="font-semibold">Discord is not connected.</div>
              <div className="mt-1 text-amber-800">
                Open <a className="font-semibold underline" href="/settings/channels">Settings → Channels</a>, connect the Discord bot adapter, invite the bot, then refresh.
              </div>
            </div>
          )}

          {channelStatus?.discord?.configured === true && (
            <div className="flex items-center justify-between gap-3 rounded-3xl border border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-800 shadow-sm">
              <span>Discord connected as <span className="font-semibold">{discordBotLabel}</span>.</span>
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            </div>
          )}

          {working && (
            <div className="flex items-center gap-3 rounded-3xl border border-indigo-200 bg-indigo-50/90 p-4 text-sm text-indigo-800 shadow-sm">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>{describeWorking(working, state.configs)}</span>
            </div>
          )}

          {(notice || error) && (
            <div
              className={`rounded-3xl border p-4 text-sm shadow-sm ${
                error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {error ?? notice}
            </div>
          )}

          <Card className="glass-card overflow-hidden border-white/70 shadow-xl shadow-slate-200/60">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-xl">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200"><Hash className="h-4 w-4" /></span>
                New digest
              </CardTitle>
              <CardDescription>Save once. Preview next. Schedule last.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</span>
                  <input
                    className={fieldClass}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel ID</span>
                  <input
                    className={fieldClass}
                    placeholder="123456789012345678"
                    value={form.threadId}
                    onChange={(event) => setForm({ ...form, threadId: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Window</span>
                  <select
                    className={fieldClass}
                    value={form.windowHours}
                    onChange={(event) => setForm({ ...form, windowHours: Number(event.target.value) })}
                  >
                    <option value={6}>Last 6 hours</option>
                    <option value={12}>Last 12 hours</option>
                    <option value={24}>Last 24 hours</option>
                    <option value={72}>Last 3 days</option>
                    <option value={168}>Last 7 days</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tone</span>
                  <input
                    className={fieldClass}
                    value={form.style}
                    onChange={(event) => setForm({ ...form, style: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time</span>
                  <input
                    type="time"
                    className={fieldClass}
                    value={form.localTime}
                    onChange={(event) => setForm({ ...form, localTime: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timezone</span>
                  <select
                    className={fieldClass}
                    value={form.tzid}
                    onChange={(event) => setForm({ ...form, tzid: event.target.value })}
                  >
                    {!timezoneOptions.includes(form.tzid) && (
                      <option value={form.tzid}>{form.tzid}</option>
                    )}
                    {timezoneOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {schedulePresets.map((preset) => (
                  <button
                    key={preset.rrule}
                    type="button"
                    onClick={() => setForm({ ...form, rrule: preset.rrule })}
                    className={`rounded-2xl border p-3 text-left transition ${
                      form.rrule === preset.rrule
                        ? "border-indigo-300 bg-indigo-50 text-indigo-800 shadow-sm shadow-indigo-100"
                        : "border-slate-200/80 bg-white/80 text-slate-700 hover:border-indigo-200 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                      {preset.label}
                      {form.rrule === preset.rrule && <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{preset.help}</div>
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">GitHub PR activity (optional)</div>
                    <div className="text-xs text-slate-500">Include recent pull requests from selected repos in the digest. Connect GitHub in <a className="underline" href="/settings/integrations">Settings → Integrations</a> first.</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadGithubRepos()}
                    disabled={githubLoading}
                    className="rounded-xl bg-white"
                  >
                    {githubLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Load repos
                  </Button>
                </div>
                {githubError && (
                  <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                    {renderWithIntegrationsLink(githubError)}
                  </div>
                )}
                {form.githubRepos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {form.githubRepos.map((slug) => (
                      <span key={slug} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-700">
                        {slug}
                        <button
                          type="button"
                          onClick={() => setForm((c) => ({ ...c, githubRepos: c.githubRepos.filter((s) => s !== slug) }))}
                          className="ml-1 text-indigo-500 hover:text-indigo-900"
                          aria-label={`Remove ${slug}`}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                {githubRepos && githubRepos.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <input
                      className={fieldClass}
                      placeholder="Filter repos…"
                      value={repoFilter}
                      onChange={(event) => setRepoFilter(event.target.value)}
                    />
                    <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white">
                      {githubRepos
                        .filter((slug) => slug.toLowerCase().includes(repoFilter.toLowerCase()))
                        .slice(0, 200)
                        .map((slug) => {
                          const checked = form.githubRepos.includes(slug);
                          return (
                            <label key={slug} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm last:border-b-0 hover:bg-slate-50">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setForm((c) => ({
                                    ...c,
                                    githubRepos: event.target.checked
                                      ? Array.from(new Set([...c.githubRepos, slug]))
                                      : c.githubRepos.filter((s) => s !== slug),
                                  }));
                                }}
                              />
                              <span className="font-mono text-xs">{slug}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                )}
                {githubRepos && githubRepos.length === 0 && !githubError && (
                  <div className="mt-2 text-xs text-slate-500">No accessible repos found. Make sure GitHub is connected.</div>
                )}
              </div>

              <div className="mt-5 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => void saveConfig()} disabled={working === "save"} className="rounded-xl bg-slate-950 shadow-lg shadow-slate-300 hover:bg-slate-800">
                    {working === "save" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                    Save digest
                  </Button>
                  {saveError ? (
                    <span className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700">
                      {saveError}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-500">Chosen cadence: {rruleLabel(form.rrule)} at {form.localTime}</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-white/70 shadow-xl shadow-slate-200/60">
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-4">
              <div>
                <CardTitle className="text-xl">Configured channels</CardTitle>
                <CardDescription>Each card is a digest workflow: preview, post, schedule, or remove.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadState()} disabled={loading} className="rounded-xl bg-white/80">
                <RefreshCw className={loading ? "animate-spin" : undefined} /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="scroll-panel scroll-panel--configured space-y-3">
              {state.configs.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
                  <div className="font-semibold text-slate-700">No digests yet</div>
                  <div className="mt-1">Fill out the form above to create your first digest. Once Discord is connected, you can <span className="font-medium text-slate-700">Preview</span> instantly, then <span className="font-medium text-slate-700">Schedule</span> it to run on autopilot.</div>
                </div>
              ) : (
                state.configs.map((config) => {
                  const latest = latestRunByConfig.get(config.id);
                  const configWorking = ["preview", "send", "schedule", "delete"].some(
                    (op) => working === `${op}:${config.id}`,
                  );
                  return (
                    <div key={config.id} className="rounded-3xl border border-slate-200/80 bg-white/85 p-4 shadow-sm transition hover:border-indigo-100 hover:shadow-md">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><MessageSquareText className="h-4 w-4" /></span>
                            <div className="font-semibold text-slate-950">{config.name}</div>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{config.windowHours}h</span>
                          </div>
                          <div className="mt-2 break-all font-mono text-xs text-slate-500">{config.threadId}</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1">{config.localTime} · {config.tzid}</span>
                            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">{scheduleLabel(config)}</span>
                            {latest && <span className="rounded-full bg-slate-100 px-2.5 py-1">Last: {shortDate(latest.completedAt ?? latest.createdAt)}</span>}
                            {config.githubRepos && config.githubRepos.length > 0 && (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                                GitHub: {config.githubRepos.length} repo{config.githubRepos.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void runConfig(config.id, false)}
                            disabled={!discordConnected || working === `preview:${config.id}`}
                            title={!discordConnected ? "Connect Discord in Settings → Channels first" : undefined}
                            className="rounded-xl bg-white"
                          >
                            {working === `preview:${config.id}` ? <Loader2 className="animate-spin" /> : <Sparkles />} Preview
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void sendConfig(config, latest)}
                            disabled={!discordConnected || working === `send:${config.id}`}
                            title={!discordConnected ? "Connect Discord in Settings → Channels first" : undefined}
                            className="rounded-xl bg-white"
                          >
                            {working === `send:${config.id}` ? <Loader2 className="animate-spin" /> : <Bot />} Send
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void scheduleConfig(config.id)}
                            disabled={!discordConnected || working === `schedule:${config.id}`}
                            title={!discordConnected ? "Connect Discord in Settings → Channels first" : undefined}
                            className="rounded-xl bg-slate-950 hover:bg-slate-800"
                          >
                            {working === `schedule:${config.id}` ? <Loader2 className="animate-spin" /> : <Clock3 />} Schedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void deleteConfig(config)}
                            disabled={working === `delete:${config.id}`}
                            className="rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          >
                            {working === `delete:${config.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
                          </Button>
                        </div>
                      </div>
                      {configWorking && (
                        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-800">
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          <span>{describeWorking(working, state.configs)}</span>
                        </div>
                      )}
                      {latest && (
                        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/90 p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(latest.status)}`}>{latest.status}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${latest.sent ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-700"}`}>
                              {latest.sent ? "Posted to Discord" : "Preview only"}
                            </span>
                            <span className="text-xs text-slate-500">{shortDate(latest.completedAt ?? latest.createdAt)}</span>
                            {latest.error && <span className="text-rose-600">Needs attention</span>}
                          </div>
                          {latest.summary && <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap text-slate-700">{latest.summary}</pre>}
                          {latest.error && <div className="mt-2 text-rose-700">{latest.error}</div>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <Card className="overflow-hidden border-0 bg-slate-950 text-white shadow-xl shadow-slate-300/60">
            <div className="h-1 bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-300" />
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-xl"><Copy className="h-5 w-5" /> Quick setup</CardTitle>
              <CardDescription className="text-slate-300">Three steps to your first scheduled digest.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="space-y-2.5">
                {setupSteps.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <li key={step.title} className="flex gap-3 rounded-2xl bg-white/5 p-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-indigo-200">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">
                          <span className="text-indigo-300">{index + 1}.</span> {step.title}
                        </div>
                        <div className="mt-0.5 text-xs leading-5 text-slate-300">{step.body}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-slate-300">
                <span className="font-semibold text-white">Tip:</span> previewing never posts — it just drafts a summary you can read here first.
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-white/70 shadow-xl shadow-slate-200/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Digest shape</CardTitle>
              <CardDescription>Short enough for one Discord message.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="rounded-3xl border border-slate-100 bg-white/80 p-4">
                <div className="font-semibold text-slate-900">Preview format</div>
                <pre className="mt-2 whitespace-pre-wrap text-slate-600">{`**Highlights**\n- Useful context.\n\n**Decisions**\n- What changed.\n\n**Open questions**\n- Follow-ups.`}</pre>
              </div>
              <p>It paraphrases, skips old bot digests, and says plainly when a channel was quiet.</p>
            </CardContent>
          </Card>

          <Card className="glass-card border-white/70 shadow-xl shadow-slate-200/60">
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-4">
              <div>
                <CardTitle className="text-xl">Recent runs</CardTitle>
                <CardDescription>{state.runs.length} total · {failedRuns} failed</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="scroll-panel scroll-panel--runs space-y-2">
              {state.runs.length === 0 ? (
                <p className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-5 text-center text-sm text-slate-500">
                  No runs yet. Hit <span className="font-medium text-slate-700">Preview</span> on a digest to see one here.
                </p>
              ) : (
                state.runs.map((run) => {
                  const owner = run.configId ? state.configs.find((c) => c.id === run.configId) : undefined;
                  return (
                    <div key={run.id} className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 text-sm shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(run.status)}`}>{run.status}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${run.sent ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-700"}`}>
                          {run.sent ? "Posted" : "Preview"}
                        </span>
                        <span className="text-[11px] text-slate-500">{run.windowHours}h window</span>
                      </div>
                      <div className="mt-1.5 truncate text-xs font-medium text-slate-700">{owner?.name ?? "Ad-hoc run"}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{shortDate(run.completedAt ?? run.createdAt)}</div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
