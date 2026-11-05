import test from "node:test";
import assert from "node:assert/strict";
import { compileContext, emptySessionState, evidenceRef, hydrateEvidence, observeBudget, observeUsage, parseSessionState, resultEnvelope } from "../demo/pi_adapt_context.ts";

test("result envelope keeps a neutral code, compact summary, evidence pointer and paging entry", () => {
  const pointer = evidenceRef("results/r000001.txt", "full output");
  const envelope = resultEnvelope({ code: "error", summary: "tool failed", evidence: pointer, next: "hydrate offset=0" });
  assert.deepEqual(envelope, { code: "error", summary: "tool failed", keyFields: {}, evidence: pointer, next: "hydrate offset=0" });
});

test("hydrate verifies immutable version and returns only the requested slice", () => {
  const body = "0123456789";
  const pointer = evidenceRef("results/r000001.txt", body);
  const read = (ref: string) => ref === "results/r000001.txt" ? body : undefined;
  assert.deepEqual(hydrateEvidence(pointer, read, 3, 4), {
    ok: true, ref: pointer.ref, version: pointer.version, digest: pointer.digest, offset: 3, end: 7, chars: 10,
    text: "3456", nextOffset: 7,
  });
  assert.equal(hydrateEvidence({ ...pointer, version: "stale" }, read).error, "version_mismatch");
  assert.equal(hydrateEvidence(pointer, () => undefined).error, "missing_or_expired");
  assert.equal(hydrateEvidence(pointer, () => "changed").error, "digest_mismatch");
});

test("compiled context carries goal, failure path and artifact pointer while budget exposes soft and hard signals", () => {
  const state = emptySessionState();
  state.revision = 4;
  state.goal = "complete the requested task";
  state.constraints.push({ text: "preserve versioned evidence" });
  state.decisions.push({ status: "open", choice: "inspect the source", rationale: "failure is unexplained" });
  state.claims.push({ kind: "hypothesis", statement: "the result may be truncated", status: "proposed" });
  state.failures.push({ summary: "attempt failed", preconditions: "tool unavailable", retryWhen: "tool restored" });
  state.artifacts.push({ name: "report", version: "v2", role: "evidence", ref: evidenceRef("results/r1.txt", "x") });
  const view = compileContext(state);
  assert.equal(view.stateRevision, 4);
  assert.equal(view.goal, state.goal);
  assert.equal(view.constraints[0].text, "preserve versioned evidence");
  assert.equal(view.decisions[0].status, "open");
  assert.equal(view.claims[0].status, "proposed");
  assert.equal(view.failures[0].preconditions, "tool unavailable");
  assert.equal(view.artifacts[0].ref?.version, state.artifacts[0].ref?.version);
  let budget = observeBudget({ inputChars: 0, outputChars: 0, hydrateChars: 0, compactionChars: 0, softLimitChars: 5, hardLimitChars: 10 },
    { kind: "input", chars: 6 });
  assert.match(budget.signal ?? "", /high-water/);
  budget = observeBudget(budget, { kind: "hydrate", chars: 5 });
  assert.match(budget.stop ?? "", /hard context budget/);
  assert.equal(budget.hydrateChars, 5);
  budget = observeUsage(budget, "compaction", { input: 11, output: 3, cacheRead: 5, cost: 0.02, durationMs: 100 });
  assert.equal(budget.inputTokens, 11);
  assert.equal(budget.outputTokens, 3);
  assert.equal(budget.cacheInputTokens, 5);
  assert.equal(budget.compactionTokens, 14);
  assert.equal(budget.cost, 0.02);
  assert.equal(budget.latencyMs, 100);
});

test("persisted state is checked once at the storage boundary", () => {
  const state = emptySessionState();
  assert.deepEqual(parseSessionState(JSON.stringify(state)), state);
  assert.throws(() => parseSessionState(JSON.stringify({ ...state, budget: { inputChars: "large" } })), /invalid persisted/);
});
