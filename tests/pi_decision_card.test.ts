import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as strategy from "../demo/pi_task_strategy_state.ts";
test("semantic candidate fields remain exact and knowledge kinds do not imply goal knowledge", () => {
    const claim = "critical applicability ".repeat(90) + "TAIL_COUNTEREXAMPLE";
    const candidate = strategy.normalizeCandidateUpdates([{ id: "op", kind: "rule", status: "proposed",
        knowledge_kind: "operation_effect", claim, scope: claim, options: [{ action: "Inspect", branches: claim }],
        counterevidence: [{ fact: "Goal still unknown", source_ref: "ref" }] }])[0];
    assert.equal(candidate.claim, claim);
    assert.equal(candidate.knowledge_kind, "operation_effect");
    assert.equal(candidate.counterevidence[0].fact, "Goal still unknown");
    assert.equal(candidate.options[0].branches, claim);
});

test("malformed decision shape and unknown refs reject before writes", async () => {
    const m = await import("../demo/pi_decision_state.ts");
    for (const value of [null, [], { counterevidence: {} }, { knowledge_gaps: [42] },
        { next_decision: 42 }, { runtime_fact: true }])
        assert.throws(() => m.validateDecisionState(value, () => {}));
    assert.throws(() => m.validateDecisionState({ counterevidence: [{ fact: "Counterexample", evidence_refs: ["memory:x@v1"] }] },
        () => { throw new Error("unknown exact resource"); }), /unknown exact/);
    const root = mkdtempSync(join(tmpdir(), "invalid-strategy-"));
    assert.throws(() => strategy.updateTaskStrategyState(root, { source_ref: "checkpoint:test@v1",
        candidate_updates: [{ id: "x", kind: "rule", status: "proposed", claim: "Unknown",
            counterevidence: [{ fact: "Not checked", source_ref: "memory:missing@v1" }] }] }), /not found|Unknown|unknown/);
    const fs = await import("node:fs");
    assert.equal(fs.existsSync(join(root, "task-strategy-state.json")), false);
    assert.equal(fs.existsSync(join(root, "task-strategy-candidates.jsonl")), false);
});

test("decision projection bounds inactive alternatives with exact recovery refs", async () => {
    const { decisionCardV2 } = await import("../demo/pi_decision_card.ts");
    const candidates = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, version: 2, status: "proposed", claim: `candidate ${i}` }));
    candidates[0].status = "challenged";
    const card = decisionCardV2({}, { candidates, selected_candidate_id: "c1" }, "checkpoint:checkpoint@v1");
    assert.equal(card.active_claims.length, 5);
    assert.equal(card.omitted_claim_count, 35);
    assert.equal(card.omitted_claim_refs[0], "strategy_candidate:c2@v2");
});

test("parent competition removes only matching candidate versions from the decision card", async () => {
    const { decisionCardV2 } = await import("../demo/pi_decision_card.ts");
    const state = { candidates: [
        { id: "shared", version: 2, status: "challenged", claim: "Rule", knowledge_kind: "operation_effect",
            counterevidence: [{ fact: "Failed", source_ref: "observation:x@v1" }] },
        { id: "new-version", version: 3, status: "proposed", claim: "Fresh claim" },
        { id: "not-in-view", version: 1, status: "proposed", claim: "Other claim" },
    ] };
    const competition = { audience: "parent", view_ref: "competition_view:current@v1", candidates: [
        { id: "shared", version: 2, status: "challenged", claim: "Rule" }, { id: "new-version", version: 2 },
    ] };
    const card = decisionCardV2({}, state, "checkpoint:checkpoint@v1", [], undefined, undefined, [], competition);
    assert.equal(card.competition_view_ref, competition.view_ref);
    assert.equal(card.active_claims[0].claim, undefined);
    assert.equal(card.active_claims[0].knowledge_kind, "operation_effect");
    assert.deepEqual(card.active_claims[0].counterevidence, state.candidates[0].counterevidence);
    assert.equal(card.active_claims[0].ref, "strategy_candidate:shared@v2");
    assert.equal(card.active_claims[1].claim, "Fresh claim");
    assert.equal(card.active_claims[2].claim, "Other claim");
    const truncated = decisionCardV2({}, state, "checkpoint:checkpoint@v1", [], undefined, undefined, [],
        { ...competition, candidates: [{ id: "shared", version: 2, claim: "R… [abridged; read view_ref]" }] });
    assert.equal(truncated.active_claims[0].claim, "Rule");
    assert.equal(decisionCardV2({}, state, "checkpoint:checkpoint@v1").active_claims.length, 3);
    assert.equal(decisionCardV2({}, state, "checkpoint:checkpoint@v1", [], undefined, undefined, [],
        { ...competition, audience: "restricted" }).active_claims.length, 3);
});

