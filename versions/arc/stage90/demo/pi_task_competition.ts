/** Evidence-bearing projection of existing candidates, experiments and choices. No semantic ranking. */
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { resolveTaskResource, taskRecords } from "./pi_task_resource_store.ts";
import { readTaskStrategyState, materializeStrategyCandidates } from "./pi_task_strategy_state.ts";
import { actionFacts } from "./pi_task_experiment.ts";
type Row = Record<string, any>;
const refs = (v: any): string[] => Array.isArray(v) ? [...new Set(v.map(String))] : [];
const candidateRef = (c: Row) => `strategy_candidate:${c.id}@v${c.version ?? 1}`;

/** Derive the next decision obligation from existing records; never choose an explanation. */
function decisionReview(view: Row, plan: Row | null, observations: Row[], validations: Row[]): Row {
	const triggers: Row[] = [];
	const add = (reason: string, ref: string | undefined) => {
		if (ref && !triggers.some(t => t.reason === reason && t.ref === ref)) triggers.push({ reason, ref });
	};
	const choice = view.last_choice?.choice;
	const priorView = view.previous_comparison;
	const selected = view.candidates.find((c: Row) => c.id === view.selected?.id);
	if (selected) {
		if (selected.status === "challenged" || selected.status === "rejected") add("selected_candidate_challenged", selected.ref);
		for (const ref of selected.counter_refs.slice(-1)) add("selected_candidate_counterevidence", ref);
		if (priorView && priorView.selected?.id === selected.id && priorView.selected.version !== selected.version)
			add("selected_candidate_revised", selected.ref);
	}
	for (const candidate of view.candidates) if (candidate.id !== view.selected?.id
		&& !priorView?.candidates?.some((old: Row) => old.ref === candidate.ref)) add("alternative_available_or_revised", candidate.ref);
	for (const r of validations) if (r.experiment?.status === "completed" && r.status === "needs_assessment"
		&& r.experiment.outcome !== "met") add(`experiment_${r.experiment.outcome}`, `validation:${r.validation_id}@v${r.version}`);
	if (plan?.status === "active" && (plan.needs_reconciliation || plan.needs_assessment)) {
		const ref = plan.experiment_outcome_ref ?? plan.last_step_outcome?.observation_ref ?? plan.last_action_ref;
		add(plan.needs_reconciliation ? "plan_requires_reconciliation" : "plan_requires_assessment",
			ref?.startsWith("execution-observation-") ? `observation:${ref}@v1` : ref ?? selected?.ref);
	}
	// A missing delta is not a no-op. RESET and transitions break this local contrast.
	const recent = observations.filter(r => !r.is_error).slice(-2);
	if (recent.length === 2 && recent.every(r => {
		const f = actionFacts(r.arc_outcome ?? {}, r.input ?? {});
		return f.changed_cells === 0 && !f.reset && !f.level_changed
			&& view.selected && r.input?.decision?.hypothesis_id === view.selected.id;
	})) add("consecutive_frame_silent_actions", `observation:${recent.at(-1)!.observation_id}@v${recent.at(-1)!.version ?? 1}`);
	const acknowledged = view.last_choice?.status === "recorded_agent_choice_not_semantically_verified"
		? new Set(refs(view.last_choice.acknowledged_trigger_refs ?? choice?.addressed_trigger_refs)) : new Set<string>();
	const pending = triggers.filter(t => !acknowledged.has(t.ref));
	const unresolvedPlan = plan?.status === "active" && (plan.needs_reconciliation || plan.needs_assessment);
	const state = pending.length ? "reconsideration_pending" : unresolvedPlan ? "plan_update_pending"
		: !choice || view.last_choice?.status === "decision_unassessed" ? "choice_pending" : "monitoring";
	return { state, triggers: pending, acknowledged_trigger_count: triggers.length - pending.length,
		plan: plan ? { plan_id: plan.plan_id, candidate_id: plan.candidate_id, status: plan.status,
			current_step: plan.current_step, needs_assessment: Boolean(plan.needs_assessment),
			needs_reconciliation: Boolean(plan.needs_reconciliation) } : null,
		next_check: choice?.next_check ?? null,
		task: state === "monitoring" ? "Execute the chosen branch; compare its next observable result. Reassess when evidence or assumptions change."
			: "Assess the current stage: do facts challenge the goal/rule, execution plan, or method? Compare live alternatives and action value; choose continue, revise, switch, test, or uncertain. Cite trigger refs, explain continuing despite conflicts, and name the next observable check. Update the candidate/plan when changing it, then act or request a bounded research deliverable. No full retrospective required." };
}

