/** Deterministic model boundary for the real ARC self-harness smoke runner.
 *
 * Only the provider is mocked.  The official ARC bridge, Pi parent, broker,
 * Pi children, structured report parser, parent creator gate and change classifier, native harness tools,
 * action boundaries, and next-turn context projection are production paths.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { baselineMethodCatalog } from "../demo/pi_harness_baseline_methods.ts";

type Step =
	| { kind: "tool"; name: string; arguments: Record<string, unknown> }
	| { kind: "batch"; calls: Array<{ name: string; arguments: Record<string, unknown> }> }
	| { kind: "text"; text: string }
	| { kind: "length"; text: string; thinkingOnly?: boolean };

const scenario = String(process.env.PI_ARC_SMOKE_SCENARIO ?? "memory");
const root = String(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
const evidenceRef = "execution-observation-1";
const researchScope = process.env.PI_ARC_SMOKE_SCOPE ?? "harness_component";
const crossContextMethod = process.env.PI_ARC_SMOKE_CROSS_CONTEXT_METHOD === "1";
const continuousMemoryPool = process.env.PI_ARC_SMOKE_MEMORY_POOL === "1";
const pureExpressionScenario = scenario === "pure_expression";
const minimalFivePublishScenario = scenario === "minimal_five_publish";
const selectedSnapshotScenario = scenario === "selected_snapshot";
const simpleCoordinateScenario = scenario === "simple_coordinate_input";
const minimalFivePoolScenario = scenario === "minimal_five_pool" || minimalFivePublishScenario;
const directDevelopmentScenario = scenario === "direct_development_intent";
const onlineRetrospectiveScenario = scenario === "online_retrospective";
const actionAlignmentScenario = scenario === "action_alignment";
const continuousWorkers = process.env.PI_ARC_SMOKE_WORKERS === "1";
let workerParentPhase = 0;

function continuousWorkerStep(request: number): Step {
	const worker = JSON.parse(process.env.PI_AUTO_RESEARCH_WORKER || "{}");
	if (process.env.PI_TASK_CHILD === "1") {
		const offered: string[] = worker.offered_refs ?? [];
		const first = worker.run_ids?.length === 1;
		const refuter = worker.worker_id === "counterexamples";
		const report: Record<string, any> = first || refuter ? {
			format: "auto-research-report-v1", status: "provisional", findings: [], evidence_refs: offered,
			conclusion: refuter ? "WORKER_B: a competing explanation remains possible; preserve this disagreement."
				: "WORKER_A: initial rule hypothesis needs a later discriminating observation.",
			alternatives: [refuter ? "WORKER_A may be right within narrower scope" : "WORKER_B remains an independent counterexample search"],
			limitations: ["Scripted provider establishes lifecycle and evidence routing only."], validation_plan: "Compare the next exact evidence batch.", method_candidates: [],
		} : { ...reportFor(deliveryFor("tools")), evidence_refs: offered,
			conclusion: offered.some(ref => ref.startsWith("effect_assessment:"))
				? "WORKER_FEEDBACK: actual counter output and assessment returned on the same research line."
				: "WORKER_METHOD: a bounded enabled-record counter is ready for parent creator, assembly and semantic trial." };
		report.research_progress = { topic: "bounded ARC method", question: "Track hypotheses and actual method feedback.",
			status: "continue", parent_relevance: "now", hypothesis: report.conclusion,
			evidence_refs: offered, next_step: "Continue on fresh action/assessment evidence while preserving WORKER_A/WORKER_B alternatives." };
		if (request === 0) return { kind: "tool", name: "publish_research_update", arguments: {
			report, priority: refuter ? "urgent" : "current", consumed_evidence_refs: offered,
		} };
		if (first && request === 1) {
			const prior = jsonl(join(root, "auto-research-updates.jsonl")).find(row => row.worker_id === worker.worker_id && row.lifecycle === "active");
			return { kind: "tool", name: "publish_research_update", arguments: {
				report: { ...report, status: "inconclusive", conclusion: refuter
					? "WORKER_B_WITHDRAWAL: retract the claimed counterexample; independent alternatives remain unresolved."
					: "WORKER_A_REVISION: narrow the initial rule hypothesis; keep the competing explanation." },
				priority: "current", [refuter ? "withdraws_ref" : "revises_ref"]: `research_update:${prior.update_id}@v${prior.version}`,
			} };
		}
		if (first) return { kind: "tool", name: "research_checkpoint", arguments: { action: "pause",
			cursor: "await-next-ARC-batch", reason: "Need later exact environment evidence", wait_for: "next_parent_evidence",
			next_step: "Retain competing explanations and recheck the next batch.",
			draft_findings: ["PERSISTENT_WORKER_COUNTEREXAMPLE"], consumed_evidence_refs: offered } };
		return { kind: "tool", name: "submit_research_report", arguments: { report } };
	}
	const initial: Step[] = [
		{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
		{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Collect one canonical observation for assigned responsibilities." } },
		readBaseline("research-orchestration"),
		...["rules", "counterexamples"].map(id => ({ kind: "tool" as const, name: "auto_research", arguments: {
			action: "assign", research_line_ref: "research_line:continuous-smoke@v1", question: "Track rule alternatives and method use across stages.",
			scope: "research_method", evidence_refs: [evidenceRef],
			assignment: { worker_id: id, responsibility: id === "rules" ? "Rule and reusable method analysis" : "Independent counterexample tracking",
				handle_periodic_reviews: id === "rules", max_runs: 6, max_output_tokens: 8000,
				evidence_kinds: ["observation", "effect_assessment", "harness_observation"], stop_when: "Parent revokes after real semantic feedback." } } })),
	];
	if (request < initial.length) return initial[request];
	const workers = [...new Map(jsonl(join(root, "auto-research-workers.jsonl")).map(row => [row.worker_id, row])).values()];
	const sessions = [...new Map(jsonl(join(root, "auto-research-sessions.jsonl")).map(row => [row.session_id, row])).values()];
	const rule = workers.find(row => row.worker_id === "rules");
	const counter = workers.find(row => row.worker_id === "counterexamples");
	const poll: Step = { kind: "tool", name: "auto_research", arguments: { action: "workers" } };
	if (workerParentPhase === 0) {
		if (workers.length < 2 || workers.some(w => sessions.find(s => s.session_id === w.session_id)?.status !== "pending")) return poll;
		workerParentPhase++;
		return { kind: "tool", name: "arc_actions", arguments: { actions: Array.from({ length: 5 }, (_, index) => ({
			action: index === 4 ? "RESET" : "ACTION2", reasoning: "Advance/reset real ARC while historical periodic analysis belongs to the authorized worker." })) } };
	}
	if (workerParentPhase === 1) {
		if (!rule?.last_report_ref || !counter?.last_report_ref) return poll;
		workerParentPhase++; return readBaseline("tool-creator");
	}
	if (workerParentPhase === 2) {
		workerParentPhase++;
		const candidate = parentCandidate("tools");
		candidate.basis_refs = [evidenceRef, rule.last_report_ref];
		return { kind: "tool", name: "task_harness_create", arguments: { candidate,
			decision: { basis_refs: [rule.last_report_ref], reason: "Parent adopts the worker method through the real tool creator.", expected: "Exact counter version ready for explicit assembly." } } };
	}
	if (workerParentPhase === 3) { workerParentPhase++; return assemble("tool:smoke-counter@v1"); }
	if (workerParentPhase === 4) { workerParentPhase++; return { kind: "tool", name: "task_tool_smoke-counter_v1", arguments: {
		input: { items: [{ value: "a", enabled: true }, { value: "b", enabled: false }, { value: "c", enabled: true }] } } }; }
	if (workerParentPhase === 5) { workerParentPhase++; return { kind: "tool", name: "task_harness", arguments: {
		action: "assess_effect", verdict: "supported", consequence: "The exact assembled tool returned numeric count 2.", remaining_uncertainty: "One bounded input, no game-quality claim." } }; }
	if (workerParentPhase === 6) { workerParentPhase++; return { kind: "tool", name: "arc_action", arguments: {
		action: "ACTION3", reasoning: "Record later ARC evidence after component trial." } }; }
	if (workerParentPhase === 7) {
		if (!jsonl(join(root, "auto-research-updates.jsonl")).some(row => row.worker_id === "rules"
			&& row.lifecycle === "completed" && row.report?.conclusion?.includes("WORKER_FEEDBACK"))) return poll;
		workerParentPhase++; return { kind: "tool", name: "auto_research", arguments: {
			action: "revoke", worker_ref: `research_worker:${counter.worker_id}@v${counter.version}` } };
	}
	if (workerParentPhase === 8) { workerParentPhase++; return { kind: "tool", name: "auto_research", arguments: {
		action: "revoke", worker_ref: `research_worker:${rule.worker_id}@v${rule.version}` } }; }
	if (workerParentPhase === 9) { workerParentPhase++; return { kind: "tool", name: "arc_action", arguments: {
		action: "ACTION1", reasoning: "Finish after verifying persistent evidence, semantic use and explicit revocation." } }; }
	return { kind: "text", text: "Continuous workers lifecycle complete." };
}
const round2Recovery = process.env.PI_ARC_SMOKE_ROUND2_RECOVERY === "1";
const methodRejection = process.env.PI_ARC_SMOKE_METHOD_REJECTION === "1";
const methodLifecycle = process.env.PI_ARC_SMOKE_METHOD_LIFECYCLE === "1" || crossContextMethod;
const methodConstructionRefs = crossContextMethod
	? ["execution-observation-1", "execution-observation-4"] : [evidenceRef];
const methodContrastRefs = crossContextMethod ? ["execution-observation-3"] : [];
const methodEvidenceRefs = [...methodConstructionRefs, ...methodContrastRefs];
const baselineRef = (name: string) => baselineMethodCatalog().find((item) => item.name === name)?.method_ref;
const readBaseline = (name: string): Step => ({ kind: "tool", name: "task_harness", arguments: {
	action: "read_method", method_name: name,
	...(baselineRef(name) ? { expected_sha256: String(baselineRef(name)).split(":sha256:")[1] } : {}),
} });

const scenarioResourceRefs: Record<string, string> = {
	memory: "memory:smoke-memory@v1",
	skills: "skill:smoke-skill@v1",
	tools: "tool:smoke-counter@v1",
	subagents: "subagent:smoke-reviewer@v1",
	system_prompt: "system_prompt:smoke-core-rule@v1",
	pure_expression: "tool:smoke-frame-row-count@v1",
};

const minimalPoolRefs = {
	memory: "memory:pool-memory@v1",
	skill: "skill:pool-skill@v1",
	tool: "tool:pool-tool@v1",
	subagent: "subagent:pool-reviewer@v1",
	systemPrompt: "system_prompt:pool-rule@v1",
};

const directIntentId = "smoke-direct-counter";
const directToolRef = "tool:direct-enabled-counter@v1";

function directIntent(status: "open" | "resolved", nextStep?: string): Step {
	return { kind: "tool", name: "task_harness", arguments: { action: "development_intent",
		development_intent: { operation_id: directIntentId,
			purpose: "Count enabled records for one bounded parent decision without delegating component authoring.",
			status, ...(nextStep ? { next_step: nextStep } : {}),
			...(status === "resolved" ? { reason: "The explicitly assembled counter returned the expected semantic count 2.",
				resource_refs: [directToolRef] } : {}) } } };
}

function directMemoryChange(update: boolean): Step {
	return { kind: "tool", name: "task_harness", arguments: { action: "change", changes: [{
		operation: update ? "update" : "create", candidate: {
			component: "memory", key: "direct-counter-context", name: "direct-counter-context",
			...(update ? { target_version: 1 } : {}), validity: smokeValidity(),
			content: update ? "SMOKE_DIRECT_MEMORY_V2: count only explicitly enabled records."
				: "SMOKE_DIRECT_MEMORY_V1: a bounded record count may be useful.",
			atom: { subject: "direct-counter", predicate: "counting-rule",
				value: update ? "enabled-only" : "candidate" },
			projection: { channel: "task_prompt", layer: "task_state" },
			expected_effect: "Preserve a task-local observation without resolving the development intent." } }],
		decision: { basis_refs: [evidenceRef], reason: "The parent records and revises task context independently of capability development.",
			expected: "Memory gains an exact version; the direct development intent remains open." } } };
}

function directToolChange(): Step {
	const candidate = { ...minimalPoolCandidates()[2], name: "direct-enabled-counter",
		expected_effect: "An explicitly assembled parent-authored counter returns 2 for two enabled records." };
	return { kind: "tool", name: "task_harness", arguments: { action: "change",
		changes: [{ operation: "create", candidate }],
		decision: { basis_refs: [evidenceRef], reason: "The parent read tool-creator and authored the smallest useful bounded counter.",
			expected: "Store one exact Tool version without selecting or invoking it automatically." } } };
}

function minimalPoolCandidates(): Record<string, unknown>[] {
	const creator = (name: string) => baselineRef(name);
	const validity = smokeValidity();
	return [
		{ component: "memory", key: "pool-memory", name: "pool-memory", validity,
			content: "SMOKE_POOL_MEMORY: an explicitly authored untested fact.",
			atom: { subject: "pool", predicate: "memory-status", value: "SMOKE_POOL_MEMORY" },
			projection: { channel: "task_prompt", layer: "task_state" },
			expected_effect: "the authored memory is visible after explicit assembly" },
		{ component: "skill", name: "pool-skill", description: "Use when one currently advertised ARC action must be selected and checked.",
			instructions: "SMOKE_POOL_SKILL: inspect the current advertised actions, then choose one bounded action.",
			authoring_method_ref: creator("skill-creator"), expected_effect: "the exact skill version is available after assembly" },
		{ component: "tool", name: "pool-tool", description: "Count enabled values in a bounded input.",
			input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] },
			output_schema: { type: "number" }, execution: "pure_computation",
			program: { steps: [{ kind: "pick", source: "input", field: "items" },
				{ kind: "filter", field: "enabled", equals: true }, { kind: "count" }] },
			authoring_method_ref: creator("tool-creator"), expected_effect: "the exact Pi tool version is executable after assembly" },
		{ component: "subagent", name: "pool-reviewer", description: "A clean-context bounded reviewer.",
			instructions: "Return one concise answer to the parent question from explicitly granted context.",
			tools: [], context_recipe: { include_checkpoint: false, recent_observations: 0, recent_actions: 0,
				inherit_harness_refs: [], output_contract: "one concise answer", max_chars: 12000 },
			authoring_method_ref: creator("subagent-creator"), expected_effect: "the exact role can be delegated after assembly" },
		{ component: "system_prompt", name: "pool-rule", content: "SMOKE_POOL_SYSTEM: use only actions advertised by current ARC state.",
			scope: "this deterministic ARC smoke task",
			expected_effect: "the standalone system-prompt component is visible after explicit assembly" },
	];
}

function minimalPoolChange(): Step {
	return { kind: "tool", name: "task_harness", arguments: {
		action: "change", changes: minimalPoolCandidates().map(candidate => ({ operation: "create", candidate })),
		...(minimalFivePublishScenario ? { assembly: { expected_assembly_revision: 0,
			selected_resource_refs: [], prompt_contributions: [] } } : {}),
		decision: { basis_refs: [evidenceRef], reason: "The parent authored one minimal candidate for each native Harness component kind.",
			expected: "Persist five exact untested component versions without inventing a universal method dossier." },
	} };
}


function assemble(ref: string | string[], expectedRevision = 0): Step {
	const refs = Array.isArray(ref) ? ref : [ref];
	return { kind: "tool", name: "task_harness", arguments: {
		action: "assemble",
		expected_assembly_revision: expectedRevision,
		selected_resource_refs: refs,
		prompt_contributions: [],
		decision: {
			basis_refs: [evidenceRef],
			reason: `Select ${refs.join(", ")} for the next bounded smoke use.`,
			expected: "Only the exact selected component version enters the active Harness.",
		},
	} };
}

function methodForSmoke(): Record<string, unknown> {
	return {
		problem: crossContextMethod
			? "Choose one bounded next ARC action and preserve a visible prediction that can be checked after use."
			: "Count enabled items without retaining unrelated item fields.",
		applicability: crossContextMethod
			? "Use when reset-separated public cases and the current available-action set support one bounded discriminating action."
			: "Use when a caller needs a deterministic count from records whose enabled field is declared.",
		abstain_when: crossContextMethod
			? "Abstain when the current action is unavailable, the visible prediction cannot be checked, or the compared cases lack a material contrast."
			: "Reject rather than infer when the declared enabled field is absent or malformed.",
		abstraction_scope: crossContextMethod ? "cross_context" : "bounded_reuse",
		inputs: [crossContextMethod
			? "reset-separated ARC action cases, one contrast case, and the current available-action set"
			: "a bounded list of items with enabled and value fields"],
		invariants: [crossContextMethod
			? "the chosen action, prediction, and falsifier remain bound to one exact adopted procedure version"
			: "only enabled items contribute to the count"],
		parameters: [crossContextMethod ? "the current pre-state and available actions" : "the input item list"],
		steps: crossContextMethod
			? ["compare the reset-separated action effects", "select one available action", "state a visible prediction and falsifier", "execute once", "compare the result"]
			: ["select items", "filter enabled items", "select values", "count results"],
		decision_points: [crossContextMethod ? "which available action best tests the bounded pattern" : "whether each item is enabled"],
		stop_conditions: [crossContextMethod ? "one selected action has produced a visible transition" : "the numeric count is returned"],
		failure_modes: [crossContextMethod ? "the selected action is unavailable or the prediction is not observable" : "disabled items are counted or enabled items are omitted"],
		construction_evidence_refs: methodConstructionRefs,
		contrast_evidence_refs: methodContrastRefs,
		next_use: crossContextMethod ? "read the adopted procedure and execute its selected action on the next real parent turn"
			: "invoke the routed counter on the next real parent turn",
		predicted_semantic_result: crossContextMethod
			? "the next parent action equals NEXT_ACTION and its visible transition can be compared with PREDICTION"
			: methodRejection ? "the fixture input returns numeric count 3 (deliberate negative-control prediction)" : "the fixture input returns numeric count 2",
		falsifier: crossContextMethod
			? "the parent executes a different action, omits the exact procedure version, or records no checkable visible result"
			: "the routed tool returns any value other than 2",
	};
}

function smokeValidity() {
	const task = JSON.parse(readFileSync(join(root, ".task-scope.json"), "utf8")).task_id;
	return { scope: "task", task_ref: task, instance_ref: task };
}

function smokeActionMethod() {
	return { problem: "Select one available action for a bounded wiring probe",
		applicability: "Use when one currently advertised action can test the ARC bridge wiring without asserting game semantics.",
		abstain_when: "Abstain when no advertised action has a visible receipt or the environment is terminal.",
		abstraction_scope: "bounded_reuse",
		inputs: ["current public action set"], invariants: ["parent alone acts"], parameters: ["action"],
		steps: ["Inspect available actions", "Choose one available action", "Record the returned transition"],
		decision_points: ["If no action is available, abstain"], stop_conditions: ["one transition or error"],
		failure_modes: ["unavailable action; stop and inspect"], construction_evidence_refs: [evidenceRef],
		contrast_evidence_refs: [], next_use: "next parent action when an action is available",
		predicted_semantic_result: "one public transition receipt", falsifier: "no transition receipt" };
}

function smokeSubagentMethod() {
	return { problem: "Obtain an independent bounded review in a clean read-only context",
		applicability: "Use when an independent reading of explicitly granted evidence can change a parent decision.",
		abstain_when: "Return an access gap rather than infer when the needed evidence is not granted.",
		abstraction_scope: "bounded_reuse",
		inputs: ["one parent question", "explicit evidence grants"], invariants: ["child cannot act or mutate Harness"],
		parameters: ["question", "evidence refs"], steps: ["inspect only granted evidence", "compare alternatives", "return a concise result and uncertainty"],
		decision_points: ["whether the evidence resolves the question"], stop_conditions: ["one bounded report is returned"],
		failure_modes: ["repeating the parent narrative without checking evidence"], construction_evidence_refs: [evidenceRef],
		contrast_evidence_refs: [], next_use: "when an independent read-only review can change a parent decision",
		predicted_semantic_result: "one concise independent result", falsifier: "the delegated result contains no answer or evidence boundary" };
}

function pureExpressionMethod() {
	return { problem: "Count the rows in one exact bounded numeric matrix without host code",
		applicability: "Use when a caller supplies an exact-version numeric matrix and needs its row count.",
		abstain_when: "Reject rather than infer when the bound value is not a numeric matrix.",
		abstraction_scope: "bounded_reuse",
		inputs: ["one exact-version numeric matrix binding"], invariants: ["the input snapshot remains immutable"],
		parameters: ["grid binding"], steps: ["bind the exact matrix", "return its array length"],
		decision_points: ["whether the bound value satisfies the declared schema"],
		stop_conditions: ["one finite row count is returned"],
		failure_modes: ["the binding is absent, stale provenance is hidden, or the value violates the schema"],
		construction_evidence_refs: ["observation_snapshot:parent-state-1@v1"], contrast_evidence_refs: [],
		next_use: "repeat against the same exact snapshot after a later ARC decision cycle",
		predicted_semantic_result: "the output equals the number of rows in public_state.frames[0]",
		falsifier: "the output differs from the bound frame row count" };
}

function pureExpressionCandidate(): Record<string, unknown> {
	return {
		semantic_kind: "tool", name: "smoke-frame-row-count",
		authoring_method_ref: baselineRef("tool-creator"),
		validity: smokeValidity(), method: pureExpressionMethod(),
		summary: "Count rows in an exact immutable numeric frame.",
		content: "Bind one exact numeric frame and return its row count.",
		description: "Bounded exact-snapshot frame row counter.",
		reasoning: "none", execution: "pure_computation", context_visibility: "on_demand",
		input_schema: { type: "object", properties: {
			grid: { type: "array", items: { type: "array", items: { type: "number" } } },
		}, required: ["grid"], additionalProperties: false },
		output_schema: { type: "number" },
		program: { format: "task-pure-expression-v1", limits: {}, expression: {
			op: "length", value: { op: "get", value: { op: "input" }, key: { op: "literal", value: "grid" } },
		} },
		basis_refs: ["observation_snapshot:parent-state-1@v1"],
		expected_effect: "return the exact bound frame's row count under bounded pure evaluation",
		reconsider_when: "the frame path or declared numeric matrix schema changes",
	};
}

const recoveredSkillRef = "skill:smoke-recovered-procedure@v1";
const recoveredSkillInstructions = [
	"SMOKE_RECOVERED_SKILL_MARKER: use the recovered parent-authored procedure.",
	"NEXT_ACTION: ACTION2",
	"PREDICTION: the selected action produces a visible public transition",
	"FALSIFIER: the selected action produces no visible public transition",
	"Read the current advertised actions, use ACTION2 only while available, and compare the actual public result with the prediction.",
].join("\n");

function recoveredSkillMethod() {
	return { problem: "Choose one bounded advertised ARC action and preserve a checkable prediction after review recovery",
		applicability: "Use when ACTION2 is currently advertised and one real transition can test the recovered procedure.",
		abstain_when: "Abstain when ACTION2 is unavailable or the predicted public change cannot be observed.",
		abstraction_scope: "single_situation",
		inputs: ["the current public available-action set"], invariants: ["the parent remains the only ARC actor"],
		parameters: ["one advertised action"],
		steps: ["read the current advertised actions", "select ACTION2 only when available", "state prediction and falsifier", "execute once", "compare the public result"],
		decision_points: ["whether ACTION2 remains advertised"], stop_conditions: ["one real transition is recorded"],
		failure_modes: ["the action is unavailable or the result is not compared with the prediction"],
		construction_evidence_refs: ["execution-observation-1", "execution-observation-2", "execution-observation-3", "execution-observation-4", "execution-observation-5"],
		contrast_evidence_refs: [], next_use: "the next real parent ARC decision after exact assembly and focus",
		predicted_semantic_result: "ACTION2 produces a visible public transition",
		falsifier: "ACTION2 produces no visible public transition" };
}

function recoveredSkillCandidate(): Record<string, unknown> {
	return { semantic_kind: "skill", name: "smoke-recovered-procedure",
		description: "Parent-authored bounded ARC action procedure recovered after a failed review window.",
		instructions: recoveredSkillInstructions, method: recoveredSkillMethod(),
		authoring_method_ref: baselineRef("skill-creator"),
		basis_refs: ["execution-observation-1", "execution-observation-2", "execution-observation-3", "execution-observation-4", "execution-observation-5"],
		expected_effect: "select one advertised action and preserve a real result for later assessment",
		reconsider_when: "ACTION2 is unavailable or the recorded result contradicts the bounded prediction" };
}

function reviewDrafts(): Record<string, any>[] {
	return jsonl(join(root, "task-harness-review-drafts.jsonl"));
}

function latestReviewDraft(): Record<string, any> | undefined {
	return reviewDrafts().findLast((item) => item.opportunity_id === "harness-opportunity-1") ?? reviewDrafts().at(-1);
}

function recoveredSkillUseObservationRef(): string | undefined {
	return jsonl(join(root, "execution-observations.jsonl")).findLast((item) => item.tool_name === "arc_action"
		&& Array.isArray(item.input?.decision?.basis_refs)
		&& item.input.decision.basis_refs.includes(recoveredSkillRef))?.observation_id;
}

function invalidRecoveryReview(): Step {
	return { kind: "tool", name: "task_harness", arguments: {
		action: "review",
		review: [{ component: "skill", disposition: "create",
			reason: "Five real transitions suggest a reusable bounded action-selection method.",
			next_use: "Use the recovered procedure for one later real ARC action.",
			validation: "Compare the later public ARC result with the declared prediction and falsifier.",
			candidate: { semantic_kind: "procedure", name: "smoke-recovered-procedure",
				description: "Incomplete method candidate intentionally preserved for recovery." } }],
		transition_analysis: {
			observed_changes: "Five real ARC transitions were recorded in the current review window.",
			predictive_rules: "A bounded advertised-action procedure may preserve a checkable next-use prediction; this remains unvalidated.",
			limiting_uncertainty: "No later use of the proposed method has occurred.",
			next_experiment: "Author one complete procedural Skill, use it once, and compare the actual transition with its prediction.",
			capability_opportunities: "Create one parent-authored procedural Skill for bounded advertised-action selection.",
			research_kind: "capability",
			evidence_refs: ["execution-observation-1", "execution-observation-2", "execution-observation-3", "execution-observation-4", "execution-observation-5"],
		},
	} };
}

function patchRecoveryReview(stage: 1 | 2): Step {
	const draft = latestReviewDraft();
	const revision = Number(draft?.revision ?? stage);
	const set = stage === 1
		? { "candidate.semantic_kind": "skill", "candidate.instructions": recoveredSkillInstructions }
		: { "candidate.method": recoveredSkillMethod() };
	return { kind: "tool", name: "task_harness", arguments: {
		action: "review", opportunity_id: draft?.opportunity_id ?? "harness-opportunity-1",
		review_draft_ref: draft?.draft_ref ?? `review_draft:missing@v${revision}`,
		expected_draft_revision: revision,
		review_patch: [{ review_index: 0, set }],
	} };
}

function staleRecoveryReviewPatch(): Step {
	const first = reviewDrafts()[0];
	return { kind: "tool", name: "task_harness", arguments: {
		action: "review", opportunity_id: first?.opportunity_id ?? "harness-opportunity-1",
		review_draft_ref: first?.draft_ref ?? "review_draft:missing@v1",
		expected_draft_revision: Number(first?.revision ?? 1),
		review_patch: [{ review_index: 0, set: {
			"candidate.authoring_method_ref": baselineRef("skill-creator"),
		} }],
	} };
}

function firstObservationSnapshotRef(): string {
	const first = jsonl(join(root, "observation-snapshots.jsonl"))[0];
	return first
		? `observation_snapshot:${String(first.snapshot_id)}@v${Number(first.version ?? 1)}`
		: "observation_snapshot:parent-state-1@v1";
}

function deliveryFor(name: string): Record<string, unknown> {
	const creatorRef = (creator: string) => baselineRef(creator);
	const common = {
		validity: smokeValidity(),
		format: "auto-research-harness-delivery-v1",
		delivery_id: `smoke-${name.replaceAll("_", "-")}`,
		operation: "create",
		scope: { kind: "task_wide", statement: "this deterministic ARC smoke task" },
		trigger: "the routed component is exercised on the next real parent turn",
		exclusions: ["outside this ARC smoke task"],
		stability: "stable_in_scope",
		reuse: "expected_reuse",
		basis_refs: [evidenceRef],
		reconsider_when: "the deterministic smoke contract changes",
	};
	if (name === "memory") return {
		...common, semantic_kind: "fact", name: "smoke-memory",
		summary: "A routed fact visible to the next ARC turn.",
		content: "SMOKE_MEMORY_MARKER: route-to-memory succeeded.",
		atom: { subject: "smoke-routing", predicate: "memory-route-status",
			value: "SMOKE_MEMORY_MARKER: route-to-memory succeeded." },
		reasoning: "none", execution: "text", context_visibility: "always",
		prompt_channel: "task_prompt",
		prompt_layer: "task_policy",
		expected_effect: "the next parent turn receives SMOKE_MEMORY_MARKER",
	};
	if (name === "skills") return {
		...common, semantic_kind: "procedure", name: "smoke-skill",
		method: smokeActionMethod(),
		authoring_method_ref: creatorRef("skill-creator"),
		summary: "A routed procedure visible to the next ARC turn.",
		content: "SMOKE_SKILL_MARKER: inspect the current state, then make one ARC action.",
		description: "Deterministic next-turn smoke procedure.",
		reasoning: "bounded_judgment", execution: "text", context_visibility: "on_demand",
		expected_effect: "the next parent turn can inspect SMOKE_SKILL_MARKER",
	};
	if (name === "tools" && crossContextMethod) return {
		...common,
		method: methodForSmoke(),
		authoring_method_ref: creatorRef("skill-creator"),
		basis_refs: methodEvidenceRefs,
		semantic_kind: "procedure",
		name: "smoke-action-method",
		summary: "Choose and test one bounded ARC action from the compared situations.",
		description: "A bounded action-selection procedure induced from reset-separated evidence.",
		content: [
			"NEXT_ACTION: ACTION2",
			"PREDICTION: the selected action changes at least one visible cell",
			"FALSIFIER: the selected action produces no visible change",
			"Read the current available actions, execute NEXT_ACTION only when it remains available,",
			"then compare the resulting public transition with PREDICTION and FALSIFIER.",
		].join("\n"),
		reasoning: "bounded_judgment",
		execution: "text",
		context_visibility: "on_demand",
		expected_effect: "the later parent ARC decision is selected by this exact procedure version",
	};
	if (name === "tools") return {
		...common, authoring_method_ref: creatorRef("tool-creator"), basis_refs: methodEvidenceRefs, semantic_kind: "computation", name: "smoke-counter",
		summary: "Count enabled items after deterministic filtering.",
		content: "Pick items, filter enabled=true, map value, and count the result.",
		description: "Deterministic enabled-item counter.",
		reasoning: "none", execution: "pure_computation", context_visibility: "on_demand",
		input_schema: { type: "object", properties: { items: { type: "array", items: {
			type: "object", properties: { value: { type: "string" }, enabled: { type: "boolean" } },
			required: ["value", "enabled"],
		} } }, required: ["items"] },
		program: { steps: [
			{ kind: "pick", source: "input", field: "items" },
			{ kind: "filter", field: "enabled", equals: true },
			{ kind: "map", fields: ["value"] },
			{ kind: "count" },
		] },
		method: methodForSmoke(),
		expected_effect: crossContextMethod
			? "the later parent turn returns numeric count 1 for a new bounded case set"
			: "the next parent turn returns numeric count 2 for the smoke input",
	};
	if (name === "subagents") return {
		...common, semantic_kind: "role", name: "smoke-reviewer",
		method: smokeSubagentMethod(),
		authoring_method_ref: creatorRef("subagent-creator"),
		summary: "An independent read-only ARC reviewer.",
		content: "Return one concise independent result for the delegated ARC question.",
		description: "Deterministic routed subagent role.",
		reasoning: "open_ended", execution: "model_delegation", context_visibility: "on_demand",
		tools: ["arc_state"],
		expected_effect: "the next parent turn delegates and receives SMOKE_SUBAGENT_RESULT",
	};
	return {
		...common, semantic_kind: "fact", name: "smoke-core-rule",
		summary: "A continuously salient ARC execution rule.",
		content: "SMOKE_SYSTEM_MARKER: use only actions advertised by the current ARC state.",
		atom: { subject: "arc-action-selection", predicate: "allowed-action-source",
			value: "SMOKE_SYSTEM_MARKER: use only actions advertised by the current ARC state." },
		reasoning: "none", execution: "text", context_visibility: "always",
		prompt_channel: "system_prompt", prompt_operation: "create",
		system_prompt_basis: { source: "validated_environment_invariant", evidence_refs: [evidenceRef] },
		expected_effect: "the next parent system prompt contains SMOKE_SYSTEM_MARKER",
	};
}

function reportFor(delivery: Record<string, unknown>): Record<string, unknown> {
	const methodCandidate = delivery.method && ["procedure", "computation", "role"].includes(String(delivery.semantic_kind)) ? [{
		candidate_ref: `smoke-${scenario}-method`, name: delivery.name,
		semantic_kind: delivery.semantic_kind, summary: delivery.summary,
		basis_refs: methodEvidenceRefs, method: delivery.method,
	}] : [];
	return {
		format: "auto-research-report-v1",
		status: "supported_within_scope",
		conclusion: crossContextMethod
			? "The reset-separated ACTION1 cases support a bounded action-selection procedure; later use remains unvalidated."
			: `The ${scenario} smoke delivery is supported by the selected ARC observation.`,
		findings: [{
			subject_kind: String(delivery.semantic_kind),
			question: `Can ${scenario} be routed and used on the next parent turn?`,
			conclusion: crossContextMethod
				? "ACTION1 changed visible state in both attempt:1 and attempt:2; attempt identity varied while the change predicate held."
				: "Yes, within this deterministic smoke scope.",
			evidence_refs: methodEvidenceRefs,
			uncertainty: crossContextMethod ? "Only two reset-separated attempts are represented." : "none inside the fixture contract",
		}],
		evidence_refs: methodEvidenceRefs,
		alternatives: crossContextMethod ? ["The repeated outcome may depend on unobserved state rather than action identity alone."] : [],
		limitations: [crossContextMethod ? "The inferred invariant is limited to two reset-separated attempts." : "fixture-scoped evidence"],
		validation_plan: "Use the exact routed version on the next real ARC parent turn.",
		method_candidates: crossContextMethod ? [{
			candidate_ref: "cross-context-smoke-method", name: "smoke-action-method",
			semantic_kind: "procedure", summary: "Select and test one bounded next action after comparing reset-separated ARC situations.",
			basis_refs: methodEvidenceRefs, method: methodForSmoke(),
		}] : methodCandidate,
	};
}

function feedbackReport(): Record<string, unknown> {
	const actualUseRef = resourceRefForUse("smoke-action-method") ?? "execution-observation-5";
	return {
		format: "auto-research-report-v1",
		status: "supported_within_scope",
		conclusion: "The later ARC action was selected from the exact adopted procedure and produced a visible transition within the bounded smoke scope.",
		findings: [{
			subject_kind: "research_method",
			question: "Did later use support the method induced from reset-separated contexts?",
			conclusion: "Yes. The parent read the exact procedure version, executed its NEXT_ACTION, preserved its prediction and falsifier, and recorded the resulting ARC transition; this does not broaden the two-attempt construction scope.",
				evidence_refs: [...methodEvidenceRefs, actualUseRef],
			uncertainty: "No additional ARC level or game was tested.",
		}],
		evidence_refs: [...methodEvidenceRefs, actualUseRef],
		alternatives: ["The visible transition may still depend on unobserved state rather than the induced pattern."],
		limitations: ["Validation remains bounded to the recorded construction cases and one later use."],
		validation_plan: "Retain the method within scope and seek a counterexample in a later distinct task stage.",
		next_research_question: "Does the predicate remain stable after a level transition?",
		method_candidates: [],
	};
}

function jsonl(path: string): Record<string, any>[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
		} catch { return []; }
	});
}

function realResearchMethodState(): {
	ready: boolean;
	delivery?: Record<string, any>;
	resourceRef?: string;
	nextAction?: string;
	prediction?: string;
	falsifier?: string;
	actualUseObservationRef?: string;
} {
	const delivery = jsonl(join(root, "task-skills.jsonl")).findLast((item) => item.name === "smoke-action-method" && item.status === "active");
	const content = String(delivery?.instructions ?? "");
	const field = (name: string) => content.match(new RegExp(`^${name}\\s*[:=]\\s*(.+)$`, "im"))?.[1]?.trim();
	const nextAction = field("NEXT_ACTION")?.match(/\b(?:RESET|ACTION\d+)\b/i)?.[0]?.toUpperCase();
	const prediction = field("PREDICTION");
	const falsifier = field("FALSIFIER");
	const actualUseObservationRef = resourceRefForUse(delivery?.name);
	return {
		ready: Boolean(delivery && nextAction && prediction && falsifier),
		...(delivery ? { delivery } : {}),
		...(delivery?.name ? { resourceRef: `skill:${delivery.name}@v1` } : {}),
		...(nextAction ? { nextAction } : {}),
		...(prediction ? { prediction } : {}),
		...(falsifier ? { falsifier } : {}),
		...(actualUseObservationRef ? { actualUseObservationRef } : {}),
	};
}

function researchMethodRef(candidateRef: string): string | undefined {
	const row = jsonl(join(root, "task-method-lifecycle.jsonl"))
		.findLast((item) => item.candidate_ref === candidateRef && item.source_run_ref === "research_run:auto-research-1@v1");
	return row ? `method:${row.method_id}@v${row.version}` : undefined;
}

function parentCandidate(name: string): Record<string, unknown> {
	const candidate = { ...deliveryFor(name) } as Record<string, any>;
	const candidateRef = crossContextMethod ? "cross-context-smoke-method" : `smoke-${scenario}-method`;
	const methodRef = researchMethodRef(candidateRef);
	delete candidate.format;
	delete candidate.delivery_id;
	candidate.basis_refs = [...new Set([...(candidate.basis_refs ?? []), "research_report:auto-research-1@v1", ...(methodRef ? [methodRef] : [])])];
	return candidate;
}

function authorParentCandidate(name: string): Step {
	if (name === "skills") return { kind: "tool", name: "task_harness_create", arguments: {
		candidate: parentCandidate(name), decision: { basis_refs: ["research_report:auto-research-1@v1"],
			reason: "The parent read skill-creator and authored the complete smoke skill.",
			expected: "One exact skill version is created for assembly and a later action trial." },
	} };
	return { kind: "tool", name: "task_harness", arguments: {
		action: "change", changes: [{ operation: "create", candidate: parentCandidate(name) }],
		decision: { basis_refs: ["research_report:auto-research-1@v1"],
			reason: `The parent applied the matching creator and authored the complete ${name} smoke candidate.`,
			expected: "The runtime validates and stores one exact parent-authored component version." },
	} };
}

function resourceRefForUse(name: unknown): string | undefined {
	const resourceRef = String(name ?? "").trim() ? `skill:${String(name).trim()}@v1` : "";
	if (!resourceRef) return undefined;
	return jsonl(join(root, "execution-observations.jsonl")).findLast((item) =>
		item.tool_name === "arc_action" && !item.is_error
		&& Array.isArray(item.input?.decision?.basis_refs)
		&& item.input.decision.basis_refs.includes(resourceRef))?.observation_id;
}

function crossContextCandidateRef(): string | undefined {
	const candidate = jsonl(join(root, "auto-research-opportunities.jsonl"))
		.findLast((item) => item.action_signature === "arc_action:ACTION1");
	return candidate ? `research_candidate:${candidate.candidate_id}@v${candidate.version}` : undefined;
}

function constructionPreActionStateRefs(): string[] {
	const wanted = new Set(methodConstructionRefs);
	return jsonl(join(root, "execution-observations.jsonl"))
		.filter((item) => wanted.has(String(item.observation_id ?? "")))
		.map((item) => String(item.arc_outcome?.pre_action_state?.resource_ref ?? ""))
		.filter(Boolean);
}

function selectedSceneEvidence(context: any) {
	const blocks = (context.messages ?? []).flatMap((message: any) => Array.isArray(message.content) ? message.content : []);
	const scene = blocks.filter((block: any) => block.type === "text").map((block: any) => String(block.text))
		.find((text: string) => text.includes("PARENT-SELECTED ARC OBSERVATION")) ?? "";
	const match = scene.match(/Grid current_state_frame \((\d+)x(\d+)\)[^\n]*\n([0-9a-f]+(?:\n[0-9a-f]+)*)/);
	const rows = match?.[3].split("\n") ?? [];
	return { rows: rows.length, columns: rows[0]?.length ?? 0,
		first_cell: rows.length ? parseInt(rows[0][0], 16) : null,
		grid_sha256: createHash("sha256").update(rows.join("\n")).digest("hex"),
		selected_ref: scene.match(/PARENT-SELECTED ARC OBSERVATION (\S+)/)?.[1] ?? null,
		image_count: blocks.filter((block: any) => block.type === "image").length,
		tools: (context.tools ?? []).map((tool: any) => tool.name) };
}

function providerStep(request: number, context: any): Step {
	if (continuousWorkers) return continuousWorkerStep(request);
	const isChild = process.env.PI_TASK_CHILD === "1";
	if (scenario === "multi_region_cue") {
		// Wiring-only route from a saved public trajectory. Never used by ordinary runs.
		const route = ["ACTION1","ACTION2","ACTION3","ACTION4","ACTION1","ACTION1","ACTION1","ACTION1",
			"ACTION1","ACTION1","ACTION1","ACTION4","ACTION4","ACTION4","ACTION1","ACTION2",
			"ACTION3","ACTION2","ACTION2","ACTION3","ACTION3","ACTION3","ACTION1","ACTION3",
			"ACTION3","ACTION3","ACTION2","ACTION3","ACTION1","ACTION4","ACTION4","ACTION4"];
		if (request < 4) return {kind:"tool",name:"arc_actions",arguments:{
			actions:route.slice(request * 8, (request + 1) * 8).map(action => ({action})),
		}};
		if (request === 4) return {kind:"tool",name:"arc_action",arguments:{action:"ACTION4"}};
		return {kind:"text",text:"multi-region wiring diagnostic complete"};
	}
	if (scenario === "multi_region_broad_cue") {
		// Frozen public route only for deterministic wiring diagnosis.
		const route = ["ACTION1","ACTION2","ACTION3","ACTION4","ACTION1","ACTION1","ACTION1","ACTION1",
			"ACTION1","ACTION1","ACTION1","ACTION2","ACTION2","ACTION2","ACTION3","ACTION4",
			"ACTION3","ACTION1","ACTION1","ACTION1","ACTION1","ACTION2","ACTION2","ACTION2",
			"ACTION2","ACTION2","ACTION2","ACTION2","ACTION4","ACTION4","ACTION4","ACTION1",
			"ACTION1","ACTION1","ACTION1","ACTION4","ACTION4","ACTION4","ACTION4","ACTION4",
			"ACTION2","ACTION3","ACTION3","ACTION3","ACTION3","ACTION3","ACTION3","ACTION3"];
		if (request < 6) return {kind:"tool",name:"arc_actions",arguments:{
			actions:route.slice(request * 8, (request + 1) * 8).map(action => ({action})),
		}};
		if (request === 6) return {kind:"tool",name:"arc_action",arguments:{action:"ACTION1"}};
		return {kind:"text",text:"broad multi-region wiring diagnostic complete"};
	}
	if (scenario === "batch_guard") return [
		{kind:"tool",name:"arc_actions",arguments:{
			stop_if_changed_cells_lte:2,
			actions:[{action:"ACTION1"},{action:"ACTION2"},{action:"ACTION2"},{action:"ACTION1"}],
		}},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION3",reasoning:"Continue after the guarded batch returned control."}},
	][request] as Step ?? {kind:"text",text:"batch guard diagnostic complete"};
	if (scenario === "action_knowledge") return [
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION1",subgoal:"SMOKE_ACTION_SUBGOAL: compare controls",decision:{
			hypothesis:"SMOKE_ACTION_HYPOTHESIS: controls unknown",
			knowledge:{known_effects:"SMOKE_ACTION_EFFECT: no supported control yet",knowledge_gaps:"SMOKE_ACTION_GAP: goal is unknown"}}}},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION2",next_step:"SMOKE_ACTION_NEXT: contrast another control",decision:{
			knowledge:{counterevidence:[{fact:"SMOKE_ACTION_COUNTEREXAMPLE: change alone is not a goal rule",source_ref:"observation:execution-observation-1@v1"}]}}}},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION3",reasoning:"Compare using retained knowledge without a checkpoint management call"}},
	][request] as Step ?? {kind:"text",text:"action knowledge diagnostic complete"};
	if (["checkpoint_action_batch", "checkpoint_action_boundary"].includes(scenario)) return [
		{kind:"batch",calls:[
			{name:"task_checkpoint",arguments:{action:"update",task_goal:"SMOKE_BATCH_GOAL: identify a supported control",
				working_summary:"SMOKE_BATCH_KNOWLEDGE: control and object roles remain unknown",next_step:"Test one available action",
				decision_state:{known_effects:"SMOKE_AUTHORED_EFFECT: controls have not been verified",unknowns:"SMOKE_AUTHORED_GAP: goal remains unknown"}}},
			{name:"arc_action",arguments:{action:"ACTION1",decision:{hypothesis:"Unknown control",prediction:"Public pixels may change",falsifier:"No visible change"}}},
			...(scenario === "checkpoint_action_boundary" ? [
				{name:"task_checkpoint",arguments:{action:"update",working_summary:"MUST_NOT_COMMIT_AFTER_ACTION"}},
				{name:"arc_action",arguments:{action:"ACTION4"}},
			] : []),
		]},
		{kind:"batch",calls:[
			{name:"task_checkpoint",arguments:{action:"update",working_summary:"SMOKE_BATCH_COUNTEREVIDENCE: visible change alone has not established a player or goal",
				summary_basis_refs:["execution-observation-1"],hypothesis:"Unknown object roles",next_step:"Compare another available action",
				counterevidence:["SMOKE_AUTHORED_COUNTEREXAMPLE: a pixel change does not establish a goal rule"]}},
			{name:"arc_action",arguments:{action:"ACTION2",decision:{hypothesis:"Alternative control interpretation",prediction:"Another observed effect",falsifier:"No discriminating change"}}},
		]},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION3",reasoning:"Later real parent turn retains earlier knowledge and counterevidence"}},
	][request] as Step ?? {kind:"text",text:"checkpoint/action batch diagnostic complete"};
	if (scenario === "review_input_repair") return [
		{kind:"tool",name:"task_harness",arguments:{action:"start"}},
		...Array.from({length:5}, ():Step => ({kind:"tool",name:"arc_action",arguments:{
			action:"ACTION1",reasoning:"Collect actual SDK evidence for a short review-repair diagnostic."}})),
		{kind:"tool",name:"task_harness",arguments:{action:"review",review:[{
			disposition:"defer",reason:"The control mechanism remains unknown."}]}},
		{kind:"tool",name:"task_harness",arguments:{action:"inspect",section:"review_contract"}},
		{kind:"tool",name:"task_harness",arguments:{action:"review",review:[],transition_analysis:{
			observed_changes:"Five public transitions were recorded; no game rule is asserted.",
			predictive_rules:"Unknown; this diagnostic does not infer the controls.",
			limiting_uncertainty:"No scientific mechanism has been tested.",next_experiment:"Choose a new test from live evidence.",
			capability_opportunities:"Unknown until that test is chosen.",evidence_refs:[evidenceRef]}}},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION2",reasoning:"Act on a later real parent turn after explicit repair."}},
	][request] as Step ?? {kind:"text",text:"review input repair diagnostic complete"};
	if (simpleCoordinateScenario && !isChild) return [
		{kind:"tool",name:"task_harness",arguments:{action:"start"}},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION1",x:21,y:32,reasoning:"Check ignored coordinate receipt on a native simple action."}},
		{kind:"tool",name:"arc_action",arguments:{action:"ACTION1",x:22,y:32,reasoning:"Changing ignored coordinates does not constitute a new spatial experiment."}},
	][request] as Step ?? {kind:"text",text:"simple coordinate receipt diagnostic complete"};
	if (selectedSnapshotScenario) {
		if (isChild) {
			const marker = join(root, "arc-selected-scene-length.marker");
			if (!existsSync(marker)) {
				writeFileSync(marker, "continue selected scene\n", "utf8");
				return {kind:"length",text:"The selected immutable scene remains required for the continuation."};
			}
			return {kind:"text",text:JSON.stringify(selectedSceneEvidence(context))};
		}
		return [
			{kind:"tool",name:"task_harness",arguments:{action:"start"}},
			readBaseline("subagent-creator"),
			{kind:"tool",name:"task_harness_create",arguments:{candidate:{
				component:"subagent",name:"scene-reader",description:"Read selected public scene cells.",
				instructions:"Count rows and columns and return the first cell from the explicitly selected scene.",tools:[],
				context_recipe:{include_checkpoint:false,recent_observations:0,recent_actions:0,inherit_harness_refs:[],max_chars:12000}},
				assembly:{expected_assembly_revision:0,selected_resource_refs:[],prompt_contributions:[]},
				decision:{basis_refs:[],reason:"Use an isolated bounded scene reader.",expected:"Return exact public cell data."}}},
			{kind:"tool",name:"arc_action",arguments:{action:"ACTION1",reasoning:"Publish a newer scene before selecting historical evidence."}},
			{kind:"tool",name:"delegate_task",arguments:{agent_name:"scene-reader",task:"Return row count, column count and first cell from selected evidence.",
				evidence_refs:["observation_snapshot:parent-state-1@v1"]}},
			{kind:"tool",name:"arc_action",arguments:{action:"ACTION2",reasoning:"The child returned exact historical scene dimensions; continue one real bounded action."}},
		][request] as Step ?? {kind:"text",text:"selected scene diagnostic complete"};
	}
	if (isChild && process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1") {
		const runId = String(process.env.PI_AUTO_RESEARCH_RUN_ID ?? "auto-research-1");
		if (crossContextMethod) {
			const reads = runId === "auto-research-1"
				? [...constructionPreActionStateRefs(),
					"observation:execution-observation-1@v1", "observation:execution-observation-3@v1",
					"observation:execution-observation-4@v1"]
				: ["observation:execution-observation-1@v1", "observation:execution-observation-3@v1",
					"observation:execution-observation-4@v1",
					`observation:${resourceRefForUse("smoke-action-method") ?? "execution-observation-5"}@v1`,
					"effect_assessment:effect-assessment-1@v1"];
			if (request < reads.length) return { kind: "tool", name: "task_resource", arguments: {
				action: "read", ref: reads[request], offset: 0, limit: 65536,
			} };
			return { kind: "tool", name: "submit_research_report", arguments: {
				report: runId === "auto-research-1" ? reportFor(deliveryFor(scenario)) : feedbackReport(),
			} };
		}
		const lengthMarker = join(root, "arc-smoke-auto-research-length-once.marker");
		if (scenario === "memory" && !existsSync(lengthMarker)) {
			if (request === 0) return { kind: "tool", name: "task_resource", arguments: {
				action: "read", ref: `observation:${evidenceRef}@v1`, offset: 0, limit: 65536,
			} };
			writeFileSync(lengthMarker, "native-session continuation required\n", "utf8");
			return { kind: "length", text: "Synthetic reasoning-only interruption", thinkingOnly: true };
		}
		const delivery = deliveryFor(scenario);
		const report = reportFor(delivery);
		if (scenario === "memory" && request === 0) return { kind: "tool", name: "task_resource", arguments: {
			action: "read", ref: `observation:${evidenceRef}@v1`, offset: 0, limit: 65536,
		} };
		const steps: Step[] = [
			{ kind: "tool", name: "submit_research_report", arguments: { report } },
		];
		return steps[request - (scenario === "memory" ? 1 : 0)] ?? { kind: "text", text: "research fixture complete" };
	}
	if (isChild) {
		if (actionAlignmentScenario) return [
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1",
				reasoning: "Use exactly one explicitly delegated ARC action." } },
			{ kind: "text", text: "SMOKE_DELEGATED_ACTION: ACTION1 changed the public frame; the parent should receive its canonical receipt." },
		][request] ?? { kind: "text", text: "delegated action complete" };
		const marker = join(root, "arc-smoke-delegate-length-once.marker");
		if (scenario === "subagents" && !existsSync(marker)) {
			writeFileSync(marker, "native-session continuation required\n", "utf8");
			return { kind: "length", text: "SMOKE_SUBAGENT_PARTIAL" };
		}
		return { kind: "text", text: "SMOKE_SUBAGENT_RESULT" };
	}
	if (actionAlignmentScenario) return [
		{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
		{ kind: "tool", name: "task_harness", arguments: { action: "activate", enabled_tools: ["delegate_task"] } },
		{ kind: "tool", name: "delegate_task", arguments: {
			instructions: "Execute ACTION1 once under the explicit lease, inspect the public result, and report what changed.",
			task: "Perform the authorized one-step ARC probe and report its observed result.",
			tools: ["arc_state"], action_authorization: { max_actions: 1 },
		} },
		{ kind: "tool", name: "arc_actions", arguments: { actions: [
			{ action: "ACTION2", reasoning: "First action in a bounded parent batch." },
			{ action: "ACTION3", reasoning: "Second action in the same parent batch." },
		] } },
		{ kind: "tool", name: "arc_action", arguments: { action: "ACTION4",
			reasoning: "Verify a later parent turn after delegated and batched actions." } },
	][request] ?? { kind: "text", text: "action alignment fixture complete" };
	if (scenario === "review_advisory") return request === 0
		? { kind: "tool", name: "task_harness", arguments: { action: "start" } }
		: request <= 7 ? { kind: "tool", name: "arc_action", arguments: {
			action: "ACTION1", reasoning: "Cross the periodic-review boundary using advisory mode.",
			decision:{hypothesis:"SMOKE_UNRESOLVED_CONTROL",prediction:"Public pixels may change; this does not prove goal progress.",
				falsifier:"No visible delta; preserve this as an unverified parent prediction."} } }
		: { kind: "text", text: "advisory boundary fixture complete" };
	if (scenario === "read_workset") {
		const first = jsonl(join(root, "task-parent-tool-results.jsonl")).find(row =>
			row.tool_name === "task_resource");
		return [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Collect canonical read-workset evidence." } },
			{ kind: "tool", name: "task_memory_pool", arguments: { action: "capture", capture_id: "read-workset",
				items: [{ key: "smoke-read-workset", content: "READ_WORKSET_EVIDENCE ".repeat(360),
					scope: "task", claim_kind: "observation", basis_refs: [evidenceRef] }] } },
			{ kind: "tool", name: "task_harness", arguments: { action: "activate", enabled_tools: ["task_resource"] } },
			{ kind: "tool", name: "task_resource", arguments: { action: "read", ref: "memory:smoke-read-workset@v1", offset: 0, limit: 4000 } },
			{ kind: "tool", name: "task_resource", arguments: { action: "read", ref: "memory:smoke-read-workset@v1", offset: 4000, limit: 4000 } },
			{ kind: "tool", name: "task_harness", arguments: { action: "compact_results",
				result_refs: first ? [`tool_result:${first.result_id}@v1`] : [], result_reason: "Verify direct exact-page recovery after projection." } },
			{ kind: "tool", name: "task_resource", arguments: { action: "read", ref: "memory:smoke-read-workset@v1", offset: 0, limit: 4000 } },
			{ kind: "tool", name: "task_checkpoint", arguments: { action: "update",
				working_summary: "READ_WORKSET_ANALYZED: two exact pages supply the planned action evidence; success rule is still untested.",
				consumed_result_refs: jsonl(join(root, "task-parent-tool-results.jsonl"))
					.filter(row => row.tool_name === "task_resource").map(row => `tool_result:${row.result_id}@v1`),
				decision_state: { knowledge_gaps: [{ kind: "goal_rule", question: "SMOKE_GOAL_STILL_UNKNOWN", status: "unresolved" }],
					counterevidence: [{ fact: "SMOKE_OPERATION_EFFECT_IS_NOT_GOAL_PROOF", source_ref: "memory:smoke-read-workset@v1" }],
					next_decision: { intent: "Use the planned action and inspect the public result" } } } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION2", reasoning: "Consume the restored read batch at a real action boundary." } },
		][request] ?? { kind: "text", text: "read workset fixture complete" };
	}
	if (onlineRetrospectiveScenario) {
		const reviewRef = "level_review:level-outcome:execution-observation-2@v1";
		const skillRef = "skill:smoke-online-retrospective-method@v1";
		const promptRef = "system_prompt:smoke-online-planning-policy@v1";
		return [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION1", reasoning: "Create current public evidence before opening an online reset review.",
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "RESET", reasoning: "Open a real reset-boundary review while continuing the same online task.",
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "level_review",
				window_id: "level-outcome:execution-observation-2",
				level_review: {
					summary: "A reset ended this attempt; the task remains live.",
					mechanisms: "The next attempt must be chosen from the current public state.",
					shortcomings: "The previous action sequence does not establish a route for a new state.",
					lessons: "For the next attempt, read the current available actions and visible state; form one checkable prediction from those observations, then test one bounded action.",
					next_attempt: "Re-evaluate the live goal and constraints from current observation before selecting the next action.",
					credits: [], failure_modes: [{
						symptom: "The previous attempt reached a reset boundary.", trigger: "Environment returned RESET.",
						recovery_or_next_test: "Re-read the current public state and choose a single falsifiable test.",
						applicability: "Only when a new attempt is live and a current observation is available.",
						confidence: "high", evidence_refs: ["execution-observation-2"],
					}],
				},
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "enable", enabled_tools: ["task_resource"] } },
			{ kind: "tool", name: "task_resource", arguments: { action: "read", ref: reviewRef } },
			readBaseline("skill-creator"),
			{ kind: "tool", name: "task_harness", arguments: { action: "change", changes: [
				{ operation: "create", candidate: {
					semantic_kind: "procedure", execution: "text", reuse: "expected_reuse", reasoning: "bounded_judgment",
					name: "smoke-online-retrospective-method",
					summary: "Derive one falsifiable ARC action from the current public state.",
					content: "SMOKE_ONLINE_RETRO_SKILL: At every use, read the current public observation and currently available actions. " +
						"Recompute the candidate from those values, state a predicted visible change and a falsifier, execute at most one bounded action, " +
						"then compare the next observation with that prediction. Stop or revise when applicability fails or the result differs. " +
						"Do not replay a prior action sequence, coordinate, object identity, or target set.",
					scope: { kind: "task_wide", statement: "This online ARC task" },
					context_visibility: "on_demand", stability: "stable_in_scope", basis_refs: [reviewRef],
				} },
				{ operation: "create", candidate: {
					semantic_kind: "system_prompt", name: "smoke-online-planning-policy",
					prompt_text: "SMOKE_ONLINE_RETRO_POLICY: Maintain the current task goal, testable success conditions, constraints, and competing strategies. " +
						"When evidence makes them testable, shift from broad exploration to goal-directed candidate comparison. Re-evaluate after each live observation; " +
						"state one falsifiable next prediction and continue the online trajectory one justified action at a time.",
					scope: "This online ARC task planning phase", basis_refs: [reviewRef],
				} },
			], decision: { basis_refs: [reviewRef],
				reason: "The parent directly turns review evidence into a state-bound procedure and provisional planning policy.",
				expected: "Both authored resources use the current observation and do not replay the old attempt." } } },
			{ kind: "tool", name: "task_harness", arguments: {
				action: "assemble", expected_assembly_revision: 0,
				selected_resource_refs: [skillRef, promptRef], prompt_contributions: [],
				decision: { basis_refs: [reviewRef], reason: "Select exact parent-authored review-derived versions for the live next attempt.",
					expected: "The next parent context receives both the current-observation method and planning policy." },
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "focus", resource_refs: [skillRef] } },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION2", reasoning: "Use the selected current-state procedure after the reset review.",
				decision: { basis_refs: [skillRef, promptRef],
					hypothesis: "One currently available action can test a relation derived from the present public state.",
					prediction: "The next public observation will show a checkable transition.",
					falsifier: "The current observation does not show the predicted transition." },
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION3", reasoning: "Continue the same online task after the review-derived method's first bounded use.",
				decision: { basis_refs: [skillRef, promptRef],
					prediction: "The next visible transition can be compared with the current-state prediction.",
					falsifier: "The public result differs from the prediction." },
			} },
		][request] ?? { kind: "text", text: "online retrospective fixture complete" };
	}
	if (directDevelopmentScenario) {
		return [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Establish a real parent ARC observation before direct capability development." } },
			directIntent("open", "Preserve context in Memory, then author a bounded counter if useful."),
			directMemoryChange(false),
			{ kind: "tool", name: "task_harness", arguments: { action: "status" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION2", reasoning: "Carry the open intent across a real ARC action and later parent context." } },
			directMemoryChange(true),
			{ kind: "tool", name: "task_harness", arguments: { action: "status" } },
			readBaseline("tool-creator"),
			directToolChange(),
			{ kind: "tool", name: "task_harness", arguments: { action: "status" } },
			assemble(directToolRef),
			{ kind: "tool", name: "task_tool_direct-enabled-counter_v1", arguments: { input: { items: [
				{ value: "a", enabled: true }, { value: "b", enabled: false }, { value: "c", enabled: true },
			] } } },
			directIntent("resolved"),
			{ kind: "tool", name: "task_harness", arguments: { action: "status" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION3", reasoning: "Cross a later real parent ARC boundary after explicit resolution." } },
		][request] ?? { kind: "text", text: "direct development intent fixture complete" };
	}
	if (round2Recovery) {
		const actualUseObservationRef = recoveredSkillUseObservationRef();
		return [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			...Array.from({ length: 5 }, (): Step => ({ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION1", reasoning: "Collect one real transition for the round-two review recovery window.",
			} })),
			invalidRecoveryReview(),
			patchRecoveryReview(1),
			patchRecoveryReview(2),
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			staleRecoveryReviewPatch(),
			readBaseline("skill-creator"),
			{ kind: "tool", name: "task_harness", arguments: {
				action: "change", changes: [{ operation: "create", candidate: recoveredSkillCandidate() }],
				decision: { basis_refs: ["execution-observation-1", "execution-observation-2", "execution-observation-3", "execution-observation-4", "execution-observation-5"],
					reason: "The parent recovered the still-useful method opportunity, read skill-creator, and authored the complete procedure itself.",
					expected: "Create one exact task-local Skill version for a bounded later ARC action." },
			} },
			assemble(recoveredSkillRef),
			{ kind: "tool", name: "task_harness", arguments: {
				action: "assemble", expected_assembly_revision: 0,
				selected_resource_refs: [recoveredSkillRef], prompt_contributions: [],
				decision: { basis_refs: [recoveredSkillRef], reason: "Deliberately exercise stale assembly CAS.",
					expected: "Reject this stale revision without changing the exact active assembly." },
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "focus", resource_refs: [recoveredSkillRef] } },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION2", reasoning: "Use the exact focused recovered procedure for one bounded real transition.",
				decision: { basis_refs: [recoveredSkillRef],
					prediction: "the selected action produces a visible public transition",
					falsifier: "the selected action produces no visible public transition" },
			} },
			{ kind: "tool", name: "task_harness", arguments: {
				action: "assess_effect", verdict: "inconclusive",
				observation_refs: actualUseObservationRef ? [actualUseObservationRef] : [],
				consequence: "The declared expected effect did not prove success; the later real ARC observation is the actual-use evidence for this bounded procedure.",
				remaining_uncertainty: "One visible transition cannot establish a general game rule or cross-context benefit.",
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION3", reasoning: "Cross a later real parent boundary after actual-use assessment.",
			} },
		][request] ?? { kind: "text", text: "round-two review recovery fixture complete" };
	}
	if (pureExpressionScenario) {
		const firstSnapshotRef = firstObservationSnapshotRef();
		return [
			readBaseline("tool-creator"),
			{ kind: "tool", name: "task_harness", arguments: {
				action: "change", changes: [{ operation: "create", candidate: pureExpressionCandidate() }],
				decision: { basis_refs: [firstSnapshotRef],
					reason: "The parent used tool-creator to author one bounded generic computation over an exact public observation.",
					expected: "The runtime validates and stores one pure-expression tool version without host code." },
			} },
			assemble("tool:smoke-frame-row-count@v1"),
			{ kind: "tool", name: "task_tool_smoke-frame-row-count_v1", arguments: {
				parameters: {}, bindings: [{ name: "grid", ref: firstSnapshotRef,
					path: ["public_state", "frames", 0] }],
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION1", reasoning: "Cross one real ARC boundary after the exact-snapshot pure computation.",
			} },
			{ kind: "tool", name: "task_tool_smoke-frame-row-count_v1", arguments: {
				parameters: {}, bindings: [{ name: "grid", ref: firstSnapshotRef,
					path: ["public_state", "frames", 0] }],
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION2", reasoning: "Finish after intentionally reusing the historical immutable snapshot.",
			} },
		][request] ?? { kind: "text", text: "pure-expression snapshot fixture complete" };
	}
	if (minimalFivePoolScenario) {
		const selected = Object.values(minimalPoolRefs);
		return [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			readBaseline("skill-creator"),
			readBaseline("tool-creator"),
			readBaseline("subagent-creator"),
			minimalPoolChange(),
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect", section: "component_pool" } },
			minimalFivePublishScenario ? { kind: "tool", name: "task_harness", arguments: { action: "status" } } : { kind: "tool", name: "task_harness", arguments: {
				action: "assemble", expected_assembly_revision: 0, selected_resource_refs: selected,
				prompt_contributions: [], decision: { basis_refs: [evidenceRef],
					reason: "Select the five exact parent-authored component versions for a later real turn.",
					expected: "Only these exact refs enter the active Harness assembly." },
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect", section: "component_pool" } },
			{ kind: "tool", name: "read", arguments: { path: join(root, "task-harness", "skills", "pool-skill", "SKILL.md") } },
			{ kind: "tool", name: "task_tool_pool-tool_v1", arguments: { input: { items: [
				{ value: "a", enabled: true }, { value: "b", enabled: false }, { value: "c", enabled: true },
			] } } },
			{ kind: "tool", name: "delegate_task", arguments: {
				agent_name: "pool-reviewer", task: "Return the deterministic pool review result.", evidence_refs: [evidenceRef], resource_refs: [],
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION1", reasoning: "Use the loaded Skill, selected scoped memory and current-action policy after tool and role semantic checks.",
				decision: { basis_refs: [minimalPoolRefs.skill, minimalPoolRefs.memory, minimalPoolRefs.systemPrompt], prediction: "one advertised action produces a public transition",
					falsifier: "no public transition is recorded" },
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION2", reasoning: "Cross a second real parent boundary after semantic component use.",
			} },
		][request] ?? { kind: "text", text: "minimal five-component pool fixture complete" };
	}
	if (crossContextMethod) {
		const commonPrefix: Step[] = [
			{ kind: "tool", name: "task_harness", arguments: { action: "start" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Record ACTION1 in attempt 1." } },
			{ kind: "tool", name: "arc_action", arguments: { action: "RESET", reasoning: "Create a distinct online attempt without rewinding the trajectory." } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION2", reasoning: "Change the second attempt's pre-state before repeating ACTION1." } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Record the same action from a different pre-state in attempt 2." } },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			readBaseline("research-orchestration"),
			{ kind: "tool", name: "auto_research", arguments: {
				action: "start",
				research_candidate_ref: crossContextCandidateRef() ?? "research_candidate:missing@v1",
				authoring_method_ref: baselineRef("research-orchestration"),
			} },
		];
		const method = realResearchMethodState();
		return [
			...commonPrefix,
			readBaseline("skill-creator"),
			authorParentCandidate(scenario),
			assemble("skill:smoke-action-method@v1"),
			{ kind: "tool", name: "task_harness", arguments: {
				action: "focus", resource_refs: [method.resourceRef ?? "skill:smoke-action-method@v1"],
			} },
			{ kind: "tool", name: "arc_action", arguments: {
				action: "ACTION3",
				reasoning: "Cross one uncredited ARC boundary so the focused procedure is projected into the following real parent turn.",
			} },
			{ kind: "tool", name: "task_harness", arguments: { action: "defer_review",
				review_reason: "Finish the already assembled procedure trial and feedback research before consolidating this window.",
				resume_condition: { kind: "after_actions", actions: 5 } } },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: {
				action: method.nextAction ?? "ACTION2",
				reasoning: "Execute the action selected by the adopted cross-context procedure.",
				decision: { basis_refs: [method.resourceRef ?? "skill:smoke-action-method@v1"],
					prediction: method.prediction ?? "the selected action changes at least one visible cell",
					falsifier: method.falsifier ?? "the selected action produces no visible change" } } },
			{ kind: "tool", name: "task_harness", arguments: {
				action: "assess_effect", verdict: "inconclusive",
				observation_refs: method.actualUseObservationRef ? [method.actualUseObservationRef] : [],
				consequence: "The adopted procedure selected and justified the later ARC action; feedback research must compare its visible result with the recorded prediction.",
				remaining_uncertainty: "The scripted parent records use but does not supply the semantic verdict for the child-authored prediction.",
			} },
			readBaseline("research-orchestration"),
			{ kind: "tool", name: "auto_research", arguments: { action: "start", interaction_mode: "blocking",
				authoring_method_ref: baselineRef("research-orchestration"),
				research_handoff_ref: "research_handoff:method-feedback-effect-assessment-1@v1" } },
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION3", reasoning: "Cross a later real parent boundary after feedback research." } },
		][request] ?? { kind: "text", text: "cross-context method fixture complete" };
	}

	const parentSteps: Step[] = [
		{ kind: "tool", name: "task_harness", arguments: continuousMemoryPool
			? { action: "enable", enabled_tools: ["task_memory_pool"] }
			: { action: "start" } },
		{ kind: "tool", name: "arc_action", arguments: {
			action: "ACTION1", reasoning: "Create one real observation before starting bounded research.",
			...(continuousMemoryPool ? { decision: {
				hypothesis: "The parent-authored action decision is retained verbatim for later retrieval.",
				prediction: "The public result stays in a separate observed outcome field.",
				falsifier: "The resulting Memory conflates the prediction with the public action receipt.",
				subgoal: "Exercise automatic local probe capture.", next_step: "Capture a cross-action candidate separately.",
			} } : {}),
			...(scenario === "skills" ? { decision: {
				hypothesis_id: "smoke-delta-continuity", hypothesis: "Track canonical action deltas across parent turns.",
				prediction: "Each action contributes its actual bridge delta to the same window.",
				falsifier: "Window evidence disagrees with the canonical bridge action.",
				validation_window: { actions: 3, expected: "Preserve action evidence without redeclaring the window.", on_expiry: "inconclusive" },
			} } : {}),
		} },
		...(continuousMemoryPool ? [{ kind: "tool", name: "task_memory_pool", arguments: {
			action: "capture", capture_id: "arc-smoke-explicit-memory-batch",
			items: [{ key: "smoke-captured-probe", content: "SMOKE_CAPTURE_MEMORY: one parent-authored task-scoped conclusion retained in free-form content.",
				scope: "task", claim_kind: "observation", basis_refs: [evidenceRef] }],
		} } as Step] : []),
		readBaseline("research-orchestration"),
		{ kind: "tool", name: "auto_research", arguments: {
			question: `Route the deterministic ${scenario} finding for next-turn use.`,
			...(researchScope ? { scope: researchScope } : {}), evidence_refs: [evidenceRef],
			authoring_method_ref: baselineRef("research-orchestration"),
			...(methodLifecycle ? { research_kind: "capability", research_line_ref: "research_line:arc-smoke-counter@v1" } : {}),
		} },
		...(scenarioResourceRefs[scenario].startsWith("skill:") ? [readBaseline("skill-creator")] : []),
		...(scenarioResourceRefs[scenario].startsWith("tool:") ? [readBaseline("tool-creator")] : []),
		...(scenarioResourceRefs[scenario].startsWith("subagent:") ? [readBaseline("subagent-creator")] : []),
		authorParentCandidate(scenario),
		assemble(continuousMemoryPool
			? [scenarioResourceRefs[scenario], "memory:smoke-captured-probe@v1"]
			: scenarioResourceRefs[scenario]),
	];
	const use: Record<string, Step> = {
		memory: { kind: "tool", name: "task_harness", arguments: { action: "focus", resource_refs: continuousMemoryPool
			? ["memory:smoke-memory@v1", "memory:smoke-captured-probe@v1"] : ["memory:smoke-memory@v1"] } },
		skills: { kind: "tool", name: "task_harness", arguments: { action: "focus", resource_refs: ["skill:smoke-skill@v1"] } },
		tools: { kind: "tool", name: "task_tool_smoke-counter_v1", arguments: { input: { items: [
			{ value: "a", enabled: true }, { value: "b", enabled: false }, { value: "c", enabled: true },
		] } } },
		subagents: { kind: "tool", name: "delegate_task", arguments: {
			agent_name: "smoke-reviewer", task: "Return the deterministic independent smoke result.",
			evidence_refs: [evidenceRef], resource_refs: [],
		} },
		system_prompt: { kind: "tool", name: "task_harness", arguments: { action: "focus", resource_refs: ["system_prompt:smoke-core-rule@v1"] } },
	};
	parentSteps.push(use[scenario]);
	if (methodLifecycle) parentSteps.push({ kind: "tool", name: "task_harness", arguments: {
		action: "assess_effect", verdict: methodRejection ? "unsupported" : "supported",
		consequence: methodRejection ? "The candidate predicted 3 but the actual routed invocation returned 2; reject this exact candidate version." : "The later routed tool invocation returned the predicted semantic result 2.",
		remaining_uncertainty: "Validation is limited to this bounded ARC smoke input.",
	} });
	if (methodRejection) parentSteps.push(use.tools);
	if (scenario === "memory" && process.env.PI_ARC_SMOKE_PERIODIC !== "1") {
		parentSteps.push(
			readBaseline("skill-creator"),
			{ kind: "tool", name: "task_harness", arguments: { action: "change", changes: [
				{ operation: "create", candidate: { semantic_kind: "skill", name: "smoke-dependent",
					authoring_method_ref: baselineRef("skill-creator"),
					description: "Use when one currently advertised action can test the ARC bridge wiring without asserting game semantics.",
					content: [
						"SMOKE_OLD_DEPENDENT",
						"Use this bounded procedure only when one currently advertised action can test the ARC bridge wiring without asserting game semantics.",
						"1. Inspect the current advertised actions.",
						"2. Choose one available action.",
						"3. Record the returned transition.",
						"Abstain when no advertised action has a visible receipt or the environment is terminal.",
					].join("\n"),
					method: smokeActionMethod(), depends_on_refs: ["memory:smoke-memory@v1"] } },
				{ operation: "create", candidate: { semantic_kind: "memory", key: "smoke-state",
					validity: smokeValidity(),
					content: "SMOKE_OLD_STATE", depends_on_refs: ["skill:smoke-dependent@v1"],
					atom: { subject: "smoke-task", predicate: "transitive-state", value: "SMOKE_OLD_STATE" },
					projection: { channel: "task_prompt", layer: "task_state" } } },
				{ operation: "create", candidate: { semantic_kind: "policy", name: "smoke-new-policy",
					validity: smokeValidity(),
					content: "SMOKE_NEW_POLICY", scope: { kind: "task_wide", statement: "this deterministic ARC smoke task" },
					atom: { subject: "smoke-routing", predicate: "active-policy", value: "SMOKE_NEW_POLICY" },
					context_visibility: "always", stability: "stable_in_scope", prompt_channel: "task_prompt",
					prompt_layer: "task_policy", supersedes_refs: ["memory:smoke-memory@v1"] } },
			], decision: { basis_refs: [evidenceRef], reason: "Exercise replacement and dependent suspension through the parent facade.",
				expected: "The new policy replaces the old policy and suspends guidance that depends on it." } } },
			assemble("memory:smoke-new-policy@v1", 1),
			{ kind: "tool", name: "task_harness", arguments: { action: "inspect", section: "knowledge_requires_review" } },
			{ kind: "tool", name: "task_harness", arguments: { action: "change", changes:
				["level", "state"].map(scope => ({ operation: "create", candidate: {
					semantic_kind: "memory", name: `smoke-${scope}-binding`, validity: { scope },
					content: `SMOKE_TEMPORARY_${scope}`, atom: { subject: "smoke-scope", predicate: scope, value: `SMOKE_TEMPORARY_${scope}` },
					projection: { channel: "task_prompt", layer: "task_state" },
				} })), decision: { basis_refs: [evidenceRef], reason: "Test explicit short-lived scope binding",
					expected: "Temporary guidance expires at the real state/reset boundary" } } },
			{ kind: "tool", name: "task_harness", arguments: { action: "assemble", expected_assembly_revision: 2,
				selected_resource_refs: ["memory:smoke-new-policy@v1", "memory:smoke-level-binding@v1", "memory:smoke-state-binding@v1"],
				prompt_contributions: [], decision: { basis_refs: [evidenceRef], reason: "Select scoped fixture facts for lifecycle verification",
					expected: "Only current scope bindings remain available after reset" } } },
		);
	}
	parentSteps.push({ kind: "tool", name: "arc_action", arguments: {
		action: scenario === "memory" && process.env.PI_ARC_SMOKE_PERIODIC !== "1" ? "RESET" : "ACTION2",
		reasoning: "End the second smoke turn; in the memory fixture explicitly test expiry at the real reset boundary.",
	} });
	if (scenario === "memory" && process.env.PI_ARC_SMOKE_PERIODIC !== "1") {
		parentSteps.push({ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION1", reasoning: "Verify revised policy on a later real parent turn." } });
	}
	if (scenario === "system_prompt") {
		parentSteps.push({ kind: "tool", name: "task_harness", arguments: { action: "inspect" } },
			{ kind: "tool", name: "arc_action", arguments: { action: "ACTION3", reasoning: "Verify the selected system overlay on a later real parent turn." } });
	}
	if (process.env.PI_ARC_SMOKE_PERIODIC === "1") {
		parentSteps.splice(1, parentSteps.indexOf(parentSteps.find((step: any) => step.kind === "tool" && step.name === "task_harness" && step.arguments?.action === "change")!) + 1,
			...Array.from({length:5}, ():Step => ({kind:"tool",name:"arc_action",arguments:{action:"ACTION1",reasoning:"Collect periodic window evidence."}})),
			{kind:"tool",name:"task_harness",arguments:{action:"review",review:[],transition_analysis:{
				observed_changes:"Five action results were recorded; inspect their canonical deltas.",
				predictive_rules:"No mechanism claimed by the deterministic provider.",
				limiting_uncertainty:"Whether the reusable delivery is effective on a later turn.",
				next_experiment:"Use the routed component and inspect its semantic output.",
				capability_opportunities:"A fixture-scoped reusable capability.",evidence_refs:[evidenceRef],
			}}},
			readBaseline("research-orchestration"),
			{kind:"tool",name:"auto_research",arguments:{action:"start",interaction_mode:"blocking",
				authoring_method_ref: baselineRef("research-orchestration"),
				research_handoff_ref: (() => {
					const handoff = jsonl(join(root,"auto-research-handoffs.jsonl")).findLast(row => row.status === "proposed");
					return handoff ? `research_handoff:${handoff.handoff_id}@v${handoff.version}` : undefined;
				})()}},
			{kind:"tool",name:"task_harness",arguments:{action:"inspect"}},
			...(scenarioResourceRefs[scenario].startsWith("skill:") ? [readBaseline("skill-creator")] : []),
			...(scenarioResourceRefs[scenario].startsWith("tool:") ? [readBaseline("tool-creator")] : []),
			...(scenarioResourceRefs[scenario].startsWith("subagent:") ? [readBaseline("subagent-creator")] : []),
			authorParentCandidate(scenario),
			assemble(scenarioResourceRefs[scenario]),
			{kind:"tool",name:"arc_action",arguments:{action:"ACTION1",reasoning:"Cross a real action boundary with the selected component."}},
		);
	}
	return parentSteps[request] ?? { kind: "text", text: "parent fixture complete" };
}

function contextEvidence(request: number, context: any) {
	const encoded = JSON.stringify(context.messages ?? []);
	const system = String(context.systemPrompt ?? "");
	const projected = (prefix: string) => (context.messages ?? []).flatMap((m: any) =>
		(m.content ?? []).filter((p: any) => p.type === "text" && p.text.startsWith(prefix)).map((p: any) => p.text)).join("\n");
	const exactMethodSkillProjected = (context.messages ?? []).some((m: any) => m.role === "user"
		&& (m.content ?? []).some((part: any) => part.type === "text"
			&& part.text.startsWith("Active task-local skills")
			&& part.text.includes("smoke-action-method") && part.text.includes("NEXT_ACTION: ACTION2")));
	const tools = context.tools ?? [];
	const submitTool = tools.find((tool: any) => String(tool.name) === "submit_research_report");
	const submitSchema = JSON.stringify(submitTool?.parameters ?? {});
	return {
		format: "arc-real-runner-provider-context-v1",
		...(["multi_region_cue", "multi_region_broad_cue"].includes(scenario) ? {
			multi_region_cue_count: encoded.split("MULTI-REGION PUBLIC CHANGE").length - 1,
			multi_region_cue_has_exact_ref: encoded.includes(`observation:execution-observation-${scenario === "multi_region_broad_cue" ? 45 : 27}@v1`),
			multi_region_cue_has_lag: encoded.includes(`${scenario === "multi_region_broad_cue" ? 3 : 5} later native actions occurred`),
			multi_region_cue_has_goal_answer: encoded.includes("SMOKE_GOAL_ANSWER"),
			complete_observation_present: Boolean(projected("CURRENT PUBLIC ARC OBSERVATION")),
		} : {}),
		...(["checkpoint_action_batch", "checkpoint_action_boundary", "action_knowledge"].includes(scenario) ? {
			checkpoint_batch_state:projected("CURRENT TASK STATE"),
			complete_observation_present:Boolean(projected("CURRENT PUBLIC ARC OBSERVATION")),
		} : {}),
		...(scenario === "review_input_repair" ? {
			review_repair_errors:(context.messages ?? []).filter((m:any) => m.role === "toolResult")
				.flatMap((m:any) => (m.content ?? []).flatMap((p:any) => {
					try {const value=JSON.parse(p.text); return value.code === "invalid_review"
						? [{chars:p.text.length,static_manual_present:Boolean(value.rules || value.pattern_template),
							required_next_call:value.required_next_call}] : [];} catch {return [];}
				})),
			review_contract_restored:(context.messages ?? []).some((m:any) => m.role === "toolResult"
				&& (m.content ?? []).some((p:any) => {try {const v=JSON.parse(p.text);
					return v.section === "review_contract" && Array.isArray(v.value?.rules) && Boolean(v.value?.pattern_template);
				} catch {return false;}})),
		} : {}),
		...(scenario === "review_advisory" ? { advisory_evidence_cue:projected("Periodic evidence available:"),
			due_review_cue_present:Boolean(projected("Periodic pattern extraction due:")),
			capability_workflow_present:Boolean(projected("Capability workflow reference:")),
			memory_candidate_cue:projected("MEMORY SELECTION CANDIDATES"),
			research_opportunity_cue:projected("OPEN RESEARCH OPPORTUNITIES"),
			decision_capsule_present:projected("CURRENT TASK STATE").includes("SMOKE_UNRESOLVED_CONTROL") } : {}),
		...(simpleCoordinateScenario ? { simple_action_receipts: (context.messages ?? [])
			.filter((message: any) => message.role === "toolResult" && message.toolName === "arc_action")
			.map((message: any) => {
				const text = (message.content ?? []).filter((part: any) => part.type === "text")
					.map((part: any) => String(part.text)).join("\n");
				return {ignored_coordinates:text.includes("supplied x/y were ignored"),
					claims_coordinate_target:text.includes("target=frame[")};
			}) } : {}),
		...(selectedSnapshotScenario ? {
			selected_scene: selectedSceneEvidence(context),
			parent_has_scene_result: (context.messages ?? []).some((message: any) => message.role === "toolResult"
				&& message.toolName === "delegate_task" && JSON.stringify(message.content).includes("grid_sha256")),
		} : {}),
		scenario, request, child: process.env.PI_TASK_CHILD === "1",
		...(scenario === "read_workset" ? { decision_card_goal_gap_present:
			projected("CURRENT TASK STATE").includes("SMOKE_GOAL_STILL_UNKNOWN")
			&& projected("CURRENT TASK STATE").includes("SMOKE_OPERATION_EFFECT_IS_NOT_GOAL_PROOF") } : {}),
		research_child: process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1",
		parent_guide_present: system.includes("# Auto-Research: parent guide"),
		parent_decision_contract_present: system.includes("AUTO-RESEARCH:")
			&& system.includes("bounded") && system.includes("read-only")
			&& /live (evidence|environment)/.test(encoded)
			&& /Choose (direct )?action, Auto-Research|Use Auto-Research for a grounded uncertainty/.test(encoded),
		child_guide_present: system.includes("# Auto-Research: child instructions"),
		profile_headings: [...system.matchAll(/^# Research focus: (.+)$/gm)].map((match) => match[1]),
		delivery_guide_in_system: system.includes("# Parent-authored Harness delivery"),
		submission_contract_seen: Boolean(submitTool) && !submitSchema.includes("harness_proposals")
			&& submitSchema.includes("method_candidates") && submitSchema.includes("method"),
		child_creator_tools_absent: process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL !== "1"
			|| !tools.some((tool: any) => ["harness_method", "research_approval", "task_harness"].includes(String(tool.name))),
		tool_names: tools.map((tool: any) => String(tool.name)),
		...(scenario === "read_workset" ? { read_workset_pages: (context.messages ?? []).flatMap((m: any) =>
			m.toolName === "task_resource" ? (m.content ?? []).flatMap((p: any) => {
				try { const page = JSON.parse(p.text); return page.ref === "memory:smoke-read-workset@v1" && typeof page.text === "string"
					? [{ offset: page.offset, page_sha256: page.page_sha256, chars: page.text.length }] : []; } catch { return []; }
			}) : []) } : {}),
		worker_increment_refs: continuousWorkers && process.env.PI_TASK_CHILD !== "1"
			? [...new Set((Array.isArray(context.messages) ? context.messages : []).flatMap((m: any) =>
				(Array.isArray(m.content) ? m.content : []).filter((b: any) => String(b.text ?? "").startsWith("AUTO-RESEARCH COMPLETION INBOX"))
					.flatMap((b: any) => String(b.text).match(/research_update:[A-Za-z0-9_.-]+@v[1-9]\d*/g) ?? [])))] : [],
		tool_schema_json_chars: Object.fromEntries(tools.map((tool: any) =>
			[String(tool.name), JSON.stringify(tool).length])),
		system_has_marker: String(context.systemPrompt ?? "").includes("SMOKE_SYSTEM_MARKER"),
		system_has_pool_marker: String(context.systemPrompt ?? "").includes("SMOKE_POOL_SYSTEM"),
		system_has_online_retrospective_policy: String(context.systemPrompt ?? "").includes("SMOKE_ONLINE_RETRO_POLICY"),
		messages_have_memory_marker: encoded.includes("SMOKE_MEMORY_MARKER"),
		messages_have_skill_marker: encoded.includes("SMOKE_SKILL_MARKER"),
		messages_have_exact_method_skill_projection: exactMethodSkillProjected,
		messages_have_pool_memory_marker: projected("Active task-local memory index:").includes("SMOKE_POOL_MEMORY"),
		messages_have_capture_memory_marker: encoded.includes("SMOKE_CAPTURE_MEMORY"),
		memory_pool_tool_available: tools.some((tool: any) => String(tool.name) === "task_memory_pool"),
		messages_have_pool_skill_marker: encoded.includes("SMOKE_POOL_SKILL"),
		parent_projection_has_open_direct_intent: projected("Pending parent capability decisions")
			.includes(`"operation_id":"${directIntentId}"`)
			&& projected("Pending parent capability decisions").includes('"status":"open"'),
		messages_have_recovered_skill_marker: encoded.includes("SMOKE_RECOVERED_SKILL_MARKER"),
		messages_have_online_retrospective_skill: encoded.includes("SMOKE_ONLINE_RETRO_SKILL"),
		announced_snapshot_refs: [...(system + "\n" + projected("CURRENT PUBLIC ARC OBSERVATION"))
			.matchAll(/Immutable exact resource for this same observed state:\s+(observation_snapshot:[^\s.]+)/g)]
			.map((match) => match[1]),
		system_has_delegated_action: (system + encoded).includes("ACTION/RESULT arc-action-1"),
		system_has_batch_results: (system + encoded).includes("ACTION/RESULT arc-action-2")
			&& (system + encoded).includes("ACTION/RESULT arc-action-3"),
		scoped_memory_expiry_verified: projected("Task-local knowledge requiring review:").includes("scope_expired:level:")
			&& projected("Task-local knowledge requiring review:").includes("scope_expired:state:")
			&& !projected("Active dynamic task/user prompt knowledge:").includes("SMOKE_TEMPORARY_")
			&& projected("Active task policy:").includes("SMOKE_NEW_POLICY"),
		knowledge_lifecycle_verified: projected("Active task policy:").includes("SMOKE_NEW_POLICY")
			&& !projected("Active task policy:").includes("SMOKE_MEMORY_MARKER")
			&& !projected("Active task-local skills").includes("SMOKE_OLD_DEPENDENT")
			&& !projected("Active dynamic task/user prompt knowledge:").includes("SMOKE_OLD_STATE")
			&& encoded.includes("memory:smoke-state@v1")
			&& encoded.includes("dependency_requires_review:skill:smoke-dependent@v1"),
		checkpoint_reloaded: process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1"
			&& existsSync(join(root, "task-context-cache", "auto-research-checkpoints", `${process.env.PI_AUTO_RESEARCH_SESSION_ID}.json`))
			? JSON.parse(readFileSync(join(root, "task-context-cache", "auto-research-checkpoints", `${process.env.PI_AUTO_RESEARCH_SESSION_ID}.json`), "utf8")) : null,
	};
}

