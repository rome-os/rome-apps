import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GithubUserProfile } from "@/types";
import { githubInitials } from "@/lib/helpers";

export function GithubUserAvatar({
  login,
  profile,
  className = "",
}: {
  login: string;
  profile?: GithubUserProfile;
  className?: string;
}) {
  const label = profile?.name || login;
  const profileLogin = profile?.login || login;
  const profileUrl = profile?.htmlUrl || `https://github.com/${encodeURIComponent(profileLogin)}`;
  const tooltipLabel = profile?.name ? `${profile.name} (@${profileLogin})` : `@${profileLogin}`;
  const avatar = (
    <Avatar className={`border-2 border-background shadow-sm ${className}`}>
      {profile?.avatarUrl ? (
        <AvatarImage src={profile.avatarUrl} alt={`${label} avatar`} />
      ) : null}
      <AvatarFallback className="text-xs font-semibold">
        {githubInitials(login, profile?.name)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${tooltipLabel} on GitHub`}
            className="inline-flex rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {avatar}
          </a>
        </TooltipTrigger>
        <TooltipContent>
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