export function buildCompetitionView(root: string, grants?: Set<string>): Row | undefined {
	materializeStrategyCandidates(root);
	const state = readTaskStrategyState(root);
	const allowed = (ref: string) => !grants || grants.has(ref) || grants.has(`${ref.split(":")[0]}:*`);
	const grantedCandidates = new Map<string, Row>();
	if (grants) for (const ref of grants) if (ref.startsWith("strategy_candidate:") && !ref.endsWith(":*")) {
		const record = resolveTaskResource(root, ref);
		const id = record.id ?? record.candidate_id;
		if (!grantedCandidates.has(id) || grantedCandidates.get(id)!.version < record.version) grantedCandidates.set(id, { ...record, id });
	}
	const all: Row[] = grants && !grants.has("strategy_candidate:*") ? [...grantedCandidates.values()] : state.candidates ?? [];
	const validations = new Map<string, Row>();
	for (const r of taskRecords(root, "validation")) if (allowed(`validation:${r.validation_id}@v${r.version}`)) validations.set(r.validation_id, r);
	const selected = all.find(c => c.id === state.selected_candidate_id);
	const question = selected?.question_id;
	const relevant = all.filter(c => c.id !== selected?.id && c.status !== "rejected" && (!question || !c.question_id || c.question_id === question));
	// Explicitly challenged explanations precede merely recent additions; selected route is always retained.
	const challengers = relevant.sort((a, b) => Number(Boolean(b.counter_refs?.length || b.status === "challenged"))
		- Number(Boolean(a.counter_refs?.length || a.status === "challenged")) || String(b.updated_at).localeCompare(String(a.updated_at)));
	const candidates = [...(selected ? [selected] : []), ...challengers].slice(0, 3);
	const experiments = [...validations.values()].filter(r => r.experiment
		&& (!question || r.experiment.contract.question_id === question || candidates.some(c => c.id === r.source_hypothesis_id)));
	const open = experiments.filter(r => r.experiment.status === "open");
	const completed = experiments.filter(r => r.experiment.status !== "open");
	const priorityTests = experiments.filter(r => r.source_hypothesis_id === selected?.id
		&& (r.experiment.status === "open" || (r.status === "needs_assessment" && r.experiment.outcome !== "met"))).slice(-2);
	const activeExperiments = [...new Set([...priorityTests, ...open.slice(-1), ...completed.slice(-1)])];
	const unstructured = [...validations.values()].filter(r => !r.experiment
		&& ["open", "disputed"].includes(r.status)).slice(-2);
	if (!candidates.length && !activeExperiments.length && !unstructured.length) return;
	const observationRefs = new Set<string>();
	const addRefs = (v: any) => { for (const ref of refs(v)) if (ref.startsWith("observation:") && allowed(ref)) observationRefs.add(ref); };
	for (const c of candidates) { addRefs(c.support_refs); addRefs(c.counter_refs); addRefs(c.evidence_refs); }
	for (const r of unstructured) { addRefs(r.evidence_refs); for (const d of r.disputes ?? []) addRefs(d.evidence_refs); }
	for (const r of activeExperiments) {
		const samples = r.experiment.samples;
		addRefs(samples.length ? [samples[0].ref, samples.at(-1).ref,
			...samples.filter((s: Row) => s.matched === false).slice(-1).map((s: Row) => s.ref)] : []);
	}
	const observations = taskRecords(root, "observation").filter(r => r.tool_name === "arc_action"
		&& allowed(`observation:${r.observation_id}@v${r.version ?? 1}`));
	const sampleRefs = new Set(experiments.flatMap(r => r.experiment.samples.map((s: Row) => s.ref)));
	const routeIds = new Set([...candidates.map(c => c.id), ...experiments.map(r => r.source_hypothesis_id)]);
	const labelledRouteActions = observations.filter(r => !r.is_error && routeIds.has(r.input?.decision?.hypothesis_id));
	const routeActionRefs = labelledRouteActions.map(r => `observation:${r.observation_id}@v${r.version ?? 1}`);
	addRefs(observations.slice(-2).map(r => `observation:${r.observation_id}@v${r.version ?? 1}`));
	const facts = [...observationRefs].map(ref => {
		try {
			const r = resolveTaskResource(root, ref);
			return { ref, ...(r.is_error ? { error: true, outcome: "unknown" } : actionFacts(r.arc_outcome ?? {}, r.input ?? {})) };
		} catch { return { ref, unavailable: true }; }
	});
	const deniedRefs = candidates.flatMap(c => [...refs(c.evidence_refs), ...refs(c.support_refs), ...refs(c.counter_refs)])
		.filter(ref => !allowed(ref));
	const view: Row = {
		format: "task-competition-view-v1", audience: grants ? "restricted" : "parent",
		question_id: question ?? open.at(-1)?.experiment.contract.question_id ?? null,
		selected: selected ? { id: selected.id, version: selected.version ?? 1 } : null,
		facts, coverage: { scope: "only cited interventions and returned fields; hidden state unobserved",
			omitted_candidate_count: all.length - candidates.length, withheld_evidence_count: new Set(deniedRefs).size,
			additional_experiment_count: experiments.length - activeExperiments.length,
			pending_experiment_count: experiments.filter(r => r.status === "needs_assessment" || r.experiment.status === "open").length,
			omitted_disagreements: all.filter(c => !candidates.includes(c) && (c.counter_refs?.length || c.status === "challenged"))
				.map(c => ({ id: c.id, status: c.status, ref: candidateRef(c), counterevidence_count: refs(c.counter_refs).length })) },
		candidates: candidates.map(c => ({ ref: candidateRef(c), id: c.id, kind: c.kind, version: c.version ?? 1,
			related_candidate_id: c.related_candidate_id,
			question_id: c.question_id, scope: c.scope ?? "unspecified", status: c.status,
			claim: c.claim, prediction: c.prediction, falsifier: c.falsifier,
			support_refs: refs(c.support_refs).filter(allowed), counter_refs: refs(c.counter_refs).filter(allowed),
			unclassified_evidence_refs: refs(c.evidence_refs).filter(allowed),
			untested: c.untested || "not specified", next_test: c.next_test,
			options: c.options ?? [], assessment_source: c.updated_by, epistemic_status: "agent_assessment" })),
		unstructured_claims: unstructured.map(r => ({ ref: `validation:${r.validation_id}@v${r.version}`,
			hypothesis: r.hypothesis, prediction: r.prediction, alternatives: r.alternatives ?? [],
			disputes: (r.disputes ?? []).slice(-1), status: r.status, assessment: r.verdict ?? null })),
		experiments: activeExperiments.map(r => ({ ref: `validation:${r.validation_id}@v${r.version}`,
			test_id: r.experiment.contract.test_id, candidate_id: r.source_hypothesis_id,
			candidate_version: r.source_hypothesis_version, prediction: r.prediction,
			expected: r.experiment.contract.expected,
			mode: r.experiment.contract.mode, predicate: r.experiment.contract.predicate,
			candidate_predictions: r.experiment.contract.candidate_predictions,
			status: r.experiment.status, outcome: r.experiment.outcome ?? null, assessment: r.verdict ?? null,
			actions_used: r.experiment.actions_used, action_limit: r.experiment.contract.actions,
			last_result_ref: r.experiment.samples.at(-1)?.ref ?? null })),
		prior_cost: { experiments: experiments.length, successful_actions: new Set([...sampleRefs, ...routeActionRefs]).size,
			unassessed_route_actions: routeActionRefs.filter(ref => !sampleRefs.has(ref)).length,
			outcomes: completed.map(r => ({ test_id: r.experiment.contract.test_id, outcome: r.experiment.outcome })) },
		last_choice: (() => {
			const r = taskRecords(root, "competition_view").filter(r => r.record_kind === "choice"
				&& (!grants || allowed(r.view_ref))).at(-1);
			return r ? { status: r.status, review_gaps: r.review_gaps, source_ref: r.source_ref,
				acknowledged_trigger_refs: r.acknowledged_trigger_refs,
				choice_ref: `competition_view:${r.view_id}@v${r.version}`, choice: r.choice } : null;
		})(),
		decision_needed: "Use decision_review in this loop. Record selection with view_ref, candidate_id/version, evidence_refs, rationale, branches, disposition, addressed_trigger_refs and next_check; change candidates/plans through task_checkpoint.",
		competition_gap: candidates.length < 2 ? "No concrete challenger recorded; do not invent one to satisfy a count." : null,
	};
	if (view.last_choice) {
		try { view.previous_comparison = resolveTaskResource(root, view.last_choice.choice?.view_ref); }
		catch { /* The old comparison may be unavailable; do not invent its contents. */ }
	}
	view.decision_review = decisionReview(view, grants ? null : state.plan, observations, activeExperiments);
	delete view.previous_comparison;
	const digest = createHash("sha256").update(JSON.stringify(view)).digest("hex");
	return { ...view, view_id: `competition-${digest.slice(0, 20)}`, version: 1, sha256: digest,
		view_ref: `competition_view:competition-${digest.slice(0, 20)}@v1` };
}

