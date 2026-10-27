import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@rome-os/ui/dropdown-menu";
import { Input } from "@rome-os/ui/input";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { Description } from "../shared/describe";
import type { CommitInfo, TrackingInfo } from "../lib/git";
import type { FilesData, RefData, State } from "./types";
import type { Messages } from "./i18n";
import { errorMessage } from "./i18n";
import { api } from "./api";
import { Pill, Stats } from "./ReviewParts";
import type { ChangeCount } from "../lib/attributes";
import type { ReviewContext } from "../shared/reviewContext";

interface Props {
  state: State;
  change(patch: Partial<State>): void;
  desc: Description;
  data?: FilesData;
  /** Fast, local-only branch/tag/commit data. */
  refs?: RefData;
  /** Bounded GitHub PR data, loaded independently so it cannot block local refs. */
  pullRequests?: RefData;
  pullRequestsPending?: boolean;
  pullRequestsError?: string;
  retryPullRequests(): void;
  tracking?: TrackingInfo;
  defaultBase: string;
  reviewContext: ReviewContext;
  comparisonUnavailable?: boolean;
  t: Messages;
  zh: boolean;
  open: boolean;
  commitEntry?: boolean;
  prEntry?: boolean;
  setOpen(open: boolean): void;
}
type Pane = "root" | "branch" | "reference" | "commit" | "pr";
const WIDTH =
  "w-[min(20rem,var(--radix-dropdown-menu-content-available-width))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto";
const MENU_SEGMENT =
  "min-h-5 justify-center rounded-[var(--control-r-sm)] border border-transparent px-2 py-0 pr-2 text-center text-foreground/60 focus:bg-background focus:text-foreground data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-1 [&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden";

