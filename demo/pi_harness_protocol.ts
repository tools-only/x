/**
 * Small, Pi-independent boundary between the parent runtime and task-local
 * Self-Harness.  It contains data validation only: no model call, file I/O,
 * Pi API, child process, or environment action is allowed here.
 */

export type HarnessActor = "parent" | "auto_research" | "runtime";
export type HarnessAction = "research" | "change";

/** The object of a research effort.  This is deliberately separate from the
 * eventual harness component: a planning or mechanism study may produce no
 * persisted resource at all. */
export type ResearchKind =
	| "mechanism"
	| "representation"
	| "capability"
	| "composition"
	| "exploration"
	| "planning"
	| "solution"
	| "recovery";

export type DecisionBasis = {
	basis_refs: string[];
	reason: string;
	expected: string;
};

export type CapabilityGoal = {
	kind?: ResearchKind;
	purpose: "identify_gap" | "construct" | "compose_adapt" | "evaluate" | "revise";
	question: string;
	use_when: string;
	check: string;
	context_refs: string[];
};

export type HarnessChange =
	| { operation: "create" | "update"; candidate?: Record<string, unknown>; candidate_ref?: string }
	| { operation: "retire" | "reuse"; target_ref: string };

export type CapabilityRequest =
	| { action: "research"; goal: CapabilityGoal; decision: DecisionBasis }
	| { action: "change"; changes: HarnessChange[]; decision: DecisionBasis };

export type ResearchResult = {
	request_id: string;
	status: "completed" | "awaiting_evidence" | "pending" | "failed";
	report_ref?: string;
	proposed_changes?: HarnessChange[];
	action_request?: { action: { name: string; arguments: Record<string, unknown> }; purpose: string };
	reason?: string;
	research_line_ref?: string;
	research_problem?: Record<string, unknown>;
	planning_implications?: Array<{
		decision_context: string;
		implication: string;
		applicability: string;
		evidence_refs: string[];
		reconsider_when: string;
	}>;
	next_research_question?: string;
};

export type HarnessRouteTarget = "memory" | "system_prompt" | "skill" | "tool" | "subagent" | "research_only";

/**
 * The facade accepts the compact component words that a parent naturally uses
 * after inspecting a portfolio, but stores and routes only canonical semantic
 * kinds.  This is deliberately a data-only compatibility step: it neither
 * chooses a component nor performs a write.  The normal classifier below
 * remains the single routing authority.
 */
export function normalizeSemanticCandidate(input: Record<string, any>): Record<string, any> {
	const candidate = { ...input };
	// Periodic reviews use `candidate.kind` because the outer review entry owns
	// `component`. Direct changes and research deliveries use
	// `component`/`semantic_kind`. They are spelling aliases for one router.
	const alias = String(candidate.semantic_kind ?? candidate.component ?? candidate.kind ?? "").trim().toLowerCase();
	// Accept the five component words shown by task_harness.inspect as spelling
	// aliases. Routing is still decided here from the component's behavior.
	if (["skill", "task_skill", "procedure"].includes(alias)) {
		candidate.semantic_kind = "procedure";
		candidate.execution ??= "text";
		candidate.reuse ??= "expected_reuse";
		candidate.reasoning ??= "bounded_judgment";
		if (!candidate.content && !candidate.instructions && Array.isArray(candidate.procedures)) {
			candidate.instructions = candidate.procedures.map((item: unknown, index: number) => {
				if (typeof item === "string") return item;
				if (!item || typeof item !== "object") return String(item ?? "");
				const value = item as Record<string, unknown>;
				return [`Procedure ${index + 1}: ${String(value.procedure ?? value.pattern ?? "")}`,
					value.applicability ? `Applies when: ${String(value.applicability)}` : "",
					value.validation ? `Check: ${String(value.validation)}` : "",
					value.counterexamples ? `Limits: ${String(value.counterexamples)}` : ""].filter(Boolean).join("\n");
			}).filter(Boolean).join("\n\n");
		}
	}
	if (alias === "tool") {
		candidate.semantic_kind = "computation";
		candidate.execution ??= candidate.program ? "pure_computation" : "adapter_operation";
	}
	if (["subagent", "role"].includes(alias)) {
		candidate.semantic_kind = "role";
		candidate.execution ??= "model_delegation";
		candidate.reuse ??= "expected_reuse";
		candidate.reasoning ??= "open_ended";
	}
	if (!alias && candidate.layer === "task_state") {
		candidate.semantic_kind = "fact";
		candidate.execution ??= "text";
	}
	if (!alias && candidate.layer === "task_policy") {
		candidate.semantic_kind = "plan";
		candidate.execution ??= "text";
		candidate.prompt_channel ??= "task_prompt";
		candidate.context_visibility ??= "always";
	}
	if (["memory", "task_memory", "task_state", "fact"].includes(alias)) {
		candidate.semantic_kind = candidate.layer === "task_policy" ? "plan" : "fact";
		candidate.execution ??= "text";
		if (candidate.layer === "task_policy") {
			candidate.prompt_channel ??= "task_prompt";
			candidate.context_visibility ??= "always";
			candidate.prompt_layer ??= "task_policy";
		}
		if (alias === "task_state" && candidate.prompt_layer === undefined) candidate.prompt_layer = "task_state";
	}
	if (["policy", "task_prompt", "plan"].includes(alias)) {
		candidate.semantic_kind = "plan";
		candidate.execution ??= "text";
		candidate.prompt_channel ??= "task_prompt";
		candidate.context_visibility ??= "always";
		candidate.prompt_layer ??= "task_policy";
		candidate.content ??= candidate.prompt_text ?? candidate.summary;
	}
	if (candidate.target_version === undefined && Number.isInteger(candidate.current_version)) {
		candidate.target_version = candidate.current_version;
	}
	delete candidate.kind;
	delete candidate.current_version;
	return candidate;
}

