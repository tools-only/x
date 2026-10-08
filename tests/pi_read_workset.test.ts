import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { ensureTaskScope, stampTaskRecord } from "../demo/pi_task_scope.ts";
import { installParentContextControl } from "../demo/pi_parent_context_control.ts";
import { installChildContextControl } from "../demo/pi_child_context_control.ts";
import { installProviderTelemetry } from "../demo/pi_provider_telemetry.ts";
import finalProviderPayload from "../demo/pi_final_provider_payload.ts";
import { readWorkset } from "../demo/pi_read_workset.ts";
import { installTaskLocalContextLifecycle } from "../demo/pi_task_local_context_lifecycle.ts";

function fixture(restricted = false) {
    const root = mkdtempSync(join(tmpdir(), "pi-read-workset-"));
    const tools = new Map<string, any>(), handlers = new Map<string, any[]>();
    const pi: any = {
        events: new EventEmitter(),
        on(name: string, callback: any) { handlers.set(name, [...(handlers.get(name) ?? []), callback]); },
        registerTool(tool: any) { tools.set(tool.name, tool); },
        getAllTools() { return [...tools.values()]; },
        getActiveTools() { return [...tools.keys()]; },
    };
    const scope = ensureTaskScope(root);
    const body = "exact page evidence ".repeat(400);
    for (const version of [1, 2]) appendFileSync(join(root, "task-memory.jsonl"), JSON.stringify(
        stampTaskRecord(scope, { key: "batch", version, content: body + version })) + "\n");
    const refs = ["memory:batch@v1", "memory:batch@v2"];
    installTaskResourceReader(pi, root, restricted ? [refs[0]] : undefined);
    const parent = restricted ? null : installParentContextControl(pi, root);
    if (restricted) installChildContextControl(pi, root);
    const emit = async (name: string, event: any) => {
        for (const hook of handlers.get(name) ?? []) {
            const result = await hook(event, { getSystemPrompt() { return ""; } });
            if (result?.messages) event = { ...event, messages: result.messages };
        }
        return event;
    };
    const read = async (id: string, ref = refs[0], offset = 0, limit = 4000) => {
        const args = { action: "read", ref, offset, limit };
        await emit("tool_execution_start", { toolName: "task_resource", toolCallId: id, args });
        const result = await tools.get("task_resource").execute(id, args);
        await emit("tool_execution_end", { toolName: "task_resource", toolCallId: id, result });
        return { role: "toolResult", toolName: "task_resource", toolCallId: id, ...result };
    };
    return { root, refs, tools, parent, emit, read, pi };
}

