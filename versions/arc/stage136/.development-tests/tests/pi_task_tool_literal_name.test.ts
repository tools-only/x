import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTaskToolName } from "../demo/pi_task_tool_contract.ts";
import { normalizeHarnessDelivery } from "../demo/pi_auto_research_harness_router.ts";
import { baselineMethodCatalog } from "../demo/pi_harness_baseline_methods.ts";

test("literal tool names accept ordinary separators and reject path or ambiguous delimiters", () => {
    for (const name of ["a", "a-b", "a_b", "arc_pixel_color", "3d-grid_v2"])
        assert.doesNotThrow(() => assertTaskToolName(name));
    for (const name of ["", "_a", "a_", "a__b", "a--b", "a-_b", "A", "a/b", "a\\b", "a.b", "a:b", "a@v1", "a b"])
        assert.throws(() => assertTaskToolName(name), /task tool name/);
});

test("computation delivery preserves literal names and retains delivery ID and other carrier restrictions", () => {
    const creator = baselineMethodCatalog().find(x => x.name === "tool-creator")!;
    const value = { format: "auto-research-harness-delivery-v1", semantic_kind: "computation",
        delivery_id: "bounded-compute", name: "scalar_check", summary: "Return an authored scalar.",
        content: "An exact bounded scalar computation.", description: "Return one.",
        operation: "create", scope: { kind: "condition", statement: "A scalar is requested." },
        stability: "conditional", reuse: "expected_reuse",
        trigger: "scalar query", expected_effect: "Return one.", reconsider_when: "The query changes.",
        reasoning: "none", execution: "pure_computation", context_visibility: "on_demand",
        authoring_method_ref: creator.method_ref, basis_refs: ["observation_snapshot:parent-state-1@v1"],
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        output_schema: { type: "integer" },
        program: { format: "task-pure-expression-v1", limits: {}, expression: { op: "literal", value: 1 } } };
    assert.equal(normalizeHarnessDelivery(value).name, "scalar_check");
    assert.equal(normalizeHarnessDelivery({ ...value, name: "scalar-check" }).name, "scalar-check");
    assert.throws(() => normalizeHarnessDelivery({ ...value, delivery_id: "bad_id" }), /delivery_id/);
    assert.throws(() => normalizeHarnessDelivery({ ...value, semantic_kind: "procedure" }), /delivery.name/);
});
