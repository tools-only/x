/** Task-local typed disclosure. Execution always validates the complete API. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { compactToolSchema } from "./pi_compact_tool_schema.ts";
import { controlError } from "./pi_harness_control.ts";
import { assertTaskRecordScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";

const profiles: Record<string, Record<string, { fields: string[]; actions: string[]; releaseOn?: string[] }>> = {
	task_harness: {
		review: { fields: ["review", "transition_analysis", "review_reason", "resume_condition"],
			actions: ["review", "capability_review", "defer_review"],
			releaseOn: ["review", "capability_review", "defer_review"] },
		level_review: { fields: ["level_review", "boundary_ref", "reset_reason"],
			actions: ["level_review", "report_level_reset"], releaseOn: ["level_review"] },
	},
	auto_research: { enqueue: { fields: ["plan", "plan_ref", "node_id"],
		actions: ["enqueue", "inspect_plan", "release"] } },
};

export function managementSchemaSurface(schema: any, name: string, loaded: Iterable<string> = []) {
	const groups = profiles[name];
	if (!groups) return schema;
	const hidden = new Set(Object.values(groups).flatMap(group => group.fields));
	const hiddenActions = new Set(Object.values(groups).flatMap(group => group.actions));
	for (const group of loaded) {
		for (const field of groups[group]?.fields ?? []) hidden.delete(field);
		for (const action of groups[group]?.actions ?? []) hiddenActions.delete(action);
	}
	const properties: Record<string, any> = Object.fromEntries(Object.entries(schema.properties)
		.filter(([field]) => !hidden.has(field)));
	const action = properties.action;
	if (Array.isArray(action?.enum)) {
		properties.action = { ...action, enum: action.enum.filter((value: string) => !hiddenActions.has(value)) };
	} else if (Array.isArray(action?.anyOf)) {
		properties.action = compactToolSchema({ ...action,
			anyOf: action.anyOf.filter((branch: any) => !hiddenActions.has(branch.const)) });
	}
	// Preserve TypeBox metadata, defaults and all constraints on retained fields.
	return { ...schema, properties,
		required: (schema.required ?? []).filter((field: string) => !hidden.has(field)) };
}

function requestedProfiles(name: string, params: Record<string, any>): string[] | undefined {
	if (params.action !== "contract") return;
	if (params.schema_action === "core") return [];
	if (name === "auto_research") return ["enqueue"]; // Legacy contract also describes plans.
	// Reading a static manual is not an opt-in to advanced submission fields.
	if (name === "task_harness" && params.schema_action === undefined
		&& ["review", "induction"].includes(params.topic)) return;
	const topic = params.schema_action ?? params.topic;
	if (["review", "capability_review", "opportunity", "induction"].includes(topic)) return ["review"];
	if (topic === "level_review") return ["level_review"];
}

export function registerManagementTool(pi: ExtensionAPI, root: string, definition: any) {
	const groups = profiles[definition.name];
	if (!groups || process.env.PI_MANAGEMENT_SCHEMA === "full") {
		pi.registerTool(definition);
		return;
	}
	const scope = ensureTaskScope(root);
	const path = join(root, "management-schema-profiles.jsonl");
	const records = (existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [])
		.map(line => { const row = JSON.parse(line); assertTaskRecordScope(scope, row, path); return row; })
		.filter(row => row.tool === definition.name);
	let loaded = new Set<string>((records.at(-1)?.profiles ?? []).filter((p: string) => p in groups));
	const schemaAction = Type.Optional(Type.String({ enum: ["core", ...Object.keys(groups),
		...(definition.name === "task_harness" ? ["capability_review"] : [])],
		description: "contract only: load typed advanced fields; core restores the common surface." }));
	const canonical = { ...definition.parameters,
		properties: { ...definition.parameters.properties, schema_action: schemaAction } };
	const register = () => pi.registerTool({ ...definition,
		parameters: managementSchemaSurface(canonical, definition.name, loaded),
		execute });
	const setProfiles = (next: Set<string>, toolCallId: string) => {
		if (JSON.stringify([...next].sort()) === JSON.stringify([...loaded].sort())) return;
		loaded = next;
		appendFileSync(path, JSON.stringify(stampTaskRecord(scope,
			{ tool: definition.name, profiles: [...loaded].sort(), toolCallId, recordedAt: new Date().toISOString() })) + "\n");
		register();
	};
	async function execute(toolCallId: string, input: Record<string, any>, ...rest: any[]) {
		// The SDK validates displayed fields. Validate hidden legacy fields too,
		// with the same conversion semantics before any write or child launch.
		const reject = (message: string, path = "input"): never => controlError("rejected_input", [{ path, message }], {
			phase: "preflight", no_component_written: true, retryable: false, required_next_call: undefined,
			recovery_hint: "This submission ended before the handler ran. Correct the input if useful, or continue the task.",
		});
		let params: Record<string, any>;
		try { params = Value.Convert(canonical, structuredClone(input)) as Record<string, any>; }
		catch (error) { reject(`Invalid ${definition.name} arguments: ${error instanceof Error ? error.message : String(error)}`); }
		if (!Value.Check(canonical, params)) {
			const errors = [...Value.Errors(canonical, params)].slice(0, 8)
				.map(error => `${error.instancePath}: ${error.message}`).join("; ");
			reject(`Invalid ${definition.name} arguments: ${errors}`);
		}
		if (params.schema_action !== undefined && params.action !== "contract")
			reject("schema_action is only valid for contract", "schema_action");
		const request = requestedProfiles(definition.name, params);
		const forwarded = { ...params };
		delete forwarded.schema_action;
		if (definition.name === "task_harness" && params.action === "contract" && params.schema_action
			&& params.schema_action !== "core") {
			forwarded.topic = params.schema_action === "capability_review" ? "review" : params.schema_action;
		}
		const result = await definition.execute(toolCallId, forwarded, ...rest);
		const released = Object.entries(groups)
			.filter(([group, profile]) => loaded.has(group) && profile.releaseOn?.includes(params.action))
			.map(([group]) => group);
		if ((request !== undefined || released.length) && !result?.isError) {
			const next = params.schema_action === "core" ? new Set<string>() : new Set([...loaded, ...(request ?? [])]);
			// A completed review no longer needs a resident submission contract.
			// Failed/partial execution keeps it for repair; live plans keep theirs.
			for (const group of released) next.delete(group);
			setProfiles(next, toolCallId);
		}
		return result;
	}
	register();
	// The owning runtime releases a finished lifecycle on its existing mutation
	// boundary; no per-provider scan or additional model action is required.
	return (profile: string, toolCallId: string) => {
		if (!loaded.has(profile)) return;
		const next = new Set(loaded);
		next.delete(profile);
		setProfiles(next, toolCallId);
	};
}
