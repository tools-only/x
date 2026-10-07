import { test } from "node:test";
import assert from "node:assert/strict";
import { failureClassification } from "../demo/pi_harness_control.ts";

test("explicit no-write preflight ends the attempt without prescribing an inspect", () => {
    const result = failureClassification(JSON.stringify({ format: "task-harness-preflight-error-v1", no_component_written: true }));
    assert.equal(result.retryable, false);
    assert.equal(result.applied, false);
    assert.equal(result.required_next_call, undefined);
});

test("pure rejected input ends; a version conflict and unknown write remain repairable", () => {
    assert.equal(failureClassification(JSON.stringify({ format: "task-control-error-v1", code: "rejected_input", applied: false })).retryable, false);
    const version = failureClassification(JSON.stringify({ format: "task-resource-version-conflict-v1", applied: false, current_version: 2 }));
    assert.equal(version.retryable, true);
    assert.equal(version.current_version, 2);
    assert.equal(failureClassification(JSON.stringify({ format: "task-harness-preflight-error-v1", no_component_written: false })).retryable, true);
    assert.equal(failureClassification(JSON.stringify({ format: "task-control-error-v1", code: "rejected_input", applied: "unknown" })).retryable, true);
    assert.equal(failureClassification("operation failed after unknown writes").retryable, true);
});
