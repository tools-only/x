/** Durable, agent-authored candidate and plan state. Never infers game truth. */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { resolveTaskResource, taskRecords } from "./pi_task_resource_store.ts";
import { semanticEntries, validateSemanticRefs } from "./pi_decision_state.ts";

type Row = Record<string, any>;
const pathFor = (root: string) => join(root, "task-strategy-state.json");
const clip = (value: unknown, limit = 120) => String(value ?? "").trim().slice(0, limit);
const authoredText = (value: unknown) => String(value ?? "").trim();
const refs = (value: unknown) => Array.isArray(value)
	? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))] : [];
type PlanStep = string | { action: string; x?: number; y?: number; note?: string;
	evidence_refs?: string[];
	expected?: { target_before?: number; target_after?: number; level_changed?: boolean;
		level_after?: number; state?: string } };
function normalizePlanStep(value: unknown): PlanStep {
	if (typeof value === "string") return authoredText(value);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("plan step must be text or an action object");
	const raw = value as Row;
	const action = clip(raw.action, 60);
	if (!action) throw new Error("structured plan step requires action");
	for (const key of ["x", "y"] as const) if (raw[key] !== undefined
		&& (!Number.isInteger(raw[key]) || raw[key] < 0 || raw[key] > 63)) throw new Error(`plan step ${key} must be 0..63`);
	const expected: Record<string, unknown> = {};
	if (raw.expected !== undefined) {
		if (!raw.expected || typeof raw.expected !== "object" || Array.isArray(raw.expected)) throw new Error("plan step expected must be an object");
		for (const key of ["target_before", "target_after", "level_after"] as const) {
			if (raw.expected[key] !== undefined) {
				if (!Number.isInteger(raw.expected[key])) throw new Error(`plan expected ${key} must be an integer`);
				expected[key] = raw.expected[key];
			}
		}
		if (raw.expected.level_changed !== undefined) {
			if (typeof raw.expected.level_changed !== "boolean") throw new Error("plan expected level_changed must be boolean");
			expected.level_changed = raw.expected.level_changed;
		}
		if (raw.expected.state !== undefined) expected.state = clip(raw.expected.state, 60);
	}
	return { action, ...(raw.x !== undefined ? { x: raw.x } : {}),
		...(raw.y !== undefined ? { y: raw.y } : {}),
		...(raw.note ? { note: authoredText(raw.note) } : {}),
		...(refs(raw.evidence_refs).length ? { evidence_refs: refs(raw.evidence_refs) } : {}),
		...(Object.keys(expected).length ? { expected } : {}) };
}
function stepPreview(step: unknown) {
	return typeof step === "string" ? clip(step, 160) : step && typeof step === "object"
		? { ...step, ...(Array.isArray((step as Row).evidence_refs) ? {
			evidence_refs: (step as Row).evidence_refs.slice(-4),
			omitted_evidence_ref_count: Math.max(0, (step as Row).evidence_refs.length - 4),
		} : {}) } : null;
}

export function readTaskStrategyState(root: string): Row {
	try {
		if (existsSync(pathFor(root))) {
			const value = JSON.parse(readFileSync(pathFor(root), "utf8"));
			if (value?.format === "task-strategy-state-v1") return value;
		}
	} catch { /* A damaged snapshot must not become an instruction. */ }
	return { format: "task-strategy-state-v1", revision: 0, candidates: [], selected_candidate_id: null, plan: null };
}

