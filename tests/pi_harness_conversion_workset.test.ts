import { test } from "node:test";
import assert from "node:assert/strict";
import { conversionWorkset } from "../demo/pi_harness_conversion_workset.ts";

test("exact versions, eligibility and failed writes govern the current stage", () => {
    const row = {intent_id:"i",status:"applied_pending_assembly",resource_refs:["skill:x@v2"]};
    assert.equal(conversionWorkset([row],["skill:x@v1"])[0].status,"applied_pending_assembly");
    assert.equal(conversionWorkset([row],["skill:x@v2"],{eligibleRefs:[]})[0].status,"applied_pending_assembly");
    const failed = {...row,status:"awaiting_parent_repair",retry:{remaining_changes:["y"]}};
    assert.deepEqual(conversionWorkset([failed],["skill:x@v2"])[0].retry,failed.retry);
    assert.equal(conversionWorkset([row,{...row,status:"dropped"}],["skill:x@v2"])[0].status,"dropped");
    assert.equal(row.status,"applied_pending_assembly"); // No mutation of durable history.
});

test("partial trials retain the untried exact versions and do not infer benefit", () => {
    const row = {operation_id:"legacy",status:"applied_pending_assembly",resource_refs:["tool:t@v1","skill:s@v1"]};
    const result = conversionWorkset([row],row.resource_refs,{trials:[{observation_ref:"u1",resource_refs:["tool:t@v1"]}]})[0];
    assert.equal(result.status,"assembled_pending_trial");
    assert.deepEqual(result.pending_trial_refs,["skill:s@v1"]);
    assert.equal(conversionWorkset([row],row.resource_refs,{trials:[{observation_ref:"old",resource_refs:["tool:t@v0"]}]})[0].status,"assembled_pending_trial");
});
