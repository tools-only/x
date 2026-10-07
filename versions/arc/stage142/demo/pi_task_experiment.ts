/** Finite observable experiments. Outcomes describe predictions, not hypothesis truth. */
type Row = Record<string, any>;
export function actionFacts(details: Row = {}, action: Row = {}): Row {
	const d = details.observation_delta ?? {}, cells = d.changed_cells ?? details.changed_cells;
	const count = typeof cells === "number" && Number.isFinite(cells) && cells >= 0 ? cells
		: Array.isArray(cells) && !d.cells_truncated ? cells.length : undefined;
	return { action: action.action, x: action.x, y: action.y, pre_action_state: details.pre_action_state,
		changed_cells: d.frame_available === false ? undefined : count,
		target_before: details.action_target_cell?.before, target_after: details.action_target_cell?.after,
		level_before: details.public_transition?.level_before, level_after: details.public_transition?.level_after,
		level_changed: details.public_transition?.level_changed,
		reset: action.action === "RESET" || details.public_transition?.reset === true,
		state: details.state, action_index: details.action_budget?.total_used };
}
export function normalizeExperiment(decision: Row, cutoff: string | null): Row | undefined {
	const w = decision.validation_window;
	if (!w) return;
	if (!decision.hypothesis_id || !decision.hypothesis || !decision.prediction)
		throw new Error("finite experiment requires hypothesis_id, hypothesis and prediction");
	if (!Number.isSafeInteger(w.actions) || w.actions < 1) throw new Error("experiment actions must be positive integer");
	const version = decision.hypothesis_version ?? 1, mode = w.mode ?? "final";
	if (!Number.isSafeInteger(version) || version < 1) throw new Error("invalid hypothesis_version");
	if (!["any", "each", "final"].includes(mode)) throw new Error("experiment mode must be any, each or final");
	const p = w.predicate;
	if (w.candidate_predictions !== undefined && (!Array.isArray(w.candidate_predictions) || w.candidate_predictions.length > 3
		|| w.candidate_predictions.some((v: Row) => !v || !v.candidate_id || (!v.predicate && !String(v.prediction ?? "").trim()))))
		throw new Error("candidate_predictions requires at most three identified predictions");
	if (p !== undefined && (!p || !["changed_cells", "target_before", "target_after", "level_changed", "level_after", "state"].includes(p.field)
		|| !["eq", "gte", "lte"].includes(p.op) || !["number", "string", "boolean"].includes(typeof p.value)
		|| (typeof p.value === "number" && !Number.isFinite(p.value))
		|| (p.op !== "eq" && typeof p.value !== "number"))) throw new Error("invalid observable predicate");
	if (w.scope !== undefined && !["level", "task"].includes(w.scope)) throw new Error("invalid experiment scope");
	return { test_id: String(w.test_id ?? `${decision.hypothesis_id}-v${version}`),
		candidate_id: String(decision.hypothesis_id), candidate_version: version,
		question_id: String(w.question_id ?? decision.hypothesis_id),
		hypothesis: String(decision.hypothesis), prediction: String(decision.prediction),
		expected: String(w.expected ?? decision.prediction), requested_expiry_assessment: w.on_expiry ?? null,
		actions: w.actions, mode, scope: w.scope ?? "level",
		...(p ? { predicate: { field: p.field, op: p.op, value: p.value } } : {}),
		candidate_predictions: Array.isArray(w.candidate_predictions) ? w.candidate_predictions : [],
		retry_reason: String(w.retry_reason ?? "").trim(), evidence_cutoff: cutoff, plan_id: decision.plan_id ?? null };
}
export function advanceExperiment(experiment: Row, ref: string, facts: Row, isError = false): Row {
	if (experiment.status !== "open" || experiment.samples.some((s: Row) => s.ref === ref)) return experiment;
	if (isError) return experiment.failures?.includes(ref) ? experiment
		: { ...experiment, failures: [...(experiment.failures ?? []), ref] };
	const c = experiment.contract;
	let matched: boolean | null = null;
	if (c.predicate && facts[c.predicate.field] !== undefined && facts[c.predicate.field] !== null) {
		const actual = facts[c.predicate.field], p = c.predicate;
		matched = typeof actual !== typeof p.value ? null : p.op === "eq" ? actual === p.value
			: p.op === "gte" ? actual >= p.value : actual <= p.value;
	}
	const samples = [...experiment.samples, { ref, facts, matched }], values = samples.map((s: Row) => s.matched);
	const next = { ...experiment, samples, actions_used: samples.length }, due = samples.length >= c.actions;
	let outcome: string | undefined;
	if (c.scope === "level" && facts.reset) outcome = "interrupted";
	else if (c.predicate) {
		if (c.mode === "any" && values.includes(true)) outcome = "met";
		else if (c.mode === "each" && values.includes(false)) outcome = "not_met";
		else if (due) outcome = c.mode === "final" ? (matched === null ? "unknown" : matched ? "met" : "not_met")
			: values.includes(null) ? "unknown" : c.mode === "each" ? "met" : "not_met";
	} else if (due) outcome = "needs_assessment";
	if (!outcome && c.scope === "level" && facts.level_changed === true) outcome = "interrupted";
	return outcome ? { ...next, status: "completed", outcome, ended_at_ref: ref } : next;
}
