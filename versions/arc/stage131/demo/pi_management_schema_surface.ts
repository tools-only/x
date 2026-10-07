/** Task-local typed disclosure. Execution always validates the complete API. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { assertTaskRecordScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";

const profiles: Record<string, Record<string, string[]>> = {
	task_harness: { review: ["review", "transition_analysis"], level_review: ["level_review"] },
	auto_research: { enqueue: ["plan"] },
};

export function managementSchemaSurface(schema: any, name: string, loaded: Iterable<string> = []) {
	const groups = profiles[name];
	if (!groups) return schema;
	const hidden = new Set(Object.values(groups).flat());
	for (const group of loaded) for (const field of groups[group] ?? []) hidden.delete(field);
	// Preserve TypeBox metadata, defaults and all constraints on retained fields.
	return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties)
		.filter(([field]) => !hidden.has(field))),
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
	async function execute(toolCallId: string, input: Record<string, any>, ...rest: any[]) {
		// The SDK validates displayed fields. Validate hidden legacy fields too,
		// with the same conversion semantics before any write or child launch.
		const params = Value.Convert(canonical, structuredClone(input)) as Record<string, any>;
		if (!Value.Check(canonical, params)) {
			const errors = [...Value.Errors(canonical, params)].slice(0, 8)
				.map(error => `${error.instancePath}: ${error.message}`).join("; ");
			throw new Error(`Invalid ${definition.name} arguments: ${errors}`);
		}
		if (params.schema_action !== undefined && params.action !== "contract")
			throw new Error("schema_action is only valid for contract");
		const request = requestedProfiles(definition.name, params);
		const forwarded = { ...params };
		delete forwarded.schema_action;
		if (definition.name === "task_harness" && params.action === "contract" && params.schema_action
			&& params.schema_action !== "core") {
			forwarded.topic = params.schema_action === "capability_review" ? "review" : params.schema_action;
		}
		const result = await definition.execute(toolCallId, forwarded, ...rest);
		if (request !== undefined && !result?.isError) {
			const next = params.schema_action === "core" ? new Set<string>() : new Set([...loaded, ...request]);
			if (JSON.stringify([...next].sort()) !== JSON.stringify([...loaded].sort())) {
				loaded = next;
				appendFileSync(join(root, "management-schema-profiles.jsonl"), JSON.stringify(stampTaskRecord(scope,
					{ tool: definition.name, profiles: [...loaded].sort(), toolCallId, recordedAt: new Date().toISOString() })) + "\n");
				register(); // Pi public API refreshes active definitions for the next provider turn.
			}
		}
		return result;
	}
	register();
}
