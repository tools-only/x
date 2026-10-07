/** Lossless structured projection helpers for Auto-Research output. */
import { assessMethodAbstraction, normalizeMethodSpecification } from "./pi_auto_research_harness_router.ts";
import { normalizeResearchProgress } from "./pi_auto_research_agenda.ts";
import { normalizeCandidateUpdates } from "./pi_task_strategy_state.ts";
import { baselineMethodCatalog, creatorForHarnessKind, researchAuthoringPrerequisite } from "./pi_harness_baseline_methods.ts";
import { arcActionCoordinates } from "./pi_arc_action_input.ts";

const ASSESSMENT_DIMENSIONS = new Set(["explanation", "method_correctness", "method_utility"]);
const ASSESSMENT_VERDICTS = new Set(["supported", "contradicted", "inconclusive"]);
const ASSESSMENT_EVIDENCE_KINDS = new Set([
	"historical_observation", "local_execution", "new_environment_transition",
]);

const REPORT_STATUSES = new Set([
	"provisional", "supported_within_scope", "inconclusive", "contradicted", "unresolved",
]);

function normalizedText(value: unknown): string {
	return String(value ?? "").trim();
}

function normalizedList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => normalizedText(item)).filter(Boolean);
}

function normalizeFindingAssessment(value: unknown): Record<string, any> | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("finding.assessment must be an object");
	}
	const assessment = value as Record<string, any>;
	const targetRef = normalizedText(assessment.target_ref);
	const dimension = normalizedText(assessment.dimension);
	const verdict = normalizedText(assessment.verdict);
	const scope = normalizedText(assessment.scope);
	const evidenceKind = normalizedText(assessment.evidence_kind);
	if (!targetRef) throw new Error("finding.assessment.target_ref is required");
	if (!ASSESSMENT_DIMENSIONS.has(dimension)) throw new Error("finding.assessment.dimension is invalid");
	if (!ASSESSMENT_VERDICTS.has(verdict)) throw new Error("finding.assessment.verdict is invalid");
	if (!scope) throw new Error("finding.assessment.scope is required");
	if (!ASSESSMENT_EVIDENCE_KINDS.has(evidenceKind)) throw new Error("finding.assessment.evidence_kind is invalid");
	const effectRef = normalizedText(assessment.effect_assessment_ref);
	if (dimension === "method_utility" && !effectRef) {
		throw new Error("method_utility assessment requires effect_assessment_ref");
	}
	if (effectRef && !normalizedText(effectRef)) throw new Error("effect_assessment_ref must be nonempty");
	return {
		target_ref: targetRef, dimension, verdict, scope, evidence_kind: evidenceKind,
		...(effectRef ? { effect_assessment_ref: effectRef } : {}),
	};
}

function normalizeExperimentRequest(value: unknown): Record<string, any> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const request = value as Record<string, any>;
	return {
		...(normalizedText(request.request_ref) ? { request_ref: normalizedText(request.request_ref) } : {}),
		...(normalizedText(request.as_of_event) ? { as_of_event: normalizedText(request.as_of_event) } : {}),
		objective: normalizedText(request.objective),
		prerequisites: normalizedList(request.prerequisites),
		parent_action: normalizedText(request.parent_action),
		...(normalizedText(request.suggested_next_action) ? { suggested_next_action: normalizedText(request.suggested_next_action) } : {}),
		...(Number.isInteger(request.requested_max_actions) && Number(request.requested_max_actions) > 0 ? { requested_max_actions: Number(request.requested_max_actions) } : {}),
		predicted_outcomes: (Array.isArray(request.predicted_outcomes) ? request.predicted_outcomes : []).flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			return [{
				condition: normalizedText(item.condition),
				expected_observation: normalizedText(item.expected_observation),
				implication: normalizedText(item.implication),
			}];
		}),
		falsifier: normalizedText(request.falsifier),
		expected_information_gain: normalizedText(request.expected_information_gain),
		action_cost: normalizedText(request.action_cost),
		stop_condition: normalizedText(request.stop_condition),
		evidence_refs: normalizedList(request.evidence_refs),
	};
}

/** Bind a child-authored experiment request to the parent research run. The
 * child may omit identity because it cannot know the runtime run id; the
 * parent assigns it before the report enters the main-agent inbox. */
