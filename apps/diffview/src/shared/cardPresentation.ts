import type { ReviewCard } from "../lib/agentView";

/** Keep exact values in details; compact only the narrow card face. */
export function compactCount(value: number, zh: boolean) {
  return new Intl.NumberFormat(zh ? "zh-CN" : "en", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10000 && value < 10000000 ? 1 : 0,
    useGrouping: false,
  }).format(value);
}
export function cardComparison(card: ReviewCard, zh: boolean) {
  if (card.kind === "refs")
    return {
      identity: `${card.base} → ${card.target}`,
      scope:
        card.dots === "three"
          ? zh
            ? "合并基点"
            : "Merge base"
          : zh
            ? "两点比较"
            : "Two-dot",
    };
  const index = zh ? "暂存区" : "Index";
  const worktree = zh ? "工作区" : "Worktree";
  return {
    identity: card.branch || "HEAD",
    scope:
      card.state.filter === "staged"
        ? `HEAD → ${index}`
        : card.state.filter === "unstaged"
          ? `${index} → ${worktree}`
          : `HEAD → ${worktree}`,
  };
}
export function cardStatuses(card: ReviewCard, zh: boolean) {
  if (card.kind === "refs") return zh ? "SHA 已固定" : "Pinned SHAs";
  const counts = [
    [zh ? "冲突" : "Conflicts", card.conflicts],
    [zh ? "已暂存" : "Staged", card.staged?.files],
    [zh ? "未暂存" : "Unstaged", card.unstaged?.files],
    [zh ? "未跟踪" : "Untracked", card.untracked],
  ] as const;
  return (
    counts
      .filter(([, n]) => n && n > 0)
      .map(([label, n]) => `${label} ${compactCount(n!, zh)}`)
      .join(" · ") || (zh ? "工作区干净" : "Clean workspace")
  );
}
export function cardTime(at: string, zh: boolean, now = new Date()) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "—";
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", {
    ...(!sameDay ? ({ month: "2-digit", day: "2-digit" } as const) : {}),
    ...(date.getFullYear() !== now.getFullYear()
      ? ({ year: "numeric" } as const)
      : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
