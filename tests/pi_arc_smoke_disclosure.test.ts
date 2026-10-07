import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

test("periodic diagnostic discloses the advertised review contract without skipping its review or next step", async (t) => {
    const piPackage = join(dirname(realpathSync(process.execPath)), "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
    if (!existsSync(piPackage)) return t.skip("installed Pi CLI unavailable");
    const piRequire = createRequire(piPackage);
    const { createJiti } = piRequire("jiti");
    const jiti = createJiti(import.meta.url, { alias: {
        "@earendil-works/pi-ai": join(dirname(piPackage), "node_modules", "@earendil-works", "pi-ai", "dist", "index.js"),
    } });
    const base = resolve("tmp/self-harness-goal-20261007/smoke-disclosure-diagnostic");
    mkdirSync(base, { recursive: true });
    const saved = new Map(["PI_AUTORESEARCH_E2E_ROOT", "PI_ARC_SMOKE_SCENARIO", "PI_ARC_SMOKE_PERIODIC",
        "PI_ARC_SMOKE_CROSS_CONTEXT_METHOD", "PI_TASK_CHILD"].map(name => [name, process.env[name]]));
    process.env.PI_AUTORESEARCH_E2E_ROOT = mkdtempSync(join(base, "case-"));
    writeFileSync(join(process.env.PI_AUTORESEARCH_E2E_ROOT, ".task-scope.json"), JSON.stringify({ task_id: "disclosure-fixture" }));
    process.env.PI_ARC_SMOKE_SCENARIO = "memory";
    process.env.PI_ARC_SMOKE_PERIODIC = "1";
    delete process.env.PI_ARC_SMOKE_CROSS_CONTEXT_METHOD;
    delete process.env.PI_TASK_CHILD;
    try {
        const { default: register } = await jiti.import("../tools/arc_harness_smoke_provider.ts");
        const create = () => {
            let provider: any;
            register({ on: () => {}, registerProvider: (_name: string, definition: any) => { provider = definition; } } as any);
            const model = { ...provider.models[0], api: provider.api, provider: "offline-arc-harness-smoke" };
            const emit = async (actions: any) => {
                const result = await provider.streamSimple(model, { systemPrompt: "", messages: [], tools: [{
                    name: "task_harness", parameters: { type: "object", properties: { action: actions } },
                }] }, {}).result();
                assert.notEqual(result.stopReason, "error", result.errorMessage);
                return result.content[0];
            };
            return emit;
        };
        const core = { type: "string", enum: ["start", "contract", "inspect"] };
        const advanced = { anyOf: [...core.enum, "review", "defer_review"].map(value => ({ const: value })) };
        const emit = create();
        await emit(core); // Start plus the five actual planned actions.
        for (let i = 0; i < 5; i++) assert.equal((await emit(core)).arguments.action, "ACTION1");
        const disclosure = await emit(core);
        assert.equal(disclosure.name, "task_harness");
        assert.deepEqual(disclosure.arguments, { action: "contract", topic: "opportunity" });
        const review = await emit(advanced);
        assert.equal(review.arguments.action, "review");
        assert.deepEqual(review.arguments.review, []);
        const next = await emit(core); // Successful review releases the advanced schema.
        assert.equal(next.name, "task_harness");
        assert.equal(next.arguments.action, "read_method");

        const failed = create();
        for (let i = 0; i < 6; i++) await failed(core);
        assert.equal((await failed(core)).arguments.action, "contract");
        const stopped = await failed(core); // A failed disclosure cannot cause an infinite loop.
        assert.equal(stopped.type, "text");
        assert.match(stopped.text, /review.*not advertised/i);

        const loaded = create();
        for (let i = 0; i < 6; i++) await loaded(advanced);
        assert.equal((await loaded(advanced)).arguments.action, "review");
    } finally {
        for (const [name, value] of saved) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    }
});
