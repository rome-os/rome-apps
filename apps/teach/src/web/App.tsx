import "./styles.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  buildAssetUrl,
  getCurrentAppPath,
  isPreview,
  navigateToApp,
  startChat,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Flame,
  GraduationCap,
  Loader2,
  MessagesSquare,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxGroup } from "@/components/ui/combobox";
import {
  api,
  type DashboardData,
  type Lesson,
  type LessonSummary,
  type MissionView,
  type ModuleView,
  type ResourceItem,
} from "@/lib/api";
// Base lesson typography/component CSS — the SAME source the runtime uses. We
// inline it statically into the iframe srcdoc so the first paint is correctly
// styled (no serif FOUC) while the heavier runtime JS loads and progressively
// adds highlighting / mermaid / interactivity.
import { RUNTIME_CSS } from "./lesson-runtime/styles";

// ── Lesson iframe runtime bridge ────────────────────────────────────────────
// Lessons render inside a sandboxed iframe (`allow-scripts`, null origin) as a
// self-contained interactive document. A separate "lesson runtime" bundle
// (dist/web/lesson-runtime.js — built by rslib.config.ts as a classic IIFE so a
// null-origin sandbox can load it cross-origin) does syntax highlighting
// (Shiki), Mermaid diagrams, and component hydration inside the frame, and talks
// to this host over postMessage.

// Host theme tokens forwarded into the iframe so the lesson matches Rome's
// light/dark theme. Rome names surface/background tokens WITHOUT a `--color-`
// prefix (e.g. --background, --card, --surface-muted, --surface-hover) while
// text and a few accents use `--color-*`. The lesson runtime CSS references the
// `--color-*` names, so for each one we resolve whichever host token actually
// carries the value — to a CONCRETE rgb (so nested var()/oklch resolve and the
// value survives crossing into the iframe) — and re-emit it under the
// `--color-*` name. Each entry is [runtimeName, [host candidates…], literalFallback].
const COLOR_TOKENS: [string, string[], string][] = [
  ["--color-background", ["--color-background", "--background"], "#ffffff"],
  ["--color-foreground", ["--color-foreground", "--foreground"], "#1a130f"],
  ["--color-card", ["--color-card", "--card"], "#ffffff"],
  ["--color-card-foreground", ["--color-card-foreground", "--card-foreground", "--color-foreground", "--foreground"], "#1a130f"],
  ["--color-muted-foreground", ["--color-muted-foreground", "--muted-foreground"], "#6b7280"],
  ["--color-border", ["--color-border", "--border"], "#e5e7eb"],
  ["--color-border-strong", ["--color-border-strong", "--border-strong", "--color-border", "--border"], "#d1d5db"],
  ["--color-brand", ["--color-brand", "--brand", "--color-primary", "--primary"], "#c2410c"],
  ["--color-brand-foreground", ["--color-brand-foreground", "--brand-foreground", "--color-primary-foreground", "--primary-foreground"], "#ffffff"],
  ["--color-secondary", ["--color-secondary", "--secondary", "--color-surface-muted", "--surface-muted"], "#f3f3f1"],
  ["--color-secondary-foreground", ["--color-secondary-foreground", "--secondary-foreground", "--color-foreground", "--foreground"], "#1a130f"],
  ["--color-surface-muted", ["--color-surface-muted", "--surface-muted", "--color-muted", "--muted"], "#f3f3f1"],
  ["--color-surface-muted-foreground", ["--color-surface-muted-foreground", "--surface-muted-foreground", "--color-muted-foreground", "--muted-foreground"], "#4b5563"],
  ["--color-surface-hover", ["--color-surface-hover", "--surface-hover"], "rgba(127,127,127,0.12)"],
  ["--color-success-bg", ["--color-success-bg", "--success-bg"], "#ecfdf5"],
  ["--color-success-border", ["--color-success-border", "--success-border"], "#6ee7b7"],
  ["--color-success-fg", ["--color-success-fg", "--success-fg", "--success-foreground"], "#047857"],
  ["--color-destructive-bg", ["--color-destructive-bg", "--destructive-bg"], "#fef2f2"],
  ["--color-destructive-border", ["--color-destructive-border", "--destructive-border"], "#fecaca"],
  ["--color-destructive-fg", ["--color-destructive-fg", "--destructive-fg", "--destructive-foreground"], "#b91c1c"],
];

// Non-color tokens (radii, fonts) — forwarded verbatim; no probe needed.
const RAW_TOKENS: [string, string[]][] = [
  ["--radius-sm", ["--radius-sm"]],
  ["--radius-md", ["--radius-md"]],
  ["--radius-lg", ["--radius-lg"]],
  ["--font-sans", ["--font-sans"]],
  ["--font-mono", ["--font-mono"]],
  ["--font-serif", ["--font-serif"]],
];

