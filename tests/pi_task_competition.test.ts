import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionFacts, advanceExperiment, normalizeExperiment } from "../demo/pi_task_experiment.ts";
import { installTaskValidation } from "../demo/pi_task_validation.ts";
import { ensureTaskScope, stampTaskRecord } from "../demo/pi_task_scope.ts";
import { taskRecords, resolveTaskResource } from "../demo/pi_task_resource_store.ts";
import { updateTaskStrategyState, readTaskStrategyState, recordTaskStrategyAction } from "../demo/pi_task_strategy_state.ts";
import { buildCompetitionView, competitionProjection, competitionPayloadExposure, persistCompetitionView, recordCompetitionChoice } from "../demo/pi_task_competition.ts";
import { auditResearchConfidence } from "../demo/pi_research_confidence.ts";
import { buildResearchWorkset } from "../demo/pi_auto_research_protocol.ts";

const decision = (mode = "final", actions = 2) => ({ hypothesis_id: "hidden", hypothesis_version: 1,
	hypothesis: "silent clicks may accumulate marks", prediction: "visible change at the endpoint",
	validation_window: { test_id: "test-hidden-1", actions, mode, predicate: { field: "changed_cells", op: "gte", value: 1 } } });
const initial = (d: any) => ({ status: "open", samples: [], actions_used: 0, contract: normalizeExperiment(d, null) });
const rootFor = () => mkdtempSync(join(tmpdir(), "pi-competition-"));
const ledgerFor = (root: string) => installTaskValidation({ registerTool() {}, on() {} } as any, root);
function observation(root: string, id: string, cells: number, x = 12) {
	const record = stampTaskRecord(ensureTaskScope(root), { observation_id: id, version: 1, tool_name: "arc_action",
		input: { action: "ACTION6", x, y: 10 }, arc_outcome: { observation_delta: { changed_cells: cells, frame_available: true } }, is_error: false });
	appendFileSync(join(root, "execution-observations.jsonl"), JSON.stringify(record) + "\n");
	return `observation:${id}@v1`;
}

test("final versus any, unknown observations, resets and duplicate receipts", () => {
	let final = advanceExperiment(initial(decision()), "o1", { changed_cells: 3 });
	assert.equal(final.status, "open");
	final = advanceExperiment(final, "o2", { changed_cells: 0 });
	assert.equal(final.outcome, "not_met");
	assert.equal(advanceExperiment(final, "o3", { changed_cells: 8 }), final);
	assert.equal(advanceExperiment(initial(decision("any")), "o1", { changed_cells: 3 }).outcome, "met");
	assert.equal(advanceExperiment(initial(decision("each")), "o1", { changed_cells: 0 }).outcome, "not_met");
	let unknown = advanceExperiment(initial(decision("any")), "o1", {});
	unknown = advanceExperiment(unknown, "o2", { changed_cells: 0 });
	assert.equal(unknown.outcome, "unknown");
	assert.equal(advanceExperiment(initial(decision()), "reset", { reset: true }).outcome, "interrupted");
	let one = advanceExperiment(initial(decision()), "o1", { changed_cells: 0 });
	assert.equal(advanceExperiment(one, "o1", { changed_cells: 0 }), one);
	assert.equal(advanceExperiment(one, "failed", {}, true).actions_used, 1);
	assert.equal(actionFacts({ observation_delta: { changed_cells: 0 } }).changed_cells, 0);
	assert.equal(actionFacts({ observation_delta: { changed_cells: 0, frame_available: false } }).changed_cells, undefined);
});

test("expiry survives process restoration; only explicit plan dependencies reconcile", () => {
	const root = rootFor(), ledger = ledgerFor(root);
	updateTaskStrategyState(root, { source_ref: "checkpoint-fixture", candidate_updates: [{ id: "hidden", kind: "rule", status: "proposed", claim: "hidden marks" }],
		plan_update: { plan_id: "p", candidate_id: "hidden", status: "active", steps: ["test"], dependency_test_ids: ["test-hidden-1"] } });
	ledger.prepareDecision(decision());
	ledger.observeAction("o1", decision(), { action: "ACTION6" }, { observation_delta: { changed_cells: 0 } });
	const restored = ledgerFor(root);
	restored.prepareDecision(decision());
	restored.observeAction("o2", undefined, { action: "ACTION6" }, { observation_delta: { changed_cells: 0 } });
	assert.equal(taskRecords(root, "validation").at(-1)!.experiment.outcome, "not_met");
	assert.equal(readTaskStrategyState(root).plan.needs_reconciliation, true);
	const count = taskRecords(root, "validation").length;
	ledgerFor(root).prepareDecision(decision());
	assert.equal(taskRecords(root, "validation").length, count);
	assert.throws(() => restored.prepareDecision({ ...decision(), validation_window: { ...decision().validation_window, actions: 4 } }), /fixed contract/);
	assert.throws(() => restored.prepareDecision({ ...decision(), validation_window: { ...decision().validation_window, test_id: "new-id" } }), /retry_reason/);
	const textual = { ...decision(), hypothesis_id: "textual", validation_window: { test_id: "textual-test", actions: 1 } };
	restored.prepareDecision(textual);
	restored.observeAction("o3", textual, { action: "ACTION6" }, {});
	assert.equal(taskRecords(root, "validation").at(-1)!.experiment.outcome, "needs_assessment");
});

