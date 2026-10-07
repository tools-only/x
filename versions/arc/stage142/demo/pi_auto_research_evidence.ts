/** Canonical evidence cursor shared by the parent scheduler and research child. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCES = [
	{ filename: "execution-observations.jsonl", kind: "observation", id: ["observation_id", "event_id"] },
	{ filename: "auto-research-reports.jsonl", kind: "research_report", id: ["run_id"] },
	{ filename: "task-memory.jsonl", kind: "memory", id: ["key", "name"] },
	{ filename: "task-skills.jsonl", kind: "skill", id: ["name"] },
	{ filename: "task-tools.jsonl", kind: "tool", id: ["name"] },
	{ filename: "task-subagents.jsonl", kind: "subagent", id: ["name", "agent_id"] },
	{ filename: "task-system-prompt.jsonl", kind: "system_prompt", id: ["name"] },
] as const;

// These records describe orchestration itself, not new evidence about the task.
const BOOKKEEPING_TOOLS = new Set([
	"auto_research", "delegate_task", "task_resource", "task_harness", "task_harness_status",
	"task_checkpoint", "task_validation", "research_resource", "research_checkpoint",
	"research_approval", "submit_research_report",
]);

function records(path: string): Record<string, any>[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
		} catch { return []; }
	});
}

export type CanonicalEvidenceSnapshot = { sequence: number; refs: string[] };

export function environmentEvidenceSnapshot(root: string): CanonicalEvidenceSnapshot {
	const refs: string[] = [];
	for (const record of records(join(root, "execution-observations.jsonl"))) {
		if (BOOKKEEPING_TOOLS.has(String(record.tool_name ?? record.tool ?? ""))) continue;
		const name = ["observation_id", "event_id"].map((key) => String(record[key] ?? "").trim()).find(Boolean);
		if (!name) continue;
		refs.push(`observation:${name}@v${Math.max(1, Number(record.version ?? 1))}`);
	}
	return { sequence: refs.length, refs };
}

export function parentEvidenceSnapshot(root: string): CanonicalEvidenceSnapshot {
	const refs: string[] = [...environmentEvidenceSnapshot(root).refs];
	for (const source of SOURCES.filter((item) => item.kind !== "observation" && item.kind !== "research_report")) {
		for (const record of records(join(root, source.filename))) {
			const name = source.id.map((key) => String(record[key] ?? "").trim()).find(Boolean);
			if (!name) continue;
			refs.push(`${source.kind}:${name}@v${Math.max(1, Number(record.version ?? 1))}`);
		}
	}
	return { sequence: refs.length, refs };
}

export function canonicalEvidenceSnapshot(root: string): CanonicalEvidenceSnapshot {
	const refs: string[] = [];
	for (const source of SOURCES) {
		for (const record of records(join(root, source.filename))) {
			if (source.kind === "observation" && BOOKKEEPING_TOOLS.has(String(record.tool_name ?? record.tool ?? ""))) continue;
			const name = source.id.map((key) => String(record[key] ?? "").trim()).find(Boolean);
			if (!name) continue;
			refs.push(`${source.kind}:${name}@v${Math.max(1, Number(record.version ?? 1))}`);
		}
	}
	return { sequence: refs.length, refs };
}

export function evidenceRefsAfter(
	current: CanonicalEvidenceSnapshot,
	checkpoint: Record<string, any>,
): string[] {
	const previous = new Set(Array.isArray(checkpoint.after_environment_refs)
		? checkpoint.after_environment_refs.map(String)
		: Array.isArray(checkpoint.after_evidence_refs) ? checkpoint.after_evidence_refs.map(String) : []);
	return current.refs.filter((ref) => !previous.has(ref));
}