export function bindExperimentRequest(
	report: Record<string, any>,
	runId: string,
	evidenceRefs: string[] = [],
): Record<string, any> {
	const request = report.experiment_request;
	if (!request || typeof request !== "object") return report;
	return {
		...report,
		experiment_request: {
			...request,
			request_ref: String(request.request_ref ?? `research-experiment:${runId}`),
			as_of_event: String(request.as_of_event ?? evidenceRefs.at(-1) ?? `research-run:${runId}`),
		},
	};
}

function normalizeConfidenceUpdate(value: unknown): Record<string, any> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const update = value as Record<string, any>;
	return {
		disposition: normalizedText(update.disposition),
		target_ref: normalizedText(update.target_ref),
		experiment_ref: normalizedText(update.experiment_ref),
		previous: normalizedText(update.previous),
		current: normalizedText(update.current),
		basis: normalizedText(update.basis),
		reason: normalizedText(update.reason),
		evidence_refs: normalizedList(update.evidence_refs),
	};
}

function normalizePlanningImplications(value: unknown): Record<string, any>[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const implication = item as Record<string, any>;
		return [{
			decision_context: normalizedText(implication.decision_context),
			implication: normalizedText(implication.implication ?? implication.decision),
			...(normalizedText(implication.rationale) ? { rationale: normalizedText(implication.rationale) } : {}),
			applicability: normalizedText(implication.applicability),
			evidence_refs: normalizedList(implication.evidence_refs),
			reconsider_when: normalizedText(implication.reconsider_when ?? implication.reconsider_condition ?? implication.reconsideration_condition),
		}];
	});
}

/** Reuse delivers the existing actionable core; no new research or adoption is implied. */
export function researchActionContinuation(report: Record<string, any>, reportRef: string,
	observations: Record<string, any>[] = [], reportedAt?: string): Record<string, any> {
	const progress = report.research_progress;
	const proposal = {
		...(progress?.parent_relevance === "now" && progress.next_step ? { next_step: progress.next_step } : {}),
		...(report.experiment_request ? { next_experiment: report.experiment_request } : {}),
		...(report.planning_implications?.length ? { planning_implications: report.planning_implications } : {}),
	};
	const cutoff = String(report.experiment_request?.as_of_event ?? "").replace(/^observation:/, "").replace(/@v\d+$/, "");
	const cutoffIndex = cutoff ? observations.findIndex(row => row.observation_id === cutoff) : -1;
	const reportedTime = reportedAt ? Date.parse(reportedAt) : NaN;
	const later = observations.filter((row, index) => !row.is_error && row.tool_name === "arc_action"
		&& (Number.isFinite(reportedTime) ? Date.parse(row.recordedAt) > reportedTime : cutoffIndex >= 0 && index > cutoffIndex));
	const candidateIds = new Set((report.candidate_updates ?? []).map((candidate: Record<string, any>) => candidate.id)
		.filter((id: unknown) => typeof id === "string" && id.length > 0));
	const requestRef = report.experiment_request?.request_ref;
	const linked = later.filter(row => {
		const decision = row.input?.decision;
		return decision && (candidateIds.has(decision.hypothesis_id) || candidateIds.has(decision.selection?.candidate_id)
			|| Boolean(requestRef && decision.research_request_ref === requestRef));
	});
	const receipts = [...new Map([...(linked.length ? [linked[0]] : []), ...later.slice(-3)]
		.map(row => [row.observation_id, row])).values()].map(row => ({
		observation_ref: `observation:${row.observation_id}@v${row.version ?? 1}`,
		action: row.input?.action, ...arcActionCoordinates(row.input),
		...(arcActionCoordinates(row.input) ? {target_cell:row.arc_outcome?.action_target_cell} : {}),
		changed_cells: row.arc_outcome?.observation_delta?.changed_cells,
		level_changed: row.arc_outcome?.public_transition?.level_changed ?? null,
		level_after: row.arc_outcome?.public_transition?.level_after ?? row.arc_outcome?.levels_completed ?? null,
	}));
	return { report_ref: reportRef, epistemic_status: linked.length
		? "parent_candidate_linked_action_executed_not_semantically_validated" : "child_proposal_not_verified_or_adopted",
		...(linked.length ? { previous_proposal: proposal } : proposal),
		...(later.length ? { followup_evidence: { action_count: later.length, linked_action_count: linked.length,
			receipts, omitted_receipt_count: Math.max(0,later.length-receipts.length),
			meaning: "Later environment evidence; linkage is an explicit parent candidate/request reference, not proof that the report or goal is correct." } } : {}),
		limitations: (report.limitations ?? []).slice(0, 3),
		decision_boundary: linked.length
			? "The parent has already acted on a candidate/request from this report. Its earlier probe is previous work, not a fresh next step. Reassess with the later receipts and remaining goal uncertainty; local pixel effects do not validate a target."
			: "Compare this existing proposal and its evidence cutoff with the current observation. Choose a concrete discriminating action, revise/reject it with evidence, or seek a specific missing fact. Repeating start with unchanged materials produces no new evidence; research completion is not an environment result." };
}

