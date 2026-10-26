import "./styles.css";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  fetchAppApi,
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { Textarea } from "@rome-os/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@rome-os/ui/card";
import { Markdown } from "@rome-os/ui/markdown";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import {
  Search,
  Sparkles,
  History,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Globe2,
  FileSearch,
  Code2,
  Tags,
  KeyRound,
  FileText,
  Bell,
  PenLine,
  ShieldCheck,
  CheckCircle2,
  CircleAlert,
  CircleX,
  Loader2,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  Link2,
  Image,
  Timer,
  ListTree,
  X,
  type LucideIcon,
} from "lucide-react";
import type { PageCheck, Finding } from "../lib/page-check.js";
import type { SeoWorkflowSpec } from "../lib/workflows.js";
import type { SeoRun } from "../db/schema.js";

type RunSummary = Pick<
  SeoRun,
  | "id"
  | "kind"
  | "workflow"
  | "title"
  | "status"
  | "createdAt"
  | "completedAt"
  | "error"
>;
type Dashboard = {
  workflows: Record<string, SeoWorkflowSpec>;
  runs: RunSummary[];
};
const workflowIcons: Record<string, LucideIcon> = {
  audit_domain: Globe2,
  audit_page: FileSearch,
  check_technical: ShieldCheck,
  generate_schema: Code2,
  keyword_research: KeyRound,
  optimize_meta: Tags,
  report: FileText,
  setup_alert: Bell,
  write_content: PenLine,
};
const fieldNames: Record<string, string> = {
  source: "Page URL or content",
  domain: "Domain",
  keyword: "Target keyword",
  target: "Page URL or domain",
  schema_type: "Schema type",
  seed: "Seed keyword or topic",
  alert_type: "Alert type",
  type: "Type",
};
const active = (run: RunSummary | SeoRun) =>
  run.status === "running" || run.status === "pending";
