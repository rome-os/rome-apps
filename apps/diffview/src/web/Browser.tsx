import { dictionary } from "../shared/dictionary";
import {
  invalidateConversationInventory,
  isConversationStorageKey,
} from "../shared/conversationStorage";
import "./styles.css";
import { loadViewed, saveViewed } from "../shared/viewed";
import { scrollViewKey } from "../shared/scroll";
import { useScrollMemory } from "./useScrollMemory";
import { useWorktreeFreshness } from "./useWorktreeFreshness";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { HOST_NAVIGATE_EVENT, useChatSessionId } from "@rome-os/app-web-sdk";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@rome-os/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@rome-os/ui/dropdown-menu";
import { Input } from "@rome-os/ui/input";
import { Skeleton } from "@rome-os/ui/skeleton";
import { Popover, PopoverTrigger, PopoverContent } from "@rome-os/ui/popover";
import {
  RefreshCw,
  PanelRight,
  Search,
  MoreHorizontal,
  Columns2,
  Rows2,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  FolderGit2,
  WrapText,
  Keyboard,
  LoaderCircle,
} from "lucide-react";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { CodeViewItem } from "@pierre/diffs";
import type { FileEntry } from "../lib/git";
import { comparisonIdentity, worktreeSide } from "../shared/comparison";
import { projectFileUrl } from "../shared/projectLink";
import { pageDemand, isPageable } from "../shared/paging";
import { ComparisonMenu } from "./ComparisonMenu";
import { api } from "./api";
import type { TrackingInfo } from "../lib/git";
import { groupRepositories } from "../shared/repositories";
import { normalizeMode } from "../shared/mode";
import { describeComparison, describeEmpty } from "../shared/describe";
import {
  DEFAULT_CHAT_STATE,
  loadChatState,
  loadPrefs,
  pickChatState,
  savePrefs,
  saveChatState,
} from "../shared/prefs";
import {
  activeFileAt,
  contentVersion,
  nextContext,
  reviewItemVersion,
} from "../shared/review";
import { Pool, Viewer, patchItem } from "./Renderer";
import { Quiet, Pill, DiffHeader, FileTree } from "./ReviewParts";
import { useHost, messages, errorMessage } from "./i18n";
import type {
  Repo,
  RefData,
  FilesData,
  State,
  PatchData,
  PageData,
  Loaded,
} from "./types";
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5000 },
  },
});
function readState(): State {
  try {
    const q = new URLSearchParams(location.hash.slice(1));
    const get = (k: string) => q.get(k) ?? undefined;
    // Old links (mode=branch, no target) keep their meaning; see shared/mode.ts.
    const n = normalizeMode({
      mode: get("mode"),
      filter: get("filter"),
      base: get("base"),
      ref: get("ref"),
      target: get("target"),
      dots: get("dots"),
      pr: get("pr"),
      commit: get("commit"),
    });
    return {
      repo: q.get("repo") || "",
      mode: n.mode,
      filter: n.filter,
      base: n.base,
      ref: n.ref,
      pr: n.pr,
      commit: n.commit,
      dots: n.dots,
      target: n.target,
      unified: q.get("unified") || "3",
    };
  } catch {
    return { repo: "", mode: "uncommitted", unified: "3" };
  }
}
/** The one-line reason a comparison is empty, with the single useful next step. */
function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-2 px-6 py-16 text-center">
      <p className="text-sm text-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {action && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 rounded-full"
          onClick={action.run}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