function normalizeMethodCandidates(value: unknown): Record<string, any>[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const candidate = item as Record<string, any>;
		const method = normalizeMethodSpecification(candidate.method);
		if (!method) return [];
		const quality = assessMethodAbstraction(method);
		const candidateRef = normalizedText(candidate.candidate_ref);
		const name = normalizedText(candidate.name);
		const semanticKind = normalizedText(candidate.semantic_kind);
		if (!candidateRef || !name || !["procedure", "computation", "plan", "role"].includes(semanticKind)) {
			throw new Error("method candidate requires candidate_ref, name, and a method semantic_kind");
		}
		return [{
			candidate_ref: candidateRef, name, semantic_kind: semanticKind,
			summary: normalizedText(candidate.summary), basis_refs: normalizedList(candidate.basis_refs), method,
			quality_advisory: quality,
			...(normalizedText(candidate.proposed_delivery_id)
				? { proposed_delivery_id: normalizedText(candidate.proposed_delivery_id) } : {}),
		}];
	});
}

export function normalizeAutoResearchReport(input: unknown): Record<string, any> {
	const report = input && typeof input === "object" && !Array.isArray(input)
		? input as Record<string, any> : {};
	const status = normalizedText(report.status);
	const findings = Array.isArray(report.findings) ? report.findings : [];
	const proposals = Array.isArray(report.harness_proposals) ? report.harness_proposals : [];
	const experimentRequest = normalizeExperimentRequest(report.experiment_request);
	const rawConfidenceUpdate = Object.prototype.hasOwnProperty.call(report, "confidence_update")
		? report.confidence_update : report.confidence_update_unparsed?.raw;
	const confidenceUpdate = normalizeConfidenceUpdate(rawConfidenceUpdate);
	const planningImplications = normalizePlanningImplications(report.planning_implications);
	const explicitMethodCandidates = normalizeMethodCandidates(report.method_candidates);
	const researchProgress = normalizeResearchProgress(report.research_progress);
	const candidateUpdates = normalizeCandidateUpdates(report.candidate_updates);
	const migratedMethodCandidates = proposals.flatMap((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const raw = item.format === "auto-research-harness-delivery-v1" ? item : item.delivery;
		if (!raw?.method || !["procedure", "computation", "plan", "role"].includes(String(raw.semantic_kind))) return [];
		return normalizeMethodCandidates([{
			candidate_ref: normalizedText(item.candidate_ref) || `method-candidate-${index + 1}`,
			name: raw.name, semantic_kind: raw.semantic_kind, summary: raw.summary,
			basis_refs: raw.basis_refs, method: raw.method, proposed_delivery_id: raw.delivery_id,
		}]);
	});
	const explicitRefs = new Set(explicitMethodCandidates.map((candidate) => candidate.candidate_ref));
	const explicitDeliveryIds = new Set(explicitMethodCandidates
		.map((candidate) => normalizedText(candidate.proposed_delivery_id)).filter(Boolean));
	const methodCandidates = [...explicitMethodCandidates,
		...migratedMethodCandidates.filter((candidate) => !explicitRefs.has(candidate.candidate_ref)
			&& (!candidate.proposed_delivery_id || !explicitDeliveryIds.has(candidate.proposed_delivery_id)))];
	const normalized: Record<string, any> = {
		format: "auto-research-report-v1",
		status: REPORT_STATUSES.has(status) ? status : "unresolved",
		conclusion: normalizedText(report.conclusion),
		findings: findings.flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			const assessment = normalizeFindingAssessment(item.assessment);
			return [{
				subject_kind: normalizedText(item.subject_kind),
				question: normalizedText(item.question),
				conclusion: normalizedText(item.conclusion),
				evidence_refs: normalizedList(item.evidence_refs),
				uncertainty: normalizedText(item.uncertainty),
				...(assessment ? { assessment } : {}),
			}];
		}),
		evidence_refs: normalizedList(report.evidence_refs),
		alternatives: normalizedList(report.alternatives),
		limitations: normalizedList(report.limitations),
		validation_plan: normalizedText(report.validation_plan),
		planning_implications: planningImplications,
		candidate_updates: candidateUpdates,
		method_candidates: methodCandidates,
		next_research_question: normalizedText(report.next_research_question),
		...(researchProgress ? { research_progress: researchProgress } : {}),
		...(experimentRequest ? { experiment_request: experimentRequest } : {}),
		...(confidenceUpdate ? { confidence_update: confidenceUpdate } : {}),
		// Auto-Research is a read-only epistemic subsystem. Historical reports may
		// contain the former child-authored delivery shape; its explicit method was
		// migrated above, but no materializable body crosses this boundary.
		harness_proposals: [],
		...(proposals.length ? { boundary_violations: [{
			code: "child_component_authoring_forbidden",
			count: proposals.length,
			disposition: "method_metadata_migrated_when_present; component_body_discarded",
		}] } : {}),
	};
	if (rawConfidenceUpdate !== undefined) {
		try {
			if (!confidenceUpdate) throw new Error("confidence_update must be a structured object");
			assertResearchConfidenceUpdate(normalized);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			delete normalized.confidence_update;
			normalized.confidence_update_unparsed = { raw: rawConfidenceUpdate, warning: message };
			normalized.warnings = [{ code: "confidence_update_not_applied", message }];
		}
	}
	return normalized;
}

