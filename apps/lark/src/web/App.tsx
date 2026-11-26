import { coreAccessIssue } from "../shared/core-access.js";
import {
  createSubmissionGate,
  createWriteIntentStore,
  writeResult,
  type WriteIntentStore,
} from "./write-result.js";
import { emptyReadSubmission, readSubmission } from "./read-submission.js";
import "./styles.css";
import {
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  navigateRome,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Link2,
  LockKeyhole,
  MessageSquare,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Badge } from "@rome-os/ui/badge";
import { Input } from "@rome-os/ui/input";
import { Textarea } from "@rome-os/ui/textarea";
import { Switch } from "@rome-os/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rome-os/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Spinner } from "@rome-os/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@rome-os/ui/card";
import {
  Measure,
  Page,
  PageHeader,
  PageHeading,
  PageTitle,
  PageNav,
  PageNavLink,
} from "@rome-os/ui/page";
import {
  COMMANDS,
  coreCommand,
  type CommandSpec,
  type Identity,
} from "../shared/catalog.js";
import {
  api,
  ApiResponseError,
  type ActivityItem,
  type Status,
} from "./api.js";
import { useI18n, type MessageKey } from "./i18n.js";
import { useCoreConnection } from "./connection-inspector.js";
import {
  ManagedConnections,
  useManagedConnections,
} from "./managed-connections.js";
import { LOCAL_CONNECTION_ID } from "../shared/managed-connections.js";
const client = new QueryClient({
  defaultOptions: {
    queries: { refetchInterval: 15000, refetchOnWindowFocus: true, retry: 1 },
    mutations: { retry: false },
  },
});
function subscribePath(onChange: () => void) {
  return subscribeToAppPath(onChange);
}
function routeSnapshot() {
  return getCurrentAppPath().replace(/^\/+/, "");
}
let sessionWriteIntents: WriteIntentStore | undefined;