export function normalizeCandidateUpdates(value: unknown): Row[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("candidate_updates must be an array");
	return value.map((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("candidate update must be an object");
		const item = raw as Row;
		const id = clip(item.id, 100);
		const kind = clip(item.kind, 30);
		const status = clip(item.status, 30);
		if (!id || !["rule", "goal", "strategy"].includes(kind)
			|| !["proposed", "supported", "challenged", "rejected"].includes(status)) {
			throw new Error("candidate update requires id, kind=rule|goal|strategy and a valid status");
		}
		if (status !== "proposed" && !refs(item.evidence_refs).length) {
			throw new Error(`candidate ${id} ${status} requires evidence_refs`);
		}
		if (item.knowledge_kind !== undefined && !["operation_effect", "goal_rule", "representation", "execution_route", "unknown"].includes(item.knowledge_kind))
			throw new Error("unknown candidate knowledge_kind");
		return { id, kind, status, claim: authoredText(item.claim),
			...(item.knowledge_kind !== undefined ? { knowledge_kind: item.knowledge_kind } : {}),
			...(item.counterevidence !== undefined ? { counterevidence: semanticEntries(item.counterevidence, "counterevidence") } : {}),
			...(item.question_id !== undefined ? { question_id: clip(item.question_id, 100) } : {}),
			...(item.scope !== undefined ? { scope: authoredText(item.scope) } : {}),
			...(item.support_refs !== undefined ? { support_refs: refs(item.support_refs) } : {}),
			...(item.counter_refs !== undefined ? { counter_refs: refs(item.counter_refs) } : {}),
			...(item.untested !== undefined ? { untested: authoredText(item.untested) } : {}),
			...(item.options !== undefined ? { options: normalizeOptions(item.options) } : {}),
			prediction: authoredText(item.prediction), falsifier: authoredText(item.falsifier),
			next_test: authoredText(item.next_test), evidence_refs: refs(item.evidence_refs) };
	});
}

