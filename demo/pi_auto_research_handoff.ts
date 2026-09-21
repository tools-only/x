/** Pure contracts joining periodic state-transition review to Auto-Research. */
type Row = Record<string, any>;
import { controlError, latestControlRecords, selectControlTarget } from "./pi_harness_control.ts";

export function researchHandoffReference(handoff: Row): string {
	return `research_handoff:${handoff.handoff_id}@v${handoff.version}`;
}

function nextResearchCall(handoff: Row): Row | null {
	const reference = researchHandoffReference(handoff);
	if (handoff.status === "deferred") return {action:"decide_research", research_handoff_ref:reference,
		research_decision:"reactivate", research_reason:"<why resume now>"};
	if (handoff.status === "proposed" || handoff.status === "failed" && !handoff.session_ref) {
		return { action: "start", research_handoff_ref: reference, interaction_mode_required: true };
	}
	if (["pending", "failed"].includes(String(handoff.status)) && handoff.session_ref) {
		return {
			action: "resume", session_ref: handoff.session_ref,
			research_handoff_ref: reference,
			interaction_mode: handoff.selected_interaction_mode ?? handoff.interaction_mode,
		};
	}
	if (["active", "completed", "cancelled"].includes(String(handoff.status)) && handoff.session_ref) {
		return { action: "inspect", session_ref: handoff.session_ref };
	}
	return null;
}

export function advanceResearchHandoff(handoff: Row, patch: Row): Row {
	const legal: Record<string, string[]> = {
		proposed:["active","pending","completed","failed","cancelled","deferred","skipped"],
		active:["pending","completed","failed","cancelled"], pending:["active","completed","failed","cancelled"],
		failed:["proposed","active","pending","completed","cancelled","deferred","skipped"],
		deferred:["proposed","skipped"], completed:[], cancelled:[], skipped:[],
	};
	if (patch.status && patch.status !== handoff.status && !legal[String(handoff.status)]?.includes(patch.status))
		controlError("invalid_transition", [{path:"status", message:`Illegal handoff transition ${handoff.status} -> ${patch.status}`, allowed:legal[String(handoff.status)] ?? []}]);
	const advanced: Row = {
		...handoff, ...patch, version: Number(handoff.version) + 1,
		recordedAt: patch.recordedAt ?? new Date().toISOString(),
	};
	delete advanced.ready_call;
	delete advanced.ready_calls;
	advanced.next_call = nextResearchCall(advanced);
	return advanced;
}

