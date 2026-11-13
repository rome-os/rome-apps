import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { setCurrentActionContextResolver } from "@rome-os/app-runtime";
const home = await mkdtemp(join(tmpdir(), "diffview-agent-"));
const originalHome = process.env.HOME,
  originalProfile = process.env.ROME_PROFILE;
process.env.HOME = home;
process.env.ROME_PROFILE = "test";
const { ROOT, comparison, files } = await import("../src/lib/git");
const { inspectView, parseView, resolveView } =
  await import("../src/lib/agentView");
const { selectionStore } = await import("../src/lib/selectionStore");
const { createViewAction } = await import("../src/lib/agentAction");
const { handleAgentApi } = await import("../src/api/agent");
const { SelectionGate } = await import("../src/shared/selectionGate");
const { normalizeMode } = await import("../src/shared/mode");
const { scrollViewKey } = await import("../src/shared/scroll");
const { deriveReviewContext } = await import("../src/shared/reviewContext");
const raw = new Database(join(home, "state.sqlite"));
raw.exec(
  await readFile(
    new URL("../src/db/migrations/0000_agent_surfaces.sql", import.meta.url),
    "utf8",
  ),
);
const db = {
  connection: drizzle(raw),
  tablePrefix: "diffview__",
  tableName: (n: string) => "diffview__" + n,
};
const ctx = { db } as never,
  deps = { appContext: ctx };