export function updateTaskStrategyState(root: string, input: {
	candidate_updates?: unknown; selected_candidate_id?: unknown; plan_update?: unknown; source_ref: string;
}): Row {
	const state = readTaskStrategyState(root);
	let updates = normalizeCandidateUpdates(input.candidate_updates);
	for (const update of updates) validateSemanticRefs(update.counterevidence, ref => resolveTaskResource(root, ref));
	if (input.plan_update && typeof input.plan_update === "object") {
		for (const key of ["preconditions", "stop_if"]) if ((input.plan_update as Row)[key] !== undefined) {
			semanticEntries((input.plan_update as Row)[key], key);
			validateSemanticRefs((input.plan_update as Row)[key], ref => resolveTaskResource(root, ref));
		}
	}
	if (input.source_ref.startsWith("research_report:")
		&& (state.applied_report_refs ?? []).includes(input.source_ref)) return state;
	if (input.source_ref.startsWith("research_report:")) {
		if (input.selected_candidate_id !== undefined || input.plan_update !== undefined) throw new Error("research reports cannot select the parent route or modify its plan");
		const suffix = createHash("sha256").update(input.source_ref).digest("hex").slice(0, 10);
		updates = updates.map(item => {
			const existing = (state.candidates ?? []).find((c: Row) => c.id === item.id);
			return existing ? { ...item, id: `${item.id.slice(0, 70)}-research-${suffix}`,
				related_candidate_id: item.id, question_id: item.question_id ?? existing.question_id,
				claim: item.claim || existing.claim, prediction: item.prediction || existing.prediction } : item;
		});
	}
	const candidates = new Map<string, Row>((state.candidates ?? []).map((item: Row) => [item.id, item]));
	const changedIds = new Set<string>();
	for (const item of updates) {
		const previous = candidates.get(item.id);
		if (!previous && !item.claim) throw new Error(`new candidate ${item.id} requires a claim`);
		if (previous && previous.kind !== item.kind) throw new Error(`candidate ${item.id} cannot change kind`);
		for (const ref of [...(item.support_refs ?? []), ...(item.counter_refs ?? [])]) resolveTaskResource(root, ref);
		const latestObservation = taskRecords(root, "observation").at(-1);
		const nextCandidate = { ...previous, ...item,
			version: Number(previous?.version ?? 0) + 1,
			assessment_evidence_cutoff: latestObservation ? `observation:${latestObservation.observation_id}@v${latestObservation.version ?? 1}` : null,
			claim: item.claim || previous?.claim,
			prediction: item.prediction || previous?.prediction || "",
			falsifier: item.falsifier || previous?.falsifier || "",
			next_test: item.next_test || previous?.next_test || "",
			evidence_refs: [...new Set([...(previous?.evidence_refs ?? []), ...item.evidence_refs])],
			updated_by: input.source_ref, updated_at: new Date().toISOString() };
		const contentKeys = ["id", "kind", "status", "claim", "prediction", "falsifier", "next_test", "question_id", "scope",
			"support_refs", "counter_refs", "untested", "options", "evidence_refs", "related_candidate_id", "knowledge_kind", "counterevidence"];
		if (previous && contentKeys.every(key => JSON.stringify(previous[key]) === JSON.stringify(nextCandidate[key]))) continue;
		candidates.set(item.id, nextCandidate);
		changedIds.add(item.id);
	}
	let selected = state.selected_candidate_id;
	if (input.selected_candidate_id !== undefined) {
		selected = input.selected_candidate_id === null ? null : clip(input.selected_candidate_id, 100);
		if (selected && !candidates.has(selected)) throw new Error(`unknown selected candidate ${selected}`);
	}
	let plan = state.plan;
	if (input.plan_update !== undefined) {
		const raw = input.plan_update as Row;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("plan_update must be an object");
		const planId = clip(raw.plan_id, 100);
		const candidateId = clip(raw.candidate_id ?? plan?.candidate_id, 100);
		const status = clip(raw.status ?? plan?.status, 30);
		const steps = raw.steps === undefined ? plan?.steps : (Array.isArray(raw.steps)
			? raw.steps.map(normalizePlanStep).filter(Boolean) : null);
		const currentStep = raw.current_step === undefined ? Number(plan?.current_step ?? 0) : Number(raw.current_step);
		const changeReason = authoredText(raw.change_reason);
		const evidenceRefs = refs(raw.evidence_refs);
		if (!planId || !candidateId || !candidates.has(candidateId) || !Array.isArray(steps) || steps.length === 0
			|| !Number.isInteger(currentStep) || currentStep < 0 || currentStep >= steps.length
			|| !["active", "complete", "abandoned"].includes(status)) throw new Error("plan_update requires a known candidate, steps, current step and valid status");
		if (plan?.status === "active" && (plan.plan_id !== planId || plan.candidate_id !== candidateId || status === "abandoned")
			&& !changeReason) throw new Error("replacing or abandoning an active plan requires change_reason");
		if (plan?.status === "active" && plan.plan_id === planId && raw.steps !== undefined
			&& JSON.stringify(steps) !== JSON.stringify(plan.steps) && !changeReason) {
			throw new Error("revising active plan steps requires change_reason");
		}
		if (plan?.plan_id !== planId && raw.steps === undefined) throw new Error("a new plan requires steps");
		if (plan?.plan_id === planId && currentStep !== plan.current_step && !evidenceRefs.length) {
			throw new Error("advancing a plan requires evidence_refs");
		}
		if (status === "complete" && !evidenceRefs.length) throw new Error("completing a plan requires evidence_refs");
		if (!plan && status !== "active") throw new Error("a new plan must start active");
		if (plan?.needs_reconciliation && !changeReason) throw new Error("reconciling a challenged plan requires change_reason");
		plan = { ...(plan?.plan_id === planId ? plan : {}), plan_id: planId, candidate_id: candidateId,
			...(raw.preconditions !== undefined ? { preconditions: raw.preconditions } : {}),
			...(raw.stop_if !== undefined ? { stop_if: raw.stop_if } : {}),
			candidate_version: candidates.get(candidateId)?.version ?? 1,
			dependency_test_ids: raw.dependency_test_ids === undefined ? plan?.dependency_test_ids ?? [] : refs(raw.dependency_test_ids),
			status, steps, current_step: currentStep,
			change_reason: changeReason || plan?.change_reason || "", evidence_refs: [...new Set([...(plan?.evidence_refs ?? []), ...evidenceRefs])],
			needs_assessment: false, needs_reconciliation: false,
			updated_by: input.source_ref, updated_at: new Date().toISOString() };
		if (input.selected_candidate_id === undefined) selected = candidateId;
	}
	if (plan?.status === "active" && selected !== plan.candidate_id) {
		throw new Error("active plan and selected candidate must agree; revise the plan with a change_reason first");
	}
	if (plan?.status === "active" && input.plan_update === undefined && plan.candidate_version !== undefined
		&& plan.candidate_version !== candidates.get(plan.candidate_id)?.version) plan = { ...plan, needs_reconciliation: true };
	if (!updates.length && input.selected_candidate_id === undefined && input.plan_update === undefined) return state;
	const next = { ...state, revision: Number(state.revision ?? 0) + 1,
		candidates: [...candidates.values()], selected_candidate_id: selected, plan,
		applied_report_refs: input.source_ref.startsWith("research_report:")
			? [...(state.applied_report_refs ?? []), input.source_ref] : state.applied_report_refs ?? [] };
	const target = pathFor(root);
	const staging = `${target}.${process.pid}.tmp`;
	for (const id of changedIds) appendFileSync(join(root, "task-strategy-candidates.jsonl"), JSON.stringify(
		stampTaskRecord(ensureTaskScope(root), { ...candidates.get(id), candidate_id: id })) + "\n", "utf8");
	writeFileSync(staging, JSON.stringify(next) + "\n", "utf8");
	renameSync(staging, target);
	return next;
}

