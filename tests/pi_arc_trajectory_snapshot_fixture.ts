import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installArcTrajectoryResource } from "../demo/pi_arc_trajectory_resource.ts";
import { loadArcTrajectorySnapshot, publishArcTrajectorySnapshot } from "../demo/pi_arc_trajectory_snapshot.ts";
import { installTaskResourceReader, resolveTaskResource } from "../demo/pi_task_resource_store.ts";

const root = mkdtempSync(join(tmpdir(), "arc-trajectory-snapshot-"));
const otherRoot = mkdtempSync(join(tmpdir(), "arc-trajectory-other-"));
process.env.PI_AUTORESEARCH_TASK_ID = "trajectory-test";
const transition = (n: number, changed = 0, level = 0) => ({
	action_id: `arc-action-${n}`, action: "ACTION6", coordinates: { x: n, y: 4 },
	state_before: "NOT_FINISHED", state_after: "NOT_FINISHED",
	level_before: n === 3 ? 0 : level, level_after: level,
	level_changed: n === 3, changed_cells: changed, bbox: changed ? { top: 1, left: 1, bottom: 2, right: 2 } : null,
});
let source = [transition(1), transition(2), transition(3, 4, 1)];
let publicationReads = 0;
const publish = () => publishArcTrajectorySnapshot(root, async () => {
	publicationReads += 1;
	return { projection: "transitions", items: source,
		summary: { actions_available: source.length, latest_action_id: source.at(-1)?.action_id ?? null },
		canonical_source: "bridge-events.jsonl" };
});
const first = await publish();
assert.equal(publicationReads, 1);
assert.equal(first.record.action_cutoff, "arc-action-3");
assert.deepEqual(resolveTaskResource(root, first.ref).transitions[0].coordinates, { x: 1, y: 4 });
assert.throws(() => resolveTaskResource(otherRoot, first.ref), /unknown task-local resource version/);

let installed: any;
installArcTrajectoryResource({ registerTool(tool: any) { installed = tool; } } as any, true);
const previousRoot = process.env.PI_AUTORESEARCH_E2E_ROOT;
const previousChild = process.env.PI_TASK_CHILD;
const previousRef = process.env.PI_TASK_CHILD_TRAJECTORY_REF;
const previousBridge = process.env.PI_ARC_BRIDGE_URL;
const previousFetch = globalThis.fetch;
try {
	process.env.PI_TASK_CHILD = "1";
	process.env.PI_AUTORESEARCH_E2E_ROOT = root;
	process.env.PI_TASK_CHILD_TRAJECTORY_REF = first.ref;
	delete process.env.PI_ARC_BRIDGE_URL;
	globalThis.fetch = (async () => { throw new Error("child contacted bridge"); }) as typeof fetch;
	const firstRead = (await installed.execute("read-1", { projection: "transitions", last_n: 2 })).details;
	assert.deepEqual(firstRead.items.map((item: any) => item.action_id), ["arc-action-2", "arc-action-3"]);
	assert.equal(firstRead.summary.actions_available, 3);
	assert.equal(firstRead.action_cutoff, "arc-action-3");
	assert.deepEqual(firstRead.history_access.read, {
		tool: "task_resource", action: "read", ref: first.ref, offset: 0, limit: 2000,
	});
	assert.equal(firstRead.items[1].changed_cells, 4);
	assert.deepEqual(firstRead.items[1].coordinates, { x: 3, y: 4 });
	const repeated = (await installed.execute("read-2", { projection: "repeated_actions", last_n: 3 })).details;
	assert.equal(repeated.items[0].count, 2);
	assert.equal(repeated.items[0].end_action_id, "arc-action-2");
	const levels = (await installed.execute("read-3", { projection: "level_boundaries", last_n: 3 })).details;
	assert.deepEqual(levels.items.map((item: any) => item.action_id), ["arc-action-3"]);
	await assert.rejects(installed.execute("too-wide", { projection: "transitions", last_n: 257 }), /between 1 and 256/);

	// A later parent action and child continuation retain the exact same cutoff.
	source = [...source, transition(4, 9, 1)];
	const second = await publish();
	assert.equal(second.record.action_cutoff, "arc-action-4");
	const continued = (await installed.execute("continued", { projection: "transitions" })).details;
	assert.equal(continued.summary.actions_available, 3);
	assert.equal(continued.action_cutoff, "arc-action-3");
	assert.equal(loadArcTrajectorySnapshot(root, first.ref).source_count, 3);
	process.env.PI_TASK_CHILD_TRAJECTORY_REF = second.ref;
	const newChild = (await installed.execute("new-child", { projection: "transitions" })).details;
	assert.equal(newChild.summary.actions_available, 4);
	assert.equal(newChild.action_cutoff, "arc-action-4");
	process.env.PI_TASK_CHILD_TRAJECTORY_REF = first.ref;
	process.env.PI_AUTORESEARCH_E2E_ROOT = otherRoot;
	await assert.rejects(installed.execute("other-task", { projection: "transitions" }), /unknown task-local resource version/);
	process.env.PI_AUTORESEARCH_E2E_ROOT = root;
	source = Array.from({ length: 300 }, (_, index) => transition(index + 1));
	const long = await publish();
	process.env.PI_TASK_CHILD_TRAJECTORY_REF = long.ref;
	const bounded = (await installed.execute("bounded", { projection: "transitions", last_n: 256 })).details;
	assert.equal(bounded.items.length, 256);
	assert.equal(bounded.items[0].action_id, "arc-action-45");
	assert.equal(bounded.summary.actions_available, 300);
	assert.equal(bounded.history_access.older_actions_outside_view, 44);
	const childTools = new Map<string, any>();
	const childPi = { on() {}, registerTool(tool: any) { childTools.set(tool.name, tool); } } as any;
	installTaskResourceReader(childPi, root, [long.ref]);
	const reader = childTools.get("task_resource");
	let offset = 0, exact = "";
	while (true) {
		const page = (await reader.execute("page", { action: "read", ref: long.ref, offset, limit: 2000 })).details;
		exact += page.text;
		if (page.next_offset === null) break;
		offset = page.next_offset;
	}
	assert.equal(JSON.parse(exact).transitions[0].action_id, "arc-action-1");
	await assert.rejects(reader.execute("ungranted", { action: "read", ref: second.ref }), /not granted/);
	const wildcardTools = new Map<string, any>();
	installTaskResourceReader({ on() {}, registerTool(tool: any) { wildcardTools.set(tool.name, tool); } } as any,
		root, ["arc_trajectory_snapshot:*"]);
	await assert.rejects(wildcardTools.get("task_resource").execute("wildcard", {
		action: "read", ref: long.ref,
	}), /not granted/);
} finally {
	globalThis.fetch = previousFetch;
	for (const [name, value] of [
		["PI_AUTORESEARCH_E2E_ROOT", previousRoot], ["PI_TASK_CHILD", previousChild],
		["PI_TASK_CHILD_TRAJECTORY_REF", previousRef], ["PI_ARC_BRIDGE_URL", previousBridge],
	] as const) {
		if (value === undefined) delete process.env[name]; else process.env[name] = value;
	}
}
console.log("arc trajectory snapshot fixture passed");
