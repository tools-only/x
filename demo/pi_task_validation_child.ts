/** Extra read-only task resource access for an isolated Pi child. */
import { appendFileSync, existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertHarnessProposalEvidenceLinks, assertResearchAssessmentReferences, assertResearchConfidenceUpdate, normalizeAutoResearchReport } from "./pi_auto_research_output.ts";
import { ResearchMethodCandidateSchema } from "./pi_auto_research_harness_schema.ts";
import { installTaskResourceReader } from "./pi_task_resource_store.ts";
import { installTaskLocalContextLifecycle } from "./pi_task_local_context_lifecycle.ts";
import { installChildContextControl } from "./pi_child_context_control.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";
import { loadPrompt } from "./prompt_loader.ts";
import { createHash } from "node:crypto";
import { loadResearchProfile } from "./pi_auto_research_profiles.ts";
import { canonicalEvidenceSnapshot } from "./pi_auto_research_evidence.ts";
import { appendWorkerRecord, workerOwnUpdates } from "./pi_auto_research_workers.ts";

export default function taskValidationChild(pi: ExtensionAPI) {
	if (process.env.PI_TASK_CHILD !== "1") throw new Error("this extension is only for isolated task children");
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	installReportedTokenBudget(pi, root);
	const refs = JSON.parse(process.env.PI_TASK_CHILD_RESOURCE_REFS ?? "[]");
	if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string")) throw new Error("invalid child resource grants");
	installTaskResourceReader(pi, root, refs);
	let pauseReadBatch: ((details: Record<string, any>) => void) | undefined;
	installChildContextControl(pi, root, { onReadBatchPause: details => pauseReadBatch?.(details) });
	installTaskLocalContextLifecycle(pi, {
		root,
		keepRecentMessages: 12,
		compactCompletedToolReasoning: true,
	});
	if (process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL !== "1") {
		pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${loadPrompt("task_validation_child.md")}` }));
	}
	if (process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1") {
		const runId = String(process.env.PI_AUTO_RESEARCH_RUN_ID ?? "");
		if (!/^auto-research-[1-9]\d*$/.test(runId)) throw new Error("invalid Auto-Research run id");
		const sessionId = String(process.env.PI_AUTO_RESEARCH_SESSION_ID ?? runId);
		const worker = process.env.PI_AUTO_RESEARCH_WORKER ? JSON.parse(process.env.PI_AUTO_RESEARCH_WORKER) : undefined;
		const consumedEvidence = new Set<string>();
		const consumeEvidence = (supplied: unknown) => {
			const selected = Array.isArray(supplied) ? supplied.map(String) : [];
			if (!worker && selected.length) throw new Error("consumption receipts require an assigned worker");
			if (selected.some(ref => !worker.offered_refs.includes(ref))) throw new Error("consumption exceeds this worker's immutable evidence cutoff");
			for (const ref of selected) consumedEvidence.add(ref);
		};
		const interactionMode = process.env.PI_AUTO_RESEARCH_INTERACTION_MODE === "non_blocking"
			? "non_blocking" : "blocking";
		const profile = loadResearchProfile(process.env.PI_AUTO_RESEARCH_SCOPE ?? "unspecified");
		const commonInstructions = loadPrompt("auto_research_child_contract.md");
		const controlPath = join(root, "auto-research-child-control.jsonl");
		// Evidence volume is not governed by a runtime count. The child model owns
		// the stopping decision: it may read more pages, change representation, or
		// submit an explicitly provisional/inconclusive report at any point.
		const requiredEvidenceRefs = new Set(
				// Canonical environment observations are supplied through the adapter
				// read-only surface (for ARC, arc_state/trajectory).  Only explicitly
				// inherited task resources require paged task_resource coverage here;
				// otherwise a large observation envelope can keep a bounded question
				// from ever reaching its report boundary.
				refs.filter((ref): ref is string => typeof ref === "string" && /@v[1-9]\d*$/.test(ref)
					&& /^(memory|skill|tool|subagent|finding|context):/.test(ref)
					// The child role definition is an execution envelope, not selected
					// evidence for the question and must not make an otherwise empty
					// evidence audit appear partial.
					&& !/^subagent:(auto-research|ephemeral-auto-research)@v\d+$/.test(ref)),
		);
		let evidenceReadCount = 0;
		let reportSubmitted = false;
		let reviewCheckpointCount = 0;
		const readSignatures = new Set<string>();
		const pendingReadSignatures = new Map<string, string>();
		const pageCoverage = new Map<string, { total: number; ranges: Array<[number, number]>; reads: number }>();
		const readCounts = new Map<string, number>();
		const readDetails = (event: any): Record<string, any> | undefined => {
			const result = event?.result;
			if (result?.details && typeof result.details === "object" && !Array.isArray(result.details)) return result.details;
			const text = result?.content?.find((item: any) => item?.type === "text")?.text;
			if (typeof text !== "string") return undefined;
			try {
				const value = JSON.parse(text);
				return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
			} catch { return undefined; }
		};
		const addCoverage = (details: Record<string, any> | undefined) => {
			if (!details || typeof details.ref !== "string" || typeof details.total_chars !== "number") return;
			const ref = details.ref;
			const offset = Math.max(0, Number(details.offset ?? 0));
			const end = Math.max(offset, Math.min(Number(details.total_chars), Number(details.page_end ?? offset) || offset));
			const previous = pageCoverage.get(ref) ?? { total: Number(details.total_chars), ranges: [], reads: 0 };
			previous.total = Number(details.total_chars);
			previous.reads += 1;
			if (end > offset) previous.ranges.push([offset, end]);
			previous.ranges.sort((a, b) => a[0] - b[0]);
			const merged: Array<[number, number]> = [];
			for (const range of previous.ranges) {
				const last = merged.at(-1);
				if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
				else merged.push([...range]);
			}
			previous.ranges = merged;
			pageCoverage.set(ref, previous);
		};
		const completeRefs = () => [...requiredEvidenceRefs].filter((ref) => {
			const coverage = pageCoverage.get(ref);
			return Boolean(coverage && coverage.ranges.length === 1 && coverage.ranges[0][0] === 0 && coverage.ranges[0][1] >= coverage.total);
		});
		const evidenceAudit = () => {
			const complete = new Set(completeRefs());
			const incomplete = [...requiredEvidenceRefs].filter((ref) => !complete.has(ref));
			return {
				format: "research-evidence-audit-v1",
				status: requiredEvidenceRefs.size === 0 ? "no_selected_refs" : incomplete.length ? "partial" : "complete",
				required_refs: [...requiredEvidenceRefs],
				complete_refs: [...complete],
				incomplete_refs: incomplete,
				read_count: evidenceReadCount,
				repeated_read_count: [...readCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
				review_checkpoint_count: reviewCheckpointCount,
				threshold_reached: false,
			};
		};
		const appendControl = (record: Record<string, unknown>) => appendFileSync(
			controlPath,
			JSON.stringify({ run_id: runId, ...record, recordedAt: new Date().toISOString() }) + "\n",
			"utf8",
		);
		const checkpointPath = join(root, "task-context-cache", "auto-research-checkpoints", `${sessionId}.json`);
		let savedCheckpoint: Record<string, any> = existsSync(checkpointPath)
			? JSON.parse(readFileSync(checkpointPath, "utf8")) : {};
		evidenceReadCount = Number(savedCheckpoint.evidence_read_count ?? 0);
		reviewCheckpointCount = Number(savedCheckpoint.evidence_audit?.review_checkpoint_count ?? 0);
		for (const [ref, coverage] of savedCheckpoint.evidence_progress?.pages ?? []) pageCoverage.set(ref, coverage);
		for (const [signature, count] of savedCheckpoint.evidence_progress?.read_counts ?? []) {
			readCounts.set(signature, count);
			readSignatures.add(signature);
		}
		const saveResearchCheckpoint = (params: Record<string, any>, paused: boolean) => {
			params = { ...savedCheckpoint, ...params };
			const evidenceCursor = canonicalEvidenceSnapshot(root);
			mkdirSync(join(root, "task-context-cache", "auto-research-checkpoints"), { recursive: true });
			const checkpoint = {
				...savedCheckpoint,
				...(worker ? { consumed_evidence_refs: [...new Set([...(savedCheckpoint.consumed_evidence_refs ?? []), ...consumedEvidence])],
					worker_id: worker.worker_id, evidence_cutoff: worker.evidence_cutoff } : {}),
				format: "auto-research-checkpoint-v1", session_id: sessionId,
				status: paused ? "pending" : "active", cursor: String(params.cursor ?? ""),
				evidence_refs: [...new Set(Array.isArray(params.evidence_refs) ? params.evidence_refs.map(String) : [])],
				selected_resource_refs: [...new Set(Array.isArray(params.resource_refs)
					? params.resource_refs.map(String) : (params.selected_resource_refs ?? refs).map(String))],
					unresolved_questions: Array.isArray(params.unresolved_questions) ? params.unresolved_questions.map(String) : [],
					draft_findings: Array.isArray(params.draft_findings) ? params.draft_findings : [],
				next_step: String(params.next_step ?? ""), pause_reason: paused ? String(params.reason ?? "agent requested pause") : null,
				...(params.report_submission_error ? { report_submission_error: String(params.report_submission_error) } : {}),
				...(params.read_batch_boundary ? { read_batch_boundary: params.read_batch_boundary } : {}),
				resume_condition: String(params.resume_condition ?? "new evidence or an explicit parent resume"),
				...(paused ? { wait_for: String(params.wait_for) } : {}),
				...(paused ? {
					after_evidence_sequence: evidenceCursor.sequence,
					after_evidence_refs: evidenceCursor.refs,
				} : {}),
					evidence_read_count: evidenceReadCount, evidence_audit: evidenceAudit(), recordedAt: new Date().toISOString(),
					evidence_progress: { pages: [...pageCoverage], read_counts: [...readCounts] },
			};
			const temporary = `${checkpointPath}.tmp`;
			writeFileSync(temporary, JSON.stringify(checkpoint) + "\n", "utf8");
			renameSync(temporary, checkpointPath);
			savedCheckpoint = checkpoint;
			appendControl({ event: paused ? "research_paused" : "research_checkpoint_saved", session_id: sessionId,
				cursor: checkpoint.cursor, evidence_read_count: evidenceReadCount, resume_condition: checkpoint.resume_condition });
			return checkpoint;
		};
		pauseReadBatch = details => {
			if (reportSubmitted || savedCheckpoint.status === "pending") return;
			saveResearchCheckpoint({ reason: details.reason,
				next_step: savedCheckpoint.next_step || "Resume only with an authorized bounded slice; distill the preserved read batch or return the current uncertainty before retrieving more evidence.",
				wait_for: "manual_resume", resume_condition: "manual_resume", read_batch_boundary: details }, true);
		};
		if (process.env.PI_AUTO_RESEARCH_CHECKPOINT_TOOL !== "0") pi.registerTool({
			name: "research_checkpoint", label: "Auto-Research checkpoint",
			description: "Save a task-local research cursor. action=pause ends this child process with a pending checkpoint for either interaction mode; blocking waits only for this compute slice and returns pending instead of waiting for future parent evidence.",
			parameters: Type.Object({
				action: Type.Union([Type.Literal("save"), Type.Literal("pause")]),
				cursor: Type.Optional(Type.String()),
				evidence_refs: Type.Optional(Type.Array(Type.String())),
				consumed_evidence_refs: Type.Optional(Type.Array(Type.String(), { description: "Exact offered refs actually analyzed; read/render grants do not imply consumption." })),
				resource_refs: Type.Optional(Type.Array(Type.String())),
				unresolved_questions: Type.Optional(Type.Array(Type.String())),
				draft_findings: Type.Optional(Type.Array(Type.Any())),
				next_step: Type.Optional(Type.String()),
				reason: Type.Optional(Type.String()),
				wait_for: Type.Optional(Type.Union([
					Type.Literal("next_parent_evidence"), Type.Literal("manual_resume"),
				])),
			}),
			async execute(_id, params) {
				consumeEvidence(params.consumed_evidence_refs);
				const paused = params.action === "pause";
				if (paused && (!String(params.reason ?? "").trim() || !String(params.next_step ?? "").trim() || !params.wait_for)) {
					throw new Error("non-blocking pause requires reason, next_step, and wait_for");
				}
				const checkpoint = saveResearchCheckpoint({
					...params,
					...(paused ? { resume_condition: params.wait_for } : {}),
				}, paused);
				const { evidence_progress, ...semanticCheckpoint } = checkpoint;
				return { content: [{ type: "text", text: JSON.stringify(semanticCheckpoint) }], details: semanticCheckpoint,
					...(params.action === "pause" ? { terminate: true } : {}) };
			},
		});
		const submitResearchTool = {
			name: "submit_research_report",
			label: "Submit Auto-Research report",
			description: "Submit one auto-research-report-v1 and end this run. Optional extension objects are validated by the runtime after the call. A report does not mutate parent resources.",
			parameters: Type.Object({
				report: Type.Object({
					format: Type.Literal("auto-research-report-v1"),
					status: Type.Union([
						Type.Literal("provisional"), Type.Literal("supported_within_scope"),
						Type.Literal("inconclusive"), Type.Literal("contradicted"), Type.Literal("unresolved"),
					]),
					conclusion: Type.String(),
					findings: Type.Array(Type.Object({
						subject_kind: Type.String({ description: "Object addressed: task, component, composition, strategy, or research_method. Describe this finding, not the selected research scope." }),
						question: Type.String(),
						conclusion: Type.String(),
						evidence_refs: Type.Array(Type.String()),
						uncertainty: Type.String(),
						assessment: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
							description: "Optional finding assessment; runtime validates its canonical fields.",
						})),
					}),),
					evidence_refs: Type.Optional(Type.Array(Type.String(), {
						description: "Optional report-level evidence refs; omitted means none. Finding and method refs remain independently linked and validated.",
					})),
					alternatives: Type.Array(Type.String()),
					limitations: Type.Array(Type.String()),
					validation_plan: Type.String(),
					planning_implications: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()), {
						description: "Optional decision implications; runtime validates and normalizes canonical fields.",
					})),
					candidate_updates: Type.Optional(Type.Array(Type.Object({
						id: Type.String({ minLength: 1 }),
						kind: Type.Union([Type.Literal("rule"), Type.Literal("goal"), Type.Literal("strategy")]),
						status: Type.Union([Type.Literal("proposed"), Type.Literal("supported"), Type.Literal("challenged"), Type.Literal("rejected")]),
						claim: Type.Optional(Type.String()), prediction: Type.Optional(Type.String()),
						falsifier: Type.Optional(Type.String()), next_test: Type.Optional(Type.String()),
						evidence_refs: Type.Optional(Type.Array(Type.String())),
					}))),
					next_research_question: Type.Optional(Type.String()),
					research_progress: Type.Optional(Type.Object({
						topic: Type.String({ minLength: 1 }),
						question: Type.String({ minLength: 1 }),
						status: Type.Union([Type.Literal("continue"), Type.Literal("complete"), Type.Literal("drop")]),
						parent_relevance: Type.Union([Type.Literal("now"), Type.Literal("later"), Type.Literal("none")]),
						rationale: Type.Optional(Type.String()),
						hypothesis: Type.Optional(Type.String()),
						evidence_refs: Type.Optional(Type.Array(Type.String())),
						next_step: Type.Optional(Type.String()),
					})),
					experiment_request: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
						description: "Optional bounded request for a parent-executed experiment; runtime validates the canonical request contract.",
					})),
					confidence_update: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
						description: "Optional confidence change; runtime rejects unsupported increases.",
					})),
					method_candidates: Type.Optional(Type.Array(ResearchMethodCandidateSchema)),
				}),
			}),
			async execute(_id, params) {
				const suppliedReport = params.report as Record<string, unknown>;
				if (!suppliedReport || Array.isArray(suppliedReport) || suppliedReport.format !== "auto-research-report-v1") {
					throw new Error("report must be one auto-research-report-v1 object");
				}
				if (Object.prototype.hasOwnProperty.call(suppliedReport, "harness_proposals")
					&& (!Array.isArray(suppliedReport.harness_proposals) || suppliedReport.harness_proposals.length > 0)) {
					throw new Error("Auto-Research cannot author Harness components. Return method_candidates/findings/experiment_request only; the parent Agent may later read the matching creator and author a component.");
				}
				const report = normalizeAutoResearchReport(suppliedReport);
				if (process.env.PI_AUTO_RESEARCH_OPEN_ALLOCATION === "1" && !report.research_progress) {
					throw new Error("open Auto-Research requires research_progress so the runtime can preserve its agenda");
				}
				assertResearchConfidenceUpdate(report);
				assertHarnessProposalEvidenceLinks(report);
				assertResearchAssessmentReferences(report, (reference) => {
					const path = join(root, "effect-assessments.jsonl");
					if (!existsSync(path)) return undefined;
					return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
						try {
							const value = JSON.parse(line);
							return String(value?.effect_assessment_id ?? "") === reference ? [value] : [];
						} catch { return []; }
					}).at(-1);
				});
				// Keep the model-authored report byte-for-byte semantically separate
				// from runtime metadata. The audit describes read coverage only; it does
				// not decide whether the report's conclusion is true. Writing it as a
				// sidecar also prevents a machine field from changing the report
				// contract that the child submitted.
				const audit = evidenceAudit();
				const directory = join(root, "task-context-cache", "auto-research-child-results");
				mkdirSync(directory, { recursive: true });
				const target = join(directory, `${runId}.json`);
				const temporary = `${target}.tmp`;
				writeFileSync(temporary, JSON.stringify(report) + "\n", "utf8");
				renameSync(temporary, target);
				const auditTarget = join(directory, `${runId}.audit.json`);
				const auditTemporary = `${auditTarget}.tmp`;
				writeFileSync(auditTemporary, JSON.stringify(audit) + "\n", "utf8");
				renameSync(auditTemporary, auditTarget);
				reportSubmitted = true;
				appendControl({
					event: "report_submitted", evidence_read_count: evidenceReadCount,
					input_form: "structured_report", session_id: sessionId,
				});
				return {
					content: [{ type: "text", text: JSON.stringify({ accepted: true, run_id: runId,
						...(report.warnings?.length ? { warnings: report.warnings } : {}) }) }],
					details: { accepted: true, run_id: runId,
						...(report.warnings?.length ? { warnings: report.warnings } : {}) },
					terminate: true,
				};
			},
		};
		pi.registerTool(submitResearchTool);
		if (worker) {
			const tokensSpent = () => {
				const path = join(root, "subagent-provider-telemetry.jsonl");
				return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
					.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
					.filter(row => row.event === "assistant_message" && (worker.run_ids ?? []).includes(row.run_id))
					.reduce((sum, row) => sum + Number(row.usage?.output ?? 0), 0) : 0;
			};
			pi.on("before_provider_request", (event) => {
				const remaining = worker.max_output_tokens - tokensSpent();
				const payload = event.payload as Record<string, any>;
				const key = "max_completion_tokens" in payload ? "max_completion_tokens" : "max_tokens";
				return { ...payload, [key]: Math.max(1, Math.min(Number(payload[key] ?? remaining), remaining)) };
			});
			pi.on("message_end", (event, ctx) => {
				if ((event.message as any)?.role !== "assistant" || reportSubmitted) return;
				// Telemetry is installed last, so include this message before its log exists.
				if (tokensSpent() + Number((event.message as any).usage?.output ?? 0) < worker.max_output_tokens) return;
				saveResearchCheckpoint({ reason: "assigned_output_budget_exhausted", next_step: "Parent must grant a new bounded assignment to continue.",
					wait_for: "manual_resume" }, true);
				ctx.abort();
			});
		}
		if (worker) pi.registerTool({
			name: "publish_research_update", label: "Publish research increment",
			description: "Publish a validated report while research remains active. Preserve alternatives and limits. The parent receives a bounded current increment; full details stay addressable. This does not change or assemble Harness.",
			parameters: Type.Object({
				report: submitResearchTool.parameters.properties.report,
				priority: Type.Optional(Type.Union([Type.Literal("current"), Type.Literal("later"), Type.Literal("urgent")])),
				consumed_evidence_refs: Type.Optional(Type.Array(Type.String())),
				revises_ref: Type.Optional(Type.String()), withdraws_ref: Type.Optional(Type.String()),
			}),
			async execute(_id, params) {
				const supplied = params.report as Record<string, any>;
				if (supplied.harness_proposals?.length) throw new Error("research workers cannot author Harness components");
				const report = normalizeAutoResearchReport(supplied);
				assertResearchConfidenceUpdate(report);
				assertHarnessProposalEvidenceLinks(report);
				assertResearchAssessmentReferences(report, ref => {
					const path = join(root, "effect-assessments.jsonl");
					return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
						.map(line => JSON.parse(line)).filter(row => row.effect_assessment_id === ref).at(-1) : undefined;
				});
				const previous = workerOwnUpdates(root, worker.worker_id);
				for (const ref of [params.revises_ref, params.withdraws_ref].filter(Boolean))
					if (!previous.some(row => `research_update:${row.update_id}@v${row.version}` === ref))
						throw new Error("revision/withdrawal must reference this worker's exact prior publication");
				consumeEvidence(params.consumed_evidence_refs);
				const fingerprint = createHash("sha256").update(JSON.stringify([report, worker.evidence_cutoff,
					params.revises_ref ?? null, params.withdraws_ref ?? null, params.priority ?? null])).digest("hex");
				const repeated = previous.find(row => row.publication_fingerprint === fingerprint);
				if (repeated) {
					saveResearchCheckpoint({ cursor: `published:${repeated.update_id}` }, false);
					const receipt = { accepted: true, reused: true, update_ref: `research_update:${repeated.update_id}@v${repeated.version}`, lifecycle: "active" };
					return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
				}
				const updateId = `${runId}-update-${previous.length + 1}`;
				appendWorkerRecord(root, "update", { format: "auto-research-update-v1", update_id: updateId, version: 1,
					worker_id: worker.worker_id, research_line_ref: worker.research_line_ref, session_id: sessionId,
					publication_fingerprint: fingerprint,
					run_id: runId, lifecycle: "active", priority: params.priority ?? (report.research_progress?.parent_relevance === "now" ? "current" : "later"),
					revises_ref: params.revises_ref ?? null, withdraws_ref: params.withdraws_ref ?? null,
					consumed_evidence_refs: [...consumedEvidence], evidence_cutoff: worker.evidence_cutoff, report });
				saveResearchCheckpoint({ cursor: `published:${updateId}` }, false);
				const receipt = { accepted: true, update_ref: `research_update:${updateId}@v1`, lifecycle: "active" };
				return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
			},
		});
		pi.on("tool_execution_start", (event) => {
			if (!new Set(["arc_state", "inspect_arc_trajectory", "task_resource"]).has(event.toolName)) return;
			pendingReadSignatures.set(event.toolCallId, JSON.stringify([event.toolName, event.args ?? null]));
		});
		pi.on("tool_execution_end", (event) => {
			if (event.toolName === "submit_research_report") {
				if (event.isError && !reportSubmitted) {
					const text = event.result?.content?.find((item: any) => item?.type === "text")?.text;
					const error = String(text ?? "submit_research_report failed schema or semantic validation").slice(0, 8000);
					saveResearchCheckpoint({
						cursor: "repair-report-submission",
						next_step: "Correct only the rejected report fields and call submit_research_report again; preserve supported conclusions and evidence references.",
						unresolved_questions: [error], report_submission_error: error,
					}, false);
					appendControl({ event: "report_submission_rejected", session_id: sessionId, error });
				}
				return;
			}
			if (reportSubmitted || event.isError) return;
			if (!new Set(["arc_state", "inspect_arc_trajectory", "task_resource"]).has(event.toolName)) return;
			evidenceReadCount += 1;
			const signature = pendingReadSignatures.get(event.toolCallId) ?? JSON.stringify([event.toolName, null]);
			pendingReadSignatures.delete(event.toolCallId);
			readSignatures.add(signature);
			readCounts.set(signature, (readCounts.get(signature) ?? 0) + 1);
			addCoverage(readDetails(event));
			// Persist mechanical progress even when the model's next response ends
			// in thinking-only length before it can save a semantic checkpoint.
			saveResearchCheckpoint({}, false);
			// Repeated reads are provenance only. The child Agent chooses whether
			// more pages/observations are useful, or whether to submit/pause.
		});
		pi.on("before_agent_start", (event) => {
			const instructions = commonInstructions + (profile.instructions ? "\n\n" + profile.instructions : "");
			const convergence = savedCheckpoint.report_submission_error
				? "\n\nThe previous submit_research_report call was rejected. Preserve its supported analysis, correct only the reported schema/semantic errors, and submit again before doing more inspection."
				: "";
			appendFileSync(join(root, "auto-research-prompt-loads.jsonl"), JSON.stringify({
				run_id: runId, session_id: sessionId, scope: profile.scope, profile_file: profile.file,
				profile_sha256: profile.sha256, common_sha256: createHash("sha256").update(commonInstructions).digest("hex"),
				common_chars: commonInstructions.length, profile_chars: profile.instructions.length,
				recordedAt: new Date().toISOString(),
			}) + "\n", "utf8");
			return { systemPrompt: `${event.systemPrompt}\n\n${instructions}${convergence}` };
		});
	}
	// Installed last so fallback telemetry sees the child's final context projection.
	installProviderTelemetry(pi, {
		root, fileName: "subagent-provider-telemetry.jsonl",
		contextTokenFileName: "subagent-context-token-debug.jsonl",
		scope: process.env.PI_TASK_CHILD_CONTEXT_SCOPE ?? "task-child",
	});
}
