/** Pure durable-agenda and delivery policy for open Auto-Research. */
import { createHash } from "node:crypto";
import type { AutoResearchHistoryCatalog } from "./pi_auto_research_history.ts";

/** Derived from the last worker's evidence cursor; rendering does not advance it. */
export function researchContinuationCard(input: {
	agenda: Record<string, any>;
	catalog: AutoResearchHistoryCatalog;
	newActionRefs: string[];
	stageBoundaryRefs: string[];
	active: boolean;
}): Record<string, any> | undefined {
	const { agenda, catalog } = input;
	if (input.active || agenda.status === "drop" || !agenda.research_line_ref) return undefined;
	const feedbackRefs = catalog.new_resource_refs.filter(ref => /^(validation|effect_assessment):/.test(ref));
	const evidenceRefs = [...new Set([...input.newActionRefs, ...feedbackRefs])];
	if (!evidenceRefs.length) return undefined;
	const sourceRef = agenda.agenda_id ? `research_agenda:${agenda.agenda_id}@v${agenda.version}`
		: `research_session:${agenda.session_id}@v${agenda.version}`;
	return {
		format: "auto-research-continuation-v1", research_line_ref: agenda.research_line_ref,
		agenda_ref: agenda.agenda_id ? sourceRef : null, source_ref: sourceRef,
		last_report_ref: agenda.last_report_ref, previous_status: agenda.status,
		question: String(agenda.question ?? "").slice(0, 220),
		next_step: String(agenda.next_step ?? "").slice(0, 220),
		evidence_refs: evidenceRefs.slice(-8), additional_evidence_count: Math.max(0, evidenceRefs.length - 8),
		stage_boundary_refs: input.stageBoundaryRefs.slice(-3),
		assessment_refs: feedbackRefs.slice(-4),
		ready_call: { tool: "auto_research", arguments: { action: "start",
			research_line_ref: agenda.research_line_ref,
			resource_refs: [sourceRef, agenda.last_report_ref].filter(Boolean),
			evidence_refs: evidenceRefs.slice(-8),
			review_reason: "New action or assessment evidence since the previous research workset; recheck prior claims and component applicability." } },
	};
}

function normalizedText(value: unknown): string {
	return String(value ?? "").trim();
}

function normalizedList(value: unknown): string[] {
	return Array.isArray(value) ? [...new Set(value.map(normalizedText).filter(Boolean))] : [];
}

export function normalizeResearchProgress(value: unknown): Record<string, any> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const progress = value as Record<string, any>;
	const status = normalizedText(progress.status);
	const parentRelevance = normalizedText(progress.parent_relevance);
	const topic = normalizedText(progress.topic);
	const question = normalizedText(progress.question);
	if (!topic || !question) throw new Error("research_progress requires topic and question");
	if (!["continue", "complete", "drop"].includes(status)) {
		throw new Error("research_progress.status must be continue, complete or drop");
	}
	if (!["now", "later", "none"].includes(parentRelevance)) {
		throw new Error("research_progress.parent_relevance must be now, later or none");
	}
	return {
		topic,
		question,
		status,
		parent_relevance: parentRelevance,
		rationale: normalizedText(progress.rationale),
		hypothesis: normalizedText(progress.hypothesis),
		evidence_refs: normalizedList(progress.evidence_refs),
		next_step: normalizedText(progress.next_step),
	};
}

export function buildAutoResearchAgendaRecord(input: {
	previous?: Record<string, any>;
	progress: Record<string, any>;
	historyCursor: Record<string, number>;
	runId: string;
	reportRef: string;
	researchLineRef: string;
	recordedAt: string;
}): Record<string, any> {
	return {
		format: "auto-research-agenda-v1",
		agenda_id: input.previous?.agenda_id ?? (input.researchLineRef === "research_line:task-auto-research-agenda@v1"
			? "task-auto-research-agenda"
			: `task-auto-research-agenda-${createHash("sha256").update(input.researchLineRef).digest("hex").slice(0, 12)}`),
		version: Number(input.previous?.version ?? 0) + 1,
		status: input.progress.status,
		topic: input.progress.topic,
		question: input.progress.question,
		parent_relevance: input.progress.parent_relevance,
		rationale: input.progress.rationale,
		hypothesis: input.progress.hypothesis,
		evidence_refs: input.progress.evidence_refs,
		next_step: input.progress.next_step,
		history_cursor: { ...input.historyCursor },
		last_run_ref: `research_run:${input.runId}@v1`,
		last_report_ref: input.reportRef,
		research_line_ref: input.researchLineRef,
		recordedAt: input.recordedAt,
	};
}

export function researchReportNeedsParentAttention(report: Record<string, any>): boolean {
	return report.research_progress?.parent_relevance === "now"
		|| Boolean(report.experiment_request)
		|| (Array.isArray(report.planning_implications) && report.planning_implications.length > 0)
		|| (Array.isArray(report.method_candidates) && report.method_candidates.length > 0);
}

export function buildAutoResearchProgressReceipt(input: {
	runId: string;
	sessionRef: string;
	reportRef: string;
	agendaRef: string;
	researchLineRef: string;
}): Record<string, any> {
	return {
		format: "auto-research-progress-receipt-v1",
		resource_ref: `research_run:${input.runId}@v1`,
		detail_ref: input.reportRef,
		session_ref: input.sessionRef,
		agenda_ref: input.agendaRef,
		research_line_ref: input.researchLineRef,
		status: "progress_saved",
		parent_attention: false,
		summary: "Auto-Research preserved cross-stage progress; no immediate parent decision was requested.",
	};
}
