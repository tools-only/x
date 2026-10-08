import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { installChildContextControl } from "../demo/pi_child_context_control.ts";
import { installTaskLocalContextLifecycle } from "../demo/pi_task_local_context_lifecycle.ts";
import { ensureTaskScope, stampTaskRecord } from "../demo/pi_task_scope.ts";
import { readWorkset } from "../demo/pi_read_workset.ts";

function fixture(research = true, limit = 6000) {
    const root = mkdtempSync(join(tmpdir(), "pi-research-batch-"));
    const tools = new Map<string, any>(), hooks = new Map<string, any[]>();
    let aborted = 0;
    const pauses: any[] = [];
    const pi: any = {
        on(name: string, fn: any) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); },
        registerTool(tool: any) { tools.set(tool.name, tool); },
        getAllTools() { return [...tools.values()]; },
        getActiveTools() { return [...tools.keys()]; },
    };
    const scope = ensureTaskScope(root);
    const exact = "counterexample-raw-grid-".repeat(900);
    appendFileSync(join(root, "task-memory.jsonl"), JSON.stringify(stampTaskRecord(scope,
        { key: "evidence", version: 1, content: exact })) + "\n");
    const ref = "memory:evidence@v1";
    const saved = process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL;
    process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL = research ? "1" : "0";
    try {
        installTaskResourceReader(pi, root, [ref]);
        installChildContextControl(pi, root, { readBatchMaxBytes: limit,
            onReadBatchPause: details => pauses.push(details) });
    } finally {
        if (saved === undefined) delete process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL;
        else process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL = saved;
    }
    const emit = async (name: string, event: any) => {
        let returned: any;
        for (const hook of hooks.get(name) ?? []) {
            const result = await hook(event, { abort() { aborted++; }, getSystemPrompt() { return ""; } });
            if (result?.messages) event = { ...event, messages: result.messages };
            if (result?.block) returned = result;
        }
        return returned ?? event;
    };
    const call = async (id: string, name: string, args: any) => {
        const gate = await emit("tool_call", { toolName: name, toolCallId: id, input: args });
        if (gate.block) return gate;
        await emit("tool_execution_start", { toolName: name, toolCallId: id, args });
        const result = await tools.get(name).execute(id, args);
        await emit("tool_execution_end", { toolName: name, toolCallId: id, result });
        return { role: "toolResult", toolName: name, toolCallId: id, ...result };
    };
    const read = (id: string, offset = 0, limit = 4000) => call(id, "task_resource", { action: "read", ref, offset, limit });
    const compact = (refs: string[], summary = "Hypothesis remains provisional; exact page refutes universal no-op; next test remains unexecuted.") =>
        call("compact", "child_context", { action: "compact", refs, summary });
    return { root, pi, tools, pauses, emit, read, compact, call, ref, aborted: () => aborted };
}

test("research batch retains pages for one analysis turn then pauses an ignored resource boundary", async () => {
    const f = fixture();
    const first = await f.read("first"), second = await f.read("second", 4000);
    await f.emit("turn_end", {});
    assert.equal(f.aborted(), 0, "the gathering turn must not consume the analysis opportunity");
    const projected = (await f.emit("context", { messages: [first, second] })).messages;
    assert.ok(projected.some((m: any) => m.content?.some((p: any) => p.text?.startsWith("Research read batch capacity:"))));
    assert.ok(JSON.stringify(projected).includes("counterexample-raw-grid"));
    const blocked = await f.read("third", 8000);
    assert.equal(blocked.block, true);
    assert.equal(readFileSync(join(f.root, "task-resource-access.jsonl"), "utf8").trim().split("\n").length, 2);
    await f.emit("message_end", { message: { role: "assistant", stopReason: "toolUse", content: [] } });
    await f.emit("turn_end", {});
    assert.equal(f.aborted(), 1);
    assert.equal(f.pauses.length, 1);
    assert.equal(f.pauses[0].reason, "research_read_batch_capacity");
    await f.emit("turn_end", {});
    assert.equal(f.pauses.length, 1, "a paused slice never produces duplicate pause decisions");
});

test("explicit distillation overrides inherited parent plan residency and preserves exact recovery", async () => {
    const f = fixture();
    writeFileSync(join(f.root, "task-strategy-state.json"), JSON.stringify({ candidates: [],
        plan: { status: "active", evidence_refs: [f.ref] } }));
    const first = await f.read("first"), second = await f.read("second", 4000);
    await f.emit("context", { messages: [first, second] });
    await f.emit("message_end", { message: { role: "assistant", stopReason: "toolUse" } });
    await f.compact(["child_result:first", "child_result:second"]);
    installTaskLocalContextLifecycle(f.pi, { root: f.root, maxChars: 12000, keepRecentMessages: 2 });
    const messages = (await f.emit("context", { messages: [first, second] })).messages;
    assert.ok(!JSON.stringify(messages).includes("counterexample-raw-grid"));
    assert.ok(JSON.stringify(messages).includes("refutes universal no-op"));
    assert.equal(readWorkset(f.pi, f.root).required("first"), false);
    const coverage = readWorkset(f.pi, f.root).payload({ messages }, "after-compact");
    assert.deepEqual(coverage.missing_unacknowledged, []);
    await f.emit("turn_end", {});
    assert.equal(f.aborted(), 0);
    const restored = await f.read("restored");
    assert.equal(JSON.parse(restored.content[0].text).text, JSON.parse(first.content[0].text).text);
    await assert.rejects(f.call("unauthorized", "task_resource", { action: "read", ref: "memory:evidence@v2" }), /not granted/);
});

