import { test } from "node:test";
import assert from "node:assert/strict";
import { setCurrentActionContextResolver, type CurrentActionContext, type AppActionRuntimeDeps, type ActionConfig, type RomeAppContext, type RomeAppApiRequest } from "@rome-os/app-runtime";
import { TikHubService } from "../src/lib/service.js";
import { parsePriceList } from "../src/lib/openapi.js";
import { createRepositories } from "../src/db/repositories/index.js";
import { createAction as createCallAction } from "../src/actions/call/index.js";
import { createAction as createAccountAction } from "../src/actions/account/index.js";
import { createAction as createInspectAction } from "../src/actions/inspect-endpoint/index.js";
import { createAction as createParseAction } from "../src/actions/parse-video/index.js";
import { createApiHandler } from "../src/api/index.js";
import { testDb } from "./sqlite.js";
import { fakeFetch, loadDoc, loadPrices, memoryRepos } from "./helpers.js";
const KEY = "review2_synthetic_key_never_real_1234";
const config = { name: "synthetic", description: "Synthetic review", type: "custom", complexity: "simple", speed: "fast", reliability: "high", sideEffects: "read-only" } as ActionConfig;
let seq=0;
function setup(body: unknown) {
  const repos = memoryRepos();
  repos.settings.set("apiKey",KEY);
  repos.cache.set("openapi",JSON.stringify(loadDoc()));
  repos.cache.set("prices",JSON.stringify(parsePriceList(loadPrices())));
  const f = fakeFetch(()=>({body}));
  return {svc:new TikHubService({tablePrefix:"review2" + ++seq} as never,f.impl,repos),f};
}
async function withAction(mode: "blocked"|"business-error"|"unknown"|"unauthorized"|"success", fn: (deps:AppActionRuntimeDeps, f: ReturnType<typeof fakeFetch>)=>Promise<void>) {
  const database=testDb();
  const repos=createRepositories(database.db);
  repos.settings.set("apiKey",KEY);
  repos.cache.set("openapi",JSON.stringify(loadDoc()));
  repos.cache.set("prices",JSON.stringify(parsePriceList(loadPrices())));
  const original=globalThis.fetch;
  const f=fakeFetch(()=>mode==="unknown"?new Error("synthetic lost response"):mode==="unauthorized"?{status:401,body:{detail:{message:KEY}}}:{body:{code:mode==="success"?200:500,data:{synthetic:true}}});
  globalThis.fetch=f.impl;
  setCurrentActionContextResolver(()=>({actorKind:"guardian",channelContext:{threadType:"private"}}) as unknown as CurrentActionContext);
  const appContext={db:database.db,repositories:{settings:{get:async()=>"en"}}} as unknown as RomeAppContext;
  try {await fn({appContext} as AppActionRuntimeDeps, f);}
  finally {globalThis.fetch=original; setCurrentActionContextResolver(null);database.close();}
}
for (const mode of ["blocked","business-error","unknown","unauthorized"] as const) {
  test(`R1: formal ${mode} action must return outer error, not outer ok`,()=>withAction(mode,async deps=>{
    const out=await (mode==="unknown"?createParseAction(config,deps).execute({url:"https://v.douyin.com/synthetic/"}):createCallAction(config,deps).execute(mode==="blocked"?{path:"/api/v1/douyin/web/fetch_user_collects",body:{cookie:"synthetic-private-value"}}:{path:"/api/v1/hybrid/video_data",query:{url:"synthetic"}}));
    const d=(out as {data?:Record<string,unknown>}).data;
    console.log(JSON.stringify({case:mode,outer:out.status,inner:d?.status,innerOk:d?.ok,outcomeUnknown:d?.outcomeUnknown}));
    assert.equal(out.status,"error");
    if (out.status === "error") {
      assert.match(out.error, /Call log [a-f0-9-]{36}/);
      assert.match(out.error, mode === "unknown" ? /Cost unknown/ : (mode === "blocked" || mode === "unauthorized") ? /Not billed/ : /Base estimate \$0.001/);
      assert.equal(out.error.includes(KEY), false);
    }
  }));
}
for(const field of ["cursor","log_pb"] as const) {
  test(`R2: ${field} must not bypass agent serialized response budget`,async()=>{
    const {svc}=setup({code:200,data:{[field]:field==="cursor"?"x".repeat(250000):{arbitrary:"x".repeat(250000)}}});
    const out=await svc.call({path:"/api/v1/hybrid/video_data",query:{url:"synthetic"},maxChars:2000},"agent");
    const dataChars=JSON.stringify(out.data).length;
    const paginationChars=JSON.stringify(out.pagination).length;
    console.log(JSON.stringify({case:field,status:out.status,dataChars,paginationChars,totalChars:JSON.stringify(out).length}));
    assert.ok(dataChars<=2000);
    assert.ok(paginationChars<=2000,"pagination exceeds the entire requested data budget");
    assert.ok(JSON.stringify({data:out.data,pagination:out.pagination}).length <= 2000);
    assert.equal(out.paginationOmitted, true);
    assert.equal(out.pagination, null);
    assert.ok(out.warnings.some(w => /pagination/.test(w)));
  });
}
test("Trust boundary: spoofed args cannot replace trusted actor; guardian group and unknown threads rejected",async()=>{
  let accessed=false;
  const appContext={get db(){accessed=true;throw new Error("synthetic guard breach")},repositories:{settings:{get:async()=>"en"}}} as unknown as RomeAppContext;
  for(const context of [undefined,{actorKind:"visitor",channelContext:{threadType:"private"}},{actorKind:"guardian",channelContext:{threadType:"group"}},{actorKind:"guardian",channelContext:{}},{actorKind:"guardian",channelContext:{threadType:"private",senderBondLevel:"visitor"}}]) {
    setCurrentActionContextResolver(()=>context as unknown as CurrentActionContext);
    try {
      const out=await createCallAction(config,{appContext} as AppActionRuntimeDeps).execute({path:"/api/v1/hybrid/video_data",actorKind:"guardian",channelContext:{threadType:"private"},confirm:true});
      assert.equal(out.status,"error");assert.equal(accessed,false);
    } finally {setCurrentActionContextResolver(null);}
  }
});
test("Trust boundary: every sensitive HTTP route rejects absent/visitor caller despite forged guardian headers",async()=>{
  let accessed=false;
  const ctx={get db(){accessed=true;throw new Error("synthetic guard breach")}} as unknown as RomeAppContext;
  const api=createApiHandler(ctx);
  for(const caller of [undefined,{kind:"visitor"},{kind:"anonymous"}]) for(const [method,path] of [["GET",["status"]],["GET",["settings"]],["POST",["settings"]],["GET",["account"]],["GET",["calls"]],["POST",["catalog","refresh"]],["POST",["call"]]] as const) {
    const res=await api.handle({caller,method,path:[...path],headers:{"x-rome-caller-kind":"guardian","x-rome-actor-kind":"guardian"},query:new URLSearchParams()} as unknown as RomeAppApiRequest);
    assert.equal(res.status,403); assert.equal(accessed,false);
  }
});