const date = (value: number) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchAppApi(path, init);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Request failed. Please try again.");
  return body as T;
}
function Status({ status }: { status: string }) {
  const palette: Record<string, string> = {
    pass: "text-emerald-700 dark:text-emerald-400",
    completed: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    fail: "text-destructive",
    failed: "text-destructive",
    pending: "text-muted-foreground",
    running: "text-primary",
  };
  const Icon =
    status === "pass" || status === "completed"
      ? CheckCircle2
      : status === "warn"
        ? CircleAlert
        : status === "fail" || status === "failed"
          ? CircleX
          : Loader2;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${palette[status] || "text-muted-foreground"}`}
    >
      <Icon
        className={`h-3.5 w-3.5 ${status === "running" || status === "pending" ? "animate-spin" : ""}`}
      />
      {(
        {
          pass: "Pass",
          warn: "Review",
          fail: "Fix",
          pending: "Queued",
          running: "Running",
          completed: "Completed",
          failed: "Failed",
        } as Record<string, string>
      )[status] || status}
    </span>
  );
}
function Empty({
  icon: Icon = Search,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <div className="mb-4 rounded-lg border border-border bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-2 max-w-sm text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
function CopyButton({
  value,
  label = "Copy report",
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState("");
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("Copied");
        } catch {
          setState("Copy failed");
        }
        setTimeout(() => setState(""), 2000);
      }}
    >
      {state === "Copied" ? (
        <Check className="h-4 w-4" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      {state || label}
    </Button>
  );
}
function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}

export default function App({
  bootstrap: _bootstrap,
}: {
  bootstrap: RomeAppBootstrap;
}) {
  const [path, setPath] = useState(getCurrentAppPath());
  const [data, setData] = useState<Dashboard | null>(null);
  const [run, setRun] = useState<SeoRun | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pageTab, setPageTab] = useState("fixes");
  const parts = path.split("/").filter(Boolean);
  const runId = parts[0] === "runs" ? parts[1] : null;
  const workflow = parts[0] === "workflow" ? parts[1] : null;
  const tab =
    parts[0] === "history"
      ? "history"
      : parts[0] === "workflows" ||
          workflow ||
          (run?.kind === "workflow" && runId)
        ? "workflows"
        : "check";
  useEffect(() => subscribeToAppPath(setPath), []);
  useEffect(() => {
    setError("");
    setDetailError("");
    setConfirmDelete(false);
    setPageTab("fixes");
  }, [path]);
  const reload = useCallback(async () => {
    try {
      setData(await api<Dashboard>("dashboard"));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (document.hidden) return;
      await reload();
      if (runId)
        try {
          const detail = await api<{ run: SeoRun }>(`runs/${runId}`);
          if (alive) {
            setRun(detail.run);
            setDetailError("");
          }
        } catch (e) {
          if (alive) setDetailError(e instanceof Error ? e.message : String(e));
        }
    };
    setRun(null);
    refresh();
    const timer = setInterval(refresh, 2500);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [runId, reload]);
  async function start(
    kind: "check" | "workflow",
    input: Record<string, string>,
    selectedWorkflow?: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, input, workflow: selectedWorkflow }),
      });
      navigateToApp(`runs/${result.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function openWorkflow(key: string, initial: Record<string, string> = {}) {
    setFields(initial);
    navigateToApp(`workflow/${key}`);
  }
  const counts = {
    checks: data?.runs.filter((r) => r.kind === "check").length || 0,
    workflows: data?.runs.filter((r) => r.kind === "workflow").length || 0,
    running: data?.runs.filter(active).length || 0,
  };
  const spec = workflow ? data?.workflows[workflow] : null;
  const recent = data?.runs.slice(0, 4) || [];
  const page = run?.result;
  return (
    <main className="min-h-full bg-[var(--app-canvas)] text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-border bg-muted p-2.5">
              <Search className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">SEO</h1>
              <p className="text-sm text-muted-foreground">
                Page health, search visibility, and your next move.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{counts.checks} checks</span>
            <span>{counts.workflows} AI runs</span>
            {counts.running > 0 && <Status status="running" />}
          </div>
        </header>
        <nav
          aria-label="SEO dashboard"
          className="mt-7 flex gap-1 border-b border-border pb-3"
        >
          {[
            { key: "check", label: "Page check", icon: Search },
            { key: "workflows", label: "AI workflows", icon: Sparkles },
            { key: "history", label: "History", icon: History },
          ].map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant={tab === key ? "secondary" : "ghost"}
              size="sm"
              aria-current={tab === key ? "page" : undefined}
              onClick={() => navigateToApp(key === "check" ? "" : key)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>
        {error && (
          <Alert variant="destructive" className="mt-5">
            <CircleAlert />
            <AlertDescription className="flex items-center justify-between gap-3">
              {error}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X className="h-4 w-4" />
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!data && !error && (
          <div
            role="status"
            className="flex items-center gap-2 py-16 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading dashboard…
          </div>
        )}
        {data && (
          <div className="mt-6 space-y-6">
            {!workflow && tab === "check" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle>Instant page check</CardTitle>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      No AI
                    </span>
                  </div>
                  <CardDescription>
                    Inspect the page’s HTML and get a prioritized fix list.
                    Usually ready in seconds.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="flex flex-col gap-3 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      start("check", { url });
                    }}
                  >
                    <div className="flex-1">
                      <label htmlFor="page-url" className="sr-only">
                        Page URL
                      </label>
                      <Input
                        id="page-url"
                        type="url"
                        placeholder="https://example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                        icon={<Globe2 className="h-4 w-4" />}
                      />
                    </div>
                    <Button type="submit" disabled={busy}>
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      {busy ? "Starting…" : "Check page"}
                    </Button>
                  </form>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Public URLs only · Server HTML, not a browser render · No
                    site changes
                  </p>
                </CardContent>
              </Card>
            )}
            {workflow &&
              (spec ? (
                <div className="mx-auto max-w-2xl space-y-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigateToApp("workflows")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    All workflows
                  </Button>
                  <Card>
                    <CardHeader>
                      <CardTitle>{spec.title}</CardTitle>
                      <CardDescription>{spec.summary}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="space-y-5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          start("workflow", fields, workflow);
                        }}
                      >
                        {spec.fields.map((field) => (
                          <div key={field.name} className="space-y-2">
                            <label
                              htmlFor={`field-${field.name}`}
                              className="text-sm font-medium"
                            >
                              {fieldNames[field.name] ||
                                field.name.charAt(0).toUpperCase() +
                                  field.name.slice(1)}{" "}
                              {field.required ? (
                                <span className="text-muted-foreground">*</span>
                              ) : (
                                <span className="text-xs font-normal text-muted-foreground">
                                  optional
                                </span>
                              )}
                            </label>
                            {field.name === "source" ||
                            field.name === "topic" ? (
                              <Textarea
                                id={`field-${field.name}`}
                                required={field.required}
                                placeholder={field.description}
                                maxLength={12000}
                                value={fields[field.name] || ""}
                                onChange={(e) =>
                                  setFields({
                                    ...fields,
                                    [field.name]: e.target.value,
                                  })
                                }
                                rows={3}
                              />
                            ) : (
                              <Input
                                id={`field-${field.name}`}
                                required={field.required}
                                placeholder={field.description}
                                maxLength={12000}
                                value={fields[field.name] || ""}
                                onChange={(e) =>
                                  setFields({
                                    ...fields,
                                    [field.name]: e.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                          <p className="text-xs text-muted-foreground">
                            Uses the SEO agent · You can leave this tab
                          </p>
                          <Button disabled={busy} type="submit">
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            Start workflow
                          </Button>
                        </div>
                        {workflow === "setup_alert" && (
                          <p className="text-xs text-muted-foreground">
                            Produces an alerting plan; does not activate
                            monitoring or send notifications.
                          </p>
                        )}
                      </form>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Empty title="Workflow not found">
                  Choose an available workflow from the launcher.
                </Empty>
              ))}
            {parts[0] === "workflows" && !workflow && (
              <>
                <div>
                  <h2 className="text-base font-semibold">
                    Put your findings to work
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose an outcome. The SEO agent handles the research and
                    writes your report.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(data.workflows).map(([key, item]) => {
                    const Icon = workflowIcons[key] || Sparkles;
                    return (
                      <Card key={key} className="h-full">
                        <CardHeader>
                          <div className="mb-2 flex items-center justify-between">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <CardTitle>{item.title}</CardTitle>
                          <CardDescription className="min-h-14">
                            {item.summary}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => openWorkflow(key)}
                          >
                            Start {item.title.toLowerCase()}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
            {runId &&
              (detailError ? (
                <Alert variant="destructive">
                  <AlertDescription>{detailError}</AlertDescription>
                </Alert>
              ) : !run ? (
                <div
                  role="status"
                  className="flex items-center gap-2 py-10 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading saved run…
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-base font-semibold">
                          {run.kind === "check" ? "Page health" : run.title}
                        </h2>
                        <Status status={run.status} />
                      </div>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {run.kind === "check"
                          ? run.input.url
                          : Object.values(run.input)
                              .filter(Boolean)
                              .join(" · ")
                              .slice(0, 160)}{" "}
                        · {date(run.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {run.report && <CopyButton value={run.report} />}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || active(run)}
                        onClick={() =>
                          start(run.kind, run.input, run.workflow || undefined)
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Re-run
                      </Button>
                      {!active(run) && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete run"
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {confirmDelete && (
                    <Alert variant="warning">
                      <AlertDescription>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span>
                            Delete this saved run? This cannot be undone.
                          </span>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmDelete(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await api(`runs/${run.id}`, {
                                    method: "DELETE",
                                  });
                                  navigateToApp("history");
                                  await reload();
                                } catch (e) {
                                  setError(
                                    e instanceof Error ? e.message : String(e),
                                  );
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Delete run
                            </Button>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  {active(run) && (
                    <Card>
                      <CardContent>
                        <div
                          role="status"
                          className="flex items-start gap-4 py-6"
                        >
                          <Loader2 className="mt-1 h-6 w-6 animate-spin text-primary" />
                          <div>
                            <h3 className="text-sm font-medium">
                              {run.status === "pending"
                                ? "Your run is queued"
                                : run.kind === "check"
                                  ? "Reading page signals"
                                  : "The SEO agent is working"}
                            </h3>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {run.kind === "check"
                                ? "Fetching HTML, robots.txt, and sitemap. No AI involved."
                                : "Researching the source and preparing your report. This may take a few minutes."}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Saved to history. You can close this tab and
                              return later.
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {run.status === "failed" && (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertDescription>
                        {run.error || "This run did not finish."} Use Re-run to
                        try again.
                      </AlertDescription>
                    </Alert>
                  )}
                  {page && run.status === "completed" && (
                    <PageResult
                      page={page}
                      tab={pageTab}
                      onTab={setPageTab}
                      onAudit={() =>
                        openWorkflow("audit_page", { source: page.finalUrl })
                      }
                      onMeta={() =>
                        openWorkflow("optimize_meta", { source: page.finalUrl })
                      }
                    />
                  )}
                  {run.report && (
                    <Card>
                      <CardContent>
                        <div className="min-w-0 overflow-hidden py-2">
                          <Markdown>{run.report}</Markdown>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ))}
            {tab === "history" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>
                    Saved checks and reports{" "}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {data.runs.length}
                      {data.runs.length === 200 ? " most recent" : " total"}
                    </span>
                  </SectionLabel>
                  <Input
                    aria-label="Search history"
                    placeholder="Search history…"
                    className="max-w-60"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    icon={<Search className="h-4 w-4" />}
                  />
                </div>
                <div className="flex gap-1" aria-label="Filter history">
                  {["all", "check", "workflow"].map((f) => (
                    <Button
                      size="sm"
                      key={f}
                      aria-pressed={filter === f}
                      variant={filter === f ? "secondary" : "ghost"}
                      onClick={() => setFilter(f)}
                    >
                      {f === "all"
                        ? "All runs"
                        : f === "check"
                          ? "Page checks"
                          : "AI workflows"}
                    </Button>
                  ))}
                </div>
                <RunList
                  runs={data.runs.filter(
                    (r) =>
                      (filter === "all" || r.kind === filter) &&
                      `${r.title} ${r.workflow || ""} ${r.status}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )}
                  empty={
                    query || filter !== "all"
                      ? "No matching runs"
                      : "Your history starts here"
                  }
                />
              </>
            )}
            {!runId && !workflow && tab === "check" && (
              <>
                <div className="grid gap-6 border-b border-border pb-7 sm:grid-cols-3">
                  {[
                    {
                      icon: ListTree,
                      title: "Search essentials",
                      text: "Titles, descriptions, headings, canonical URLs, and indexing signals.",
                    },
                    {
                      icon: Image,
                      title: "Sharing & content",
                      text: "Social previews, structured data, image alternatives, and links.",
                    },
                    {
                      icon: Sparkles,
                      title: "Go deeper with AI",
                      text: "Turn a quick diagnosis into research, improved copy, or a full audit.",
                    },
                  ].map(({ icon: Icon, title, text }) => (
                    <div key={title} className="flex gap-3">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <h3 className="text-sm font-medium">{title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {text}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <SectionLabel>Recent activity</SectionLabel>
                  {recent.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigateToApp("history")}
                    >
                      View history
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <RunList runs={recent} empty="Start with a page" />
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function RunList({ runs, empty }: { runs: RunSummary[]; empty: string }) {
  return runs.length ? (
    <div className="divide-y divide-border rounded-lg border border-border">
      {runs.map((run) => (
        <button
          key={run.id}
          className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => navigateToApp(`runs/${run.id}`)}
        >
          <div className="rounded-md bg-muted p-2">
            {run.kind === "check" ? (
              <Search className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{run.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {run.kind === "check" ? "Instant check" : "AI workflow"} ·{" "}
              {date(run.createdAt)}
            </p>
          </div>
          <Status status={run.status} />
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
        </button>
      ))}
    </div>
  ) : (
    <Card>
      <CardContent>
        <Empty icon={History} title={empty}>
          Enter a public page URL above, or start an AI workflow. Your results
          will be saved here.
        </Empty>
      </CardContent>
    </Card>
  );
}
function PageResult({
  page: p,
  tab,
  onTab,
  onAudit,
  onMeta,
}: {
  page: PageCheck;
  tab: string;
  onTab: (tab: string) => void;
  onAudit: () => void;
  onMeta: () => void;
}) {
  const counts = {
    pass: p.findings.filter((f) => f.status === "pass").length,
    warn: p.findings.filter((f) => f.status === "warn").length,
    fail: p.findings.filter((f) => f.status === "fail").length,
  };
  const findings =
    tab === "fixes"
      ? p.findings
          .filter((f) => f.status !== "pass")
          .sort(
            (a, b) =>
              (a.status === "fail" ? 0 : 1) - (b.status === "fail" ? 0 : 1),
          )
      : p.findings;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,1fr)]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-center gap-5">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
                <svg
                  viewBox="0 0 100 100"
                  className="absolute h-full w-full -rotate-90"
                  aria-hidden="true"
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="43"
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="6"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="43"
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${p.score * 2.7} 270`}
                  />
                </svg>
                <div className="text-center">
                  <strong className="text-3xl font-semibold tracking-tight">
                    {p.score}
                  </strong>
                  <div className="text-[10px] text-muted-foreground">
                    OUT OF 100
                  </div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold">
                  {p.score >= 90
                    ? "Strong foundations"
                    : p.score >= 70
                      ? "A few things to refine"
                      : "Room to improve"}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Heuristic page-health score, not a ranking prediction.
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <span>{counts.pass} passed</span>
                  <span>{counts.warn} to review</span>
                  <span>{counts.fail} to fix</span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              <Button size="sm" onClick={onAudit}>
                <Sparkles className="h-4 w-4" />
                Deep AI audit
              </Button>
              <Button variant="outline" size="sm" onClick={onMeta}>
                Optimize meta
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
        <div>
          <div className="mb-3 flex flex-wrap gap-1">
            {[
              {
                id: "fixes",
                text: `Fixes & reviews (${counts.fail + counts.warn})`,
              },
              { id: "all", text: `All signals (${p.findings.length})` },
              { id: "data", text: "Page data" },
            ].map((t) => (
              <Button
                size="sm"
                key={t.id}
                variant={tab === t.id ? "secondary" : "ghost"}
                aria-pressed={tab === t.id}
                onClick={() => onTab(t.id)}
              >
                {t.text}
              </Button>
            ))}
          </div>
          {tab === "data" ? (
            <PageData page={p} />
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {findings.length ? (
                findings.map((f) => <FindingRow key={f.key} finding={f} />)
              ) : (
                <Empty icon={CheckCircle2} title="All checks passed">
                  Review the full signals and use a deep AI audit for context
                  beyond the HTML.
                </Empty>
              )}
            </div>
          )}
        </div>
      </div>
      <aside className="min-w-0 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Search preview</CardTitle>
            <CardDescription>
              Approximation · Google may rewrite your snippet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 break-words">
              <div className="flex items-center gap-2 text-xs">
                <Globe2 className="h-4 w-4" />
                {new URL(p.finalUrl).hostname}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {p.finalUrl}
              </p>
              <p className="line-clamp-2 text-lg leading-snug text-primary">
                {p.title || "No page title"}
              </p>
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {p.description ||
                  "No meta description. Search engines may use page content instead."}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Social preview</CardTitle>
            <CardDescription>Open Graph / X card metadata</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex aspect-[1.91/1] items-center justify-center bg-muted p-5 text-center">
                <div>
                  <Image className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.og["og:image"] || p.twitter["twitter:image"]
                      ? "Social image declared"
                      : "No social image"}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5 p-3">
                <p className="truncate text-[11px] text-muted-foreground">
                  {new URL(p.finalUrl).hostname}
                </p>
                <p className="line-clamp-2 text-sm font-semibold">
                  {p.og["og:title"] ||
                    p.twitter["twitter:title"] ||
                    p.title ||
                    "No social title"}
                </p>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {p.og["og:description"] ||
                    p.twitter["twitter:description"] ||
                    p.description ||
                    "No social description"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Images are not loaded from checked sites for privacy.
            </p>
          </CardContent>
        </Card>
        <div className="space-y-3 px-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Timer className="h-3.5 w-3.5" />
            HTML response: {p.responseMs.toLocaleString()} ms
          </div>
          <div className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5" />
            {p.links.internal} internal · {p.links.external} external links
          </div>
          <p>
            Server HTML only. No JavaScript execution, Core Web Vitals, or
            robots-rule evaluation.
          </p>
        </div>
      </aside>
    </div>
  );
}
function FindingRow({ finding: f }: { finding: Finding }) {
  return (
    <div className="space-y-2 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{f.label}</h3>
        <Status status={f.status} />
      </div>
      <p className="break-words text-xs leading-relaxed text-muted-foreground">
        {f.detail}
      </p>
      {f.fix && <p className="text-sm leading-relaxed">{f.fix}</p>}
    </div>
  );
}
function PageData({ page: p }: { page: PageCheck }) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border text-sm">
      <div className="space-y-3 p-4">
        <h3 className="font-medium">Page details</h3>
        {Object.entries({
          "Final URL": p.finalUrl,
          Canonical: p.canonical,
          Language: p.lang,
          Viewport: p.viewport,
          "Robots meta": p.robotsMeta,
          "X-Robots-Tag": p.xRobotsTag,
          Words: String(p.wordCount),
          Images: `${p.images.total} total · ${p.images.withAlt} with alt · ${p.images.emptyAlt} empty alt`,
          "JSON-LD": p.jsonLdTypes.join(", "),
          "robots.txt": `${p.robots.url} · ${p.robots.found ? "found" : "not detected"}`,
          Sitemap: `${p.sitemap.url} · ${p.sitemap.found ? "found" : "not detected"}`,
        }).map(([key, value]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[110px_1fr]">
            <dt className="text-xs text-muted-foreground">{key}</dt>
            <dd className="break-all text-xs">{value || "Not present"}</dd>
          </div>
        ))}
      </div>
      <div className="space-y-3 p-4">
        <h3 className="font-medium">Heading outline</h3>
        {p.headings.length ? (
          p.headings.map((h, i) => (
            <div
              key={i}
              style={{ paddingLeft: (h.level - 1) * 12 }}
              className="flex gap-2 text-xs"
            >
              <span className="shrink-0 text-muted-foreground">H{h.level}</span>
              <span className="break-words">{h.text || "Empty heading"}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No headings found.</p>
        )}
      </div>
      <div className="space-y-3 p-4">
        <h3 className="font-medium">Social tags</h3>
        {Object.entries({ ...p.og, ...p.twitter }).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{key}</dt>
            <dd className="mt-1 break-all text-xs">{value}</dd>
          </div>
        ))}
        {!Object.keys({ ...p.og, ...p.twitter }).length && (
          <p className="text-xs text-muted-foreground">No social tags found.</p>
        )}
      </div>
      {p.redirects.length > 0 && (
        <div className="space-y-2 p-4">
          <h3 className="font-medium">Redirects</h3>
          {[...p.redirects, p.finalUrl].map((url, i) => (
            <p key={i} className="break-all text-xs text-muted-foreground">
              {i + 1}. {url}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
