import type { BadgeProps } from "@rome-os/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Map a triage status to a Badge variant. */
export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "info";
    case "queued":
      return "warning";
    case "skipped":
      return "muted";
    default:
      return "outline";
  }
}

/**
 * Map a label name to a Badge variant by its taxonomy family. Recognizes both
 * the legacy slash forms (`type/bug`, `priority/high`) and the new flat forms
 * (`bug`, `priority: high`). Matching is case-insensitive.
 */
export function labelVariant(name: string): BadgeVariant {
  const n = (name || "").toLowerCase().trim();

  // Priority — flat (`priority: high`) or slash (`priority/high`).
  const priorityMatch = n.match(/^priority\s*[/:]\s*(low|medium|high|critical)$/);
  const priority = priorityMatch?.[1];
  if (priority) {
    if (priority === "critical" || priority === "high") return "destructive";
    if (priority === "medium") return "warning";
    return "muted";
  }

  // Flags.
  if (n === "needs-info" || n === "needs-triage") return "warning";

  // Type — flat concepts or legacy slash forms.
  if (n === "bug") return "destructive";
  if (n === "enhancement" || n === "documentation" || n === "question") return "brand";
  if (n.startsWith("type/")) return "brand";

  return "outline";
}

/** Compact relative time like "3m ago", "2h ago", "5d ago". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Short human label for the actor that triggered a triage. */
export function actorLabel(actor: string): string {
  if (actor.startsWith("webhook:")) return `Auto · ${actor.slice("webhook:".length)}`;
  if (actor === "batch") return "Batch";
  if (actor === "manual") return "Manual";
  return actor;
}