test("partial decision updates retain unresolved knowledge and only explicit clears remove it", async () => {
    const { patchDecisionState } = await import("../demo/pi_decision_state.ts");
    const previous = { knowledge_gaps: [{ kind: "goal_rule", question: "Unknown goal" }],
        counterevidence: [{ fact: "Counterexample", source_ref: "memory:proof@v1" }] };
    const next = patchDecisionState(previous, { next_decision: "Inspect the new observation" }, ref => {
        assert.equal(ref, "memory:proof@v1");
    });
    assert.deepEqual(next.knowledge_gaps, previous.knowledge_gaps);
    assert.deepEqual(next.counterevidence, previous.counterevidence);
    assert.equal(next.next_decision, "Inspect the new observation");
    assert.deepEqual(patchDecisionState(next, { counterevidence: [] }, () => {}).counterevidence, []);
    assert.deepEqual(previous.counterevidence, [{ fact: "Counterexample", source_ref: "memory:proof@v1" }]);
});

test("stale planning-gap text is not promoted into a current unresolved question", async () => {
    const { decisionCardV2 } = await import("../demo/pi_decision_card.ts");
    const card = decisionCardV2({ planning_gap: "An old level-specific question",
        reasoning_state: { stale_fields: ["planning_gap"] } }, {}, "checkpoint:checkpoint@v1");
    assert.deepEqual(card.knowledge_gaps, []);
    assert.equal(card.planning_gap, undefined);
    assert.deepEqual(card.reasoning_state_update.stale_fields, ["planning_gap"]);
});
test("decision card retains goal gap and counterexample despite an active plan", async () => {
    const module = await import("../demo/pi_decision_card.ts");
    const checkpoint = { revision: 4, task_goal: "Goal ".repeat(100), hypothesis: "Counterexample ".repeat(100),
        working_summary: "Conditions ".repeat(100), decision_state: { knowledge_gaps: [{ kind: "goal_rule", question: "Unknown success rule" }] } };
    const state = { plan: { status: "active", steps: ["next"], current_step: 0, preconditions: ["all conditions"],
        stop_if: ["new counterexample"] }, candidates: [{ id: "op", kind: "rule", status: "supported",
        knowledge_kind: "operation_effect", evidence_refs: [], claim: "Switch changes a tile" }] };
    const card = module.decisionCardV2(checkpoint, state, "checkpoint:checkpoint@v5", [], { no_progress_bucket: 2, last_advance: null });
    assert.equal(card.task_goal, checkpoint.task_goal);
    assert.equal(card.hypothesis, checkpoint.hypothesis);
    assert.equal(card.knowledge_gaps[0].kind, "goal_rule");
    assert.equal(card.active_claims[0].epistemic_status, "agent_assessment");
    assert.deepEqual(card.plan.preconditions, ["all conditions"]);
    assert.equal(card.public_progress.no_progress_bucket, 2);
});

test("action knowledge is projected once while its capsule retains the prediction", async () => {
    const { decisionCardV2 } = await import("../demo/pi_decision_card.ts");
    const knowledge = { known_effects: ["UNIQUE_EFFECT"], counterevidence: ["UNIQUE_COUNTEREXAMPLE"] };
    const checkpoint = { decision_state: knowledge, decision_capsule: {
        knowledge, prediction: "Test this prediction", falsifier: "Unexpected outcome" } };
    const card = decisionCardV2(checkpoint, {}, "checkpoint:checkpoint@v1");
    assert.equal(card.known_effects[0], "UNIQUE_EFFECT");
    assert.equal(card.counterevidence[0], "UNIQUE_COUNTEREXAMPLE");
    assert.deepEqual(card.decision_capsule, { prediction: "Test this prediction", falsifier: "Unexpected outcome" });
    assert.equal(JSON.stringify(card).split("UNIQUE_COUNTEREXAMPLE").length, 2);
    assert.equal(checkpoint.decision_capsule.knowledge, knowledge);
});
