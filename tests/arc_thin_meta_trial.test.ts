import assert from "node:assert/strict";
import test from "node:test";
import { compareMountExpectations, metaDecisionVersionError, metaTrialFacts, parseComponentExpect, parseMetaReviewLines,
  stripMetaReviewControlLines } from "../demo/arc_thin_meta_trial.ts";

test("review EXPECT and DECISION lines parse while surrounding prose stays free-form", () => {
  assert.deepEqual(parseMetaReviewLines(`# Notes\nEXPECT within 3 actions: fewer repeated moves\nDECISION: revise — guard is too broad`), {
    expect: { within: 3, claim: "fewer repeated moves" },
    decision: { choice: "revise", reason: "guard is too broad" },
  });
  assert.deepEqual(parseMetaReviewLines("No workflow change is justified.\nDECISION: no_change — current approach works"), {
    decision: { choice: "no_change", reason: "current approach works" },
  });
  assert.deepEqual(parseMetaReviewLines("- EXPECT within 2 actions: fewer repeats\n- DECISION: keep — still useful"), {
    expect: { within: 2, claim: "fewer repeats" }, decision: { choice: "keep", reason: "still useful" },
  });
  assert.deepEqual(parseMetaReviewLines("EXPECT within 0 actions: impossible\nDECISION: maybe"), {});
  assert.deepEqual(parseComponentExpect("# mount: decision\n# EXPECT within 3 actions: fewer misses\ndef on_event(state, event):\n    return 1"),
    { within: 3, claim: "fewer misses" });
  assert.equal(parseComponentExpect(`${"\n".repeat(10)}# EXPECT within 2 actions: too late`), undefined);
});

test("trial protocol lines are not repeated as resident gameplay instructions", () => {
  assert.equal(stripMetaReviewControlLines("Keep the route note.\n- EXPECT within 3 actions: fewer repeats\nDECISION: keep — enough evidence"),
    "Keep the route note.");
});

test("trial facts count only its action interval and saved level", () => {
  assert.deepEqual(metaTrialFacts({ start: 4, end: 8, level: 1,
    actions: [
      { n: 4, level: 1 },
      { n: 5, level: 1, after_guard_refusal: { changed: true } },
      { n: 6, level: 1, after_guard_refusal: { changed: false } },
      { n: 7, level: 2, after_guard_refusal: { changed: true } },
      { n: 9, level: 1 },
    ],
    guards: [
      { n: 5, level: 1, sent: false },
      { n: 6, level: 1, sent: true },
      { n: 7, level: 2, sent: false },
    ],
  }), { actions: 2, componentCalls: 0, componentErrors: 0, componentViews: 0, viewErrors: 0, promptDecisions: 0, predictorChecks: 0,
    predictionErrors: 0, predictionHits: 0, predictionMisses: 0, guardChecks: 2, guardRefusals: 1, actionChangesAfterRefusal: 1,
    mountDecisionRuns: 0, mountActionChecks: 0, mountRefusals: 0, mountErrors: 0,
    mountFeedbackRuns: 0, mountPredictionHits: 0, mountPredictionMisses: 0 });
});

test("real observation fields are compared independently of the component's own claim", () => {
  assert.deepEqual(compareMountExpectations([
    { path: "grid.0.1", equals: 4 }, { path: "state", equals: "DONE" }, { path: "grid.1.0", equals: 9 },
    { path: "detail", equals: { b: 2, a: 1 } },
  ], { grid: [[3, 4]], state: "PLAYING", detail: { a: 1, b: 2 } }), [
    { path: "grid.0.1", expected: 4, actual: 4, hit: true },
    { path: "state", expected: "DONE", actual: "PLAYING", hit: false },
    { path: "grid.1.0", expected: 9, missing: true, hit: false },
    { path: "detail", expected: { b: 2, a: 1 }, actual: { a: 1, b: 2 }, hit: true },
  ]);
});

test("a trial decision must agree with the candidate's saved version", () => {
  const paths = ["tools/process.py"], candidate = { "tools/process.py": 1 };
  assert.match(metaDecisionVersionError(paths, candidate, candidate, "remove") ?? "", /does not match/);
  assert.equal(metaDecisionVersionError(paths, candidate, {}, "remove"), undefined);
  assert.equal(metaDecisionVersionError(paths, candidate, { "tools/process.py": 2 }, "revise"), undefined);
  assert.match(metaDecisionVersionError(paths, candidate, candidate, "revise") ?? "", /does not match/);
  assert.equal(metaDecisionVersionError(paths, candidate, candidate, "keep"), undefined);
});
