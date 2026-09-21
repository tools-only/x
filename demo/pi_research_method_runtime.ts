/** Deterministic evidence organization and lifecycle records for task-local methods.
 *
 * This module never decides that two trajectories share a semantic mechanism.
 * It only groups exact records that are useful for an Auto-Research comparison,
 * and advances method maturity from explicit runtime events.
 */

import { createHash } from "node:crypto";

type Row = Record<string, any>;

export type MethodMaturity =
	| "experience"
	| "candidate_method"
	| "trial"
	| "validated_within_scope"
	| "contradicted"
	| "retired";

const METHOD_KINDS = new Set(["procedure", "computation", "plan", "role"]);

function unique(values: unknown[]): string[] {
	return [...new Set(values.flatMap((value) => value === undefined || value === null
		? []
		: [String(value).trim()]).filter(Boolean))];
}

function observationId(row: Row): string {
	return String(row.observation_id ?? row.event_id ?? "").trim();
}

function observationReferenceId(value: unknown): string {
	const reference = String(value ?? "").trim();
	return reference.match(/^observation:([^@]+)@v\d+$/)?.[1] ?? reference;
}

function effectShape(row: Row): string {
	const state = row.arc_outcome ?? {};
	const delta = state.observation_delta ?? {};
	const text = String(row.result_text ?? row.result ?? "");
	const changedMatch = text.match(/changed_cells[\\\"=: ]+(\d+)/);
	const changed = Number(delta.changed_cells ?? state.changed_cells ?? changedMatch?.[1]);
	const bbox = delta.bbox ?? state.bbox;
	const textBox = text.match(/bbox[\\\"=: ]+\{?\\?\"?top\\?\"?[:=](\d+).*?\\?\"?left\\?\"?[:=](\d+).*?\\?\"?bottom\\?\"?[:=](\d+).*?\\?\"?right\\?\"?[:=](\d+)/);
	const box = bbox && typeof bbox === "object"
		? [bbox.top, bbox.left, bbox.bottom, bbox.right]
		: textBox ? textBox.slice(1, 5).map(Number) : [];
	if (Number.isFinite(changed) && changed === 0) return "no_change";
	if (box.length === 4 && box.every((value) => Number.isFinite(Number(value)))) {
		return `bbox:${box.map((value) => Math.floor(Number(value) / 5)).join("-")}`;
	}
	if (Number.isFinite(changed) && changed > 0) return `changed:${changed}`;
	return "effect:unclassified";
}

function observationDeltaFacts(row: Row): Row {
	const state = row.arc_outcome ?? {};
	const delta = state.observation_delta ?? {};
	const text = String(row.result_text ?? row.result ?? "");
	const changed = Number(delta.changed_cells ?? state.changed_cells
		?? text.match(/changed_cells[^0-9]+(\d+)/)?.[1]);
	const rawBox = delta.bbox ?? state.bbox;
	const boxMatch = text.match(/bbox[^0-9]+top[^0-9]+(\d+).*?left[^0-9]+(\d+).*?bottom[^0-9]+(\d+).*?right[^0-9]+(\d+)/);
	const bbox = rawBox && typeof rawBox === "object"
		? { top: Number(rawBox.top), left: Number(rawBox.left), bottom: Number(rawBox.bottom), right: Number(rawBox.right) }
		: boxMatch ? { top: Number(boxMatch[1]), left: Number(boxMatch[2]), bottom: Number(boxMatch[3]), right: Number(boxMatch[4]) } : null;
	return {
		...(Number.isFinite(changed) ? { changed_cells: changed } : {}),
		...(bbox && Object.values(bbox).every(Number.isFinite) ? { bbox } : {}),
	};
}

function changedGroupFacts(row: Row): Row | undefined {
	const text = String(row.result_text ?? row.result ?? "");
	const marker = "Changed groups: ";
	const start = text.indexOf(marker);
	if (start < 0) return undefined;
	const bodyStart = start + marker.length;
	const ends = [" These are separate groups", " Observation delta"]
		.map((suffix) => text.indexOf(suffix, bodyStart)).filter((value) => value >= 0);
	if (!ends.length) return undefined;
	try {
		const value = JSON.parse(text.slice(bodyStart, Math.min(...ends)).trim().replace(/\.$/, ""));
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		return {
			count: Number(value.count ?? 0),
			sizes: Array.isArray(value.sizes) ? value.sizes.map(Number).filter(Number.isFinite) : [],
			boxes: Array.isArray(value.boxes) ? value.boxes.flatMap((box: Row) => {
				const normalized = { top: Number(box?.top), left: Number(box?.left), bottom: Number(box?.bottom), right: Number(box?.right) };
				return Object.values(normalized).every(Number.isFinite) ? [normalized] : [];
			}) : [],
		};
	} catch { return undefined; }
}

function decisionPhase(row: Row): string {
	const decision = row.input?.decision ?? {};
	const hypothesis = String(decision.hypothesis_id ?? "").trim();
	if (hypothesis) return `hypothesis:${hypothesis}:v${Number(decision.hypothesis_version ?? 1)}`;
	const request = String(decision.research_request_ref ?? "").trim();
	return request ? `research:${request}` : "phase:unlabelled";
}

function exactEvidenceResourceRef(value: unknown): string {
	const reference = String(value ?? "").trim();
	if (/^[a-z_]+:[^@]+@v[1-9]\d*$/.test(reference)) return reference;
	if (/^(task-tool-use|subagent-use|skill-read|skill-projection|memory-projection|system-prompt-use)/.test(reference)) {
		return `harness_observation:${reference}@v1`;
	}
	return `observation:${reference}@v1`;
}

function contextsForEvidence(comparison: Row | undefined, evidenceRefs: string[]): string[] {
	const evidence = new Set(evidenceRefs.map(observationReferenceId));
	return unique([
		...((comparison?.outcome_contrasts ?? []).flatMap((group: Row) => group.cases ?? [])),
		...((comparison?.repeated_cases ?? []).flatMap((group: Row) => group.cases ?? [])),
	].filter((item: Row) => evidence.has(observationReferenceId(item.observation_ref)))
		.map((item: Row) => item.context_id));
}

function observationOutcome(row: Row): string {
	if (row.is_error) return "error";
	const state = row.arc_outcome ?? {};
	const transition = state.public_transition ?? {};
	if (transition.level_changed === true || state.state === "WIN") return "advanced";
	if (state.state === "GAME_OVER") return "game_over";
	if (row.input?.action === "RESET" || transition.reset === true) return "reset";
	if (Number(state.observation_delta?.changed_cells ?? state.changed_cells ?? 0) > 0) return "changed";
	return "completed_without_classified_progress";
}

function observationSignature(row: Row): string {
	const action = row.input?.action ?? row.input?.name ?? row.input?.request ?? "";
	return `${String(row.tool_name ?? row.tool ?? "unknown")}:${String(action)}`;
}

function actionUsesExactHarnessVersion(row: Row): boolean {
	const basisRefs = Array.isArray(row.input?.decision?.basis_refs)
		? row.input.decision.basis_refs.map(String) : [];
	return basisRefs.some((reference) =>
		/^(?:memory|system_prompt|skill|tool|subagent):[^@]+@v[1-9]\d*$/.test(reference));
}

function stableDigest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function contextAnnotations(observations: Row[]): Map<string, Row> {
	const result = new Map<string, Row>();
	let attempt = 1;
	let inferredLevel = 0;
	for (const row of observations) {
		const id = observationId(row);
		if (!id) continue;
		const transition = row.arc_outcome?.public_transition ?? {};
		const level = Number.isFinite(Number(transition.level_before))
			? Number(transition.level_before)
			: Number.isFinite(Number(row.arc_outcome?.levels_completed))
				? Number(row.arc_outcome.levels_completed) : inferredLevel;
		const episodeContextId = `level:${level}:attempt:${attempt}`;
		const outcome = observationOutcome(row);
		// New ARC observations carry a digest of the complete public state before
		// the action. Prefer that condition over the action's result: cross-context
		// induction concerns reuse under different starting conditions. Historical
		// records lack this field, so retain a labelled transition-based fallback.
		const preActionFingerprint = String(row.arc_outcome?.pre_action_state?.fingerprint ?? "").trim();
		const situationBasis = preActionFingerprint ? "pre_action_state" : "observable_transition_fallback";
		const situationFingerprint = preActionFingerprint || stableDigest({
			delta: observationDeltaFacts(row),
			changed_groups: changedGroupFacts(row) ?? null,
		});
		const situationContextId = [`level:${level}`, decisionPhase(row),
			`basis:${situationBasis}`, `condition:${situationFingerprint}`].join("|");
		const contextId = `${episodeContextId}|${situationContextId}`;
		result.set(id, {
			observation_ref: id,
			context_id: contextId,
			situation_context_id: situationContextId,
			episode_context_id: episodeContextId,
			tool_name: String(row.tool_name ?? row.tool ?? "unknown"),
			action_signature: observationSignature(row),
			outcome,
			effect_shape: effectShape(row),
			situation_basis: situationBasis,
			pre_action_state_fingerprint: preActionFingerprint || null,
			decision_phase: decisionPhase(row),
			recordedAt: row.recordedAt ?? null,
		});
		const success = transition.level_changed === true || row.arc_outcome?.state === "WIN";
		const reset = row.input?.action === "RESET" || transition.reset === true;
		const failure = row.arc_outcome?.state === "GAME_OVER";
		if (success) {
			inferredLevel = Number(transition.level_after ?? row.arc_outcome?.levels_completed ?? level + 1);
			attempt = 1;
		} else if (reset || failure) attempt += 1;
	}
	return result;
}

function evidenceCard(row: Row, annotation: Row, sequenceIndex: number, previous?: Row): Row {
	const state = row.arc_outcome ?? {};
	const changedGroups = changedGroupFacts(row);
	return {
		format: "auto-research-evidence-card-v1",
		observation_ref: annotation.observation_ref,
		sequence_index: sequenceIndex,
		context_id: annotation.context_id,
		episode_context_id: annotation.episode_context_id,
		tool_name: annotation.tool_name,
		action_signature: annotation.action_signature,
		input: {
			...(row.input?.action !== undefined ? { action: row.input.action } : {}),
			...(row.input?.request !== undefined ? { request: row.input.request } : {}),
		},
		public_result: {
			is_error: Boolean(row.is_error),
			outcome_class: annotation.outcome,
			effect_shape: annotation.effect_shape,
			...(state.state !== undefined ? { state: state.state } : {}),
			...(state.levels_completed !== undefined ? { levels_completed: state.levels_completed } : {}),
			...(state.public_transition ? { public_transition: state.public_transition } : {}),
			...(state.action_budget ? { action_budget: state.action_budget } : {}),
			observation_delta: observationDeltaFacts(row),
			...(changedGroups ? { changed_groups: changedGroups } : {}),
		},
		pre_action_condition: {
			basis: annotation.situation_basis,
			fingerprint: annotation.pre_action_state_fingerprint,
			...(row.arc_outcome?.pre_action_state?.resource_ref
				? { canonical_detail_ref: row.arc_outcome.pre_action_state.resource_ref } : {}),
			...(row.arc_outcome?.pre_action_state?.state !== undefined
				? { state: row.arc_outcome.pre_action_state.state } : {}),
			...(row.arc_outcome?.pre_action_state?.levels_completed !== undefined
				? { levels_completed: row.arc_outcome.pre_action_state.levels_completed } : {}),
			...(Array.isArray(row.arc_outcome?.pre_action_state?.available_actions)
				? { available_actions: row.arc_outcome.pre_action_state.available_actions } : {}),
		},
		...(previous ? { immediate_predecessor: {
			observation_ref: observationId(previous),
			tool_name: String(previous.tool_name ?? previous.tool ?? "unknown"),
			action_signature: observationSignature(previous),
			outcome_class: observationOutcome(previous),
			effect_shape: effectShape(previous),
		} } : {}),
		canonical_detail_ref: exactEvidenceResourceRef(annotation.observation_ref),
	};
}

/** Build a bounded, causal-neutral comparison bundle for one research line. */
export function buildCrossContextComparison(input: {
	researchLineRef?: string | null;
	observations: Row[];
	explicitEvidenceRefs?: string[];
	reports?: Row[];
	methods?: Row[];
	maximumCases?: number;
	recordedAt?: string;
}): Row {
	const maximumCases = Math.max(4, Math.floor(Number(input.maximumCases ?? 24) || 24));
	const annotations = contextAnnotations(input.observations);
	const byId = new Map(input.observations.map((row) => [observationId(row), row]).filter(([id]) => id));
	const explicit = unique(input.explicitEvidenceRefs ?? []).map(observationReferenceId)
		.filter((reference) => byId.has(reference));
	const relevantReports = (input.reports ?? []).filter((report) => !input.researchLineRef
		|| String(report.research_line_ref ?? "") === String(input.researchLineRef));
	const priorEvidence = unique(relevantReports.flatMap((report) => [
		...(report.evidence_refs ?? []), ...(report.report?.evidence_refs ?? []),
	])).map(observationReferenceId);
	const seeds = unique([...explicit, ...priorEvidence]).filter((reference) => byId.has(reference));
	const seedSignatures = new Set(seeds.map((reference) => observationSignature(byId.get(reference)!)));

	const comparisonPool = input.observations.filter((row) => seedSignatures.has(observationSignature(row)));
	const grouped = new Map<string, Row[]>();
	for (const row of comparisonPool) {
		const signature = observationSignature(row);
		grouped.set(signature, [...(grouped.get(signature) ?? []), row]);
	}
	const contrasts: Row[] = [];
	const repeated: Row[] = [];
	for (const [signature, rows] of grouped) {
		const outcomes = [...new Set(rows.map(observationOutcome))];
		const cases = rows.slice(-6).map((row) => annotations.get(observationId(row))).filter(Boolean);
		const entry = {
			action_signature: signature,
			outcomes,
			context_count: new Set(cases.map((item) => item!.context_id)).size,
			episode_context_count: new Set(cases.map((item) => item!.episode_context_id)).size,
			cases,
		};
		if (outcomes.length > 1) contrasts.push(entry);
		else if (cases.length > 1) repeated.push(entry);
	}

	const selected: string[] = [];
	const add = (reference: unknown) => {
		const id = String(reference ?? "");
		if (id && byId.has(id) && !selected.includes(id) && selected.length < maximumCases) selected.push(id);
	};
	for (const reference of seeds) add(reference);
	for (const group of contrasts) for (const item of group.cases) add(item?.observation_ref);
	for (const group of repeated) for (const item of group.cases) add(item?.observation_ref);

	const relevantMethods = (input.methods ?? []).filter((method) => !input.researchLineRef
		|| String(method.research_line_ref ?? "") === String(input.researchLineRef));
	const observationPositions = new Map(input.observations.map((row, index) => [observationId(row), index]));
	return {
		format: "auto-research-cross-context-comparison-v1",
		research_line_ref: input.researchLineRef ?? null,
		selection_policy: "exact_refs_grouped_by_runtime_context_and_action_signature",
		causal_interpretation: false,
		semantic_equivalence_claimed: false,
		explicit_evidence_refs: explicit,
		selected_evidence_refs: selected,
		pre_action_state_refs: unique(selected.map((reference) =>
			byId.get(reference)?.arc_outcome?.pre_action_state?.resource_ref)),
		context_ids: unique(selected.map((reference) => annotations.get(reference)?.context_id)),
		situation_context_ids: unique(selected.map((reference) => annotations.get(reference)?.situation_context_id)),
		episode_context_ids: unique(selected.map((reference) => annotations.get(reference)?.episode_context_id)),
		evidence_cards: selected.flatMap((reference) => {
			const row = byId.get(reference);
			const annotation = annotations.get(reference);
			const position = observationPositions.get(reference);
			if (!row || !annotation || position === undefined) return [];
			return [evidenceCard(row, annotation, position + 1,
				position > 0 ? input.observations[position - 1] : undefined)];
		}),
		outcome_contrasts: contrasts,
		repeated_cases: repeated,
		prior_research_refs: unique(relevantReports.flatMap((report) => [
			report.report_ref ?? "",
			report.run_id ? `research_run:${report.run_id}@v${Number(report.version ?? 1)}` : "",
		])),
		prior_method_refs: unique(relevantMethods.map((method) =>
			`method:${method.method_id}@v${Number(method.version ?? 1)}`)),
		instruction: "Compare these exact cases. The grouping is mechanical and does not prove a shared mechanism. Identify invariants, varying parameters, counterexamples and a future prediction before proposing a reusable method.",
		recordedAt: input.recordedAt ?? new Date().toISOString(),
	};
}

/** Detect bounded research opportunities without interpreting the task.
 *
 * A candidate exists only when the same exact action signature has observations
 * with at least two mechanically distinct observable transition signatures.
 * Episode or attempt identity alone never makes situations distinct. Intervening
 * successful environment actions are included as possible contrasts, but this
 * function never claims that they caused either outcome.  The parent remains
 * responsible for deciding whether to spend research budget on the candidate.
 */
export function buildCrossContextResearchCandidates(input: {
	observations: Row[];
	maximumCases?: number;
	recordedAt?: string;
}): Row[] {
	const maximumCases = Math.max(2, Math.floor(Number(input.maximumCases ?? 8) || 8));
	const observations = input.observations.filter((row) => observationId(row));
	const annotations = contextAnnotations(observations);
	const positions = new Map(observations.map((row, index) => [observationId(row), index]));
	const grouped = new Map<string, Row[]>();
	for (const row of observations) {
		if (row.is_error) continue;
		// Exact harness-driven actions already belong to that method's application
		// and feedback line. Re-indexing them as a new generic opportunity would
		// create a competing research identity for the same use evidence.
		if (actionUsesExactHarnessVersion(row)) continue;
		const signature = observationSignature(row);
		const action = String(row.input?.action ?? row.input?.name ?? row.input?.request ?? "").trim();
		// A callable action is required. Pure state reads and unlabelled tool events
		// do not constitute a repeatable method opportunity.
		if (!action || action === "RESET") continue;
		grouped.set(signature, [...(grouped.get(signature) ?? []), row]);
	}

	return [...grouped.entries()].flatMap(([signature, rows]) => {
		const cases = rows.map((row) => annotations.get(observationId(row))).filter(Boolean) as Row[];
		const situationIds = unique(cases.map((item) => item.situation_context_id));
		if (cases.length < 2 || situationIds.length < 2) return [];
		const boundedCases = cases.slice(-maximumCases);
		const situationBasis = boundedCases.every((item) => item.situation_basis === "pre_action_state")
			? "pre_action_state" : "observable_transition_fallback";
		const constructionRefs = unique(boundedCases.map((item) => item.observation_ref));
		const first = Math.min(...constructionRefs.map((reference) => positions.get(reference) ?? Number.MAX_SAFE_INTEGER));
		const last = Math.max(...constructionRefs.map((reference) => positions.get(reference) ?? -1));
		const interveningRefs = observations.slice(first + 1, last)
			.filter((row) => !row.is_error && observationSignature(row) !== signature
				&& String(row.input?.action ?? "") !== "RESET")
			.map(observationId).filter(Boolean).slice(-maximumCases);
		const evidenceRefs = unique([...constructionRefs, ...interveningRefs]);
		const candidateId = `cross-context-${stableDigest(signature)}`;
		const fingerprint = stableDigest({ signature, evidenceRefs, situationIds });
		return [{
			format: "auto-research-opportunity-v1",
			causal_interpretation: false,
			semantic_equivalence_claimed: false,
			situation_basis: situationBasis,
			candidate_id: candidateId,
			version: 1,
			fingerprint,
			status: "available",
			reason: "The same action signature has exact observations in distinct runtime situations.",
			action_signature: signature,
			construction_evidence_refs: constructionRefs,
			intervening_evidence_refs: interveningRefs,
			evidence_refs: evidenceRefs,
			situation_context_ids: situationIds,
			episode_context_ids: unique(boundedCases.map((item) => item.episode_context_id)),
			research_line_ref: `research_line:${candidateId}@v1`,
			research_call: {
				action: "start",
				research_candidate_ref: `research_candidate:${candidateId}@v1`,
			},
			research_parameters: {
				question: `Compare the exact ${signature} observations across their distinct situations. Determine whether they support a bounded reusable method, identify counterexamples, and return inconclusive if they do not.`,
				scope: "research_method",
				research_kind: "capability",
				research_line_ref: `research_line:${candidateId}@v1`,
				evidence_refs: evidenceRefs,
				constraints: [
					"Treat the grouping as mechanical evidence organization, not proof of one semantic mechanism.",
					"Compare invariants, varying parameters, alternatives and counterexamples before proposing a reusable method.",
					"State a future prediction and a visible falsifier for any proposed method; otherwise return an inconclusive report.",
				],
			},
			recordedAt: input.recordedAt ?? new Date().toISOString(),
		}];
	}).sort((left, right) => String(left.candidate_id).localeCompare(String(right.candidate_id)));
}

/** Project the durable comparison into a provider-facing view without repeating
 * facts already carried by evidence cards. The full bundle remains the audit and
 * lifecycle source of truth. This projection performs no semantic selection. */
export function crossContextComparisonForChild(comparison: Row): Row {
	const cards = Array.isArray(comparison.evidence_cards) ? comparison.evidence_cards : [];
	const group = (item: Row) => ({
		action_signature: item.action_signature,
		outcomes: item.outcomes,
		context_count: item.context_count,
		episode_context_count: item.episode_context_count,
		case_refs: unique((item.cases ?? []).map((entry: Row) => entry.observation_ref)),
	});
	return {
		format: "auto-research-cross-context-child-view-v1",
		research_line_ref: comparison.research_line_ref ?? null,
		selection_policy: comparison.selection_policy,
		causal_interpretation: false,
		semantic_equivalence_claimed: false,
		explicit_evidence_refs: comparison.explicit_evidence_refs ?? [],
		selected_evidence_refs: comparison.selected_evidence_refs ?? [],
		episode_context_ids: unique(cards.map((card: Row) => card.episode_context_id)),
		evidence_cards: cards,
		outcome_contrasts: (comparison.outcome_contrasts ?? []).map(group),
		repeated_cases: (comparison.repeated_cases ?? []).map(group),
		prior_research_refs: comparison.prior_research_refs ?? [],
		prior_method_refs: comparison.prior_method_refs ?? [],
		instruction: comparison.instruction,
	};
}

function methodSpecification(delivery: Row): Row | undefined {
	const value = delivery.method;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value;
}

/** Create initial immutable method records from a completed research report. */
export function methodRecordsFromReport(input: {
	runId: string;
	reportRef: string;
	researchLineRef?: string | null;
	report: Row;
	comparison?: Row;
	recordedAt?: string;
}): Row[] {
	const proposals = Array.isArray(input.report.harness_proposals) ? input.report.harness_proposals : [];
	const standalone = Array.isArray(input.report.method_candidates) ? input.report.method_candidates : [];
	const candidates = [
		...standalone.map((candidate: Row) => ({
			candidate_ref: candidate.candidate_ref,
			delivery: {
				delivery_id: candidate.proposed_delivery_id ?? null,
				semantic_kind: candidate.semantic_kind,
				name: candidate.name,
				basis_refs: candidate.basis_refs,
				method: candidate.method,
			},
			standalone: true,
		})),
		...proposals.map((proposal: Row) => ({ ...proposal, standalone: false })),
	];
	const seen = new Set<string>();
	const standaloneDeliveryIds = new Set(standalone.map((candidate: Row) => String(candidate.proposed_delivery_id ?? "")).filter(Boolean));
	return candidates.flatMap((proposal: Row, index: number) => {
		const delivery = proposal?.delivery;
		if (!delivery || !METHOD_KINDS.has(String(delivery.semantic_kind))) return [];
		if (!proposal.standalone && standaloneDeliveryIds.has(String(delivery.delivery_id ?? ""))) return [];
		const specification = methodSpecification(delivery);
		const identity = String(proposal.candidate_ref ?? `proposal-${index + 1}`);
		if (seen.has(identity)) return [];
		seen.add(identity);
		const methodId = proposal.standalone
			? `method-${input.runId}-${identity}`.replace(/[^a-zA-Z0-9-]/g, "-")
			: `method-${input.runId}-${index - standalone.length + 1}`.replace(/[^a-zA-Z0-9-]/g, "-");
		const constructionRefs = unique(specification?.construction_evidence_refs ?? delivery.basis_refs ?? []);
		const contrastRefs = unique(specification?.contrast_evidence_refs ?? []);
		const selected = new Set(input.comparison?.selected_evidence_refs ?? []);
		const reportEvidence = new Set((input.report.evidence_refs ?? []).map(observationReferenceId));
		const groundedConstructionRefs = constructionRefs.filter((reference) =>
			selected.has(observationReferenceId(reference)) || reportEvidence.has(observationReferenceId(reference)));
		const citedEvidenceRefs = unique([...groundedConstructionRefs, ...contrastRefs]);
		const contextIds = contextsForEvidence(input.comparison, citedEvidenceRefs);
		const cited = new Set(citedEvidenceRefs.map(observationReferenceId));
		const citedCases = [
			...((input.comparison?.outcome_contrasts ?? []).flatMap((group: Row) => group.cases ?? [])),
			...((input.comparison?.repeated_cases ?? []).flatMap((group: Row) => group.cases ?? [])),
		].filter((item: Row) => cited.has(observationReferenceId(item.observation_ref)));
		const episodeContextIds = unique(citedCases.map((item: Row) => item.episode_context_id));
		const maturity: MethodMaturity = specification && groundedConstructionRefs.length
			? "candidate_method" : "experience";
		return [{
			format: "task-method-lifecycle-v1",
			method_id: methodId,
			version: 1,
			status: "active",
			maturity,
			candidate_ref: proposal.candidate_ref ?? null,
			delivery_id: delivery.delivery_id ?? null,
			semantic_kind: delivery.semantic_kind,
			name: delivery.name,
			research_line_ref: input.researchLineRef ?? null,
			source_run_ref: `research_run:${input.runId}@v1`,
			source_report_ref: input.reportRef,
			method: specification ?? null,
			construction_evidence_refs: groundedConstructionRefs,
			contrast_evidence_refs: contrastRefs,
			context_ids: contextIds,
			generalization_basis: contextIds.length >= 2 ? "cross_context" : "single_context",
			generalization_scope: contextIds.length < 2 ? "single_situation"
				: episodeContextIds.length >= 2 ? "cross_episode" : "cross_situation_within_episode",
			episode_context_ids: episodeContextIds,
			resource_refs: [],
			application_refs: [],
			validation_refs: [],
			component_status: proposal.standalone
				? (delivery.delivery_id ? "proposed_separately" : "method_only") : "proposal_attached",
			maturity_reason: maturity === "candidate_method"
				? "Auto-Research supplied an explicit method structure grounded in selected evidence; future use is still required."
				: "The delivery lacks an explicit grounded method structure and remains task experience.",
			recordedAt: input.recordedAt ?? new Date().toISOString(),
		}];
	});
}

export function latestMethodRecords(records: Row[]): Map<string, Row> {
	const latest = new Map<string, Row>();
	for (const record of records) {
		const id = String(record.method_id ?? "");
		const previous = latest.get(id);
		if (id && (!previous || Number(record.version ?? 0) >= Number(previous.version ?? 0))) latest.set(id, record);
	}
	return latest;
}

export function advanceMethodApplication(method: Row, input: {
	resourceRefs: string[];
	applicationRef: string;
	recordedAt?: string;
}): Row {
	const prior = String(method.maturity ?? "experience") as MethodMaturity;
	const maturity: MethodMaturity = prior === "candidate_method" ? "trial" : prior;
	return {
		...method,
		version: Number(method.version ?? 1) + 1,
		maturity,
		resource_refs: unique([...(method.resource_refs ?? []), ...input.resourceRefs]),
		application_refs: unique([...(method.application_refs ?? []), input.applicationRef]),
		maturity_reason: maturity === "trial"
			? "The candidate was materialized for bounded future use; application does not validate it."
			: method.maturity_reason,
		recordedAt: input.recordedAt ?? new Date().toISOString(),
	};
}

export function advanceMethodAssessment(method: Row, input: {
	verdict: "supported" | "unsupported" | "inconclusive";
	assessmentRef: string;
	observationRefs: string[];
	actualUseRefs: string[];
	recordedAt?: string;
}): Row {
	const actualUse = unique(input.actualUseRefs);
	let maturity = String(method.maturity ?? "experience") as MethodMaturity;
	let reason = method.maturity_reason;
	if (input.verdict === "unsupported" && actualUse.length) {
		maturity = "contradicted";
		reason = "An agent assessment linked a failed semantic expectation to an actual later use.";
	} else if (input.verdict === "supported" && actualUse.length) {
		maturity = "validated_within_scope";
		reason = "An agent assessment linked the expected semantic result to an actual later use; validation remains limited to the recorded scope.";
	} else if (["candidate_method", "experience"].includes(maturity) && method.resource_refs?.length) {
		maturity = "trial";
		reason = "Only creation, exposure, reading, or inconclusive evidence exists; actual-use validation is still pending.";
	}
	return {
		...method,
		version: Number(method.version ?? 1) + 1,
		maturity,
		validation_refs: unique([...(method.validation_refs ?? []), input.assessmentRef]),
		actual_use_observation_refs: unique([...(method.actual_use_observation_refs ?? []), ...actualUse]),
		latest_assessment: { verdict: input.verdict, observation_refs: unique(input.observationRefs), actual_use_refs: actualUse },
		maturity_reason: reason,
		recordedAt: input.recordedAt ?? new Date().toISOString(),
	};
}

/** Create a normal Auto-Research handoff after a trial receives real-use feedback. */
export function buildMethodFeedbackHandoff(method: Row, assessment: Row): Row | undefined {
	const actualUseRefs = unique(method.actual_use_observation_refs ?? []);
	if (!actualUseRefs.length || !method.research_line_ref) return undefined;
	const handoffId = `method-feedback-${assessment.effect_assessment_id}`;
	const methodRef = `method:${method.method_id}@v${Number(method.version ?? 1)}`;
	const assessmentRef = `effect_assessment:${assessment.effect_assessment_id}@v1`;
	const evidenceRefs = unique([
		...(method.construction_evidence_refs ?? []), ...(method.contrast_evidence_refs ?? []),
		...(assessment.observation_refs ?? []), ...actualUseRefs,
	]).map(exactEvidenceResourceRef);
	const readyCall = { action: "start", research_handoff_ref: `research_handoff:${handoffId}@v1` };
	return {
		format: "method-feedback-auto-research-handoff-v1",
		handoff_id: handoffId,
		version: 1,
		status: "proposed",
		research_line_ref: method.research_line_ref,
		research_problem: {
			kind: "capability", status: "unresolved",
			statement: `Revise or confirm method ${method.name} from its later actual-use result.`,
			prior_research_refs: unique([method.source_run_ref, method.source_report_ref]),
		},
		question: [
			`Method ${method.name} was constructed in ${method.source_report_ref} and later used with evidence ${JSON.stringify(actualUseRefs)}.`,
			`The parent assessed the result as ${assessment.verdict}: ${assessment.consequence}.`,
			"Compare the construction cases, prior contrasts and this later use. Decide which invariants, parameters, steps, applicability limits or failure modes need confirmation, narrowing, revision or retirement. Do not treat one successful use as broad transfer proof.",
		].join("\n\n"),
		completion_contract: "Return a supported, contradicted or inconclusive assessment of the method within an explicit scope; compare predicted and actual semantic output, preserve counterexamples, and provide a revised method candidate only when the evidence supports a concrete change.",
		completion_contract_kind: "method_feedback_evaluation",
		evidence_refs: evidenceRefs,
		resource_refs: unique([methodRef, method.source_run_ref, method.source_report_ref, assessmentRef]),
		inherit_harness_refs: unique(method.resource_refs ?? []),
		constraints: [
			"Creation, exposure and reading are not validation.",
			"A successful local use validates only the declared scope.",
			"The child cannot execute environment actions; request a parent experiment if another discriminating case is needed.",
		],
		scope: "research_method",
		context_window: { include_checkpoint: true, recent_observations: 20, recent_actions: 10,
			context_refs: evidenceRefs, max_chars: 20_000 },
		method_ref: methodRef,
		effect_assessment_ref: assessmentRef,
		interaction_mode_policy: "parent_choice_required",
		interaction_mode_options: ["blocking", "non_blocking"],
		ready_call: readyCall,
		ready_calls: {
			blocking: { ...readyCall, interaction_mode: "blocking" },
			non_blocking: { ...readyCall, interaction_mode: "non_blocking" },
		},
		recordedAt: new Date().toISOString(),
	};
}