export function buildPeriodicResearchHandoff(
	reviewId: string,
	window: Row,
	transition: Row,
	entries: Row[],
	priorResearch: Row[] = [],
): Row {
	const handoffId = `research-handoff-${reviewId}`;
	const consolidation = window.mode === "consolidation";
	const priorResearchRefs = [...new Set(priorResearch.flatMap(item => [
		item.report_ref, item.research_run_ref, item.session_ref,
	]).filter(Boolean).map(String))];
	const priorLineRefs = [...new Set(priorResearch.map(item => item.research_line_ref)
		.filter(Boolean).map(String))];
	// A research line is only a durable correlation key. It does not schedule
	// work or grant authority. Continue an unambiguous prior line; otherwise
	// start a new line owned by this runtime-created handoff.
	const researchLineRef = priorLineRefs.length === 1
		? priorLineRefs[0]
		: `research_line:${handoffId}@v1`;
	const evidenceRefs = [...new Set([
		window.baseline_ref,
		...(window.evidence_refs ?? []),
		...(transition.evidence_refs ?? []),
	].filter(Boolean).map(String))];
	const resourceRefs = [...new Set([
		...entries.flatMap(entry => entry.resource_refs ?? []),
		...priorResearch.flatMap(item => [item.report_ref, item.research_run_ref]),
	].filter(Boolean).map(String))];
	const candidateComponents = entries
		.filter(entry => ["create", "update", "reuse"].includes(String(entry.disposition)))
		.map(entry => `${entry.component}:${entry.disposition}`);
	const researchProblem = String(transition.capability_opportunities ?? "").trim()
		|| "Determine which mechanism, representation, capability, composition, exploration policy, plan, solution method, or recovery rule best resolves the current task uncertainty; an inconclusive result is valid.";
	const allowedProblemKinds = new Set(["mechanism", "representation", "capability", "composition", "exploration", "planning", "solution", "recovery"]);
	const requestedProblemKind = String(transition.research_kind ?? "capability");
	const researchProblemKind = allowedProblemKinds.has(requestedProblemKind) ? requestedProblemKind : "capability";
	const question = [
		`Unresolved task research problem (${researchProblemKind}, primary objective): ${researchProblem}`,
		`Research line: ${researchLineRef}. Continue its supported findings, live alternatives, failed tests and unresolved questions across task stages; the line is continuity metadata, not permission to act or modify harness resources.`,
		`Continuity context: ${priorResearch.length ? JSON.stringify(priorResearch) : "no prior linked research result was supplied"}. Before opening a distinct line, continue, revise, or explicitly distinguish relevant prior work. An active related session means report the overlap to the parent rather than duplicating it.`,
		`Evidence entry point: ARC transition window ${window.window_id} (${window.start_step}-${window.end_step}, ${window.mode}). The window supplies cases and counterexamples; summarizing it is not the research objective.`,
		`Observed changes: ${transition.observed_changes}`,
		`Candidate predictive rules: ${transition.predictive_rules}`,
		`Decision-limiting uncertainty: ${transition.limiting_uncertainty}`,
		`Parent-proposed distinguishing experiment: ${transition.next_experiment}`,
		"Check the starting conditions, accessible evidence/tools, attainable intermediate objective and local evaluation before investigating. Name a reachable stage/input, predicted observable result, success/failure check, executor and cost/stop bound. If these are missing, identify the prerequisite or narrower check; do not invent them or attempt an unsupported whole-game solution.",
		"Use the trajectory as evidence, not as the research boundary. Depending on the problem kind, investigate mechanisms, state representations, skills, capability composition, exploration policies, plans, solution algorithms or recovery rules. Connect the result to a later task decision and preserve competing explanations.",
		"Derive one discriminating local test from supported conclusions or explain the exact maturity/access gap. Specify prerequisites, representative input or parent probe, alternative predicted outputs, falsifier, expected information gain, cost and stop condition. You are read-only: request new evidence; non-blocking work may checkpoint pending, while blocking work returns its unresolved test for a bounded follow-up.",
		consolidation
			? "Use the 20-step window and accessible cross-phase contrasts to update the research line: revise or retire conflicting findings, methods and plans. A research-only conclusion, planning implication or experiment request is complete when it satisfies the contract; a HarnessDelivery is optional and requires separate support."
			: "Return a scoped research result and next-use check. A research-only conclusion, planning implication or experiment request is valid. Submit a HarnessDelivery only when persistent reuse is supported; do not force a component from a single association.",
	].join("\n\n");
	const completionContract = "For one attainable task-research milestone, deliver (1) an evidence-linked problem and scope, (2) a supported, contradicted or inconclusive result about the selected mechanism/representation/capability/composition/exploration/planning/solution/recovery object, (3) expected versus actual output on a reachable local evaluation or the exact evidence/access gap, and (4) implications for the next task decision, experiment or research question with revision/stop conditions. A trajectory summary alone is incomplete. Harness proposals are optional downstream persistence candidates; negative and research-only results are valid.";
	const readyCall = {
		action: "start",
		research_handoff_ref: `research_handoff:${handoffId}@v1`,
	};
	const handoff = {
		format: "periodic-auto-research-handoff-v1",
		handoff_id: handoffId,
		version: 1,
		status: "proposed",
		review_id: reviewId,
		window_id: window.window_id,
		window_mode: window.mode,
		lane: consolidation ? "task_research_cross_stage_consolidation" : "task_research_construction_and_local_evaluation",
		question,
		completion_contract: completionContract,
		completion_contract_kind: "task_research_evaluation",
		continuity_policy: "continue_or_distinguish_before_starting_new_work",
		research_line_ref: researchLineRef,
		research_problem: {
			kind: researchProblemKind,
			status: "unresolved",
			statement: researchProblem,
			evidence_entry_window: window.window_id,
			prior_research_refs: priorResearchRefs,
		},
		current_confidence: "parent_claim_requires_independent_evidence_review",
		confidence_update_rule: "Research completion, agreement or proposal creation does not raise confidence. Only cited new evidence, resolved counterexamples or a completed discriminating experiment may change epistemic status.",
		parent_transition_analysis: { ...transition },
		hypothesis: {
			claim: String(transition.predictive_rules),
			observed_changes: String(transition.observed_changes),
			limiting_uncertainty: String(transition.limiting_uncertainty),
			parent_proposed_experiment: String(transition.next_experiment),
		},
		evidence_refs: evidenceRefs,
		resource_refs: resourceRefs,
		inherit_harness_refs: resourceRefs.filter(ref => /^(memory|skill|tool|subagent|system_prompt):/.test(ref)),
		candidate_components: candidateComponents,
		output_channels: ["research_conclusion", "planning_implication", "experiment_request", "optional_harness_proposal"],
		constraints: [
			"Research requires grounded starting material, an attainable intermediate objective and a feasible local evaluation; absent prerequisites require narrowing, evidence collection or deferral.",
			"Do not assume game-specific action meanings beyond cited transitions.",
			"Preserve competing explanations and identify missing evidence.",
			"The child cannot execute ARC actions; return a structured parent experiment request when needed.",
			"A harness proposal is optional; when present it must include applicability, next use, semantic validation and reconsideration conditions.",
		],
		interaction_mode_policy: "parent_choice_required",
		interaction_mode_options: ["blocking", "non_blocking"],
		scope: consolidation ? "composition" : "research_method",
		context_window: {
			include_checkpoint: true,
			recent_observations: consolidation ? 30 : 12,
			recent_actions: consolidation ? 20 : 5,
			context_refs: [...new Set([window.baseline_ref, ...evidenceRefs].filter(Boolean))],
			max_chars: consolidation ? 24_000 : 14_000,
		},
		recordedAt: new Date().toISOString(),
	};
	return {
		...handoff,
		ready_call: readyCall,
		ready_calls: {
			blocking: { ...readyCall, interaction_mode: "blocking" },
			non_blocking: { ...readyCall, interaction_mode: "non_blocking" },
		},
	};
}

