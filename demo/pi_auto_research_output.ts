/** Lossless structured projection helpers for Auto-Research output. */
import { normalizeHarnessDelivery, normalizeMethodSpecification, type HarnessRoutePlan } from "./pi_auto_research_harness_router.ts";

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
			implication: normalizedText(implication.implication),
			applicability: normalizedText(implication.applicability),
			evidence_refs: normalizedList(implication.evidence_refs),
			reconsider_when: normalizedText(implication.reconsider_when),
		}];
	});
}

function normalizeMethodCandidates(value: unknown): Record<string, any>[] {
	return (Array.isArray(value) ? value : []).flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const candidate = item as Record<string, any>;
		const method = normalizeMethodSpecification(candidate.method);
		if (!method) return [];
		const candidateRef = normalizedText(candidate.candidate_ref);
		const name = normalizedText(candidate.name);
		const semanticKind = normalizedText(candidate.semantic_kind);
		if (!candidateRef || !name || !["procedure", "computation", "plan", "role"].includes(semanticKind)) {
			throw new Error("method candidate requires candidate_ref, name, and a method semantic_kind");
		}
		return [{
			candidate_ref: candidateRef, name, semantic_kind: semanticKind,
			summary: normalizedText(candidate.summary), basis_refs: normalizedList(candidate.basis_refs), method,
			...(normalizedText(candidate.proposed_delivery_id)
				? { proposed_delivery_id: normalizedText(candidate.proposed_delivery_id) } : {}),
		}];
	});
}

function isIsolatableImplementationError(message: string): boolean {
	return message.startsWith("computation program")
		|| message.startsWith("computation delivery requires program or implementation_ref")
		|| message.startsWith("pure_computation program cannot contain adapter_call");
}

export function normalizeAutoResearchReport(input: unknown): Record<string, any> {
	const report = input && typeof input === "object" && !Array.isArray(input)
		? input as Record<string, any> : {};
	const status = normalizedText(report.status);
	const findings = Array.isArray(report.findings) ? report.findings : [];
	const proposals = Array.isArray(report.harness_proposals) ? report.harness_proposals : [];
	const experimentRequest = normalizeExperimentRequest(report.experiment_request);
	const confidenceUpdate = normalizeConfidenceUpdate(report.confidence_update);
	const planningImplications = normalizePlanningImplications(report.planning_implications);
	const explicitMethodCandidates = normalizeMethodCandidates(report.method_candidates);
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
	return {
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
		method_candidates: methodCandidates,
		next_research_question: normalizedText(report.next_research_question),
		...(experimentRequest ? { experiment_request: experimentRequest } : {}),
		...(confidenceUpdate ? { confidence_update: confidenceUpdate } : {}),
		harness_proposals: proposals.flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			const directDelivery = item.format === "auto-research-harness-delivery-v1" ? item : undefined;
			// The child may submit the compact approval-only form after the
			// complete delivery has been bound in its approval ledger. The child
			// submit handler hydrates that body before calling this normalizer;
			// preserve absence here so the same normalizer can also be used by
			// parent-side capsule parsing without inventing or truncating content.
			let delivery;
			let proposalError = "";
			try {
				delivery = directDelivery
					? normalizeHarnessDelivery(directDelivery)
					: item.delivery === undefined ? undefined : normalizeHarnessDelivery(item.delivery);
			} catch (error) {
				proposalError = error instanceof Error ? error.message : String(error);
				if (!isIsolatableImplementationError(proposalError)) throw error;
			}
			return [{
				...(item.candidate_ref ? { candidate_ref: normalizedText(item.candidate_ref) } : {}),
				...(item.approval_id ? { approval_id: normalizedText(item.approval_id) } : {}),
				...(item.approval_version !== undefined ? { approval_version: Number(item.approval_version) } : {}),
				...(item.approval_status ? { approval_status: normalizedText(item.approval_status) } : {}),
				...(item.approval_tag ? { approval_tag: normalizedText(item.approval_tag) } : {}),
				...(delivery ? { delivery } : {}),
				...(proposalError ? {
					proposal_status: "pending_implementation",
					proposal_error: proposalError,
					delivery_id: normalizedText((directDelivery ?? item.delivery)?.delivery_id),
				} : {}),
			}];
		}),
	};
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
	for (const candidate of Array.isArray(report.method_candidates) ? report.method_candidates : []) {
		const refs = Array.isArray(candidate?.basis_refs) ? candidate.basis_refs.map(String) : [];
		const methodRefs = [
			...(candidate?.method?.construction_evidence_refs ?? []),
			...(candidate?.method?.contrast_evidence_refs ?? []),
		].map(String);
		const unlinked = [...new Set([...refs, ...methodRefs])].filter((reference) => !reportEvidenceRefs.has(reference));
		if (unlinked.length) throw new Error(`method candidate evidence is not linked to report findings/evidence: ${unlinked.join(", ")}`);
	}
	for (const proposal of Array.isArray(report.harness_proposals) ? report.harness_proposals : []) {
		const deliveryBasisRefs = Array.isArray(proposal?.delivery?.basis_refs)
			? proposal.delivery.basis_refs.map(String) : [];
		const unlinkedDeliveryRefs = deliveryBasisRefs.filter((reference: string) => !reportEvidenceRefs.has(reference));
		if (unlinkedDeliveryRefs.length) {
			throw new Error(`delivery basis evidence is not linked to report findings/evidence: ${unlinkedDeliveryRefs.join(", ")}`);
		}
		const promptBasisRefs = Array.isArray(proposal?.delivery?.system_prompt_basis?.evidence_refs)
			? proposal.delivery.system_prompt_basis.evidence_refs.map(String) : [];
		const unlinkedPromptRefs = promptBasisRefs.filter((reference: string) => !reportEvidenceRefs.has(reference));
		if (unlinkedPromptRefs.length) {
			throw new Error(`system_prompt_basis evidence is not linked to report findings/evidence: ${unlinkedPromptRefs.join(", ")}`);
		}
	}
}

