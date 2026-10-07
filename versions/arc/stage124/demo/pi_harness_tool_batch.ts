/** Failure dependencies within one native sequential parent tool response. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function installHarnessBatchIntegrity(pi: ExtensionAPI) {
    let failed: { tool_call_id: string; tool_name: string } | undefined;
    const mutations = new Set<string>();
    pi.on("turn_start", () => { failed = undefined; mutations.clear(); });
    pi.on("tool_result", event => {
        const details = event.details as Record<string, any> | undefined;
        if (["task_harness", "task_harness_create"].includes(event.toolName)
            && details?.format === "task-harness-change-receipt-v1"
            && details.assembly_receipt?.applied === false)
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
