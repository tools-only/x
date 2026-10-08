/** Scripted decisions for the real ARC runner's direct-use seam. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function directUseStep(request: number, context: any, scene: (context: any) => unknown): any {
	const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
	const rows = (name: string) => existsSync(join(root, name))
		? readFileSync(join(root, name), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
	if (process.env.PI_TASK_CHILD === "1") {
		const marker = join(root, "direct-use-length.marker");
		if (!existsSync(marker)) { writeFileSync(marker, "length\n"); return { kind: "length", text: "Continue bounded analysis in the same invocation." }; }
		return request === 0 ? { kind: "tool", name: "arc_state", arguments: { request: "current" } }
			: { kind: "text", text: JSON.stringify(scene(context)) };
	}
	const assembly = rows("task-harness-assemblies.jsonl").at(-1);
	const snapshot = rows("observation-snapshots.jsonl").at(-1);
	const decision = { basis_refs: [], reason: "Parent chooses a direct-use diagnostic composition", expected: "Apply only selected guidance" };
	const tool = (name: string, args: any) => ({ kind: "tool", name, arguments: args });
	if (request === 0) return tool("task_harness", { action: "start" });
	if (request === 1) return tool("task_harness", { action: "activate", enabled_tools: ["delegate_task", "task_memory_pool"] });
	request -= 2;
	const action = (name: string, refs: string[] = []) => tool("arc_action", { action: name,
		reasoning: "Apply DIRECT_STEPS with the Tool value and one-off report; inspect the public result.",
		decision: { used_resource_refs: refs, prediction: "Inspect the public result; no goal rule is established." } });
	if (request === 6) return tool("task_harness", { action: "assemble", expected_assembly_revision: assembly.revision,
		selected_resource_refs: assembly.selected_resource_refs.filter((ref: string) => ref !== "memory:direct-unused@v1"),
		prompt_contributions: assembly.prompt_contributions.filter((part: any) => part.source_ref !== "memory:direct-unused@v1"), decision });
	if (request === 8 || request === 10) return tool("task_harness", {
		action: "change", changes: [{ operation: request === 8 ? "update" : "retire",
			target_ref: `system_prompt:direct-policy@v${request === 8 ? 1 : 2}`,
			candidate: { component: "system_prompt", name: "direct-policy", content: "DIRECT_POLICY_V2", scope: "task" } }], decision,
		...(request === 8 ? { assembly: { expected_assembly_revision: assembly.revision,
			selected_resource_refs: assembly.selected_resource_refs.filter((ref: string) => !ref.startsWith("system_prompt:")),
			prompt_contributions: assembly.prompt_contributions } } : {}) });
	return [action("ACTION1"),
		tool("task_memory_pool", { action: "capture", select: true, items: [
			{ key: "direct-fact", content: "DIRECT_SELECTED_FACT: inspect the public result before interpreting control.", scope: "task" },
			{ key: "direct-unused", content: "DIRECT_UNUSED_FACT", scope: "task" }] }),
		tool("task_harness_create", { candidate: { component: "skill", name: "direct-steps", description: "Compare one ARC action with evidence",
			instructions: "DIRECT_STEPS: use Tool dimensions and the one-off conclusion, take one bounded action, then inspect the public result." } }),
		tool("task_harness_create", { candidate: { component: "system_prompt", name: "direct-policy", content: "DIRECT_POLICY_V1", scope: "task" } }),
		tool("delegate_task", { task: "Read the selected ARC frame and return dimensions and first cell.",
			output_contract: "Return rows, columns, first_cell and grid_sha256.", stop_when: "After one public frame read; return a limitation if unavailable.",
			budget: { max_tool_calls: 2, max_continuations: 2, max_reported_tokens: 100, max_runtime_ms: 60000 }, tools: ["arc_state"],
			evidence_refs: [`observation_snapshot:${snapshot?.snapshot_id}@v${snapshot?.version ?? 1}`], context_recipe: { include_checkpoint: false } }),
		tool("task_harness_create", { candidate: { component: "tool", name: "direct-frame", description: "Summarize a public frame",
			program: { format: "task-pure-python-v1", source: "{'rows': len(input['grid']), 'columns': len(input['grid'][0]), 'first': input['grid'][0][0]}" } }, trial: { current_grid: true } }),
		null, action("ACTION2", ["skill:direct-steps@v1", "memory:direct-fact@v1", "system_prompt:direct-policy@v1"]),
		null, action("ACTION3", ["system_prompt:direct-policy@v2"]), null, action("ACTION4"),
	][request] ?? { kind: "text", text: "direct-use diagnostic complete" };
}