test("final payload coverage distinguishes stored pages, exact exposure and epoch loss", async () => {
    const f = fixture();
    installProviderTelemetry(f.pi, { root: f.root });
    finalProviderPayload(f.pi);
    const page = await f.read("coverage");
    await f.emit("before_provider_request", { payload: { messages: [
        { role: "tool", content: page.content[0].text },
    ] } });
    await f.emit("before_provider_request", { payload: { messages: [{ role: "user", content: "page omitted" }] } });
    const rows = readFileSync(join(f.root, "task-read-workset-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    const epochs = rows.filter(r => r.event === "payload_coverage");
    assert.equal(epochs.length, 2);
    assert.equal(epochs[0].pages[0].included_in_payload, true);
    assert.equal(epochs[1].pages[0].included_in_payload, false);
    assert.notEqual(epochs[0].exposure_epoch, epochs[1].exposure_epoch);
    assert.equal(epochs[1].pages[0].agent_acknowledged, false);
});

test("unconsumed pages with a decision dependency survive completed actions", async () => {
    const f = fixture();
    const page = await f.read("dependent");
    const state = { format: "task-strategy-state-v1", revision: 1, candidates: [],
        plan: { status: "active", evidence_refs: [f.refs[0]] } };
    appendFileSync(join(f.root, "task-strategy-state.json"), JSON.stringify(state));
    const projected = (await f.emit("context", { messages: [page,
        { role: "toolResult", toolName: "arc_action", details: { arc_action_boundary: true }, content: [] },
    ] })).messages;
    assert.equal(projected[0].content[0].text, page.content[0].text);
});

for (const child of [false, true]) test(`${child ? "child" : "parent"}: native summary rehydrates leased evidence without a new read`, async () => {
    const f = fixture(child), page = await f.read("lease");
    const result = (await f.emit("context", { messages: [{ role: "user", content: [{ type: "text", text: "Native summary" }] }] })).messages;
    assert.ok(result.some(m => m.content?.some(p => p.text === page.content[0].text)));
    assert.equal(readFileSync(join(f.root, "task-resource-access.jsonl"), "utf8").trim().split("\n").length, 1);
    const again = (await f.emit("context", { messages: result })).messages;
    assert.equal(again.length, result.length, "restoration never duplicates a still-present page");
});

test("soft pressure preserves the complete leased transaction and reports overflow", async () => {
    const f = fixture();
    installTaskLocalContextLifecycle(f.pi, { root: f.root, maxChars: 4000, keepRecentMessages: 2, maxMessageChars: 1200 });
    const page = await f.read("pressure");
    const messages = [{ role: "user", content: [{ type: "text", text: "Task" }] },
        { role: "assistant", content: [{ type: "toolCall", id: "pressure", name: "task_resource", arguments: {} }] }, page,
        ...Array.from({ length: 10 }, () => ({ role: "user", content: [{ type: "text", text: "Old exchange ".repeat(150) }] }))];
    const result = (await f.emit("context", { messages })).messages;
    assert.ok(result.some(m => m.role === "toolResult" && m.content[0].text === page.content[0].text));
    assert.ok(result.some(m => m.role === "assistant" && m.content[0].id === "pressure"));
    const rows = readFileSync(join(f.root, "task-context-compactions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).protected_overflow, true);
});

for (const restricted of [false, true]) test(`${restricted ? "child" : "parent"}: exact repeated reads replace the live page lease rather than growing payload audit`, async () => {
    const f = fixture(restricted);
    const gathered = [];
    for (let i = 0; i < 15; i++) gathered.push(await f.read(`repeat-${i}`));
    const projected = (await f.emit("context", { messages: gathered })).messages;
    assert.equal(projected.filter(m => {
        try { return JSON.parse(m.content[0].text).text === JSON.parse(gathered[0].content[0].text).text; }
        catch { return false; }
    }).length, 1,
        "same exact body resides once even before an action or response");
    const w = readWorkset(f.pi, f.root);
    assert.equal(w.required("repeat-0"), false);
    assert.equal(w.required("repeat-14"), true);
    w.payload({}, "bounded");
    const rows = readFileSync(join(f.root, "task-read-workset-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).pages.length, 1);
    assert.equal(w.gaps().length, 1);
});

for (const restricted of [false, true]) test(`${restricted ? "child" : "parent"}: batched reads survive tool-only continuations and compacted pages restore directly`, async () => {
    const f = fixture(restricted);
    const first = await f.read("first");
    const assistant = { role: "assistant", content: [
        { type: "thinking", thinking: "Continue gathering evidence" },
        { type: "toolCall", name: "task_resource", id: "second", arguments: { action: "read" } },
    ] };
    const second = await f.read("second", f.refs[0], 4000);
    const batch = (await f.emit("context", { messages: [first, assistant, second] })).messages;
    assert.equal(batch[0].content[0].text, first.content[0].text, "an intermediate read is not consumption");

    if (restricted) await f.tools.get("child_context").execute("compact", {
        action: "compact", refs: ["child_result:first"], summary: "Continue with the second exact page" });
    else f.parent!.choose("compact_results", ["tool_result:first@v1"], "Continue with the second exact page");
    const compacted = (await f.emit("context", { messages: [first, assistant, second] })).messages;
    assert.notEqual(compacted[0].content[0].text, first.content[0].text);
    const restored = await f.read("restored");
    assert.equal(JSON.parse(restored.content[0].text).text, JSON.parse(first.content[0].text).text,
        "read returns the exact body without force_full or a second recovery call");
    assert.equal(JSON.parse(restored.content[0].text).visibility, "unknown");
    const accesses = readFileSync(join(f.root, "task-resource-access.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(accesses.length, 3, "each actual read is accounted for");
    if (restricted) await assert.rejects(f.read("future", f.refs[1]), /not granted/);
    else assert.notEqual(JSON.parse((await f.read("v2", f.refs[1])).content[0].text).text,
        JSON.parse(first.content[0].text).text);
});

test("acknowledged read batch releases at a successful action; failed actions do not", async () => {
    const f = fixture();
    const page = await f.read("page");
    readWorkset(f.pi, f.root).release(["page"], { release_reason: "The current decision incorporated this page" });
    for (const isError of [true, false]) {
        const projected = (await f.emit("context", { messages: [page,
            { role: "toolResult", toolName: "arc_action", isError,
              details: { arc_action_boundary: true }, content: [{ type: "text", text: "receipt" }] },
        ] })).messages;
        assert.equal(projected[0].content[0].text === page.content[0].text, isError);
    }
    for (const details of [{}, { arc_action_boundary: true, completed: [] },
        { arc_action_boundary: true, completed: [{ action: "ACTION1" }] }]) {
        const projected = (await f.emit("context", { messages: [page,
            { role: "toolResult", toolName: "arc_actions", details, content: [] },
        ] })).messages;
        assert.equal(projected[0].content[0].text === page.content[0].text,
            !Array.isArray((details as any).completed) || !(details as any).completed.length);
    }
});

test("length and reasoning-only continuations retain pages; response releases; explicit restore pins", async () => {
    const f = fixture();
    const page = await f.read("page");
    const text = [{ type: "text", text: "Partial analysis" }];
    for (const continuation of [
        { role: "assistant", content: text, stopReason: "length" },
        { role: "assistant", content: [{ type: "thinking", thinking: "Intermediate reasoning" }] },
    ]) {
        const projected = (await f.emit("context", { messages: [page, continuation] })).messages;
        assert.equal(projected[0].content[0].text, page.content[0].text);
    }
    const messages = [page, { role: "assistant", content: text, stopReason: "stop" }];
    assert.equal((await f.emit("context", { messages })).messages[0].content[0].text, page.content[0].text,
        "a response alone is not analysis acknowledgment");
    readWorkset(f.pi, f.root).release(["page"], { release_reason: "Analysis complete for this page" });
    const released = (await f.emit("context", { messages })).messages;
    assert.notEqual(released[0].content[0].text, page.content[0].text);
    f.parent!.choose("restore_results", ["tool_result:page@v1"]);
    const pinned = (await f.emit("context", { messages: released })).messages;
    assert.equal(pinned[0].content[0].text, page.content[0].text);
});

test("diagnostic recovery expires after a response, preserving explicit pins and active dependencies", async () => {
    for (const retain of ["none", "pin", "dependency"]) {
        const f = fixture();
        const ref = "failure:failure-1@v1";
        appendFileSync(join(f.root, "task-operation-failures.jsonl"), JSON.stringify(stampTaskRecord(
            ensureTaskScope(f.root), { failure_id: "failure-1", version: 1, error: "exact diagnostic ".repeat(400) })) + "\n");
        const page = await f.read("diagnostic", ref);
        if (retain === "pin") f.parent!.choose("restore_results", ["tool_result:diagnostic@v1"]);
        if (retain === "dependency") appendFileSync(join(f.root, "task-strategy-state.json"), JSON.stringify({
            revision: 1, candidates: [], plan: { status: "active", evidence_refs: [ref] },
        }));
        const projected = (await f.emit("context", { messages: [page,
            { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "The rejection was inspected." }] },
        ] })).messages;
        assert.equal(projected[0].content[0].text === page.content[0].text, retain !== "none");
        const events = readFileSync(join(f.root, "task-read-workset-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
        assert.equal(events.some(row => row.event === "diagnostic_release"), retain === "none");
        assert.equal(events.some(row => row.event === "agent_release"), false);
    }
});
