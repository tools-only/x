import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { registerManagementTool } from "../demo/pi_management_schema_surface.ts";

function fixture(root?: string, failure?: "throw" | "isError") {
	const base = resolve(".tmp/management-schema-tests"); mkdirSync(base, { recursive: true });
	root ??= mkdtempSync(join(base, "case-"));
	let current: any; let calls = 0;
	const pi = { registerTool: (tool: any) => { current = tool; } };
	const definition = { name: "task_harness", parameters: Type.Object({
		action: Type.String({ enum: ["contract", "summary", "review", "level_review"] }),
		topic: Type.Optional(Type.String()),
		review: Type.Optional(Type.Array(Type.Object({ reason: Type.String({ minLength: 1 }) }))),
		transition_analysis: Type.Optional(Type.Object({ observed_changes: Type.String() })),
		level_review: Type.Optional(Type.Object({ credits: Type.Array(Type.Object({
			verdict: Type.String({ enum: ["positive", "negative", "uncertain"] }) })) })),
	}), execute: async (_id: string, input: any) => {
		calls++; if (input.topic === "invalid") throw new Error("Unknown topic");
		if (failure === "throw") throw new Error("Contract handler failed");
		if (failure === "isError") return { isError: true, content: [{ type: "text", text: "Failed contract result" }] };
		return { content: [{ type: "text", text: JSON.stringify(input) }] };
	} };
	registerManagementTool(pi as any, root, definition);
	return { root, definition, pi, tool: () => current, calls: () => calls };
}

test("hidden legacy arguments remain validated before any handler effect", async () => {
	const f = fixture(); assert.equal(f.tool().parameters.properties.level_review, undefined);
	await assert.rejects(f.tool().execute("bad", { action: "level_review",
		level_review: { credits: [{ verdict: "invented" }] } }), /credits\/0\/verdict/);
	assert.equal(f.calls(), 0);
	await f.tool().execute("legacy", { action: "level_review", level_review: { credits: [{ verdict: "uncertain" }] } });
	assert.equal(f.calls(), 1);
	assert.equal(f.tool().parameters.properties.level_review, undefined);
});

test("successful contracts add only requested typed fields and survive later turns and reload", async () => {
	const f = fixture();
	await f.tool().execute("load", { action: "contract", topic: "review", schema_action: "review" });
	assert.deepEqual(f.tool().parameters.properties.review, f.definition.parameters.properties.review);
	assert.equal(f.tool().parameters.properties.level_review, undefined);
	await f.tool().execute("summary", { action: "summary" });
	const restored = fixture(f.root);
	assert.deepEqual(restored.tool().parameters.properties.review, f.definition.parameters.properties.review);
	await restored.tool().execute("load-level", { action: "contract", schema_action: "level_review" });
	assert.deepEqual(restored.tool().parameters.properties.level_review, f.definition.parameters.properties.level_review);
	await restored.tool().execute("reset", { action: "contract", schema_action: "core" });
	assert.equal(restored.tool().parameters.properties.review, undefined);
	assert.equal(fixture(f.root).tool().parameters.properties.level_review, undefined);
});

test("failed calls and invalid schema controls do not change disclosure or run handlers", async () => {
	const f = fixture();
	await assert.rejects(f.tool().execute("bad", { action: "summary", schema_action: "level_review" }), /only valid for contract/);
	assert.equal(f.calls(), 0);
	await assert.rejects(f.tool().execute("bad", { action: "contract", schema_action: "invented" }), /schema_action/);
	await assert.rejects(f.tool().execute("bad", { action: "contract", topic: "invalid" }), /Unknown topic/);
	assert.equal(f.tool().parameters.properties.review, undefined);
});

test("profile restoration rejects records copied from a different task root", async () => {
	const first = fixture(); await first.tool().execute("load", { action: "contract", topic: "review", schema_action: "review" });
	const other = fixture();
	writeFileSync(join(other.root, "management-schema-profiles.jsonl"), readFileSync(join(first.root, "management-schema-profiles.jsonl")));
	assert.throws(() => fixture(other.root), /task (scope|root) mismatch/);
});

test("bare static review and induction reads preserve the core schema and create no profile state", async () => {
	const f = fixture(), initial = structuredClone(f.tool().parameters);
	for (const topic of ["review", "induction"]) {
		const args = { action: "contract", topic };
		const result = await f.tool().execute(`read-${topic}`, args);
		assert.deepEqual(JSON.parse(result.content[0].text), args, "the original handler receives the same manual request");
		assert.deepEqual(f.tool().parameters, initial, "reading a static manual does not opt in to typed submission fields");
		assert.equal(existsSync(join(f.root, "management-schema-profiles.jsonl")), false);
	}
	await f.tool().execute("summary", { action: "summary" });
	assert.deepEqual(fixture(f.root).tool().parameters, initial, "a bare read does not become a persistent profile on reload");
});