/**
 * Derive append-only handoff lifecycle updates from durable Auto-Research
 * sessions. This makes background completion observable on the next parent
 * runtime boundary even though no second tool_result event is emitted.
 */
export function reconcileResearchHandoffs(handoffs: Row[], sessions: Row[], reports: Row[] = []): Row[] {
	const latestHandoffs = new Map<string, Row>();
	for (const item of handoffs) {
		const prior = latestHandoffs.get(String(item.handoff_id));
		if (!prior || Number(item.version) >= Number(prior.version)) latestHandoffs.set(String(item.handoff_id), item);
	}
	const latestSessions = new Map<string, Row>();
	for (const session of sessions) {
		const sessionId = String(session.session_id ?? "");
		if (!sessionId) continue;
		const prior = latestSessions.get(sessionId);
		if (!prior || Number(session.version) >= Number(prior.version)) latestSessions.set(sessionId, session);
	}
	const linked = new Map<string, Row>();
	for (const session of sessions) {
		const latest = latestSessions.get(String(session.session_id ?? ""));
		if (latest !== session && Number(latest?.version) !== Number(session.version)) continue;
		const match = String(latest?.research_handoff_ref ?? "").match(/^research_handoff:([^@]+)@v\d+$/);
		if (match) linked.set(match[1], latest!);
	}
	const reportsByRun = new Map<string, Row>();
	for (const report of reports) {
		const runId = String(report.run_id ?? "");
		const prior = reportsByRun.get(runId);
		if (runId && (!prior || Number(report.version ?? 0) >= Number(prior.version ?? 0))) reportsByRun.set(runId, report);
	}
	const updates: Row[] = [];
	for (const [handoffId, current] of latestHandoffs) {
		if (["deferred","skipped","cancelled"].includes(current.status)) continue;
		const session = linked.get(handoffId);
		if (!session) continue;
		const reportRecord = reportsByRun.get(String(session.run_id ?? ""));
		const report = reportRecord?.report && typeof reportRecord.report === "object" ? reportRecord.report : undefined;
		const status = ["active", "pending", "completed", "failed", "cancelled"].includes(String(session.status))
			? String(session.status) : "active";
		const sessionRef = `research_session:${session.session_id}@v${session.version}`;
		if (current.status === "completed" && status !== "completed") continue;
		const reportRef = reportRecord ? `research_report:${session.run_id}@v${reportRecord.version ?? 1}` : current.report_ref ?? null;
		if (Number(current.linked_session_version) === Number(session.version)
			&& current.session_ref === sessionRef && current.status === status && (current.report_ref ?? null) === reportRef) continue;
		updates.push(advanceResearchHandoff(current, {
			status,
			research_line_ref: session.research_line_ref ?? current.research_line_ref,
			selected_interaction_mode: session.interaction_mode ?? current.selected_interaction_mode ?? current.interaction_mode,
			session_ref: sessionRef,
			session_id: session.session_id,
			linked_session_version: Number(session.version),
			run_id: session.run_id ?? current.run_id ?? null,
			research_run_ref: session.research_run_ref ?? current.research_run_ref ?? null,
			report_status: session.report_status ?? current.report_status ?? null,
			result_summary: session.summary ?? current.result_summary ?? null,
			report_ref: reportRecord ? `research_report:${session.run_id}@v${reportRecord.version ?? 1}` : current.report_ref ?? null,
			experiment_request: report?.experiment_request ?? current.experiment_request ?? null,
			confidence_update: report?.confidence_update ?? current.confidence_update ?? null,
			confidence_state: status === "completed"
				? report?.confidence_update
					? "proposed_evidence_linked_update_pending_parent_adoption"
					: "unchanged_without_structured_evidence_linked_update"
				: "unchanged_while_research_incomplete",
		}));
	}
	return updates;
}