test("actual serialized request retains comparisons; restricted child cannot inherit ungranted evidence", () => {
	const root = rootFor();
	const zero = observation(root, "zero", 0), changed = observation(root, "contrast", 4, 32);
	updateTaskStrategyState(root, { source_ref: "checkpoint-fixture", candidate_updates: [
		{ id: "hidden", kind: "rule", status: "challenged", question_id: "editability", claim: "center accumulates invisible marks",
			prediction: "five clicks will change center", evidence_refs: [zero], counter_refs: [changed], untested: "terminal sequence",
			options: [{ action: "finite center sequence", cost: "5 actions", branches: "visible change: inspect; no change: stop extending" }] },
		{ id: "region", kind: "rule", status: "proposed", question_id: "editability", claim: "only another region is editable",
			prediction: "contrast region changes", support_refs: [changed], next_test: "sample a different region" },
	], selected_candidate_id: "hidden" });
	const view = buildCompetitionView(root)!;
	persistCompetitionView(root, view);
	const projection = competitionProjection(view);
	assert.equal(projection.candidates.length, 2);
	assert.equal(projection.facts.find((f: any) => f.ref === zero).changed_cells, 0);
	assert.ok(projection.candidates[0].counter_refs.includes(changed));
	assert.match(projection.candidates[0].options[0].branches, /stop extending/);
	const workset = buildResearchWorkset({ goal: "compare", competition_view: projection }, 12000);
	const effective = competitionPayloadExposure({ messages: [{ content: `@file workset ${JSON.stringify(workset)}` }] }, root);
	assert.equal(effective.length, 1);
	assert.equal(effective[0].comparison_status, "effective_projection_matches_canonical_view");
	assert.equal(effective[0].candidate_refs.length, 2);
	assert.ok(effective[0].fact_refs.includes(changed));
	const candidate = projection.candidates[0].ref;
	const child = buildCompetitionView(root, new Set([candidate, zero]))!;
	assert.equal(child.candidates.length, 1);
	assert.equal(child.facts.some((f: any) => f.ref === changed), false);
	assert.ok(child.coverage.withheld_evidence_count > 0);
	assert.throws(() => buildResearchWorkset({ goal: "compare", competition_view: projection }, 256), /exceed/);
	recordCompetitionChoice(root, { selection: {} }, zero);
	assert.equal(buildCompetitionView(root)!.last_choice.status, "decision_unassessed");
	assert.equal(resolveTaskResource(root, candidate).claim, view.candidates[0].claim);
});

test("action-labelled evidence cannot demand selection from an empty candidate pool", () => {
	const root = rootFor(), ref = observation(root, "stage114-style", 2);
	const labelled = { hypothesis_id: "navigation", hypothesis: "this direction moves the shape", prediction: "shape moves", selection: {
		candidate_id: "navigation", candidate_version: 1, rationale: "test the direction" } };
	ledgerFor(root).observeAction("stage114-style", labelled, { action: "ACTION3" }, { observation_delta: { changed_cells: 2 } });
	const view = buildCompetitionView(root)!;
	assert.equal(view.candidates.length, 0);
	assert.equal(view.unstructured_claims[0].hypothesis, labelled.hypothesis);
	assert.equal(view.decision_needed, undefined);
	assert.equal(view.decision_review, undefined);
	persistCompetitionView(root, view);
	assert.equal(recordCompetitionChoice(root, labelled, ref), undefined);
	assert.equal(recordCompetitionChoice(root, undefined, ref), undefined);
	assert.equal(taskRecords(root, "competition_view").filter(r => r.record_kind === "choice").length, 0);
	const projection = competitionProjection(buildCompetitionView(root)!);
	assert.equal(projection.decision_needed, undefined);
	assert.equal(projection.decision_review, undefined);
	assert.equal(projection.competition_gap, undefined);
	assert.equal(projection.unstructured_claims[0].prediction, labelled.prediction);
	assert.equal(projection.facts.find((f: any) => f.ref === ref).changed_cells, 2);
	assert.equal(resolveTaskResource(root, `validation:${view.unstructured_claims[0].ref.split(":")[1]}`).hypothesis, labelled.hypothesis);
});

test("omitting optional selection does not fabricate a failed review for real candidates", () => {
	const root = rootFor(), ref = observation(root, "decision", 2);
	updateTaskStrategyState(root, { source_ref: "checkpoint", candidate_updates: [{ id: "route", kind: "strategy", status: "proposed", claim: "test a route" }] });
	persistCompetitionView(root, buildCompetitionView(root)!);
	assert.equal(recordCompetitionChoice(root, undefined, ref), undefined);
	assert.equal(taskRecords(root, "competition_view").filter(r => r.record_kind === "choice").length, 0);
	assert.equal(recordCompetitionChoice(root, { selection: {} }, ref)!.status, "decision_unassessed");
});