export function assertResearchAssessmentReferences(
	report: Record<string, any>,
	resolveEffectAssessment: (reference: string) => Record<string, any> | undefined,
): void {
	for (const finding of Array.isArray(report.findings) ? report.findings : []) {
		const assessment = finding?.assessment;
		if (!assessment || assessment.dimension !== "method_utility") continue;
		const reference = String(assessment.effect_assessment_ref ?? "").trim();
		const effect = reference ? resolveEffectAssessment(reference) : undefined;
		if (!effect) throw new Error(`unknown effect assessment reference: ${reference}`);
		// The existing effect ledger is keyed by decision_id, while a finding
		// target is normally an exact resource version. Preserve both references
		// without guessing a semantic mapping the runtime cannot prove.
		if (!String(effect.effect_assessment_id ?? "").trim()) {
			throw new Error(`effect assessment ${reference} has no stable identifier`);
		}
	}
}

export function assertResearchConfidenceUpdate(report: Record<string, any>): void {
	const update = report.confidence_update as Record<string, any> | undefined;
	if (!update) return;
	if (!["increase", "decrease", "unchanged"].includes(String(update.disposition))) {
		throw new Error("confidence_update.disposition must be increase, decrease or unchanged");
	}
	const allowedIncreaseBasis = new Set([
		"new_environment_evidence", "resolved_counterexample", "completed_discriminating_experiment",
	]);
	if (update.disposition !== "increase") return;
	if (!allowedIncreaseBasis.has(String(update.basis))) {
		throw new Error("confidence cannot increase from agreement, completion or analysis alone");
	}
	if (!Array.isArray(update.evidence_refs) || !update.evidence_refs.length) {
		throw new Error("confidence increase requires cited evidence_refs");
	}
	const cited = new Set([
		...(Array.isArray(report.evidence_refs) ? report.evidence_refs.map(String) : []),
		...(Array.isArray(report.findings) ? report.findings.flatMap((finding: Record<string, any>) =>
			Array.isArray(finding?.evidence_refs) ? finding.evidence_refs.map(String) : []) : []),
	]);
	const unlinked = update.evidence_refs.filter((reference: string) => !cited.has(String(reference)));
	if (unlinked.length) throw new Error(`confidence increase evidence is not linked to report evidence: ${unlinked.join(", ")}`);
}

