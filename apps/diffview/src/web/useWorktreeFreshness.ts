import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Reconcile independently arriving event/list queries without repeatedly chasing an old event. */
export function useWorktreeFreshness({
  scope,
  context,
  mode,
  listFingerprint,
  eventFingerprint,
}: {
  scope: string;
  context: string;
  mode: string;
  listFingerprint?: string;
  eventFingerprint?: string;
}) {
  const client = useQueryClient();
  const checked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (mode !== "uncommitted" || !listFingerprint || !eventFingerprint) return;
    const key = JSON.stringify([scope, context, mode, eventFingerprint]);
    if (listFingerprint === eventFingerprint) {
      checked.current = undefined;
      return;
    }
    // The event may itself be older than the list. Reconcile once for this event, not once
    // per response/list version: repeated mismatches cannot form an invalidation loop.
    if (checked.current === key) return;
    checked.current = key;
    void client.invalidateQueries({ queryKey: ["files", scope] });
  }, [client, scope, context, mode, listFingerprint, eventFingerprint]);
}