const store = selectionStore(db);
let chat = "chat-one";
setCurrentActionContextResolver(() => ({
  actorKind: "guardian",
  channelContext: { channel: "webchat", threadId: chat },
}));
const repo = join(ROOT, "other project", "repo with spaces");
await mkdir(repo, { recursive: true });
const g = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
g("init", "-b", "main");
g("config", "user.name", "Fixture");
g("config", "user.email", "fixture@example.invalid");
await writeFile(join(repo, "base.txt"), "base\n");
g("add", ".");
g("commit", "-m", "base");
const base = g("rev-parse", "HEAD");
g("checkout", "-b", "feature");
await writeFile(join(repo, "feature.txt"), "feature\n");
g("add", ".");
g("commit", "-m", "feature");
const target = g("rev-parse", "HEAD");
g("checkout", "main");
await writeFile(join(repo, "main.txt"), "main\n");
g("add", ".");
g("commit", "-m", "main");
await writeFile(join(repo, "staged.txt"), "staged\n");
g("add", "staged.txt");
await writeFile(join(repo, "base.txt"), "changed\n");
await writeFile(join(repo, "untracked.txt"), "not read by overview\n");
const indexBefore = await readFile(join(repo, ".git", "index"));
const select = createViewAction("select", {} as never, deps);
const inspect = createViewAction("inspect", {} as never, deps);
const cardAction = createViewAction("card", {} as never, deps);
const call = async (
  method: string,
  path: string,
  body?: unknown,
  guardian = true,
) => {
  const res = await handleAgentApi(ctx, {
    method,
    path: path.split("/"),
    query: new URLSearchParams(),
    caller: { kind: guardian ? "guardian" : "anonymous" },
    body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
  } as never);
  return { status: res!.status, data: await res!.json() };
};
afterAll(async () => {
  raw.close();
  setCurrentActionContextResolver(null);
  await rm(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.ROME_PROFILE;
  else process.env.ROME_PROFILE = originalProfile;
});
test("Default chat selects a different project directory, without changing cwd/HEAD", async () => {
  const cwd = process.cwd(),
    head = g("rev-parse", "HEAD");
  const result = await select.execute({ repo });
  assert.equal(result.status, "ok");
  assert.equal(store.read(chat).state?.repo, repo);
  assert.equal(process.cwd(), cwd);
  assert.equal(g("rev-parse", "HEAD"), head);
});
test("trusted chat identity only; another chat remains isolated", async () => {
  const before = store.read("chat-one");
  chat = "chat-two";
  assert.equal(
    (
      await select.execute({
        repo,
        kind: "refs",
        base: "main",
        target: "feature",
      })
    ).status,
    "ok",
  );
  assert.deepEqual(store.read("chat-one"), before);
  assert.equal(store.read(chat).state?.toRef, target);
  assert.equal(
    (await select.execute({ repo, chatId: "chat-one" })).status,
    "error",
  );
  chat = "chat-one";
});
test("CAS rejects slow Agent results after a manual choice, also across DB handles", () => {
  const otherRaw = new Database(join(home, "state.sqlite"));
  try {
    const other = selectionStore({ ...db, connection: drizzle(otherRaw) });
    const revision = store.read(chat).revision;
    other.write(chat, { repo, mode: "uncommitted", filter: "staged" });
    assert.throws(
      () => store.write(chat, { repo, mode: "ref" }, revision),
      /selection_superseded/,
    );
    assert.equal(store.read(chat).state?.filter, "staged");
  } finally {
    otherRaw.close();
  }
});
test("poll gate rejects out-of-order, pre-manual and pending-manual responses", () => {
  const gate = new SelectionGate();
  assert.equal(gate.accept(1, 0), true);
  gate.beginManual();
  assert.equal(gate.accept(3, 0), false);
  assert.equal(gate.accept(3, 1), false);
  gate.finishManual(4);
  assert.equal(gate.accept(3, 1), false);
  assert.equal(gate.accept(5, 0), false);
  assert.equal(gate.accept(5, 1), true);
});
test("workspace overview has staged/unstaged/untracked counts and honest line-stat semantics", async () => {
  const result = await inspect.execute({ repo });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  const card = result.data as any;
  assert.equal(card.staged.files, 1);
  assert.equal(card.unstaged.files, 1);
  assert.equal(card.untracked, 1);
  assert.equal(card.totals.files, 3);
  assert.equal(card.totals.added, 2);
  assert.equal(card.totals.deleted, 1);
  assert.equal(card.lineStats, "tracked-only");
  assert.equal(card.stable, true);
  assert.ok(card.sampledAt);
});
test("two-dot compares both tips, three-dot compares merge base to requested target (not checkout)", async () => {
  const two = await inspectView(
    parseView({
      repo,
      kind: "refs",
      base: "main",
      target: "feature",
      dots: "two",
    }),
  );
  const three = await inspectView(
    parseView({
      repo,
      kind: "refs",
      base: "main",
      target: "feature",
      dots: "three",
    }),
  );
  assert.equal(two.targetSha, target);
  assert.equal(three.fromSha, base);
  assert.equal(two.totals.files, 2);
  assert.equal(three.totals.files, 1);
  const cmp = await comparison(repo, two.state as any);
  assert.equal(cmp.to, target);
  assert.equal((await files(repo, two.state as any, cmp)).length, 2);
  assert.notEqual(
    scrollViewKey({ repo, ...two.state } as any),
    scrollViewKey({ repo, ...two.state, toRef: base } as any),
  );
  assert.equal(normalizeMode(two.state).toRef, target);
  assert.deepEqual(deriveReviewContext(normalizeMode(two.state), "main", []), {
    driver: "none",
  });
});
test("historical card remains pinned after ref moves, does not steal sidebar until open", async () => {
  const selectionBefore = store.read(chat);
  const result = await cardAction.execute({
    repo,
    kind: "refs",
    base: "main",
    target: "feature",
  });
  assert.equal(result.status, "show_widget");
  if (result.status !== "show_widget") return;
  assert.equal(result.widget.componentId, "comparison-card");
  assert.equal("waits" in result.widget, false);
  const id = String(result.widget.props.cardId);
  assert.deepEqual(store.read(chat), selectionBefore);
  g("branch", "-f", "feature", "main");
  const read = await call("GET", "cards/" + id);
  assert.equal(read.data.targetSha, target);
  const opened = await call("POST", "cards/" + id + "/open", {
    chatId: "forged",
  });
  assert.equal(opened.data.chatId, chat);
  assert.equal(store.read(chat).state?.toRef, target);
  assert.equal(store.read("forged").revision, 0);
});
test("guardian-only API, strict payloads, missing refs, option injection, non-git and symlink escape", async () => {
  assert.equal(
    (await call("GET", "selection/" + chat, undefined, false)).status,
    403,
  );
  assert.equal(
    (await call("POST", "selection/" + chat, { repo, arbitrary: "bad" }))
      .status,
    400,
  );
  for (const input of [
    { repo: "relative" },
    { repo, kind: ["workspace"] },
    { repo, kind: "refs", base: "--help", target: "HEAD" },
    { repo, kind: "refs", base: "missing", target: "HEAD" },
    { repo: ROOT },
    { repo, kind: "refs", base: "HEAD", target: "HEAD", filter: "all" },
  ])
    assert.equal((await inspect.execute(input)).status, "error");
  const outside = join(home, "outside");
  await mkdir(outside);
  await symlink(outside, join(ROOT, "escape"));
  assert.equal(
    (await inspect.execute({ repo: join(ROOT, "escape") })).status,
    "error",
  );
  setCurrentActionContextResolver(() => ({ actorKind: "visitor" }));
  assert.equal((await inspect.execute({ repo })).status, "error");
  setCurrentActionContextResolver(() => ({
    actorKind: "guardian",
    channelContext: { channel: "webchat", threadId: chat },
  }));
});
test("symlink alias and Git worktree resolve correctly within the existing policy", async () => {
  const alias = join(ROOT, "alias");
  await symlink(repo, alias);
  assert.equal((await resolveView(parseView({ repo: alias }))).repo, repo);
  const worktree = join(ROOT, "linked worktree");
  g("worktree", "add", "--detach", worktree, base);
  const result = await inspectView(parseView({ repo: worktree }));
  assert.equal(result.repo, worktree);
  assert.equal(result.totals.files, 0);
});
test("no UI/automation context can still read structured overview, but cannot inject a chat selection", async () => {
  setCurrentActionContextResolver(() => ({ actorKind: "guardian" }));
  assert.equal((await inspect.execute({ repo })).status, "ok");
  assert.equal((await select.execute({ repo })).status, "error");
  setCurrentActionContextResolver(() => ({
    actorKind: "guardian",
    channelContext: { channel: "webchat", threadId: chat },
  }));
});
test("Git index and current branch were not modified by inspection", async () => {
  assert.deepEqual(await readFile(join(repo, ".git", "index")), indexBefore);
  assert.equal(g("branch", "--show-current"), "main");
});

test("overview stays bounded for a large textual diff; files API honors explicit target SHA", async () => {
  const big = join(ROOT, "large overview");
  await mkdir(big, { recursive: true });
  const g2 = (...args: string[]) =>
    execFileSync("git", args, { cwd: big, stdio: "pipe" }).toString().trim();
  g2("init", "-b", "main");
  g2("config", "user.name", "Fixture");
  g2("config", "user.email", "fixture@example.invalid");
  await writeFile(join(big, "large.txt"), "old\n");
  g2("add", ".");
  g2("commit", "-m", "initial");
  const from = g2("rev-parse", "HEAD");
  await writeFile(join(big, "large.txt"), "line\n".repeat(25000));
  g2("commit", "-am", "large");
  const to = g2("rev-parse", "HEAD");
  const overview = await inspectView(
    parseView({ repo: big, kind: "refs", base: from, target: to }),
  );
  assert.equal(overview.totals.added, 25000);
  assert.ok(JSON.stringify(overview).length < 2500);
  assert.equal("files" in overview, false);
  assert.equal("patch" in overview, false);
  const { createApiHandler } = await import("../src/api/index");
  const response = await createApiHandler(ctx).handle({
    caller: { kind: "guardian" },
    method: "GET",
    path: ["files"],
    query: new URLSearchParams({
      repo: big,
      mode: "ref",
      ref: to,
      toRef: from,
      target: "head",
      dots: "two",
      ctx: "3",
    }),
  } as never);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.head, from);
  assert.equal(data.files[0].deleted, 25000);
  assert.ok(data.page);
});

