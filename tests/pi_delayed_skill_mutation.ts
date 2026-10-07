/** Diagnostic native latency to reproduce concurrent create/assemble races. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nativeHarnessExecutor, registerNativeHarnessExecutor } from "../demo/pi_task_harness_route_runtime.ts";
export default function install(pi: ExtensionAPI) {
    const execute = nativeHarnessExecutor(pi, "task_skill");
    if (!execute) throw new Error("Skill executor must be installed before latency fixture");
    registerNativeHarnessExecutor(pi, "task_skill", async (callId, args) => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return execute(callId, args);
    });
}