export function recordTaskStrategyAction(root: string, decision: Row | undefined, observationRef: string,
	action?: Row, result?: Row): Row | undefined {
	const state = readTaskStrategyState(root);
	const plan = state.plan;
	if (!plan || plan.status !== "active") return;
	const identified = decision?.plan_id === plan.plan_id && Number(decision?.plan_step) === plan.current_step;
	const step = plan.steps[plan.current_step] as PlanStep;
	const mismatches: string[] = [];
	const unknownFields: string[] = [];
	if (!identified) mismatches.push("plan_identity_or_step");
	if (identified && step && typeof step === "object") {
		for (const key of ["action", "x", "y"] as const) if (step[key] !== undefined && step[key] !== action?.[key]) mismatches.push(key);
		const observed: Row = { target_before: result?.action_target_cell?.before,
			target_after: result?.action_target_cell?.after,
			level_changed: result?.public_transition?.level_changed,
			level_after: result?.public_transition?.level_after, state: result?.state };
		for (const [key, value] of Object.entries(step.expected ?? {})) {
			if (observed[key] === undefined || observed[key] === null) unknownFields.push(key);
			else if (observed[key] !== value) mismatches.push(key);
		}
	}
	const assessed = identified && step && typeof step === "object" && Boolean(step.expected && Object.keys(step.expected).length);
	const outcome = mismatches.length ? "mismatch" : assessed && !unknownFields.length ? "matched" : "unassessed";
	const advance = outcome === "matched" && plan.current_step + 1 < plan.steps.length;
	const next = { ...state, revision: Number(state.revision ?? 0) + 1,
		plan: { ...plan, current_step: advance ? plan.current_step + 1 : plan.current_step,
			needs_assessment: outcome !== "matched" || !advance,
			needs_reconciliation: outcome === "mismatch",
			last_step_outcome: { status: outcome, observation_ref: observationRef,
				plan_step: plan.current_step, mismatches, unknown_fields: unknownFields },
			last_action_ref: observationRef, last_action_plan_id: decision?.plan_id ?? null,
			actions_executed: Number(plan.actions_executed ?? 0) + (identified ? 1 : 0) } };
	const target = pathFor(root);
	const staging = `${target}.${process.pid}.tmp`;
	writeFileSync(staging, JSON.stringify(next) + "\n", "utf8");
	renameSync(staging, target);
	return next;
}

