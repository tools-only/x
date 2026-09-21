/** Extra read-only task resource access for an isolated Pi child. */
import { appendFileSync, existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertHarnessProposalEvidenceLinks, assertResearchAssessmentReferences, assertResearchConfidenceUpdate, normalizeAutoResearchReport } from "./pi_auto_research_output.ts";
import { ResearchMethodCandidateSchema } from "./pi_auto_research_harness_schema.ts";
import { AutoResearchApprovalStore, installAutoResearchApprovalTool } from "./pi_auto_research_approvals.ts";
import { harnessDeliveryHash } from "./pi_auto_research_harness_router.ts";
import { installTaskResourceReader } from "./pi_task_resource_store.ts";
import { installTaskLocalContextLifecycle } from "./pi_task_local_context_lifecycle.ts";
import { loadPrompt } from "./prompt_loader.ts";
import { createHash } from "node:crypto";
import { loadResearchProfile } from "./pi_auto_research_profiles.ts";
import { canonicalEvidenceSnapshot } from "./pi_auto_research_evidence.ts";

export default function taskValidationChild(pi: ExtensionAPI) {
	if (process.env.PI_TASK_CHILD !== "1") throw new Error("this extension is only for isolated task children");
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	const refs = JSON.parse(process.env.PI_TASK_CHILD_RESOURCE_REFS ?? "[]");
	if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string")) throw new Error("invalid child resource grants");
	installTaskResourceReader(pi, root, refs);
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
		const interactionMode = process.env.PI_AUTO_RESEARCH_INTERACTION_MODE === "non_blocking"
			? "non_blocking" : "blocking";
		const profile = loadResearchProfile(process.env.PI_AUTO_RESEARCH_SCOPE ?? "unspecified");
		const commonInstructions = loadPrompt("auto_research_child_contract.md");
		const approvalStore = new AutoResearchApprovalStore(root, runId, sessionId);
		// The child returns immutable candidate bodies directly. Keep the approval
		// ledger readable for old reports, but do not expose a child-side
		// propose/approve workflow in the native tool surface.
		if (process.env.PI_AUTO_RESEARCH_LEGACY_APPROVALS === "1") {
			installAutoResearchApprovalTool(pi, approvalStore);
		}
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
				format: "auto-research-checkpoint-v1", session_id: sessionId,
				status: paused ? "pending" : "active", cursor: String(params.cursor ?? ""),
				evidence_refs: [...new Set(Array.isArray(params.evidence_refs) ? params.evidence_refs.map(String) : [])],
				selected_resource_refs: [...new Set(Array.isArray(params.resource_refs)
					? params.resource_refs.map(String) : (params.selected_resource_refs ?? refs).map(String))],
					unresolved_questions: Array.isArray(params.unresolved_questions) ? params.unresolved_questions.map(String) : [],
					draft_findings: Array.isArray(params.draft_findings) ? params.draft_findings : [],
				next_step: String(params.next_step ?? ""), pause_reason: paused ? String(params.reason ?? "agent requested pause") : null,
				...(params.report_submission_error ? { report_submission_error: String(params.report_submission_error) } : {}),
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
		if (process.env.PI_AUTO_RESEARCH_CHECKPOINT_TOOL !== "0") pi.registerTool({
			name: "research_checkpoint", label: "Auto-Research checkpoint",
			description: "Save a task-local research cursor. action=pause ends this child process with a pending checkpoint for either interaction mode; blocking waits only for this compute slice and returns pending instead of waiting for future parent evidence.",
			parameters: Type.Object({
				action: Type.Union([Type.Literal("save"), Type.Literal("pause")]),
				cursor: Type.Optional(Type.String()),
				evidence_refs: Type.Optional(Type.Array(Type.String())),
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
		pi.registerTool({
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
					evidence_refs: Type.Array(Type.String()),
					alternatives: Type.Array(Type.String()),
					limitations: Type.Array(Type.String()),
					validation_plan: Type.String(),
					planning_implications: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()), {
						description: "Optional decision implications; runtime validates and normalizes canonical fields.",
					})),
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
					harness_proposals: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
						description: "Optional complete auto-research-harness-delivery-v1 candidates. Runtime validates, routes, and keeps invalid implementations pending without discarding a valid method.",
					}),
				}),
			}),
			async execute(_id, params) {
				const suppliedReport = params.report as Record<string, unknown>;
				if (!suppliedReport || Array.isArray(suppliedReport) || suppliedReport.format !== "auto-research-report-v1") {
					throw new Error("report must be one auto-research-report-v1 object");
				}
				// Hydrate approval-only proposals from the child-local ledger before
				// normalization. This is not a shortcut around approval: the ledger
				// contains the exact canonical body and its SHA-256 binding.
				const hydratedInput = {
					...suppliedReport,
					harness_proposals: Array.isArray(suppliedReport.harness_proposals)
						? suppliedReport.harness_proposals.map((item: any) => {
							if (item?.format === "auto-research-harness-delivery-v1") {
								return { ...(item.candidate_ref ? { candidate_ref: item.candidate_ref } : {}), delivery: item };
							}
							if (item?.delivery) return item;
							const approval = item?.approval_id ? approvalStore.get(String(item.approval_id)) : undefined;
							if (!approval) return item;
							return { ...item, delivery: approval.proposal.delivery };
						})
						: suppliedReport.harness_proposals,
				};
				const report = normalizeAutoResearchReport(hydratedInput);
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
				const reviewedProposals = report.harness_proposals.map((proposal: Record<string, any>, index: number) => {
					const approval = proposal.approval_id ? approvalStore.get(String(proposal.approval_id)) : undefined;
					if (!approval && !proposal.delivery) {
						if (proposal.proposal_status === "pending_implementation" && proposal.proposal_error) {
							return { ...proposal, candidate_ref: String(proposal.candidate_ref ?? `${runId}:pending-candidate-${index + 1}`) };
						}
						throw new Error(`proposal ${index + 1} requires delivery or a known approval_id`);
					}
					if (!approval) {
						const candidateRef = String(proposal.candidate_ref ?? `${runId}:candidate-${index + 1}:${harnessDeliveryHash(proposal.delivery)}`);
						return { ...proposal, candidate_ref: candidateRef };
					}
					if (approval.proposal.delivery_hash !== harnessDeliveryHash(proposal.delivery)) {
						throw new Error(`report proposal does not match approval object: ${approval.approval_id}`);
					}
					if (approval.status === "pending") throw new Error(`approval must be decided before report submission: ${approval.approval_id}`);
					return { ...proposal, approval_id: approval.approval_id,
						approval_version: approval.version, approval_status: approval.status, approval_tag: approval.tag };
				});
				const reviewedReport = { ...report, harness_proposals: reviewedProposals };
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
				writeFileSync(temporary, JSON.stringify(reviewedReport) + "\n", "utf8");
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
					content: [{ type: "text", text: JSON.stringify({ accepted: true, run_id: runId }) }],
					details: { accepted: true, run_id: runId },
					terminate: true,
				};
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
}