test("explicit review aliases load once and bare reads preserve that choice until core reset", async () => {
	for (const schema_action of ["review", "capability_review"]) {
		const f = fixture();
		const result = await f.tool().execute("load-explicit", { action: "contract", topic: "induction", schema_action });
		assert.deepEqual(JSON.parse(result.content[0].text), { action: "contract", topic: "review" }, "the existing alias route still returns review instructions");
		assert.deepEqual(f.tool().parameters.properties.review, f.definition.parameters.properties.review);
		assert.deepEqual(f.tool().parameters.properties.transition_analysis, f.definition.parameters.properties.transition_analysis);
		assert.equal(f.tool().parameters.properties.level_review, undefined);
		const path = join(f.root, "management-schema-profiles.jsonl"), loadedState = readFileSync(path, "utf8");
		for (const topic of ["review", "induction"]) await f.tool().execute(`bare-${topic}`, { action: "contract", topic });
		assert.equal(readFileSync(path, "utf8"), loadedState, "a bare read neither expands nor clears an explicit choice");
		const resumed = fixture(f.root);
		assert.deepEqual(resumed.tool().parameters, f.tool().parameters);
		await resumed.tool().execute("core", { action: "contract", schema_action: "core" });
		assert.equal(resumed.tool().parameters.properties.review, undefined);
		await resumed.tool().execute("bare-after-reset", { action: "contract", topic: "review" });
		assert.equal(fixture(f.root).tool().parameters.properties.review, undefined);
	}
});

test("dynamic opportunity and level-review contracts keep their existing implicit typed disclosure", async () => {
	for (const [topic, visible, hidden] of [["opportunity", "review", "level_review"], ["level_review", "level_review", "review"]]) {
		const f = fixture(), args = { action: "contract", topic };
		const result = await f.tool().execute("dynamic-contract", args);
		assert.deepEqual(JSON.parse(result.content[0].text), args);
		assert.deepEqual(f.tool().parameters.properties[visible], f.definition.parameters.properties[visible]);
		assert.equal(f.tool().parameters.properties[hidden], undefined);
		assert.deepEqual(fixture(f.root).tool().parameters, f.tool().parameters);
	}
});

test("failed explicit contract loads never create persistent profile state", async () => {
	for (const failure of ["throw", "isError"] as const) {
		const f = fixture(undefined, failure), initial = structuredClone(f.tool().parameters);
		const load = f.tool().execute("failed-load", { action: "contract", schema_action: "review" });
		if (failure === "throw") await assert.rejects(load, /Contract handler failed/);
		else assert.equal((await load).isError, true);
		assert.deepEqual(f.tool().parameters, initial);
		assert.equal(existsSync(join(f.root, "management-schema-profiles.jsonl")), false);
		assert.deepEqual(fixture(f.root).tool().parameters, initial);
	}
});

test("bare reads preserve full hidden-field validation without implicitly loading those fields", async () => {
	const f = fixture();
	await f.tool().execute("bare-read", { action: "contract", topic: "review" });
	const callsAfterRead = f.calls();
	await assert.rejects(f.tool().execute("invalid-hidden-review", { action: "review", review: [{ reason: "" }] }), /review\/0\/reason/);
	assert.equal(f.calls(), callsAfterRead);
	await f.tool().execute("valid-hidden-review", { action: "review", review: [{ reason: "Valid canonical legacy request" }], transition_analysis: { observed_changes: "The input remains fully validated" } });
	assert.equal(f.calls(), callsAfterRead + 1);
	assert.equal(f.tool().parameters.properties.review, undefined);
	assert.equal(existsSync(join(f.root, "management-schema-profiles.jsonl")), false);
});

test("Auto-Research legacy contract and full-schema override retain their original disclosure", async () => {
	const base = resolve(".tmp/management-schema-tests");
	const root = mkdtempSync(join(base, "auto-"));
	let current: any;
	const definition = { name: "auto_research", parameters: Type.Object({ action: Type.String(), plan: Type.Optional(Type.Object({ goal: Type.String() })) }),
		execute: async (_id: string, input: any) => ({ content: [{ type: "text", text: JSON.stringify(input) }] }) };
	const pi: any = { registerTool(tool: any) { current = tool; } };
	registerManagementTool(pi, root, definition);
	assert.equal(current.parameters.properties.plan, undefined);
	await current.execute("auto-contract", { action: "contract" });
	assert.deepEqual(current.parameters.properties.plan, definition.parameters.properties.plan);
	registerManagementTool(pi, root, definition);
	assert.deepEqual(current.parameters.properties.plan, definition.parameters.properties.plan);
	await current.execute("auto-core", { action: "contract", schema_action: "core" });
	assert.equal(current.parameters.properties.plan, undefined);

	const originalMode = process.env.PI_MANAGEMENT_SCHEMA;
	try {
		process.env.PI_MANAGEMENT_SCHEMA = "full";
		const f = fixture();
		assert.deepEqual(f.tool().parameters, f.definition.parameters);
		await f.tool().execute("full-bare-review", { action: "contract", topic: "review" });
		assert.deepEqual(f.tool().parameters, f.definition.parameters);
		assert.equal(existsSync(join(f.root, "management-schema-profiles.jsonl")), false);
	} finally {
		if (originalMode === undefined) delete process.env.PI_MANAGEMENT_SCHEMA;
		else process.env.PI_MANAGEMENT_SCHEMA = originalMode;
	}
});