export function taskStrategyIndex(state: Row, maxCandidates = 3): Row | undefined {
	const all = Array.isArray(state.candidates) ? state.candidates as Row[] : [];
	if (!all.length && !state.plan) return undefined;
	const selected = all.find((item) => item.id === state.selected_candidate_id);
	const recent = all.filter((item) => item.status !== "rejected" && item.id !== selected?.id)
		.sort((left, right) => String(left.updated_at ?? "").localeCompare(String(right.updated_at ?? "")))
		.slice(-maxCandidates + (selected ? 1 : 0));
	const plan = state.plan;
	return { revision: state.revision, selected_candidate_id: state.selected_candidate_id,
		candidates: [...(selected ? [selected] : []), ...recent].map((item) => ({
			id: item.id, version: item.version ?? 1, kind: item.kind, status: item.status, claim: clip(item.claim),
			evidence_refs: refs(item.evidence_refs).slice(-3),
			...(String(item.updated_by ?? "").startsWith("research_report:") ? { detail_ref: item.updated_by } : {}),
		})), omitted_candidate_count: Math.max(0, all.length - recent.length - (selected ? 1 : 0)),
		...(plan ? { plan: { plan_id: plan.plan_id, candidate_id: plan.candidate_id,
			status: plan.status, current_step: plan.current_step, step_count: plan.steps.length,
			step: stepPreview(plan.steps[plan.current_step]), needs_assessment: Boolean(plan.needs_assessment),
			needs_reconciliation: Boolean(plan.needs_reconciliation),
			last_action_ref: plan.last_action_ref ?? null,
			last_step_outcome: plan.last_step_outcome ?? null } } : {}),
		inspect: "task_checkpoint(action='inspect', candidate_id=<id> or detail='strategy')" };
}

function normalizeOptions(value: unknown): Row[] {
	if (!Array.isArray(value) || value.length > 3) throw new Error("candidate options must contain at most three actions/tests");
	return value.map(raw => {
		if (!raw || typeof raw !== "object" || !raw.action) throw new Error("candidate option requires action");
		return { action: authoredText(raw.action), cost: authoredText(raw.cost ?? "unknown"),
			risk: authoredText(raw.risk ?? "unknown"), branches: authoredText(raw.branches ?? "unknown") };
	});
}

/** Only explicit experiment dependencies pause a plan; native exploratory actions remain available. */
export function reconcileExperimentPlan(root: string, validation: Row) {
	const state = readTaskStrategyState(root), plan = state.plan, c = validation.experiment.contract;
	if (!plan || plan.status !== "active" || validation.experiment.outcome === "met") return;
	if (!(plan.dependency_test_ids ?? []).includes(c.test_id) && c.plan_id !== plan.plan_id) return;
	const next = { ...state, revision: Number(state.revision ?? 0) + 1,
		plan: { ...plan, needs_reconciliation: true, experiment_outcome_ref: `validation:${validation.validation_id}@v${validation.version}` } };
	const target = pathFor(root), staging = `${target}.${process.pid}.tmp`;
	writeFileSync(staging, JSON.stringify(next) + "\n", "utf8");
	renameSync(staging, target);
}

/** Publish legacy snapshots as exact resources without inventing historical assessments. */
export function materializeStrategyCandidates(root: string) {
	const saved = new Set(taskRecords(root, "strategy_candidate").map(c => `${c.candidate_id}@v${c.version}`));
	for (const c of readTaskStrategyState(root).candidates ?? []) if (!saved.has(`${c.id}@v${c.version ?? 1}`)) {
		appendFileSync(join(root, "task-strategy-candidates.jsonl"), JSON.stringify(stampTaskRecord(ensureTaskScope(root), {
			...c, candidate_id: c.id, version: c.version ?? 1, legacy_snapshot: true,
		})) + "\n", "utf8");
	}
}