test("explicit choices retain evidence/version checks and survive ordinary continuation", () => {
	const root = rootFor(), ref = observation(root, "choice-evidence", 2);
	updateTaskStrategyState(root, { source_ref: "checkpoint", candidate_updates: [{ id: "route", kind: "strategy", status: "proposed",
		claim: "test a route", support_refs: [ref] }], selected_candidate_id: "route" });
	const view = buildCompetitionView(root)!;
	persistCompetitionView(root, view);
	const selection = { view_ref: view.view_ref, candidate_id: "route", candidate_version: 1, evidence_refs: [ref],
		rationale: "the returned displacement supports this test", branches: "changed: continue; blocked: reassess",
		disposition: "test", next_check: "observe displacement", addressed_trigger_refs: [] };
	assert.equal(recordCompetitionChoice(root, { selection }, ref)!.status, "recorded_agent_choice_not_semantically_verified");
	const next = buildCompetitionView(root)!;
	persistCompetitionView(root, next);
	assert.equal(recordCompetitionChoice(root, undefined, "observation:ordinary@v1"), undefined);
	assert.equal(buildCompetitionView(root)!.last_choice.choice.candidate_id, "route");
	assert.equal(taskRecords(root, "competition_view").filter(r => r.record_kind === "choice").length, 1);
	updateTaskStrategyState(root, { source_ref: "checkpoint", candidate_updates: [{ id: "route", kind: "strategy", status: "proposed", claim: "revise the route" }] });
	assert.equal(recordCompetitionChoice(root, { selection }, "observation:stale@v1")!.status, "decision_unassessed");
	assert.equal(recordCompetitionChoice(root, { selection: { ...selection, evidence_refs: ["observation:ungranted@v1"] } },
		"observation:bad-evidence@v1")!.status, "decision_unassessed");
});

test("a retelling cannot increase confidence; invalid confidence preserves findings", () => {
	const root = rootFor(), old = observation(root, "old", 0);
	updateTaskStrategyState(root, { source_ref: "checkpoint-fixture", candidate_updates: [{ id: "h", kind: "rule", status: "proposed", claim: "hidden" }] });
	const report = { findings: [{ summary: "useful contrast" }], confidence_update: { disposition: "increase", basis: "new_environment_evidence",
		target_ref: "strategy_candidate:h@v1", evidence_refs: [old] } };
	const rejected = auditResearchConfidence(root, report);
	assert.equal(rejected.confidence_update, undefined);
	assert.deepEqual(rejected.findings, report.findings);
	const fresh = observation(root, "fresh", 5);
	assert.equal(auditResearchConfidence(root, { ...report, confidence_update: { ...report.confidence_update, evidence_refs: [fresh] } })
		.confidence_update.provenance_status, "checked");
});

test("a delayed child suggestion cannot overwrite the parent's selected candidate", () => {
	const root = rootFor();
	updateTaskStrategyState(root, { source_ref: "checkpoint", candidate_updates: [{ id: "h", kind: "rule", status: "proposed", claim: "parent route" }], selected_candidate_id: "h" });
	updateTaskStrategyState(root, { source_ref: "repeated-checkpoint", candidate_updates: [{ id: "h", kind: "rule", status: "proposed", claim: "parent route" }] });
	assert.equal(readTaskStrategyState(root).candidates[0].version, 1);
	assert.equal(taskRecords(root, "strategy_candidate").length, 1);
	const state = updateTaskStrategyState(root, { source_ref: "research_report:late@v1", candidate_updates: [{ id: "h", kind: "rule", status: "proposed", claim: "child alternative" }] });
	assert.equal(state.candidates.find((c: any) => c.id === "h").claim, "parent route");
	assert.equal(state.selected_candidate_id, "h");
	assert.equal(state.candidates.find((c: any) => c.related_candidate_id === "h").claim, "child alternative");
	assert.throws(() => updateTaskStrategyState(root, { source_ref: "research_report:another@v1", selected_candidate_id: null }), /cannot select/);
});

test("missing plan observations request assessment rather than claiming a mismatch", () => {
	const root = rootFor();
	updateTaskStrategyState(root, { source_ref: "checkpoint", candidate_updates: [{ id: "h", kind: "rule", status: "proposed", claim: "parent route" }],
		plan_update: { plan_id: "p", candidate_id: "h", status: "active", steps: [{ action: "ACTION6", expected: { target_after: 4 } }] } });
	const state = recordTaskStrategyAction(root, { plan_id: "p", plan_step: 0 }, "unknown", { action: "ACTION6" }, {})!;
	assert.equal(state.plan.last_step_outcome.status, "unassessed");
	assert.deepEqual(state.plan.last_step_outcome.unknown_fields, ["target_after"]);
	assert.equal(state.plan.needs_assessment, true);
	assert.equal(state.plan.needs_reconciliation, false);
});
