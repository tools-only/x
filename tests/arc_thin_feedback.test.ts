import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeArcThinDelta } from "../demo/arc_thin_feedback.ts";
import arcThinExtension from "../demo/arc_thin_extension.ts";

const delta = (cells: any[]) => ({ frame_available: true, changed_cells: cells.length, cells, cells_truncated: false });
const body = (text: string) => JSON.parse(text.slice(text.indexOf("{")));

test("separate small changes retain exact before/after pixels and colors", () => {
    const text = summarizeArcThinDelta(delta([
        { row: 30, col: 19, before: 3, value: 12 },
        { row: 30, col: 20, before: 3, value: 12 },
        { row: 57, col: 3, before: 9, value: 5 },
        { row: 57, col: 4, before: 9, value: 5 },
        { row: 57, col: 7, before: 5, value: 9 },
    ]));
    const summary = body(text);
    assert.equal(summary.regions.length, 3);
    assert.deepEqual(summary.regions[1], {
        cells: 2, bbox: [3,57,4,57], colors: [[9,5,2]], pixels: [[3,57,9,5],[4,57,9,5]],
    });
    assert.equal(summary.omitted_cells, 0);
    assert.ok(text.length <= 1200);
    assert.doesNotMatch(text, /goal|decorative|collect|progress|player/);
});

test("zero change is distinct from missing, partial, duplicate or invalid evidence", () => {
    assert.match(summarizeArcThinDelta(delta([])), /none/);
    for (const d of [undefined, { changed_cells: 0, frame_available: false },
        { ...delta([]), changed_cells: 2 },
        { ...delta([{ row: 0, col: 0, before: 0, value: 1 }]), cells_truncated: true },
        delta([{ row: 0, col: 0, value: 1 }]),
        delta([{ row: 0, col: 0, before: 0, value: 1 }, { row: 0, col: 0, before: 0, value: 1 }]),
        delta([{ row: -1, col: 0, before: 0, value: 1 }]),
        delta([{ row: 0, col: 0, before: 1, value: 1 }]),
    ]) assert.match(summarizeArcThinDelta(d), /unavailable/);
});

test("many regions and large color diversity remain bounded with honest omissions", () => {
    for (const cells of [
        Array.from({length:64}, (_, i) => ({ row: 2 * Math.floor(i/8), col: 2 * (i%8), before: 0, value: 1 })),
        Array.from({length:4096}, (_, i) => ({ row: Math.floor(i/64), col: i%64, before: i%16, value: (i+1)%16 })),
        Array.from({length:4096}, (_, i) => ({ row: Math.floor(i/64), col: i%64,
            before: Math.floor(i/15)%16, value: (Math.floor(i/15)%16+i%15+1)%16 })),
    ]) {
        const text = summarizeArcThinDelta(delta(cells)), summary = body(text);
        assert.ok(text.length <= 1200);
        assert.ok(summary.regions.length <= 8);
        assert.equal(summary.regions.reduce((n: number, r: any) => n+r.cells,0)+summary.omitted_cells,cells.length);
    }
});

test("real ls20 trace preserves overlooked indicator changes and rejects false movement", () => {
    const actions = JSON.parse(readFileSync(new URL("./fixtures/arc_thin_ls20_deltas.json", import.meta.url), "utf8"));
    assert.equal(actions.length, 7);
    for (const action of actions) {
        const summary = body(summarizeArcThinDelta(action.observation_delta));
        assert.equal(summary.regions.reduce((n: number,r: any) => n+r.cells,0)+summary.omitted_cells,
            action.observation_delta.changed_cells);
    }
    for (const i of [17,21,37]) {
        const summary = body(summarizeArcThinDelta(actions.find((a: any) => a.index===i).observation_delta));
        const indicator = summary.regions.filter((r: any) => r.bbox[0]<=10 && r.bbox[1]>=53 && r.bbox[3]<=60);
        assert.equal(indicator.reduce((n: number,r: any) => n+r.cells,0),8);
        assert.ok(indicator.every((r: any) => r.pixels.length === r.cells));
    }
    for (const i of [12,26]) {
        const summary = body(summarizeArcThinDelta(actions.find((a: any) => a.index===i).observation_delta));
        assert.equal(summary.regions.length,1);
        assert.equal(summary.regions[0].cells,2);
        assert.equal(summary.regions[0].bbox[1],61);
    }
});

test("latest feedback survives restart in both variants, preserves the frame and suppresses stale evidence", async () => {
    const oldFetch = globalThis.fetch;
    const oldRoot = process.env.ARC_RUN_ROOT, oldVariant = process.env.ARC_THIN_VARIANT;
    const oldUrl = process.env.PI_ARC_BRIDGE_URL;
    try {
        for (const variant of ["treatment", "control"]) {
            const root = mkdtempSync(join(tmpdir(), "arc-thin-feedback-"));
            mkdirSync(join(root,"harness"));
            const changes = summarizeArcThinDelta(delta([{ row: 0, col: 0, before: 0, value: 1 }]));
            writeFileSync(join(root,"harness/trajectory.jsonl"), JSON.stringify({
                n: 1, decision: 1, action: "ACTION1", changed_cells: 1, level_changed: false,
                state: "NOT_FINISHED", levels_completed: 0, budget: { total_used: 1 }, changes,
            })+"\n");
            process.env.ARC_RUN_ROOT = root; process.env.ARC_THIN_VARIANT = variant;
            process.env.PI_ARC_BRIDGE_URL = "http://fixture.invalid";
            const handlers = new Map<string, any>(), tools = new Map<string, any>();
            arcThinExtension({ on(name: string, fn: any) { handlers.set(name,fn); },
                registerTool(tool: any) { tools.set(tool.name,tool); }, setActiveTools() {} } as any);
            // run_skill is registered only once a skill is saved (arc_thin_skill_surface.test.ts).
            assert.equal(tools.size,variant==="control" ? 1 : 5);
            let used = 1;
            globalThis.fetch = async () => new Response(JSON.stringify({ state: "NOT_FINISHED",
                frames: [[[1,0],[0,9]]], levels_completed: 0, action_budget: { total_used: used } }));
            const context = async () => {
                await handlers.get("before_agent_start")({prompt:"Decide the next action."});
                return handlers.get("context")({messages:[{role:"user",content:"Decide the next action."}]},
                    {model:{input:["text","image"]}});
            };
            const fresh = await context(), content = fresh.messages[0].content;
            assert.ok(content[0].text.includes(`LATEST ACTION #1 ACTION1\n${changes}`));
            assert.equal(content[0].text.split("PIXEL CHANGES").length-1,1);
            assert.match(content[0].text,/r00: c00=1 c01=0/);
            assert.match(content[0].text,/r01: c00=0 c01=9/);
            assert.equal(content[1].type,"image");
            used = 2;
            const stale = await context();
            assert.doesNotMatch(stale.messages[0].content[0].text,/LATEST ACTION|PIXEL CHANGES/);
            assert.equal(stale.messages[0].content[1].data,content[1].data);
        }
    } finally {
        globalThis.fetch = oldFetch;
        for (const [key,value] of [["ARC_RUN_ROOT",oldRoot],["ARC_THIN_VARIANT",oldVariant],["PI_ARC_BRIDGE_URL",oldUrl]]) {
            if (value===undefined) delete process.env[key!]; else process.env[key!]=value;
        }
    }
});
