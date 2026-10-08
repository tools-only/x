/** Test-only cancellation fault injection around the actual create executor. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installTaskLocalSelfHarness } from "../demo/pi_task_local_self_harness.ts";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { registerArcObservationSnapshot } from "../demo/pi_arc_observation_snapshot.ts";

function capturedPi(): any {
	const tools = new Map<string, any>();
	let active: string[] = [];
	return {
		tools,
		registerTool(definition: any) { tools.set(definition.name, definition); },
		on() {},
		getAllTools() { return [...tools.values()]; },
		getActiveTools() { return active; },
		setActiveTools(names: string[]) { active = names; },
	};
}

export default function cancellationFixture(pi: ExtensionAPI) {
	pi.registerTool({
		name: "binding_schema_cancellation_fixture",
		label: "Binding schema cancellation fixture",
		description: "Cancel an actual captured publication executor before or during host preparation.",
		parameters: Type.Object({ phase: Type.Union([Type.Literal("before"), Type.Literal("during_prepare")]), current_grid: Type.Optional(Type.Boolean()) }),
		async execute(_toolCallId, params) {
			const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".", `cancel-${params.phase}`);
			fs.mkdirSync(root, { recursive: true });
			const localPi = capturedPi();
			installTaskResourceReader(localPi, root);
			let decision = 0;
			installTaskLocalSelfHarness(localPi, {
				root,
				append: (name, value) => fs.appendFileSync(join(root, name), JSON.stringify(value) + "\n", "utf8"),
				readJsonl: name => fs.existsSync(join(root, name))
					? fs.readFileSync(join(root, name), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [],
				allocateDecisionId: () => `decision-${++decision}`,
				getObservation: () => undefined,
				pendingAssessments: new Map(),
			});
			await localPi.tools.get("task_harness").execute("read-creator", { action: "read_method", method_name: "tool-creator" });
			const snapshot = registerArcObservationSnapshot(root, {
				game_id: "g", state: "PLAYING", levels_completed: 0, win_levels: 1, guid: "id", full_reset: false,
				available_actions: ["ACTION1"], agent_available_actions: ["ACTION1"], frames: [[[0, 2], [3, 4]]],
				action_budget: { used: 0, maximum: 10, total_used: 0, total_maximum: 10, level: 0, baseline_actions: [5], multiplier: 2 },
			});
			const field = (name: string) => ({ op: "get", value: { op: "input" }, key: { op: "literal", value: name } });
			const request = {
				candidate: { component: "tool", name: "cancel-bound-check", description: "Compare a bound observation value.",
					input_schema: { type: "object", properties: { expected: { type: "number" } }, required: ["expected"], additionalProperties: false },
					output_schema: { type: "boolean" },
					program: { format: "task-pure-expression-v1", limits: {}, expression: { op: "eq", left: field(params.current_grid ? "grid" : "pixel"), right: field("expected") } } },
				assembly: { expected_assembly_revision: 0, selected_resource_refs: [], prompt_contributions: [] },
				trial: params.current_grid ? { parameters: { expected: 2 }, current_grid: true }
					: { parameters: { expected: 2 }, bindings: [{ name: "pixel", ref: snapshot.ref, path: ["public_state", "frames", "0", "0", "1"] }] },
			};
			const originalRequest = JSON.stringify(request);
			const controller = new AbortController();
			if (params.phase === "before") controller.abort();
			const snapshotPath = join(root, "observation-snapshots.jsonl");
			const originalRead = fs.readFileSync;
			let snapshotReads = 0;
			let error: Record<string, any> | undefined;
			try {
				// Abort on a real host read, then let synchronous preparation return.
				// This exercises the post-preparation check without changing runtime APIs.
				fs.readFileSync = ((...args: any[]) => {
					const value = Reflect.apply(originalRead, fs, args);
					if (typeof args[0] === "string" && resolve(args[0]) === snapshotPath) {
						snapshotReads += 1;
						if (params.phase === "during_prepare") controller.abort();
					}
					return value;
				}) as typeof fs.readFileSync;
				syncBuiltinESMExports();
				try { await localPi.tools.get("task_harness_create").execute("cancel-create", request, controller.signal); }
				catch (failure) { error = JSON.parse((failure as Error).message); }
			} finally {
				fs.readFileSync = originalRead;
				syncBuiltinESMExports();
			}
			const componentFiles = ["task-tools.jsonl", "task-tool-events.jsonl", "task-harness-assemblies.jsonl", "task-harness-create-normalizations.jsonl"];
			const details = { phase: params.phase, aborted: controller.signal.aborted, snapshot_reads: snapshotReads,
				error: error ?? null, request_unchanged: JSON.stringify(request) === originalRequest,
				written_files: componentFiles.filter(name => fs.existsSync(join(root, name)) && fs.statSync(join(root, name)).size > 0) };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});
}
