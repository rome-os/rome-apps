/**
 * Shared GitHub CLI helpers for the new-flow (mention-handling) actions:
 * emoji reactions (👀 ack / 🚀 success / 😕 failure) and issue/PR comment
 * posting. Kept separate from pr-review/index.ts so the existing review chain
 * stays byte-for-byte unchanged (design doc §10).
 */
import { execFileSync } from "child_process";
import { createAppLogger } from "@rome-os/app-runtime";
import { sanitizeCliError } from "./cli-errors.js";

const log = createAppLogger("code-review_github");

/** Validate a repo slug to prevent shell injection. */
export function validateRepoSlug(slug: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(slug)) {
    throw new Error(`Invalid repository slug: ${slug}. Expected format: owner/repo`);
  }
}

export type ReactionContent = "eyes" | "rocket" | "confused" | "+1" | "-1";

export interface ReactionHandle {
  reactionId: number;
  target: "issue" | "comment";
  targetId: number;
}

/** Add a reaction to an issue/PR (issue-level). */
export function addIssueReaction(repoSlug: string, issueNumber: number, content: ReactionContent): ReactionHandle | null {
  validateRepoSlug(repoSlug);
  try {
    const payload = JSON.stringify({ content });
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/issues/${issueNumber}/reactions`, "--method", "POST", "--input", "-"],
      { encoding: "utf-8", timeout: 15000, input: payload },
    );
    const data = JSON.parse(result);
    return { reactionId: data.id, target: "issue", targetId: issueNumber };
  } catch (err) {
    log.warn("Failed to add issue reaction", { repo: repoSlug, issueNumber, content, error: sanitizeCliError(err) });
    return null;
  }
}

/** Add a reaction to a specific issue comment. */
export function addCommentReaction(repoSlug: string, commentId: number, content: ReactionContent): ReactionHandle | null {
  validateRepoSlug(repoSlug);
  try {
    const payload = JSON.stringify({ content });
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/issues/comments/${commentId}/reactions`, "--method", "POST", "--input", "-"],
      { encoding: "utf-8", timeout: 15000, input: payload },
    );
    const data = JSON.parse(result);
    return { reactionId: data.id, target: "comment", targetId: commentId };
  } catch (err) {
    log.warn("Failed to add comment reaction", { repo: repoSlug, commentId, content, error: sanitizeCliError(err) });
    return null;
  }
}

/** Remove a previously added reaction. Best-effort. */
export function removeReaction(repoSlug: string, handle: ReactionHandle): void {
  validateRepoSlug(repoSlug);
  try {
    const base = handle.target === "issue"
      ? `repos/${repoSlug}/issues/${handle.targetId}/reactions/${handle.reactionId}`
      : `repos/${repoSlug}/issues/comments/${handle.targetId}/reactions/${handle.reactionId}`;
    execFileSync("gh", ["api", base, "--method", "DELETE"], { encoding: "utf-8", timeout: 15000 });
  } catch (err) {
    log.warn("Failed to remove reaction", { repo: repoSlug, target: handle.target, targetId: handle.targetId, error: sanitizeCliError(err) });
  }
}

/**
 * Footer appended to every AI-authored comment so it is clearly identifiable as
 * a RomeOS reply — mirrors the existing PR-review footer for consistency.
 */
export const ROME_REPLY_FOOTER = "\n\n---\n*Replied by [RomeOS](https://romeos.io)*";

/** Append the RomeOS footer unless the body already carries it. */
export function withRomeFooter(body: string): string {
  return body.includes("Replied by [RomeOS]") ? body : `${body}${ROME_REPLY_FOOTER}`;
}

/**
 * Post a comment on an issue or PR (both use the issues comments endpoint in
 * GitHub's model). The RomeOS reply footer is appended automatically so every
 * bot comment is identifiable as AI-authored. Returns the created comment's
 * html_url, or null on failure.
 */
export function postIssueComment(repoSlug: string, issueNumber: number, body: string): string | null {
  validateRepoSlug(repoSlug);
  try {
    const payload = JSON.stringify({ body: withRomeFooter(body) });
    const result = execFileSync(
      "gh", ["api", `repos/${repoSlug}/issues/${issueNumber}/comments`, "--method", "POST", "--input", "-"],
      { encoding: "utf-8", timeout: 30000, input: payload },
    );
    const data = JSON.parse(result);
    return data.html_url || null;
  } catch (err) {
    log.error("Failed to post issue comment", { repo: repoSlug, issueNumber, error: sanitizeCliError(err) });
    return null;
  }
}
