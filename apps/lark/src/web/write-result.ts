export function writeResult(result: Record<string, unknown> | null) {
  const data = result?.data as Record<string, unknown> | undefined;
  const status =
    result?.status === "error"
      ? result.error
      : (data?.status ?? result?.status);
  return {
    waiting: status === "pending_approval",
    unknown:
      status === "outcome_unknown" ||
      status === "outcome_unknown_do_not_retry" ||
      data?.outcomeUnknown === true,
    inProgress: status === "request_in_progress",
    duplicate: status === "duplicate",
    approvalId: String(result?.approvalId ?? data?.approvalId ?? ""),
    requestId: String(result?.requestId ?? data?.requestId ?? ""),
    executionId: String(result?.executionId ?? data?.executionId ?? ""),
  };
}

export function createSubmissionGate() {
  let busy = false;
  let hasWriteReceipt = false;
  return {
    begin(preview: boolean, write: boolean) {
      if (busy || (!preview && write && hasWriteReceipt)) return;
      const requestId =
        !preview && write ? `lark-ui-${crypto.randomUUID()}` : undefined;
      busy = true;
      return { preview, requestId };
    },
    finish(keepReceipt = false) {
      hasWriteReceipt ||= keepReceipt;
      busy = false;
    },
    newIntent() {
      if (busy) return false;
      hasWriteReceipt = false;
      return true;
    },
  };
}

type WriteIntent = {
  connectionId: string;
  commandId: string;
  requestId: string;
  inFlight: boolean;
  receipt: Record<string, unknown> | null;
};

type WriteReceiptStatus =
  | "pending_approval"
  | "outcome_unknown"
  | "duplicate"
  | "request_in_progress";

const storageKey = "rome:lark:write-intents";
const receiptStatuses: WriteReceiptStatus[] = [
  "pending_approval",
  "outcome_unknown",
  "duplicate",
  "request_in_progress",
];

function savedReceipt(intent: WriteIntent) {
  const { waiting, unknown, duplicate, inProgress, approvalId, executionId } =
    writeResult(intent.receipt);
  const status = waiting
    ? "pending_approval"
    : intent.inFlight || unknown
      ? "outcome_unknown"
      : duplicate
        ? "duplicate"
        : inProgress
          ? "request_in_progress"
          : undefined;
  if (!status) return [];
  // A reload can interrupt the response, so retain the ID as an uncertain write.
  const data = intent.receipt?.data as Record<string, unknown> | undefined;
  const outcome = intent.receipt?.outcome ?? data?.outcome;
  return [
    {
      ...intent,
      inFlight: false,
      receipt: {
        status,
        approvalId,
        executionId,
        requestId: intent.requestId,
        ...(outcome === "succeeded" || outcome === "failed" ? { outcome } : {}),
      },
    },
  ];
}

export function createWriteIntentStore() {
  const intents = new Map<string, WriteIntent>();
  const listeners = new Set<() => void>();
  const key = (connectionId: string, commandId: string) =>
    JSON.stringify([connectionId, commandId]);
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(saved)) {
      for (const intent of saved) {
        if (
          typeof intent?.connectionId === "string" &&
          typeof intent.commandId === "string" &&
          typeof intent.requestId === "string" &&
          intent.requestId.startsWith("lark-ui-") &&
          receiptStatuses.includes(intent.receipt?.status)
        ) {
          intents.set(key(intent.connectionId, intent.commandId), {
            connectionId: intent.connectionId,
            commandId: intent.commandId,
            requestId: intent.requestId,
            inFlight: false,
            receipt: {
              status: intent.receipt.status,
              requestId: intent.requestId,
              approvalId:
                typeof intent.receipt.approvalId === "string"
                  ? intent.receipt.approvalId
                  : "",
              executionId:
                typeof intent.receipt.executionId === "string"
                  ? intent.receipt.executionId
                  : "",
              ...(intent.receipt.outcome === "succeeded" ||
              intent.receipt.outcome === "failed"
                ? { outcome: intent.receipt.outcome }
                : {}),
            },
          });
        }
      }
    }
  } catch {
    // In-memory state still protects requests when the host blocks storage.
  }
  function changed() {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify([...intents.values()].flatMap(savedReceipt)),
      );
    } catch {
      // The session can continue with the in-memory state.
    }
    for (const listener of listeners) listener();
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get(connectionId: string, commandId: string) {
      return intents.get(key(connectionId, commandId));
    },
    connectionFor(commandId: string) {
      return [...intents.values()].find((intent) => intent.commandId === commandId)
        ?.connectionId;
    },
    begin(connectionId: string, commandId: string) {
      const id = key(connectionId, commandId);
      if (intents.has(id)) return;
      const requestId = `lark-ui-${crypto.randomUUID()}`;
      intents.set(id, { connectionId, commandId, requestId, inFlight: true, receipt: null });
      changed();
      return requestId;
    },
    finish(
      connectionId: string,
      commandId: string,
      requestId: string,
      receipt: Record<string, unknown> | null,
    ) {
      const id = key(connectionId, commandId);
      const intent = intents.get(id);
      if (intent?.requestId !== requestId || !intent.inFlight) return;
      if (receipt) {
        intents.set(id, {
          ...intent,
          inFlight: false,
          receipt: { ...receipt, requestId },
        });
      } else {
        intents.delete(id);
      }
      changed();
    },
    reset(connectionId: string, commandId: string, explicit = false) {
      const id = key(connectionId, commandId);
      const intent = intents.get(id);
      const { waiting, unknown, inProgress, duplicate } = writeResult(
        intent?.receipt ?? null,
      );
      if (
        intent?.inFlight ||
        (!explicit && (waiting || unknown || inProgress || duplicate))
      )
        return false;
      if (intents.delete(id)) changed();
      return true;
    },
  };
}

export type WriteIntentStore = ReturnType<typeof createWriteIntentStore>;
