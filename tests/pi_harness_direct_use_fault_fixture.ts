/** Fault injection around captured production executors, not autonomous behavior. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTaskLocalSelfHarness } from "../demo/pi_task_local_self_harness.ts";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { nativeHarnessExecutor, registerNativeHarnessExecutor } from "../demo/pi_task_harness_route_runtime.ts";
import nonArcSubagents from "./pi_non_arc_task_subagents.ts";

export default function fixture(pi: ExtensionAPI) {
	pi.registerTool({ name: "direct_use_fault", label: "Direct use fault", description: "Inject a diagnostic failure.",
		parameters: Type.Object({ phase: Type.String() }),
		async execute(_id, { phase }) {
			const previousRoot = process.env.PI_AUTORESEARCH_E2E_ROOT;
			const root = resolve(previousRoot!, `fault-${phase}`);
			mkdirSync(root, { recursive: true });
			process.env.PI_AUTORESEARCH_E2E_ROOT = root;
			try {
				const controller = new AbortController();
				const definitions = new Map<string, any>();
				const hooks = new Map<string, any>();
				let active: string[] = [], decisions = 0, childCalls = 0, writes = 0;
				const local: any = { registerTool: (d: any) => definitions.set(d.name, d),
					on: (name: string, fn: any) => hooks.set(name, fn), events: { on() {} },
					getAllTools: () => [...definitions.values()], getActiveTools: () => active,
					setActiveTools: (names: string[]) => { active = names; } };
				const rows = (name: string) => existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8")
					.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
				installTaskResourceReader(local, root);
				installTaskLocalSelfHarness(local, { root, readJsonl: rows, pendingAssessments: new Map(),
					allocateDecisionId: () => `decision-${++decisions}`,
					append: (name, value) => {
						appendFileSync(join(root, name), JSON.stringify(value) + "\n");
						if (phase === "run_after_publish" && name === "task-harness-assemblies.jsonl") controller.abort();
					} });
				let result: any, error: string | undefined;
				if (phase.startsWith("run_")) {
					nonArcSubagents(local);
					registerNativeHarnessExecutor(local, "delegate_task", () => {
						childCalls++; throw new Error("Unexpected child dispatch after cancellation");
					});
					if (phase === "run_before") controller.abort();
					try { result = await definitions.get("task_harness_create").execute("create", {
						candidate: { component: "subagent", name: "reader", description: "Read readiness",
							instructions: "Return readiness", tools: ["fixture_state"] }, run: { task: "Read readiness" },
					}, controller.signal); } catch (failure) { error = String(failure); }
				} else if (phase === "prompt_payload_failure") {
					await definitions.get("task_harness_create").execute("create", {
						candidate: { component: "system_prompt", name: "policy", content: "POLICY", scope: "task" } });
					try { hooks.get("before_provider_request")({ payload: { unsupported: true } }, {}); }
					catch (failure) { error = String(failure); }
				} else {
					const writer = nativeHarnessExecutor(local, "task_memory")!;
					registerNativeHarnessExecutor(local, "task_memory", async (id, input) => {
						writes++;
						if (phase === "partial" && writes === 2) return { isError: true, details: { reason: "injected write failure" } };
						const written = await writer(id, input);
						if (phase === "cancel_after_write") controller.abort();
						if (phase === "cas" && writes === 1) await definitions.get("task_harness").execute("concurrent-assembly", {
							action: "assemble", expected_assembly_revision: 0, selected_resource_refs: [], prompt_contributions: [],
							decision: { basis_refs: [], reason: "Concurrent parent selection", expected: "Keep an empty selection" } });
						return written;
					});
					if (phase === "cancel_before") controller.abort();
					try { result = await definitions.get("task_memory_pool").execute("capture", {
						action: "capture", select: true, items: [
							{ key: "a", content: "A", scope: "task" }, { key: "b", content: "B", scope: "task" }],
					}, controller.signal); } catch (failure) { error = String(failure); }
				}
				const details = { result, error, child_calls: childCalls, memory: rows("task-memory.jsonl"),
					roles: rows("task-subagents.jsonl"), assemblies: rows("task-harness-assemblies.jsonl"),
					prompt_projections: rows("task-system-prompt-assemblies.jsonl"), observations: rows("harness-observations.jsonl") };
				return { content: [{ type: "text", text: JSON.stringify(details) }], details };
			} finally {
				if (previousRoot === undefined) delete process.env.PI_AUTORESEARCH_E2E_ROOT;
				else process.env.PI_AUTORESEARCH_E2E_ROOT = previousRoot;
			}
		},
	});
}
