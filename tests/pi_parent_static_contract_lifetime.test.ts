import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installParentContextControl } from "../demo/pi_parent_context_control.ts";
import { harnessOperatingReference } from "../demo/pi_harness_operating_reference.ts";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";

function fixture(root = mkdtempSync(join(tmpdir(), "pi-static-contract-"))) {
    const handlers = new Map<string, any[]>(), tools = new Map<string, any>();
    const pi: any = {
        on(name: string, callback: any) { handlers.set(name, [...(handlers.get(name) ?? []), callback]); },
        registerTool(tool: any) { tools.set(tool.name, tool); },
    };
    installTaskResourceReader(pi, root);
    const control = installParentContextControl(pi, root);
    const emit = async (name: string, event: any) => {
        for (const hook of handlers.get(name) ?? []) {
            const result = await hook(event);
            if (result?.messages) event = { ...event, messages: result.messages };
        }
        return event;
    };
    const record = async (id: string, args: any, value: any, options: any = {}) => {
        const result = options.result ?? { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
        const toolName = options.toolName ?? "task_harness";
        await emit("tool_execution_start", { toolName, toolCallId: id, args });
        await emit("tool_execution_end", { toolName, toolCallId: id, result, isError: options.isError ?? false });
        return { role: "toolResult", toolName, toolCallId: id, ...result };
    };
    const read = async (ref: string) => {
        const result = await tools.get("task_resource").execute("exact-read", { action: "read", ref, offset: 0, limit: 65536 });
        const page = JSON.parse(result.content[0].text);
        assert.equal(page.complete, true);
        return JSON.parse(page.text);
    };
    return { root, pi, control, emit, record, read };
}

const continuation = { role: "assistant", content: [{ type: "text", text: "Use the reference for the next decision." }], stopReason: "stop" };
const largeStatic = { format: "task-harness-contract-v1", read_only: true, topic: "review", instructions: "Static operating instructions. ".repeat(100) };

test("static review contract reaches the first continuation in full and expires only afterward", async () => {
    const f = fixture();
    const args = { action: "contract", topic: "review" };
    const message = await f.record("review", args, harnessOperatingReference("review"));
    const call = { role: "assistant", content: [{ type: "toolCall", id: "review", name: "task_harness", arguments: args }] };
    const first = (await f.emit("context", { messages: [call, message] })).messages;
    assert.deepEqual(first, [call, message], "the original result is delivered before a later assistant exists");

    const continuation = { role: "assistant", content: [{ type: "toolCall", id: "next", name: "task_checkpoint", arguments: { action: "update" } }] };
    const later = (await f.emit("context", { messages: [...first, continuation] })).messages;
    assert.match(later[1].content[0].text, /expired after one model continuation; exact tool_result:review@v1/);
    assert.equal(later[1].details.transient_expired, true);
    assert.deepEqual(later[2], continuation);
    assert.equal(f.control.inspect().transient_projection.result_count, 1);
});

test("the real static topic directory and manuals obey the unchanged size threshold", async () => {
    const f = fixture();
    for (const topic of [undefined, "charter", "components", "memory", "review", "induction", "assessment", "development", "research", "experiments", "arc_reasoning"]) {
        const id = topic ?? "index";
        const message = await f.record(id, { action: "contract", ...(topic ? { topic } : {}) }, harnessOperatingReference(topic));
        const first = (await f.emit("context", { messages: [message] })).messages;
        assert.deepEqual(first[0], message);
        const later = (await f.emit("context", { messages: [message, continuation] })).messages;
        if (topic === "assessment") {
            assert.deepEqual(later[0], message, "the real small assessment reference remains exact");
        } else {
            assert.equal(later[0].details.transient_expired, true, id);
            assert.match(later[0].content[0].text, new RegExp(`exact tool_result:${id}@v1`));
        }
    }
    const enlarged = await f.record("assessment-large", { action: "contract", topic: "assessment" }, { ...largeStatic, topic: "assessment" });
    assert.equal((await f.emit("context", { messages: [enlarged, continuation] })).messages[0].details.transient_expired, true);
});

test("multiple static results are delivered together while all other gameplay context stays exact", async () => {
    const f = fixture();
    const first = await f.record("first", { action: "contract", topic: "review" }, harnessOperatingReference("review"));
    const second = await f.record("second", { action: "contract", topic: "research" }, harnessOperatingReference("research"));
    const state = { role: "user", content: [{ type: "text", text: JSON.stringify({
        current_grid: [[1, 0]], counterevidence: ["ACTION1 did not move the piece"],
        hypothesis: "Choose the next observation-driven test", forecast: "One cell changes", pending_experiment: "test-current-state",
    }) }, { type: "image", data: "fixture-current-png", mimeType: "image/png" }] };
    const action = { role: "toolResult", toolName: "arc_action", content: [{ type: "text", text: "Canonical ARC receipt" }], details: { arc_action_boundary: true } };
    const messages = [state, first, second, action];
    assert.deepEqual((await f.emit("context", { messages })).messages, messages, "a result/action suffix is not an assistant continuation");
    const later = (await f.emit("context", { messages: [...messages, continuation] })).messages;
    assert.equal(later[1].details.transient_expired, true);
    assert.equal(later[2].details.transient_expired, true);
    assert.deepEqual([later[0], later[3], later[4]], [state, action, continuation]);
    assert.equal(f.control.inspect().transient_projection.result_count, 2);
});

test("static manuals keep the existing any-assistant continuation expiry boundary", async () => {
    const f = fixture();
    const message = await f.record("boundary", { action: "contract", topic: "review" }, largeStatic);
    for (const laterAssistant of [
        { role: "assistant", content: [{ type: "toolCall", id: "gather", name: "task_resource", arguments: { action: "read" } }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "Synthetic intermediate reasoning" }] },
        ...["length", "error", "aborted"].map(stopReason => ({ role: "assistant", content: [{ type: "text", text: "Partial continuation" }], stopReason })),
    ]) {
        const projected = (await f.emit("context", { messages: [message, laterAssistant] })).messages;
        assert.equal(projected[0].details.transient_expired, true);
        assert.deepEqual(projected[1], laterAssistant);
    }
});

