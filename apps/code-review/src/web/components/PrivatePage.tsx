import { CallerBadge } from "@rome-os/app-web-sdk";
import { LockKeyhole } from "lucide-react";

/** The host serves the public SPA; private pages never mount owner controls. */
export function PrivatePage() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <LockKeyhole className="size-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-foreground">This page is private to the owner</h1>
      <p className="text-sm text-muted-foreground">
        PR history for public GitHub repositories is available through its direct link.
        Signing in does not grant access to the owner's dashboard or settings.
      </p>
      <CallerBadge signedOutHint="Sign in to identify yourself with Rome Cloud." />
    </section>
  );
}
