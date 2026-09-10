/** Pi-native DeepPlanning Shopping tools and optional task-local batch surface. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	installAgentOwnedObservationCompaction,
	OBSERVATION_COMPACTION_TOOL,
} from "./pi_agent_owned_observation_compaction.ts";

type SurfaceMode = "general" | "shopping_batch";
type Choice = "apply" | "keep";
type Outcome = "success" | "semantic_error" | "transport_error";
type Finding = {
	goal_id: string; finding_id: string; version: number; action: "record" | "update" | "resolve";
	question: string; scope: string; uncertainty: string; evidence: string; decision: string;
	evidence_refs: string[]; assessment_refs: string[]; expected_recurrence: "low" | "medium" | "high";
	remaining_uses: number; status: "active" | "resolved"; resolution?: string; research_event_id: string;
};
type PendingEffect = {
	decisionId: string; toolCallId: string; mode: SurfaceMode;
	basisResourceIds: string[]; basisSnapshots: Array<Record<string, unknown>>;
	expectedEffect: string; attempted: number; completed: number; toolCalls: number;
	batchCalls: number; bridgeProcesses: number; observationIds: string[]; horizon: number;
};

const SHOPPING_TOOLS = [
	"search_products", "filter_by_brand", "filter_by_color", "filter_by_size",
	"filter_by_applicable_coupons", "filter_by_range", "sort_products", "get_product_details",
	"calculate_transport_time", "get_user_info", "add_product_to_cart", "delete_product_from_cart",
	"get_cart_info", "add_coupon_to_cart", "delete_coupon_from_cart",
] as const;

const toolSurfaces: Record<SurfaceMode, string[]> = {
	general: [...SHOPPING_TOOLS, "research_resource", "decide_execution_surface"],
	shopping_batch: [...SHOPPING_TOOLS, "shopping_batch_action", "research_resource", "decide_execution_surface"],
};

function shoppingParameters(tool: string) {
	// Keep every property non-nullable: the installed OpenAI-compatible gateway
	// rejects TypeBox's optional-array/null representation. Empty arrays/strings
	// express the documented default and are normalized before the JIT call.
	const ids = Type.Array(Type.String());
	switch (tool) {
		case "search_products": return Type.Object({ query: Type.String(), limit: Type.Integer({ minimum: 1 }) });
		case "filter_by_brand": return Type.Object({ product_ids: ids, brand_names: Type.Array(Type.String()) });
		case "filter_by_color": return Type.Object({ product_ids: ids, colors: Type.Array(Type.String()) });
		case "filter_by_size": return Type.Object({ product_ids: ids, sizes: Type.Array(Type.String()) });
		case "filter_by_applicable_coupons": return Type.Object({ product_ids: ids, coupon_names: Type.Array(Type.String()) });
		case "filter_by_range": return Type.Object({ product_ids: ids, condition_key: Type.String(), operator: Type.String(), value: Type.Number() });
		case "sort_products": return Type.Object({ product_ids: ids, sort_by: Type.String(), order: Type.String() });
		case "get_product_details": return Type.Object({ product_ids: Type.Array(Type.String()) });
		case "calculate_transport_time": return Type.Object({ product_id: Type.String(), destination_address: Type.String(), provider: Type.String() });
		case "get_user_info": return Type.Object({ user_id: Type.String() });
		case "add_product_to_cart": return Type.Object({ product_id: Type.String(), quantity: Type.Integer({ minimum: 1 }) });
		case "delete_product_from_cart": return Type.Object({ product_id: Type.String(), quantity: Type.Integer({ minimum: 1 }) });
		case "get_cart_info": return Type.Object({ unused: Type.String() });
		case "add_coupon_to_cart": return Type.Object({ coupon_name: Type.String(), quantity: Type.Integer({ minimum: 1 }) });
		case "delete_coupon_from_cart": return Type.Object({ coupon_name: Type.String(), quantity: Type.Integer({ minimum: 1 }) });
		default: return Type.Object({});
	}
}

export default function shoppingE2EExtension(pi: ExtensionAPI) {
	const root = resolve(process.env.PI_SHOPPING_E2E_ROOT ?? ".");
	if (!process.env.PI_OFFICEBENCH_E2E_ROOT) process.env.PI_OFFICEBENCH_E2E_ROOT = root;
	const dbDir = resolve(process.env.PI_SHOPPING_DB_DIR ?? ".");
	const cartPath = resolve(process.env.PI_SHOPPING_CART_PATH ?? join(root, "cart.json"));
	const jitRoot = resolve(process.env.JIT_ROOT ?? "D:/JIT");
	const jitPython = process.env.JIT_PYTHON ?? "python";
	const control = process.env.PI_SHOPPING_EXPERIMENT_VARIANT === "control";
	const contextCompactionEnabled = !control && process.env.PI_SHOPPING_CONTEXT_COMPACTION === "enabled";
	const method = readFileSync(fileURLToPath(new URL("./auto_research_method.md", import.meta.url)), "utf8");
	let surface: SurfaceMode = "general";
	let findingCounter = 0;
	let eventCounter = 0;
	let researchEventCounter = 0;
	let decisionCounter = 0;
	let observedSurface = false;
	let modelVisibleObservationChars = 0;
	let pending: PendingEffect | undefined;
	const pendingAssessments = new Map<string, Record<string, unknown>>();
	const findings = new Map<string, Finding>();
	const observations = new Map<string, Record<string, unknown>>();
	const append = (name: string, value: unknown) => appendFileSync(join(root, name), `${JSON.stringify(value)}\n`, "utf8");
	const readJsonl = (name: string): Array<Record<string, any>> => {
		const path = join(root, name);
		if (!existsSync(path)) return [];
		try {
			return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
				try { const value = JSON.parse(line); return value && typeof value === "object" && !Array.isArray(value) ? [value] : []; }
				catch { return []; }
			});
		} catch { return []; }
	};
	const numericSuffix = (value: unknown): number => {
		const match = typeof value === "string" && value.match(/(?:^|[-_])(\d+)$/);
		return match ? Number(match[1]) : 0;
	};
	for (const observation of readJsonl("execution-observations.jsonl")) {
		if (typeof observation.event_id === "string") observations.set(observation.event_id, observation);
		eventCounter = Math.max(eventCounter, numericSuffix(observation.event_id));
	}
	for (const finding of readJsonl("research-resources.jsonl")) {
		if (typeof finding.finding_id !== "string" || typeof finding.version !== "number") continue;
		const previous = findings.get(finding.finding_id);
		if (!previous || finding.version >= previous.version) findings.set(finding.finding_id, finding as Finding);
		findingCounter = Math.max(findingCounter, numericSuffix(finding.finding_id));
		researchEventCounter = Math.max(researchEventCounter, numericSuffix(finding.research_event_id));
	}
	for (const decision of readJsonl("harness-decisions.jsonl")) decisionCounter = Math.max(decisionCounter, numericSuffix(decision.decision_id));
	for (const assessment of readJsonl("effect-assessments.jsonl")) pendingAssessments.set(String(assessment.effect_assessment_id), assessment);
	for (const finding of findings.values()) for (const assessmentId of finding.assessment_refs ?? []) pendingAssessments.delete(assessmentId);
	const restoredResourceHint = findings.size || pendingAssessments.size
		? "This task directory contains prior task-local research records from an earlier supported continuation. They are not execution state: if relevant, call research_resource action=inspect (read-only) to review them; the current Shopping surface still starts from its safe baseline and any new apply/keep decision remains yours. "
		: "";
	const summarize = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 500);
	const runBridge = (tool: string, args: Record<string, unknown>): string => {
		const normalized = { ...args };
		if (tool === "get_cart_info") delete normalized.unused;
		for (const key of ["user_id", "provider"]) if (normalized[key] == null) delete normalized[key];
		for (const key of ["limit", "order", "quantity"]) if (normalized[key] == null) delete normalized[key];
		for (const key of ["product_ids"]) if (normalized[key] == null) delete normalized[key];
		const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONPATH: `${process.env.AUTORESEARCH_PI_SRC ?? join(root, "src")};${process.env.PYTHONPATH ?? ""}` };
		const child = spawnSync(jitPython, ["-m", "autoresearch_pi.shopping_tool_bridge"], {
			cwd: jitRoot, env, encoding: "utf8", input: JSON.stringify({ db_dir: dbDir, cart_path: cartPath, tool, arguments: normalized }), timeout: 120_000,
		});
		if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stderr ?? `shopping bridge exited ${child.status}`);
		return child.stdout;
	};
	const finishPendingEffect = (completionReason: "horizon_reached" | "task_settled", forcedVerdict?: "inconclusive") => {
		if (!pending) return;
		const supported = pending.batchCalls === 1 && pending.attempted >= 2 && pending.completed === pending.attempted;
		const assessment = {
			effect_assessment_id: `effect-assessment-${pending.decisionId.replace(/^decision-/, "")}`,
			decision_id: pending.decisionId,
			toolCallId: pending.toolCallId, basis_resource_ids: pending.basisResourceIds,
			basis_snapshots: pending.basisSnapshots,
			effect_metric: "shopping_batch_utilization",
			expected_effect: pending.expectedEffect, exposure_observed: observedSurface,
			window: {
				horizon: pending.horizon, completion_reason: completionReason,
				observation_ids: pending.observationIds, attempted_work_units: pending.attempted,
				completed_work_units: pending.completed, pi_tool_calls: pending.toolCalls,
				batch_calls: pending.batchCalls,
				tool_call_compression: pending.toolCalls ? pending.attempted / pending.toolCalls : 0,
				bridge_processes: pending.bridgeProcesses,
				work_units_per_bridge_process: pending.bridgeProcesses ? pending.attempted / pending.bridgeProcesses : 0,
			},
			verdict: forcedVerdict ?? (supported ? "supported" : "contradicted"),
			improvement: "not_established",
			attribution: { kind: "bounded_temporal_window", intervention: "execution_tool_surface",
				decision_id: pending.decisionId, basis_resource_ids: pending.basisResourceIds,
				confounders_controlled: false, scope: "current Shopping task" },
			recordedAt: new Date().toISOString(),
		};
		append("effect-assessments.jsonl", assessment);
		pendingAssessments.set(String(assessment.effect_assessment_id), assessment);
		pending = undefined;
	};
	const recordObservation = (
		toolCallId: string, tool: string, args: Record<string, unknown>, text: string,
		outcome: Outcome, units = 1, completedUnits = outcome === "success" ? units : 0,
		extra: Record<string, unknown> = {},
	) => {
		const eventId = `shopping-observation-${++eventCounter}`;
		// Preserve the complete task observation. The runtime does not choose
		// domain fields, truncate arrays, or infer capability candidates.
		const record = { event_id: eventId, toolCallId, tool, operation: tool, args, outcome,
			attempted_work_units: units, completed_work_units: completedUnits, result: text,
			result_chars: text.length, category: "task_action", recordedAt: new Date().toISOString(), ...extra };
		observations.set(eventId, record); append("execution-observations.jsonl", record);
		const relevant = tool === "shopping_batch_action" || tool === "add_product_to_cart";
		if (pending && observedSurface && relevant) {
			pending.attempted += units; pending.completed += completedUnits; pending.toolCalls += 1;
			pending.bridgeProcesses += typeof extra.bridge_processes === "number" ? extra.bridge_processes : 1;
			pending.observationIds.push(eventId);
			if (tool === "shopping_batch_action") pending.batchCalls += 1;
			if (tool === "shopping_batch_action" || pending.toolCalls >= pending.horizon) finishPendingEffect("horizon_reached");
		}
		return { ...record, observation_id: eventId };
	};
	const observationText = (text: string, observation: Record<string, unknown>) => {
		// The result is already present in `text`; append only neutral provenance
		// and outcome metadata instead of duplicating task data.
		const { result: _result, args: _args, toolCallId: _toolCallId, ...metadata } = observation;
		const visible = control ? text : `${text}\n\nEXECUTION_OBSERVATION: ${JSON.stringify(metadata)}`;
		modelVisibleObservationChars += visible.length;
		return visible;
	};
	const allocateDecisionId = () => `decision-${++decisionCounter}`;
	const contextCompaction = installAgentOwnedObservationCompaction(pi, {
		enabled: contextCompactionEnabled,
		getFinding: (findingId) => findings.get(findingId),
		getObservation: (observationId) => observations.get(observationId),
		allocateDecisionId,
		append,
		pendingAssessments,
	});
	const activeToolsForSurface = (mode: SurfaceMode) => contextCompaction.enabled
		? [...toolSurfaces[mode], OBSERVATION_COMPACTION_TOOL]
		: toolSurfaces[mode];
	const taskCapabilityCatalog = {
		format: "shopping-task-capability-catalog-v2",
		scope: "one_pi_agent_process",
		effect_timing: "next_model_request",
		initial_surface: "general",
		active_tools: activeToolsForSurface("general"),
		resources: [{
			id: "research_resource", kind: "task_resource", optional: true,
			read_only_query: "action=inspect", scope: "current Shopping task only",
			changes_execution: "only an active evidence-backed finding with continue_with can change the surface",
		}, ...(contextCompaction.capability ? [contextCompaction.capability] : [])],
		available_inactive: [{
			tool: "shopping_batch_action",
			changes: "add 2-16 products through one Pi tool call and one bridge process",
			enabled_by: "pi.setActiveTools via finding-backed shopping_batch decision",
			effective_at: "next_model_request", scope: "current Shopping task",
		}],
	};
	const attributionMethod = control ? "" : `${method}\n\n`;
	const preparePendingEffect = (
		mode: SurfaceMode, decision: Record<string, any>,
	): PendingEffect => {
		return {
			decisionId: decision.decision_id, toolCallId: decision.toolCallId, mode,
			basisResourceIds: decision.basis_resource_ids, basisSnapshots: decision.basis_snapshots,
			expectedEffect: decision.expected_effect, attempted: 0, completed: 0, toolCalls: 0,
			batchCalls: 0, bridgeProcesses: 0, observationIds: [], horizon: decision.observation_horizon,
		};
	};

	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "capability-catalog.json"), `${JSON.stringify(taskCapabilityCatalog, null, 2)}\n`, "utf8");

	pi.on("before_agent_start", async (event) => ({ systemPrompt: `${event.systemPrompt}\n\n` + attributionMethod +
		"This is one isolated DeepPlanning Shopping task. Use the listed Shopping tools and always inspect get_cart_info before finishing. " +
		restoredResourceHint +
		"Research and harness changes are optional; direct completion and no-change are valid. The task-local research_resource is an agent-authored, versioned finding: cite execution observation IDs when recording a material conclusion. " +
		(control ? "This control run does not expose research or self-harness capabilities. " : `Current task capability catalog (bounded static disclosure): ${JSON.stringify(taskCapabilityCatalog)} The runtime does not infer candidates from particular task actions. You alone decide from task-local evidence whether to record a finding and apply, keep, revert, or ignore a capability. A system effect assessment is only feedback; absorb it explicitly in a later finding update or resolution if useful. `) +
		"Do not use execute_code, inspect benchmark implementation, or access sibling tasks." }));
	pi.on("before_agent_start", async () => {
		// Pi runtime is initialized at this lifecycle boundary; the operation
		// affects only the following model request.
		pi.setActiveTools(control ? SHOPPING_TOOLS.slice() : activeToolsForSurface("general"));
		return {};
	});
	pi.on("context", async (event) => {
		const messages = [...event.messages];
		if (!control && pendingAssessments.size) messages.push({ role: "user", content: [{ type: "text", text: `Pending task-local execution-condition effects (cite assessment_refs in research_resource when they change the finding): ${JSON.stringify([...pendingAssessments.values()])}` }], timestamp: Date.now() });
		if (!control) {
			const active = [...findings.values()].filter((finding) => finding.status !== "resolved").slice(-5);
			if (active.length) messages.push({ role: "user", content: [{ type: "text", text: `Task-local shopping findings: ${JSON.stringify(active)}` }], timestamp: Date.now() });
		}
		if (!observedSurface && surface !== "general") {
			observedSurface = true;
			const observation = { observation_id: "shopping-harness-observation-1", decision_id: pending?.decisionId, toolCallId: pending?.toolCallId, basis_resource_ids: pending?.basisResourceIds ?? [], operation: { capability: "pi.setActiveTools", previous: "general", value: surface }, effect_observed: true, active_tools: pi.getActiveTools(), recordedAt: new Date().toISOString() };
			append("harness-observations.jsonl", observation);
			messages.push({ role: "user", content: [{ type: "text", text: `Pi-native execution surface observed: ${JSON.stringify(observation)}` }], timestamp: Date.now() });
		}
		return { messages };
	});
	pi.on("agent_end", async () => {
		if (pending) finishPendingEffect("task_settled", "inconclusive");
		writeFileSync(join(root, "model-visible-observation-metrics.json"), JSON.stringify({ format: "shopping-model-visible-observation-metrics-v2", observation_chars: modelVisibleObservationChars, decision_support_cards: 0, control_run: control, representation: "complete_result_with_neutral_metadata" }, null, 2) + "\n", "utf8");
	});

	for (const tool of SHOPPING_TOOLS) {
		pi.registerTool({ name: tool, label: tool, description: `JIT DeepPlanning Shopping action ${tool}. Use only for the current task database and cart. Do not pass null for optional fields; omit them.`, parameters: shoppingParameters(tool), async execute(toolCallId, params) {
			try { const text = runBridge(tool, params as Record<string, unknown>); let outcome: Outcome = "success"; try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object" && typeof parsed.error === "string" && parsed.error.trim()) outcome = "semantic_error"; } catch {} const units = tool === "get_product_details" && Array.isArray((params as Record<string, unknown>).product_ids) ? ((params as Record<string, unknown>).product_ids as unknown[]).length : 1; const observation = recordObservation(toolCallId, tool, params as Record<string, unknown>, text, outcome, units); return { content: [{ type: "text", text: observationText(text, observation) }], details: { observation }, isError: outcome !== "success" }; }
			catch (error) { const text = String(error); const observation = recordObservation(toolCallId, tool, params as Record<string, unknown>, text, "transport_error"); return { content: [{ type: "text", text: observationText(text, observation) }], details: { observation }, isError: true }; }
		} });
	}

	pi.registerTool({ name: "research_resource", label: "Task-local Research Resource", description: "Optional agent-authored finding. action=inspect is read-only and reloads current-task findings, decisions, exposure observations, and effects after a supported same-task restart; observation_id explicitly retrieves one complete canonical observation. It never changes execution. record needs evidence_refs and either decision or continue_with; when decision is omitted, continue_with supplies the saved execution decision. continue_with may apply the disclosed Shopping batch surface after a finding.", parameters: Type.Object({ action: Type.Union([Type.Literal("record"), Type.Literal("update"), Type.Literal("resolve"), Type.Literal("inspect")]), finding_id: Type.Optional(Type.String()), observation_id: Type.Optional(Type.String()), evidence: Type.Optional(Type.String()), decision: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), question: Type.Optional(Type.String()), uncertainty: Type.Optional(Type.String()), evidence_refs: Type.Array(Type.String()), assessment_refs: Type.Optional(Type.Array(Type.String())), expected_recurrence: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])), remaining_uses: Type.Optional(Type.Integer({ minimum: 0 })), resolution: Type.Optional(Type.String()), continue_with: Type.Optional(Type.Object({ choice: Type.Union([Type.Literal("apply"), Type.Literal("keep")]), mode: Type.Literal("shopping_batch"), expected_effect: Type.String(), observation_horizon: Type.Integer({ minimum: 1, maximum: 8 }), reconsider_when: Type.String() })) }), async execute(toolCallId, params) {
			if (control) throw new Error("research resources are disabled in control");
			const p = params as Record<string, any>; const action = p.action as string;
			if (action === "inspect") {
				const selected = [...findings.values()].filter((finding) => !p.finding_id || finding.finding_id === p.finding_id);
				const selectedObservation = typeof p.observation_id === "string" ? observations.get(p.observation_id) : undefined;
				if (typeof p.observation_id === "string" && !selectedObservation) throw new Error(`unknown execution observation: ${p.observation_id}`);
				const compactFinding = (finding: Finding) => ({
					goal_id: finding.goal_id, finding_id: finding.finding_id, version: finding.version,
					action: finding.action, status: finding.status, resolution: finding.resolution,
					question: summarize(finding.question).slice(0, 240), scope: summarize(finding.scope).slice(0, 240),
					uncertainty: summarize(finding.uncertainty).slice(0, 240), evidence: summarize(finding.evidence).slice(0, 240),
					decision: summarize(finding.decision).slice(0, 240), evidence_refs: finding.evidence_refs,
					assessment_refs: finding.assessment_refs, expected_recurrence: finding.expected_recurrence,
					remaining_uses: finding.remaining_uses,
				});
				const decisions = readJsonl("harness-decisions.jsonl").slice(-8).map((decision) => ({
					decision_id: decision.decision_id, choice: decision.choice, applied: decision.applied,
					value: decision.value, basis_resource_ids: decision.basis_resource_ids,
					basis_snapshots: decision.basis_snapshots, effect_metric: decision.effect_metric,
					toolCallId: decision.toolCallId,
				}));
				const exposures = readJsonl("harness-observations.jsonl").slice(-8).map((observation) => ({
					observation_id: observation.observation_id, decision_id: observation.decision_id,
					effect_observed: observation.effect_observed, operation: observation.operation,
					consequence: observation.consequence,
				}));
				const effects = readJsonl("effect-assessments.jsonl").slice(-8).map((assessment) => ({
					effect_assessment_id: assessment.effect_assessment_id, decision_id: assessment.decision_id,
					effect_metric: assessment.effect_metric, verdict: assessment.verdict,
					window: assessment.window ? {
						completed_work_units: assessment.window.completed_work_units,
						attempted_work_units: assessment.window.attempted_work_units,
						tool_call_compression: assessment.window.tool_call_compression,
						observation_ids: assessment.window.observation_ids,
					} : undefined,
				}));
				const resource = { format: "task-local-research-inspection-v1", scope: "current task only", findings: selected.map(compactFinding), observations: selectedObservation ? [selectedObservation] : [], prior_decisions: decisions, exposure_observations: exposures, effect_assessments: effects, read_only: true };
				return { content: [{ type: "text", text: JSON.stringify(resource) }], details: resource };
			}
			if (typeof p.evidence !== "string" || !p.evidence.trim()) throw new Error(`${action} requires evidence`);
			const statedDecision = typeof p.decision === "string" ? p.decision.trim() : "";
			if (!statedDecision && !(action === "record" && p.continue_with)) throw new Error(`${action} requires decision`);
			let finding: Finding;
			if (action === "record") { if (!p.evidence_refs?.length) throw new Error("record requires evidence_refs"); const id = `finding-${++findingCounter}`; const decision = statedDecision || `${p.continue_with.choice} ${p.continue_with.mode}: ${p.continue_with.expected_effect}`; finding = { goal_id: `research-goal-${findingCounter}`, finding_id: id, version: 1, action: "record", question: p.question ?? "What should later shopping execution infer from the cited outcome?", scope: p.scope ?? "later shopping actions in this task", uncertainty: p.uncertainty ?? "Whether the observed outcome recurs", evidence: p.evidence, decision, evidence_refs: p.evidence_refs, assessment_refs: p.assessment_refs ?? [], expected_recurrence: p.expected_recurrence ?? "medium", remaining_uses: p.remaining_uses ?? 0, status: "active", research_event_id: `research-event-${++researchEventCounter}` }; }
			else { const current = [...findings.values()].find((item) => !p.finding_id || item.finding_id === p.finding_id); if (!current) throw new Error("finding not found"); finding = { ...current, ...p, action: action as any, version: current.version + 1, research_event_id: `research-event-${++researchEventCounter}`, status: action === "resolve" ? "resolved" : "active" }; }
			for (const ref of finding.evidence_refs) if (!observations.has(ref)) throw new Error(`unknown execution observation: ${ref}`);
			for (const ref of finding.assessment_refs) if (!pendingAssessments.has(ref)) throw new Error(`unknown pending effect assessment: ${ref}`);
			findings.set(finding.finding_id, finding); append("research-resources.jsonl", finding);
			for (const ref of finding.assessment_refs) pendingAssessments.delete(ref);
			if (p.continue_with) {
				if (!finding.evidence_refs.length || finding.status !== "active") throw new Error("continue_with requires an active evidence-backed finding");
				const mode = p.continue_with.mode as SurfaceMode; const decision = { decision_id: allocateDecisionId(), decision_path: "research_resource.continue_with", choice: p.continue_with.choice as Choice, applied: p.continue_with.choice === "apply", basis_resource_ids: [finding.finding_id], basis_snapshots: [{ finding_id: finding.finding_id, goal_id: finding.goal_id, version: finding.version, research_event_id: finding.research_event_id, evidence_refs: finding.evidence_refs, assessment_refs: finding.assessment_refs }], previous: surface, value: mode, effect_metric: "shopping_batch_utilization", expected_effect: p.continue_with.expected_effect, observation_horizon: p.continue_with.observation_horizon, reconsider_when: p.continue_with.reconsider_when, toolCallId: toolCallId, recordedAt: new Date().toISOString() };
				const nextPending = decision.applied ? preparePendingEffect(mode, decision) : undefined; append("harness-decisions.jsonl", decision); if (decision.applied) { pi.setActiveTools(activeToolsForSurface(mode)); surface = mode; observedSurface = false; pending = nextPending; }
				return { content: [{ type: "text", text: `${JSON.stringify(finding)}\n\nEXECUTION_SURFACE_DECISION: ${JSON.stringify(decision)}` }], details: { finding, decision } };
			}
			return { content: [{ type: "text", text: JSON.stringify(finding) }], details: finding };
		} });

	pi.registerTool({ name: "decide_execution_surface", label: "Decide Shopping Surface", description: "After an evidence-backed finding, choose whether to enable the disclosed Shopping batch surface. No change is valid.", parameters: Type.Object({ choice: Type.Union([Type.Literal("apply"), Type.Literal("keep")]), mode: Type.Literal("shopping_batch"), basis_resource_ids: Type.Array(Type.String(), { minItems: 1 }), expected_effect: Type.String(), observation_horizon: Type.Integer({ minimum: 1, maximum: 8 }), reconsider_when: Type.String() }), async execute(toolCallId, params) {
			if (control) throw new Error("surface decisions are disabled in control"); const p = params as Record<string, any>; const basis = p.basis_resource_ids as string[]; if (!basis.every((id) => findings.has(id))) throw new Error("unknown finding basis"); const basisFindings = basis.map((id) => findings.get(id)!); if (basisFindings.some((finding) => finding.status !== "active")) throw new Error("surface decisions require active findings"); const applied = p.choice === "apply"; const mode = p.mode as SurfaceMode; const decision = { decision_id: allocateDecisionId(), decision_path: "decide_execution_surface", choice: p.choice, applied, basis_resource_ids: basis, basis_snapshots: basisFindings.map((finding) => ({ finding_id: finding.finding_id, goal_id: finding.goal_id, version: finding.version, research_event_id: finding.research_event_id, evidence_refs: finding.evidence_refs, assessment_refs: finding.assessment_refs })), previous: surface, value: applied ? mode : surface, effect_metric: "shopping_batch_utilization", expected_effect: p.expected_effect, observation_horizon: p.observation_horizon, reconsider_when: p.reconsider_when, toolCallId, recordedAt: new Date().toISOString() }; const nextPending = applied ? preparePendingEffect(mode, decision) : undefined; append("harness-decisions.jsonl", decision); if (applied) { pi.setActiveTools(activeToolsForSurface(mode)); surface = mode; observedSurface = false; pending = nextPending; } return { content: [{ type: "text", text: JSON.stringify(decision) }], details: decision };
	} });

	pi.registerTool({ name: "shopping_batch_action", label: "Shopping Batch Add", description: "Initially inactive. After a finding-backed Pi-native surface decision, add 2-16 products to the cart through one bridge process. Non-atomic; inspect each result.", parameters: Type.Object({ items: Type.Array(Type.Object({ product_id: Type.String(), quantity: Type.Integer({ minimum: 1 }) }), { minItems: 2, maxItems: 16 }) }), async execute(toolCallId, params) {
			const p = params as { items: Array<{ product_id: string; quantity: number }> }; try { const text = runBridge("shopping_batch_action", p as unknown as Record<string, unknown>); const result = JSON.parse(text) as { attempted: number; completed: number; bridge_processes: number; results: Array<Record<string, unknown>> }; if (result.bridge_processes !== 1) throw new Error("shopping batch bridge did not report exactly one process"); const outcome: Outcome = result.completed === result.attempted ? "success" : "semantic_error"; const observation = recordObservation(toolCallId, "shopping_batch_action", {}, text, outcome, result.attempted, result.completed, { bridge_processes: result.bridge_processes }); return { content: [{ type: "text", text: observationText(text, observation) }], details: { observation, results: result.results }, isError: outcome !== "success" }; } catch (error) { const text = String(error); const observation = recordObservation(toolCallId, "shopping_batch_action", {}, text, "transport_error", p.items.length, 0, { bridge_processes: 1 }); return { content: [{ type: "text", text: observationText(text, observation) }], details: { observation, results: [] }, isError: true }; }
	} });

}
