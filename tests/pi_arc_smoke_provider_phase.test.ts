import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

test("diagnostic phase follows the latest native prompt across terminal continuation and recovery", async (t) => {
    const piPackage = join(dirname(realpathSync(process.execPath)), "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
    if (!existsSync(piPackage)) return t.skip("installed Pi CLI unavailable");
    const piRequire = createRequire(piPackage);
    const { createJiti } = piRequire("jiti");
    const jiti = createJiti(import.meta.url, { alias: {
        "@earendil-works/pi-ai": join(dirname(piPackage), "node_modules", "@earendil-works", "pi-ai", "dist", "index.js"),
    } });
    const base = resolve("tmp/arc-stage123r1-provider-phase");
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, "case-"));
    writeFileSync(join(root, ".task-scope.json"), JSON.stringify({ task_id: "phase-fixture" }));
    const previousRoot = process.env.PI_AUTORESEARCH_E2E_ROOT;
    const previousScenario = process.env.PI_ARC_SMOKE_SCENARIO;
    process.env.PI_AUTORESEARCH_E2E_ROOT = root;
    process.env.PI_ARC_SMOKE_SCENARIO = "minimal_five_pool";
    try {
        const { default: register } = await jiti.import("../tools/arc_harness_smoke_provider.ts");
        const handlers = new Map<string, (event: any) => unknown>();
        let provider: any;
        register({
            on: (name: string, handler: (event: any) => unknown) => handlers.set(name, handler),
            registerProvider: (_name: string, definition: any) => { provider = definition; },
        } as any);
        const model = { ...provider.models[0], api: provider.api, provider: "offline-arc-harness-smoke" };
        // Retained history is deliberately terminal-looking, even on recovery.
        const context = { systemPrompt: "", tools: [], messages: [{ role: "user", content: [
            { type: "text", text: "ARC_TERMINAL_LEVEL_REVIEW: historical review prompt" },
        ] }] };
        const start = (prompt: string) => handlers.get("before_agent_start")?.({ prompt });
        const emit = () => provider.streamSimple(model, context, {}).result();
        start("Ordinary gameplay prompt"); await emit();
        start("  ARC_TERMINAL_LEVEL_REVIEW: read-only outcome analysis"); await emit();
        await emit(); // A provider continuation remains in the same review phase.
        start("Recover gameplay using the latest public state"); await emit();
        start("Discuss ARC_TERMINAL_LEVEL_REVIEW as quoted evidence"); await emit();

        const rows = readFileSync(join(root, "arc-smoke-provider-contexts.jsonl"), "utf8")
            .trim().split("\n").map(line => JSON.parse(line));
        assert.deepEqual(rows.map(row => row.terminal_review), [false, true, true, false, false]);
        assert.deepEqual(rows.map(row => row.request), [0, 1, 2, 3, 4]);
    } finally {
        if (previousRoot === undefined) delete process.env.PI_AUTORESEARCH_E2E_ROOT;
        else process.env.PI_AUTORESEARCH_E2E_ROOT = previousRoot;
        if (previousScenario === undefined) delete process.env.PI_ARC_SMOKE_SCENARIO;
        else process.env.PI_ARC_SMOKE_SCENARIO = previousScenario;
    }
});
