import { test } from "node:test";
import assert from "node:assert/strict";
import { arcBatchDeltaStopReason } from "../demo/pi_arc_batch_guard.ts";

test("an unguarded ARC batch keeps its established behavior", () => {
	assert.equal(arcBatchDeltaStopReason({ changed_cells: 0 }, undefined, 0), null);
	assert.equal(arcBatchDeltaStopReason(undefined, undefined, 1), null);
});

test("a parent-selected threshold stops after the first observed low-change action", () => {
	const deltas = [52, 2, 2, 2];
	const committed: number[] = [];
	let stopped: string | null = null;
	for (const [index, count] of deltas.entries()) {
		committed.push(index);
		stopped = arcBatchDeltaStopReason({ changed_cells: count }, 2, index);
		if (stopped) break;
	}
	assert.deepEqual(committed, [0, 1]);
	assert.equal(stopped, "changed_cells_lte_2:action_1:observed_2");
	assert.equal(arcBatchDeltaStopReason({ changed_cells: 0 }, 0, 0), "changed_cells_lte_0:action_0:observed_0");
	assert.equal(arcBatchDeltaStopReason({ changed_cells: 3 }, 2, 0), null);
});

test("unknown public delta stops a guarded batch and invalid thresholds fail before actions", () => {
	for (const delta of [undefined, {}, { changed_cells: -1 }, { changed_cells: "2" }, { changed_cells: 4097 }])
		assert.equal(arcBatchDeltaStopReason(delta, 2, 3), "changed_cells_unavailable:action_3");
	for (const threshold of [-1, 4097, 1.5, Number.NaN])
		assert.throws(() => arcBatchDeltaStopReason(undefined, threshold, 0), /integer in 0\.\.4096/);
});
