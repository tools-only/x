/** Durable planning, progress, and working-set primitives for Auto-Research. */

export type ResearchNodeStatus = "pending" | "runnable" | "active" | "completed" | "failed" | "skipped" | "blocked";

export type ResearchPlanNode = {
	node_id: string;
	question: string;
	completion_contract: string;
	depends_on: string[];
	activation_policy: "after_dependencies" | "parent_release";
	released: boolean;
	status: ResearchNodeStatus;
	wait_reason?: string;
	result_ref?: string;
	session_ref?: string;
	[key: string]: unknown;
};

export type ResearchPlan = {
	format: "auto-research-plan-v1";
	plan_id: string;
	version: number;
	goal: string;
	complexity_assessment: { level: "simple" | "compound"; rationale: string; [key: string]: unknown };
	concurrency_limit: number;
	nodes: ResearchPlanNode[];
	recordedAt: string;
};

function assertText(value: unknown, field: string): string {
	const text = String(value ?? "").trim();
	if (!text) throw new Error(`${field} is required`);
	return text;
}

function assertNodeId(value: unknown): string {
	const id = assertText(value, "node_id");
	if (!/^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(id)) {
		throw new Error(`invalid research node_id: ${id}`);
	}
	return id;
}

function validateDag(nodes: ResearchPlanNode[]): void {
	const ids = new Set(nodes.map((node) => node.node_id));
	if (ids.size !== nodes.length) throw new Error("research plan node_id values must be unique");
	for (const node of nodes) {
		for (const dependency of node.depends_on) {
			if (!ids.has(dependency)) throw new Error(`unknown research dependency ${dependency} for ${node.node_id}`);
			if (dependency === node.node_id) throw new Error(`research node ${node.node_id} cannot depend on itself`);
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const byId = new Map(nodes.map((node) => [node.node_id, node]));
	const visit = (id: string) => {
		if (visiting.has(id)) throw new Error(`research plan dependency cycle at ${id}`);
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)?.depends_on ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const node of nodes) visit(node.node_id);
}

export function createResearchPlan(input: Record<string, any>, planId: string): ResearchPlan {
	const goal = assertText(input.goal, "research plan goal");
	const assessment = input.complexity_assessment;
	if (!assessment || !["simple", "compound"].includes(String(assessment.level))) {
		throw new Error("complexity_assessment.level must be simple or compound");
	}
	const rationale = assertText(assessment.rationale, "complexity_assessment.rationale");
	const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
	if (!rawNodes.length) throw new Error("research plan requires at least one node");
	if (assessment.level === "compound" && rawNodes.length < 2) {
		throw new Error("compound research goals must be decomposed into at least two nodes");
	}
	const nodes: ResearchPlanNode[] = rawNodes.map((raw: Record<string, any>) => ({
		...raw,
		node_id: assertNodeId(raw.node_id),
		question: assertText(raw.question, `research node ${String(raw.node_id)} question`),
		completion_contract: assertText(raw.completion_contract, `research node ${String(raw.node_id)} completion_contract`),
		depends_on: [...new Set((Array.isArray(raw.depends_on) ? raw.depends_on : []).map(assertNodeId))],
		activation_policy: raw.activation_policy === "parent_release" ? "parent_release" : "after_dependencies",
		released: raw.activation_policy !== "parent_release" && raw.released !== false,
		status: "pending",
	}));
	validateDag(nodes);
	return {
		format: "auto-research-plan-v1",
		plan_id: assertText(planId, "plan_id"),
		version: 1,
		goal,
		complexity_assessment: { ...assessment, level: assessment.level, rationale },
		concurrency_limit: Math.max(1, Math.floor(Number(input.concurrency_limit ?? 1) || 1)),
		nodes,
		recordedAt: new Date().toISOString(),
	};
}

function effectiveNodes(plan: ResearchPlan): ResearchPlanNode[] {
	const byId = new Map(plan.nodes.map((node) => [node.node_id, node]));
	return plan.nodes.map((node) => {
		if (["active", "completed", "failed", "skipped", "blocked"].includes(node.status)) return { ...node };
		if (node.wait_reason === "child_pending") return { ...node, status: "pending" };
		const dependencies = node.depends_on.map((id) => byId.get(id)!);
		if (dependencies.some((dependency) => ["failed", "skipped", "blocked"].includes(dependency.status))) {
			return { ...node, status: "blocked", wait_reason: "dependency_failed" };
		}
		if (dependencies.some((dependency) => dependency.status !== "completed")) {
			return { ...node, status: "pending", wait_reason: "dependencies" };
		}
		if (node.activation_policy === "parent_release" && !node.released) {
			return { ...node, status: "pending", wait_reason: "parent_release" };
		}
		return { ...node, status: "runnable", wait_reason: undefined };
	});
}

export function researchPlanView(plan: ResearchPlan): Record<string, any> {
	const nodes = effectiveNodes(plan);
	const activeCount = nodes.filter((node) => node.status === "active").length;
	const available = Math.max(0, plan.concurrency_limit - activeCount);
	const runnable = nodes.filter((node) => node.status === "runnable");
	return {
		format: plan.format,
		plan_ref: `research_plan:${plan.plan_id}@v${plan.version}`,
		goal: plan.goal,
		complexity_assessment: plan.complexity_assessment,
		concurrency_limit: plan.concurrency_limit,
		active_count: activeCount,
		available_slots: available,
		runnable_node_ids: runnable.map((node) => node.node_id),
		schedulable_node_ids: runnable.slice(0, available).map((node) => node.node_id),
		nodes: Object.fromEntries(nodes.map((node) => [node.node_id, node])),
	};
}

export function transitionResearchNode(
	plan: ResearchPlan,
	nodeId: string,
	status: ResearchNodeStatus,
	patch: Record<string, unknown> = {},
): ResearchPlan {
	const view = researchPlanView(plan);
	const current = view.nodes[nodeId] as ResearchPlanNode | undefined;
	if (!current) throw new Error(`unknown research plan node: ${nodeId}`);
	if (status === "active" && current.status !== "runnable") {
		throw new Error(`research node ${nodeId} is not runnable: ${current.wait_reason ?? current.status}`);
	}
	const nodes = plan.nodes.map((node) => node.node_id === nodeId ? { ...node, ...patch, status } : { ...node });
	return { ...plan, version: plan.version + 1, nodes, recordedAt: new Date().toISOString() };
}

export function releaseResearchNode(plan: ResearchPlan, nodeId: string): ResearchPlan {
	if (!plan.nodes.some((node) => node.node_id === nodeId)) throw new Error(`unknown research plan node: ${nodeId}`);
	return {
		...plan,
		version: plan.version + 1,
		nodes: plan.nodes.map((node) => node.node_id === nodeId ? { ...node, released: true } : { ...node }),
		recordedAt: new Date().toISOString(),
	};
}

function jsonChars(value: unknown): number {
	return JSON.stringify(value).length;
}

/** Build a bounded provider working set without dropping decision-critical state. */
export function buildResearchWorkset(input: Record<string, any>, maxChars: number): Record<string, any> {
	if (!Number.isFinite(maxChars) || maxChars < 256) throw new Error("research workset maxChars must be at least 256");
	const required: Record<string, any> = {
		format: "auto-research-workset-v1",
		serialized_chars: 0,
		goal: assertText(input.goal, "research goal"),
		constraints: Array.isArray(input.constraints) ? input.constraints : [],
		current_node: input.current_node ?? null,
		checkpoint: input.checkpoint ?? null,
		...(input.research_checkpoint !== undefined ? { research_checkpoint: input.research_checkpoint } : {}),
		...(input.research_state !== undefined ? { research_state: input.research_state } : {}),
		...(input.cross_context_comparison !== undefined ? { cross_context_comparison: input.cross_context_comparison } : {}),
		resource_refs: [...new Set((Array.isArray(input.resource_refs) ? input.resource_refs : []).map(String))],
		evidence_refs: [...new Set((Array.isArray(input.evidence_refs) ? input.evidence_refs : []).map(String))],
		projection: {
			requested_max_chars: Math.floor(maxChars),
			serialized_chars: 0,
			truncated: false,
			retrieve_on_demand: false,
		},
	};
	if (jsonChars(required) > maxChars) {
		throw new Error("required research goal, constraints, checkpoint, and references exceed the provider input budget");
	}
	const fullContext = String(input.selected_context ?? "");
	let low = 0;
	let high = fullContext.length;
	let best = "";
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = { ...required, selected_context: fullContext.slice(0, middle) };
		candidate.projection = { ...required.projection,
			truncated: middle < fullContext.length,
			retrieve_on_demand: middle < fullContext.length,
			next_offset: middle < fullContext.length ? middle : null,
			serialized_chars: 0 };
		candidate.projection.serialized_chars = jsonChars(candidate);
		candidate.serialized_chars = jsonChars(candidate);
		if (candidate.projection.serialized_chars <= maxChars) {
			best = candidate.selected_context;
			low = middle + 1;
		} else high = middle - 1;
	}
	const result = { ...required, selected_context: best };
	result.projection = { ...required.projection,
		truncated: best.length < fullContext.length,
		retrieve_on_demand: best.length < fullContext.length,
		next_offset: best.length < fullContext.length ? best.length : null,
		serialized_chars: 0 };
	result.serialized_chars = 0;
	result.projection.serialized_chars = jsonChars(result);
	result.serialized_chars = jsonChars(result);
	// Digit growth in serialized_chars can add a few bytes after measurement.
	while (jsonChars(result) > maxChars && result.selected_context.length) {
		result.selected_context = result.selected_context.slice(0, -1);
		result.projection.next_offset = result.selected_context.length;
		result.projection.serialized_chars = jsonChars(result);
		result.serialized_chars = jsonChars(result);
	}
	result.projection.serialized_chars = jsonChars(result);
	result.serialized_chars = jsonChars(result);
	return result;
}

