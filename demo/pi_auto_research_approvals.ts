/** Auto-Research-owned structured delivery approval ledger.
 *
 * Approval is deliberately not a second task-resource adapter.  It is a
 * small, append-only metadata ledger used by the isolated research child.
 * Approving a proposal never creates or changes a task skill/tool; it only
 * binds the complete delivery hash and records the child's review decision.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	harnessDeliveryHash,
	normalizeHarnessDelivery,
	type HarnessDelivery,
} from "./pi_auto_research_harness_router.ts";
import { HarnessDeliverySchema } from "./pi_auto_research_harness_schema.ts";
import { ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { resourceMetadata, taskRecords, versionConflict } from "./pi_task_resource_store.ts";

export type ApprovalAction = "approve" | "reject" | "defer";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "deferred";

export type ApprovalRecord = {
	format: "auto-research-approval-v1";
	approval_id: string;
	version: number;
	run_id: string;
	session_id?: string;
	proposal: {
		kind: string;
		operation: string;
		name: string;
		summary: string;
		basis_refs: string[];
		delivery: HarnessDelivery;
		delivery_hash: string;
	};
	status: ApprovalStatus;
	tag: "pending_review" | "approved" | "rejected" | "deferred";
	decision_note?: string;
	decided_by?: "auto-research-agent";
	recordedAt: string;
};

export const AUTO_RESEARCH_APPROVAL_TOOL = "research_approval";

const ACTION_TAG: Record<ApprovalAction, ApprovalRecord["tag"]> = {
	approve: "approved", reject: "rejected", defer: "deferred",
};

function latestApprovals(root: string): Map<string, ApprovalRecord> {
	const latest = new Map<string, ApprovalRecord>();
	for (const record of taskRecords(root, "proposal")) {
		if (record.format !== "auto-research-approval-v1" || !record.approval_id) continue;
		const current = latest.get(String(record.approval_id));
		if (!current || Number(record.version ?? 0) > current.version) {
			latest.set(String(record.approval_id), record as ApprovalRecord);
		}
	}
	return latest;
}

export class AutoResearchApprovalStore {
	private readonly scope;
	private readonly approvals: Map<string, ApprovalRecord>;
	private readonly root: string;
	private readonly runId: string;
	private readonly sessionId?: string;

	constructor(
		root: string,
		runId: string,
		sessionId?: string,
	) {
		this.root = root;
		this.runId = runId;
		this.sessionId = sessionId;
		this.scope = ensureTaskScope(root);
		this.approvals = latestApprovals(root);
	}

	private append(record: ApprovalRecord): ApprovalRecord {
		this.approvals.set(record.approval_id, record);
		appendFileSync(join(this.scope.root, "task-harness-proposals.jsonl"),
			JSON.stringify(stampTaskRecord(this.scope, record)) + "\n", "utf8");
		return record;
	}

	get(approvalId: string): ApprovalRecord | undefined {
		const record = this.approvals.get(approvalId);
		return record?.run_id === this.runId ? record : undefined;
	}

	inspect(approvalId?: string): Record<string, unknown> {
		const records = approvalId
			? [this.approvals.get(approvalId)].filter(Boolean)
			: [...this.approvals.values()].filter((item) => item.run_id === this.runId);
		return {
			format: "auto-research-approval-index-v1",
			read_only: true,
			run_id: this.runId,
			records: records.map((item) => resourceMetadata("proposal", item as Record<string, any>)),
		};
	}

	propose(input: {
		approvalId?: string;
		delivery: unknown;
	}): ApprovalRecord {
		const delivery = normalizeHarnessDelivery(input.delivery);
		const runProposalCount = [...this.approvals.values()].filter((item) => item.run_id === this.runId).length;
		const approvalId = String(input.approvalId ?? `${this.runId}:proposal-${runProposalCount + 1}`).trim();
		if (!/^[a-z0-9][a-z0-9:-]*$/.test(approvalId)) throw new Error("approval_id must use lowercase letters, digits, colons, or hyphens");
		const previous = this.approvals.get(approvalId);
		if (previous) {
			if (previous.run_id !== this.runId) throw new Error("approval_id belongs to another Auto-Research run");
			return previous;
		}
		return this.append({
			format: "auto-research-approval-v1",
			approval_id: approvalId,
			version: 1,
			run_id: this.runId,
			...(this.sessionId ? { session_id: this.sessionId } : {}),
			proposal: {
				kind: delivery.semantic_kind, operation: delivery.operation,
				name: delivery.name, summary: delivery.summary,
				basis_refs: [...new Set(delivery.basis_refs.map(String))],
				delivery,
				delivery_hash: harnessDeliveryHash(delivery),
			},
			status: "pending", tag: "pending_review",
			recordedAt: new Date().toISOString(),
		});
	}

	decide(action: ApprovalAction, approvalId: string, targetVersion: unknown, note?: string): ApprovalRecord | ReturnType<typeof versionConflict> {
		const previous = this.approvals.get(approvalId);
		if (!previous) throw new Error(`unknown approval_id: ${approvalId}`);
		if (previous.run_id !== this.runId) throw new Error("approval belongs to another Auto-Research run");
		if (previous.version !== Number(targetVersion)) {
			return versionConflict("proposal", previous as Record<string, any>, targetVersion);
		}
		if (["approved", "rejected"].includes(previous.status)) {
			throw new Error(`approval is terminal: ${previous.status}`);
		}
		const now = new Date().toISOString();
		return this.append({
			...previous,
			version: previous.version + 1,
			status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "deferred",
			tag: ACTION_TAG[action],
			...(note?.trim() ? { decision_note: note.trim() } : {}),
			decided_by: "auto-research-agent",
			recordedAt: now,
		});
	}
}

export function installAutoResearchApprovalTool(
	pi: ExtensionAPI,
	store: AutoResearchApprovalStore,
): void {
	const modelApprovalView = (record: ApprovalRecord) => ({
		format: record.format,
		approval_id: record.approval_id,
		version: record.version,
		run_id: record.run_id,
		...(record.session_id ? { session_id: record.session_id } : {}),
		status: record.status,
		tag: record.tag,
		proposal: {
			kind: record.proposal.kind,
			operation: record.proposal.operation,
			name: record.proposal.name,
			summary: record.proposal.summary,
			basis_refs: record.proposal.basis_refs,
			delivery_hash: record.proposal.delivery_hash,
		},
		...(record.decision_note ? { decision_note: record.decision_note } : {}),
		next: record.status === "pending" || record.status === "deferred"
			? `Immediately call research_approval(action=approve|reject|defer, approval_id=${record.approval_id}, target_version=${record.version}) before another proposal.`
			: "This approval has been decided; submit its exact approval_id in the final report if it is part of the handoff.",
	});
	pi.registerTool({
		name: AUTO_RESEARCH_APPROVAL_TOOL,
		label: "Auto-Research proposal review",
		description: "Inspect or review a complete structured Auto-Research harness delivery inside the isolated research child. After propose returns, use the returned exact approval_id and version immediately with approve, reject, or defer before proposing another delivery; never guess an id or approve a different body. These actions only change versioned status/tag and never mutate parent harness resources or the environment.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("propose"), Type.Literal("inspect"), Type.Literal("approve"),
				Type.Literal("reject"), Type.Literal("defer"),
			]),
			approval_id: Type.Optional(Type.String()),
			target_version: Type.Optional(Type.Integer({ minimum: 1 })),
			delivery: Type.Optional(HarnessDeliverySchema),
			decision_note: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			const p = params as Record<string, any>;
			if (p.action === "inspect") {
				const result = store.inspect(p.approval_id ? String(p.approval_id) : undefined);
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			}
			if (p.action === "propose") {
				if (!p.delivery) throw new Error("propose requires one structured delivery");
				const record = store.propose({ approvalId: p.approval_id, delivery: p.delivery });
				// The complete canonical delivery remains in the approval ledger and in
				// `details`; the model-facing content only needs the exact identity,
				// version and hash required for the immediate decision. This avoids
				// replaying a potentially large delivery into every provider message
				// without imposing any limit on the stored report or delivery body.
				return { content: [{ type: "text", text: JSON.stringify(modelApprovalView(record)) }], details: record };
			}
			if (!p.approval_id || p.target_version === undefined) throw new Error(`${p.action} requires approval_id and target_version`);
			const record = store.decide(p.action, String(p.approval_id), p.target_version, p.decision_note);
			return { content: [{ type: "text", text: JSON.stringify(modelApprovalView(record)) }], details: record };
		},
	});
}
