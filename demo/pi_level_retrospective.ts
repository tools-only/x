/** Outcome-based, evidence-addressed credit assignment. No environment mutations. */
type Row = Record<string, any>;

export function levelReviewWindows(observations: Row[]): Row[] {
	const windows: Row[] = [];
	const seen = new Set<string>();
	let episode: Row[] = [], attempt = 1, levelStart = 0;
	for (const row of observations) {
		if (!row.observation_id || seen.has(row.observation_id)) continue;
		seen.add(row.observation_id);
		episode.push(row);
		if (row.tool_name !== "arc_action" || row.is_error || !row.arc_outcome) continue;
		const state = row.arc_outcome;
		const transition = state.public_transition ?? {};
		const budget = state.action_budget ?? {};
		const reset = row.input?.action === "RESET" || transition.reset === true;
		const success = transition.level_changed === true && Number(transition.level_after) > Number(transition.level_before);
		const failure = state.state === "GAME_OVER" || (budget.total_maximum > 0 && budget.total_used >= budget.total_maximum)
			|| (budget.maximum > 0 && budget.used >= budget.maximum);
		const reasons = [...(success || state.state === "WIN" ? ["level_success"] : []),
			...(reset ? ["reset"] : []), ...(failure ? ["game_failure"] : [])];
		if (!reasons.length) continue;
		windows.push({ window_id: `level-outcome:${row.observation_id}`, level: transition.level_before ?? levelStart,
			attempt, reasons, boundary_ref: row.observation_id, boundary_tool_call_id: row.toolCallId ?? null, outcome: state,
			boundary_source: state.reset_report ? "agent_reported_reset_requires_verification" : "environment_result",
			evidence_refs: episode.map(e => e.observation_id),
			action_refs: episode.filter(e => e.tool_name === "arc_action" && !e.is_error).map(e => e.observation_id),
			started_at: episode[0].recordedAt, ended_at: row.recordedAt });
		// A reset keeps the full level history, including earlier failed attempts.
		if (success || state.state === "WIN") {
			episode = []; attempt = 1; levelStart = transition.level_after ?? state.levels_completed;
		} else attempt++;
	}
	return windows;
}

/** Exact refs that can satisfy validateLevelReview for one outcome window. */
export function levelReviewInputContract(window: Row, observations: Row[], resources: Row[]): Row {
	const evidenceRefs = Array.isArray(window?.evidence_refs) ? window.evidence_refs.map(String) : [];
	const evidence = new Set(evidenceRefs);
	const successful = observations.filter(observation => evidence.has(String(observation.observation_id ?? ""))
		&& !observation.is_error);
	return {
		format: "arc-level-review-input-contract-v1",
		window_id: window?.window_id,
		behavior_target_ref_candidates: evidenceRefs,
		evidence_ref_candidates: evidenceRefs,
		harness_targets: resources
			.filter(resource => resource.resource_ref
				&& !(resource.recordedAt && window?.ended_at && resource.recordedAt > window.ended_at))
			.map(resource => ({
				target_ref: resource.resource_ref,
				application_ref_candidates: successful
					.filter(observation => !(resource.recordedAt && observation.recordedAt
						&& observation.recordedAt < resource.recordedAt))
					.map(observation => observation.observation_id),
			})),
		empty_credits_allowed: true,
	};
}

function exactWindowRefs(value: unknown, candidates: Set<string>, field: string): string[] {
	if (!Array.isArray(value) || !value.length || value.some(ref => typeof ref !== "string" || !candidates.has(ref)))
		throw new Error(`${field} requires exact evidence refs within this level window`);
	return [...new Set(value.map(String))];
}

