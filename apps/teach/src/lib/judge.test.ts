// Unit tests for the modular AI judge (spec §10b). These verify the judge's
// output parsing and graceful-failure behavior WITHOUT a live LLM — the summon
// is stubbed. The derivation that follows (verdict→grade) is covered in
// review.test.ts.
// Run with: pnpm test
import { expect, test } from "vitest";
import { createSummonJudge, parseJudgeOutput } from "./judge.ts";

const assert = {
  deepEqual(actual: unknown, expected: unknown) {
    expect(actual).toEqual(expected);
  },
  equal(actual: unknown, expected: unknown) {
    expect(actual).toBe(expected);
  },
};

test("parseJudgeOutput reads the structured submit_output payload", () => {
  const r = parseJudgeOutput({ output: { verdict: "correct", feedback: "Nailed it." } });
  assert.deepEqual(r, { verdict: "correct", feedback: "Nailed it." });
});

test("parseJudgeOutput extracts a JSON blob from prose result", () => {
  const r = parseJudgeOutput({
    result: 'Here is my call: {"verdict":"partial","feedback":"Close."} done',
  });
  assert.deepEqual(r, { verdict: "partial", feedback: "Close." });
});

test("parseJudgeOutput falls back to a bare verdict word", () => {
  const r = parseJudgeOutput({ result: "That answer is wrong, unfortunately." });
  assert.equal(r?.verdict, "wrong");
});

test("parseJudgeOutput returns null when nothing usable is present", () => {
  assert.equal(parseJudgeOutput({ result: "hmm" }), null);
  assert.equal(parseJudgeOutput(null), null);
  assert.equal(parseJudgeOutput({ output: { verdict: "maybe" } }), null);
});

test("createSummonJudge returns the parsed verdict on success", async () => {
  const judge = createSummonJudge(async () => ({
    status: "ok",
    data: { output: { verdict: "correct", feedback: "Great." } },
  }));
  const r = await judge({ question: "q", expected: "a", answer: "a" });
  assert.deepEqual(r, { verdict: "correct", feedback: "Great." });
});

test("createSummonJudge degrades to 'partial' when summon errors", async () => {
  const judge = createSummonJudge(async () => ({ status: "error", error: "boom" }));
  const r = await judge({ question: "q", expected: "a", answer: "a" });
  assert.equal(r.verdict, "partial");
});

test("createSummonJudge degrades to 'partial' when the judge throws", async () => {
  const judge = createSummonJudge(async () => {
    throw new Error("network down");
  });
  const r = await judge({ question: "q", expected: "a", answer: "a" });
  assert.equal(r.verdict, "partial");
});

test("createSummonJudge degrades to 'partial' on unparseable output", async () => {
  const judge = createSummonJudge(async () => ({ status: "ok", data: { result: "???" } }));
  const r = await judge({ question: "q", expected: "a", answer: "a" });
  assert.equal(r.verdict, "partial");
});
