import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installTaskLocalSelfHarness } from "../demo/pi_task_local_self_harness.ts";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import { registerArcObservationSnapshot } from "../demo/pi_arc_observation_snapshot.ts";
import { installProviderTelemetry } from "../demo/pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "../demo/pi_reported_token_budget.ts";
import nonArcTaskSubagents from "./pi_non_arc_task_subagents.ts";
import { assignResearchWorker, researchWorkers, updateWorker, appendWorkerRecord } from "../demo/pi_auto_research_workers.ts";
import { buildParentAuthoringHandoffs } from "../demo/pi_auto_research_output.ts";

export default async function fixture(pi: ExtensionAPI) {
    const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT!);
    installReportedTokenBudget(pi, root);
    if (process.env.PI_ARGUMENT_TELEMETRY === "1") installProviderTelemetry(pi, { root });
    const append = (name: string, row: unknown) => appendFileSync(join(root, name), JSON.stringify(row) + "\n");
    const readJsonl = (name: string) => existsSync(join(root, name))
        ? readFileSync(join(root, name), "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
    let decision = 0;
    installTaskResourceReader(pi, root);
    const installHarness = process.env.PI_ARGUMENT_HARNESS_SOURCE
        ? (await import(pathToFileURL(process.env.PI_ARGUMENT_HARNESS_SOURCE).href)).installTaskLocalSelfHarness
        : installTaskLocalSelfHarness;
    installHarness(pi, { root, append, readJsonl, allocateDecisionId: () => `decision-${++decision}`,
        pendingAssessments: new Map(), resolveBasisRefs: refs => refs,
        taskToolAdapter: { adapterId: "no-adapters", permission: "no_adapter_implementations",
            allowedImplementations: [], execute: async () => { throw new Error("No adapter authorized"); } } });
    if (process.env.PI_ARGUMENT_RESEARCH_INBOX === "1") {
        nonArcTaskSubagents(pi);
        if (!researchWorkers(root).length) {
            const w = assignResearchWorker(root, { worker_id: "delivery-test", responsibility: "Track counterexamples",
                question: "Which counterexample remains unresolved?", research_line_ref: "research_line:delivery-test@v1",
                stop_when: "Diagnostic fixture only", max_runs: 1, max_output_tokens: 100 });
            updateWorker(root, w, { status: "revoked" }); // No diagnostic child is launched.
            appendWorkerRecord(root, "update", { update_id: "delivery-test-u1", version: 1,
                worker_id: "delivery-test", research_line_ref: w.research_line_ref, lifecycle: "active",
                priority: "current", report: { conclusion: "A queued counterexample remains unresolved." } });
        }
    }
    if (process.env.PI_ARGUMENT_RESEARCH_COMPLETION === "1") {
        nonArcTaskSubagents(pi);
        if (!readJsonl("auto-research-sessions.jsonl").length) {
            // Seed a terminal transport state only; no child or ARC behavior is claimed.
            append("auto-research-sessions.jsonl", { session_id: "completion-test", version: 1,
                run_id: "auto-research-1", status: "completed", interaction_mode: "non_blocking",
                report_ref: "research_report:auto-research-1@v1", summary: "An undelivered completion remains actionable.",
                research_line_ref: "research_line:completion-test@v1", open_allocation: false });
            const report = { format: "auto-research-report-v1", conclusion: "An undelivered completion remains actionable.",
                findings: [], method_candidates: process.env.PI_ARGUMENT_COMPLETION_SOURCE === "1" ? [{
                    candidate_ref: "large-successor", name: "large-successor", semantic_kind: "computation",
                    summary: "A provisional successor computation needs an explicit parent trial.", basis_refs: [],
                    method: { steps: ["Return the successor of input.n."], predicted_semantic_result: "Input 6 returns value 7.",
                        falsifier: "The output is not the successor." },
                    program: { format: "task-pure-python-v1", source: "{'value': input['n'] + 1} # " + "x".repeat(12000) },
                }] : [], planning_implications: [] };
            append("auto-research-reports.jsonl", { run_id: "auto-research-1", version: 1, report });
            for (const handoff of buildParentAuthoringHandoffs({ runId: "auto-research-1",
                reportRef: "research_report:auto-research-1@v1", report })) append("parent-authoring-handoffs.jsonl", handoff);
        }
    }
    if (process.env.PI_ARGUMENT_RESEARCH_RUNTIME === "1") nonArcTaskSubagents(pi);
    if (process.env.PI_ARGUMENT_DROP_COMPLETION === "1") {
        pi.on("context", event => ({ messages: event.messages.filter(message =>
            !(Array.isArray(message.content) && message.content.some(part => part.type === "text"
                && part.text.startsWith("AUTO-RESEARCH COMPLETION INBOX")))) }));
    }
    if (process.env.PI_ARGUMENT_DROP_COMPLETION_PAYLOAD === "1") {
        // Return a replacement after the research handler captured its object.
        // This models a real provider-payload extension, not context clipping.
        pi.on("before_provider_request", event => ({ ...event.payload as Record<string, unknown>,
            messages: (event.payload as any).messages.filter((message: any) =>
                !JSON.stringify(message.content).includes("AUTO-RESEARCH COMPLETION INBOX")) }));
    }
    if (process.env.PI_ARGUMENT_LATE_OVERSIZE_PAYLOAD === "1") {
        pi.on("before_provider_request", event => ({ ...event.payload as Record<string, unknown>,
            messages: [...(event.payload as any).messages, { role: "user", content: "x".repeat(150000) }] }));
    }
    pi.registerTool({ name: "ingress_probe", label: "Ingress probe", description: "Record actual executor input.",
        parameters: Type.Object({ marker: Type.String() }),
        async execute(id, params) { append("probe-executions.jsonl", { id, params });
            return { content: [{ type: "text", text: JSON.stringify(params) },
                ...(process.env.PI_ARGUMENT_TELEMETRY === "1" && (params as any).marker === "image" ? [{
                    type: "image" as const, mimeType: "image/png",
                    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                }] : [])] }; } });
    if (process.env.PI_ARGUMENT_DIRECT_USE === "1") pi.registerTool({
        name: "advance_test_level", label: "Advance diagnostic scope", description: "Record a synthetic level transition; no environment action.",
        parameters: Type.Object({}), async execute() {
            append("execution-observations.jsonl", { observation_id: "direct-use-level-change", tool_name: "arc_action",
                input: { action: "ACTION1" }, arc_outcome: { levels_completed: 1, public_transition: { level_changed: true } } });
            return { content: [{ type: "text", text: "Synthetic level changed" }] };
        },
    });
    pi.registerProvider("argument-http-test", {
        api: "openai-completions", apiKey: "offline", baseUrl: process.env.PI_ARGUMENT_HTTP_BASE_URL!,
        models: [{ id: "scripted", name: "scripted", reasoning: false,
            input: process.env.PI_ARGUMENT_TELEMETRY === "1" ? ["text", "image"] : ["text"], contextWindow: 128000,
            maxTokens: Number(process.env.PI_ARGUMENT_MAX_OUTPUT_TOKENS ?? 4096),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    pi.on("session_start", () => {
        const state = process.env.PI_ARGUMENT_PUBLIC_SNAPSHOT
            ? JSON.parse(readFileSync(process.env.PI_ARGUMENT_PUBLIC_SNAPSHOT, "utf8")).public_state
            : { game_id: "g", state: "PLAYING", levels_completed: 0, win_levels: 1,
            guid: "id", full_reset: false, frames: [[[0, 2], [3, 4]]], available_actions: ["ACTION1"],
            agent_available_actions: ["ACTION1"], action_budget: { used: 0, maximum: 10, total_used: 0,
                total_maximum: 10, level: 0, baseline_actions: [5], multiplier: 2 } };
        const states = process.env.PI_ARGUMENT_PUBLIC_SNAPSHOTS
            ? JSON.parse(readFileSync(process.env.PI_ARGUMENT_PUBLIC_SNAPSHOTS, "utf8")) : [state];
        for (const captured of states) registerArcObservationSnapshot(root, captured);
        pi.setActiveTools(["task_harness", "task_harness_create", "ingress_probe",
            ...(process.env.PI_ARGUMENT_DIRECT_USE === "1" && process.env.PI_ARGUMENT_COMPACT_ENTRY !== "1" ? ["task_memory_pool", "advance_test_level"] : []),
            ...(process.env.PI_ARGUMENT_COMPLETION_SOURCE === "1" ? ["task_resource"] : []),
            ...(process.env.PI_ARGUMENT_RESEARCH_RUNTIME === "1" && process.env.PI_ARGUMENT_COMPACT_ENTRY !== "1" ? ["auto_research", "delegate_task"] : [])]);
    });
    pi.on("message_end", event => {
        if (event.message.role === "assistant") append("native-provider-messages.jsonl", event.message);
    });
    pi.on("message_update", (event, ctx) => {
        if (process.env.PI_ARGUMENT_CANCEL_ON_DELTA === "1" && event.assistantMessageEvent.type === "toolcall_delta") ctx.abort();
    });
}
