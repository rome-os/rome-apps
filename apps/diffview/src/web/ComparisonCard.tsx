import { createRoot } from "react-dom/client";
import { useEffect, useId, useState } from "react";
import {
  defineComponent,
  fetchAppApi,
  navigateRome,
} from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Card } from "@rome-os/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@rome-os/ui/popover";
import {
  ArrowUpRight,
  Clock3,
  Files,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { ReviewCard } from "../lib/agentView";
import type { ChatState } from "../shared/prefs";
import {
  cardComparison,
  cardStatuses,
  cardTime,
  compactCount,
} from "../shared/cardPresentation";
import { useHost } from "./i18n";

/** Card transport is independent of locale and never retains a previous id's response. */
function useReviewCard(id: string) {
  const [value, setValue] = useState<{
    id: string;
    card?: ReviewCard;
    failed?: boolean;
  }>({ id });
  useEffect(() => {
    const controller = new AbortController();
    void fetchAppApi(`cards/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("card_unavailable");
        const card = (await res.json()) as ReviewCard;
        if (!controller.signal.aborted) setValue({ id, card });
      })
      .catch(() => {
        if (!controller.signal.aborted) setValue({ id, failed: true });
      });
    return () => controller.abort();
  }, [id]);
  return value.id === id ? value : { id };
}

function CardDetails({ card, zh }: { card: ReviewCard; zh: boolean }) {
  const field = (label: string, value?: string) =>
    value && (
      <div>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="break-all select-text">{value}</dd>
      </div>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto relative z-20 h-6 w-6 shrink-0 text-muted-foreground"
          aria-label={zh ? "卡片详情" : "Card details"}
          title={zh ? "卡片详情" : "Card details"}
        >
          <Info size={14} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto text-xs"
        aria-label={zh ? "卡片详情" : "Card details"}
      >
        <p className="text-sm font-medium">
          {zh ? "差异详情" : "Diff details"}
        </p>
        <dl className="space-y-2">
          {field(zh ? "仓库" : "Repository", card.repo)}
          {card.kind === "workspace" &&
            field(zh ? "分支" : "Branch", card.branch || "HEAD")}
          {card.kind === "refs" && (
            <>
              {field(
                zh ? "基准 Ref / SHA" : "Base ref / SHA",
                `${card.base}\n${card.baseSha}`,
              )}
              {field(
                zh ? "目标 Ref / SHA" : "Target ref / SHA",
                `${card.target}\n${card.targetSha}`,
              )}
              {card.dots === "three" &&
                field(zh ? "合并基点 SHA" : "Merge-base SHA", card.fromSha)}
            </>
          )}
          {field(
            zh ? "统计" : "Totals",
            `${card.totals.files} ${zh ? "个文件" : "files"} · +${card.totals.added} −${card.totals.deleted} · ${card.totals.binary} ${zh ? "个二进制文件" : "binary files"}`,
          )}
          {card.kind === "workspace" &&
            field(
              zh
                ? "完整工作区状态（各项可能重叠）"
                : "Full workspace status (counts may overlap)",
              `${zh ? "已暂存" : "Staged"} ${card.staged?.files || 0} · ${zh ? "未暂存" : "Unstaged"} ${card.unstaged?.files || 0} · ${zh ? "未跟踪" : "Untracked"} ${card.untracked || 0} · ${zh ? "冲突" : "Conflicts"} ${card.conflicts || 0}`,
            )}
          {field(
            zh ? "采样时间（本地时区）" : "Sample time (local zone)",
            new Date(card.sampledAt).toLocaleString(zh ? "zh-CN" : "en-GB"),
          )}
        </dl>
        <p className="text-muted-foreground">
          {card.kind === "workspace"
            ? zh
              ? "采样记录，不是不可变快照。打开时读取实时工作区；增删行不含未跟踪文件。统计行遵循所选范围，状态行显示完整工作区。"
              : "Sampled record, not a snapshot. Opens the live workspace. Line totals exclude untracked files. Totals follow the selected scope; status covers the full workspace."
            : card.dots === "three"
              ? zh
                ? "已固定提交 SHA；从合并基点比较到目标提交。"
                : "Pinned commit SHAs; compares the merge base to the target commit."
              : zh
                ? "已固定提交 SHA；直接比较基准与目标提交。"
                : "Pinned commit SHAs; compares the base directly to the target commit."}
        </p>
        {!card.stable && (
          <p role="status" className="text-destructive">
            {zh
              ? "采样期间工作区有变化，统计可能不一致。"
              : "Workspace changed during sampling; counts may be inconsistent."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ComparisonCard({ id }: { id: string }) {
  const { zh } = useHost();
  const { card, failed } = useReviewCard(id);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const summaryId = useId();
  const open = async () => {
    if (busy || !card) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetchAppApi(`cards/${encodeURIComponent(id)}/open`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("open_failed");
      const target = (await res.json()) as {
        chatId: string | null;
        state: ChatState;
      };
      if (target.chatId)
        navigateRome({
          path: "chat",
          sessionId: target.chatId,
          widgets: [{ type: "app", appId: "diffview" }],
        });
      else {
        const hash = new URLSearchParams(
          Object.entries(target.state).filter(
            (x): x is [string, string] => typeof x[1] === "string",
          ),
        ).toString();
        window.open("/apps/diffview#" + hash, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const comparison = card && cardComparison(card, zh);
  const status = card && cardStatuses(card, zh);
  const changed = card ? card.totals.added + card.totals.deleted : 0;
  const warning = card && (!card.stable || !!card.conflicts);
  return (
    <Card
      data-testid="comparison-card"
      className="relative w-full max-w-sm gap-0 overflow-hidden p-0 shadow-none"
    >
      {card && (
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          aria-label={zh ? "在 Diffview 打开" : "Open in Diffview"}
          aria-describedby={summaryId}
          aria-busy={busy}
          className="absolute inset-0 rounded-[inherit] transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait"
        />
      )}
      <div className="pointer-events-none relative space-y-2 p-3">
        <div className="flex h-5 min-w-0 items-center gap-2 text-sm">
          <FolderGit2
            size={16}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span
            className="min-w-0 flex-1 truncate font-medium"
            title={card?.name}
          >
            {card?.name || (zh ? "差异概览" : "Diff overview")}
          </span>
          {card &&
            (busy ? (
              <LoaderCircle
                size={16}
                className="shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : (
              <ArrowUpRight
                size={16}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
            ))}
        </div>
        {!card && (
          <p
            className="text-xs text-muted-foreground"
            role={failed ? "alert" : "status"}
          >
            {failed
              ? zh
                ? "无法读取卡片"
                : "Card unavailable"
              : zh
                ? "读取中…"
                : "Loading…"}
          </p>
        )}
        {card && comparison && (
          <>
            <div
              className="flex h-6 min-w-0 items-center gap-2 text-xs text-muted-foreground"
              data-testid="card-comparison"
            >
              {card.kind === "workspace" ? (
                <GitBranch size={15} className="shrink-0" aria-hidden />
              ) : (
                <GitCompareArrows size={15} className="shrink-0" aria-hidden />
              )}
              <span
                className="min-w-0 flex-1 truncate"
                title={comparison.identity}
              >
                {comparison.identity}
              </span>
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-foreground">
                {comparison.scope}
              </span>
            </div>
            <div
              id={summaryId}
              className="flex min-w-0 items-center gap-2 border-y py-2 text-sm tabular-nums"
              data-testid="card-totals"
            >
              <Files
                size={15}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span
                className="shrink-0 whitespace-nowrap"
                title={`${card.totals.files}`}
              >
                {compactCount(card.totals.files, zh)} {zh ? "个文件" : "files"}
              </span>
              <span
                className="shrink-0 whitespace-nowrap font-medium"
                style={{ color: "var(--success)" }}
                title={`+${card.totals.added}`}
              >
                +{compactCount(card.totals.added, zh)}
              </span>
              <span
                className="shrink-0 whitespace-nowrap font-medium"
                style={{ color: "var(--destructive)" }}
                title={`−${card.totals.deleted}`}
              >
                −{compactCount(card.totals.deleted, zh)}
              </span>
              <span
                className="flex h-1.5 min-w-4 flex-1 overflow-hidden rounded-full bg-muted"
                aria-hidden
              >
                {changed > 0 && (
                  <>
                    <span
                      style={{
                        width: `${(card.totals.added / changed) * 100}%`,
                        background: "var(--success)",
                      }}
                    />
                    <span
                      style={{
                        width: `${(card.totals.deleted / changed) * 100}%`,
                        background: "var(--destructive)",
                      }}
                    />
                  </>
                )}
              </span>
            </div>
            <div className="flex h-6 min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {warning && (
                <TriangleAlert
                  size={14}
                  className="shrink-0 text-destructive"
                  role="img"
                  aria-label={
                    zh
                      ? "工作区采样需注意，查看详情"
                      : "Workspace warning; see details"
                  }
                />
              )}
              <span
                className={`min-w-0 flex-1 truncate ${warning ? "text-destructive" : ""}`}
                title={status}
              >
                {status}
              </span>
              <time
                className="flex shrink-0 items-center gap-1 tabular-nums"
                dateTime={card.sampledAt}
                title={`${zh ? "采样于" : "Sampled at"} ${new Date(card.sampledAt).toLocaleString()}`}
              >
                <Clock3 size={12} aria-hidden />
                {cardTime(card.sampledAt, zh)}
              </time>
              <CardDetails card={card} zh={zh} />
            </div>
          </>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {zh ? "打开失败，请重试" : "Could not open. Retry."}
          </p>
        )}
      </div>
    </Card>
  );
}
defineComponent("comparison-card", (container, ctx) => {
  const root = createRoot(container);
  root.render(<ComparisonCard id={String(ctx.props.cardId || "")} />);
  return () => root.unmount();
});
