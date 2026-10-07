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
	scope?: string;
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
	providerObserved: boolean;
	contextEffect?: {
		matchedObservationIds: string[];
		originalChars: number;
		replacementChars: number;
		removedChars: number;
	};
};

function payloadContains(value: unknown, needle: string, seen = new Set<object>()): boolean {
	if (typeof value === "string") return value.includes(needle);
	if (!value || typeof value !== "object" || seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value)) return value.some((item) => payloadContains(item, needle, seen));
	return Object.values(value as Record<string, unknown>)
		.some((item) => payloadContains(item, needle, seen));
}

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
	const scope = dependencies.scope ?? "current Shopping task";
	if (!enabled) return { enabled: false, toolName: OBSERVATION_COMPACTION_TOOL };

	const applied: AppliedCompaction[] = [];
	const capability = {
		id: "agent_owned_observation_compaction",
		kind: "pi_native_execution_condition",
		tool: OBSERVATION_COMPACTION_TOOL,
		changes: "replace only Agent-selected, finding-cited historical tool-result bodies with exact canonical references; later decisions may add or revise the selected set",
		enabled_by: "an explicit Agent tool call naming an active finding version and its cited observation IDs",
		effective_at: "next_model_request",
		scope,
		canonical_data: "execution-observations.jsonl remains complete",
	};

	pi.registerTool({
		name: OBSERVATION_COMPACTION_TOOL,
		label: "Compact Selected Observation Context",
		description: "Optional Pi-native context representation change. After an active finding preserves the conclusion of cited task observations, explicitly select any non-empty set of those exact observation IDs. On later model requests only their historical result bodies become canonical references; full task-local JSONL remains unchanged. No change is valid.",
		parameters: Type.Object({
			finding_id: Type.String(),
			target_version: Type.Integer({ minimum: 1 }),
			observation_ids: Type.Array(Type.String(), { minItems: 1 }),
			expected_effect: Type.String(),
			reconsider_when: Type.String(),
		}),
		async execute(toolCallId, params) {
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
			applied.push({
				decisionId, toolCallId, finding, observationIds,
				expectedEffect: p.expected_effect, reconsiderWhen: p.reconsider_when,
				exposed: false, providerObserved: false,
			});
			return { content: [{ type: "text", text: JSON.stringify(decision) }], details: decision };
		},
	});

	pi.on("context", async (event) => {
		if (!applied.length) return {};
		// When a later decision cites an already compacted observation, its
		// marker supersedes the old marker while the old decision keeps its
		// already-recorded exposure. This makes revisions auditable without
		// duplicating the historical result in the provider payload.
		const selectedByObservation = new Map<string, AppliedCompaction>();
		for (const item of applied) {
			for (const observationId of item.observationIds) selectedByObservation.set(observationId, item);
		}
		const matchedByDecision = new Map<AppliedCompaction, Set<string>>();
		const sizesByDecision = new Map<AppliedCompaction, { originalChars: number; replacementChars: number }>();
		const messages = event.messages.map((message) => {
			const value = message as any;
			const observationId = value?.role === "toolResult"
				? value?.details?.observation?.event_id ?? value?.details?.observation?.observation_id
				: undefined;
			const item = typeof observationId === "string" ? selectedByObservation.get(observationId) : undefined;
			if (!item) return message;
			const marker = observationCompactionMarker(observationId, item.finding.finding_id, item.finding.version);
			const matched = matchedByDecision.get(item) ?? new Set<string>();
			matched.add(observationId);
			matchedByDecision.set(item, matched);
			const sizes = sizesByDecision.get(item) ?? { originalChars: 0, replacementChars: 0 };
			sizes.originalChars += Array.isArray(value.content)
				? value.content.reduce((total: number, item: any) => total + (item?.type === "text" && typeof item.text === "string" ? item.text.length : 0), 0)
				: 0;
			sizes.replacementChars += marker.length;
			sizesByDecision.set(item, sizes);
			return { ...value, content: [{ type: "text", text: marker }] };
		});
		for (const item of applied.filter((candidate) => !candidate.exposed)) {
			item.exposed = true;
			const matched = matchedByDecision.get(item) ?? new Set<string>();
			const sizes = sizesByDecision.get(item) ?? { originalChars: 0, replacementChars: 0 };
			const removedChars = Math.max(0, sizes.originalChars - sizes.replacementChars);
			item.contextEffect = {
				matchedObservationIds: item.observationIds.filter((id) => matched.has(id)),
				originalChars: sizes.originalChars,
				replacementChars: sizes.replacementChars,
				removedChars,
			};
			const allMatched = item.observationIds.every((id) => matched.has(id));
			const exposure = {
				observation_id: `task-harness-observation-${item.decisionId.replace(/^decision-/, "")}`,
				observation_kind: "pi_context_projection",
				decision_id: item.decisionId, toolCallId: item.toolCallId,
				basis_resource_ids: [item.finding.finding_id],
				operation: { capability: "pi.context", value: "exact_observation_reference", observation_ids: item.observationIds },
				effect_observed: allMatched && removedChars > 0,
				recordedAt: new Date().toISOString(),
			};
			append("harness-observations.jsonl", exposure);
			const assessmentId = `effect-assessment-${item.decisionId.replace(/^decision-/, "")}`;
			const assessment = {
				effect_assessment_id: assessmentId,
				decision_id: item.decisionId,
				toolCallId: item.toolCallId,
				basis_resource_ids: [item.finding.finding_id],
				effect_metric: "model_visible_observation_chars_removed",
				expected_effect: item.expectedEffect,
				exposure_observed: exposure.effect_observed,
				window: {
					observation_ids: item.observationIds, matched_observation_ids: [...matched],
					original_chars: sizes.originalChars, replacement_chars: sizes.replacementChars,
					removed_chars: removedChars, boundary: "next_model_request",
				},
				verdict: allMatched && removedChars > 0 ? "supported" : "contradicted",
				improvement: "not_established",
				attribution: {
					kind: "bounded_native_context_exposure", intervention: "observation_context_representation",
					decision_id: item.decisionId, confounders_controlled: false, scope,
				},
				reconsider_when: item.reconsiderWhen,
				recordedAt: new Date().toISOString(),
			};
			append("effect-assessments.jsonl", assessment);
			pendingAssessments.set(assessmentId, assessment);
		}
		return { messages };
	});

	pi.on("before_provider_request", async (event) => {
		for (const item of applied) {
			if (!item.exposed || item.providerObserved || !item.contextEffect) continue;
			item.providerObserved = true;
			const providerMarkerIds = item.observationIds.filter((observationId) => payloadContains(
				event.payload,
				observationCompactionMarker(observationId, item.finding.finding_id, item.finding.version),
			));
			const fullBodyIds = item.observationIds.filter((observationId) => {
				const observation = getObservation(observationId);
				const result = observation?.result_text ?? observation?.result;
				return typeof result === "string" && result.length > 0 && payloadContains(event.payload, result);
			});
			const providerPayloadObserved = (
				providerMarkerIds.length === item.observationIds.length && fullBodyIds.length === 0
			);
			const providerObservation = {
				observation_id: `task-harness-provider-observation-${item.decisionId.replace(/^decision-/, "")}`,
				observation_kind: "final_provider_payload",
				decision_id: item.decisionId, toolCallId: item.toolCallId,
				basis_resource_ids: [item.finding.finding_id],
				operation: {
					capability: "pi.context", value: "exact_observation_reference",
					observation_ids: item.observationIds,
				},
				effect_observed: providerPayloadObserved,
				provider_payload_observed: providerPayloadObserved,
				provider_payload_marker_ids: providerMarkerIds,
				provider_payload_full_body_ids: fullBodyIds,
				recordedAt: new Date().toISOString(),
			};
			append("harness-observations.jsonl", providerObservation);
		}
	});

	return { enabled: true, toolName: OBSERVATION_COMPACTION_TOOL, capability };
}
