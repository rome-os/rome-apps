import { Badge } from "@rome-os/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@rome-os/ui/alert";
import { Github } from "lucide-react";
import type { GhAuthStatus } from "@/types";
import { labelVariant, statusVariant } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariant(status)} shape="pill" className="capitalize">
      {status}
    </Badge>
  );
}

export function LabelChip({ name, created }: { name: string; created?: boolean }) {
  return (
    <Badge variant={labelVariant(name)} shape="square" className="font-mono text-xs">
      {name}
      {created ? <span className="ml-1 opacity-70">(new)</span> : null}
    </Badge>
  );
}

export function LabelChips({ labels, created }: { labels: string[]; created?: string[] }) {
  if (!labels.length) return <span className="text-sm text-muted-foreground">No labels applied</span>;
  const createdSet = new Set(created ?? []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => (
        <LabelChip key={l} name={l} created={createdSet.has(l)} />
      ))}
    </div>
  );
}

export function GhAuthBanner({ ghAuth }: { ghAuth: GhAuthStatus | null }) {
  if (!ghAuth || ghAuth.loggedIn) return null;
  return (
    <Alert variant="warning" className="mb-6">
      <Github className="size-4" />
      <AlertTitle>Connect GitHub</AlertTitle>
      <AlertDescription>
        GitHub is not connected. Triage needs the Rome-managed <code>gh</code> CLI signed in to read issues and
        apply labels. Connect GitHub in Settings → Connections, then refresh.
      </AlertDescription>
    </Alert>
  );
}