export default function App({
  bootstrap: _bootstrap,
}: {
  bootstrap: RomeAppBootstrap;
}) {
  const [writeIntents] = useState(
    () => (sessionWriteIntents ??= createWriteIntentStore()),
  );
  return (
    <QueryClientProvider client={client}>
      <Shell writeIntents={writeIntents} />
    </QueryClientProvider>
  );
}
function ErrorMessage({ error }: { error: Error | null | undefined }) {
  const { t, error: formatError } = useI18n();
  return error ? (
    <Alert variant="destructive">
      <AlertTitle>{t("error")}</AlertTitle>
      <AlertDescription>
        <code>
          {formatError(error.message)}{" "}
          {error instanceof ApiResponseError ? error.operation : ""}
        </code>
      </AlertDescription>
    </Alert>
  ) : null;
}
function Label({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      {title}
      {children}
    </label>
  );
}
function Shell({ writeIntents }: { writeIntents: WriteIntentStore }) {
  const { t } = useI18n();
  const path = useSyncExternalStore(subscribePath, routeSnapshot, () => "");
  const view = path.startsWith("commands")
    ? "commands"
    : path === "activity"
      ? "activity"
      : "connection";
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => api<Status>("status"),
    refetchInterval: 5000,
  });
  return (
    <Page className="min-h-full bg-[var(--app-canvas)]">
      <PageHeader>
        <PageHeading>
          <PageTitle>Lark</PageTitle>
        </PageHeading>
        <Badge variant="outline">CLI 1.0.98</Badge>
      </PageHeader>
      <PageNav aria-label="Lark">
        {(["connection", "commands", "activity"] as const).map((item) => (
          <PageNavLink
            key={item}
            active={view === item}
            href={item === "connection" ? "/apps/lark" : `/apps/lark/${item}`}
            onClick={(e) => {
              e.preventDefault();
              navigateToApp(item === "connection" ? "" : item);
            }}
          >
            {t(item)}
          </PageNavLink>
        ))}
      </PageNav>
      <Measure className="flex w-full min-w-0 flex-col gap-6 pb-10">
        {status.error && status.data ? (
          <Alert variant="warning">
            <AlertDescription>{t("stale")}</AlertDescription>
          </Alert>
        ) : (
          <ErrorMessage error={status.error} />
        )}
        {!status.data && !status.error ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner />
            {t("loading")}
          </div>
        ) : null}
        {view === "connection" && status.data ? (
          <Connection status={status.data} />
        ) : null}
        {view === "commands" ? (
          <Capabilities
            status={status.data}
            selected={decodeURIComponent(path.split("/")[1] ?? "")}
            writeIntents={writeIntents}
          />
        ) : null}
        {view === "activity" ? <Activity /> : null}
      </Measure>
    </Page>
  );
}
function Connection({ status }: { status: Status }) {
  const { t, locale } = useI18n();
  const query = useQueryClient();
  const [mode, setMode] = useState("existing");
  const [brand, setBrand] = useState<"feishu" | "lark">(
    status.brand ?? status.preferences.brand,
  );
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [groups, setGroups] = useState(["docs", "wiki", "calendar"]);
  const setup = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api("setup", {
        method: "POST",
        body: JSON.stringify({ ...payload, brand, locale }),
      }),
    onSettled: () => {
      setSecret("");
      void query.invalidateQueries({ queryKey: ["status"] });
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      api("setup/cancel", {
        method: "POST",
        body: JSON.stringify({ id: status.job?.id }),
      }),
    onSettled: () => query.invalidateQueries({ queryKey: ["status"] }),
  });
  const prefs = useMutation({
    mutationFn: (patch: Partial<Status["preferences"]>) =>
      api("preferences", { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: () => query.invalidateQueries({ queryKey: ["status"] }),
  });
  const running = setup.isPending || status.job?.state === "running";
  return (
    <>
      <ManagedConnections />
      <section className="divide-y divide-border rounded-md border border-border">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="flex max-w-xl gap-3">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-medium">{t("botTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("botNote")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateRome({ path: "settings" })}
          >
            {t("settings")}
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="flex gap-3">
            <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-medium">{t("toolsTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("toolsNote")}
              </p>
              {status.configured ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {status.appId} · {status.brand === "lark" ? "Lark" : "Feishu"}
                </p>
              ) : null}
            </div>
          </div>
          <Badge variant="outline">
            {t(status.configured ? "configured" : "notConfigured")}
          </Badge>
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["user", "bot"] as const).map((id) => (
          <div
            key={id}
            className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm"
          >
            <span>{t(id)}</span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {status.identities[id].available ? (
                <Check className="size-3.5" />
              ) : (
                <LockKeyhole className="size-3.5" />
              )}
              {t(status.identities[id].available ? "available" : "unavailable")}
            </span>
          </div>
        ))}
      </div>
      {status.job ? (
        <Alert
          variant={status.job.state === "failed" ? "destructive" : "default"}
        >
          <AlertTitle>
            {t(
              status.job.state === "running"
                ? "waiting"
                : status.job.state === "completed"
                  ? "jobDone"
                  : status.job.state === "interrupted"
                    ? "jobInterrupted"
                    : "jobFailed",
            )}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {status.job.errorCode ? <code>{status.job.errorCode}</code> : null}
            {status.job.state === "running" ? (
              <>
                {status.job.verificationUrl ? (
                  <Button size="sm" asChild>
                    <a
                      href={status.job.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("openAuth")}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  </Button>
                ) : (
                  <Spinner />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  {t("cancel")}
                </Button>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <ErrorMessage error={setup.error ?? cancel.error ?? prefs.error} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("setup")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {(["existing", "new"] as const).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={mode === v ? "secondary" : "ghost"}
                  disabled={running}
                  onClick={() => setMode(v)}
                >
                  {t(v === "existing" ? "existing" : "newApp")}
                </Button>
              ))}
            </div>
            <Label title={t("brand")}>
              <Select
                value={brand}
                disabled={running}
                onValueChange={(v) => setBrand(v as "feishu" | "lark")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feishu">{t("feishu")}</SelectItem>
                  <SelectItem value="lark">{t("lark")}</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            {mode === "existing" ? (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setup.mutate({ kind: "existing", appId, appSecret: secret });
                }}
              >
                <p className="text-sm text-muted-foreground">
                  {t("existingNote")}
                </p>
                <Label title={t("appId")}>
                  <Input
                    value={appId}
                    disabled={running}
                    onChange={(e) => setAppId(e.target.value)}
                    placeholder="cli_…"
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Label>
                <Label title={t("appSecret")}>
                  <Input
                    type="password"
                    value={secret}
                    disabled={running}
                    onChange={(e) => setSecret(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </Label>
                <Button
                  className="self-start"
                  type="submit"
                  disabled={running || !appId || !secret}
                >
                  {setup.isPending ? <Spinner /> : null}
                  {t(running ? "busy" : "connect")}
                </Button>
              </form>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t("newNote")}</p>
                <Button
                  className="self-start"
                  disabled={running}
                  onClick={() => setup.mutate({ kind: "new" })}
                >
                  {t("createApp")}
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("authorize")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t("authorizeNote")}
            </p>
            <fieldset
              disabled={!status.configured || running}
              className="flex flex-col gap-2.5"
            >
              {Object.entries(status.scopeGroups).map(([group, scopes]) => (
                <label
                  key={group}
                  className="flex cursor-pointer items-start gap-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-current"
                    checked={groups.includes(group)}
                    onChange={(e) =>
                      setGroups((current) =>
                        e.target.checked
                          ? [...current, group]
                          : current.filter((g) => g !== group),
                      )
                    }
                  />
                  <span>
                    {t(`scope_${group}` as MessageKey)}
                    <span className="mt-0.5 block break-all font-mono text-xs font-normal text-muted-foreground">
                      {scopes.join(", ")}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button
              className="self-start"
              disabled={!status.configured || running || groups.length === 0}
              onClick={() => setup.mutate({ kind: "auth", groups })}
            >
              {t("authorizeButton")}
              <ArrowUpRight className="size-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4" />
          {t("permissions")}
        </h2>
        <div className="divide-y divide-border">
          {(["agentEnabled", "writesEnabled"] as const).map((key) => (
            <div
              key={key}
              className="flex items-start justify-between gap-4 py-4"
            >
              <div>
                <label htmlFor={key} className="text-sm font-medium">
                  {t(key === "agentEnabled" ? "enableAgent" : "enableWrites")}
                </label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(key === "agentEnabled" ? "privateOnly" : "writesNote")}
                </p>
              </div>
              <Switch
                id={key}
                checked={status.preferences[key]}
                disabled={prefs.isPending}
                onCheckedChange={(checked) => prefs.mutate({ [key]: checked })}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function Capabilities({
  status,
  selected,
  writeIntents,
}: {
  status: Status | undefined;
  selected: string;
  writeIntents: WriteIntentStore;
}) {
  const { t, pair } = useI18n();
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const items = COMMANDS.filter(
    (c) =>
      (domain === "all" || c.domain === domain) &&
      `${c.id} ${c.title.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const spec = COMMANDS.find((c) => c.id === selected);
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label={t("search")}
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("commands")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {[...new Set(COMMANDS.map((c) => c.domain))].map((d) => (
              <SelectItem key={d} value={d}>
                {t(d as MessageKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label={t("commands")}
          className="flex max-h-96 min-w-0 flex-col gap-0.5 overflow-y-auto border-b border-border pb-4 lg:max-h-none lg:border-b-0 lg:border-r lg:pr-4"
        >
          {items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {t("emptyCommands")}
            </p>
          ) : (
            items.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => navigateToApp(`commands/${c.id}`)}
                aria-current={spec?.id === c.id ? "page" : undefined}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent ${spec?.id === c.id ? "bg-accent font-medium" : ""}`}
              >
                <span>
                  {pair(c.title)}
                  <span className="mt-0.5 block font-mono text-[11px] font-normal text-muted-foreground">
                    {c.id}
                  </span>
                </span>
                {c.risk === "write" ? (
                  <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </nav>
        {spec ? (
          <CommandDetail
            key={spec.id}
            spec={spec}
            status={status}
            writeIntents={writeIntents}
          />
        ) : (
          <div className="py-10 text-sm text-muted-foreground">
            {t("selectCommand")}
          </div>
        )}
      </div>
    </>
  );
}
function CommandDetail({
  spec: localSpec,
  status,
  writeIntents,
}: {
  spec: CommandSpec;
  status: Status | undefined;
  writeIntents: WriteIntentStore;
}) {
  const { t, pair, error: formatError } = useI18n();
  const query = useQueryClient();
  const managed = useManagedConnections();
  const [connectionId, setConnectionId] = useState(
    () => writeIntents.connectionFor(localSpec.id) ?? LOCAL_CONNECTION_ID,
  );
  const managedMode = connectionId !== LOCAL_CONNECTION_ID;
  const spec = managedMode ? coreCommand(localSpec) : localSpec;
  const core = useCoreConnection(connectionId);
  const [identity, setIdentity] = useState<Identity>(() =>
    managedMode && spec.identities.includes("bot") ? "bot" : spec.identities[0]!,
  );
  const [editedText, setEditedText] = useState<string | null>(null);
  const text =
    editedText ??
    JSON.stringify(
      exampleForLocale(spec, document.documentElement.lang),
      null,
      2,
    );
  const [validation, setValidation] = useState<string | null>(null);
  const [read, updateRead] = useReducer(readSubmission, emptyReadSubmission);
  const [submission] = useState(createSubmissionGate);
  const intent = useSyncExternalStore(
    writeIntents.subscribe,
    () => writeIntents.get(connectionId, spec.id),
    () => undefined,
  );
  const result = spec.risk === "write" ? intent?.receipt ?? null : read.result;
  const {
    waiting,
    unknown,
    inProgress,
    duplicate,
    approvalId,
    executionId,
  } = writeResult(intent?.receipt ?? null);
  const receiptLocked = waiting || unknown || inProgress || duplicate;
  const coreIssue = managedMode
    ? coreAccessIssue(spec, identity, core.data)
    : undefined;
  const coreUnavailable = managedMode && (!!coreIssue || !!core.error);
  useEffect(() => {
    if (coreUnavailable && read.result) updateRead({ type: "revoke" });
  }, [coreUnavailable, read.result]);
  const execute = useMutation({
    retry: false,
    mutationFn: ({
      preview,
      requestId,
      parameters,
    }: {
      preview: boolean;
      requestId?: string;
      parameters: Record<string, unknown>;
    }) => {
      return api<Record<string, unknown>>(preview ? "preview" : "invoke", {
        method: "POST",
        body: JSON.stringify({
          command: spec.id,
          connectionId,
          identity,
          parameters,
          ...(requestId
            ? { requestId, connectionRevision: status?.preferences.revision }
            : {}),
        }),
      });
    },
    onSuccess: (value, { preview, requestId }) => {
      if (preview)
        setValidation(
          value.status === "ok" ? t("valid") : formatError(String(value.error)),
        );
      else {
        if (requestId) {
          writeIntents.finish(connectionId, spec.id, requestId, value);
        } else {
          updateRead({ type: "success", result: value, operation: spec.coreOperation });
        }
        void query.invalidateQueries({ queryKey: ["activity"] });
        if (managedMode && value.status === "error")
          void query.invalidateQueries({
            queryKey: ["core-connection", connectionId],
          });
      }
    },
    onError: (error, { preview, requestId }) => {
      if (managedMode && error instanceof ApiResponseError)
        void query.invalidateQueries({
          queryKey: ["core-connection", connectionId],
        });
      if (requestId) {
        const failure = { status: "error", error: error.message };
        const { waiting, unknown, inProgress, duplicate } = writeResult(failure);
        const receipt = waiting || unknown || inProgress || duplicate
          ? failure
          : !(error instanceof ApiResponseError) || error.status >= 500
            ? { status: "outcome_unknown" }
            : null;
        writeIntents.finish(connectionId, spec.id, requestId, receipt);
      } else if (!preview) {
        updateRead({ type: "failure", error });
      }
    },
    onSettled: () => submission.finish(),
  });
  const busy = execute.isPending || !!intent?.inFlight;
  const [inputError, setInputError] = useState<Error | null>(null);
  function submit(preview: boolean) {
    const write = !preview && spec.risk === "write";
    if (busy || (preview ? coreUnavailable : disabled)) return;
    if (write && writeIntents.get(connectionId, spec.id)) return;
    if (!submission.begin(preview, false)) return;
    if (spec.risk === "read") updateRead({ type: "start" });
    setInputError(null);
    setValidation(null);
    execute.reset();
    let parameters: Record<string, unknown>;
    try {
      parameters = JSON.parse(text);
      if (!parameters || typeof parameters !== "object" || Array.isArray(parameters))
        throw new Error();
    } catch {
      setInputError(new Error(t("invalidJson")));
      submission.finish();
      return;
    }
    const requestId = write ? writeIntents.begin(connectionId, spec.id) : undefined;
    if (write && !requestId) {
      submission.finish();
      return;
    }
    execute.mutate({ preview, requestId, parameters });
  }
  function newIntent(explicit = false) {
    if (
      !submission.newIntent() ||
      !writeIntents.reset(connectionId, spec.id, explicit)
    )
      return false;
    execute.reset();
    updateRead({ type: "start" });
    setInputError(null);
    setValidation(null);
    return true;
  }
  const disabled =
    (connectionId === LOCAL_CONNECTION_ID
      ? !status?.configured || !status.identities[identity].available
      : coreUnavailable) ||
    !status?.preferences.agentEnabled ||
    (spec.risk === "write" && !status?.preferences.writesEnabled);
  return (
    <section className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">{pair(spec.title)}</h2>
        <Badge variant="outline">{t(spec.risk)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{pair(spec.description)}</p>
      <Label title={t("executionConnection")}>
        <Select
          value={connectionId}
          disabled={busy || receiptLocked}
          onValueChange={(id) => {
            if (receiptLocked || !newIntent()) return;
            setConnectionId(id);
            setEditedText(null);
            if (id !== LOCAL_CONNECTION_ID && spec.identities.includes("bot"))
              setIdentity("bot");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LOCAL_CONNECTION_ID}>
              {t("localConnection")}
            </SelectItem>
            {managed.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      {connectionId !== LOCAL_CONNECTION_ID ? (
        <p className="text-sm text-muted-foreground">{t("phaseOneScope")}</p>
      ) : null}
      {connectionId !== LOCAL_CONNECTION_ID && core.error ? (
        <Alert variant="warning">
          <AlertDescription>
            {core.error.message === "core_delegation_not_implemented"
              ? t("coreNotInstalled")
              : formatError(core.error.message)}
          </AlertDescription>
        </Alert>
      ) : null}
      {coreIssue &&
      (!core.error || coreIssue === "core_user_identity_unsupported") ? (
        <p role="alert">
          {formatError(coreIssue)}{" "}
          {coreIssue === "core_operation_not_granted" && (
            <code>{spec.coreOperation}</code>
          )}
        </p>
      ) : null}
      {managed.error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("connectionsUnavailable")}
        </p>
      ) : null}
      <div className="divide-y divide-border border-y border-border">
        {Object.entries(spec.fields).map(([key, f]) => (
          <div
            key={key}
            className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <code className="break-all font-medium">{key}</code>
              <p className="mt-0.5 text-muted-foreground">
                {pair(f.label)}
                {f.enum ? ` · ${f.enum.join(" / ")}` : ""}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {t(f.required ? "required" : "optional")}
            </span>
          </div>
        ))}
      </div>
      <Label title={t("identity")}>
        <Select
          value={identity}
          disabled={busy || receiptLocked}
          onValueChange={(v) => {
            if (!receiptLocked && newIntent()) setIdentity(v as Identity);
          }}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spec.identities.map((id) => (
              <SelectItem key={id} value={id}>
                {t(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Label title={t("request")}>
        <Textarea
          value={text}
          onChange={(e) => {
            if (!receiptLocked && newIntent()) setEditedText(e.target.value);
          }}
          spellCheck={false}
          disabled={busy || receiptLocked}
          className="min-h-40 w-full font-mono text-xs leading-relaxed"
        />
      </Label>
      {disabled && !coreIssue ? (
        <p className="text-sm text-muted-foreground">{t("needSetup")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || coreUnavailable}
          onClick={() => submit(true)}
        >
          {t("validate")}
        </Button>
        <Button
          disabled={disabled || busy || !!intent}
          onClick={() => submit(false)}
        >
          {busy ? <Spinner /> : null}
          {t(spec.risk === "write" ? "submitWrite" : "runRead")}
        </Button>
        {spec.risk === "write" && result ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => newIntent(true)}
          >
            {t(receiptLocked ? "newSeparateRequest" : "newRequest")}
          </Button>
        ) : null}
      </div>
      {validation ? (
        <p role="status" className="text-sm text-muted-foreground">
          {validation}
        </p>
      ) : null}
      <ErrorMessage
        error={inputError ?? read.error ??
          (spec.risk === "write" || execute.variables?.preview ? execute.error : null)}
      />
      {waiting ? (
        <Alert>
          <AlertTitle>{t("pending")}</AlertTitle>
          <AlertDescription>
            <a href="/activity" className="underline">
              {t("review")}
            </a>
          </AlertDescription>
        </Alert>
      ) : null}
      {unknown ? (
        <Alert variant="warning">
          <AlertDescription>{t("uncertain")}</AlertDescription>
        </Alert>
      ) : null}
      {inProgress || duplicate ? (
        <p role="status">{t(inProgress ? "inProgressWriteNote" : "duplicate")}</p>
      ) : null}
      {result?.status === "error" && !coreUnavailable ? (
        <p role="alert">
          {formatError(String(result.error))} {spec.coreOperation}
        </p>
      ) : null}
      {intent ? (
        <dl className="text-sm">
          {Object.entries({
            approvalId,
            requestId: intent.requestId,
            executionId,
          }).map(
            ([key, id]) =>
              id && (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    <code>{id}</code>
                  </dd>
                </div>
              ),
          )}
        </dl>
      ) : null}
      {result && !coreUnavailable ? (
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-medium">{t("result")}</h3>
          <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("source")} {spec.risk === "read" ? t("singlePage") : t("writesNote")}
      </p>
    </section>
  );
}
function Activity() {
  const { t, locale, pair } = useI18n();
  const records = useQuery({
    queryKey: ["activity"],
    queryFn: () => api<{ items: ActivityItem[] }>("activity"),
  });
  return (
    <>
      <p className="text-sm text-muted-foreground">{t("noContentStored")}</p>
      <ErrorMessage error={records.error} />
      {records.isPending ? <Spinner /> : null}
      {records.data?.items.length === 0 ? (
        <div className="border-y border-border py-12 text-sm text-muted-foreground">
          {t("emptyActivity")}
        </div>
      ) : null}
      <div className="divide-y divide-border">
        {records.data?.items.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-start justify-between gap-3 py-4"
          >
            <div>
              <p className="text-sm font-medium">
                {pair(
                  COMMANDS.find((c) => c.id === item.command)?.title ?? [
                    item.command,
                    item.command,
                  ],
                )}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t(item.identity)}
                </span>
              </p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {item.id} · {item.connectionId ?? "local-cli"}
                {item.errorCode ? ` · ${item.errorCode}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">{t(item.state)}</Badge>
              <time
                className="text-xs text-muted-foreground"
                dateTime={item.createdAt}
              >
                {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(item.createdAt))}
              </time>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function exampleForLocale(
  spec: CommandSpec,
  locale: string,
): Record<string, unknown> {
  if (locale.toLowerCase().startsWith("zh")) return spec.example;
  const examples: Record<string, Record<string, unknown>> = {
    "docs.search": { query: "Project plan" },
    "calendar.search": { query: "Review" },
    "im.search": { query: "Project review" },
    "docs.create": {
      title: "Project notes",
      content: "# Project notes\nAdd notes here.",
    },
    "docs.update": {
      doc: "Document123",
      command: "append",
      content: "\n## Update\nAdditional notes.",
    },
    "calendar.create": { ...spec.example, summary: "Project review" },
    "im.send_as_user": {
      "chat-id": "oc_replace_me",
      text: "Please review the project document.",
    },
  };
  return examples[spec.id] ?? spec.example;
}