test("same exact page replacement does not spend a second batch allocation", async () => {
    const f = fixture(true, 7000);
    const pages = [await f.read("first"), await f.read("duplicate")];
    const messages = (await f.emit("context", { messages: pages })).messages;
    assert.ok(!JSON.stringify(messages).includes("Research read batch capacity:"));
    assert.equal((await f.read("next", 4000)).block, undefined);
});

test("failed compaction keeps exact pages and cannot evade the boundary through read or restore", async () => {
    const f = fixture();
    const pages = [await f.read("first"), await f.read("second", 4000)];
    await f.emit("context", { messages: pages });
    await assert.rejects(f.compact(["child_result:first"], ""), /continuity summary/);
    assert.equal(readWorkset(f.pi, f.root).required("first"), true);
    for (const args of [{ action: "read", ref: "child_result:first" },
        { action: "restore", refs: ["child_result:first"] }]) {
        assert.equal((await f.call("bypass", "child_context", args)).block, true);
    }
    const messages = (await f.emit("context", { messages: pages })).messages;
    assert.ok(JSON.stringify(messages).includes("counterexample-raw-grid"));
});

test("one oversized atomic result remains complete before the resource boundary", async () => {
    const f = fixture(true, 2000);
    const page = await f.read("large", 0, 8000);
    const messages = (await f.emit("context", { messages: [page] })).messages;
    assert.equal(messages[0].content[0].text, page.content[0].text);
    assert.equal((await f.read("more", 8000)).block, true);
});

test("consumed worker pages release immediately without a plain-text response", async () => {
    const f = fixture();
    f.pi.registerTool({ name: "research_checkpoint", async execute() {
        return { content: [{ type: "text", text: "Agent checkpoint with counterevidence saved" }] };
    } });
    const pages = [await f.read("first"), await f.read("second", 4000)];
    await f.emit("context", { messages: pages });
    await f.emit("message_end", { message: { role: "assistant", stopReason: "toolUse" } });
    await f.call("checkpoint", "research_checkpoint", { action: "save", consumed_evidence_refs: [f.ref] });
    await f.emit("turn_end", {});
    assert.equal(f.aborted(), 0);
    const projected = (await f.emit("context", { messages: pages })).messages;
    assert.ok(!JSON.stringify(projected).includes("counterexample-raw-grid"));
    assert.equal((await f.read("more", 8000)).block, undefined);
});

test("configured child_context stays available for compact at the resource boundary", async () => {
    const saved = process.env.PI_TASK_SUBAGENT_TOOLS;
    process.env.PI_TASK_SUBAGENT_TOOLS = '["task_resource","child_context"]';
    try {
        const f = fixture();
        const pages = [await f.read("first"), await f.read("second", 4000)];
        await f.emit("context", { messages: pages });
        assert.equal((await f.compact(["child_result:first", "child_result:second"])).block, undefined);
        assert.equal((await f.read("more", 8000)).block, undefined);
    } finally {
        if (saved === undefined) delete process.env.PI_TASK_SUBAGENT_TOOLS;
        else process.env.PI_TASK_SUBAGENT_TOOLS = saved;
    }
});

test("pages rehydrated after native compaction can be distilled, and restore keeps the interpretation", async () => {
    const f = fixture();
    await f.read("first");
    const rehydrated = (await f.emit("context", { messages: [{ role: "user",
        content: [{ type: "text", text: "Native summary" }] }] })).messages;
    assert.ok(JSON.stringify(rehydrated).includes("counterexample-raw-grid"));
    await f.compact(["child_result:first"]);
    const distilled = (await f.emit("context", { messages: rehydrated })).messages;
    assert.ok(!JSON.stringify(distilled).includes("counterexample-raw-grid"));
    assert.ok(!distilled.some((m: any) => m.read_workset_required), "released markers are no longer leased raw evidence");
    await f.call("restore", "child_context", { action: "restore", refs: ["child_result:first"] });
    const restored = (await f.emit("context", { messages: distilled })).messages;
    assert.ok(JSON.stringify(restored).includes("counterexample-raw-grid"));
    assert.ok(JSON.stringify(restored).includes("refutes universal no-op"), "restoring evidence must not erase the Agent interpretation");
});

for (const mode of ["ordinary", "disabled"]) test(`${mode}: preserves existing read and dependency behavior`, async () => {
    const f = fixture(mode !== "ordinary", mode === "disabled" ? 0 : 6000);
    writeFileSync(join(f.root, "task-strategy-state.json"), JSON.stringify({ candidates: [],
        plan: { status: "active", evidence_refs: [f.ref] } }));
    const pages = [await f.read("first"), await f.read("second", 4000)];
    const messages = (await f.emit("context", { messages: pages })).messages;
    assert.ok(!JSON.stringify(messages).includes("Research read batch capacity:"));
    assert.equal((await f.read("more", 8000)).block, undefined);
    if (mode === "ordinary") {
        await f.compact(["child_result:first"]);
        assert.equal(readWorkset(f.pi, f.root).required("first"), true,
            "ordinary delegate dependency protection stays unchanged");
    }
});