export function compactHarnessRouteForCapsule(route: HarnessRoutePlan): Record<string, any> {
	return {
		format: route.format,
		route_id: route.route_id,
		route_ref: route.route_ref,
		version: route.version,
		run_id: route.run_id,
		delivery_id: route.delivery_id,
		delivery_hash: route.delivery_hash,
		approval_ref: route.approval_ref,
		review_status: route.review_status,
		disposition: route.disposition,
		route_status: route.route_status,
		...(route.execution_status ? { execution_status: route.execution_status } : {}),
		...(route.execution_applied !== undefined ? { execution_applied: route.execution_applied } : {}),
		base_target: route.base_target,
		steps: route.steps.map((step) => ({
			step_id: step.step_id,
			order: step.order,
			target: step.target,
			native_tool: step.native_tool,
			status: step.status,
			depends_on: [...step.depends_on],
			...(step.reason ? { reason: step.reason } : {}),
		})),
		router: { ...route.router },
	};
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
	routePlans?: HarnessRoutePlan[];
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
		planning_implications: report.planning_implications,
		next_research_question: report.next_research_question,
		limitations: report.limitations,
		method_candidates: report.method_candidates,
		proposal_index: report.harness_proposals.map((proposal: Record<string, any>, index: number) => ({
			proposal_id: `${input.runId}:proposal-${index + 1}`,
			...(proposal.candidate_ref ? { candidate_ref: proposal.candidate_ref } : {}),
			...(proposal.approval_id ? { approval_id: proposal.approval_id } : {}),
			...(proposal.approval_version !== undefined ? { approval_version: proposal.approval_version } : {}),
			...(proposal.approval_status ? { approval_status: proposal.approval_status } : {}),
			...(proposal.approval_tag ? { approval_tag: proposal.approval_tag } : {}),
			delivery_id: proposal.delivery?.delivery_id ?? proposal.delivery_id ?? null,
			semantic_kind: proposal.delivery?.semantic_kind ?? null,
			operation: proposal.delivery?.operation ?? null,
			name: proposal.delivery?.name ?? null,
			summary: proposal.delivery?.summary ?? null,
			basis_refs: proposal.delivery?.basis_refs ?? [],
			...(proposal.proposal_status ? { status: proposal.proposal_status, reason: proposal.proposal_error } : {}),
		})),
		harness_outputs: (input.routePlans ?? []).map((route) => ({
			delivery_id: route.delivery_id,
			disposition: route.disposition,
			status: route.route_status,
			target: route.base_target,
		})),
		...((input.routePlans ?? []).some((route) => route.disposition === "materialize" && route.route_status === "ready") ? {
			adoption_call: { name: "task_harness", arguments: {
				action: "adopt_research", research_run_ref: `research_run:${input.runId}@v1`,
			} },
		} : {}),
		usage: {
			input: Number(input.usage?.input ?? 0),
			output: Number(input.usage?.output ?? 0),
			cacheRead: Number(input.usage?.cacheRead ?? 0),
			cacheWrite: Number(input.usage?.cacheWrite ?? 0),
		},
		adoption: "No child-side mutation occurred. Decide whether to adopt the completed research result; task_harness(action=adopt_research) resolves and executes its compiled routes. Only the returned native receipt proves application.",
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
