import { useState } from "react";
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
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Description } from "../shared/describe";
import type { CommitInfo, TrackingInfo } from "../lib/git";
import type { FilesData, RefData, State } from "./types";
import type { Messages } from "./i18n";
import { errorMessage } from "./i18n";
import { api } from "./api";
import { Pill, Stats } from "./ReviewParts";

interface Props {
  state: State;
  change(patch: Partial<State>): void;
  desc: Description;
  data?: FilesData;
  refs?: RefData;
  tracking?: TrackingInfo;
  defaultBase: string;
  t: Messages;
  zh: boolean;
  compact: boolean;
  open: boolean;
  commitEntry?: boolean;
  setOpen(open: boolean): void;
}
type Pane = "root" | "branch" | "commit" | "pr";
const WIDTH =
  "w-[min(20rem,var(--radix-dropdown-menu-content-available-width))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto";

/** Scope selection and contextual parameters stay separate; pickers drill down inside one popup. */
export function ComparisonMenu({
  state,
  change,
  desc,
  data,
  refs,
  tracking,
  defaultBase,
  t,
  zh,
  compact,
  open,
  commitEntry = false,
  setOpen,
}: Props) {
  const [pane, setPane] = useState<Pane>("root");
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [branchOpen, setBranchOpen] = useState(false);
  const revisionScope = state.mode === "ref" || state.mode === "commit";
  const revisionOpen = branchOpen || (open && commitEntry);
  const revisionPane = open && commitEntry ? "commit" : pane;
  const commits = useQuery({
    queryKey: ["history", state.repo, cursor],
    queryFn: ({ signal }) =>
      api<{ commits: CommitInfo[]; next: number | null }>(
        "history",
        { repo: state.repo, cursor: String(cursor) },
        signal,
      ),
    enabled: revisionOpen && revisionPane === "commit" && !!state.repo,
  });
  const reset = () => {
    setDraft("");
    setCursor(0);
    setPane("root");
  };
  const onOpenChange = (value: boolean) => {
    reset();
    if (value) setBranchOpen(false);
    setOpen(value);
  };
  const onRevisionOpenChange = (value: boolean) => {
    reset();
    setBranchOpen(value);
    setOpen(false);
  };
  const pick = (patch: Partial<State>) => {
    change(patch);
    setOpen(false);
    setBranchOpen(false);
    reset();
  };
  const enter = (next: Pane) => {
    setDraft("");
    setCursor(0);
    setPane(next);
  };
  const back = (title: string) => (
    <>
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          if (open && commitEntry) {
            setOpen(false);
            setBranchOpen(true);
          }
          enter("root");
        }}
        aria-label={`${t.back}: ${title}`}
      >
        <ChevronLeft />
        <span className="font-medium">{title}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
  const drill = (next: Pane, label: string, selected: boolean) => (
    <DropdownMenuItem
      className="relative pl-8"
      onSelect={(e) => {
        e.preventDefault();
        enter(next);
      }}
    >
      {selected && <Check className="absolute left-2 size-4" />}
      <span>{label}</span>
      <ChevronRight className="ml-auto text-muted-foreground" />
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
          <span className="ml-auto truncate pl-2 text-aux text-muted-foreground">
            {upstreamHint}
          </span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="all" title={t.hintLocalAll}>
          {t.triggerUncommitted}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="staged" title={t.hintLocalStaged}>
          {t.staged}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="unstaged" title={t.hintLocalUnstaged}>
          {t.unstaged}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="relative pl-8"
        onSelect={() => pick({ mode: "ref" })}
      >
        {revisionScope && <Check className="absolute left-2 size-4" />}
        <span>{t.branch}</span>
      </DropdownMenuItem>
      {/* Old PR links remain operable; PR is no longer a top-level scope in the normal menu. */}
      {state.mode === "pr" && (
        <>
          <DropdownMenuSeparator />
          {drill("pr", t.pr, true)}
        </>
      )}
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
      <DropdownMenuLabel>{t.secTarget}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.target || "worktree"}
        onValueChange={(target) => change({ mode: "ref", target })}
      >
        <DropdownMenuRadioItem
          value="worktree"
          onSelect={(e) => e.preventDefault()}
          title={t.tgtWorktreeHint}
        >
          {t.worktree}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="head"
          onSelect={(e) => e.preventDefault()}
          title={t.tgtHeadHint}
        >
          {t.head}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t.secMethod}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={state.dots || "three"}
        onValueChange={(dots) => change({ mode: "ref", dots })}
      >
        <DropdownMenuRadioItem
          value="three"
          onSelect={(e) => e.preventDefault()}
          title={t.methThreeHint}
        >
          {t.three}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="two"
          onSelect={(e) => e.preventDefault()}
          title={t.methTwoHint}
        >
          {t.two}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );
  const branches = (
    <>
      {back(t.branch)}
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
      {back(t.committed)}
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
  const prs = (
    <>
      {back(t.pr)}
      {input(t.prNumber, t.prFilter, () => {
        if (/^[1-9]\d*$/.test(draft.trim()))
          pick({ mode: "pr", pr: draft.trim() });
      })}
      <div className="max-h-60 overflow-y-auto">
        {(refs?.prs || [])
          .filter(
            (pr) =>
              !query ||
              `${pr.number} ${pr.title}`.toLowerCase().includes(query),
          )
          .map((pr) => (
            <DropdownMenuItem
              key={pr.number}
              title={pr.title}
              onSelect={() => pick({ mode: "pr", pr: String(pr.number) })}
            >
              <span className="truncate">
                #{pr.number} {pr.title}
              </span>
            </DropdownMenuItem>
          ))}
        {refs?.prState && refs.prState !== "ready" && (
          <p className="p-2 text-aux text-muted-foreground">
            {errorMessage(refs.prState, t)}
          </p>
        )}
      </div>
    </>
  );
  const files = data?.files || [];
  const scopeLabel = revisionScope
    ? t.branch
    : state.mode === "pr"
      ? state.pr
        ? `#${state.pr}`
        : t.choosePrPlaceholder
      : desc.label || t.committed;
  return (
    <>
      <DropdownMenu open={open && !commitEntry} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Pill
            aria-label={t.comparison}
            title={scopeTooltip}
            style={{ flex: "0 1 auto", justifySelf: "start" }}
            className="min-w-0 max-w-full shrink"
          >
            <span className="min-w-0 truncate">{scopeLabel}</span>
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
            {files.length > 0 && (
              <Stats
                added={files.reduce((n, f) => n + f.added, 0)}
                deleted={files.reduce((n, f) => n + f.deleted, 0)}
                zero
              />
            )}
          </Pill>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className={pane === "root" ? "w-56" : WIDTH}
        >
          {pane === "pr" ? prs : root}
        </DropdownMenuContent>
      </DropdownMenu>
      {revisionScope && (
        <div
          className={
            compact ? "order-last col-span-3 w-full" : "min-w-0 shrink"
          }
        >
          <DropdownMenu open={revisionOpen} onOpenChange={onRevisionOpenChange}>
            <DropdownMenuTrigger asChild>
              <Pill
                aria-label={t.branchComparison}
                title={desc.tooltip}
                className="min-w-0 max-w-full shrink"
              >
                {state.mode === "commit" ? (
                  <span className="min-w-0 truncate">
                    {state.commit ? desc.label : t.chooseCommit}
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 truncate">{desc.from}</span>
                    <ArrowRight
                      size={12}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="shrink-0">{desc.to}</span>
                    {desc.twoDot && (
                      <span className="shrink-0 text-aux text-muted-foreground">
                        {t.two}
                      </span>
                    )}
                  </>
                )}
                <ChevronDown
                  size={12}
                  className="shrink-0 text-muted-foreground"
                />
              </Pill>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              collisionPadding={8}
              className={WIDTH}
            >
              {revisionPane === "branch" ? (
                branches
              ) : revisionPane === "commit" ? (
                history
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      enter("branch");
                    }}
                  >
                    {t.secBase}
                    <span className="ml-auto min-w-0 truncate pl-2 text-muted-foreground">
                      {state.mode === "commit"
                        ? state.ref || defaultBase
                        : desc.from}
                    </span>
                    <ChevronRight className="shrink-0" />
                  </DropdownMenuItem>
                  {drill("commit", t.committed, state.mode === "commit")}
                  {state.mode === "ref" && (
                    <>
                      <DropdownMenuSeparator />
                      {branchOptions}
                    </>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  );
}