export function persistCompetitionView(root: string, view: Row) {
	if (!taskRecords(root, "competition_view").some(r => r.view_id === view.view_id))
		appendFileSync(join(root, "task-competition-views.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(root), view)) + "\n");
}

/** Advisory receipt: missing/stale decisions remain visible, never fabricate agent uptake. */
export function recordCompetitionChoice(root: string, decision: Row | undefined, source: string) {
	const parentViews = taskRecords(root, "competition_view").filter(r => r.format === "task-competition-view-v1" && r.audience === "parent");
	const view = parentViews.find(r => r.view_ref === decision?.selection?.view_ref) ?? parentViews.at(-1);
	if (!view) return;
	const choice = decision?.selection;
	// An ordinary execution step retains the last assessment. It is not a new missed review.
	if (!choice && view.decision_review?.state === "monitoring") return;
	const c = view.candidates.find((c: Row) => c.id === choice?.candidate_id && c.version === choice?.candidate_version);
	let validEvidence = false;
	const available = new Set([...view.facts.map((f: Row) => f.ref), ...view.candidates.flatMap((c: Row) =>
		[...c.support_refs, ...c.counter_refs, ...c.unclassified_evidence_refs]), ...view.experiments.map((e: Row) => e.ref)]);
	try { validEvidence = refs(choice?.evidence_refs).length > 0 && refs(choice.evidence_refs)
		.every(ref => available.has(ref) && Boolean(resolveTaskResource(root, ref))); } catch { /* unresolved */ }
	const current = readTaskStrategyState(root).candidates.find((candidate: Row) => candidate.id === choice?.candidate_id);
	const dispositionValid = ["continue", "revise", "switch", "test", "uncertain"].includes(choice?.disposition);
	const pendingRefs = refs(view.decision_review?.triggers?.map((t: Row) => t.ref));
	const reviewComplete = dispositionValid && typeof choice?.next_check === "string" && choice.next_check.trim()
		&& pendingRefs.every(ref => refs(choice?.addressed_trigger_refs).includes(ref));
	const hasText = (s: any) => typeof s === "string" && Boolean(s.trim());
	const reviewGaps = [
		...(choice?.view_ref !== view.view_ref ? ["missing_or_unknown_view_ref"] : []),
		...(!c || !current || (current.version ?? 1) !== choice?.candidate_version ? ["missing_or_stale_candidate"] : []),
		...(!validEvidence ? ["missing_or_unlinked_evidence"] : []),
		...(!hasText(choice?.rationale) || !hasText(choice?.branches) ? ["missing_rationale_or_result_branches"] : []),
		...(view.decision_review && !dispositionValid ? ["missing_disposition"] : []),
		...(view.decision_review && (typeof choice?.next_check !== "string" || !choice.next_check.trim()) ? ["missing_next_observable_check"] : []),
		...(view.decision_review && !pendingRefs.every(ref => refs(choice?.addressed_trigger_refs).includes(ref))
			? ["unaddressed_review_triggers_read_view_ref"] : []),
	];
	const status = choice?.view_ref === view.view_ref && c && validEvidence && hasText(choice?.rationale) && hasText(choice?.branches)
		&& current && (current.version ?? 1) === choice.candidate_version
		&& (!view.decision_review || reviewComplete)
		? "recorded_agent_choice_not_semantically_verified" : "decision_unassessed";
	const priorAcknowledgement = view.last_choice?.status === "recorded_agent_choice_not_semantically_verified"
		&& view.last_choice.choice?.candidate_id === choice?.candidate_id
		&& view.last_choice.choice?.candidate_version === choice?.candidate_version
		? refs(view.last_choice.acknowledged_trigger_refs ?? view.last_choice.choice?.addressed_trigger_refs) : [];
	const record = { record_kind: "choice", view_id: `choice-${source.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
		version: 1, view_ref: view.view_ref, status, review_gaps: reviewGaps,
		acknowledged_trigger_refs: status === "recorded_agent_choice_not_semantically_verified"
			? [...new Set([...priorAcknowledgement, ...refs(choice?.addressed_trigger_refs)])] : [],
		choice: choice ?? null, source_ref: source, recordedAt: new Date().toISOString() };
	if (!taskRecords(root, "competition_view").some(r => r.view_id === record.view_id))
		appendFileSync(join(root, "task-competition-views.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(root), record)) + "\n");
	return record;
}

/** Keep decisive counterexamples inline. The full view is recoverable; history never sets card size. */
export function competitionProjection(view: Row): Row {
	const important = new Set(view.candidates.flatMap((c: Row) => c.counter_refs.slice(-1)));
	for (const c of view.candidates) for (const ref of [...c.support_refs.slice(-1), ...c.unclassified_evidence_refs.slice(-1)]) important.add(ref);
	for (const e of view.experiments) if (e.outcome === "not_met") important.add(e.last_result_ref);
	const facts = view.facts.filter((f: Row, i: number) => important.has(f.ref) || i >= view.facts.length - 2);
	const abbreviate = (s: any, limit = 180) => String(s ?? "").length > limit ? `${String(s).slice(0, limit)} [abridged; read view_ref]` : s;
	const experiments = view.experiments.slice().sort((a: Row, b: Row) =>
		Number(b.outcome === "not_met") - Number(a.outcome === "not_met")
		|| Number(b.status === "open") - Number(a.status === "open")).slice(0, 2);
	const result: Row = { format: view.format, audience: view.audience, view_ref: view.view_ref, sha256: view.sha256, selected: view.selected,
		question_id: view.question_id, facts, coverage: { ...view.coverage,
			omitted_disagreements: (view.coverage.omitted_disagreements ?? []).slice(-2),
			additional_disagreement_count: Math.max(0, (view.coverage.omitted_disagreements ?? []).length - 2),
			additional_fact_count: view.facts.length - facts.length, detail: "task_resource read view_ref for full comparison" },
		candidates: view.candidates.map((c: Row) => ({ ...c, claim: abbreviate(c.claim), prediction: abbreviate(c.prediction),
			falsifier: abbreviate(c.falsifier), untested: abbreviate(c.untested), next_test: abbreviate(c.next_test),
			options: c.options.slice(0, 1).map((o: Row) => ({ action: abbreviate(o.action, 120),
				cost: abbreviate(o.cost, 60), risk: abbreviate(o.risk, 80), branches: abbreviate(o.branches, 180) })),
			additional_option_count: Math.max(0, c.options.length - 1),
			support_refs: c.support_refs.slice(-1), counter_refs: c.counter_refs.slice(-1),
			unclassified_evidence_refs: c.unclassified_evidence_refs.slice(-1),
			comparison_gap: c.counter_refs.length > 1 ? "Additional counterexamples in view_ref; inspect before concluding that all conflicts are resolved." : null,
			additional_evidence_count: Math.max(0, c.support_refs.length - 1) + Math.max(0, c.counter_refs.length - 1)
				+ Math.max(0, c.unclassified_evidence_refs.length - 1) })),
		experiments: experiments.map((e: Row) => ({ ...e, prediction: abbreviate(e.prediction),
			expected: abbreviate(e.expected), candidate_predictions: (e.candidate_predictions ?? []).slice(0, 3)
				.map((p: Row) => ({ candidate_id: p.candidate_id, prediction: abbreviate(p.prediction),
					predicate: p.predicate ? { ...p.predicate, value: abbreviate(p.predicate.value) } : undefined })),
			predicate: e.predicate ? { ...e.predicate, value: abbreviate(e.predicate.value) } : undefined })),
		additional_inline_experiment_count: Math.max(0, view.experiments.length - experiments.length),
		prior_cost: { experiments: view.prior_cost.experiments,
			successful_actions: view.prior_cost.successful_actions,
			unassessed_route_actions: view.prior_cost.unassessed_route_actions,
			outcome_counts: view.prior_cost.outcomes.reduce((counts: Row, e: Row) => { counts[e.outcome] = (counts[e.outcome] ?? 0) + 1; return counts; }, {}) },
		last_choice: view.last_choice ? { status: view.last_choice.status, review_gaps: view.last_choice.review_gaps,
			source_ref: view.last_choice.source_ref,
			choice_ref: view.last_choice.choice_ref, choice: view.last_choice.choice ? {
				candidate_id: view.last_choice.choice.candidate_id, candidate_version: view.last_choice.choice.candidate_version,
				disposition: view.last_choice.choice.disposition, next_check: abbreviate(view.last_choice.choice.next_check),
				rationale: abbreviate(view.last_choice.choice.rationale), branches: abbreviate(view.last_choice.choice.branches),
				evidence_refs: refs(view.last_choice.choice.evidence_refs).slice(-3),
			} : null } : null, competition_gap: view.competition_gap,
		unstructured_claims: (view.unstructured_claims ?? []).map((c: Row) => ({ ...c,
			hypothesis: abbreviate(c.hypothesis), prediction: abbreviate(c.prediction),
			alternatives: (c.alternatives ?? []).slice(-2).map((s: any) => abbreviate(s)),
			additional_alternative_count: Math.max(0, (c.alternatives ?? []).length - 2),
			disputes: (c.disputes ?? []).map((d: Row) => ({ explanation: abbreviate(d.explanation),
				evidence_refs: refs(d.evidence_refs).slice(-2), additional_evidence_count: Math.max(0, refs(d.evidence_refs).length - 2) })) })),
		decision_review: view.decision_review ? { ...view.decision_review,
			triggers: view.decision_review.triggers.slice(-4),
			additional_trigger_count: Math.max(0, view.decision_review.triggers.length - 4),
			next_check: abbreviate(view.decision_review.next_check) } : undefined,
		decision_needed: "Use decision_review; record selection and update actual candidates/plans via task_checkpoint." };
	const maxChars = 8_000;
	result.projection_budget = { max_chars: maxChars, reduced: false, details_required: false };
	if (JSON.stringify(result).length > maxChars) {
		result.projection_budget.reduced = true;
		for (const c of result.candidates) {
			for (const key of ["claim", "prediction", "falsifier", "untested", "next_test"]) c[key] = abbreviate(c[key], 100);
			for (const o of c.options) { o.action = abbreviate(o.action, 80); o.branches = abbreviate(o.branches, 100); }
		}
		for (const e of result.experiments) { e.prediction = abbreviate(e.prediction, 100); e.expected = abbreviate(e.expected, 100); }
		if (result.decision_review) result.decision_review.task = "Assess triggers; choose continue/revise/switch/test/uncertain, cite evidence, and name the next observable check. Read view_ref for omitted detail.";
		if (result.last_choice?.choice) {
			result.last_choice.choice.rationale = abbreviate(result.last_choice.choice.rationale, 100);
			result.last_choice.choice.branches = abbreviate(result.last_choice.choice.branches, 100);
		}
	}
	if (JSON.stringify(result).length > maxChars) {
		// Keep counterexample facts and failed experiment endpoints ahead of older supporting facts.
		const decisive = new Set(result.candidates.flatMap((c: Row) => c.counter_refs));
		for (const e of result.experiments) if (e.outcome === "not_met") decisive.add(e.last_result_ref);
		const retained = result.facts.filter((f: Row, i: number) => decisive.has(f.ref) || i === result.facts.length - 1);
		result.coverage.additional_fact_count += result.facts.length - retained.length;
		result.facts = retained;
		result.coverage.additional_unstructured_claim_count = result.unstructured_claims.length;
		result.unstructured_claims = [];
		result.projection_budget.details_required = true;
	}
	if (JSON.stringify(result).length > maxChars) {
		// Exceptionally large fields cannot bypass the card ceiling. This is an explicit expansion request.
		const compact: Row = { format: view.format, audience: view.audience, view_ref: view.view_ref, sha256: view.sha256,
			selected: view.selected, candidates: result.candidates.map((c: Row) => ({ id: c.id, ref: c.ref,
				status: c.status, claim: abbreviate(c.claim, 100), prediction: abbreviate(c.prediction, 100),
				counter_refs: c.counter_refs, options: c.options })), facts: result.facts,
			decision_review: { state: view.decision_review?.state, trigger_count: view.decision_review?.triggers.length ?? 0,
				task: "Read view_ref before resolving this decision; the full comparison exceeded the inline budget." },
			projection_budget: { max_chars: maxChars, reduced: true, details_required: true } };
		if (JSON.stringify(compact).length <= maxChars) return compact;
		return { format: view.format, audience: view.audience, view_ref: view.view_ref, sha256: view.sha256,
			decision_review: { state: "detail_required", task: "Read view_ref to compare candidates and counterevidence before deciding; oversized fields are preserved there." },
			projection_budget: { max_chars: maxChars, reduced: true, details_required: true } };
	}
	return result;
}

/** Inspect the actual provider payload, including @file child prompts serialized inside strings. */
export function competitionPayloadExposure(payload: unknown, root?: string): Row[] {
	const found = new Map<string, Row>();
	const visit = (value: any) => {
		if (!value) return;
		if (typeof value === "object") {
			if (value.format === "task-competition-view-v1" && value.view_ref) {
				let comparison_status = "payload_observed_canonical_not_checked";
				if (root) {
					try {
						const canonical = resolveTaskResource(root, value.view_ref);
						comparison_status = value.sha256 === canonical.sha256
							&& JSON.stringify(value) === JSON.stringify(competitionProjection(canonical))
							? "effective_projection_matches_canonical_view" : "modified_or_incomplete_projection";
					} catch { comparison_status = "unknown_view_reference"; }
				}
				found.set(value.view_ref, { view_ref: value.view_ref, canonical_sha256: value.sha256,
					comparison_status,
					projection_sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
					candidate_refs: (value.candidates ?? []).map((c: Row) => c.ref),
					review_state: value.decision_review?.state,
					review_trigger_refs: (value.decision_review?.triggers ?? []).map((t: Row) => t.ref),
					fact_refs: (value.facts ?? []).map((f: Row) => f.ref), coverage: value.coverage });
			}
			for (const item of Object.values(value)) visit(item);
		} else if (typeof value === "string") {
			const marker = /"format"\s*:\s*"task-competition-view-v1"/g;
			for (const match of value.matchAll(marker)) {
				const start = value.lastIndexOf("{", match.index);
				let depth = 0, quoted = false, escaped = false;
				for (let i = start; i < value.length; i++) {
					const ch = value[i];
					if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; }
					else if (ch === '"') quoted = true;
					else if (ch === "{") depth++;
					else if (ch === "}" && --depth === 0) {
						try { visit(JSON.parse(value.slice(start, i + 1))); } catch { /* not an effective structured view */ }
						break;
					}
				}
			}
		}
	};
	visit(payload);
	return [...found.values()];
}