export function validateLevelReview(window: Row, report: Row, observations: Row[], resources: Row[]): Row {
	const normalized = { ...report };
	for (const key of ["summary", "mechanisms", "shortcomings", "lessons", "next_attempt"]) {
		if (Array.isArray(normalized[key])) normalized[key] = normalized[key].map(String).filter(item => item.trim()).join("\n");
		if (typeof normalized[key] !== "string" || !normalized[key].trim()) throw new Error(`level_review.${key} is required`);
	}
	if (!Array.isArray(normalized.credits)) throw new Error("level_review.credits must be an array (empty is valid)");
	const evidence = new Set(window.evidence_refs);
	const toolCallRefs = new Set(Array.isArray(window.tool_call_index?.calls)
		? window.tool_call_index.calls.map((call: Row) => call.call_ref) : []);
	const successful = window.reasons?.includes("level_success") === true;
	if (successful && normalized.success_path === undefined)
		throw new Error("Environment-confirmed success requires success_path; use insufficient_evidence when no reusable path is supported");
	if (normalized.success_path !== undefined) {
		if (!successful) throw new Error("success_path is accepted only for environment-confirmed level_success windows");
		const path = normalized.success_path;
		if (!path || typeof path !== "object" || !["candidate", "insufficient_evidence"].includes(path.status)
			|| !String(path.scope ?? "").trim() || !Array.isArray(path.preconditions)
			|| !String(path.success_check ?? "").trim() || !String(path.uncertainty ?? "").trim()
			|| !String(path.reuse_advice ?? "").trim() || !Array.isArray(path.steps)) {
			throw new Error("success_path requires status, scope, preconditions, success_check, uncertainty, reuse_advice, and steps");
		}
		path.preconditions = path.preconditions.map(String).filter((item: string) => item.trim());
		if (path.status === "candidate" && path.steps.length === 0)
			throw new Error("Candidate success_path requires at least one step");
		path.steps = path.steps.map((step: Row) => {
			if (!["discovery", "repeat_execution", "validation", "uncertain"].includes(step?.role)
				|| !String(step?.operation ?? "").trim() || !String(step?.input_or_condition ?? "").trim()
				|| !String(step?.output_or_check ?? "").trim()) throw new Error("success_path step requires operation, condition, check, and role");
			const refs = exactWindowRefs(step.evidence_refs, evidence, "success_path step");
			const calls = step.call_refs === undefined ? [] : exactWindowRefs(step.call_refs, toolCallRefs, "success_path step call_refs");
			return { ...step, evidence_refs: refs, ...(step.call_refs !== undefined ? { call_refs: calls } : {}) };
		});
		if (path.status === "candidate" && path.steps.every((step: Row) => !step.evidence_refs.length))
			throw new Error("Candidate success_path requires at least one exact observation reference");
		if (path.proposed_omissions !== undefined) {
			if (!Array.isArray(path.proposed_omissions)) throw new Error("success_path.proposed_omissions must be an array");
			path.proposed_omissions = path.proposed_omissions.map((item: Row) => {
				if (!String(item?.rationale ?? "").trim() || !String(item?.risk ?? "").trim()
					|| !["low", "medium", "high"].includes(item?.confidence)) throw new Error("Proposed omission requires rationale, risk, and confidence");
				return { ...item, call_refs: exactWindowRefs(item.call_refs, toolCallRefs, "success_path proposed omission") };
			});
		}
		normalized.success_path = path;
	}
	if (normalized.failure_modes !== undefined) {
		if (!Array.isArray(normalized.failure_modes)) throw new Error("failure_modes must be an array");
		normalized.failure_modes = normalized.failure_modes.map((mode: Row) => {
			if (!String(mode?.symptom ?? "").trim() || !String(mode?.trigger ?? "").trim()
				|| !String(mode?.recovery_or_next_test ?? "").trim() || !String(mode?.applicability ?? "").trim()
				|| !["low", "medium", "high"].includes(mode?.confidence)) throw new Error("failure_mode requires symptom, trigger, recovery, applicability, and confidence");
			const refs = exactWindowRefs(mode.evidence_refs, evidence, "failure_mode");
			if (!window.reasons?.some((reason: string) => ["reset", "game_failure"].includes(reason))
				&& !String(mode?.falsified_hypothesis ?? "").trim()) {
				throw new Error("failure_mode without a reset/failure boundary requires an evidence-backed falsified_hypothesis");
			}
			return { ...mode, evidence_refs: refs, evidence_status: window.boundary_source === "agent_reported_reset_requires_verification"
				? "agent_reported_unverified" : "environment_confirmed" };
		});
	}
	const resourceRefs = new Map(resources.map(r => [r.resource_ref, r]));
	const credits = normalized.credits.map((credit: Row) => {
		if (!["positive", "negative", "uncertain"].includes(credit.verdict)) throw new Error("Invalid credit verdict");
		if (!credit.reason?.trim() || !credit.counterfactual?.trim() || !credit.next_use?.trim())
			throw new Error("Credit requires reason, counterfactual/uncertainty, and next_use");
		if (!Array.isArray(credit.evidence_refs) || !credit.evidence_refs.length || credit.evidence_refs.some((ref: string) => !evidence.has(ref)))
			throw new Error("Credit requires exact evidence within this level window");
		if (credit.kind === "behavior") {
			if (!evidence.has(credit.target_ref)) throw new Error("Behavior target must be an observation in this window");
		} else if (credit.kind === "harness") {
			if (!resourceRefs.has(credit.target_ref)) throw new Error("Harness target must be an exact existing resource version");
			const resource = resourceRefs.get(credit.target_ref)!;
			if (resource.recordedAt && window.ended_at && resource.recordedAt > window.ended_at)
				throw new Error("Cannot credit a resource created after the outcome");
			if (credit.use_stage === undefined || credit.use_stage === null) {
				if (credit.verdict === "positive") throw new Error("Positive harness credit requires applied use_stage and application_ref");
			} else if (!["created_only", "exposed", "read", "applied"].includes(credit.use_stage)) {
				throw new Error("Invalid harness use_stage");
			}
			if (credit.verdict === "positive" && credit.use_stage !== "applied")
				throw new Error("Creation, exposure or reading alone cannot receive positive outcome credit");
			if (credit.use_stage === "applied" && (!evidence.has(credit.application_ref) ||
				!credit.evidence_refs.includes(credit.application_ref) ||
				!observations.some(o => o.observation_id === credit.application_ref && !o.is_error)))
				throw new Error("Applied harness requires a successful subsequent execution observation");
			const application = observations.find(o => o.observation_id === credit.application_ref);
			if (application && resource.recordedAt && application.recordedAt < resource.recordedAt)
				throw new Error("Application predates this resource version");
		} else throw new Error("Credit kind must be behavior or harness");
		return { ...credit, attribution_status: credit.kind === "harness" && credit.use_stage == null
			? "use_stage_unverified" : "agent_assessed_not_causal_proof" };
	});
	return { format: "arc-level-retrospective-v2", window_id: window.window_id, level: window.level,
		attempt: window.attempt, reasons: window.reasons, boundary_ref: window.boundary_ref,
		boundary_source: window.boundary_source,
		...Object.fromEntries(["summary", "mechanisms", "shortcomings", "lessons", "next_attempt"].map(k => [k, normalized[k]])),
		...(normalized.success_path ? { success_path: normalized.success_path } : {}),
		...(normalized.failure_modes ? { failure_modes: normalized.failure_modes } : {}),
		credits, reward_semantics: "qualitative_reuse_feedback_not_training_reward", recordedAt: new Date().toISOString() };
}

