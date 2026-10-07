import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installTaskLocalTools, type TaskToolAdapter } from "../demo/pi_task_local_tools.ts";
import { initializeParentTaskResourceBindingAuthorization } from "../demo/pi_task_resource_store.ts";
import { nativeHarnessExecutor } from "../demo/pi_task_harness_route_runtime.ts";

export default function taskToolFixture(pi: ExtensionAPI) {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	initializeParentTaskResourceBindingAuthorization(pi, root);
	let decisionCounter = 0;
	const decisions = join(root, "harness-decisions.jsonl");
	if (existsSync(decisions)) {
		for (const line of readFileSync(decisions, "utf8").split(/\r?\n/).filter(Boolean)) {
			try {
				const match = String(JSON.parse(line)?.decision_id ?? "").match(/(\d+)$/);
				if (match) decisionCounter = Math.max(decisionCounter, Number(match[1]));
			} catch {}
		}
	}
	const adapter: TaskToolAdapter = {
		adapterId: "fixture",
		permission: "fixture_echo_only",
		allowedImplementations: ["fixture.echo"],
		execute: async (implementationRef, input) => {
			if (implementationRef !== "fixture.echo") throw new Error("unsupported fixture implementation");
			return {
				content: [{ type: "text", text: `echo:${String(input.message ?? "")}` }],
				details: { implementation_ref: implementationRef, message: input.message ?? "" },
			};
		},
	};
	const dependencies = {
		root,
		append: (name, value) => appendFileSync(join(root, name), JSON.stringify(value) + "\n", "utf8"),
		allocateDecisionId: () => `decision-${++decisionCounter}`,
		resolveBasisRefs: (references) => references,
	};
	installTaskLocalTools(pi, dependencies, adapter);
	pi.registerTool({
		name: "task_tool_immutability_fixture",
		label: "Task tool immutability fixture",
		description: "Verify caller mutation, versioning, and reload of immutable task tool contracts.",
		parameters: Type.Object({}),
		async execute() {
			const writer = nativeHarnessExecutor(pi, "task_tool");
			if (!writer) throw new Error("task_tool is unavailable");
			const program: any = { format: "task-pure-expression-v1", limits: {}, expression: { op: "input" } };
			const inputSchema: any = { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false };
			const outputSchema: any = { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false };
			const created = await writer("immutability-v1", { action: "create", name: "immutable-pure",
				description: "Return the exact bounded input object.", input_schema: inputSchema,
				output_schema: outputSchema, program });
			program.expression = { op: "literal", value: { tampered: true } };
			program.limits.steps = 1;
			inputSchema.properties.value.type = "string";
			outputSchema.required.push("tampered");
			const afterMutation = readFileSync(join(root, "task-tools.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
			const v1 = afterMutation.find((record: any) => record.name === "immutable-pure" && record.version === 1);
			const updated = await writer("immutability-v2", { action: "update", name: "immutable-pure", target_version: 1,
				description: "Return a new explicit scalar version.",
				input_schema: { type: "object", properties: {}, additionalProperties: false },
				output_schema: { type: "number" },
				program: { format: "task-pure-expression-v1", limits: { steps: 10 }, expression: { op: "literal", value: 2 } } });
			const persisted = readFileSync(join(root, "task-tools.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
				.filter((record: any) => record.name === "immutable-pure");
			const fake: any = { tools: new Map<string, any>(), active: [] as string[],
				registerTool(definition: any) { this.tools.set(definition.name, definition); },
				getAllTools() { return [...this.tools.values()]; },
				getActiveTools() { return this.active; }, setActiveTools(names: string[]) { this.active = names; } };
			installTaskLocalTools(fake, dependencies, adapter);
			const reloaded = await fake.tools.get("task_tool").execute("inspect-reload", { action: "inspect", name: "immutable-pure" });
			const details = { created: created.details, updated: updated.details, v1_after_mutation: v1,
				persisted, reloaded: reloaded.details };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});
}
