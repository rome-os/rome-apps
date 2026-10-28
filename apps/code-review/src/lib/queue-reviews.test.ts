import { describe, expect, it, vi } from "vitest";
import type { ScanRepository } from "../db/repositories/repo.js";
import { queueReviews } from "./queue-reviews.js";

describe("queueReviews", () => {
  it("persists main plus enabled snapshots before dispatch and accepts all detached runs in parallel", async () => {
    const rows: any[] = [];
    const db = {
      listReviewLenses: vi.fn(() => [
        { id: "design-alternatives", name: "Design & Alternatives", instructions: "Compare approaches", enabled: true },
        { id: "off", enabled: false },
        { id: "security", name: "Security", instructions: "Audit trust boundaries", enabled: true },
      ]),
      createQueuedPRReview: vi.fn((input) => {
        const row = { id: String(rows.length), ...input };
        rows.push(row);
        return row;
      }),
      failPRReview: vi.fn(),
    };
    const accept: Array<() => void> = [];
    const runAction = vi.fn(() => {
      expect(rows).toHaveLength(3);
      return new Promise<any>((resolve) => accept.push(() => resolve({ executionId: "accepted" })));
    });
    const input = { repo: "o/r", prNumber: 7, headSha: "abc", triggerCommentId: 12 };
    const queued = queueReviews(db as unknown as ScanRepository, runAction as any, input);
    expect(runAction).toHaveBeenCalledTimes(3); // No dispatch awaits another.
    accept.forEach((resolve) => resolve());
    expect(await queued).toEqual(rows);
    expect(rows[0]).not.toHaveProperty("lensId");
    expect(rows[1]).toMatchObject({ lensId: "design-alternatives", lensName: "Design & Alternatives", lensInstructions: "Compare approaches" });
    expect(rows[2]).toMatchObject({ lensId: "security", lensName: "Security" });
    expect(db.listReviewLenses).toHaveBeenCalledWith("o/r");
    for (const row of rows) {
      expect(runAction).toHaveBeenCalledWith("code-review:code-review_pr-review",
        { repo: "o/r", prNumber: 7, reviewId: row.id, triggerCommentId: 12 }, { detached: true });
      expect(row).not.toHaveProperty("triggerCommentId");
    }
  });

  it("records a dispatch failure per row without preventing the other runs", async () => {
    const db = {
      listReviewLenses: () => [{ id: "a", name: "A", instructions: "Audit", enabled: true }],
      createQueuedPRReview: vi.fn().mockReturnValueOnce({ id: "main" }).mockReturnValueOnce({ id: "lens" }),
      failPRReview: vi.fn(),
    };
    const runAction = vi.fn().mockRejectedValueOnce(new Error("Rejected")).mockResolvedValueOnce({});
    await queueReviews(db as unknown as ScanRepository, runAction as any, { repo: "o/r", prNumber: 7 });
    expect(db.failPRReview).toHaveBeenCalledWith("main", expect.stringContaining("Rejected"));
    expect(runAction).toHaveBeenCalledTimes(2);
  });
});
