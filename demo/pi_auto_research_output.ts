/** Lossless structured projection helpers for Auto-Research output. */
import { normalizeHarnessDelivery, type HarnessRoutePlan } from "./pi_auto_research_harness_router.ts";

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

export function normalizeAutoResearchReport(input: unknown): Record<string, any> {
	const report = input && typeof input === "object" && !Array.isArray(input)
		? input as Record<string, any> : {};
	const status = normalizedText(report.status);
	const findings = Array.isArray(report.findings) ? report.findings : [];
	const proposals = Array.isArray(report.harness_proposals) ? report.harness_proposals : [];
	return {
		format: "auto-research-report-v1",
		status: REPORT_STATUSES.has(status) ? status : "unresolved",
		conclusion: normalizedText(report.conclusion),
		findings: findings.flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			return [{
				subject_kind: normalizedText(item.subject_kind),
				question: normalizedText(item.question),
				conclusion: normalizedText(item.conclusion),
				evidence_refs: normalizedList(item.evidence_refs),
				uncertainty: normalizedText(item.uncertainty),
			}];
		}),
		evidence_refs: normalizedList(report.evidence_refs),
		alternatives: normalizedList(report.alternatives),
		limitations: normalizedList(report.limitations),
		validation_plan: normalizedText(report.validation_plan),
		harness_proposals: proposals.flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			// The child may submit the compact approval-only form after the
			// complete delivery has been bound in its approval ledger. The child
			// submit handler hydrates that body before calling this normalizer;
			// preserve absence here so the same normalizer can also be used by
			// parent-side capsule parsing without inventing or truncating content.
			const delivery = item.delivery === undefined
				? undefined
				: normalizeHarnessDelivery(item.delivery);
			return [{
				...(item.approval_id ? { approval_id: normalizedText(item.approval_id) } : {}),
				...(item.approval_version !== undefined ? { approval_version: Number(item.approval_version) } : {}),
				...(item.approval_status ? { approval_status: normalizedText(item.approval_status) } : {}),
				...(item.approval_tag ? { approval_tag: normalizedText(item.approval_tag) } : {}),
				...(delivery ? { delivery } : {}),
			}];
		}),
	};
}

export function assertHarnessProposalEvidenceLinks(report: Record<string, any>): void {
	const reportEvidenceRefs = new Set([
		...(Array.isArray(report.evidence_refs) ? report.evidence_refs.map(String) : []),
		...(Array.isArray(report.findings) ? report.findings.flatMap((finding: Record<string, any>) =>
			Array.isArray(finding?.evidence_refs) ? finding.evidence_refs.map(String) : []) : []),
	]);
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
		summary: report.conclusion,
		key_findings: report.findings.map((finding: Record<string, any>) => ({
			subject_kind: finding.subject_kind,
			conclusion: finding.conclusion,
			evidence_refs: finding.evidence_refs,
		})),
		evidence_refs: report.evidence_refs,
		next_test: report.validation_plan,
		limitations: report.limitations,
		proposal_index: report.harness_proposals.map((proposal: Record<string, any>, index: number) => ({
			proposal_id: `${input.runId}:proposal-${index + 1}`,
			...(proposal.approval_id ? { approval_id: proposal.approval_id } : {}),
			...(proposal.approval_version !== undefined ? { approval_version: proposal.approval_version } : {}),
			...(proposal.approval_status ? { approval_status: proposal.approval_status } : {}),
			...(proposal.approval_tag ? { approval_tag: proposal.approval_tag } : {}),
			delivery_id: proposal.delivery.delivery_id,
			semantic_kind: proposal.delivery.semantic_kind,
			operation: proposal.delivery.operation,
			name: proposal.delivery.name,
			summary: proposal.delivery.summary,
			basis_refs: proposal.delivery.basis_refs,
		})),
		route_plan: (input.routePlans ?? []).map(compactHarnessRouteForCapsule),
		usage: {
			input: Number(input.usage?.input ?? 0),
			output: Number(input.usage?.output ?? 0),
			cacheRead: Number(input.usage?.cacheRead ?? 0),
			cacheWrite: Number(input.usage?.cacheWrite ?? 0),
		},
		adoption: "No child-side mutation occurred. The parent runtime parses each child-approved ready materialize route and invokes the compiled native harness steps before returning this capsule. Receipts converge every route to fulfilled, partial, or failed; task_harness(action=apply_route) remains available for explicit recovery or idempotent replay.",
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
