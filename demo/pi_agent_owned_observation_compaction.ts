/** Agent-selected task-local observation representation through Pi's native context hook. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const OBSERVATION_COMPACTION_TOOL = "compact_observation_context";

type FindingBasis = {
	goal_id: string;
	finding_id: string;
	version: number;
	research_event_id: string;
	evidence_refs: string[];
	assessment_refs: string[];
	status: "active" | "resolved";
};

type CompactionDependencies = {
	enabled: boolean;
	getFinding: (findingId: string) => FindingBasis | undefined;
	getObservation: (observationId: string) => Record<string, unknown> | undefined;
	allocateDecisionId: () => string;
	append: (name: string, value: unknown) => void;
	pendingAssessments: Map<string, Record<string, unknown>>;
};

type AppliedCompaction = {
	decisionId: string;
	toolCallId: string;
	finding: FindingBasis;
	observationIds: string[];
	expectedEffect: string;
	reconsiderWhen: string;
	exposed: boolean;
};

export function observationCompactionMarker(
	observationId: string,
	findingId: string,
	version: number,
): string {
	return `[Task-local observation ${observationId} compacted by ${findingId}@v${version}; ` +
		"the complete result remains in execution-observations.jsonl and is recoverable by exact ID.]";
}

export function installAgentOwnedObservationCompaction(
	pi: ExtensionAPI,
	dependencies: CompactionDependencies,
): { enabled: boolean; toolName: string; capability?: Record<string, unknown> } {
	const { enabled, getFinding, getObservation, allocateDecisionId, append, pendingAssessments } = dependencies;
	if (!enabled) return { enabled: false, toolName: OBSERVATION_COMPACTION_TOOL };

	let applied: AppliedCompaction | undefined;
	const capability = {
		id: "agent_owned_observation_compaction",
		kind: "pi_native_execution_condition",
		tool: OBSERVATION_COMPACTION_TOOL,
		changes: "replace only Agent-selected, finding-cited historical tool-result bodies with exact canonical references",
		enabled_by: "an explicit Agent tool call naming an active finding version and its cited observation IDs",
		effective_at: "next_model_request",
		scope: "current Shopping task",
		canonical_data: "execution-observations.jsonl remains complete",
	};

	pi.registerTool({
		name: OBSERVATION_COMPACTION_TOOL,
		label: "Compact Selected Observation Context",
		description: "Optional Pi-native context representation change. After an active finding preserves the conclusion of cited Shopping observations, explicitly select 1-8 of those exact observation IDs. On later model requests only their historical result bodies become canonical references; full task-local JSONL remains unchanged. No change is valid.",
		parameters: Type.Object({
			finding_id: Type.String(),
			target_version: Type.Integer({ minimum: 1 }),
			observation_ids: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
			expected_effect: Type.String(),
			reconsider_when: Type.String(),
		}),
		async execute(toolCallId, params) {
			if (applied) throw new Error("one observation-context decision is already active in this task");
			const p = params as {
				finding_id: string; target_version: number; observation_ids: string[];
				expected_effect: string; reconsider_when: string;
			};
			const finding = getFinding(p.finding_id);
			if (!finding || finding.status !== "active") throw new Error("compaction requires an active finding");
			if (finding.version !== p.target_version) throw new Error("target_version must match the current finding version");
			const observationIds = [...new Set(p.observation_ids)];
			if (observationIds.length !== p.observation_ids.length) throw new Error("observation_ids must be unique");
			for (const observationId of observationIds) {
				if (!finding.evidence_refs.includes(observationId)) throw new Error(`finding does not cite observation: ${observationId}`);
				if (!getObservation(observationId)) throw new Error(`unknown execution observation: ${observationId}`);
			}
			const decisionId = allocateDecisionId();
			const decision = {
				decision_id: decisionId,
				decision_path: OBSERVATION_COMPACTION_TOOL,
				choice: "apply",
				applied: true,
				intervention: "observation_context_representation",
				basis_resource_ids: [finding.finding_id],
				basis_snapshots: [{
					finding_id: finding.finding_id, goal_id: finding.goal_id, version: finding.version,
					research_event_id: finding.research_event_id, evidence_refs: [...finding.evidence_refs],
					assessment_refs: [...finding.assessment_refs],
				}],
				previous: "full",
				value: "exact_observation_reference",
				operation: { capability: "pi.context", observation_ids: observationIds },
				effect_metric: "model_visible_observation_chars_removed",
				expected_effect: p.expected_effect,
				reconsider_when: p.reconsider_when,
				toolCallId,
				recordedAt: new Date().toISOString(),
			};
			append("harness-decisions.jsonl", decision);
			applied = {
				decisionId, toolCallId, finding, observationIds,
				expectedEffect: p.expected_effect, reconsiderWhen: p.reconsider_when, exposed: false,
			};
			return { content: [{ type: "text", text: JSON.stringify(decision) }], details: decision };
		},
	});

	pi.on("context", async (event) => {
		if (!applied) return {};
		const selected = new Set(applied.observationIds);
		const matched = new Set<string>();
		let originalChars = 0;
		let replacementChars = 0;
		const messages = event.messages.map((message) => {
			const value = message as any;
			const observationId = value?.role === "toolResult"
				? value?.details?.observation?.event_id
				: undefined;
			if (typeof observationId !== "string" || !selected.has(observationId)) return message;
			const marker = observationCompactionMarker(observationId, applied!.finding.finding_id, applied!.finding.version);
			matched.add(observationId);
			originalChars += Array.isArray(value.content)
				? value.content.reduce((total: number, item: any) => total + (item?.type === "text" && typeof item.text === "string" ? item.text.length : 0), 0)
				: 0;
			replacementChars += marker.length;
			return { ...value, content: [{ type: "text", text: marker }] };
		});
		if (!applied.exposed) {
			applied.exposed = true;
			const allMatched = applied.observationIds.every((id) => matched.has(id));
			const removedChars = Math.max(0, originalChars - replacementChars);
			const exposure = {
				observation_id: `shopping-harness-observation-${applied.decisionId.replace(/^decision-/, "")}`,
				decision_id: applied.decisionId, toolCallId: applied.toolCallId,
				basis_resource_ids: [applied.finding.finding_id],
				operation: { capability: "pi.context", value: "exact_observation_reference", observation_ids: applied.observationIds },
				effect_observed: allMatched && removedChars > 0,
				recordedAt: new Date().toISOString(),
			};
			append("harness-observations.jsonl", exposure);
			const assessmentId = `effect-assessment-${applied.decisionId.replace(/^decision-/, "")}`;
			const assessment = {
				effect_assessment_id: assessmentId,
				decision_id: applied.decisionId,
				toolCallId: applied.toolCallId,
				basis_resource_ids: [applied.finding.finding_id],
				effect_metric: "model_visible_observation_chars_removed",
				expected_effect: applied.expectedEffect,
				exposure_observed: exposure.effect_observed,
				window: {
					observation_ids: applied.observationIds, matched_observation_ids: [...matched],
					original_chars: originalChars, replacement_chars: replacementChars,
					removed_chars: removedChars, boundary: "next_model_request",
				},
				verdict: allMatched && removedChars > 0 ? "supported" : "contradicted",
				improvement: "not_established",
				attribution: {
					kind: "bounded_native_context_exposure", intervention: "observation_context_representation",
					decision_id: applied.decisionId, confounders_controlled: false, scope: "current Shopping task",
				},
				reconsider_when: applied.reconsiderWhen,
				recordedAt: new Date().toISOString(),
			};
			append("effect-assessments.jsonl", assessment);
			pendingAssessments.set(assessmentId, assessment);
		}
		return { messages };
	});

	return { enabled: true, toolName: OBSERVATION_COMPACTION_TOOL, capability };
}
