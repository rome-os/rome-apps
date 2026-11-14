import { test } from "node:test";
import assert from "node:assert/strict";
import { setCurrentActionContextResolver, type AppActionRuntimeDeps, type CurrentActionContext } from "@rome-os/app-runtime";
import { guarded } from "../src/lib/runtime.js";

const deps = { appContext: { db: { tablePrefix: "access", connection: {} }, repositories: { settings: { get: async () => "en" } } } } as unknown as AppActionRuntimeDeps;

test("private actions reject visitor, anonymous, missing actor and group contexts before service work", async () => {
  for (const context of [
    undefined,
    { actorKind: "visitor" },
    { actorKind: "anonymous" },
    { actorKind: "guardian", channelContext: { threadType: "group" } },
    { actorKind: "guardian", channelContext: {} },
    { actorKind: "guardian", channelContext: { threadType: "private", senderBondLevel: "acquaintance" } },
  ]) {
    setCurrentActionContextResolver(() => context as CurrentActionContext | undefined);
    let executed = false;
    try {
      const out = await guarded(deps, async () => { executed = true; return {}; });
      assert.equal(out.status, "error");
      assert.equal(executed, false);
    } finally { setCurrentActionContextResolver(null); }
  }
});

test("host-attributed guardian private actions still execute", async () => {
  setCurrentActionContextResolver(() => ({ actorKind: "guardian", channelContext: { threadType: "private" } }) as unknown as CurrentActionContext);
  try { assert.equal((await guarded(deps, async () => ({ mock: true }))).status, "ok"); }
  finally { setCurrentActionContextResolver(null); }
});