test("the exact archived static manual can be read, restored, pinned, restarted and explicitly compacted", async () => {
    const f = fixture();
    const message = await f.record("recover", { action: "contract", topic: "review" }, harnessOperatingReference("review"));
    const ref = "tool_result:recover@v1";
    const expired = (await f.emit("context", { messages: [message, continuation] })).messages;
    const source = await f.read(ref);
    const original = { content: message.content, details: message.details };
    assert.deepEqual(source.result, original);
    assert.equal(source.result_sha256, createHash("sha256").update(JSON.stringify(original)).digest("hex"));
    assert.equal(source.version, 1);
    assert.equal(source.transient, true);
    const unpinnedRestart = (await fixture(f.root).emit("context", { messages: [message, continuation] })).messages;
    assert.equal(unpinnedRestart[0].details.transient_expired, true, "the archived transient flag survives restart without a new tool execution");
    assert.equal(unpinnedRestart[0].content[0].text, expired[0].content[0].text);
    f.control.choose("restore_results", [ref]);
    const restored = (await f.emit("context", { messages: expired })).messages;
    assert.deepEqual(restored[0].content, message.content);
    assert.deepEqual(restored[0].details, message.details);
    assert.equal(f.control.inspect().items[0].pinned, true);
    const resumed = fixture(f.root);
    const pinned = (await resumed.emit("context", { messages: expired })).messages;
    assert.deepEqual(pinned[0].content, message.content);
    assert.deepEqual(pinned[0].details, message.details);
    assert.deepEqual((await resumed.read(ref)).result, original);
    resumed.control.choose("compact_results", [ref], "The manual is no longer needed in this working set");
    const compacted = (await resumed.emit("context", { messages: pinned })).messages;
    assert.match(compacted[0].content[0].text, /selected out of context by parent Agent/);
    assert.equal(resumed.control.inspect().items[0].pinned, false);
    assert.equal((await fixture(f.root).emit("context", { messages: [message, continuation] })).messages[0].details.compacted, true);
});