// Resolve a custom-property fallback chain to a CONCRETE color by painting it on
// a probe and reading back the computed `color` (which is always concrete rgb).
function resolveColor(el: Element, candidates: string[], fallback: string): string {
  const expr = candidates.reduceRight((acc, name) => `var(${name}, ${acc})`, fallback);
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;left:-9999px;top:-9999px;color:${expr}`;
  el.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  el.removeChild(probe);
  return rgb || fallback;
}

function readThemeCss(el: Element): string {
  const cs = getComputedStyle(el);
  const colors = COLOR_TOKENS.map(
    ([name, cands, fallback]) => `${name}:${resolveColor(el, cands, fallback)};`,
  );
  const raws = RAW_TOKENS.map(([name, cands]) => {
    for (const c of cands) {
      const v = cs.getPropertyValue(c).trim();
      if (v) return `${name}:${v};`;
    }
    return "";
  });
  return colors.concat(raws).join("");
}

// Detect whether the host theme is dark. Primary signal: Rome toggles a `dark`
// class (and/or a *dark* data-theme) on <html>. Fallback: infer from the
// resolved foreground luminance — a LIGHT foreground implies a dark theme.
// (The old probe read --color-background, which Rome does not define under that
// name, so it always reported light and the iframe never went dark.)
function detectDark(el: Element): boolean {
  const root = el.ownerDocument?.documentElement;
  if (root) {
    if (root.classList.contains("dark")) return true;
    const dt = (root.getAttribute("data-theme") || "").toLowerCase();
    if (dt.includes("dark")) return true;
    if (root.classList.contains("light")) return false;
  }
  const fg = resolveColor(el, ["--color-foreground", "--foreground"], "#000");
  const m = /rgba?\(([^)]+)\)/.exec(fg);
  if (!m) return false;
  const [r, g, b] = m[1].split(",").map((n) => parseFloat(n));
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.5;
}

// Absolute URL to the lesson runtime script. The iframe srcdoc has a null
// origin and an about:srcdoc base, so a root-relative path won't resolve —
// prepend the host origin. Classic <script src> is not subject to CORS.
function lessonRuntimeUrl(): string {
  try {
    const u = buildAssetUrl("lesson-runtime.js");
    if (/^https?:\/\//.test(u)) return u;
    return (typeof window !== "undefined" ? window.location.origin : "") + u;
  } catch {
    return "";
  }
}

function escapeForScript(html: string): string {
  // The lesson body is placed verbatim in the iframe document; only guard
  // against a literal </script> inside any author <script> closing our wrapper.
  return html.replace(/<\/script>/gi, "<\\/script>");
}

function buildLessonSrcDoc(
  html: string,
  cssText: string,
  dark: boolean,
  runtimeUrl: string,
): string {
  const script = runtimeUrl ? `<script src="${runtimeUrl}"></script>` : "";
  return (
    `<!doctype html><html${dark ? ' class="dark"' : ""}><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style id="teach-theme">:root{${cssText}}</style>` +
    // Static base CSS so the lesson is correctly styled on first paint, before
    // the runtime JS (which now skips re-injecting this) finishes loading.
    `<style id="teach-runtime-css">${RUNTIME_CSS}</style>` +
    `</head><body>` +
    `<div id="teach-lesson-root" class="lesson-prose">${escapeForScript(html)}</div>` +
    script +
    `</body></html>`
  );
}

// ── Chat-based review ──────────────────────────────────────────────────────────
// Launch a real webchat session with the tutor agent that conducts the
// spaced-repetition review conversationally. The tutor follows the
// `quiz-in-chat` skill — which pulls due cards and quizzes one at a time through
// the interactive ask_question card, judged server-side — so this only needs to
// state the intent. Composes the SDK's startChat(); no dedicated endpoint needed.
async function launchChatReview(missionTitle?: string): Promise<void> {
  const scope = missionTitle
    ? `for my "${missionTitle}" mission`
    : "across all my missions";
  const message = `Quiz me on what's due ${scope}.`;
  await startChat({ agentName: "tutor", message, navigate: true });
}

// Launch a chat session where the tutor interviews the learner to set up a new
// mission (what + why + level) and lays out the syllabus — the conversational
// counterpart of the dashboard's New-mission form. The flow is owned by the
// `setup-in-chat` skill (invoked via skillName): it interviews one question at a
// time through the interactive ask_question card, then hands the learner back to
// the Teach app to start lessons — it does NOT teach in chat.
async function launchChatNewMission(): Promise<void> {
  const message = "I want to set up a new learning mission.";
  await startChat({
    agentName: "tutor",
    skillName: "setup-in-chat",
    message,
    navigate: true,
  });
}

