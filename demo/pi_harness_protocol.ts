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
 * One independently selectable and independently invalidatable unit of task
 * knowledge.  A fact or plan may contain structured data, but it must describe
 * one subject/predicate pair.  Larger notes remain research/trajectory
 * resources and are not admitted as Harness memory components.
 */
export type HarnessMemoryAtom = {
	subject: string;
	predicate: string;
	value: unknown;
};

/**
 * Materialize a semantic delivery body at the text-resource boundary.
 *
 * Research and review records intentionally allow structured JSON in
 * `content` so fields such as procedures, maps, predictions, and limits are
 * not lost.  Native Pi resources, however, are text (`SKILL.md`, prompt
 * overlays, memory bodies, and subagent instructions).  Never use
 * `String(object)` here: JavaScript would silently produce `[object Object]`
 * and destroy the body.  Structured values are preserved losslessly as a
 * deterministic fenced JSON document; plain text remains plain text.
 */
export function canonicalTextBody(value: unknown, field: string, trimString = true): string {
	if (typeof value === "string") {
		const text = trimString ? value.trim() : value;
		if (!text && trimString) throw new Error(`${field} is required`);
		return text;
	}
	if (value === undefined || value === null) return "";
	if (typeof value === "object") {
		const serialized = JSON.stringify(sortStructuredValue(value), null, 2);
		if (!serialized) throw new Error(`${field} must contain serializable text`);
		return `\`\`\`json\n${serialized}\n\`\`\``;
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	throw new Error(`${field} must be text or a JSON value`);
}

function sortStructuredValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortStructuredValue);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortStructuredValue(record[key])]));
}

export function normalizeHarnessMemoryAtom(value: unknown): HarnessMemoryAtom {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("fact/plan memory requires atom={subject,predicate,value}");
	}
	const atom = value as Record<string, unknown>;
	const subject = String(atom.subject ?? "").trim();
	const predicate = String(atom.predicate ?? "").trim();
	if (!subject) throw new Error("memory atom.subject is required");
	if (!predicate) throw new Error("memory atom.predicate is required");
	if (!("value" in atom) || atom.value === undefined) throw new Error("memory atom.value is required");
	// JSON serialization is the persistence boundary. Reject values that would
	// silently disappear or fail only after a partial native route has run.
	try {
		JSON.stringify(sortStructuredValue(atom.value));
	} catch {
		throw new Error("memory atom.value must be JSON serializable");
	}
	return { subject, predicate, value: sortStructuredValue(atom.value) };
}

/**
 * The facade accepts the compact component words that a parent naturally uses
 * after inspecting a portfolio, but stores and routes only canonical semantic
 * kinds.  This is deliberately a data-only compatibility step: it neither
 * chooses a component nor performs a write.  The normal classifier below
 * remains the single routing authority.
 */