function recordFromPatch(
  path: string,
  result: PatchData,
  context: number,
  fp: string,
): Loaded {
  let item: CodeViewItem<undefined> | undefined;
  const version = result.patch ? contentVersion(result.patch) : undefined;
  if (result.patch && !result.truncated && !result.binary) {
    try {
      item = patchItem(path, result.patch, version);
    } catch {
      return { error: "invalid_patch", context, fp };
    }
  }
  return {
    item,
    context,
    fp,
    version,
    totalLines: result.totalLines,
    binary: result.binary,
    truncated: result.truncated,
    empty: !item && !result.binary && !result.truncated,
    collapsed: false,
  };
}
export default function BrowserApp() {
  return (
    <QueryClientProvider client={client}>
      <Browser />
    </QueryClientProvider>
  );
}
function Browser() {
  const host = useHost(),
    t = messages(host.zh),
    qc = useQueryClient();
  const stored = useRef(loadPrefs(localStorage)).current;
  const [state, setState] = useState<State>(() => {
      const initial = readState();
      return new URLSearchParams(location.hash.slice(1)).has("unified")
        ? initial
        : { ...initial, unified: stored.unified ?? initial.unified };
    }),
    [split, setSplit] = useState(stored.split ?? false),
    [wrap, setWrap] = useState(stored.wrap ?? false),
    [hideViewed, setHideViewed] = useState(stored.hideViewed ?? false),
    [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set()),
    [comparisonOpen, setComparisonOpen] = useState(false),
    [comparisonEntry, setComparisonEntry] = useState<"scope" | "commit" | "pr">(
      "scope",
    ),
    [keysOpen, setKeysOpen] = useState(false),
    [treePop, setTreePop] = useState(false),
    [nonce, setNonce] = useState(0),
    [pager, setPager] = useState<{
      stamp: string;
      busy: boolean;
      error?: string;
    }>({ stamp: "", busy: false }),
    [ctxDraft, setCtxDraft] = useState(""),
    [reveal, setReveal] = useState({ scope: "", n: 0 }),
    [width, setWidth] = useState(() => window.innerWidth),
    [height, setHeight] = useState<number | undefined>(undefined),
    rootRef = useRef<HTMLElement>(null),
    [treeWidth, setTreeWidth] = useState(() => {
      try {
        return Math.max(
          220,
          Math.min(
            420,
            stored.treeWidth ||
              Number(localStorage.getItem("diffview:tree-width")) ||
              280,
          ),
        );
      } catch {
        return 280;
      }
    }),
    [copied, setCopied] = useState(false),
    [collapseContext, setCollapseContext] = useState(
      stored.collapseContext ?? true,
    ),
    [showTree, setShowTree] = useState(
      () => stored.showTree ?? window.innerWidth >= 768,
    ),
    [filter, setFilter] = useState(""),
    [selected, setSelected] = useState(""),
    [records, setRecords] = useState<Record<string, Loaded>>(() =>
      dictionary(),
    ),
    [viewed, setViewed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        isConversationStorageKey(event.key)
      )
        invalidateConversationInventory(localStorage);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const manualJump = useRef<
    { path: string; serial: number; offset?: number } | undefined
  >(undefined);
  const [jumpRequest, setJumpRequest] = useState<
    { path: string; serial: number; offset?: number } | undefined
  >();
  const contexts = useRef<Record<string, number>>(dictionary());
  const handle = useRef<CodeViewHandle<undefined, undefined>>(null),
    scope = JSON.stringify(state),
    epoch = useRef(0),
    pending = useRef(new Set<string>()),
    controllers = useRef(new Set<AbortController>());
  // Conversation scope: the app is embedded in a chat's workspace and told which chat it belongs to.
  const chatId = useChatSessionId();
  const embedded = window.parent !== window;
  const [waited, setWaited] = useState(!embedded);
  useEffect(() => {
    if (waited) return;
    const timer = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(timer);
  }, [waited]);
  const scopeId = chatId ? "chat:" + chatId : embedded ? "embedded" : "page";
  const scopeReady = !!chatId || waited;
  const deepLink = useRef(
    new URLSearchParams(location.hash.slice(1)).has("repo"),
  );
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const ready = scopeReady && restoredId === scopeId;
  const scrollMemory = useScrollMemory(
    scopeId,
    scrollViewKey(state),
    localStorage,
  );
  useEffect(() => {
    if (!scopeReady || restoredId === scopeId) return;
    const first = restoredId === null;
    if (!(first && deepLink.current)) {
      const saved = loadChatState(scopeId, localStorage);
      // Saved before the branch/ref merge? Same migration as for links.
      const migrated = saved && {
        ...saved,
        ...(({ mode, filter, ref, target, dots, commit }) => ({
          mode,
          commit,
          filter,
          ref,
          target,
          dots,
        }))(normalizeMode(saved)),
      };
      setState((prev) => ({
        ...prev,
        ...(migrated ?? (first ? {} : DEFAULT_CHAT_STATE)),
      }));
    }
    setRestoredId(scopeId);
  }, [scopeReady, scopeId, restoredId]);
  const change = (patch: Partial<State>) =>
    setState((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    if (ready) saveChatState(scopeId, pickChatState(state), localStorage);
  }, [ready, scopeId, state]);
  useEffect(() => {
    savePrefs(
      {
        split,
        wrap,
        collapseContext,
        hideViewed,
        showTree,
        treeWidth,
        unified: state.unified,
      },
      localStorage,
    );
  }, [
    split,
    wrap,
    collapseContext,
    hideViewed,
    showTree,
    treeWidth,
    state.unified,
  ]);
  useEffect(() => {
    const on = () => setState(readState());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const hash = new URLSearchParams(
      Object.entries(state).filter((x): x is [string, string] => !!x[1]),
    ).toString();
    history.replaceState(
      null,
      "",
      location.pathname + location.search + "#" + hash,
    );
  }, [scope]);
  // The conversation's project (e.g. "default") decides which repository counts as its own.
  const chatProject = useQuery({
    queryKey: ["chat-project", chatId],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        "/api/chat/sessions/" + encodeURIComponent(chatId!),
        { credentials: "include", signal },
      );
      if (!res.ok) return "";
      const body = (await res.json()) as { projectPath?: string | null };
      return body.projectPath || "";
    },
    enabled: !!chatId,
    staleTime: 5 * 60_000,
  });
  const project = chatProject.data || "default";
  const repos = useQuery({
    queryKey: ["repos", project],
    queryFn: ({ signal }) =>
      api<{
        repos: Repo[];
        defaultRepo: string;
        homeRepo: string;
        selectedProject: string;
      }>("repos", { project }, signal),
    enabled: !chatId || chatProject.isFetched,
    refetchInterval: 60000,
  });
  useEffect(() => {
    if (!ready || !repos.data?.defaultRepo) return;
    if (!state.repo || !repos.data.repos.some((r) => r.path === state.repo))
      change({
        repo: repos.data.defaultRepo,
        base:
          repos.data.repos.find((r) => r.path === repos.data.defaultRepo)
            ?.base || "",
      });
  }, [ready, repos.data, state.repo]);
  const refs = useQuery({
    queryKey: ["refs", state.repo, state.mode === "pr"],
    queryFn: ({ signal }) =>
      api<RefData>(
        state.mode === "pr" ? "refs" : "revisions",
        { repo: state.repo },
        signal,
      ),
    enabled: ready && !!state.repo,
    refetchInterval: 60000,
  });
  const tracking = useQuery({
    queryKey: ["tracking", state.repo],
    queryFn: ({ signal }) =>
      api<TrackingInfo>("tracking", { repo: state.repo }, signal),
    enabled: ready && !!state.repo,
    refetchInterval: 15000,
  });
  const trackingUnavailable =
    state.mode === "unpushed" &&
    (!!tracking.error || tracking.data?.state !== "ready");
  const enabled =
    ready &&
    !!state.repo &&
    (state.mode !== "pr" || !!state.pr) &&
    (state.mode !== "commit" || !!state.commit) &&
    (state.mode !== "unpushed" || !trackingUnavailable);
  // Context lines every patch is cut with: the chosen amount, or the whole file when unchanged
  // lines are expanded. The server cuts all pages with it, so it is part of what a page *is*.
  const ctxParam = collapseContext ? state.unified : "10000";
  const refreshScope = useRef<string | undefined>(undefined);
  const filesKey =
    state.mode === "unpushed"
      ? [
          "files",
          scope,
          ctxParam,
          tracking.data?.head,
          tracking.data?.upstreamHead,
        ]
      : ["files", scope, ctxParam];
  const fileQuery = useQuery({
    queryKey: filesKey,
    queryFn: async ({ signal }) => {
      const held = qc.getQueryData<FilesData>(filesKey);
      const force = refreshScope.current === scope;
      if (force) refreshScope.current = undefined;
      const res = await api<FilesData | { unchanged: true; ms: number }>(
        "files",
        {
          ...state,
          ctx: ctxParam,
          have: force ? undefined : held?.fingerprint,
          refresh: force ? "1" : undefined,
        },
        signal,
      );
      // Same object back: nothing re-seeds, nothing re-renders.
      return "unchanged" in res && held ? held : (res as FilesData);
    },
    enabled,
    // Local changes are watched through `events`; other comparisons are polled, backing off
    // in proportion to how long the repository takes to answer.
    refetchInterval: (query) =>
      state.mode === "uncommitted"
        ? false
        : Math.max(15000, (query.state.data?.ms ?? 0) * 6),
  });
  // Disabled queries retain cached results. Never present a previous branch's Unpushed diff
  // after its tracking source disappears (or while a different HEAD is being loaded).
  const data = {
    ...fileQuery,
    data:
      trackingUnavailable ||
      (state.mode === "unpushed" &&
        fileQuery.data?.head !== tracking.data?.head)
        ? undefined
        : fileQuery.data,
  };
  const fallback = !!data.data?.fallback;
  const events = useQuery({
    queryKey: ["events", state.repo],
    queryFn: ({ signal }) =>
      api<{ fingerprint: string; ms: number }>(
        "events",
        { repo: state.repo },
        signal,
      ),
    enabled: ready && !!state.repo && state.mode === "uncommitted",
    refetchInterval: (query) => Math.max(3000, (query.state.data?.ms ?? 0) * 6),
  });
  useWorktreeFreshness({
    scope,
    context: ctxParam,
    mode: state.mode,
    listFingerprint: data.data?.fingerprint,
    eventFingerprint: events.data?.fingerprint,
  });
  // Two kinds of change. A different comparison, context size or an explicit refresh resets
  // everything (`scopeStamp`). A new fingerprint on the same comparison only means the files
  // changed underneath: what did not change is kept as it is (see the merge below), so a repository
  // that is being edited does not make the whole viewer rebuild and jump back to the top.
  const scopeStamp =
    scopeId +
    ":" +
    scope +
    ":" +
    ctxParam +
    ":" +
    nonce +
    ":" +
    trackingUnavailable;
  const stamp = scopeStamp + ":" + data.data?.fingerprint;
  // Long-lived callbacks read the freshest list-level facts through refs.
  const fpRef = useRef("");
  fpRef.current = data.data?.fingerprint ?? "";
  useEffect(() => {
    epoch.current++;
    pending.current.clear();
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setRecords(dictionary());
    contexts.current = dictionary();
    manualJump.current = undefined;
    setSelected("");
    return () => {
      controllers.current.forEach((c) => c.abort());
    };
  }, [scopeStamp]);
  const viewedKey =
    "diffview:viewed:" +
    state.repo +
    ":" +
    JSON.stringify(
      comparisonIdentity({
        ...state,
        ref: state.ref || data.data?.compare?.ref || "",
      }),
    ) +
    ":" +
    (data.data?.head || "");
  useEffect(() => {
    try {
      const marks = new Set<string>(loadViewed(viewedKey, localStorage));
      setViewed(marks);
      setCollapsedPaths(new Set(marks));
    } catch {
      setViewed(new Set());
    }
  }, [viewedKey]);
  const toggleViewed = useCallback(
    (path: string) =>
      setViewed((prev) => {
        const next = new Set(prev);
        const marking = !next.has(path);
        marking ? next.add(path) : next.delete(path);
        setCollapsedPaths((paths) => {
          const result = new Set(paths);
          marking ? result.add(path) : result.delete(path);
          return result;
        });
        try {
          saveViewed(viewedKey, [...next], localStorage);
        } catch {}
        return next;
      }),
    [viewedKey],
  );
  // One file, on the guardian's explicit request: a collapsed file, "load full file", or more
  // context. Bulk loading never goes through here; it is paged (see the pager below).
  const load = useCallback(
    (path: string, anyway = false, requestedContext?: number) => {
      if (fallback && (anyway || requestedContext !== undefined)) return;
      if (pending.current.has(path)) return;
      pending.current.add(path);
      const generation = epoch.current,
        requestFp = fpRef.current;
      const context =
        requestedContext ?? contexts.current[path] ?? Number(ctxParam);
      contexts.current[path] = context;
      setCollapsedPaths((prev) => {
        if (!prev.has(path)) return prev;
        const n = new Set(prev);
        n.delete(path);
        return n;
      });
      setRecords((r) =>
        Object.assign(dictionary<Loaded>(), r, {
          [path]: { ...r[path], busy: true, error: undefined },
        }),
      );
      const controller = new AbortController();
      controllers.current.add(controller);
      void (async () => {
        try {
          const result = await api<PatchData>(
            "patch",
            {
              ...state,
              path,
              ctx: ctxParam,
              unified: String(context),
              fp: fpRef.current,
              anyway: anyway ? "1" : "0",
            },
            controller.signal,
          );
          if (generation === epoch.current && requestFp === fpRef.current) {
            const record = recordFromPatch(path, result, context, requestFp);
            setRecords((r) =>
              Object.assign(dictionary<Loaded>(), r, {
                [path]: {
                  ...record,
                  error: anyway && result.truncated ? "tooLarge" : record.error,
                },
              }),
            );
          }
        } catch (e) {
          if (
            !controller.signal.aborted &&
            generation === epoch.current &&
            e instanceof Error &&
            e.message === "stale_view"
          ) {
            setNonce((n) => n + 1);
            void qc.resetQueries({
              queryKey: ["files", scope, ctxParam],
              exact: false,
            });
            return;
          }
          if (!controller.signal.aborted && generation === epoch.current)
            setRecords((r) =>
              Object.assign(dictionary<Loaded>(), r, {
                [path]: { error: e instanceof Error ? e.message : "internal" },
              }),
            );
        } finally {
          controllers.current.delete(controller);
          if (generation === epoch.current) pending.current.delete(path);
        }
      })();
    },
    [scope, ctxParam, fallback],
  );
  const allFiles = data.data?.files || [],
    visibleFiles = useMemo(
      () =>
        allFiles.filter(
          (f) =>
            f.path.toLowerCase().includes(filter.toLowerCase()) &&
            (!hideViewed || !viewed.has(f.path)),
        ),
      [data.data, filter, hideViewed, viewed],
    );
  // Patches arrive in pages, in list order, over a sequence of the files that have a text diff.
  const eligible = useMemo(
    () => allFiles.filter(isPageable).map((f) => f.path),
    [data.data],
  );
  const rank = useMemo(
    () => new Map(eligible.map((path, i) => [path, i] as const)),
    [eligible],
  );
  const pagerBusy = useRef(false);
  pagerBusy.current = pager.busy;
  /**
   * Adds delivered patches to the records. Content that is identical to what is already held keeps
   * the very same record (no re-parse, no new item for Pierre to re-render or re-highlight); it is
   * only re-stamped as current.
   */
  const seed = (patches: PageData["patches"], forFp: string) =>
    setRecords((r) => {
      const next = dictionary(r);
      for (const [path, result] of Object.entries(patches)) {
        const old = r[path];
        const version = result.patch ? contentVersion(result.patch) : undefined;
        next[path] =
          old &&
          old.item &&
          old.version === version &&
          old.context === Number(ctxParam)
            ? { ...old, fp: forFp, totalLines: result.totalLines }
            : recordFromPatch(path, result, Number(ctxParam), forFp);
      }
      return next;
    });
  // The first page came with the file list: merge it in one update. On a soft refresh (same
  // comparison, new fingerprint) the records already held stay, flagged stale by their older `fp`;
  // those in the viewer's window are re-fetched below, so what is on screen is current while
  // untouched files are neither rebuilt nor re-highlighted.
  useEffect(() => {
    const page = data.data?.page;
    if (!page || !data.data) return;
    const listed = new Map(data.data.files.map((f) => [f.path, f]));
    setRecords((prev) => {
      const kept = dictionary<Loaded>();
      for (const [path, record] of Object.entries(prev)) {
        const file = listed.get(path);
        if (
          file &&
          isPageable(file) &&
          !record.busy &&
          !record.error &&
          record.context === Number(ctxParam)
        )
          kept[path] = record;
      }
      return kept;
    });
    contexts.current = dictionary();
    seed(page.patches, data.data.fingerprint);
    setPager({ stamp, busy: false });
  }, [stamp]);
  useEffect(() => {
    if (!visibleFiles.some((f) => f.path === selected))
      setSelected(visibleFiles[0]?.path || "");
  }, [visibleFiles, selected]);
  const items = useMemo(
    () =>
      visibleFiles.map((f) => {
        const r = records[f.path];
        return r?.item
          ? {
              ...r.item,
              collapsed: collapsedPaths.has(f.path) || !!r.collapsed,
              version: reviewItemVersion(
                r.item.version,
                collapsedPaths.has(f.path) || !!r.collapsed,
              ),
            }
          : ({
              id: f.path,
              type: "file",
              file: {
                name: f.path,
                contents: "",
                cacheKey: scopeStamp + f.path,
              },
              collapsed: true,
            } as CodeViewItem<undefined>);
      }),
    [visibleFiles, records, scopeStamp, collapsedPaths],
  );
  // Patches load concurrently, but files are shown strictly in order, one at a time, and only
  // once settled, so content is only ever appended below what is already on screen.
  const revealed = reveal.scope === scope ? reveal.n : 0;
  const settledPrefix = useMemo(() => {
    let n = 0;
    for (const f of visibleFiles) {
      const r = records[f.path];
      const settled =
        collapsedPaths.has(f.path) ||
        f.binary ||
        f.collapsed ||
        f.added + f.deleted === 0 ||
        (!!r &&
          !r.busy &&
          (!!r.item || !!r.binary || !!r.truncated || !!r.empty || !!r.error));
      if (!settled) break;
      n++;
    }
    return n;
  }, [visibleFiles, records, collapsedPaths]);
  useEffect(() => {
    setReveal((r) => (r.scope === scope ? r : { scope, n: 0 }));
  }, [scope]);
  useEffect(() => {
    if (reveal.scope !== scope || settledPrefix <= reveal.n) return;
    // Pace the first screenful one file at a time; later files append off-screen in bulk.
    const next = reveal.n < 12 ? reveal.n + 1 : settledPrefix;
    const timer = setTimeout(
      () => setReveal({ scope, n: next }),
      reveal.n === 0 ? 0 : reveal.n < 12 ? 60 : 0,
    );
    return () => clearTimeout(timer);
  }, [settledPrefix, scope, reveal]);
  // Pages are fetched on demand around where the guardian is looking, never ahead of everything:
  // from the focused file on, the next visible pageable files must be loaded. The server
  // applies the same filter and accepts any cursor, so jumping or filtering costs one request, not
  // a walk through every earlier page. At most one request is in flight.
  const filterQ = filter.trim().toLowerCase();
  const eligibleQ = useMemo(
    () =>
      allFiles
        .filter((f) => isPageable(f) && f.path.toLowerCase().includes(filterQ))
        .map((f) => f.path),
    [data.data, filterQ],
  );
  const rankQ = useMemo(
    () => new Map(eligibleQ.map((path, i) => [path, i] as const)),
    [eligibleQ],
  );
  const demand = useMemo(
    () => pageDemand(visibleFiles, selected, rankQ),
    [visibleFiles, selected, rankQ],
  );
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (pager.stamp !== stamp || pager.busy || pager.error) return;
    let target = -1;
    for (const r of demand)
      if (records[eligibleQ[r]]?.fp !== fpRef.current) {
        target = r;
        break;
      }
    if (target < 0) return;
    const key = stamp + "|" + filterQ + "|" + target;
    if (asked.current.has(key)) return; // the server already answered for this cursor
    asked.current.add(key);
    const generation = epoch.current,
      requestFp = fpRef.current,
      controller = new AbortController();
    controllers.current.add(controller);
    setPager((p) => ({ ...p, busy: true }));
    api<PageData>(
      "patches",
      {
        ...state,
        ctx: ctxParam,
        fp: fpRef.current,
        cursor: String(target),
        q: filterQ,
      },
      controller.signal,
    )
      .then((page) => {
        if (generation !== epoch.current || requestFp !== fpRef.current) return;
        seed(page.patches, requestFp);
        setPager((p) => ({ ...p, busy: false }));
      })
      .catch((e) => {
        if (controller.signal.aborted || generation !== epoch.current) return;
        asked.current.delete(key);
        if (e instanceof Error && e.message === "stale_view") {
          setNonce((n) => n + 1);
          void qc.resetQueries({
            queryKey: ["files", scope, ctxParam],
            exact: false,
          });
          return;
        }
        setPager((p) => ({
          ...p,
          busy: false,
          error: e instanceof Error ? e.message : "internal",
        }));
      })
      .finally(() => controllers.current.delete(controller));
  }, [pager, stamp, records, demand, eligibleQ, filterQ]);
  const shownItems = useMemo(() => items.slice(0, revealed), [items, revealed]);
  const selectFile = useCallback(
    (path: string, offset = 0) => {
      const request = { path, serial: Date.now(), offset };
      manualJump.current = request;
      setJumpRequest(request);
      setSelected(path);
      const index = visibleFiles.findIndex((f) => f.path === path);
      if (index >= 0)
        setReveal((r) => ({
          scope,
          // Leave a viewport of trailing headers so the anchor is not clamped
          // against an artificial end while earlier patches are still lazy.
          n: Math.min(
            visibleFiles.length,
            Math.max(
              r.scope === scope ? r.n : 0,
              index + Math.ceil(window.innerHeight / 44) + 2,
            ),
          ),
        }));
      handle.current?.scrollTo({
        type: "item",
        id: path,
        align: "start",
        offset: -offset,
      });
    },
    [visibleFiles, scope],
  );
  useEffect(() => {
    if (!ready || !data.data || !shownItems.length || !handle.current) return;
    const instance = handle.current.getInstance();
    if (!instance) return;
    scrollMemory.restore(instance, (saved) => {
      if (saved && visibleFiles.some((file) => file.path === saved.file))
        selectFile(saved.file, saved.offset);
      else handle.current?.scrollTo({ type: "position", position: 0 });
    });
  }, [
    ready,
    data.data,
    shownItems,
    visibleFiles,
    selectFile,
    scrollMemory,
    host.zh,
  ]);
  // Lazy patches change estimated heights. Honor the explicit navigation intent until
  // the patch/prefetch queue settles; wheel/touch/pointer input always wins.
  useEffect(() => {
    const request = manualJump.current;
    if (!request) return;
    let second = 0,
      third = 0,
      quiet: ReturnType<typeof setTimeout> | undefined;
    const alignRendered = () => {
      if (manualJump.current !== request) return;
      const instance = handle.current?.getInstance(),
        container = instance?.getContainerElement();
      const element = instance
        ?.getRenderedItems()
        .find((item) => item.id === request.path)?.element;
      if (container && element) {
        const delta =
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top;
        const offset = Math.min(
          request.offset ?? 0,
          Math.max(0, element.getBoundingClientRect().height - 44),
        );
        if (Math.abs(delta + offset) > 1) container.scrollTop += delta + offset;
      }
    };
    const frame = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (manualJump.current !== request) return;
        handle.current?.scrollTo({
          type: "item",
          id: request.path,
          align: "start",
          offset: -(request.offset ?? 0),
        });
        third = requestAnimationFrame(alignRendered);
        if (!pagerBusy.current && !pending.current.has(request.path))
          quiet = setTimeout(() => {
            alignRendered();
            if (manualJump.current === request) manualJump.current = undefined;
          }, 800);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(second);
      cancelAnimationFrame(third);
      if (quiet) clearTimeout(quiet);
    };
  }, [records, shownItems, jumpRequest]);
  useEffect(() => {
    if (!jumpRequest) return;
    const timer = setTimeout(() => {
      if (manualJump.current === jumpRequest) manualJump.current = undefined;
    }, 10000);
    return () => clearTimeout(timer);
  }, [jumpRequest]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    // Fill from wherever the app starts down to the bottom of the viewport, whatever hosts it.
    const fit = () => {
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(384, Math.floor(window.innerHeight - top)));
    };
    fit();
    window.addEventListener("resize", fit);
    const page = new ResizeObserver(fit);
    page.observe(document.documentElement);
    return () => {
      observer.disconnect();
      page.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e
          .composedPath()
          .some(
            (n) =>
              n instanceof HTMLElement &&
              (n.isContentEditable ||
                ["INPUT", "SELECT", "TEXTAREA"].includes(n.tagName) ||
                n.getAttribute("role") === "combobox"),
          )
      )
        return;
      if (e.key === "?") {
        e.preventDefault();
        setKeysOpen((open) => !open);
        return;
      }
      if (e.key === "Escape") {
        setShowTree(false);
        return;
      }
      if (
        [
          "n",
          "p",
          "PageDown",
          "PageUp",
          "ArrowDown",
          "ArrowUp",
          "Home",
          "End",
          " ",
        ].includes(e.key)
      )
        manualJump.current = undefined;
      let index = visibleFiles.findIndex((f) => f.path === selected);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        index = Math.min(
          visibleFiles.length - 1,
          Math.max(0, index + (e.key === "j" ? 1 : -1)),
        );
        if (visibleFiles[index]) selectFile(visibleFiles[index].path);
      } else if ((e.key === "n" || e.key === "p") && selected) {
        const item = records[selected]?.item;
        if (item?.type === "diff") {
          const hunks = item.fileDiff.hunks;
          const selection = handle.current?.getSelectedLines();
          const current =
            selection?.id === selected ? selection.range.start : 0;
          const lines = hunks.map((h) => h.additionStart);
          const line =
            e.key === "n"
              ? lines.find((l) => l > current)
              : [...lines].reverse().find((l) => l < current);
          if (line) {
            e.preventDefault();
            handle.current?.scrollTo({
              type: "line",
              id: selected,
              lineNumber: line,
              side: "additions",
              align: "start",
            });
            handle.current?.setSelectedLines({
              id: selected,
              range: { start: line, end: line, side: "additions" },
            });
          }
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [visibleFiles, selected, records, selectFile]);
  // Layout follows the width of the app itself, not the window, so it also works inside a side panel.
  const narrow = width < 768,
    compact = width < 640;
  const refresh = () => {
    refreshScope.current = scope;
    void qc.invalidateQueries({ queryKey: ["repos", project] });
    void qc.invalidateQueries({ queryKey: ["refs", state.repo] });
    void qc.invalidateQueries({ queryKey: ["tracking", state.repo] });
    void qc.invalidateQueries({ queryKey: ["history", state.repo] });
    // Cancel even an initial in-flight load: invalidation alone can reuse that request
    // and swallow the explicit refresh intent (including the PR TTL bypass).
    void qc
      .cancelQueries({ queryKey: ["files", scope] })
      .then(() => qc.invalidateQueries({ queryKey: ["files", scope] }))
      .catch(() => {});
    // A new stamp resets what is loaded and re-seeds it from the refreshed list and pages.
    setNonce((n) => n + 1);
  };
  const prState = refs.data?.prState;
  const defaultBaseName =
    repos.data?.repos.find((r) => r.path === state.repo)?.base ||
    data.data?.compare?.ref ||
    "";
  const selectedPrInfo = refs.data?.prs?.find(
    (pr) => String(pr.number) === state.pr,
  );
  const desc = describeComparison(
    normalizeMode(state),
    {
      defaultBase: defaultBaseName,
      pr: selectedPrInfo,
      upstream: tracking.data?.upstream,
    },
    t,
  );
  // Counts only mean something once there is a result; "+0 −0" next to a half-made choice or an
  // empty comparison would read as a finished answer.
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(state.repo + "/" + path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  // Standalone navigation uses the public host event. Embedded views expose an ordinary
  // new-tab link instead: never inspect the parent's React tree or mutate its private store.
  const openFile = (file: string) => {
    if (!worktreeSide(state)) return;
    const url = projectFileUrl(state.repo, file);
    if (url)
      window.dispatchEvent(
        new CustomEvent(HOST_NAVIGATE_EVENT, { detail: { path: url } }),
      );
  };
  const expandContext = (
    path: string,
    direction: "up" | "down" | "all" = "down",
  ) => {
    if (fallback) return;
    load(
      path,
      direction === "all",
      nextContext(contexts.current[path] ?? Number(state.unified), direction),
    );
  };
  const toggleFile = (file: FileEntry) => {
    if (file.conflicted || file.typeChanged) return;
    if (!records[file.path]?.item) {
      // Waiting for its page: nothing to ask for. Otherwise it is collapsed/large: load on request.
      if (!file.binary && !(rank.has(file.path) && !records[file.path]))
        load(file.path);
      return;
    }
    setCollapsedPaths((prev) => {
      const n = new Set(prev);
      n.has(file.path) ? n.delete(file.path) : n.add(file.path);
      return n;
    });
  };
  const spyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(spyTimer.current), []);
  const onViewerScroll = (
    _top: number,
    instance: NonNullable<
      ReturnType<CodeViewHandle<undefined, undefined>["getInstance"]>
    >,
    settled = false,
  ) => {
    // A long jump (End key, dragging the scrollbar) fires one scroll event, when the viewer still
    // shows the items from before the jump. Look again once it has rendered the new position.
    if (!settled) {
      clearTimeout(spyTimer.current);
      spyTimer.current = setTimeout(
        () => onViewerScroll(_top, instance, true),
        150,
      );
    }
    if (manualJump.current) {
      setSelected((prev) =>
        prev === manualJump.current?.path ? prev : manualJump.current!.path,
      );
      return;
    }
    const containerTop =
      instance.getContainerElement()?.getBoundingClientRect().top || 0;
    const rows = instance.getRenderedItems().map((item) => ({
      id: item.id,
      top: item.element.getBoundingClientRect().top - containerTop + _top,
    }));
    // The toolbar is outside this scroll container; do not double-count its 44px header.
    const id = activeFileAt(rows, _top, 1);
    if (id) {
      setSelected((prev) => (prev === id ? prev : id));
      if (ready)
        scrollMemory.remember(
          {
            top: _top,
            file: id,
            offset: Math.max(0, _top - (instance.getTopForItem(id) ?? _top)),
          },
          instance,
        );
    }
  };
  const allCollapsed =
    visibleFiles.length > 0 &&
    visibleFiles.every((f) => collapsedPaths.has(f.path));
  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = e.clientX,
      width = treeWidth;
    const move = (ev: PointerEvent) =>
      setTreeWidth(Math.max(220, Math.min(420, width + start - ev.clientX)));
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  useEffect(() => {
    try {
      localStorage.setItem("diffview:tree-width", String(treeWidth));
    } catch {}
  }, [treeWidth]);
  const keepOpen = (e: Event) => e.preventDefault();
  const repoGroups = groupRepositories(
    repos.data?.repos || [],
    repos.data?.selectedProject || "",
  );
  const switchRepo = (repo: string) =>
    change({
      repo,
      base: repos.data?.repos.find((r) => r.path === repo)?.base || "",
      ref: "",
      pr: "",
      commit: "",
    });
  // Context lines are typed freely: keep a local draft and commit a valid value shortly after typing.
  const ctxValid = /^\d{1,5}$/.test(ctxDraft) && Number(ctxDraft) <= 10000;
  useEffect(() => setCtxDraft(state.unified), [state.unified]);
  useEffect(() => {
    if (!ctxValid || ctxDraft === state.unified) return;
    const timer = setTimeout(
      () => change({ unified: String(Number(ctxDraft)) }),
      450,
    );
    return () => clearTimeout(timer);
  }, [ctxDraft, ctxValid, state.unified]);
  const repoName = state.repo.split("/").at(-1) || t.repo;
  const empty = describeEmpty(normalizeMode(state), {
    hideViewed: hideViewed && allFiles.length > 0,
    same: !!data.data?.compare?.same,
    prState,
    trackingState: tracking.data?.state,
    openPrs: refs.data?.prs?.length ?? 0,
    // Known from the open-PR list, or because the comparison itself ran and found files.
    prKnown: !!selectedPrInfo || allFiles.length > 0,
  });
  const emptyFill = (text: string) =>
    text
      .replace("{from}", desc.from)
      .replace("{to}", desc.to)
      .replace("{pr}", state.pr || "")
      .replace("{upstream}", tracking.data?.upstream || "@{upstream}");
  const emptyAction = {
    "target-worktree": {
      label: t.emptyCompareWorktree,
      run: () => change({ target: "worktree" }),
    },
    "filter-all": {
      label: t.emptyShowAll,
      run: () => change({ filter: "all" }),
    },
    "open-menu": {
      label: state.mode === "commit" ? t.chooseCommit : t.emptyChoosePr,
      run: () => {
        setComparisonEntry(state.mode === "commit" ? "commit" : "pr");
        setComparisonOpen(true);
      },
    },
  } as const;
  const emptyText: Record<typeof empty.kind, [string, string?]> = {
    "unpushed-clean": [
      tracking.data?.ahead
        ? t.emptyUnpushedNetZero.replace("{n}", String(tracking.data.ahead))
        : t.emptyUnpushed,
      emptyFill(t.emptyUnpushedHint) +
        (tracking.data?.behind
          ? " " + t.behindUpstream.replace("{n}", String(tracking.data.behind))
          : ""),
    ],
    "tracking-unavailable": [
      errorMessage(tracking.data?.state || "internal", t),
      t.trackingUnavailable,
    ],
    "pick-commit": [t.chooseCommit],
    "all-viewed": [t.allViewed],
    "local-clean": [t.emptyLocalClean, t.emptyLocalCleanHint],
    "local-staged": [t.emptyLocalStaged],
    "local-unstaged": [t.emptyLocalUnstaged],
    "same-as-base": [t.emptySameAsBase, t.emptySameAsBaseHint],
    "same-as-worktree": [t.emptySameAsWorktree],
    "no-difference": [t.emptyNoDiff],
    "pick-pr": [t.choose],
    "no-open-pr": [t.emptyNoOpenPr, t.emptyNoOpenPrHint],
    "pr-not-found": [t.emptyPrNotFound],
    "pr-unavailable": [(prState && t[prState as "missing"]) || t.unavailable],
  };
  const emptyState = (
    <EmptyState
      title={emptyFill(emptyText[empty.kind][0])}
      hint={emptyText[empty.kind][1]}
      action={empty.action ? emptyAction[empty.action] : undefined}
    />
  );
  const loadingSkeleton = (
    <div role="status" aria-label={t.loading} className="space-y-6 p-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-5 w-2/5 rounded-lg" />
          {[0, 1, 2].map((n) => (
            <Skeleton
              key={n}
              className={`h-5 rounded-md ${n === 1 ? "w-3/5" : "w-5/6"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
  const treeBody = (
    <>
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-2.5 text-muted-foreground"
          />
          <Input
            aria-label={t.filter}
            placeholder={t.filter}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg pl-8"
          />
        </div>
      </div>
      <div className="flex items-center justify-between px-4 pb-2 text-xs text-muted-foreground">
        <span>
          {visibleFiles.length} {t.files}
        </span>
        <span>
          {allFiles.filter((f) => viewed.has(f.path)).length} {t.viewed}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <FileTree
          files={visibleFiles}
          selected={selected}
          onSelect={(path) => {
            selectFile(path);
            if (narrow) setTreePop(false);
          }}
          viewed={viewed}
          t={t}
        />
      </div>
    </>
  );
  return (
    <main
      ref={rootRef}
      aria-label="Diff"
      style={height ? { height } : undefined}
      className="flex h-dvh min-h-96 flex-col overflow-hidden bg-[var(--app-canvas)] text-foreground"
    >
      <header
        className={
          compact
            ? "grid min-h-14 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2 px-3 py-2"
            : "flex min-h-14 shrink-0 items-center gap-2 px-3 py-2"
        }
        aria-label={t.toolbar}
      >
        <div className="flex min-w-0 shrink items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Pill
                aria-label={t.repo}
                title={`${t.repo}: ${state.repo}`}
                style={{
                  maxWidth: compact ? "100%" : undefined,
                  flexShrink: 1,
                }}
                className={compact ? "max-w-full" : "max-w-48"}
              >
                <FolderGit2
                  size={15}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="truncate">{repoName}</span>
              </Pill>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              collisionPadding={8}
              className="max-h-80 w-[min(24rem,var(--radix-dropdown-menu-content-available-width))] overflow-y-auto"
            >
              <DropdownMenuRadioGroup
                value={state.repo}
                onValueChange={switchRepo}
              >
                <DropdownMenuLabel title={repos.data?.selectedProject}>
                  {t.relatedRepos}
                </DropdownMenuLabel>
                {repoGroups.current.length ? (
                  repoGroups.current.map((r) => (
                    <DropdownMenuRadioItem
                      key={r.path}
                      value={r.path}
                      title={r.path}
                    >
                      <span className="truncate">{r.name}</span>
                    </DropdownMenuRadioItem>
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-aux text-muted-foreground">
                    {t.noRelatedRepos}
                  </p>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t.otherRepos}</DropdownMenuLabel>
                {repoGroups.others.length ? (
                  repoGroups.others.map((r) => (
                    <DropdownMenuRadioItem
                      key={r.path}
                      value={r.path}
                      title={r.path}
                    >
                      <span className="truncate">{r.name}</span>
                    </DropdownMenuRadioItem>
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-aux text-muted-foreground">
                    {t.noOtherRepos}
                  </p>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ComparisonMenu
          state={state}
          change={change}
          desc={desc}
          data={data.data}
          refs={refs.data}
          tracking={tracking.data}
          defaultBase={defaultBaseName}
          t={t}
          zh={host.zh}
          open={comparisonOpen}
          commitEntry={comparisonEntry === "commit"}
          prEntry={comparisonEntry === "pr"}
          setOpen={(value) => {
            setComparisonEntry("scope");
            setComparisonOpen(value);
          }}
        />
        <div className="ml-auto flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-border/60 p-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.options}
                title={t.options}
                className="h-8 w-8 rounded-full text-muted-foreground"
              >
                <MoreHorizontal size={17} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div
                className="flex min-h-[var(--control-min-h)] items-center gap-2 px-2 py-1 text-ui"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <label htmlFor="dv-context" className="min-w-0 flex-1 truncate">
                  {t.contextLines}
                </label>
                <Input
                  id="dv-context"
                  disabled={fallback}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={!ctxValid}
                  title={ctxValid ? undefined : t.invalid_context}
                  value={ctxDraft}
                  onChange={(e) => setCtxDraft(e.target.value.trim())}
                  onBlur={() => setCtxDraft(state.unified)}
                  className="h-8 w-16 text-right tabular-nums"
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={wrap}
                onCheckedChange={setWrap}
                onSelect={keepOpen}
              >
                <WrapText />
                {t.wrap}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                disabled={fallback}
                checked={collapseContext}
                onCheckedChange={setCollapseContext}
                onSelect={keepOpen}
              >
                <ChevronsDownUp />
                {t.context}
              </DropdownMenuCheckboxItem>
              {compact && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={refresh}>
                    <RefreshCw />
                    {t.refresh}
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={split}
                    onCheckedChange={setSplit}
                    onSelect={keepOpen}
                  >
                    <Columns2 />
                    {t.split}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      setCollapsedPaths(
                        allCollapsed
                          ? new Set()
                          : new Set(allFiles.map((f) => f.path)),
                      )
                    }
                  >
                    {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
                    {allCollapsed ? t.expandAll : t.collapseAll}
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={hideViewed}
                    onCheckedChange={setHideViewed}
                    onSelect={keepOpen}
                  >
                    {hideViewed ? <EyeOff /> : <Eye />}
                    {t.hideViewed}
                  </DropdownMenuCheckboxItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {!compact && (
            <>
              <Quiet
                label={t.refresh}
                onClick={refresh}
                disabled={data.isFetching}
              >
                <RefreshCw
                  size={16}
                  className={data.isFetching ? "animate-spin" : ""}
                />
              </Quiet>
              <Quiet
                label={split ? t.unified : t.split}
                onClick={() => setSplit(!split)}
                pressed={split}
              >
                {split ? <Rows2 size={16} /> : <Columns2 size={16} />}
              </Quiet>
              <Quiet
                label={allCollapsed ? t.expandAll : t.collapseAll}
                onClick={() =>
                  setCollapsedPaths(
                    allCollapsed
                      ? new Set()
                      : new Set(allFiles.map((f) => f.path)),
                  )
                }
              >
                {allCollapsed ? (
                  <ChevronsUpDown size={16} />
                ) : (
                  <ChevronsDownUp size={16} />
                )}
              </Quiet>
              <Quiet
                label={t.hideViewed}
                onClick={() => setHideViewed(!hideViewed)}
                pressed={hideViewed}
              >
                {hideViewed ? <EyeOff size={16} /> : <Eye size={16} />}
              </Quiet>
              <Popover open={keysOpen} onOpenChange={setKeysOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.shortcuts}
                    title={t.shortcuts}
                    aria-expanded={keysOpen}
                    className={`h-8 w-8 shrink-0 rounded-full text-muted-foreground ${keysOpen ? "bg-accent text-foreground" : ""}`}
                  >
                    <Keyboard size={16} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                  <span className="text-sm font-medium">{t.shortcuts}</span>
                  <dl className="grid gap-2 text-sm">
                    {(
                      [
                        [["j"], t.scNextFile],
                        [["k"], t.scPrevFile],
                        [["n"], t.scNextHunk],
                        [["p"], t.scPrevHunk],
                        [["?"], t.scToggleHelp],
                      ] as const
                    ).map(([keys, label]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-3"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="m-0 flex gap-1">
                          {keys.map((k) => (
                            <kbd
                              key={k}
                              className="min-w-6 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs text-foreground"
                            >
                              {k}
                            </kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </PopoverContent>
              </Popover>
            </>
          )}
          {narrow ? (
            <Popover open={treePop} onOpenChange={setTreePop}>
              <PopoverTrigger asChild>
                <Quiet label={t.folders} pressed={treePop}>
                  <PanelRight size={16} />
                </Quiet>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="flex max-h-[70vh] w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0"
              >
                {treeBody}
              </PopoverContent>
            </Popover>
          ) : (
            <Quiet
              label={t.folders}
              onClick={() => setShowTree(!showTree)}
              pressed={showTree}
            >
              <PanelRight size={16} />
            </Quiet>
          )}
        </div>
      </header>
      {fallback && (
        <p
          role="status"
          className="shrink-0 px-3 pb-2 text-aux text-muted-foreground"
        >
          {t.fallbackDiff}
        </p>
      )}
      {copied && (
        <div
          role="status"
          className="absolute bottom-5 left-1/2 z-50 rounded-lg bg-popover px-3 py-2 text-sm shadow-sm"
        >
          {t.copied}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <section
          aria-label={t.files}
          className="flex min-w-0 flex-1 flex-col"
          onWheel={() => {
            manualJump.current = undefined;
          }}
          onTouchMove={() => {
            manualJump.current = undefined;
          }}
          onPointerDown={() => {
            manualJump.current = undefined;
          }}
        >
          {(repos.error || refs.error || tracking.error || data.error) && (
            <div
              role="alert"
              className="m-3 rounded-lg bg-destructive-bg p-3 text-sm text-destructive"
            >
              {data.data
                ? t.stale
                : errorMessage(
                    (data.error || tracking.error || refs.error || repos.error)
                      ?.message || "internal",
                    t,
                  )}
              <Button variant="ghost" size="sm" onClick={refresh}>
                {t.retry}
              </Button>
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {!ready ||
            repos.isPending ||
            (enabled && (data.isPending || (!data.data && data.isFetching))) ||
            (state.mode === "unpushed" && tracking.isPending) ||
            (items.length > 0 && revealed === 0) ? (
              loadingSkeleton
            ) : !repos.data?.repos.length ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {t.noRepo}
              </div>
            ) : (state.mode === "pr" && !state.pr) || !items.length ? (
              emptyState
            ) : (
              <Pool>
                <Viewer
                  key={scopeId + ":" + scope + ":" + host.zh}
                  handle={handle}
                  items={shownItems}
                  dark={host.dark}
                  split={split}
                  expanded={!fallback && !collapseContext}
                  contextAvailable={!fallback}
                  wrap={wrap}
                  onScroll={onViewerScroll}
                  t={t}
                  onContext={expandContext}
                  records={records}
                  header={(item) => {
                    const f = visibleFiles.find((f) => f.path === item.id);
                    if (!f) return null;
                    return (
                      <DiffHeader
                        file={f}
                        contextAvailable={!fallback}
                        record={records[f.path]}
                        collapsed={
                          collapsedPaths.has(f.path) ||
                          (!records[f.path]?.item && f.collapsed)
                        }
                        t={t}
                        viewed={viewed.has(f.path)}
                        onViewed={() => toggleViewed(f.path)}
                        queued={rank.has(f.path) && !records[f.path]}
                        onLoad={(anyway) =>
                          load(f.path, anyway, anyway ? 10000 : undefined)
                        }
                        onToggle={() => toggleFile(f)}
                        onCopy={() => void copyPath(f.path)}
                        openUrl={
                          !worktreeSide(state) ||
                          f.typeChanged ||
                          f.status.startsWith("D")
                            ? undefined
                            : projectFileUrl(state.repo, f.path)
                        }
                        onOpen={embedded ? undefined : () => openFile(f.path)}
                        onContext={() => expandContext(f.path)}
                      />
                    );
                  }}
                />
              </Pool>
            )}
            {pager.error ? (
              <div
                role="alert"
                className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-popover py-1 pl-3 pr-1 text-xs text-destructive shadow-sm"
              >
                {errorMessage(pager.error, t)}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 rounded-full px-2 text-xs"
                  onClick={() => setPager((p) => ({ ...p, error: undefined }))}
                >
                  {t.retry}
                </Button>
              </div>
            ) : (
              pager.busy &&
              revealed < visibleFiles.length && (
                <div
                  role="status"
                  className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
                >
                  <LoaderCircle size={12} className="animate-spin" />
                  {t.loadingFiles
                    .replace("{n}", String(revealed))
                    .replace("{total}", String(visibleFiles.length))}
                </div>
              )
            )}
          </div>
        </section>
        {showTree && !narrow && (
          <>
            <div
              role="separator"
              aria-label={t.resizeTree}
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={resize}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft")
                  setTreeWidth((w) => Math.min(420, w + 20));
                if (e.key === "ArrowRight")
                  setTreeWidth((w) => Math.max(220, w - 20));
              }}
              className="z-20 w-1 shrink-0 cursor-col-resize touch-none bg-border/40 transition-colors hover:bg-primary"
            />
            <aside
              aria-label={t.files}
              className="flex flex-col bg-[var(--app-canvas)]"
              style={{ width: treeWidth }}
            >
              {treeBody}
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