function validateSystemPromptProjection(candidate: Record<string, any>, base: HarnessRouteTarget): void {
	if (base === "research_only") throw new Error("assessment and evidence deliveries are research_only and cannot become system_prompt");
	const evidenceRefs = candidate.system_prompt_basis?.evidence_refs;
	if (candidate.context_visibility !== "always"
		|| candidate.scope?.kind !== "task_wide"
		|| candidate.stability !== "stable_in_scope"
		|| !Array.isArray(evidenceRefs) || !evidenceRefs.length
		|| evidenceRefs.some((ref: unknown) => !candidate.basis_refs?.includes(ref))) {
		throw new Error("system_prompt requires an always-visible stable task-wide delivery with evidence-bound system_prompt_basis");
	}
}

/** Resolve every native target touched by one semantic change.  A system
 * prompt is an overlay, so it is deliberately compiled after its semantic
 * base target (memory, skill, tool, or subagent). */
export function classifyHarnessChangeTargets(candidate: Record<string, any>): HarnessRouteTarget[] {
	candidate = normalizeSemanticCandidate(candidate);
	const base = classifySemanticKind(candidate);
	if (candidate.prompt_channel === "system_prompt") {
		validateSystemPromptProjection(candidate, base);
		return [base, "system_prompt"];
	}
	if (candidate.prompt_channel === "task_prompt") {
		if (base !== "memory") throw new Error("task_prompt route requires fact or plan memory semantics");
		if (candidate.context_visibility !== "always") throw new Error("task_prompt projection requires always context_visibility");
		if (candidate.prompt_layer !== undefined && (!["task_policy", "task_state"].includes(candidate.prompt_layer)
			|| !["fact", "plan"].includes(candidate.semantic_kind))) {
			throw new Error("prompt_layer requires task_prompt fact or plan memory semantics");
		}
	}
	return [base];
}

/** Resolve the persisted component for a normalized semantic candidate. A
 * task_prompt is a projection of memory; system_prompt is a separate native
 * overlay and therefore has its own route target. */
export function classifyHarnessChangeTarget(candidate: Record<string, any>): HarnessRouteTarget {
	// Compatibility helper; all callers now share the multi-target policy.
	return classifyHarnessChangeTargets(candidate).at(-1)!;
}

export function assertParentChangeSource(actor: HarnessActor, action: HarnessAction): void {
	if (action !== "change") return;
	if (actor === "auto_research") {
		throw new Error("auto_research cannot invoke the harness change boundary; return proposed_changes to the parent runtime");
	}
}

function requiredText(value: unknown, field: string): string {
	const text = String(value ?? "").trim();
	if (!text) throw new Error(`${field} is required`);
	return text;
}

