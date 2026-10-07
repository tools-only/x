import { test } from "node:test";
import assert from "node:assert/strict";
test("successful control views preserve exact semantic fields and identify omissions", async () => {
    const m = await import("../demo/pi_result_views.ts");
    const receipt = { format: "task-harness-change-receipt-v1", status: "applied", change_ref: "change:c@v1",
        results: [{ status: "applied", resource_ref: "tool:t@v2", candidate: { content: "source body ".repeat(800) } }],
        activation: { created_resource_refs: ["tool:t@v2"] } };
    const result = { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
    const view = m.controlResultView("task_harness", result, "tool_result:c@v1");
    assert.equal(view.decision_fields.change_ref, receipt.change_ref);
    assert.deepEqual(view.decision_fields.activation, receipt.activation);
    assert.equal(view.decision_fields.results[0].resource_ref, "tool:t@v2");
    assert.deepEqual(view.omitted_fields, ["results.0.candidate.content"]);
    assert.equal(view.view_complete, true);
    assert.equal(view.canonical_ref, "tool_result:c@v1");
});
test("errors, partial actions and unknown result contracts are never shortened", async () => {
    const m = await import("../demo/pi_result_views.ts");
    for (const value of [{ status: "failed", error: "precise stack" },
        { status: "applied", results: [{ status: "failed", error: "failure" }] }, { status: "partial" }]) {
        assert.equal(m.controlResultView("task_harness", { content: [{ type: "text", text: JSON.stringify({
            format: "task-harness-change-receipt-v1", ...value }) }] }, "r"), null);
    }
    assert.equal(m.controlResultView("arc_action", { content: [] }, "r"), null);
});
