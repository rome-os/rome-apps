import { Building2, Globe, Lock } from "lucide-react";
import type { RepositoryData } from "@/types";

type Visibility = NonNullable<RepositoryData["visibility"]>;

const STYLES: Record<Visibility, { label: string; title: string; Icon: typeof Lock; className: string }> = {
  public: {
    label: "Public",
    title: "Public repository: anyone on GitHub can see it",
    Icon: Globe,
    className: "border-border text-muted-foreground",
  },
  private: {
    label: "Private",
    title: "Private repository: only people with access can see it",
    Icon: Lock,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  internal: {
    label: "Internal",
    title: "Internal repository: visible to members of the enterprise",
    Icon: Building2,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
};

/** GitHub-style visibility pill. Renders nothing when visibility is unknown. */
export function RepoVisibilityBadge({ visibility }: { visibility: RepositoryData["visibility"] }) {
  if (!visibility) return null;
  const { label, title, Icon, className } = STYLES[visibility];
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium leading-4 ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