export function assertHarnessProposalEvidenceLinks(report: Record<string, any>): void {
	const reportEvidenceRefs = new Set([
		...(Array.isArray(report.evidence_refs) ? report.evidence_refs.map(String) : []),
		...(Array.isArray(report.findings) ? report.findings.flatMap((finding: Record<string, any>) =>
			Array.isArray(finding?.evidence_refs) ? finding.evidence_refs.map(String) : []) : []),
	]);
	const progressRefs = Array.isArray(report.research_progress?.evidence_refs)
		? report.research_progress.evidence_refs.map(String) : [];
	const unlinkedProgressRefs = progressRefs.filter((reference: string) => !reportEvidenceRefs.has(reference));
	if (unlinkedProgressRefs.length) {
		throw new Error(`research progress evidence is not linked to report findings/evidence: ${unlinkedProgressRefs.join(", ")}`);
	}
	for (const candidate of Array.isArray(report.method_candidates) ? report.method_candidates : []) {
		const refs = Array.isArray(candidate?.basis_refs) ? candidate.basis_refs.map(String) : [];
		const methodRefs = [
			...(candidate?.method?.construction_evidence_refs ?? []),
			...(candidate?.method?.contrast_evidence_refs ?? []),
		].map(String);
		const unlinked = [...new Set([...refs, ...methodRefs])].filter((reference) => !reportEvidenceRefs.has(reference));
		if (unlinked.length) throw new Error(`method candidate evidence is not linked to report findings/evidence: ${unlinked.join(", ")}`);
	}
}

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9-]/g, "-");
}

export function researchMethodResourceRef(runId: string, candidateRef: string): string {
	return `method:${safeId(`method-${runId}-${candidateRef}`)}@v1`;
}

/** Build an intentionally non-executable handoff. It exposes research input and
 * the creator gate, but leaves every semantic component field to the parent. */
export function buildParentAuthoringHandoffs(input: {
	runId: string; reportRef: string; researchLineRef?: string; report: unknown;
}): Record<string, any>[] {
	const report = normalizeAutoResearchReport(input.report);
	return report.method_candidates.flatMap((candidate: Record<string, any>) => {
		// Applicability scope does not decide the component kind. A method limited
		// to one situation may still be a Skill when it teaches a procedure rather
		// than replaying the source trajectory.
		const componentKind = ({ procedure: "skill", computation: "tool", role: "subagent", plan: "system_prompt" } as Record<string, string>)[candidate.semantic_kind];
		if (!componentKind) return [];
		const creatorName = componentKind === "system_prompt" ? undefined
			: creatorForHarnessKind(componentKind as "skill" | "tool" | "subagent");
		const creator = creatorName ? baselineMethodCatalog().find((item) => item.name === creatorName) : undefined;
		if (creatorName && !creator) throw new Error(`missing baseline creator: ${String(creatorName)}`);
		const methodRef = researchMethodResourceRef(input.runId, candidate.candidate_ref);
		const handoffId = safeId(`${input.runId}-${candidate.candidate_ref}-${componentKind}`);
		const required = componentKind === "system_prompt"
			? ["scope", "content/strategy policy with applicability and reconsideration"]
			: componentKind === "skill"
			? ["description/use trigger", "instructions/procedural body"]
			: componentKind === "tool"
				? ["description", "input_schema", "program or implementation_ref", "output_schema when required by the program"]
				: ["description/use trigger", "instructions/role contract", "tools (an empty array is valid)"];
		return [{
			format: "parent-capability-authoring-handoff-v1",
			handoff_id: handoffId, version: 1,
			resource_ref: `authoring_handoff:${handoffId}@v1`,
			status: "awaiting_parent_authoring",
			source: {
				research_run_ref: `research_run:${input.runId}@v1`, report_ref: input.reportRef,
				...(input.researchLineRef ? { research_line_ref: input.researchLineRef } : {}),
				method_candidate_ref: candidate.candidate_ref, method_ref: methodRef,
			},
			recommended_component_kind: componentKind,
			candidate_summary: candidate.summary,
			quality_advisory: candidate.quality_advisory,
			...(creator ? { creator: {
				name: creator.name, method_ref: creator.method_ref, sha256: creator.sha256,
				read_call: { name: "task_harness", arguments: {
					action: "read_method", method_name: creator.name, expected_sha256: creator.sha256,
				} },
			} } : {}),
			authoring_contract: {
				owner: "parent_agent", runtime_role: "validate_version_assemble_record_only",
				creator_read_required: Boolean(creator), parent_authored_body_required: true,
				research_is_input_not_component: true, required_parent_authored_fields: required,
			},
			change_call_template: {
				name: "task_harness", executable: false,
				arguments: { action: "change", changes: [{ operation: "create", candidate_seed: {
					semantic_kind: candidate.semantic_kind, name: candidate.name,
					basis_refs: [input.reportRef, methodRef],
				} }], decision_seed: { basis_refs: [input.reportRef, methodRef] } },
				required_before_execution: [
					...(creator ? ["Read creator.read_call as the parent Agent."] : []),
					"Author the component-specific executable candidate body for the stated scope; method quality metadata is optional.",
					"Replace candidate_seed with candidate and provide decision.reason plus decision.expected.",
					...(creator ? ["Pass the exact creator method_ref as candidate.authoring_method_ref."] : []),
				],
			},
			recordedAt: new Date().toISOString(),
		}];
	});
}