function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "due" | "done" | "draft";
}) {
  const toneClass =
    tone === "due"
      ? "bg-warning-bg text-warning-fg border-warning-border"
      : tone === "done"
        ? "bg-success-bg text-success-fg border-success-border"
        : tone === "draft"
          ? "bg-muted text-muted-foreground border-border"
          : "bg-secondary text-secondary-foreground border-border";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

function ErrorNote({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive-border bg-destructive-bg px-3 py-2 text-sm text-destructive-fg">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button className="text-xs underline opacity-80" onClick={onDismiss}>
          dismiss
        </button>
      )}
    </div>
  );
}

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

// The single app-global notification channel options (per-mission overrides
// were removed). Mirrors the teach_update_settings action's allowed set.
const NOTIFY_CHANNELS = [
  "webchat",
  "email",
  "wechat",
  "whatsapp",
  "telegram",
  "discord",
] as const;

// Full IANA timezone list for the Settings picker — sourced from the platform's
// own Intl data so we never hand-maintain it (falls back to a common subset on
// engines without Intl.supportedValuesOf). Grouped by region for the dropdown.
const TIMEZONES: string[] = (() => {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof supported === "function") return supported("timeZone");
  } catch {
    /* fall through */
  }
  return [
    "UTC",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Australia/Sydney",
  ];
})();

function groupTimezones(zones: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const z of zones) {
    const region = z.includes("/") ? z.slice(0, z.indexOf("/")) : "Other";
    const list = groups.get(region) ?? [];
    list.push(z);
    groups.set(region, list);
  }
  return [...groups.entries()];
}

// ── App ───────────────────────────────────────────────────────────────────────
type View =
  | { name: "overview" }
  | { name: "mission"; missionId: string; autoplan?: boolean };

// Deep linking: the in-app sub-path under the host's app route base
// (`/apps/teach/...`) is the source of truth for which view is shown, so a
// mission is directly addressable — e.g. `/apps/teach/mission/<id>`. This lets
// the tutor hand the learner a link straight to the mission they just set up.
function pathToView(path: string): View {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "mission" && segments[1]) {
    return { name: "mission", missionId: decodeURIComponent(segments[1]) };
  }
  return { name: "overview" };
}

