/** Deterministic read-only history catalog for open Auto-Research. */
import { resourceMetadata, taskRecords } from "./pi_task_resource_store.ts";

export const AUTO_RESEARCH_HISTORY_KINDS = [
	"observation", "pre_action_state", "research_report", "research_run",
	"research_agenda", "method", "effect_assessment", "harness_observation",
	"failure", "finding", "validation", "memory", "skill", "tool",
	"subagent", "system_prompt", "level_review",
] as const;

export type AutoResearchHistoryCatalog = {
	format: "auto-research-history-catalog-v1";
	cursor: Record<string, number>;
	previous_cursor: Record<string, number>;
	new_resource_refs: string[];
	kinds: Array<{ kind: string; versions: number; new_versions: number; latest_refs: string[] }>;
	access: { tool: "task_resource"; inspect: string; read: string };
};

export function buildAutoResearchHistoryCatalog(
	root: string,
	previousCursor: Record<string, unknown> = {},
): AutoResearchHistoryCatalog {
	const cursor: Record<string, number> = {};
	const previous: Record<string, number> = {};
	const newResourceRefs: string[] = [];
	const kinds = AUTO_RESEARCH_HISTORY_KINDS.map((kind) => {
		const records = taskRecords(root, kind);
		const prior = Math.max(0, Math.min(records.length, Number(previousCursor[kind] ?? 0) || 0));
		cursor[kind] = records.length;
		previous[kind] = prior;
		const refs = records.map((record) => resourceMetadata(kind, record).resource_ref);
		newResourceRefs.push(...refs.slice(Math.max(prior, refs.length - 3)));
		return { kind, versions: records.length, new_versions: records.length - prior, latest_refs: refs.slice(-3) };
	});
	return {
		format: "auto-research-history-catalog-v1",
		cursor,
		previous_cursor: previous,
		new_resource_refs: [...new Set(newResourceRefs)],
		kinds,
		access: {
			tool: "task_resource",
			inspect: "Inspect one permitted kind to discover exact task-local versions.",
			read: "Read only exact kind:name@vN references, in pages, when a claim needs the body.",
		},
	};
}

export function autoResearchHistoryGrants(): string[] {
	return AUTO_RESEARCH_HISTORY_KINDS.map((kind) => `${kind}:*`);
}