export default function arcHarnessSmokeProvider(pi: ExtensionAPI) {
	let request = 0;
	let toolCall = 0;
	pi.registerProvider("offline-arc-harness-smoke", {
		api: "openai-completions", apiKey: "offline", baseUrl: "http://unused.invalid",
		models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 175000, maxTokens: 16384,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model, context, options) {
			// A cancelled callback is not a new scripted decision or transport
			// request. Match the real provider's signal handling before advancing.
			if (options?.signal?.aborted) {
				const stream = createAssistantMessageEventStream();
				const error: AssistantMessage = { role:"assistant",api:model.api,provider:model.provider,model:model.id,
					content:[],stopReason:"aborted",timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,
					cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}} };
				stream.push({type:"error",reason:"aborted",error});stream.end();return stream;
			}
			appendFileSync(join(root, "arc-smoke-provider-contexts.jsonl"),
				JSON.stringify(contextEvidence(request, context)) + "\n", "utf8");
			const step = providerStep(request++, context);
			const stream = createAssistantMessageEventStream();
			const emit = () => {
			const stopReason = ["tool", "batch"].includes(step.kind) ? "toolUse" : step.kind === "length" ? "length" : "stop";
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], stopReason, timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			stream.push({ type: "start", partial: output });
			if (step.kind === "tool" || step.kind === "batch") {
				for (const call of step.kind === "batch" ? step.calls : [step]) {
				const contentIndex = output.content.length;
				const block = { type: "toolCall" as const, id: `arc-smoke-${++toolCall}`, name: call.name, arguments: call.arguments };
				output.content.push(block);
				stream.push({ type: "toolcall_start", contentIndex, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(call.arguments), partial: output });
				stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				}
			} else if (step.kind === "length" && step.thinkingOnly) {
				output.content.push({ type: "thinking", thinking: step.text });
				stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
				stream.push({ type: "thinking_delta", contentIndex: 0, delta: step.text, partial: output });
				stream.push({ type: "thinking_end", contentIndex: 0, content: step.text, partial: output });
			} else {
				output.content.push({ type: "text", text: step.text });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: output });
			}
			stream.push({ type: "done", reason: stopReason, message: output });
			stream.end();
			};
			if (continuousWorkers) setTimeout(emit, process.env.PI_TASK_CHILD === "1" ? 750 : 150);
			else emit();
			return stream;
		},
	});
}
