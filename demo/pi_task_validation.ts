/** Agent-authored validation, separate from immutable observations and creation. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { resolveTaskResource, resourceMetadata, taskRecords, versionConflict } from "./pi_task_resource_store.ts";

export function installTaskValidation(pi: ExtensionAPI, root: string) {
	const scope = ensureTaskScope(root);
	const latest = new Map<string, Record<string, any>>();
	for (const record of taskRecords(root, "validation")) latest.set(record.validation_id, record);
	let counter = latest.size;
	const save = (record: Record<string, any>) => {
		latest.set(record.validation_id, record);
		appendFileSync(join(root, "task-validations.jsonl"), JSON.stringify(stampTaskRecord(scope, record)) + "\n");
		return record;
	};
	pi.registerTool({
		name: "task_validation", label: "Task-local validation ledger",
		description: "Open, assess, dispute, or inspect a task/research/harness hypothesis. Predictions, alternatives and verdicts are agent-authored, not environment facts. Assessments retain reasoning basis, exact evidence versions, dependency versions, and revision links. This ledger is optional and never gates resource creation or actions.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("open"), Type.Literal("assess"), Type.Literal("dispute"), Type.Literal("inspect")]),
			validation_id: Type.Optional(Type.String()), target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			hypothesis: Type.Optional(Type.String()),
			prediction: Type.Optional(Type.String()),
			alternatives: Type.Optional(Type.Array(Type.String())),
			subject_refs: Type.Optional(Type.Array(Type.String())),
			evidence_refs: Type.Optional(Type.Array(Type.String())),
			verdict: Type.Optional(Type.Union([Type.Literal("supported"), Type.Literal("unsupported"), Type.Literal("inconclusive")])),
			explanation: Type.Optional(Type.String()),
			reasoning_basis: Type.Optional(Type.String()),
			dependency_refs: Type.Optional(Type.Array(Type.String())),
			dispute: Type.Optional(Type.String()),
			competing_explanation: Type.Optional(Type.String()),
			supersedes_validation_id: Type.Optional(Type.String()),
		}),
		async execute(_id, p) {
			if (p.action === "inspect") {
				const records = p.validation_id ? [latest.get(p.validation_id)].filter(Boolean) : [...latest.values()];
				return { content: [{ type: "text", text: JSON.stringify({ total: latest.size, records }) }], details: { records } };
			}
			let record: Record<string, any>;
			if (p.action === "open") {
				if (!p.hypothesis?.trim() || !p.prediction?.trim()) throw new Error("open requires hypothesis and prediction");
				for (const ref of p.subject_refs ?? []) resolveTaskResource(root, ref);
				for (const ref of p.dependency_refs ?? []) resolveTaskResource(root, String(ref));
				record = { validation_id: `validation-${++counter}`, version: 1, status: "open",
					hypothesis: p.hypothesis, prediction: p.prediction, alternatives: p.alternatives ?? [],
					subject_refs: p.subject_refs ?? [], dependency_refs: p.dependency_refs ?? [], origin: "agent",
					reasoning_basis: p.reasoning_basis ?? null, recordedAt: new Date().toISOString() };
			} else {
				const previous = latest.get(String(p.validation_id));
				if (!previous) throw new Error("unknown validation_id");
				if (p.target_version !== previous.version) return versionConflict("validation", previous, p.target_version);
				if (p.action === "dispute") {
					if (!p.dispute?.trim() || !p.competing_explanation?.trim()) throw new Error("dispute requires dispute and competing_explanation");
					for (const ref of p.evidence_refs ?? []) resolveTaskResource(root, String(ref));
					const dispute = { dispute_id: `dispute-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
						statement: p.dispute, competing_explanation: p.competing_explanation,
						evidence_refs: p.evidence_refs ?? [], reasoning_basis: p.reasoning_basis ?? p.explanation ?? "",
						status: "open", recordedAt: new Date().toISOString() };
					record = { ...previous, version: previous.version + 1, status: "disputed",
						disputes: [...(Array.isArray(previous.disputes) ? previous.disputes : []), dispute],
						revision_of: `${previous.validation_id}@v${previous.version}`, recordedAt: dispute.recordedAt };
				} else {
					if (!p.verdict || !p.explanation?.trim() || !p.evidence_refs?.length) throw new Error("assess requires verdict, explanation and exact evidence_refs");
				const evidence = p.evidence_refs.map((ref) => {
					if (!/^(observation|delegation|failure):/.test(ref)) throw new Error("assessment evidence must reference observations, failure records or delegation results, not the claim itself");
					const value = resolveTaskResource(root, ref);
					if (p.verdict === "supported" && (value.is_error || value.status === "failed")) throw new Error("failed execution alone cannot support successful validation; it can support an unsupported/inconclusive assessment");
					return { ref, source: ref.startsWith("delegation:") ? "agent_report_not_independent_truth" : "recorded_observation" };
				});
				const dependencyRefs = Array.isArray(p.dependency_refs) ? p.dependency_refs.map(String) : (previous.dependency_refs ?? []);
				const dependencyStatus = dependencyRefs.map((ref: string) => {
					const match = ref.match(/^([a-z_]+):([^@]+)@v(\d+)$/);
					if (!match) throw new Error(`dependency_refs must be exact version refs: ${ref}`);
					const versions = taskRecords(root, match[1]).filter((item) => resourceMetadata(match[1], item).resource_ref.startsWith(`${match[1]}:${match[2]}@v`));
					const current = versions.sort((a, b) => Number(b.version ?? 1) - Number(a.version ?? 1))[0];
					return { ref, current_ref: current ? `${match[1]}:${match[2]}@v${Number(current.version ?? 1)}` : null,
						status: current && Number(current.version ?? 1) > Number(match[3]) ? "changed" : "unchanged" };
				});
				record = { ...previous, version: previous.version + 1, status: "assessed", verdict: p.verdict,
					explanation: p.explanation, reasoning_basis: p.reasoning_basis ?? p.explanation,
					evidence_refs: p.evidence_refs, evidence, dependency_refs: dependencyRefs, dependency_status: dependencyStatus,
					revision_of: `${previous.validation_id}@v${previous.version}`,
					independently_verified: false, recordedAt: new Date().toISOString() };
				}
			}
			save(record);
			return { content: [{ type: "text", text: JSON.stringify(record) }], details: record };
		},
	});
	pi.on("context", (event) => {
		const open = [...latest.values()].filter((r) => r.status === "open");
		if (!open.length) return {};
		return { messages: [...event.messages, { role: "user", timestamp: Date.now(), content: [{ type: "text",
			text: `Task-local validation index: ${JSON.stringify({ unresolved: open.length,
				recent: open.map((r) => resourceMetadata("validation", r)),
				note: "Open is not validated. Assessments and alternative explanations are agent judgments; exact evidence remains readable." })}` }]}] };
	});
	return {
		observeDecision(observationId: string, decision: Record<string, any>) {
			if (!decision.hypothesis || !decision.prediction) return;
			const sourceId = String(decision.hypothesis_id ?? observationId);
			const hypothesisVersion = Math.max(1, Number(decision.hypothesis_version ?? 1));
			const existing = [...latest.values()].find((r) =>
				r.source_hypothesis_id === sourceId && r.status === "open");
			// A stable hypothesis id owns one open validation. Repeated action
			// capsules continue that test even when their prose is refined. Only an
			// explicit hypothesis-version increase starts a distinct validation.
			if (existing && Number(existing.source_hypothesis_version ?? 1) === hypothesisVersion) return;
			if (existing) save({ ...existing, version: Number(existing.version) + 1,
				status: "superseded", superseded_by_hypothesis_version: hypothesisVersion,
				recordedAt: new Date().toISOString() });
			save({ validation_id: `validation-${++counter}`, version: 1, status: "open", origin: "action_decision",
				source_hypothesis_id: sourceId, source_hypothesis_version: hypothesisVersion,
				hypothesis: String(decision.hypothesis),
				prediction: String(decision.prediction), falsifier: decision.falsifier,
				observation_ref: `observation:${observationId}@v1`, recordedAt: new Date().toISOString() });
		},
	};
}