test("unmerged numstat records count each conflicted path once", async () => {
  const conflicted = join(ROOT, "conflicted overview");
  await mkdir(conflicted, { recursive: true });
  const cg = (...args: string[]) =>
    execFileSync("git", args, { cwd: conflicted, stdio: "pipe" })
      .toString()
      .trim();
  cg("init", "-b", "main");
  cg("config", "user.name", "Fixture");
  cg("config", "user.email", "fixture@example.invalid");
  const path = "conflicted\tline\nname.txt";
  await writeFile(join(conflicted, path), "base\n");
  cg("add", ".");
  cg("commit", "-m", "base");
  cg("checkout", "-b", "side");
  await writeFile(join(conflicted, path), "side\n");
  cg("commit", "-am", "side");
  cg("checkout", "main");
  await writeFile(join(conflicted, path), "main\n");
  cg("commit", "-am", "main");
  assert.throws(() => cg("merge", "side"));
  const index = await readFile(join(conflicted, ".git", "index"));
  const head = cg("rev-parse", "HEAD");
  const summary = await inspectView(
    parseView({ repo: conflicted, kind: "workspace", filter: "unstaged" }),
  );
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.unstaged?.files, 1);
  assert.equal(summary.totals.files, 1);
  assert.ok(summary.totals.added > 0);
  assert.deepEqual(await readFile(join(conflicted, ".git", "index")), index);
  assert.equal(cg("rev-parse", "HEAD"), head);
});
