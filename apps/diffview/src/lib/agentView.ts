import { isAbsolute, basename } from "node:path";
import {
  allowedRepo,
  sha,
  git,
  comparison,
  fingerprintInfo,
  GitError,
  parseNumstat,
  type Mode,
} from "./git.js";
import {
  DEFAULT_CHAT_STATE,
  pickChatState,
  type ChatState,
} from "../shared/prefs.js";
export interface ViewInput {
  repo: string;
  kind: "workspace" | "refs";
  filter?: "all" | "staged" | "unstaged";
  base?: string;
  target?: string;
  dots?: "two" | "three";
}
export interface Counts {
  files: number;
  added: number;
  deleted: number;
  binary: number;
}
export interface ReviewCard {
  repo: string;
  name: string;
  branch: string;
  sampledAt: string;
  finishedAt: string;
  kind: ViewInput["kind"];
  state: ChatState;
  totals: Counts;
  base?: string;
  target?: string;
  dots?: string;
  baseSha?: string;
  targetSha?: string;
  fromSha?: string;
  staged?: Counts;
  unstaged?: Counts;
  untracked?: number;
  conflicts?: number;
  stable: boolean;
  lineStats: "tracked-only" | "commits";
}
export const viewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["repo"],
  properties: {
    repo: {
      type: "string",
      description:
        "Absolute local repository/worktree root within the existing projects access boundary.",
    },
    kind: { type: "string", enum: ["workspace", "refs"], default: "workspace" },
    filter: { type: "string", enum: ["all", "staged", "unstaged"] },
    base: {
      type: "string",
      description: "Required for refs. Resolved locally to a commit SHA.",
    },
    target: {
      type: "string",
      description: "Required for refs. Any local commit-ish, not just HEAD.",
    },
    dots: { type: "string", enum: ["two", "three"], default: "two" },
  },
};
export function parseView(raw: Record<string, unknown>): ViewInput {
  if (Object.keys(raw).some((k) => !Object.hasOwn(viewSchema.properties, k)))
    throw new GitError("invalid_input");
  if (
    typeof raw.repo !== "string" ||
    !isAbsolute(raw.repo) ||
    raw.repo.length > 4096 ||
    raw.repo.includes("\0")
  )
    throw new GitError("invalid_path");
  const kind = raw.kind ?? "workspace",
    filter = raw.filter ?? "all",
    dots = raw.dots ?? "two";
  if (
    typeof kind !== "string" ||
    typeof filter !== "string" ||
    typeof dots !== "string" ||
    !["workspace", "refs"].includes(kind) ||
    !["all", "staged", "unstaged"].includes(filter) ||
    !["two", "three"].includes(dots)
  )
    throw new GitError("invalid_input");
  if (
    kind === "refs" &&
    (typeof raw.base !== "string" ||
      typeof raw.target !== "string" ||
      raw.filter !== undefined)
  )
    throw new GitError("invalid_input");
  if (
    kind === "workspace" &&
    [raw.base, raw.target, raw.dots].some((v) => v !== undefined)
  )
    throw new GitError("invalid_input");
  return { ...raw, kind, filter, dots } as ViewInput;
}
/** Pin historical endpoints once; never checkout, fetch, or write the real index. */
export async function resolveView(input: ViewInput, root?: string) {
  const repo = await allowedRepo(input.repo, root);
  const state: ChatState = {
    ...DEFAULT_CHAT_STATE,
    repo,
    mode: "uncommitted",
    filter: input.filter || "all",
  };
  if (input.kind === "workspace") return { repo, state };
  const baseSha = await sha(repo, input.base!),
    targetSha = await sha(repo, input.target!);
  const fromSha =
    input.dots === "three"
      ? await git(repo, ["merge-base", baseSha, targetSha])
          .then((s) => s.trim())
          .catch(() => {
            throw new GitError("no_merge_base");
          })
      : baseSha;
  Object.assign(state, {
    mode: "ref",
    ref: baseSha,
    toRef: targetSha,
    target: "head",
    dots: input.dots || "two",
  });
  return { repo, state, baseSha, targetSha, fromSha };
}
function numstat(raw: string): Counts {
  const out = { files: 0, added: 0, deleted: 0, binary: 0 };
  // Unmerged output can contain more than one record for one pathname.
  // Reuse the shared path-keyed parser, including -z rename handling.
  for (const file of parseNumstat(raw).values()) {
    out.files++;
    out.binary += Number(file.binary);
    out.added += file.added;
    out.deleted += file.deleted;
  }
  return out;
}
export async function inspectView(
  input: ViewInput,
  root?: string,
): Promise<ReviewCard> {
  const sampledAt = new Date().toISOString();
  const view = await resolveView(input, root);
  const { repo, state } = view;
  const branch = await git(repo, ["symbolic-ref", "--short", "-q", "HEAD"])
    .then((s) => s.trim())
    .catch(() => "");
  const stats = (args: string[]) =>
    git(repo, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "-M",
      ...args,
      "--numstat",
      "-z",
      "--",
    ]).then(numstat);
  if (input.kind === "refs") {
    const totals = await stats([view.fromSha!, view.targetSha!]);
    return {
      ...view,
      name: basename(repo),
      branch,
      sampledAt,
      finishedAt: new Date().toISOString(),
      kind: input.kind,
      base: input.base,
      target: input.target,
      dots: input.dots || "two",
      totals,
      stable: true,
      lineStats: "commits",
    };
  }
  const before = await fingerprintInfo(repo);
  const [staged, unstaged, combined] = await Promise.all([
    stats(["--cached"]),
    stats([]),
    comparison(repo, state as Mode, before.head).then((c) => stats(c.args)),
  ]);
  const status = (
    await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  ).split("\0");
  let changed = 0,
    untracked = 0,
    conflicts = 0;
  for (let i = 0; i < status.length; i++) {
    const s = status[i].slice(0, 2);
    if (!s) continue;
    changed++;
    if (s === "??") untracked++;
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(s)) conflicts++;
    if (s.includes("R") || s.includes("C")) i++;
  }
  const after = await fingerprintInfo(repo);
  return {
    repo,
    state: pickChatState(state),
    name: basename(repo),
    branch,
    sampledAt,
    finishedAt: new Date().toISOString(),
    kind: "workspace",
    staged,
    unstaged,
    untracked,
    conflicts,
    totals: {
      ...(input.filter === "staged"
        ? staged
        : input.filter === "unstaged"
          ? unstaged
          : combined),
      files:
        input.filter === "staged"
          ? staged.files
          : input.filter === "unstaged"
            ? unstaged.files + untracked
            : changed,
    },
    stable: before.hash === after.hash,
    lineStats: "tracked-only",
  };
}
