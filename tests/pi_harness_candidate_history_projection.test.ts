import { test } from "node:test";
import assert from "node:assert/strict";
import { compactSupersededCandidate, supersededFailedCandidateCalls } from "../demo/pi_harness_candidate_history_projection.ts";

const candidate = { semantic_kind: "tool", name: "bad_name", description: "sample cells",
    authoring_method_ref: "baseline_method:tool-creator@v1", program: { op: "get", key: "grid" },
    input_schema: { type: "object", properties: { grid: { type: "array" } } },
    output_schema: { type: "object" } };
function call(id: string, body: object) {
    return { role: "assistant", content: [{ type: "toolCall", name: "task_harness_create", id,
        arguments: { candidate: body, decision: { reason: "check" } } }] };
}
function result(id: string, body: object, isError = false) {
    return { role: "toolResult", toolName: "task_harness_create", toolCallId: id, isError,
        content: [{ type: "text", text: JSON.stringify(body) }] };
}
const failure = { format: "task-harness-preflight-error-v1", status: "failed", no_component_written: true,
    issues: [{ path: "changes[0].candidate.name", message: "invalid name" }] };
const success = { format: "task-harness-change-receipt-v1", status: "applied",
    results: [{ status: "applied", resource: { resource_ref: "tool:sample-cells@v1" } }] };

test("only a later published identical body replaces an earlier zero-write candidate body", () => {
    const repaired = { ...candidate, name: "sample-cells", description: "sample exact cells" };
    const messages = [call("old", candidate), result("old", failure, true),
        call("new", repaired), result("new", success)];
    const links = supersededFailedCandidateCalls(messages);
    assert.deepEqual(links.get("old"), { successor_call_id: "new", resource_ref: "tool:sample-cells@v1" });
    assert.equal(links.has("new"), false);
    const compact = compactSupersededCandidate(candidate, links.get("old")!);
    assert.equal(compact.name, "bad_name");
    assert.equal(compact.description, "sample cells");
    assert.match(compact.program, /tool:sample-cells@v1; call new/);
    assert.deepEqual(messages[1], result("old", failure, true)); // Precise failure remains unchanged.
    assert.deepEqual(candidate.program, { op: "get", key: "grid" });
});

test("unknown writes, absent successor and changed programs keep original authoring", () => {
    const first = call("old", candidate);
    const noWritesUnknown = result("old", { ...failure, no_component_written: false }, true);
    const changed = call("new", { ...candidate, name: "sample-cells", program: { op: "get", key: "other" } });
    const published = result("new", success);
    assert.equal(supersededFailedCandidateCalls([first, noWritesUnknown, changed, published]).size, 0);
    assert.equal(supersededFailedCandidateCalls([first, result("old", failure, true), changed, published]).size, 0);
    assert.equal(supersededFailedCandidateCalls([first, result("old", failure, true)]).size, 0);
    assert.equal(supersededFailedCandidateCalls([first, result("old", failure, true),
        call("new", { ...candidate, name: "sample-cells" }),
        result("new", { ...success, status: "partial" })]).size, 0);
});
