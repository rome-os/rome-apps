import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@rome-os/ui/badge";
import { Button } from "@rome-os/ui/button";
import type { Profile, RequestView } from "../../shared/model";
import { copyText, initials, isOverdue } from "../lib/format";
import { cn } from "../lib/utils";

export const AVATAR_URL = "/api/apps/settle/avatar";

export function PayeeAvatar({ profile, className }: { profile: Profile; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile.avatarVersion]);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-display text-muted-foreground ring-1 ring-border",
        className,
      )}
    >
      {profile.hasAvatar && !failed ? (
        <img
          src={`${AVATAR_URL}?v=${profile.avatarVersion}`}
          alt={profile.name}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials(profile.name) || "·"}</span>
      )}
    </span>
  );
}

export type DisplayStatus = "sent" | "viewed" | "paying" | "overdue" | "paid" | "void";

export function displayStatus(r: RequestView): DisplayStatus {
  if (r.status === "void") return "void";
  if (r.status === "paid") return "paid";
  if (r.pendingPayment) return "paying";
  if (isOverdue(r)) return "overdue";
  return r.viewCount > 0 ? "viewed" : "sent";
}

const STATUS: Record<DisplayStatus, { label: string; variant: "muted" | "info" | "warning" | "success" | "destructive" | "outline" }> = {
  sent: { label: "Sent", variant: "outline" },
  viewed: { label: "Viewed", variant: "info" },
  paying: { label: "Paying", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Withdrawn", variant: "muted" },
};

export function StatusBadge({ request, className }: { request: RequestView; className?: string }) {
  const s = STATUS[displayStatus(request)];
  return (
    <Badge variant={s.variant} className={className}>
      {s.label}
      {request.status === "paid" && request.paidVia === "manual" ? " · by hand" : ""}
    </Badge>
  );
}

export function CopyButton({
  value,
  label = "Copy link",
  variant = "outline",
  size = "sm",
  className,
}: {
  value: string;
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
  size?: "sm" | "default" | "md";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        setCopied(await copyText(value));
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Notice({ tone, children, onDismiss }: { tone: "success" | "warning" | "error" | "info"; children: ReactNode; onDismiss?: () => void }) {
  const tones = {
    success: "border-success-border bg-success-bg text-success-fg",
    warning: "border-border bg-warning-bg text-foreground",
    error: "border-destructive-border bg-destructive-bg text-destructive-fg",
    info: "border-border bg-muted text-foreground",
  } as const;
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-8 border px-3.5 py-2.5 text-ui", tones[tone])}>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="text-aux opacity-70 hover:opacity-100">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