test("copied static result archives keep the existing task scope boundary", async () => {
    const f = fixture();
    await f.record("scoped", { action: "contract", topic: "review" }, largeStatic);
    const otherRoot = mkdtempSync(join(tmpdir(), "pi-foreign-contract-"));
    copyFileSync(join(f.root, "task-parent-tool-results.jsonl"), join(otherRoot, "task-parent-tool-results.jsonl"));
    assert.throws(() => fixture(otherRoot), /task scope mismatch|task root mismatch/);
});

test("dynamic contracts and schema wrapper topic overrides remain exact", async () => {
    const f = fixture();
    const dynamicLevel = { format: "arc-level-review-contract-v1", guidance: "Live review guidance ".repeat(100), window: { window_id: "current", observation_count: 7 }, input_contract: { expected_window: "current" } };
    const cases = [
        { args: { action: "contract", topic: "assembly" }, value: { ...harnessOperatingReference("assembly"), current_assembly: { revision: 7 }, assemble_template: { expected_assembly_revision: 7 } } },
        { args: { action: "contract", topic: "opportunity" }, value: harnessOperatingReference("opportunity", { observation_count: "7", repeated_operations: "[live-repeat]", missing_components: "[live-missing]" }) },
        { args: { action: "contract", topic: "level_review" }, value: dynamicLevel },
        { args: { action: "contract", schema_action: "level_review" }, value: dynamicLevel },
        { args: { action: "contract", topic: "review", schema_action: "level_review" }, value: dynamicLevel },
        { args: { action: "contract", schema_action: "capability_review" }, value: harnessOperatingReference("review") },
        { args: { action: "contract", topic: "review", schema_action: "review" }, value: harnessOperatingReference("review") },
        ...["assembly", "opportunity"].map(topic => ({ args: { action: "contract", topic, schema_action: "core" }, value: { ...largeStatic, topic } })),
    ];
    for (const [i, { args, value }] of cases.entries()) {
        const message = await f.record(`dynamic-${i}`, args, value);
        assert.deepEqual((await f.emit("context", { messages: [message, continuation] })).messages[0], message);
    }
    const core = await f.record("core-static", { action: "contract", topic: "review", schema_action: "core" }, harnessOperatingReference("review"));
    assert.equal((await f.emit("context", { messages: [core, continuation] })).messages[0].details.transient_expired, true);
});

test("failed, small, malformed, unknown and noncontract results remain exact", async () => {
    const f = fixture();
    const args = { action: "contract", topic: "review" };
    const result = { content: [{ type: "text", text: JSON.stringify(largeStatic) }], details: largeStatic };
    const cases = [
        { args, value: largeStatic, options: { isError: true } },
        { args, value: null, options: { result: { ...result, isError: true } } },
        { args, value: { ...largeStatic, instructions: "Small manual" } },
        { args, value: null, options: { result: { content: [{ type: "text", text: "Malformed contract ".repeat(200) }] } } },
        { args, value: { ...largeStatic, format: "unknown-contract" } },
        { args, value: { ...largeStatic, read_only: false } },
        { args, value: { ...largeStatic, topic: "assembly" } },
        { args, value: { ...largeStatic, error: "Precise contract failure" } },
        { args, value: { ...largeStatic, current_assembly: { revision: 9 } } },
        { args: { action: "contract", topic: "unknown" }, value: { ...largeStatic, topic: "unknown" } },
        { args: { action: "read_method", topic: "review" }, value: largeStatic },
        { args, value: largeStatic, options: { toolName: "custom_contract_reader" } },
        { args, value: null, options: { result: { ...result, content: [...result.content, { type: "text", text: "Additional current-state output" }] } } },
        { args: { action: "contract" }, value: largeStatic },
    ];
    for (const [i, entry] of cases.entries()) {
        const message = await f.record(`negative-${i}`, entry.args, entry.value, entry.options);
        assert.deepEqual((await f.emit("context", { messages: [message, continuation] })).messages[0], message, `negative case ${i}`);
    }
});