const PROGRESS_KEYS = [
	"cursor", "status", "draft_findings", "supported_findings", "unresolved_questions", "next_step",
	"evidence_refs", "selected_resource_refs", "wait_for", "resume_condition",
];

function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
}

function semanticCheckpoint(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const checkpoint = value as Record<string, unknown>;
	const draftFindings = Array.isArray(checkpoint.draft_findings) ? checkpoint.draft_findings : [];
	const evidenceRefs = Array.isArray(checkpoint.evidence_refs) ? checkpoint.evidence_refs : [];
	// The child runtime creates this recovery marker when the provider cuts off
	// before any submitted checkpoint. It enables resumption but is not research
	// progress and must not reset the stagnation counter.
	if (checkpoint.pause_reason === "provider_stop_reason_length"
		&& checkpoint.cursor === "provider-output-length"
		&& draftFindings.length === 0 && evidenceRefs.length === 0) return {};
	return Object.fromEntries(PROGRESS_KEYS.filter((key) => checkpoint[key] !== undefined)
		.map((key) => [key, stable(checkpoint[key])]));
}

export function compareResearchProgress(before: unknown, after: unknown): { advanced: boolean; reason: string; fingerprint: string } {
	const previous = JSON.stringify(semanticCheckpoint(before));
	const current = JSON.stringify(semanticCheckpoint(after));
	const advanced = previous !== current && current !== "{}";
	return {
		advanced,
		reason: advanced ? "semantic_checkpoint_advanced" : "semantic_checkpoint_unchanged",
		fingerprint: current,
	};
}