export const LEVEL_REVIEW_GUIDANCE = `A level outcome requires whole-level analysis, including earlier attempts and failures.
Read evidence with task_resource; inspect resource versions and usage before attributing credit.
Submit task_harness(action='level_review', window_id=..., level_review={summary, mechanisms, shortcomings, lessons, next_attempt, credits:[], success_path?, failure_modes?}).
Treat success_path.steps and failure_modes as a concrete, retrospective evidence archive. They explain what happened in that past state; they are never a route or action list to replay. Record useful decisions, checks, discovery probes and uncertainty with exact supporting references.
After environment-confirmed level_success only, author success_path={status:'candidate'|'insufficient_evidence',scope,preconditions,steps:[{operation,input_or_condition,output_or_check,evidence_refs,call_refs?,role}],success_check,uncertainty,reuse_advice,proposed_omissions?:[{call_refs,rationale,risk,confidence}]}. A candidate needs at least one step and exact observation evidence. For call_refs, use the preview in the input contract or read its outcome_cost_index_ref with task_resource for the complete paged call list. The tool-call index is descriptive; runtime does not decide which calls were redundant. A discovery probe can be necessary to learn a reusable rule even if it is omitted from future execution.
When the outcome suggests a useful method, express its future form in parent-authored lessons/next_attempt: state what to read from a future observation, how to form or compare candidates, what visible result to expect, and when to stop or re-estimate. Treat old coordinates, colors, object identities, target sets and budgets as historical examples only; each use must fill such variables from the then-current public observation and recheck applicability. A method may be specific to this task or level family; it need not be universal. Do not create or change a component just to satisfy the review. In a later live parent turn, the parent may read this exact review and directly use the relevant Creator plus task_harness(action='change'), assemble that exact version, and test it against the current state. Runtime does not route the review, author the method, or choose its carrier. If the goal, success conditions and major constraints have become testable, the parent may directly revise a scoped planning System Prompt without waiting for a fixed stage gate.
Optionally author failure_modes=[{symptom,trigger,falsified_hypothesis?,evidence_refs,recovery_or_next_test,applicability,confidence}] after reset/game_failure, or for an evidence-backed falsified hypothesis. Runtime assigns evidence_status; an agent-reported reset remains unverified. Failure modes remain in the full level-review archive and are not projected as default guidance.
Each credit has kind ('behavior' or 'harness'), target_ref, verdict ('positive','negative','uncertain'), evidence_refs,
reason, counterfactual (alternatives and uncertainty), next_use. For harness credit, give use_stage
('created_only','exposed','read','applied') when known and application_ref when applied. An uncertain or negative
credit may omit use_stage; it remains unverified. Positive credit requires applied use. Target an exact resource version.
Use only refs listed in the accompanying input contract: behavior target_ref and every evidence_ref come from its
observation candidates; a harness target_ref comes from harness_targets, and application_ref comes from that same
target's application_ref_candidates and must also appear in evidence_refs. Never use assessment, validation, exposure,
decision, or resource refs as application_ref. credits:[] is valid and is preferable to unsupported attribution.
Reward useful evidence gathering even in failure; success does not reward every action. Creation/exposure alone earns no positive credit.
These are evidence-linked qualitative rewards and reuse recommendations, not causal proof or model-weight updates.
Archive a candidate trace only after confirmed success. On reset/failure, capture evidence-backed failure modes and recovery; these remain available by explicitly reading the archived level_review. Online play continues from the latest public observation; no retrospective changes the already-taken route.
If reset is inferred from public observations rather than an explicit RESET action, use
task_harness(action='report_level_reset', boundary_ref=<action observation>, reset_reason=<evidence and alternatives>)
to open an agent-reported reset review. Its source remains unverified; never assert reset solely from a delta count.`;
