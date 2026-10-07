import { test } from "node:test";
import assert from "node:assert/strict";
import { installHarnessArgumentIntegrity } from "../demo/pi_harness_tool_batch.ts";

test("argument guard scopes append-only validation to Completions and clears other API state", () => {
    const handlers: Record<string, any> = {};
    const errors: unknown[] = [];
    installHarnessArgumentIntegrity({ on(name, handler) { handlers[name] = handler; } } as any,
        row => errors.push(row));
    const call = { toolCallId: "reused", toolName: "task_harness_create", input: { marker: "final" } };
    const message = (api: string) => ({ role: "assistant", api,
        content: [{ type: "toolCall", id: call.toolCallId, name: call.toolName, arguments: call.input }] });
    const finish = (api: string, raw: string) => {
        handlers.message_start({ message: message(api) });
        handlers.message_update({ assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: raw } });
        handlers.message_end({ message: message(api) });
        return handlers.tool_call(call);
    };
    // The invalid Completions raw must block; an API with a final replacement must not.
    const blocked = finish("openai-completions", '{"marker":"partial');
    assert.equal(blocked.block, true);
    for (const api of ["openai-responses", "anthropic-messages"])
        assert.equal(finish(api, '{"marker":"partial'), undefined);
    assert.equal(finish("openai-completions", JSON.stringify(call.input)), undefined);
    assert.equal(errors.length, 1);
});
