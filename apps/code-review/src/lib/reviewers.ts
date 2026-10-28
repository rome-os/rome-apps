import { readFileSync } from "node:fs";

// Definitions ship with the skill; the DB stores only per-repo opt-ins.
export const BUILT_IN_REVIEWERS = [
  { id: "design-alternatives", name: "Design & Alternatives",
    description: "Checks the approach against feasible alternatives in this repo; skips trivial changes.",
    reference: "design-alternatives.md" },
  { id: "security", name: "Security",
    description: "Reports only exploitable vulnerabilities with concrete attack paths.",
    reference: "security-reviewer.md" },
].map((reviewer) => ({ ...reviewer, instructions: readFileSync(
  new URL(`../skills/code-review-expert/references/${reviewer.reference}`, import.meta.url), "utf8",
) }));
