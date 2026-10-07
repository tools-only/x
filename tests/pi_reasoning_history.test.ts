import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactHistoricalArcFrames } from "../demo/pi_arc_context_projection.ts";
import { installTaskLocalContextLifecycle } from "../demo/pi_task_local_context_lifecycle.ts";

test("reasoning projection preserves native signatures, opaque blocks and unfinished continuations", async () => {
    const signature = { type: "thinking", thinking: "signed ".repeat(800), thinkingSignature: "native-signature" };
    const opaque = { type: "reasoning", encrypted_content: "opaque ".repeat(800) };
    for (const stopReason of ["length", "error", "aborted", "toolUse"]) {
        const assistant = { role: "assistant", stopReason, content: [signature, opaque,
            { type: "toolCall", id: "c", name: "task_resource", arguments: { action: "read", ref: "memory:x@v1" } }] };
        const messages = [{ role: "user", content: [{ type: "text", text: "Task" }] }, assistant,
            { role: "toolResult", toolCallId: "c", toolName: "task_resource", content: [{ type: "text", text: "Exact result" }] }];
        const prior = process.env.PI_CONTEXT_REASONING_HISTORY;
        process.env.PI_CONTEXT_REASONING_HISTORY = "discard_unsigned_thinking";
        try {
            assert.deepEqual(compactHistoricalArcFrames(messages)[1], assistant);
            const handlers: any = {}, pi: any = { on(n, f) { handlers[n] = f; }, registerTool() {} };
            installTaskLocalContextLifecycle(pi, { root: mkdtempSync(join(tmpdir(), "native-thinking-")),
                maxChars: 3000, compactCompletedToolReasoning: true, reasoningHistoryPolicy: "discard_unsigned_thinking" });
            const result = await handlers.context({ messages });
            assert.deepEqual(result.messages.find(m => m.role === "assistant"), assistant);
        } finally { if (prior === undefined) delete process.env.PI_CONTEXT_REASONING_HISTORY; else process.env.PI_CONTEXT_REASONING_HISTORY = prior; }
    }
});

test("default ARC projection does not truncate ordinary historical thinking", () => {
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "applicability ".repeat(1000) }] };
    assert.deepEqual(compactHistoricalArcFrames([message, { role: "user", content: [] }])[0], message);
});
