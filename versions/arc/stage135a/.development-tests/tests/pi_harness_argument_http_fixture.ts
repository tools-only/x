import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installTaskLocalSelfHarness } from "../demo/pi_task_local_self_harness.ts";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { registerArcObservationSnapshot } from "../demo/pi_arc_observation_snapshot.ts";

export default function fixture(pi: ExtensionAPI) {
    const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT!);
    const append = (name: string, row: unknown) => appendFileSync(join(root, name), JSON.stringify(row) + "\n");
    const readJsonl = (name: string) => existsSync(join(root, name))
        ? readFileSync(join(root, name), "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
    let decision = 0;
    installTaskResourceReader(pi, root);
    installTaskLocalSelfHarness(pi, { root, append, readJsonl, allocateDecisionId: () => `decision-${++decision}`,
        pendingAssessments: new Map(), resolveBasisRefs: refs => refs,
        taskToolAdapter: { adapterId: "no-adapters", permission: "no_adapter_implementations",
            allowedImplementations: [], execute: async () => { throw new Error("No adapter authorized"); } } });
    pi.registerTool({ name: "ingress_probe", label: "Ingress probe", description: "Record actual executor input.",
        parameters: Type.Object({ marker: Type.String() }),
        async execute(id, params) { append("probe-executions.jsonl", { id, params });
            return { content: [{ type: "text", text: JSON.stringify(params) }] }; } });
    pi.registerProvider("argument-http-test", {
        api: "openai-completions", apiKey: "offline", baseUrl: process.env.PI_ARGUMENT_HTTP_BASE_URL!,
        models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"], contextWindow: 128000,
            maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    pi.on("session_start", () => {
        registerArcObservationSnapshot(root, { game_id: "g", state: "PLAYING", levels_completed: 0, win_levels: 1,
            guid: "id", full_reset: false, frames: [[[0, 2], [3, 4]]], available_actions: ["ACTION1"],
            agent_available_actions: ["ACTION1"], action_budget: { used: 0, maximum: 10, total_used: 0,
                total_maximum: 10, level: 0, baseline_actions: [5], multiplier: 2 } });
        pi.setActiveTools(["task_harness", "task_harness_create", "ingress_probe"]);
    });
    pi.on("message_end", event => {
        if (event.message.role === "assistant") append("native-provider-messages.jsonl", event.message);
    });
    pi.on("message_update", (event, ctx) => {
        if (process.env.PI_ARGUMENT_CANCEL_ON_DELTA === "1" && event.assistantMessageEvent.type === "toolcall_delta") ctx.abort();
    });
}