function viewToPath(view: View): string {
  return view.name === "mission" ? `mission/${view.missionId}` : "";
}

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Initialize the view from the current URL so deep links (and refreshes) land
  // on the right mission. Guard for non-browser/preview where the path helper
  // may be unavailable.
  const [view, setView] = useState<View>(() => {
    try {
      return pathToView(getCurrentAppPath());
    } catch {
      return { name: "overview" };
    }
  });

  // Navigate the app: update local view state AND push the matching sub-path to
  // the host URL so the view is shareable/bookmarkable and back/forward works.
  const goTo = useCallback((next: View) => {
    setView(next);
    try {
      navigateToApp(viewToPath(next));
    } catch {
      /* no-op outside a real host (tests/SSR) */
    }
  }, []);

  // React to host-driven navigation (back/forward, links into the app). Skip
  // when the destination already matches the current view so a programmatic
  // navigateToApp (which also fires this) doesn't clobber transient flags like
  // `autoplan`.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeToAppPath((path) => {
        const next = pathToView(path);
        setView((prev) => (viewToPath(prev) === viewToPath(next) ? prev : next));
      });
    } catch {
      /* no-op outside a real host */
    }
    return () => unsub?.();
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.dashboard();
      setDashboard(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-screen-md px-4 py-6 md:px-6 md:py-8">
        <Header
          dashboard={dashboard}
          onHome={() => goTo({ name: "overview" })}
          onRefresh={loadDashboard}
          refreshing={loading}
        />

        {error && (
          <div className="mt-4">
            <ErrorNote message={error} onDismiss={() => setError(null)} />
          </div>
        )}

        <div className="mt-6">
          {view.name === "overview" && (
            <Overview
              dashboard={dashboard}
              loading={loading}
              onOpenMission={(id, autoplan) => goTo({ name: "mission", missionId: id, autoplan })}
              onChanged={loadDashboard}
            />
          )}
          {view.name === "mission" && (
            <MissionDetail
              key={view.missionId}
              missionId={view.missionId}
              autoplan={view.autoplan}
              mission={dashboard?.missions.find((m) => m.id === view.missionId) ?? null}
              onBack={() => goTo({ name: "overview" })}
              onChanged={loadDashboard}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({
  dashboard,
  onHome,
  onRefresh,
  refreshing,
}: {
  dashboard: DashboardData | null;
  onHome: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const due = dashboard?.totals.due ?? 0;
  const streak = dashboard?.streak ?? 0;
  return (
    <header className="flex flex-wrap items-center gap-3">
      <button className="flex items-center gap-2" onClick={onHome}>
        <GraduationCap className="size-6 text-brand" />
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Teach</h1>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-sm text-muted-foreground">
          <Flame className="size-4 text-brand" />
          {streak} day{streak === 1 ? "" : "s"}
        </span>
        {!isPreview() && (
          <Button
            variant={due > 0 ? "default" : "secondary"}
            size="sm"
            onClick={() => void launchChatReview()}
            title="Get quizzed by the tutor in a chat session"
          >
            <MessagesSquare className="size-4" />
            Quiz me in chat{due > 0 ? ` (${due})` : ""}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          aria-label="Refresh"
          disabled={refreshing}
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </header>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function Overview({
  dashboard,
  loading,
  onOpenMission,
  onChanged,
}: {
  dashboard: DashboardData | null;
  loading: boolean;
  onOpenMission: (id: string, autoplan?: boolean) => void;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (loading && !dashboard) return <Spinner label="Loading your learning workspace…" />;

  const missions = dashboard?.missions ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-muted-foreground">Missions</h2>
        <div className="flex items-center gap-2">
          {!isPreview() && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void launchChatNewMission()}
              title="Let the tutor interview you and set up a mission in chat"
            >
              <MessagesSquare className="size-4" />
              Set up in chat
            </Button>
          )}
          <Button
            size="sm"
            variant={showSettings ? "secondary" : "ghost"}
            onClick={() => setShowSettings((v) => !v)}
            title="App settings"
          >
            <Settings className="size-4" />
            Settings
          </Button>
          <Button
            size="sm"
            variant={showForm ? "secondary" : "default"}
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus className="size-4" />
            New mission
          </Button>
        </div>
      </div>

      {showSettings && dashboard && (
        <SettingsPanel dashboard={dashboard} onSaved={onChanged} />
      )}

      {showForm && (
        <CreateMissionForm
          onCreated={(missionId) => {
            setShowForm(false);
            onChanged();
            // Honor "auto-generate the syllabus after creation": jump straight
            // into the new mission, which kicks off planning on arrival.
            onOpenMission(missionId, true);
          }}
        />
      )}

      {missions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No missions yet. Create one to start learning — say what you want to learn and why.
          </p>
          {!isPreview() && (
            <div className="mt-4 flex justify-center">
              <Button size="sm" onClick={() => void launchChatNewMission()}>
                <MessagesSquare className="size-4" />
                Set up a mission in chat
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {missions.map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              onOpen={() => onOpenMission(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MissionCard({
  mission,
  onOpen,
}: {
  mission: MissionView;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <button className="text-left" onClick={onOpen}>
          <h3 className="font-semibold leading-tight">{mission.title}</h3>
        </button>
        <Badge>{mission.targetLevel}</Badge>
      </div>
      {mission.motivation && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{mission.motivation}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {mission.completedCount}/{mission.lessonCount} lessons done
        </span>
        <span>· {mission.cardCount} cards</span>
        {mission.dueCount > 0 && <Badge tone="due">{mission.dueCount} due</Badge>}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onOpen}>
          <BookOpen className="size-4" />
          Open
        </Button>
        {mission.dueCount > 0 && !isPreview() && (
          <Button
            size="sm"
            onClick={() => void launchChatReview(mission.title)}
            title="Get quizzed on this mission in a chat session"
          >
            <MessagesSquare className="size-4" />
            Quiz me in chat
          </Button>
        )}
      </div>
    </div>
  );
}

function CreateMissionForm({ onCreated }: { onCreated: (missionId: string) => void }) {
  const [title, setTitle] = useState("");
  const [motivation, setMotivation] = useState("");
  const [level, setLevel] = useState<string>("beginner");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setErr("A title is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const { mission } = await api.createMission({
        title: title.trim(),
        motivation: motivation.trim() || undefined,
        target_level: level,
        notes: notes.trim() || undefined,
      });
      onCreated(mission.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {err && <ErrorNote message={err} onDismiss={() => setErr(null)} />}
      <label className="block">
        <span className="mb-1 block text-sm text-muted-foreground">What do you want to learn?</span>
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Rust ownership"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted-foreground">Why? (your motivation)</span>
        <textarea
          className={`${inputCls} resize-y`}
          rows={2}
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          placeholder="e.g. to ship a CLI tool without fighting the borrow checker"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted-foreground">Target level</span>
        <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted-foreground">
          Notes / preferences (optional)
        </span>
        <textarea
          className={`${inputCls} resize-y`}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. prefer worked examples; I already know C"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Create mission
        </Button>
      </div>
    </div>
  );
}

// Build grouped Combobox options for the timezone picker (region heading +
// city label, keeping an unknown stored value selectable).
function timezoneGroups(current: string): ComboboxGroup[] {
  const zones = current && !TIMEZONES.includes(current) ? [current, ...TIMEZONES] : TIMEZONES;
  return groupTimezones(zones).map(([region, list]) => ({
    heading: region,
    options: list.map((z) => ({
      value: z,
      label: z.includes("/") ? z.slice(z.indexOf("/") + 1).replace(/_/g, " ") : z,
    })),
  }));
}

// ── Settings panel ──────────────────────────────────────────────────────────────
// One app-global Settings surface: the single notification channel for review
// nudges, the daily review time + timezone, and whether the daily routine runs.
function SettingsPanel({
  dashboard,
  onSaved,
}: {
  dashboard: DashboardData;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState(dashboard.settings.defaultNotifyChannel);
  const [time, setTime] = useState(dashboard.settings.dailyReviewTime);
  const [timezone, setTimezone] = useState(dashboard.settings.timezone);
  const [enabled, setEnabled] = useState(dashboard.reviewRoutine.enabled);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const inputCls =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const save = async () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setErr("Review time must be HH:mm (e.g. 09:00).");
      return;
    }
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await api.updateSettings({
        notify_channel: channel,
        daily_review_time: time,
        timezone: timezone.trim() || undefined,
        review_enabled: enabled,
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Settings className="size-4 text-brand" />
        <h3 className="font-semibold leading-tight">Settings</h3>
      </div>
      {err && <ErrorNote message={err} onDismiss={() => setErr(null)} />}

      <div className="block">
        <span className="mb-1 block text-sm text-muted-foreground">Notification channel</span>
        <Select
          value={channel}
          onValueChange={(v) => {
            setChannel(v);
            setSaved(false);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a channel" />
          </SelectTrigger>
          <SelectContent>
            {NOTIFY_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="mt-1 block text-xs text-muted-foreground">
          Where review nudges are sent. Applies to every mission.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-muted-foreground">Daily review time</span>
          <input
            className={inputCls}
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <div className="block">
          <span className="mb-1 block text-sm text-muted-foreground">Timezone</span>
          <Combobox
            value={timezone}
            onChange={(tz) => {
              setTimezone(tz);
              setSaved(false);
            }}
            groups={timezoneGroups(timezone)}
            placeholder="Select a timezone"
            searchPlaceholder="Search timezone…"
            emptyText="No timezone found."
          />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
        />
        <span className="text-sm">Send a daily review reminder</span>
      </label>

      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}

// ── Mission detail (syllabus roadmap) ──────────────────────────────────────────
function MissionDetail({
  missionId,
  autoplan,
  mission,
  onBack,
  onChanged,
}: {
  missionId: string;
  autoplan?: boolean;
  mission: MissionView | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [modules, setModules] = useState<ModuleView[] | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);
  const [loadingLessonId, setLoadingLessonId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [showInsert, setShowInsert] = useState(false);
  const [topic, setTopic] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const autoplanTried = useRef(false);

  const load = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([api.lessons(missionId), api.resources(missionId)]);
      setModules(l.modules);
      setLessons(l.lessons);
      setResources(r.resources);
      return l;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [missionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const planOutline = useCallback(
    async (regen: boolean) => {
      setPlanning(true);
      setErr(null);
      try {
        const res = await api.generateOutline(missionId, regen);
        await load();
        onChanged();
        if (!res.planned) {
          setErr(
            `Couldn't design the syllabus${res.error ? `: ${res.error}` : "."} You can retry.`,
          );
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setPlanning(false);
      }
    },
    [missionId, load, onChanged],
  );

  // Auto-generate the syllabus on first arrival from mission creation, when the
  // mission is genuinely empty (no modules and no lessons yet).
  useEffect(() => {
    if (!autoplan || autoplanTried.current) return;
    if (modules === null || lessons === null) return; // wait for first load
    autoplanTried.current = true;
    if (modules.length === 0 && lessons.length === 0) {
      void planOutline(false);
    }
  }, [autoplan, modules, lessons, planOutline]);

  const openLessonById = async (id: string) => {
    setLoadingLessonId(id);
    setErr(null);
    try {
      const { lesson } = await api.lesson(id);
      setOpenLesson(lesson);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLessonId(null);
    }
  };

  // Realize a planned/draft lesson just-in-time, then open it. A ready/completed
  // lesson just opens.
  const openOrRealize = async (l: LessonSummary) => {
    if (l.status === "published" || l.status === "completed") {
      await openLessonById(l.id);
      return;
    }
    setGeneratingId(l.id);
    setErr(null);
    try {
      const res = await api.generateLesson(missionId, { lessonId: l.id });
      await load();
      onChanged();
      if (!res.generated) {
        setErr(
          `Couldn't finish this lesson${res.error ? `: ${res.error}` : "."} It's saved as a draft — try again.`,
        );
      } else {
        await openLessonById(res.lesson.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingId(null);
    }
  };

  const insertCustom = async () => {
    if (!topic.trim()) return;
    setGeneratingId("__custom__");
    setErr(null);
    try {
      const res = await api.generateLesson(missionId, { topic: topic.trim() });
      setTopic("");
      setShowInsert(false);
      await load();
      onChanged();
      if (!res.generated) {
        setErr(
          `Lesson saved as a draft — generation didn't fully complete${res.error ? `: ${res.error}` : "."}`,
        );
      } else {
        await openLessonById(res.lesson.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingId(null);
    }
  };

  if (openLesson) {
    return (
      <LessonViewer
        lesson={openLesson}
        onBack={() => setOpenLesson(null)}
        onCompleted={async () => {
          setOpenLesson(null);
          await load();
          onChanged();
        }}
      />
    );
  }

  const ordered = lessons ? [...lessons].sort((a, b) => a.seq - b.seq) : [];
  const total = ordered.length;
  const completed = ordered.filter((l) => l.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  // The "focus" lesson: the first not-yet-completed lesson in sequence.
  const nextLesson = ordered.find((l) => l.status !== "completed") ?? null;
  const hasOutline = (modules?.length ?? 0) > 0 || total > 0;
  const busyId = generatingId ?? loadingLessonId;

  // Group lessons under their module, preserving order; collect any module-less
  // lessons (legacy or custom inserts) into a trailing "Other" group.
  const moduleList = modules ? [...modules].sort((a, b) => a.seq - b.seq) : [];
  const lessonsByModule = new Map<string, LessonSummary[]>();
  const looseLessons: LessonSummary[] = [];
  for (const l of ordered) {
    if (l.moduleId && moduleList.some((m) => m.id === l.moduleId)) {
      const arr = lessonsByModule.get(l.moduleId) ?? [];
      arr.push(l);
      lessonsByModule.set(l.moduleId, arr);
    } else {
      looseLessons.push(l);
    }
  }

  return (
    <div className="space-y-5">
      <button
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" /> All missions
      </button>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{mission?.title ?? "Mission"}</h2>
          {mission && <Badge>{mission.targetLevel}</Badge>}
        </div>
        {mission?.motivation && (
          <p className="mt-1 text-sm text-muted-foreground">{mission.motivation}</p>
        )}
        {mission?.notes && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface-muted p-2 text-sm text-surface-muted-foreground">
            {mission.notes}
          </p>
        )}

        {/* Progress */}
        {hasOutline && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {completed} / {total} lessons done
              </span>
              <span>{pct}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {hasOutline && nextLesson && !isPreview() && (
            <Button
              size="sm"
              onClick={() => void openOrRealize(nextLesson)}
              disabled={!!busyId || planning}
              title={
                nextLesson.status === "published" || nextLesson.status === "completed"
                  ? "Open the next lesson"
                  : "Generate and open the next lesson"
              }
            >
              {generatingId === nextLesson.id || loadingLessonId === nextLesson.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {completed === 0 ? "Start learning" : "Continue"}
            </Button>
          )}
          {mission && mission.dueCount > 0 && !isPreview() && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void launchChatReview(mission.title)}
              title="Get quizzed on this mission in a chat session"
            >
              <MessagesSquare className="size-4" /> Quiz me in chat ({mission.dueCount} due)
            </Button>
          )}
        </div>
      </div>

      {err && <ErrorNote message={err} onDismiss={() => setErr(null)} />}

      {/* Planning state / empty state */}
      {modules === null || lessons === null ? (
        <Spinner label="Loading syllabus…" />
      ) : planning ? (
        <div className="rounded-xl border border-border bg-card px-4 py-8 text-center">
          <Spinner label="Designing your syllabus — this can take a minute…" />
        </div>
      ) : !hasOutline ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No syllabus yet. Generate a learning plan to get a module-by-module roadmap.
          </p>
          {!isPreview() && (
            <div className="mt-4 flex justify-center">
              <Button size="sm" onClick={() => void planOutline(false)}>
                <Wand2 className="size-4" /> Plan my syllabus
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Roadmap: modules → lessons */}
          {moduleList.map((m) => (
            <ModuleSection
              key={m.id}
              module={m}
              lessons={lessonsByModule.get(m.id) ?? []}
              nextLessonId={nextLesson?.id ?? null}
              busyId={busyId}
              disabled={!!busyId || planning}
              onPick={openOrRealize}
            />
          ))}
          {looseLessons.length > 0 && (
            <ModuleSection
              module={null}
              lessons={looseLessons}
              nextLessonId={nextLesson?.id ?? null}
              busyId={busyId}
              disabled={!!busyId || planning}
              onPick={openOrRealize}
            />
          )}

          {/* Plan controls */}
          {!isPreview() && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (
                    window.confirm(
                      "Re-generate the whole syllabus? This clears lessons you haven't started yet (started and completed lessons are kept).",
                    )
                  ) {
                    void planOutline(true);
                  }
                }}
                disabled={!!busyId || planning}
                title="Redesign the plan from scratch"
              >
                <RefreshCw className="size-4" /> Regenerate syllabus
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowInsert((v) => !v)}
                disabled={!!busyId || planning}
              >
                <Plus className="size-4" /> Insert a custom lesson
              </Button>
            </div>
          )}

          {showInsert && !isPreview() && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Topic for a one-off lesson (added at the end)"
                  disabled={generatingId === "__custom__"}
                />
                <Button
                  onClick={() => void insertCustom()}
                  disabled={generatingId === "__custom__" || !topic.trim()}
                  className="shrink-0"
                >
                  {generatingId === "__custom__" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {generatingId === "__custom__" ? "Generating…" : "Generate"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {resources.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Resources</h3>
          <ul className="space-y-1.5">
            {resources.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand underline"
                  >
                    {r.title}
                  </a>
                ) : (
                  <span className="font-medium">{r.title}</span>
                )}
                {r.note && <span className="ml-2 text-muted-foreground">— {r.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// A module heading with its lessons rendered as roadmap rows.
function ModuleSection({
  module,
  lessons,
  nextLessonId,
  busyId,
  disabled,
  onPick,
}: {
  module: ModuleView | null;
  lessons: LessonSummary[];
  nextLessonId: string | null;
  busyId: string | null;
  disabled: boolean;
  onPick: (l: LessonSummary) => void;
}) {
  return (
    <div>
      {module ? (
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">
            <span className="text-muted-foreground">Module {module.seq} · </span>
            {module.title}
          </h3>
        </div>
      ) : (
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Other lessons</h3>
      )}
      {module?.objective && (
        <p className="mb-2 text-xs text-muted-foreground">{module.objective}</p>
      )}
      <ul className="space-y-1.5">
        {lessons.map((l) => (
          <LessonRow
            key={l.id}
            lesson={l}
            isNext={l.id === nextLessonId}
            busyId={busyId}
            disabled={disabled}
            onPick={() => onPick(l)}
          />
        ))}
      </ul>
    </div>
  );
}

function LessonRow({
  lesson: l,
  isNext,
  busyId,
  disabled,
  onPick,
}: {
  lesson: LessonSummary;
  isNext: boolean;
  busyId: string | null;
  disabled: boolean;
  onPick: () => void;
}) {
  const busy = busyId === l.id;
  const isPlanned = l.status === "planned";
  const isDraft = l.status === "draft";
  const icon = busy ? (
    <Loader2 className="size-4 animate-spin text-brand" />
  ) : l.status === "completed" ? (
    <CheckCircle2 className="size-4 text-success-fg" />
  ) : l.status === "published" ? (
    <CircleDot className="size-4 text-brand" />
  ) : (
    <Circle className="size-4 text-muted-foreground" />
  );

  return (
    <li>
      <button
        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-surface-hover disabled:opacity-60 ${
          isNext ? "border-brand bg-surface-hover" : "border-border bg-card"
        }`}
        onClick={onPick}
        disabled={disabled}
        title={
          isPlanned
            ? "Generate and open this lesson"
            : isDraft
              ? "Generation didn't finish — try again"
              : "Open lesson"
        }
      >
        <span className="shrink-0">{icon}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {String(l.seq).padStart(2, "0")}
        </span>
        <span className={`min-w-0 flex-1 ${isPlanned ? "text-muted-foreground" : ""}`}>
          <span className="block truncate font-medium">{l.title}</span>
          {l.objective && (
            <span className="block truncate text-xs text-muted-foreground">{l.objective}</span>
          )}
        </span>
        {isNext && !busy ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            <Play className="size-3" /> {isPlanned ? "Generate" : "Continue"}
          </span>
        ) : l.status === "completed" ? (
          <Badge tone="done">done</Badge>
        ) : l.status === "published" ? (
          <Badge>ready</Badge>
        ) : isDraft ? (
          <Badge tone="draft">retry</Badge>
        ) : (
          <Badge tone="draft">planned</Badge>
        )}
      </button>
    </li>
  );
}

function LessonViewer({
  lesson,
  onBack,
  onCompleted,
}: {
  lesson: Lesson;
  onBack: () => void;
  onCompleted: () => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(360);
  // The lesson reveals only once its runtime reports content height has settled
  // (fonts, Shiki, Mermaid, images all landed) via "teach:ready". Until then we
  // show a loader instead of a frame that visibly grows in steps.
  const [ready, setReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isDraft = lesson.status === "draft";

  const complete = useCallback(async () => {
    setCompleting(true);
    setErr(null);
    try {
      await api.completeLesson(lesson.id);
      onCompleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setCompleting(false);
    }
  }, [lesson.id, onCompleted]);

  // Build the iframe srcdoc once per lesson, snapshotting the host theme at open
  // time. Theme changes after that are pushed live via postMessage rather than
  // rebuilding the srcdoc (a rebuild reloads the iframe and re-inits Shiki).
  useLayoutEffect(() => {
    if (isDraft) {
      setSrcDoc(null);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    setReady(false);
    setHeight(360);
    setSrcDoc(
      buildLessonSrcDoc(lesson.html, readThemeCss(el), detectDark(el), lessonRuntimeUrl()),
    );
  }, [lesson.html, isDraft]);

  // Fallback: reveal anyway if "ready" never arrives (e.g. a runtime error), so
  // the lesson is never stuck behind the loader.
  useEffect(() => {
    if (!srcDoc || ready) return;
    const t = window.setTimeout(() => setReady(true), 5000);
    return () => window.clearTimeout(t);
  }, [srcDoc, ready]);

  // Receive height + complete events from the lesson runtime. The runtime
  // measures content height (ResizeObserver) so we size the iframe to fit with
  // no inner scrollbar.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as { type?: string; height?: number } | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "teach:height" && typeof d.height === "number") {
        setHeight(Math.max(120, Math.ceil(d.height)));
      } else if (d.type === "teach:ready") {
        setReady(true);
      } else if (d.type === "teach:complete") {
        void complete();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [complete]);

  // Push host theme changes into the live iframe so the lesson re-themes without
  // a reload.
  useEffect(() => {
    if (!srcDoc) return;
    const el = wrapRef.current;
    if (!el) return;
    const push = () => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        { type: "teach:theme", cssText: readThemeCss(el), dark: detectDark(el) },
        "*",
      );
    };
    const obs = new MutationObserver(push);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    mq?.addEventListener?.("change", push);
    return () => {
      obs.disconnect();
      mq?.removeEventListener?.("change", push);
    };
  }, [srcDoc]);

  return (
    <div className="space-y-4">
      <button
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" /> Back to lessons
      </button>

      <div className="rounded-xl border border-border bg-card p-5 md:p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{lesson.title}</h2>
            {lesson.objective && (
              <p className="mt-1 text-sm text-muted-foreground">{lesson.objective}</p>
            )}
          </div>
          {lesson.status === "completed" && <Badge tone="done">done</Badge>}
        </div>

        {isDraft ? (
          <div className="mt-4">
            <ErrorNote
              message={
                lesson.errorNote ??
                "This lesson is still a draft — generation didn't complete. Try generating again."
              }
            />
          </div>
        ) : (
          // The lesson body is a self-contained interactive HTML document from
          // our lesson-author agent, rendered inside a sandboxed iframe. The
          // lesson runtime (loaded inside the frame) highlights code, renders
          // diagrams, hydrates components, and reports height back here.
          <div ref={wrapRef} className="relative mt-5">
            {!ready && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-card text-sm text-muted-foreground"
                style={{ minHeight: 240 }}
              >
                <Loader2 className="size-4 animate-spin" />
                Loading lesson…
              </div>
            )}
            <iframe
              ref={iframeRef}
              title={lesson.title}
              sandbox="allow-scripts"
              srcDoc={srcDoc ?? undefined}
              scrolling="no"
              style={{
                width: "100%",
                border: 0,
                height,
                display: "block",
                overflow: "hidden",
                opacity: ready ? 1 : 0,
                transition: "opacity 150ms ease",
              }}
            />
          </div>
        )}
      </div>

      {err && <ErrorNote message={err} onDismiss={() => setErr(null)} />}

      {lesson.status !== "completed" && !isDraft && (
        <div className="flex justify-end">
          <Button onClick={() => void complete()} disabled={completing}>
            {completing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Mark complete
          </Button>
        </div>
      )}
    </div>
  );
}