export function resolveResearchHandoff(records: Row[], reference?: unknown, statuses = ["proposed"]): Row {
	if (reference === undefined || reference === null || reference === "")
		return selectControlTarget(latestControlRecords(records,"handoff_id").filter(row => statuses.includes(row.status)),"handoff_id");
	const match = String(reference ?? "").match(/^research_handoff:([^@]+)@v(\d+)$/);
	if (!match) controlError("invalid_reference",[{path:"research_handoff_ref",message:"research_handoff_ref must use research_handoff:<id>@vN; omit it for unique eligible target"}],
		{candidates:latestControlRecords(records,"handoff_id").map(row => ({ref:researchHandoffReference(row),status:row.status}))});
	const versions = records.filter(item => item.handoff_id === match[1]);
	const latest = versions.sort((a, b) => Number(a.version) - Number(b.version)).at(-1);
	if (!latest) controlError("unknown_reference",[{path:"research_handoff_ref",message:`unknown research handoff: ${String(reference)}`}]);
	if (Number(match[2]) !== Number(latest.version)) controlError("version_conflict",[{path:"research_handoff_ref",message:`research handoff version conflict: expected v${match[2]}, current v${latest.version}`}],{current_ref:researchHandoffReference(latest),current_status:latest.status});
	return latest;
}

export function applyResearchHandoff(params: Row, handoff: Row): Row {
	if (!String(params.action ?? "start").match(/^(start|resume)$/)) return params;
	const action = String(params.action ?? "start");
	const allowed = action === "start" ? ["proposed", "failed"] : ["pending", "failed"];
	if (!allowed.includes(String(handoff.status))) {
		throw new Error(`research handoff is not startable: ${handoff.status}`);
	}
	const interactionMode = params.interaction_mode
		?? handoff.selected_interaction_mode
		// Compatibility for handoffs persisted before parent-choice mode existed.
		?? (handoff.interaction_mode_policy ? undefined : handoff.interaction_mode);
	if (!["blocking", "non_blocking"].includes(String(interactionMode ?? ""))) {
		throw new Error("Periodic Auto-Research requires the parent to explicitly choose interaction_mode=blocking or interaction_mode=non_blocking");
	}
	return {
		...params,
		research_line_ref: handoff.research_line_ref,
		research_problem: handoff.research_problem,
		question: params.question ?? handoff.question,
		scope: params.scope ?? handoff.scope,
		interaction_mode: interactionMode,
		complexity_assessment: params.complexity_assessment ?? {
			level: "simple",
			rationale: "One linked contract covers mechanism assessment, the next discriminating sample and any evidence-mature harness delivery.",
		},
		evidence_refs: [...new Set([...(handoff.evidence_refs ?? []), ...(params.evidence_refs ?? [])])],
		resource_refs: [...new Set([...(handoff.resource_refs ?? []), ...(params.resource_refs ?? [])])],
		inherit_harness_refs: [...new Set([...(handoff.inherit_harness_refs ?? []), ...(params.inherit_harness_refs ?? [])])],
		constraints: [...new Set([
			...(handoff.constraints ?? []),
			`Completion contract: ${handoff.completion_contract}`,
			`Confidence rule: ${handoff.confidence_update_rule}`,
			...(params.constraints ?? []),
		])],
		context_window: params.context_window ?? handoff.context_window,
	};
}