export function normalizeCapabilityRequest(input: unknown): CapabilityRequest {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("capability request must be an object");
	const value = input as Record<string, any>;
	const action = value.action;
	const decision = value.decision;
	if (action !== "research" && action !== "change") throw new Error("capability request.action must be research or change");
	if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("capability request.decision is required");
	const normalizedDecision: DecisionBasis = {
		basis_refs: Array.isArray(decision.basis_refs) ? [...new Set(decision.basis_refs.map(String).map((item: string) => item.trim()).filter(Boolean))] : [],
		reason: requiredText(decision.reason, "decision.reason"),
		expected: requiredText(decision.expected, "decision.expected"),
	};
	if (action === "research") {
		const goal = value.goal;
		if (!goal || typeof goal !== "object" || Array.isArray(goal)) throw new Error("research goal is required");
		if (goal.kind !== undefined && ![
			"mechanism", "representation", "capability", "composition",
			"exploration", "planning", "solution", "recovery",
		].includes(goal.kind)) throw new Error("goal.kind is invalid");
		if (!["identify_gap", "construct", "compose_adapt", "evaluate", "revise"].includes(goal.purpose)) {
			throw new Error("goal.purpose is invalid");
		}
		return {
			action,
			goal: {
				...(goal.kind ? { kind: goal.kind } : {}),
				purpose: goal.purpose,
				question: requiredText(goal.question, "goal.question"),
				use_when: requiredText(goal.use_when, "goal.use_when"),
				check: requiredText(goal.check, "goal.check"),
				context_refs: Array.isArray(goal.context_refs) ? [...new Set(goal.context_refs.map(String).map((item: string) => item.trim()).filter(Boolean))] : [],
			},
			decision: normalizedDecision,
		};
	}
	if (!Array.isArray(value.changes) || value.changes.length === 0) throw new Error("change request requires at least one change");
	return { action, changes: value.changes.map(normalizeHarnessChange), decision: normalizedDecision };
}

export function normalizeHarnessChange(input: unknown): HarnessChange {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("harness change must be an object");
	const value = input as Record<string, any>;
	if (!["create", "update", "retire", "reuse"].includes(value.operation)) throw new Error("harness change.operation is invalid");
	if (["retire", "reuse"].includes(value.operation)) {
		const targetRef = requiredText(value.target_ref, "harness change.target_ref");
		if (!/^(memory|skill|tool|subagent|system_prompt):[^@]+@v[1-9]\d*$/.test(targetRef)) {
			throw new Error("harness change.target_ref must be an exact task resource reference");
		}
		return { operation: value.operation, target_ref: targetRef };
	}
	if ((!value.candidate || typeof value.candidate !== "object" || Array.isArray(value.candidate))
		&& !String(value.candidate_ref ?? "").trim()) throw new Error(`${value.operation} change.candidate or candidate_ref is required`);
	return { operation: value.operation, ...(value.candidate ? { candidate: value.candidate } : {}), ...(value.candidate_ref ? { candidate_ref: requiredText(value.candidate_ref, "harness change.candidate_ref") } : {}) };
}

/** Classify only already-normalized semantic deliveries; this never executes. */
export function classifySemanticKind(candidate: Record<string, any>): HarnessRouteTarget {
	candidate = normalizeSemanticCandidate(candidate);
	switch (candidate.semantic_kind) {
		case "fact":
		case "plan":
			if (candidate.execution !== "text") throw new Error(`${candidate.semantic_kind} must use text execution`);
			return "memory";
		case "procedure":
			if (candidate.execution !== "text") throw new Error("procedure must use text execution");
			if (candidate.reuse !== "expected_reuse") throw new Error("procedure must declare expected_reuse before routing to skill");
			if (!["none", "bounded_judgment"].includes(candidate.reasoning)) throw new Error("procedure must use bounded reasoning");
			return "skill";
		case "computation":
			if (!["pure_computation", "adapter_operation"].includes(candidate.execution)) throw new Error("computation execution is invalid");
			if (!candidate.program && !candidate.implementation_ref) throw new Error("computation requires program or implementation_ref");
			return "tool";
		case "role":
			if (candidate.execution !== "model_delegation") throw new Error("role must use model_delegation execution");
			if (!Array.isArray(candidate.tools) || !candidate.tools.length) throw new Error("role requires an explicit tool set");
			return "subagent";
		case "assessment":
		case "evidence":
			return "research_only";
		default:
			throw new Error(`unsupported semantic_kind: ${String(candidate.semantic_kind)}`);
	}
}
