import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  gh: vi.fn(), post: vi.fn(),
  db: { hasMentionTaskForComment: vi.fn(), createMentionTask: vi.fn(), updateMentionTaskStage: vi.fn(),
    getPRReviewSettings: vi.fn(), setMentionTaskRomeSession: vi.fn(), isMentionTaskCancelled: vi.fn(),
    completeMentionTask: vi.fn(), failMentionTask: vi.fn() },
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.gh }));
vi.mock("../../db/repositories/repo.js", () => ({ createScanRepository: () => mocks.db }));
vi.mock("../../utils/github.js", () => ({ postIssueComment: mocks.post, validateRepoSlug: (repo: string) => { if (!/^[\w-]+\/[\w-]+$/.test(repo)) throw new Error("invalid"); } }));
import { createAction } from "./index.js";
const config: any = { name: "code-review_pr-assistant" };
const input = { repo: "o/r", number: 3, surface: "issue", commentBody: "@bot ask why?", triggerCommentId: 2, actorLogin: "alice" };
function action(output: unknown = { reply: "Because of compatibility." }) {
  const invokeAction = vi.fn(() => ({ events: (async function* () {})(), result: Promise.resolve({ status: "ok", data: { output } }) }));
  return { invokeAction, action: createAction(config, { appContext: { db: {}, invokeAction } } as any) };
}
describe("reply-only Assistant", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.gh.mockReturnValue('{"title":"Issue","body":"Question"}');
    mocks.db.createMentionTask.mockReturnValue({ id: "task-1" }); mocks.post.mockReturnValue("https://github.com/o/r/issues/3#issuecomment-1");
  });
  it("persists a general mention task and posts a framed reply", async () => {
    const a = action();
    expect(await a.action.execute(input)).toMatchObject({ status: "ok", data: { taskId: "task-1" } });
    expect(mocks.db.createMentionTask).toHaveBeenCalledWith({ ...input, intent: "general" });
    expect(a.invokeAction).toHaveBeenCalledWith("system:summon", expect.objectContaining({ agentName: "code-review:code-review-assistant" }));
    expect(mocks.post).toHaveBeenCalledWith("o/r", 3, "### Assistant\n\nBecause of compatibility.");
    expect(mocks.db.completeMentionTask).toHaveBeenCalled();
  });
  it("does not re-run a redelivered comment", async () => {
    mocks.db.hasMentionTaskForComment.mockReturnValue(true);
    expect(await action().action.execute(input)).toMatchObject({ data: { skipped: "already-handled" } });
    expect(mocks.db.createMentionTask).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
  });
  it("does not publish a cancelled or empty answer", async () => {
    mocks.db.isMentionTaskCancelled.mockReturnValue(true);
    expect(await action().action.execute(input)).toMatchObject({ data: { status: "cancelled" } });
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.db.isMentionTaskCancelled.mockReturnValue(false);
    expect(await action({}).action.execute(input)).toMatchObject({ status: "error" });
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.db.failMentionTask).toHaveBeenCalled();
  });
  it("validates inputs before reading GitHub", async () => {
    expect(await action().action.execute({ ...input, number: -1 })).toMatchObject({ status: "error" });
    expect(mocks.gh).not.toHaveBeenCalled();
  });
});
