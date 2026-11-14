import { useEffect, useRef, useState } from "react";
import { postJson, type CallOutcome } from "../api";

interface EndpointCallState {
  endpoint: string;
  running: "dry" | "send" | null;
  outcome: CallOutcome | null;
  error: string | null;
  uncertain: boolean;
}

/** Own a submission by endpoint and generation, without cancelling/replaying it. */
export function useEndpointCall(endpoint: string) {
  const sequence = useRef(0);
  const inFlight = useRef<string | null>(null);
  const [state, setState] = useState<EndpointCallState | null>(null);

  useEffect(() => () => { sequence.current++; inFlight.current = null; }, [endpoint]);

  function setError(error: string | null) {
    setState((previous) => previous?.endpoint === endpoint
      ? { ...previous, error, uncertain: false }
      : { endpoint, running: null, outcome: null, error, uncertain: false });
  }

  async function send(input: Record<string, unknown>, kind: "dry" | "send") {
    if (inFlight.current === endpoint) return;
    const request = ++sequence.current;
    inFlight.current = endpoint;
    setState({ endpoint, running: kind, outcome: null, error: null, uncertain: false });
    try {
      const outcome = await postJson<CallOutcome>("call", input);
      if (request === sequence.current) setState({ endpoint, running: null, outcome, error: null, uncertain: false });
    } catch (error) {
      // Losing the app HTTP response is not proof that its upstream call was unsent.
      if (request === sequence.current) setState({ endpoint, running: null, outcome: null, error: (error as Error).message, uncertain: true });
    } finally {
      if (request === sequence.current) inFlight.current = null;
    }
  }

  // Identity filtering also prevents a stale frame before effect cleanup runs.
  const visible = state?.endpoint === endpoint ? state : null;
  return { running: visible?.running ?? null, outcome: visible?.outcome ?? null, error: visible?.error ?? null, uncertain: visible?.uncertain ?? false, send, setError };
}