export function normalizeSemanticCandidate(input: Record<string, any>): Record<string, any> {
	const candidate = { ...input };
	// Omission allows mechanical defaults; an explicit null is authored input,
	// not permission to choose a different carrier or execution contract.
	for (const field of ["semantic_kind", "component", "kind", "type", "execution", "reuse", "reasoning",
		"context_visibility", "prompt_channel", "prompt_layer", "target_version", "current_version", "prompt_target_version"]) {
		if (candidate[field] === null) throw new Error(`candidate.${field} cannot be null; omit it for the documented default`);
	}
	const carriers: Record<string, string> = {
		memory: "memory", task_memory: "memory", task_state: "memory", fact: "memory", plan: "memory",
		policy: "memory", task_prompt: "memory",
		skill: "skill", task_skill: "skill", procedure: "skill",
		tool: "tool", task_tool: "tool", computation: "tool",
		subagent: "subagent", task_subagent: "subagent", role: "subagent",
		system_prompt: "system_prompt", task_system_prompt: "system_prompt",
		assessment: "research_only", evidence: "research_only",
	};
	const authoredKinds = ["semantic_kind", "component", "kind", "type"]
		.filter(field => candidate[field] !== undefined)
		.map(field => ({ field, value: String(candidate[field]).trim().toLowerCase() }));
	const firstKind = authoredKinds[0];
	for (const entry of authoredKinds.slice(1)) {
		if ((carriers[entry.value] ?? entry.value) !== (carriers[firstKind.value] ?? firstKind.value))
			throw new Error(`candidate.${entry.field} conflicts with candidate.${firstKind.field}; choose one authored carrier`);
	}
	let alias = String(candidate.semantic_kind ?? candidate.component ?? candidate.kind ?? candidate.type ?? "").trim().toLowerCase();
	// This syntax can only define a pure Tool; no prose or arbitrary program
	// is used to guess a carrier. Explicit conflicting carriers stay explicit.
	if (!alias && ["task-python-v1", "task-pure-python-v1"].includes(candidate.program?.format)
		&& !["atom", "instructions", "tools", "prompt_text", "layer"].some(key => candidate[key] !== undefined))
		alias = "tool";
	// A complete atom with a stable key and declared validity has only the
	// native Memory interpretation. Accept that compact spelling when no
	// component or prompt-routing fields suggest a different destination.
	const memoryOnlyShape = !alias && candidate.layer === undefined
		&& typeof candidate.key === "string" && candidate.key.trim()
		&& (candidate.name === undefined || candidate.name === candidate.key)
		&& candidate.validity && ["task", "episode", "level", "state"].includes(candidate.validity.scope)
		&& candidate.atom && typeof candidate.atom === "object" && !Array.isArray(candidate.atom)
		&& typeof candidate.atom.subject === "string" && candidate.atom.subject.trim()
		&& typeof candidate.atom.predicate === "string" && candidate.atom.predicate.trim()
		&& Object.prototype.hasOwnProperty.call(candidate.atom, "value")
		&& !["instructions", "procedures", "program", "tools", "input_schema", "implementation_ref",
			"prompt_channel", "prompt_text", "prompt_layer", "system_prompt_basis", "activation",
			"context_recipe", "method", "execution", "reasoning"].some(field => candidate[field] !== undefined);
	if (memoryOnlyShape) {
		candidate.semantic_kind = "fact";
		candidate.execution = "text";
	}
	if (candidate.target_version === undefined && Number.isInteger(candidate.current_version)) {
		candidate.target_version = candidate.current_version;
	}
	// Providers sometimes author every method field correctly but place them on
	// the candidate rather than under `method`. Nest that already-authored data
	// without interpreting prose or supplying defaults. Validation remains in
	// normalizeMethodSpecification. Only procedure candidates use this compact
	// spelling: applicability/scope on memories and prompt components retain
	// their ordinary component meaning and must not silently become a method.
	const methodFields = ["problem", "applicability", "abstain_when", "abstraction_scope",
		"inputs", "invariants", "parameters", "steps", "decision_points", "stop_conditions",
		"failure_modes", "construction_evidence_refs", "contrast_evidence_refs", "next_use",
		"predicted_semantic_result", "falsifier"];
	const procedureAlias = ["skill", "task_skill", "procedure"].includes(alias);
	if (procedureAlias && candidate.method === undefined) {
		const authored = Object.fromEntries(methodFields
			.filter(field => candidate[field] !== undefined)
			.map(field => [field, candidate[field]]));
		if (Object.keys(authored).length) {
			candidate.method = authored;
			for (const field of Object.keys(authored)) delete candidate[field];
		}
	} else if (procedureAlias && candidate.method && typeof candidate.method === "object" && !Array.isArray(candidate.method)) {
		for (const field of methodFields.filter(name => candidate[name] !== undefined)) {
			const nested = candidate.method[field];
			if (nested === undefined || JSON.stringify(nested) !== JSON.stringify(candidate[field])) {
				throw new Error(`candidate.${field} conflicts with canonical candidate.method.${field}; keep one nested authored value`);
			}
			delete candidate[field];
		}
	}
	// Periodic reviews use `candidate.kind` because the outer review entry owns
	// `component`. Direct changes and research deliveries use
	// `component`/`semantic_kind`. They are spelling aliases for one router.
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
	if (["tool", "task_tool"].includes(alias)) {
		candidate.semantic_kind = "computation";
		candidate.execution ??= candidate.program ? "pure_computation" : "adapter_operation";
	}
	if (["subagent", "task_subagent", "role"].includes(alias)) {
		candidate.semantic_kind = "role";
		candidate.execution ??= "model_delegation";
		candidate.reuse ??= "expected_reuse";
		candidate.reasoning ??= "open_ended";
	}
	if (["system_prompt", "task_system_prompt"].includes(alias)) {
		candidate.semantic_kind = "system_prompt";
		candidate.execution ??= "text";
		// An exact scope keyword is an opt-in shorthand for mechanical lifetime.
		// Descriptive scope text retains its existing meaning.
		if (["task", "episode", "level", "state"].includes(candidate.scope)) {
			if (candidate.validity !== undefined && candidate.validity?.scope !== candidate.scope)
				throw new Error("candidate.scope conflicts with candidate.validity.scope");
			candidate.validity ??= { scope: candidate.scope };
		}
		if (candidate.prompt_target_version === undefined && candidate.target_version !== undefined) {
			candidate.prompt_target_version = candidate.target_version;
		}
		if (candidate.prompt_target_version !== undefined && candidate.target_version !== undefined
			&& Number(candidate.prompt_target_version) !== Number(candidate.target_version)) {
			throw new Error("candidate.target_version conflicts with candidate.prompt_target_version for standalone system_prompt");
		}
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
	if (["fact", "plan"].includes(String(candidate.semantic_kind)) && candidate.atom !== undefined) {
		candidate.atom = normalizeHarnessMemoryAtom(candidate.atom);
		// The structured atom is authoritative. Native memory keeps its existing
		// text boundary by materializing only the atom value as deterministic text.
		candidate.content = canonicalTextBody(candidate.atom.value, "memory atom.value");
	}
	delete candidate.kind;
	delete candidate.current_version;
	return candidate;
}

function validateSystemPromptProjection(candidate: Record<string, any>, base: HarnessRouteTarget): void {
	if (base === "research_only") throw new Error("assessment and evidence deliveries are research_only and cannot become system_prompt");
	const evidenceRefs = candidate.system_prompt_basis?.evidence_refs;
	if (!Array.isArray(evidenceRefs) || !evidenceRefs.length
		|| evidenceRefs.some((ref: unknown) => !candidate.basis_refs?.includes(ref))) {
		throw new Error("system_prompt requires evidence-bound system_prompt_basis");
	}
}

/** Resolve every native target touched by one semantic change.  A system
 * prompt is an overlay, so it is deliberately compiled after its semantic
 * base target (memory, skill, tool, or subagent). */
export function classifyHarnessChangeTargets(candidate: Record<string, any>): HarnessRouteTarget[] {
	candidate = normalizeSemanticCandidate(candidate);
	const base = classifySemanticKind(candidate);
	if (base === "memory") normalizeHarnessMemoryAtom(candidate.atom);
	if (base === "system_prompt") return ["system_prompt"];
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
	if (action !== "research" && action !== "change") throw new Error("capability request.action must be research or change");
	const decision = value.decision;
	// Change candidates are already parent-authored semantic decisions. Requiring
	// a second wrapper object caused complete Tool/Subagent candidates from real
	// providers to be rejected before routing. Research remains explicit because
	// its question and scope are otherwise ambiguous. For change, derive only a
	// mechanical audit envelope; runtime still does not choose a carrier or invent
	// candidate content.
	if (action === "change" && (!decision || typeof decision !== "object" || Array.isArray(decision))) {
		const changes = Array.isArray(value.changes) ? value.changes : [];
		const candidates = changes.map((change: any) => change?.candidate).filter((candidate: any) => candidate && typeof candidate === "object");
		const basis_refs = [...new Set(candidates.flatMap((candidate: any) => Array.isArray(candidate.basis_refs) ? candidate.basis_refs.map(String) : []))];
		const reason = String(candidates.map((candidate: any) => candidate.reason ?? candidate.description ?? candidate.summary ?? "").find(Boolean) ?? "Parent-authored Harness component change").trim();
		const expected = String(candidates.map((candidate: any) => candidate.expected_effect ?? candidate.expected ?? "").find(Boolean) ?? "Apply the complete parent-authored component candidate").trim();
		return { action, changes: changes.map(normalizeHarnessChange), decision: { basis_refs, reason, expected } };
	}
	if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("capability request.decision is required for research");
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
	let value = input as Record<string, any>;
	if (value.candidate && typeof value.candidate === "object" && !Array.isArray(value.candidate)
		&& Object.prototype.hasOwnProperty.call(value.candidate, "operation")) {
		// A duplicate create is publication metadata, not component content.
		if (value.candidate.operation !== "create" || (value.operation !== undefined && value.operation !== "create"))
			throw new Error("candidate.operation may only repeat create consistently with change.operation; specify other operations on the change");
		if (["target_ref", "candidate_ref", "target_version", "prompt_target_version", "current_version", "update"]
			.some(field => field in value || field in value.candidate))
			throw new Error("redundant candidate.operation=create cannot include target/update references");
		const { operation: _redundantCreate, ...candidate } = value.candidate;
		value = { ...value, operation: "create", candidate };
	}
	if (value.operation === undefined) {
		const candidate = value.candidate;
		const updateFields = ["target_ref", "candidate_ref", "target_version", "prompt_target_version", "update"];
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
			|| updateFields.some(field => field in value || field in candidate)
			|| "operation" in candidate) {
			throw new Error("harness change.operation is required unless a complete new candidate has no target/update references");
		}
		return { operation: "create", candidate };
	}
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
			if (!Array.isArray(candidate.tools)) throw new Error("role requires an explicit tool set (empty is valid for pure reasoning)");
			return "subagent";
		case "system_prompt":
			if (candidate.execution !== "text") throw new Error("system_prompt must use text execution");
			return "system_prompt";
		case "assessment":
		case "evidence":
			return "research_only";
		default:
			if (candidate.semantic_kind === undefined && candidate.atom !== undefined) {
				throw new Error("ambiguous atom candidate: set candidate.semantic_kind to fact or plan explicitly, or remove conflicting component fields");
			}
			throw new Error(`unsupported semantic_kind: ${String(candidate.semantic_kind)}`);
	}
}
