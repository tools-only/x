/**
 * Diagnostic: the thin harness binds run_skill to the skill registry
 * (docs/plans/2026-10-09-thin-skill-call-binding.md). A fake ExtensionAPI
 * records registrations and setActiveTools; skills are saved through the real
 * skill tool and syntax-checked by the real sandbox. Pi's own schema
 * validation and request assembly are covered by the arc-thin smoke.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import arcThinExtension from "../demo/arc_thin_extension.ts";

const SOURCE = "def run(state, args):\n    return 1\n";

// These skill cases need an observed action scope; a failed /state no longer exposes arc_action.
mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
	state: "PLAYING", agent_available_actions: ["ACTION1"],
}), { status: 200, headers: { "content-type": "application/json" } }));

function load(root: string, variant = "treatment") {
	process.env.ARC_RUN_ROOT = root;
	process.env.ARC_THIN_VARIANT = variant;
	process.env.PI_ARC_BRIDGE_URL = "http://skill-surface-fixture.invalid";
	delete process.env.ARC_HARNESS_BOARD;
	// The ledger and critic are on by default; this diagnostic is about the skill surface alone.
	process.env.ARC_HARNESS_LEDGER = "disabled";
	process.env.ARC_HARNESS_CRITIC = "disabled";
	const tools = new Map<string, any>();
	const handlers = new Map<string, (...args: any[]) => any>();
	let active: string[] = [];
	let runSkillRegistrations = 0;
	arcThinExtension({
		registerTool(tool: any) { tools.set(tool.name, tool); if (tool.name === "run_skill") runSkillRegistrations += 1; },
		setActiveTools(names: string[]) { active = names.filter((name) => tools.has(name)); },
		getActiveTools: () => active.slice(),
		on(event: string, handler: (...args: any[]) => any) { handlers.set(event, handler); },
		getThinkingLevel: () => "off",
	} as any);
	const h = {
		tools, active: () => active, registrations: () => runSkillRegistrations,
		enumOf: () => tools.get("run_skill")?.parameters.properties.name.enum as string[] | undefined,
		start: () => handlers.get("session_start")!({}, {}),
		decide: (prompt = "Decide the next action.") => handlers.get("before_agent_start")!({ prompt }, {}),
		skill: async (params: Record<string, unknown>) =>
			(await tools.get("skill").execute("call", params, undefined, undefined, {})).content[0].text as string,
	};
	return h;
}

test("empty store: no run_skill until a skill is saved", async () => {
	const h = load(mkdtempSync(join(tmpdir(), "thin-surface-")));
	assert.equal(h.tools.has("run_skill"), false);
	await h.start();
	await h.decide();
	assert.deepEqual(h.active(), ["arc_action", "memory", "skill"]);
	await h.decide("CONSOLIDATE: review");
	assert.deepEqual(h.active(), ["memory", "skill", "prompt", "ask_analyst"]);
});

test("low-frequency schemas load on review, while the ordinary action surface stays core-only", async () => {
	const h = load(mkdtempSync(join(tmpdir(), "thin-staged-surface-")));
	await h.start();
	await h.decide();
	assert.deepEqual(h.active(), ["arc_action", "memory", "skill"]);
	assert.ok(!h.active().includes("prompt") && !h.active().includes("ask_analyst"));
	await h.decide("CONSOLIDATE: review");
	assert.deepEqual(h.active(), ["memory", "skill", "prompt", "ask_analyst"]);
});

test("save, re-save and delete keep run_skill bound to exactly the saved names", async () => {
	const root = mkdtempSync(join(tmpdir(), "thin-surface-"));
	const h = load(root);
	await h.start();
	await h.decide();
	const first = await h.skill({ op: "set", name: "count_color", source: SOURCE });
	assert.match(first, /^skill set count_color v1 \(syntax ok\); run_skill\(name="count_color"\) is callable from your next step\non the current state with args=\{\} it (returns|fails): /);
	assert.deepEqual(h.enumOf(), ["count_color"]);
	assert.ok(h.active().includes("run_skill") && h.active().includes("arc_action"));

	await h.skill({ op: "set", name: "a_probe", source: SOURCE });
	assert.deepEqual(h.enumOf(), ["a_probe", "count_color"]);
	const registrations = h.registrations();
	await h.skill({ op: "set", name: "count_color", source: SOURCE });
	assert.equal(h.registrations(), registrations, "re-saving a name does not change the schema");

	const stale = h.tools.get("run_skill");
	const deleted = await h.skill({ op: "delete", name: "a_probe" });
	assert.match(deleted, /run_skill\(name="a_probe"\) is no longer callable$/);
	assert.deepEqual(h.enumOf(), ["count_color"]);
	// Defense in depth: a call validated against the old schema is still refused at execute time.
	await assert.rejects(stale.execute("call", { name: "a_probe" }, undefined, undefined, {}), /no skill 'a_probe'/);

	await h.skill({ op: "delete", name: "count_color" });
	assert.equal(h.active().includes("run_skill"), false);
	await h.decide();
	assert.equal(h.active().includes("run_skill"), false);

	await h.skill({ op: "set", name: "count_color", source: SOURCE });
	assert.deepEqual(h.enumOf(), ["count_color"]);
	assert.ok(h.active().includes("run_skill"));
	await h.decide("CONSOLIDATE: review");
	assert.deepEqual(h.active(), ["memory", "skill", "prompt", "ask_analyst", "run_skill"]);

	const surface = readFileSync(join(root, "harness", "skill_surface.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(surface.map((row) => row.names), [[], ["count_color"], ["a_probe", "count_color"], ["count_color"], [], ["count_color"]]);
});

test("replay binds run_skill to the stored names", async () => {
	const root = mkdtempSync(join(tmpdir(), "thin-surface-"));
	const first = load(root);
	await first.start();
	await first.decide();
	await first.skill({ op: "set", name: "count_color", source: SOURCE });
	await first.skill({ op: "set", name: "gone", source: SOURCE });
	await first.skill({ op: "delete", name: "gone" });

	const again = load(root);
	assert.deepEqual(again.enumOf(), ["count_color"], "registered at load from skills.jsonl");
	await again.start();
	assert.ok(again.active().includes("run_skill"));
	await again.decide();
	assert.deepEqual(again.active(), ["arc_action", "memory", "skill", "run_skill"]);
});

test("control variant never exposes skills", async () => {
	const h = load(mkdtempSync(join(tmpdir(), "thin-surface-")), "control");
	await h.start();
	await h.decide();
	assert.deepEqual(h.active(), ["arc_action"]);
	assert.equal(h.tools.has("run_skill"), false);
});