export function buildAutoResearchCapsule(input: {
	runId: string;
	sessionRef: string;
	status: string;
	scope: string;
	reportRef: string;
	researchLineRef?: string;
	researchProblem?: Record<string, any>;
	report: unknown;
	usage?: Record<string, any>;
	parentAuthoringHandoffs?: Record<string, any>[];
}): Record<string, any> {
	const report = normalizeAutoResearchReport(input.report);
	return {
		format: "auto-research-capsule-v1",
		resource_ref: `research_run:${input.runId}@v1`,
		detail_ref: input.reportRef,
		session_ref: input.sessionRef,
		run_id: input.runId,
		status: input.status,
		scope: input.scope,
		...(input.researchLineRef ? { research_line_ref: input.researchLineRef } : {}),
		followup_template: {name:"auto_research", arguments:{action:"start",
			authoring_method_ref:researchAuthoringPrerequisite().authoring_method_ref,
			...(input.researchLineRef ? {research_line_ref:input.researchLineRef} : {}),
			resource_refs:[input.reportRef]}, required_agent_fields:["question","interaction_mode"]},
		...(input.researchProblem ? { research_problem: input.researchProblem } : {}),
		summary: report.conclusion,
		key_findings: report.findings.map((finding: Record<string, any>) => ({
			subject_kind: finding.subject_kind,
			conclusion: finding.conclusion,
			evidence_refs: finding.evidence_refs,
		})),
		evidence_refs: report.evidence_refs,
		next_test: report.validation_plan,
		...(report.experiment_request ? { next_experiment: report.experiment_request } : {}),
		...(report.confidence_update ? { confidence_update: report.confidence_update } : {}),
		...(report.warnings?.length ? { warnings: report.warnings } : {}),
		planning_implications: report.planning_implications,
		...(report.candidate_updates.length ? { candidate_updates: report.candidate_updates.slice(0, 3).map((item: Record<string, any>) => ({
			id: item.id, kind: item.kind, status: item.status,
			claim: item.claim.slice(0, 120), detail_ref: input.reportRef,
		})), omitted_candidate_updates: Math.max(0, report.candidate_updates.length - 3) } : {}),
		...(report.research_progress ? { research_progress: report.research_progress } : {}),
		next_research_question: report.next_research_question,
		limitations: report.limitations,
		method_candidates: report.method_candidates,
		parent_authoring_handoffs: input.parentAuthoringHandoffs ?? buildParentAuthoringHandoffs({
			runId: input.runId, reportRef: input.reportRef, researchLineRef: input.researchLineRef, report,
		}),
		...(report.boundary_violations ? { boundary_violations: report.boundary_violations } : {}),
		usage: {
			input: Number(input.usage?.input ?? 0),
			output: Number(input.usage?.output ?? 0),
			cacheRead: Number(input.usage?.cacheRead ?? 0),
			cacheWrite: Number(input.usage?.cacheWrite ?? 0),
		},
		authoring: "No child-side component creation or mutation occurred. A parent_authoring_handoff is only input to a later parent turn: read its creator, author the complete body, submit task_harness(action=change), then explicitly assemble and use the returned exact version. Runtime never turns research prose into a component.",
	};
}

export function capAutoResearchReportRequest(
	payload: Record<string, any>,
	_configured?: unknown,
): Record<string, any> {
	// Output governance is performed by report normalization and sparse storage;
	// do not impose a locally chosen token ceiling at the provider boundary.
	return { ...payload };
}