/** Scope selection and contextual parameters stay separate; pickers drill down inside one popup. */
export function ComparisonMenu({
  state,
  change,
  desc,
  data,
  refs,
  pullRequests,
  pullRequestsPending = false,
  pullRequestsError,
  retryPullRequests,
  tracking,
  defaultBase,
  reviewContext,
  comparisonUnavailable = false,
  t,
  zh,
  open,
  commitEntry = false,
  prEntry = false,
  setOpen,
}: Props) {
  const [pane, setPane] = useState<Pane>("root");
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const revisionScope = state.mode === "ref" || state.mode === "commit";
  const commits = useQuery({
    queryKey: ["history", state.repo, cursor],
    queryFn: ({ signal }) =>
      api<{ commits: CommitInfo[]; next: number | null }>(
        "history",
        { repo: state.repo, cursor: String(cursor) },
        signal,
      ),
    enabled: open && pane === "commit" && !!state.repo,
  });
  const reset = () => {
    setDraft("");
    setCursor(0);
    setPane("root");
  };
  const onOpenChange = (value: boolean) => {
    if (value) {
      setDraft("");
      setCursor(0);
      setPane(commitEntry ? "commit" : prEntry ? "pr" : "root");
    } else {
      reset();
    }
    setOpen(value);
  };
  const pick = (patch: Partial<State>) => {
    change(patch);
    setOpen(false);
    reset();
  };
  const enter = (next: Pane) => {
    setDraft("");
    setCursor(0);
    setPane(next);
  };
  const keepBranchKeyboardOrder = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (pane !== "branch") return;
    const current = (event.target as HTMLElement).closest<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"]',
    );
    if (!current) return;
    let items: HTMLElement[] = [];
    let next = -1;
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      current.closest("[data-review-segments]")
    ) {
      items = Array.from(
        current
          .closest("[data-review-segments]")!
          .querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
      );
      const index = items.indexOf(current);
      next =
        (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) %
        items.length;
    } else if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      items = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"])',
        ),
      );
      const index = items.indexOf(current);
      next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
    } else return;
    if (!items[next]) return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  };
  useEffect(() => {
    if (!open) return;
    if (commitEntry) enter("commit");
    else if (prEntry) enter("pr");
  }, [open, commitEntry, prEntry]);
  const back = (title: string, parent: Pane = "root") => (
    <>
      <DropdownMenuItem
        className="min-w-0 whitespace-nowrap"
        title={title}
        onSelect={(e) => {
          e.preventDefault();
          enter(parent);
        }}
        aria-label={`${t.back}: ${title}`}
      >
        <ChevronLeft className="shrink-0" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap font-medium">
          {title}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
  const drill = (next: Pane, label: string, selected: boolean) => (
    <DropdownMenuItem
      className={selected ? "relative pr-14" : "relative pr-8"}
      onSelect={(e) => {
        e.preventDefault();
        enter(next);
      }}
    >
      <span className="min-w-0 truncate">{label}</span>
      {selected && <Check className="absolute right-8 size-4" />}
      <ChevronRight className="absolute right-2 size-4 text-muted-foreground" />
    </DropdownMenuItem>
  );
  const trackingReady = tracking?.state === "ready";
  const upstreamHint = !tracking
    ? t.loading
    : trackingReady
      ? tracking.ahead
        ? `↑${tracking.ahead}`
        : ""
      : tracking.state === "detached"
        ? t.upstreamDetached
        : tracking.state === "unborn"
          ? t.noCommits
          : tracking.state === "upstream_missing"
            ? t.upstreamMissing
            : t.upstreamNone;
  const scopeTooltip =
    desc.tooltip +
    (state.mode === "unpushed" && tracking?.behind
      ? " · " + t.behindUpstream.replace("{n}", String(tracking.behind))
      : "");
  const selectedBranch = reviewContext.branch;
  const linkedPrNumber = reviewContext.pr?.number;
  const root = (
    <>
      <DropdownMenuRadioGroup
        value={
          state.mode === "uncommitted" ? state.filter || "all" : state.mode
        }
        onValueChange={(value) =>
          pick(
            value === "unpushed"
              ? { mode: "unpushed" }
              : { mode: "uncommitted", filter: value },
          )
        }
      >
        <DropdownMenuRadioItem
          value="unpushed"
          className="whitespace-nowrap"
          disabled={!trackingReady}
          title={
            trackingReady
              ? `${tracking.upstream} · ${t.hintUnpushed}`
              : tracking
                ? errorMessage(tracking.state, t)
                : t.loading
          }
        >
          {t.unpushed}
          <span className="truncate text-aux text-muted-foreground">
            {upstreamHint}
          </span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="all"
          className="whitespace-nowrap"
          title={t.hintLocalAll}
        >
          {t.triggerUncommitted}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="staged"
          className="whitespace-nowrap"
          title={t.hintLocalStaged}
        >
          {t.staged}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="unstaged"
          className="whitespace-nowrap"
          title={t.hintLocalUnstaged}
        >
          {t.unstaged}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className={
          revisionScope
            ? "relative whitespace-nowrap pr-14"
            : "relative whitespace-nowrap pr-8"
        }
        onSelect={(e) => {
          e.preventDefault();
          if (!revisionScope)
            change({
              mode: "ref",
              ref: "",
              target: "worktree",
              dots: "three",
            });
          enter("branch");
        }}
      >
        <span className="flex min-w-0 items-center whitespace-nowrap">
          <span className="shrink-0">{t.branch} </span>
          {selectedBranch && (
            <span className="min-w-0 truncate text-muted-foreground">
              · {selectedBranch}
            </span>
          )}
        </span>
        {revisionScope && <Check className="absolute right-8 size-4" />}
        <ChevronRight className="absolute right-2 size-4 text-muted-foreground" />
      </DropdownMenuItem>
      <DropdownMenuItem
        className={
          state.mode === "pr"
            ? "relative whitespace-nowrap pr-14"
            : "relative whitespace-nowrap pr-8"
        }
        onSelect={(e) => {
          e.preventDefault();
          enter("pr");
        }}
      >
        <span className="flex min-w-0 items-center whitespace-nowrap">
          <span className="shrink-0">{t.pr} </span>
          {linkedPrNumber && (
            <span className="min-w-0 truncate text-muted-foreground">
              · #{linkedPrNumber}
            </span>
          )}
        </span>
        {state.mode === "pr" && <Check className="absolute right-8 size-4" />}
        <ChevronRight className="absolute right-2 size-4 text-muted-foreground" />
      </DropdownMenuItem>
    </>
  );
  const query = draft.trim().toLowerCase();
  const choices = [
    ...(refs?.branches || []).map((value) => ({ value, label: value })),
    ...(refs?.tags || [])
      .filter((value) => !refs?.branches.includes(value))
      .map((value) => ({ value, label: value })),
  ].filter((c) => !query || c.label.toLowerCase().includes(query));
  const input = (label: string, placeholder: string, submit: () => void) => (
    <div className="p-1">
      <Input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && draft.trim()) submit();
        }}
      />
    </div>
  );
  const branchOptions = (
    <>
      <DropdownMenuLabel
        className="flex min-w-0 items-center whitespace-nowrap"
        title={selectedBranch}
      >
        <span className="shrink-0">{t.secTarget}</span>
        {selectedBranch && (
          <span className="min-w-0 truncate">&nbsp;{selectedBranch}</span>
        )}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label={t.secTarget}
        data-review-segments="target"
        className="mx-1 mb-1 grid grid-cols-2 rounded-[var(--control-r-md)] bg-muted p-1"
        value={state.target === "head" ? "head" : "worktree"}
        onValueChange={(target) => change({ mode: "ref", target })}
      >
        <DropdownMenuRadioItem
          value="worktree"
          title={t.tgtWorktreeHint}
          className={MENU_SEGMENT}
          onSelect={(event) => event.preventDefault()}
        >
          {t.worktree}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="head"
          title={t.tgtHeadHint}
          className={MENU_SEGMENT}
          onSelect={(event) => event.preventDefault()}
        >
          {t.head}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t.secMethod}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label={t.secMethod}
        data-review-segments="method"
        className="mx-1 mb-1 grid grid-cols-2 rounded-[var(--control-r-md)] bg-muted p-1"
        value={state.dots === "two" ? "two" : "three"}
        onValueChange={(dots) => change({ mode: "ref", dots })}
      >
        <DropdownMenuRadioItem
          value="three"
          title={t.methThreeHint}
          className={MENU_SEGMENT}
          onSelect={(event) => event.preventDefault()}
        >
          {t.three}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="two"
          title={t.methTwoHint}
          className={MENU_SEGMENT}
          onSelect={(event) => event.preventDefault()}
        >
          {t.two}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );
  const references = (
    <>
      {back(t.secBase, "branch")}
      {input(t.reference, t.refFilter, () =>
        pick({ mode: "ref", ref: draft.trim() }),
      )}
      <div className="max-h-40 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={state.mode === "ref" ? state.ref || "" : "__none"}
          onValueChange={(ref) => pick({ mode: "ref", ref })}
        >
          {!query && (
            <DropdownMenuRadioItem value="" title={defaultBase}>
              <span className="truncate">
                {t.defaultBranch} · {defaultBase || t.head}
              </span>
            </DropdownMenuRadioItem>
          )}
          {choices.map((c) => (
            <DropdownMenuRadioItem
              key={c.value}
              value={c.value}
              title={c.label}
            >
              <span className="truncate">{c.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {draft.trim() && !choices.some((c) => c.value === draft.trim()) && (
          <DropdownMenuItem
            onSelect={() => pick({ mode: "ref", ref: draft.trim() })}
          >
            <span className="truncate">
              {t.refUse.replace("{ref}", draft.trim())}
            </span>
          </DropdownMenuItem>
        )}
      </div>
      <DropdownMenuSeparator />
      {branchOptions}
    </>
  );
  const date = new Intl.DateTimeFormat(zh ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  });
  const filtered = (commits.data?.commits || []).filter(
    (c) => !query || `${c.sha} ${c.title}`.toLowerCase().includes(query),
  );
  const history = (
    <>
      {back(t.committed, "branch")}
      {input(t.chooseCommit, t.commitFilter, () =>
        pick({ mode: "commit", commit: draft.trim() }),
      )}
      <div className="max-h-[min(20rem,50vh)] overflow-y-auto">
        {commits.isPending ? (
          <p role="status" className="p-2 text-aux text-muted-foreground">
            {t.loading}
          </p>
        ) : commits.error ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void commits.refetch();
            }}
          >
            {errorMessage(commits.error.message, t)} · {t.retry}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup
            value={state.mode === "commit" ? state.commit || "" : ""}
            onValueChange={(commit) => pick({ mode: "commit", commit })}
          >
            {filtered.map((c) => (
              <DropdownMenuRadioItem
                key={c.sha}
                value={c.sha}
                title={`${c.sha}\n${c.title}\n${new Date(c.timestamp * 1000).toLocaleString(zh ? "zh-CN" : "en")}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.title}</span>
                  <span className="block text-aux text-muted-foreground">
                    {c.sha.slice(0, 7)} · {date.format(c.timestamp * 1000)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        {!commits.isPending && !commits.error && !filtered.length && (
          <p className="p-2 text-aux text-muted-foreground">
            {query ? t.commitNoMatch : t.noCommits}
          </p>
        )}
        {draft.trim() && (
          <DropdownMenuItem
            onSelect={() => pick({ mode: "commit", commit: draft.trim() })}
          >
            <span className="truncate">
              {t.commitUse.replace("{ref}", draft.trim())}
            </span>
          </DropdownMenuItem>
        )}
      </div>
      {(cursor > 0 || commits.data?.next != null) && (
        <>
          <DropdownMenuSeparator />
          {cursor > 0 && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setCursor(Math.max(0, cursor - 40));
                setDraft("");
              }}
            >
              {t.newerCommits}
            </DropdownMenuItem>
          )}
          {commits.data?.next != null && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setCursor(commits.data!.next!);
                setDraft("");
              }}
            >
              {t.olderCommits}
            </DropdownMenuItem>
          )}
        </>
      )}
    </>
  );
  const prData = pullRequests;
  const filteredPrs = (prData?.prs || []).filter(
    (pr) => !query || `${pr.number} ${pr.title}`.toLowerCase().includes(query),
  );
  const prs = (
    <>
      {back(t.pr)}
      {input(t.prNumber, t.prFilter, () => {
        if (/^[1-9]\d*$/.test(draft.trim()))
          pick({ mode: "pr", pr: draft.trim() });
      })}
      <div className="max-h-60 overflow-y-auto">
        {pullRequestsPending && !prData ? (
          <p role="status" className="p-2 text-aux text-muted-foreground">
            {t.loading}
          </p>
        ) : pullRequestsError ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              retryPullRequests();
            }}
          >
            {errorMessage(pullRequestsError, t)} · {t.retry}
          </DropdownMenuItem>
        ) : (
          filteredPrs.map((pr) => (
            <DropdownMenuItem
              key={pr.number}
              title={pr.title}
              onSelect={() => pick({ mode: "pr", pr: String(pr.number) })}
            >
              <span className="truncate">
                #{pr.number} {pr.title}
              </span>
            </DropdownMenuItem>
          ))
        )}
        {!pullRequestsError &&
          prData?.prState &&
          prData.prState !== "ready" && (
            <p className="p-2 text-aux text-muted-foreground">
              {errorMessage(prData.prState, t)}
            </p>
          )}
        {!pullRequestsError &&
          prData?.prState === "ready" &&
          filteredPrs.length === 0 && (
            <p className="p-2 text-aux text-muted-foreground">{t.prNoMatch}</p>
          )}
      </div>
    </>
  );
  const branch = (
    <>
      {back(t.branch)}
      <DropdownMenuItem
        className="relative pr-8"
        onSelect={(e) => {
          e.preventDefault();
          enter("reference");
        }}
      >
        {t.secBase}
        <span className="ml-auto min-w-0 truncate pl-2 text-muted-foreground">
          {state.mode === "ref" && state.ref
            ? state.ref
            : defaultBase || t.head}
        </span>
        <ChevronRight className="absolute right-2 size-4" />
      </DropdownMenuItem>
      {drill("commit", t.committed, state.mode === "commit")}
      <DropdownMenuSeparator />
      {branchOptions}
    </>
  );
  const files = data?.files || [];
  const fallbackCount = (supporting: boolean): ChangeCount =>
    files
      .filter(
        (file) => ((file.category ?? "primary") !== "primary") === supporting,
      )
      .reduce(
        (count, file) => ({
          files: count.files + 1,
          added: count.added + file.added,
          deleted: count.deleted + file.deleted,
        }),
        { files: 0, added: 0, deleted: 0 },
      );
  const primary = data?.totals?.primary ?? fallbackCount(false);
  const supporting = data?.totals?.supporting ?? fallbackCount(true);
  const all = data?.totals?.all ?? {
    files: primary.files + supporting.files,
    added: primary.added + supporting.added,
    deleted: primary.deleted + supporting.deleted,
  };
  // Keep the previous indicator width stable while a newly selected comparison is loading.
  // A ready result always wins synchronously; if loading stalls, remove the stale counts after 3s.
  const [lastReadyAll, setLastReadyAll] = useState<ChangeCount>();
  useEffect(() => {
    if (comparisonUnavailable) {
      setLastReadyAll(undefined);
      return;
    }
    if (data) {
      setLastReadyAll(files.length > 0 ? all : undefined);
      return;
    }
    const timer = window.setTimeout(() => setLastReadyAll(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [
    comparisonUnavailable,
    data,
    files.length,
    all.files,
    all.added,
    all.deleted,
  ]);
  const displayedAll = comparisonUnavailable
    ? undefined
    : data
      ? files.length > 0
        ? all
        : undefined
      : lastReadyAll;
  const summary = (label: string, count: ChangeCount) => (
    <div className="flex items-center justify-between gap-3 whitespace-nowrap px-2 py-1 text-xs">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
        {label} · {count.files}
      </span>
      <span className="shrink-0 whitespace-nowrap">
        <Stats added={count.added} deleted={count.deleted} zero />
      </span>
    </div>
  );
  const changeSummary = files.length > 0 && (
    <>
      <DropdownMenuSeparator />
      <div aria-label={t.changeSummary}>
        {summary(t.primaryChanges, primary)}
        {summary(t.supportingChanges, supporting)}
        {summary(t.allChanges, all)}
      </div>
    </>
  );
  const scopeLabel =
    state.mode === "pr"
      ? state.pr
        ? `#${state.pr}`
        : t.choosePrPlaceholder
      : state.mode === "ref"
        ? state.ref || defaultBase || desc.from || t.branch
        : state.mode === "commit"
          ? state.commit
            ? desc.label
            : t.chooseCommit
          : desc.label || t.committed;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Pill
          aria-label={t.comparison}
          title={`${scopeTooltip}${data && displayedAll ? `\n${t.primaryChanges}: +${primary.added} −${primary.deleted}\n${t.allChanges}: +${displayedAll.added} −${displayedAll.deleted}` : ""}`}
          style={{ flex: "0 1 auto", justifySelf: "start" }}
          className="min-w-0 max-w-full shrink"
        >
          <span className="min-w-0 truncate">{scopeLabel}</span>
          {displayedAll && (
            <Stats
              added={displayedAll.added}
              deleted={displayedAll.deleted}
              zero
            />
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        onKeyDownCapture={keepBranchKeyboardOrder}
        className={pane === "root" || pane === "branch" ? "w-56" : WIDTH}
      >
        {pane === "pr" ? (
          prs
        ) : pane === "commit" ? (
          history
        ) : pane === "reference" ? (
          references
        ) : pane === "branch" ? (
          branch
        ) : (
          <>
            {root}
            {changeSummary}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
