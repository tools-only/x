import { test } from "node:test";
import assert from "node:assert/strict";
import * as review from "../demo/pi_harness_review.ts";
const actions = Array.from({ length: 15 }, (_, i) => ({ tool_name: "arc_action", observation_id: `o${i + 1}` }));
test("manual old-window deferral is reused; explicit timed intent and new windows remain", () => {
    const events = [{ window_id: "arc-pattern-5", status: "deferred", resume_condition: { kind: "manual" },
        parent_reason: "No actionable old evidence" },
        { window_id: "arc-pattern-10", status: "deferred", resume_condition: { kind: "after_actions" }, resume_after_action_count: 15 }];
    const queue = review.periodicReviewQueue(actions, [], events);
    assert.deepEqual(queue.due.map(w => w.window_id), ["arc-pattern-10", "arc-pattern-15"]);
    assert.equal(queue.deferred[0].window_id, "arc-pattern-5");
    const batch = (review as any).periodicReviewBatch(queue);
    assert.deepEqual(batch.windows.map((w: any) => w.window_id), ["arc-pattern-10", "arc-pattern-15"]);
    assert.equal(batch.analyzed, false);
    assert.equal(batch.evidence_count, 10);
});
test("legacy after-actions deferrals still resume and no windows are marked analyzed by batching", () => {
    const queue = review.periodicReviewQueue(actions.slice(0, 10), [], [
        { window_id: "arc-pattern-5", status: "deferred", resume_after_action_count: 11 }]);
    assert.equal(queue.current?.window_id, "arc-pattern-10");
    assert.equal(queue.deferred.length, 1);
    assert.equal((review as any).periodicReviewBatch(queue).windows[0].window_id, "arc-pattern-10");
});
