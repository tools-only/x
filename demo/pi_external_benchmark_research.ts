/** Shared task-local Auto-Research resources for external Pi benchmarks. */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installAgentOwnedObservationCompaction, OBSERVATION_COMPACTION_TOOL } from "./pi_agent_owned_observation_compaction.ts";

type Finding = {
	goal_id: string;
	finding_id: string;
	version: number;
	research_event_id: string;
	evidence_refs: string[];
	assessment_refs: string[];
	status: "active" | "resolved";
	question: string;
	scope: string;
	uncertainty: string;
	evidence: string;
	decision: string;
	expected_recurrence: "low" | "medium" | "high";
	remaining_uses: number;
	resolution?: string;
	recordedAt: string;
};

function textContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content.map((item: any) => item?.type === "text" && typeof item.text === "string" ? item.text : "").join("\n");
}

function nextCounter(records: Record<string, unknown>[], key: string): number {
	let largest = 0;
	for (const record of records) {
		const match = String(record[key] ?? "").match(/(\d+)$/);
		if (match) largest = Math.max(largest, Number(match[1]));
	}
	return largest;
}

function compactText(value: unknown, maximum = 320): string {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function activeFindingDigest(findings: Map<string, Finding>): Record<string, unknown>[] {
	return [...findings.values()]
		.filter((finding) => finding.status === "active" && finding.remaining_uses > 0)
		.sort((left, right) => String(left.recordedAt).localeCompare(String(right.recordedAt)))
		.slice(-3)
		.map((finding) => ({
			goal_id: finding.goal_id,
			finding_id: finding.finding_id,
			version: finding.version,
			question: compactText(finding.question),
			scope: compactText(finding.scope),
			uncertainty: compactText(finding.uncertainty),
			evidence: compactText(finding.evidence),
			decision: compactText(finding.decision),
			evidence_refs: finding.evidence_refs.slice(-8),
			assessment_refs: finding.assessment_refs.slice(-8),
			expected_recurrence: finding.expected_recurrence,
			remaining_uses: finding.remaining_uses,
		}));
}

export default function externalBenchmarkResearch(pi: ExtensionAPI) {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	const control = process.env.PI_AUTORESEARCH_VARIANT === "control";
	if (control) return;
	mkdirSync(root, { recursive: true });
	const readJsonl = (name: string): Record<string, any>[] => {
		const path = join(root, name);
		if (!existsSync(path)) return [];
		return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			try { const value = JSON.parse(line); return value && typeof value === "object" ? [value] : []; }
			catch { return []; }
		});
	};
	const append = (name: string, value: unknown) => appendFileSync(join(root, name), JSON.stringify(value) + "\n", "utf8");
	const observationRecords = readJsonl("execution-observations.jsonl");
	const observations = new Map(observationRecords.map((item) => [String(item.observation_id), item]));
	const findingRecords = readJsonl("research-resources.jsonl");
	const findings = new Map<string, Finding>();
	for (const item of findingRecords) {
		const previous = findings.get(String(item.finding_id));
		if (!previous || Number(item.version) >= previous.version) findings.set(String(item.finding_id), item as Finding);
	}
	let observationCounter = nextCounter(observationRecords, "observation_id");
	let findingCounter = nextCounter(findingRecords, "finding_id");
	let researchCounter = nextCounter(findingRecords, "research_event_id");
	let decisionCounter = nextCounter(readJsonl("harness-decisions.jsonl"), "decision_id");
	const pendingAssessments = new Map<string, Record<string, unknown>>();
	for (const assessment of readJsonl("effect-assessments.jsonl")) {
		pendingAssessments.set(String(assessment.effect_assessment_id), assessment);
	}

	pi.on("tool_result", async (event) => {
		if (["research_resource", OBSERVATION_COMPACTION_TOOL].includes(event.toolName)) return {};
		const observationId = `execution-observation-${++observationCounter}`;
		const resultText = textContent(event.content);
		const observation = {
			observation_id: observationId,
			event_id: observationId,
			tool_name: event.toolName,
			toolCallId: event.toolCallId,
			input: event.input,
			result_text: resultText,
			result: resultText,
			is_error: Boolean(event.isError),
			recordedAt: new Date().toISOString(),
		};
		observations.set(observationId, observation);
		append("execution-observations.jsonl", observation);
		const metadata = `EXECUTION_OBSERVATION: ${JSON.stringify({ observation_id: observationId, outcome: event.isError ? "error" : "success" })}`;
		const details = event.details && typeof event.details === "object"
			? { ...(event.details as Record<string, unknown>), observation }
			: { observation };
		return { content: [...event.content, { type: "text", text: metadata }], details };
	});

	pi.registerTool({
		name: "research_resource",
		label: "Task-local Research Resource",
		description: "Optional Agent-authored, versioned current-task finding. Cite exact execution observation IDs. inspect is read-only. No research and no change are valid.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("record"), Type.Literal("update"), Type.Literal("resolve"), Type.Literal("inspect")]),
			finding_id: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			observation_id: Type.Optional(Type.String()),
			question: Type.Optional(Type.String()),
			scope: Type.Optional(Type.String()),
			uncertainty: Type.Optional(Type.String()),
			evidence: Type.Optional(Type.String()),
			decision: Type.Optional(Type.String()),
			evidence_refs: Type.Array(Type.String()),
			assessment_refs: Type.Optional(Type.Array(Type.String())),
			expected_recurrence: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
			remaining_uses: Type.Optional(Type.Integer({ minimum: 0 })),
			resolution: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			const p = params as Record<string, any>;
			if (p.action === "inspect") {
				const selectedFindings = p.finding_id ? [findings.get(p.finding_id)].filter(Boolean) : [...findings.values()].slice(-5);
				const selectedObservations = p.observation_id ? [observations.get(p.observation_id)].filter(Boolean) : [];
				const result = { read_only: true, findings: selectedFindings, observations: selectedObservations,
					prior_decisions: readJsonl("harness-decisions.jsonl").slice(-8),
					exposure_observations: readJsonl("harness-observations.jsonl").slice(-8),
					effect_assessments: readJsonl("effect-assessments.jsonl").slice(-8) };
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			const evidenceRefs = Array.isArray(p.evidence_refs) ? p.evidence_refs : [];
			if (!evidenceRefs.length || evidenceRefs.some((id: string) => !observations.has(id))) throw new Error("findings require known execution observation IDs");
			const assessmentRefs = Array.isArray(p.assessment_refs) ? p.assessment_refs : [];
			if (assessmentRefs.some((id: string) => !pendingAssessments.has(id))) throw new Error("unknown effect assessment reference");
			let previous: Finding | undefined;
			if (p.action !== "record") {
				previous = findings.get(String(p.finding_id));
				if (!previous) throw new Error("unknown finding_id");
				if (previous.version !== p.target_version) throw new Error("target_version must match the current finding version");
			}
			const findingId = previous?.finding_id ?? `finding-${++findingCounter}`;
			const finding: Finding = {
				goal_id: previous?.goal_id ?? `research-goal-${findingCounter}`,
				finding_id: findingId,
				version: (previous?.version ?? 0) + 1,
				research_event_id: `research-event-${++researchCounter}`,
				evidence_refs: evidenceRefs,
				assessment_refs: assessmentRefs,
				status: p.action === "resolve" ? "resolved" : "active",
				question: String(p.question ?? previous?.question ?? "What task-local observation should change a later execution decision?"),
				scope: String(p.scope ?? previous?.scope ?? "current benchmark task"),
				uncertainty: String(p.uncertainty ?? previous?.uncertainty ?? "bounded task-local uncertainty"),
				evidence: String(p.evidence ?? previous?.evidence ?? ""),
				decision: String(p.decision ?? previous?.decision ?? ""),
				expected_recurrence: p.expected_recurrence ?? previous?.expected_recurrence ?? "medium",
				remaining_uses: Number(p.remaining_uses ?? previous?.remaining_uses ?? 1),
				...(p.resolution ? { resolution: String(p.resolution) } : {}),
				recordedAt: new Date().toISOString(),
			};
			findings.set(findingId, finding);
			append("research-resources.jsonl", finding);
			for (const id of assessmentRefs) pendingAssessments.delete(id);
			return { content: [{ type: "text", text: JSON.stringify(finding) }], details: finding };
		},
	});

	const compaction = installAgentOwnedObservationCompaction(pi, {
		enabled: process.env.PI_AUTORESEARCH_CONTEXT_COMPACTION === "enabled",
		scope: "current external benchmark task",
		getFinding: (id) => findings.get(id),
		getObservation: (id) => observations.get(id),
		allocateDecisionId: () => `decision-${++decisionCounter}`,
		append,
		pendingAssessments,
	});
	pi.on("before_agent_start", async (event) => {
		const projectRoot = resolve(
			process.env.PI_AUTORESEARCH_ROOT ?? process.env.AUTORESEARCH_PI_ROOT ?? ".",
		);
		let method = "Use research only when it changes a later decision; direct execution and no change are valid.";
		try { method = readFileSync(join(projectRoot, "demo", "auto_research_method.md"), "utf8"); } catch {}
		const capability = compaction.enabled
			? "An optional Pi-native compact_observation_context capability affects only later model requests; it requires an active finding citing every selected observation."
			: "No task-local context mutation capability is enabled for this run.";
		return { systemPrompt: `${event.systemPrompt}\n\n${method}\n\n${capability}` };
	});
	pi.on("context", async (event) => {
		const resources: any[] = [];
		const activeFindings = activeFindingDigest(findings);
		if (activeFindings.length) {
			resources.push({
				role: "user",
				content: [{
					type: "text",
					text: `Active task-local research findings for later decisions: ${JSON.stringify(activeFindings)}`,
				}],
				timestamp: Date.now(),
			});
		}
		if (pendingAssessments.size) {
			resources.push({
				role: "user",
				content: [{
					type: "text",
					text: `Pending task-local execution-condition effects: ${JSON.stringify([...pendingAssessments.values()])}`,
				}],
				timestamp: Date.now(),
			});
		}
		if (!resources.length) return {};
		return { messages: [...event.messages, ...resources] };
	});
}
