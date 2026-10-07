/** Execution-only native failure; a valid prepared batch may still partially commit. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nativeHarnessExecutor, registerNativeHarnessExecutor } from "../demo/pi_task_harness_route_runtime.ts";

export default function install(pi: ExtensionAPI) {
    const execute = nativeHarnessExecutor(pi, "task_skill");
    if (!execute) throw new Error("Skill executor must be installed before failure fixture");
    let failed = false;
    registerNativeHarnessExecutor(pi, "task_skill", async (callId, args, signal) => {
        if (!failed && args.name === "late-failure") {
            failed = true;
            return { isError: true, details: { error: "diagnostic native failure before Skill write" } };
        }
        return execute(callId, args, signal);
    });
    const prompt = nativeHarnessExecutor(pi, "task_system_prompt");
    if (!prompt) throw new Error("Prompt executor must be installed before failure fixture");
    let promptFailed = false;
    registerNativeHarnessExecutor(pi, "task_system_prompt", async (callId, args, signal) => {
        if (!promptFailed && args.name === "late-overlay") {
            promptFailed = true;
            return { isError: true, details: { error: "diagnostic native failure before Prompt write" } };
        }
        return prompt(callId, args, signal);
    });
}
