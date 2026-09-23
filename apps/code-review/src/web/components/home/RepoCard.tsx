import type { PRReviewSettingsData, RepoStat, RepositoryData } from "@/types";
import { Badge, type BadgeProps } from "@rome-os/ui/badge";
import { Card } from "@rome-os/ui/card";
import { formatRelative, repoOwner } from "@/lib/helpers";
import { GithubAvatar } from "./GithubAvatar";
import { Sparkline } from "./Sparkline";

type HealthTone = "live" | "warn" | "repair" | "idle";

/**
 * Derive the minimal connection-health badge from the augmented settings. The
 * mock shows a simple "Live" dot; we keep the real states behind it so an
 * unhealthy or unwired repo still reads clearly (and a repair-needed repo is
 * obvious), just restyled to a subtle dot + label.
 */
function deriveHealth(settings: PRReviewSettingsData | null | undefined): { tone: HealthTone; label: string } {
  if (!settings) return { tone: "idle", label: "Manual" };
  const wiringEnabled = settings.autoReviewEnabled || settings.triggerOnRequest;
  if (!wiringEnabled) return { tone: "idle", label: "Manual" };
  if (settings.triggerWiringHealthy || settings.autoReviewHealthy) return { tone: "live", label: "Live" };
  if (settings.webhookConnected && settings.eventRoutinesReady === false) return { tone: "repair", label: "Needs repair" };
  if (settings.webhookConnected) return { tone: "warn", label: "Unknown" };
  return { tone: "warn", label: "Not subscribed" };
}

const TONE_VARIANT: Record<HealthTone, BadgeProps["variant"]> = {
  live: "success",
  warn: "warning",
  repair: "destructive",
  idle: "muted",
};

export function RepoCard({
  repo,
  settings,
  stat,
  onOpenSettings,
}: {
  repo: RepositoryData;
  settings: PRReviewSettingsData | null | undefined;
  stat: RepoStat | undefined;
  onOpenSettings: (repoName: string) => void;
}) {
  const health = deriveHealth(settings);
  const owner = repoOwner(repo.name);
  const shortName = repo.name.slice(owner.length + 1) || repo.name;
  const reviewCount = stat?.reviewCount ?? 0;
  const lastActivity = stat?.lastActivityAt ?? null;
  const trend = stat?.trend ?? [];
  const hasTrend = trend.some((v) => v > 0);

  return (
    <Card className="p-0 transition-colors hover:border-foreground/20 hover:bg-accent/40">
      <button
        type="button"
        onClick={() => onOpenSettings(repo.name)}
        title={`Trigger settings for ${repo.name}`}
        className="group flex w-full flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <GithubAvatar login={owner} size={36} />
          <div className="min-w-0 truncate text-sm leading-tight">
            <span className="text-muted-foreground">{owner}/</span>
            <span className="font-semibold text-foreground">{shortName}</span>
          </div>
        </div>
        <Badge variant={TONE_VARIANT[health.tone]}>{health.label}</Badge>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{reviewCount.toLocaleString()}</span>{" "}
          review{reviewCount === 1 ? "" : "s"}
          {lastActivity && <span> · {formatRelative(lastActivity)}</span>}
        </div>
        <div className={`shrink-0 ${hasTrend ? "text-emerald-500" : "text-muted-foreground/30"}`}>
          <Sparkline data={trend} width={92} height={30} />
        </div>
      </div>
      </button>
    </Card>
  );
}
