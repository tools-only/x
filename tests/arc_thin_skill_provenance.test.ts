/** Real extension + Python guest, fake ARC transport. Reproduce a batched action
 * completing while save-and-run or run_skill still computes its old input. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import arcThinExtension from "../demo/arc_thin_extension.ts";

const SOURCE = `def run(state, args):
    total = 0
    for i in range(1000000):
        total += i
    cell = state['grid'][0][0]
    return {'cell': cell, 'artifacts': {'position': cell}}
`;

test("concurrent action never retags old skill output as the new state", async () => {
    const root = mkdtempSync(join(tmpdir(), "thin-provenance-"));
    process.env.ARC_RUN_ROOT = root;
    process.env.ARC_THIN_VARIANT = "treatment";
    process.env.PI_ARC_BRIDGE_URL = "http://provenance-fixture.invalid";
    process.env.ARC_HARNESS_LEDGER = "enabled";
    process.env.ARC_HARNESS_CRITIC = "disabled";
    let action = 0;
    const frame = () => ({ state: "NOT_FINISHED", levels_completed: 0, frames: [[[action]]],
        agent_available_actions: ["ACTION1"], action_budget: { used: action, total_used: action } });
    mock.method(globalThis, "fetch", async (url: any) => {
        if (String(url).endsWith("/action")) action++;
        return new Response(JSON.stringify(frame()), { status: 200 });
    });
    const tools = new Map<string, any>(), handlers = new Map<string, any>();
    let active: string[] = [];
    arcThinExtension({ registerTool(t: any) { tools.set(t.name, t); },
        on(e: string, f: any) { handlers.set(e, f); },
        setActiveTools(ns: string[]) { active = ns; }, getActiveTools: () => active,
        getThinkingLevel: () => "off" } as any);
    const call = (name: string, args: any) => tools.get(name).execute("call", args, undefined, undefined, {});
    const rows = (name: string) => {
        const path = join(root, "harness", `${name}.jsonl`);
        return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    };
    await handlers.get("session_start")({}, {});
    await handlers.get("before_agent_start")({ prompt: "Decide the next action." }, {});
    let finished = false;
    const saving = call("skill", { op: "set", name: "position", source: SOURCE }).then((r: any) => { finished = true; return r; });
    // The registry write happens after syntax checking, just before execution.
    const deadline = Date.now() + 15000;
    while (!rows("skills").length && Date.now() < deadline) await delay(5);
    assert.equal(rows("skills").length, 1);
    await call("arc_action", { action: "ACTION1" });
    assert.equal(finished, false, "fixture must exercise overlapping evaluation and action");
    const receipt = await saving;
    assert.match(receipt.content[0].text, /Evaluation used state 0; current state is 1/);
    const saved = rows("skill_runs").find(r => r.automatic === "save");
    assert.equal(saved.state_n, 0);
    assert.ok(rows("observations").some(r => r.n === 0 && r.value?.cell === 0));
    assert.ok(rows("artifacts").some(r => r.n === 0 && r.value === 0));
    await handlers.get("before_agent_start")({ prompt: "Decide the next action." }, {});
    // The automatic observer/backfill must still compute the new state.
    const observeDeadline = Date.now() + 15000;
    while (!rows("observations").some(r => r.n === 1) && Date.now() < observeDeadline) await delay(10);
    assert.ok(rows("observations").some(r => r.n === 1 && r.value?.cell === 1));
    finished = false;
    const running = call("run_skill", { name: "position" }).then((r: any) => { finished = true; return r; });
    await call("arc_action", { action: "ACTION1" });
    assert.equal(finished, false);
    const runReceipt = await running;
    assert.match(runReceipt.content[0].text, /Evaluation used state 1; current state is 2/);
    const explicit = rows("skill_runs").filter(r => !r.automatic);
    assert.equal(explicit.at(-1).state_n, 1);
    assert.ok(!rows("artifacts").some(r => r.n === 2 && r.value === 1));
});
