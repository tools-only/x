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
			attempt, reasons, boundary_ref: row.observation_id, outcome: state,
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

export function validateLevelReview(window: Row, report: Row, observations: Row[], resources: Row[]): Row {
	const normalized = { ...report };
	for (const key of ["summary", "mechanisms", "shortcomings", "lessons", "next_attempt"]) {
		if (Array.isArray(normalized[key])) normalized[key] = normalized[key].map(String).filter(item => item.trim()).join("\n");
		if (typeof normalized[key] !== "string" || !normalized[key].trim()) throw new Error(`level_review.${key} is required`);
	}
	if (!Array.isArray(normalized.credits)) throw new Error("level_review.credits must be an array (empty is valid)");
	const evidence = new Set(window.evidence_refs);
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
			if (!["created_only", "exposed", "read", "applied"].includes(credit.use_stage)) throw new Error("Harness use_stage required");
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
		return { ...credit, attribution_status: "agent_assessed_not_causal_proof" };
	});
	return { format: "arc-level-retrospective-v1", window_id: window.window_id, level: window.level,
		attempt: window.attempt, reasons: window.reasons, boundary_ref: window.boundary_ref,
		boundary_source: window.boundary_source,
		...Object.fromEntries(["summary", "mechanisms", "shortcomings", "lessons", "next_attempt"].map(k => [k, normalized[k]])),
		credits, reward_semantics: "qualitative_reuse_feedback_not_training_reward", recordedAt: new Date().toISOString() };
}

export const LEVEL_REVIEW_GUIDANCE = `A level outcome requires whole-level analysis, including earlier attempts and failures.
Read evidence with task_resource; inspect resource versions and usage before attributing credit.
Submit task_harness(action='level_review', window_id=..., level_review={summary, mechanisms, shortcomings, lessons, next_attempt, credits:[]}).
Cover decisive experiments, useful and wasted actions, wrong hypotheses, recovery, and harness contributions or non-use.
Each credit has kind ('behavior' or 'harness'), target_ref, verdict ('positive','negative','uncertain'), evidence_refs,
reason, counterfactual (alternatives and uncertainty), next_use. Harness credits also require use_stage
('created_only','exposed','read','applied') and application_ref when applied. Target an exact resource version.
Use only refs listed in the accompanying input contract: behavior target_ref and every evidence_ref come from its
observation candidates; a harness target_ref comes from harness_targets, and application_ref comes from that same
target's application_ref_candidates and must also appear in evidence_refs. Never use assessment, validation, exposure,
decision, or resource refs as application_ref. credits:[] is valid and is preferable to unsupported attribution.
Reward useful evidence gathering even in failure; success does not reward every action. Creation/exposure alone earns no positive credit.
These are evidence-linked qualitative rewards and reuse recommendations, not causal proof or model-weight updates.
Consolidate successful mechanisms and explain reset/failure costs, unresolved hypotheses, and a better next attempt.
If reset is inferred from public observations rather than an explicit RESET action, use
task_harness(action='report_level_reset', boundary_ref=<action observation>, reset_reason=<evidence and alternatives>)
to open an agent-reported reset review. Its source remains unverified; never assert reset solely from a delta count.`;
