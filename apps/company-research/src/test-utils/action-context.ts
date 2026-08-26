import { AsyncLocalStorage } from "node:async_hooks";
import {
  setCurrentActionContextResolver,
  setCurrentActionContextRunner,
  type CurrentActionContextPatch,
  type ThreadContext,
} from "@rome-os/app-runtime";

export interface ActionExecutionStore {
  executionId: string;
  rootExecutionId: string;
  initiator: string;
  engine?: unknown;
  channelContext?: ThreadContext;
  sharedContext?: Record<string, unknown>;
  sessionId?: string;
  agentName?: string;
  channelThreadKey?: string;
  runtimeObserver?: unknown;
}

export const actionExecutionContext = new AsyncLocalStorage<ActionExecutionStore>();

setCurrentActionContextResolver(() => {
  const store = actionExecutionContext.getStore();
  if (!store) {
    return undefined;
  }

  return {
    channelContext: store.channelContext,
    sessionId: store.sessionId,
    agentName: store.agentName,
    channelThreadKey: store.channelThreadKey,
    sharedContext: store.sharedContext,
  };
});

function mergeSharedContext(
  store: ActionExecutionStore,
  patch: CurrentActionContextPatch,
): Record<string, unknown> | undefined {
  if (patch.sharedContext === undefined) {
    return store.sharedContext;
  }

  return {
    ...(store.sharedContext ?? {}),
    ...patch.sharedContext,
  };
}

setCurrentActionContextRunner(async <T>(patch: CurrentActionContextPatch, fn: () => Promise<T>) => {
  const store = actionExecutionContext.getStore();
  if (!store) {
    return await fn();
  }

  return await actionExecutionContext.run(
    {
      ...store,
      ...patch,
      sharedContext: mergeSharedContext(store, patch),
    },
    fn,
  );
});
