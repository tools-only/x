/** Failure dependencies within one native sequential parent tool response. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";

const argumentIntegrityInstalled = new WeakSet<ExtensionAPI>();

/** Streaming repair is useful for display; it cannot authorize a partial final call. */
export function installHarnessArgumentIntegrity(pi: ExtensionAPI, report: (record: Record<string, unknown>) => unknown) {
    if (argumentIntegrityInstalled.has(pi)) return;
    argumentIntegrityInstalled.add(pi);
    const fragments = new Map<number, string>();
    const completed = new Map<string, { name: string; raw: string; duplicate?: boolean }>();
    pi.on("message_start", event => {
        if (event.message.role === "assistant") { fragments.clear(); completed.clear(); }
    });
    pi.on("message_update", event => {
        const delta = event.assistantMessageEvent;
        if (delta.type === "toolcall_delta" && typeof delta.delta === "string")
            fragments.set(delta.contentIndex, (fragments.get(delta.contentIndex) ?? "") + delta.delta);
    });
    pi.on("message_end", event => {
        const message = event.message;
        if (message.role !== "assistant") return;
        // Other transports can replace delta arguments with a final object.
        // Only Completions' append-only arguments are validated by this guard.
        if (message.api !== "openai-completions") {
            fragments.clear(); completed.clear();
            return;
        }
        for (const [index, raw] of fragments) {
            const block = message.content[index];
            if (block?.type === "toolCall") {
                const prior = completed.get(block.id);
                completed.set(block.id, prior ? { ...prior, duplicate: true } : { name: block.name, raw });
            }
        }
        fragments.clear();
    });
    pi.on("tool_call", event => {
        const source = completed.get(event.toolCallId);
        if (!source || (!source.duplicate && source.name !== event.toolName)) return;
        try {
            if (source.duplicate) throw new Error("Duplicate tool call ID in the completed provider message; parameters cannot be uniquely attributed.");
            JSON.parse(source.raw);
        }
        catch (error) {
            const failure = {
                format: event.toolName === "task_harness_create" ? "task-harness-preflight-error-v1" : "tool-call-arguments-error-v1",
                status: "failed", phase: "preflight", tool_call_id: event.toolCallId,
                issues: [{ path: "arguments", message: `${source.duplicate ? "Final tool arguments rejected" : "Final raw tool arguments are invalid JSON"}: ${(error as Error).message.slice(0, 240)}` }],
                no_component_written: true, execution_started: false,
                raw_arguments_chars: source.raw.length,
                raw_arguments_sha256: createHash("sha256").update(source.raw, "utf8").digest("hex"),
                ...(source.duplicate ? {} : { raw_arguments_tail: source.raw.slice(-120) }),
                recovery: "No tool executed. SDK history may display repaired arguments; that preview was not accepted. Resubmit complete JSON or abandon the call. Full original: task_resource(action=read, ref=diagnostic_ref).",
            };
            const diagnosticRef = report({ ...failure, raw_arguments: source.raw,
                tool_name: event.toolName, recordedAt: new Date().toISOString() });
            return { block: true, reason: JSON.stringify({ ...failure,
                ...(typeof diagnosticRef === "string" ? { diagnostic_ref: diagnosticRef } : {}) }) };
        }
    });
}

export function installHarnessBatchIntegrity(pi: ExtensionAPI) {
    let failed: { tool_call_id: string; tool_name: string } | undefined;
    const mutations = new Set<string>();
    pi.on("turn_start", () => { failed = undefined; mutations.clear(); });
    pi.on("tool_result", event => {
        const details = event.details as Record<string, any> | undefined;
        if (["task_harness", "task_harness_create"].includes(event.toolName)
            && details?.format === "task-harness-change-receipt-v1"
            && (details.status === "failed" || details.assembly_receipt?.applied === false))
            return { isError: true }; // SDK execute results do not carry isError.
    });
    pi.on("tool_execution_start", event => {
        if (event.toolName === "task_harness_create"
            || (event.toolName === "task_checkpoint" && event.args?.action === "update")
            || (event.toolName === "task_harness" && ["change", "assemble"].includes(event.args?.action)))
            mutations.add(event.toolCallId);
    });
    pi.on("tool_execution_end", event => {
        if (mutations.delete(event.toolCallId) && event.isError)
            failed = { tool_call_id: event.toolCallId, tool_name: event.toolName };
    });
    pi.on("tool_call", event => {
        if (!failed) return;
        if ((event.toolName === "task_harness" && (event.input as Record<string, unknown>)?.action === "assemble")
            || ["arc_action", "arc_actions"].includes(event.toolName))
            return { block: true, reason: `Earlier Harness mutation ${failed.tool_call_id} (${failed.tool_name}) failed in this response. Inspect its receipt before a later parent turn selects components or acts; no dependent assembly/action was applied.` };
    });
}
