import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTaskPython } from "../demo/pi_task_python.ts";
import { arcSkillFoundation, arcSkillGuestProgram, skillGuestProgram } from "../demo/arc_thin_skill_guest.ts";

const run = async (source: string, useFoundation = true) => (await evaluateTaskPython(arcSkillGuestProgram(), {
	mode: "run", source, state: {}, args: {},
	...(useFoundation ? { _foundation: arcSkillFoundation.version, _foundation_source: arcSkillFoundation.source } : {}),
})).value as any;

test("ARC foundation computes only explicit coordinate-set primitives", async () => {
	const result = await run([
		"def run(state, args):",
		"    points = [[3, 2], [2, 2], [9, 9], [3, 2]]",
		"    return {",
		"        'bbox': arc.bbox(points),",
		"        'translated': arc.translate(points, 1, -1),",
		"        'normalized': arc.normalize(points),",
		"        'components4': arc.components(points),",
		"        'components8': arc.components(points, 8),",
		"    }",
	].join("\n"));
	assert.deepEqual(result.value, {
		bbox: { min_x: 2, min_y: 2, max_x: 9, max_y: 9, width: 8, height: 8, count: 3 },
		translated: [[3, 1], [4, 1], [10, 8]],
		normalized: [[0, 0], [1, 0], [7, 7]],
		components4: [[[2, 2], [3, 2]], [[9, 9]]],
		components8: [[[2, 2], [3, 2]], [[9, 9]]],
	});
	assert.deepEqual(result.warnings, undefined);
});

test("ARC foundation is opt-in and does not add cross-frame or goal analysis", async () => {
	const generic = await evaluateTaskPython(skillGuestProgram(), {
		mode: "run", source: "def run(state, args):\n    return 'arc' in globals()", state: {}, args: {},
	});
	assert.equal((generic.value as any).value, false);
	const noFoundation = await run("def run(state, args):\n    return arc.bbox([[0, 0]])", false);
	assert.equal((noFoundation as any).ok, false);
	assert.match((noFoundation as any).error, /NameError/);
});
