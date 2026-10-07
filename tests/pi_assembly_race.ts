/** Diagnostic concurrent revision during the native publication await. */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nativeHarnessExecutor, registerNativeHarnessExecutor } from "../demo/pi_task_harness_route_runtime.ts";

export default function install(pi: ExtensionAPI) {
    const execute = nativeHarnessExecutor(pi, "task_skill");
    if (!execute) throw new Error("Skill executor must be installed before assembly race fixture");
    registerNativeHarnessExecutor(pi, "task_skill", async (callId, args, signal) => {
        if (args.name === "cas-race") {
            await new Promise(resolve => setTimeout(resolve, 100));
            const path = join(process.env.PI_AUTORESEARCH_E2E_ROOT!, "task-harness-assemblies.jsonl");
            const previous = JSON.parse(readFileSync(path, "utf8").trim().split(/\r?\n/).at(-1)!);
            appendFileSync(path, JSON.stringify({ ...previous, revision: previous.revision + 1,
                assembly_id: "diagnostic-concurrent-assembly", recordedAt: new Date().toISOString() }) + "\n");
        }
        return execute(callId, args, signal);
    });
}
