/** Hold a prepared native write while the real Pi parent is cancelled. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nativeHarnessExecutor, registerNativeHarnessExecutor } from "../demo/pi_task_harness_route_runtime.ts";

export default function install(pi: ExtensionAPI) {
    const execute = nativeHarnessExecutor(pi, "task_skill");
    if (!execute) throw new Error("Skill executor must be installed before cancellation fixture");
    registerNativeHarnessExecutor(pi, "task_skill", async (callId, args, signal) => {
        const root = process.env.PI_AUTORESEARCH_E2E_ROOT!;
        writeFileSync(join(root, "held-native-write.json"), JSON.stringify({ signal_present: !!signal }));
        const committed = process.env.PI_DIAGNOSTIC_CANCEL_AFTER_WRITE === "1"
            ? await execute(callId, args, signal) : undefined;
        await new Promise(resolve => setTimeout(resolve, 400));
        if (committed) return committed;
        if (signal?.aborted) return { isError: true, details: { error: "cancelled before native Skill write" } };
        return execute(callId, args, signal);
    });
}