test("R1: failed account lookup must return outer error",()=>withAction("business-error",async deps=>{
 const out=await createAccountAction(config,deps).execute({});
 console.log(JSON.stringify({case:"account-business-error",outer:out.status,innerOk:(out as {data?:{ok?:boolean}}).data?.ok}));
 assert.equal(out.status,"error");
}));
test("R1: missing endpoint contract must return outer error",()=>withAction("business-error",async deps=>{
 const out=await createInspectAction(config,deps).execute({path:"/api/v1/hybrid/synthetic_missing"});
 console.log(JSON.stringify({case:"missing-contract",outer:out.status,hasDataError:!!(out as {data?:{error?:unknown}}).data?.error}));
 assert.equal(out.status,"error");
}));

test("R1: successful calls and previews retain the compatible outer ok shape",()=>withAction("success",async deps=>{
 for (const dryRun of [false,true]) {
  const out=await createCallAction(config,deps).execute({path:"/api/v1/hybrid/video_data",query:{url:"synthetic"},dryRun});
  assert.equal(out.status,"ok");
  if(out.status==="ok") assert.equal((out.data as {ok:boolean}).ok,true);
 }
}));

test("R1: synthetic unconfigured account is an intentional status query, not an upstream error",()=>withAction("success",async (deps,f)=>{
 createRepositories(deps.appContext.db).settings.delete("apiKey");
 const out=await createAccountAction(config,deps).execute({});
 assert.equal(out.status,"ok");
 if(out.status==="ok") assert.equal((out.data as {configured:boolean}).configured,false);
 assert.equal(f.calls.length,0);
}));
test("R1: only daily-usage failure remains an explicit partial account result",()=>withAction("success",async deps=>{
 globalThis.fetch=fakeFetch(url=>url.pathname.endsWith("get_user_info")?{body:{code:200,user_data:{balance:1}}}:{status:503,body:{synthetic:true}}).impl;
 const out=await createAccountAction(config,deps).execute({});
 assert.equal(out.status,"ok");
 if(out.status==="ok") { const data=out.data as {ok:boolean;dailyUsageError:string;tikhubDailyUsage:unknown}; assert.equal(data.ok,true);assert.ok(data.dailyUsageError);assert.equal(data.tikhubDailyUsage,null); }
}));
