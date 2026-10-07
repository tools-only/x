/** Same question/materials reuse. An explicit new review reason allows reinterpretation. */
import { createHash } from "node:crypto";
import { environmentEvidenceSnapshot } from "./pi_auto_research_evidence.ts";
import { readCurrentTaskCheckpoint } from "./pi_task_checkpoint_reader.ts";
import { readTaskStrategyState } from "./pi_task_strategy_state.ts";
export function researchRequestIdentity(root: string, input: Record<string, any>): string {
	const checkpoint = readCurrentTaskCheckpoint(root), strategy = readTaskStrategyState(root);
	const sortRefs = (v: any) => Array.isArray(v) ? [...new Set(v.map(String))].sort() : [];
	const materials = { question: input.question, scope: input.scope, research_kind: input.research_kind,
		topic: input.research_line_ref, constraints: input.constraints ?? [], current_concern: input.current_concern,
		evidence_refs: sortRefs(input.evidence_refs), resource_refs: sortRefs(input.resource_refs),
		inherit_harness_refs: sortRefs(input.inherit_harness_refs), context_window: input.context_window,
		public_evidence: environmentEvidenceSnapshot(root).refs,
		goal_state: Object.fromEntries(["task_goal", "success_conditions", "task_constraints", "planning_gap", "current_strategy", "hypothesis", "next_step"]
			.map(k => [k, checkpoint[k]])),
		parent_candidates: (strategy.candidates ?? []).filter((c: any) => !String(c.updated_by).startsWith("research_report:"))
			.map((c: any) => ({ id: c.id, version: c.version ?? 1 })), selected: strategy.selected_candidate_id };
	return createHash("sha256").update(JSON.stringify(materials)).digest("hex");
}
