/** Incremental, causal-neutral pattern candidates derived from task execution signals. */

import { createHash } from "node:crypto";
import type { ExecutionSignal } from "./pi_task_execution_signals.ts";

export type PatternCandidate = {
	candidate_id: string;
	candidate_key: string;
	version: number;
	kind: "repeated_error" | "repeated_success" | "outcome_contrast" | "structured_outcome_contrast"
		| "repeated_structured_outcome" | "research_revision_churn" | "repeated_action_cycle";
	status: "candidate";
	tool_name: string;
	signal_label?: string;
	claim: string;
	support_refs: string[];
	counterexample_refs: string[];
	support_count: number;
	counterexample_count: number;
	classification_basis: "derived_from_execution_signals" | "derived_from_research_resources";
	agent_accepted: false;
	observed_outcomes?: string[];
	related_finding_id?: string;
	revision_count?: number;
	sequence_length?: number;
	recordedAt: string;
};

type Observation = { observation_id: string; tool_name?: string; input?: unknown };

type CandidateDraft = Omit<PatternCandidate, "candidate_id" | "version" | "recordedAt">;

function isPowerOfTwo(value: number): boolean {
	return value > 0 && (value & (value - 1)) === 0;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function shouldCheckpoint(previous: PatternCandidate | undefined, draft: CandidateDraft): boolean {
	if (!previous) return true;
	if (previous.counterexample_count === 0 && draft.counterexample_count > 0) return true;
	if (JSON.stringify(previous.observed_outcomes ?? []) !== JSON.stringify(draft.observed_outcomes ?? [])) return true;
	const previousTotal = previous.support_count + previous.counterexample_count;
	const nextTotal = draft.support_count + draft.counterexample_count;
	return nextTotal > previousTotal && isPowerOfTwo(nextTotal);
}

export function derivePatternCandidateUpdates(options: {
	observations: Map<string, Observation>;
	signalsByObservation: Map<string, ExecutionSignal>;
	candidatesByKey: Map<string, PatternCandidate>;
	toolName: string;
	allocateCandidateId: () => string;
	recordedAt: string;
}): PatternCandidate[] {
	const { observations, signalsByObservation, candidatesByKey, toolName, allocateCandidateId, recordedAt } = options;
	const toolSignals = [...signalsByObservation.values()].filter((signal) =>
		observations.get(signal.observation_id)?.tool_name === toolName,
	);
	const successes = toolSignals.filter((signal) => signal.outcome === "success").map((signal) => signal.observation_id);
	const errors = toolSignals.filter((signal) => signal.outcome === "error");
	const errorLabels = [...new Set(errors.flatMap((signal) => signal.labels))].sort();
	const drafts: CandidateDraft[] = [];

	for (const label of errorLabels) {
		const support = errors.filter((signal) => signal.labels.includes(label)).map((signal) => signal.observation_id);
		if (support.length < 2) continue;
		drafts.push({
			candidate_key: `${toolName}:${label}`,
			kind: "repeated_error",
			status: "candidate",
			tool_name: toolName,
			signal_label: label,
			claim: "The same reported error recurred; its cause and transfer conditions remain unknown.",
			support_refs: support,
			counterexample_refs: successes,
			support_count: support.length,
			counterexample_count: successes.length,
			classification_basis: "derived_from_execution_signals",
			agent_accepted: false,
		});
	}

	if (successes.length && errors.length) {
		const allRefs = toolSignals.map((signal) => signal.observation_id);
		drafts.push({
			candidate_key: `${toolName}:outcome_contrast`,
			kind: "outcome_contrast",
			status: "candidate",
			tool_name: toolName,
			claim: "The same tool has both successful and error outcomes; a differing condition may be decision-relevant.",
			support_refs: allRefs,
			counterexample_refs: [],
			support_count: allRefs.length,
			counterexample_count: 0,
			classification_basis: "derived_from_execution_signals",
			agent_accepted: false,
		});
	}

	const structuredSignals = [...signalsByObservation.values()].filter((signal) =>
		signal.layer !== "tool_execution" && signal.pattern_key
		&& observations.get(signal.observation_id)?.tool_name === toolName,
	);
	const structuredGroups = new Map<string, ExecutionSignal[]>();
	for (const signal of structuredSignals) {
		const key = `${signal.layer}:${signal.pattern_key}`;
		structuredGroups.set(key, [...(structuredGroups.get(key) ?? []), signal]);
	}
	for (const [key, grouped] of structuredGroups) {
		const outcomes = [...new Set(grouped.map((signal) => signal.outcome))].sort();
		if (grouped[0]?.layer === "task_progress") {
			for (const outcome of outcomes) {
				const matching = grouped.filter((signal) => signal.outcome === outcome);
				if (matching.length < 2) continue;
				drafts.push({
					candidate_key: `${key}:${outcome}:repeated`,
					kind: "repeated_structured_outcome",
					status: "candidate",
					tool_name: toolName,
					claim: "The same adapter-declared public task-progress outcome recurred; its cause and transfer conditions remain unknown.",
					support_refs: matching.map((signal) => signal.observation_id),
					counterexample_refs: grouped
						.filter((signal) => signal.outcome !== outcome)
						.map((signal) => signal.observation_id)
						,
					support_count: matching.length,
					counterexample_count: grouped.length - matching.length,
					classification_basis: "derived_from_execution_signals",
					agent_accepted: false,
					observed_outcomes: [outcome],
				});
			}
		}
		if (outcomes.length < 2) continue;
		const refs = [...new Set(grouped.map((signal) => signal.observation_id))];
		drafts.push({
			candidate_key: `${key}:outcome_contrast`,
			kind: "structured_outcome_contrast",
			status: "candidate",
			tool_name: toolName,
			claim: "The same adapter-declared local pattern has contrasting public outcomes; inspect conditions before generalizing.",
			support_refs: refs,
			counterexample_refs: [],
			support_count: refs.length,
			counterexample_count: 0,
			classification_basis: "derived_from_execution_signals",
			agent_accepted: false,
			observed_outcomes: outcomes,
		});
	}

	const progressByObservation = new Map(
		toolSignals
			.filter((signal) => signal.layer === "task_progress")
			.map((signal) => [signal.observation_id, signal] as const),
	);
	const cycleEligible = [...observations.values()]
		.filter((observation) => observation.tool_name === toolName)
		.flatMap((observation) => {
			const progress = progressByObservation.get(observation.observation_id);
			if (!progress || ["advanced", "completed"].includes(progress.outcome)) return [];
			return [{
				observation_id: observation.observation_id,
				signature: stableJson(observation.input ?? null),
				outcome: progress.outcome,
			}];
		});
	for (let sequenceLength = 2; sequenceLength <= 4; sequenceLength += 1) {
		if (cycleEligible.length < sequenceLength * 3) continue;
		const finalSequence = cycleEligible.slice(-sequenceLength).map((item) => item.signature);
		if (new Set(finalSequence).size < 2) continue;
		let repetitions = 0;
		for (let end = cycleEligible.length; end >= sequenceLength; end -= sequenceLength) {
			const candidateSequence = cycleEligible.slice(end - sequenceLength, end).map((item) => item.signature);
			if (candidateSequence.some((signature, index) => signature !== finalSequence[index])) break;
			repetitions += 1;
		}
		if (repetitions < 3) continue;
		const supporting = cycleEligible.slice(-(repetitions * sequenceLength));
		const sequenceHash = createHash("sha256").update(finalSequence.join("\n")).digest("hex").slice(0, 12);
		drafts.push({
			candidate_key: `${toolName}:action-cycle:${sequenceLength}:${sequenceHash}`,
			kind: "repeated_action_cycle",
			status: "candidate",
			tool_name: toolName,
			claim: "The same multi-step tool-input sequence repeated without reported task progress; inspect whether it is productive, blocked, or missing a discriminating observation.",
			support_refs: supporting.map((item) => item.observation_id),
			counterexample_refs: [],
			support_count: repetitions,
			counterexample_count: 0,
			classification_basis: "derived_from_execution_signals",
			agent_accepted: false,
			observed_outcomes: [...new Set(supporting.map((item) => item.outcome))].sort(),
			sequence_length: sequenceLength,
		});
		break;
	}

	const updates: PatternCandidate[] = [];
	for (const draft of drafts) {
		const previous = candidatesByKey.get(draft.candidate_key);
		if (!shouldCheckpoint(previous, draft)) continue;
		const candidate: PatternCandidate = {
			...draft,
			candidate_id: previous?.candidate_id ?? allocateCandidateId(),
			version: (previous?.version ?? 0) + 1,
			recordedAt,
		};
		candidatesByKey.set(candidate.candidate_key, candidate);
		updates.push(candidate);
	}
	return updates;
}

export function deriveResearchRevisionCandidateUpdates(options: {
	finding: { finding_id: string; version: number; evidence_refs: string[] };
	candidatesByKey: Map<string, PatternCandidate>;
	allocateCandidateId: () => string;
	recordedAt: string;
}): PatternCandidate[] {
	const { finding, candidatesByKey, allocateCandidateId, recordedAt } = options;
	if (finding.version < 3) return [];
	const candidateKey = `research-resource:${finding.finding_id}:revision-churn`;
	const draft: CandidateDraft = {
		candidate_key: candidateKey,
		kind: "research_revision_churn",
		status: "candidate",
		tool_name: "research_resource",
		claim: "The same research resource has been revised repeatedly; its evidence-reading or validation method may deserve inspection.",
		support_refs: [...new Set(finding.evidence_refs)],
		counterexample_refs: [],
		support_count: finding.version,
		counterexample_count: 0,
		classification_basis: "derived_from_research_resources",
		agent_accepted: false,
		related_finding_id: finding.finding_id,
		revision_count: finding.version,
	};
	const previous = candidatesByKey.get(candidateKey);
	if (!shouldCheckpoint(previous, draft)) return [];
	const candidate: PatternCandidate = {
		...draft,
		candidate_id: previous?.candidate_id ?? allocateCandidateId(),
		version: (previous?.version ?? 0) + 1,
		recordedAt,
	};
	candidatesByKey.set(candidateKey, candidate);
	return [candidate];
}

export function patternCandidateDigest(
	candidates: Iterable<PatternCandidate>,
	acceptedCandidateIds: Set<string>,
): Array<Record<string, unknown>> {
	return [...candidates]
		.filter((candidate) => !acceptedCandidateIds.has(candidate.candidate_id))
		.sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)))
		.reverse()
		.map((candidate) => ({
			candidate_id: candidate.candidate_id,
			version: candidate.version,
			kind: candidate.kind,
			tool_name: candidate.tool_name,
			claim: candidate.claim,
			support_count: candidate.support_count,
			counterexample_count: candidate.counterexample_count,
			support_refs: candidate.support_refs,
			counterexample_refs: candidate.counterexample_refs,
			...(candidate.observed_outcomes ? { observed_outcomes: candidate.observed_outcomes } : {}),
			...(candidate.related_finding_id ? { related_finding_id: candidate.related_finding_id } : {}),
			...(candidate.revision_count ? { revision_count: candidate.revision_count } : {}),
			...(candidate.sequence_length ? { sequence_length: candidate.sequence_length } : {}),
		}));
}
