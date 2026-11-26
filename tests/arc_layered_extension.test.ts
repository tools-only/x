import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compactHistory, compressedTrajectory, evict, extractTags, fold, foldPreActionObservations, framePng, installLayered, MEMORY_TYPE, NOTEBOOK_TYPE, STATE_TYPE } from "../demo/arc_layered_extension.ts";

const grid = Array.from({ length: 64 }, () => Array(64).fill(0));

function setup(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, any> = {}, sent: any[] = [], entries: any[] = [], tools: Record<string, any> = {};
  const pi: any = { on: (name: string, handler: any) => { handlers[name] = handler; }, registerTool: (definition: any) => { tools[definition.name] = definition; },
    sendMessage: (message: any, options: any) => sent.push({ message, options }),
    appendEntry: (type: string, data: any) => entries.push({ type, data }) };
  const game: any = { level: 1, levels_completed: 0, win_levels: 3, state: "NOT_FINISHED", step: 0, actions_used: 0, budget_left: 40,
    valid_actions: ["UP", "RESET"], frame: grid, stale_steps: 0 };
  const python: any = { next: null, runs: 0, init: async () => game, state: () => game, takeMiniReview: () => { const review = game.mini_review; game.mini_review = null; return review; }, close() {},
    async run() { this.runs += 1; return { text: "ok", truncated: false, acted: this.next, images: [], metrics: {},
      ...(this.reviews ? { reviews: this.reviews } : {}) }; } };
  const root = (overrides.root as string) ?? mkdtempSync(join(tmpdir(), "layered-"));
  installLayered(pi, python, { scale: 4, gridLines: false, reminder: false, contextTarget: 0, idleContinuations: 2, segmentSeconds: 600,
    segmentTokens: 100000, maxActionsPerCall: 16, outputTokens: 0, root, stuckAfter: 8, foldAfter: 3, compactMargin: 16384,
    notebook: false, ...overrides } as any);
  const rows = (kind: string) => readFileSync(join(root, "harness", "layered.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    .filter(row => row.kind === kind);
  return { handlers, sent, entries, game, python, rows, root, tools, tool: () => tools.python,
    call: () => tools.python.execute("id", { code: "x" }, undefined, undefined, {}) };
}
const batch = (extra = {}) => ({ executed: 12, actions: Array(12).fill("UP"), lines: [], level_changed: false, game_over: false, win: false, ...extra });
const say = (text: string, extra = {}) => ({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }],
  usage: { input: 10, output: 5, totalTokens: 15 }, ...extra } });
const settle = { type: "agent_before_settle", outcome: "completed", entries: [], continue: false };
const textOf = (content: any[]) => content.filter(part => part.type === "text").map(part => part.text).join("\n");

test("the run opens with the replaced system prompt and a state message with an image", async () => {
  const { handlers, tool } = setup();
  const opened = await handlers.before_agent_start({});
  assert.match(opened.systemPrompt, /submit_actions/);
  assert.ok(opened.systemPrompt.length <= 5500);
  assert.doesNotMatch(opened.systemPrompt, /\{\{/);
  assert.equal(opened.message.customType, STATE_TYPE);
  assert.match(textOf(opened.message.content), /Level 1 of 3 \| NOT_FINISHED \| step 0 \| actions used 0 \| run budget left 40/);
  assert.doesNotMatch(textOf(opened.message.content), /\{\{|Last batch/);
  assert.equal(opened.message.content[1].type, "image");
  assert.deepEqual(Object.keys(tool().parameters.properties), ["code"]);
  assert.deepEqual(handlers.session_before_compact(), { cancel: true });
});

test("text observation mode sends a complete frame initially and delta-only on subsequent steps", async () => {
  const { handlers, game, python, call } = setup({ noImage: true });
  game.frame[0][0] = 3;
  const opened = await handlers.before_agent_start({});
  assert.equal(opened.message.content.length, 1);
  assert.match(textOf(opened.message.content), /Frame 64x64:\n3/);
  python.next = batch({ executed: 1, actions: ["UP"] });
  game.frame = game.frame.map((row: number[]) => [...row]);
  game.frame[0][0] = 4;
  await call();
  const next = await handlers.before_agent_start({});
  assert.equal(next.message.content.length, 1);
  assert.match(textOf(next.message.content), /Changed cells \(1\): 0,0:3→4/);
  assert.doesNotMatch(textOf(next.message.content), /Frame 64x64:/);
});

test("harness profile reflects memory and injects its active version", async () => {
  const { handlers, tools } = setup({ harnessProfile: true });
  assert.ok(tools.reflect_component);
  assert.ok(tools.read_component);
  assert.ok(tools.consult);
  const first = await handlers.before_agent_start({});
  assert.match(first.systemPrompt, /Five harness components/);
  const saved = await tools.reflect_component.execute("id", { op: "define", kind: "memory", name: "current", body: "H1: test next" });
  assert.match(saved.content[0].text, /memory\/current v1/);
  const read = await tools.read_component.execute("id", { kind: "memory", name: "current" });
  assert.match(read.content[0].text, /H1: test next/);
  const next = await handlers.before_agent_start({});
  assert.match(textOf(next.message.content), /MEMORY current v1: H1: test next/);
});

test("context exposes current component revisions and skill index after an older state survives", async () => {
  const { handlers, tools, rows } = setup({ harnessProfile: true });
  await handlers.before_agent_start({});
  await tools.reflect_component.execute("id", { op: "define", kind: "memory", name: "current", body: "first" });
  await tools.reflect_component.execute("id", { op: "define", kind: "skill", name: "probe", body: "inspect once", summary: "single inspection" });
  const old = (await handlers.before_agent_start({})).message;
  await tools.reflect_component.execute("id", { op: "redefine", kind: "memory", name: "current", body: "revised" });
  await tools.reflect_component.execute("id", { op: "redefine", kind: "skill", name: "probe", body: "inspect then act", summary: "act after inspection" });
  const out = handlers.context({ messages: [old] }, { model: { contextWindow: 128000 } }).messages;
  assert.match(textOf(out[0].content), /MEMORY current v2: revised/);
  assert.match(textOf(out[0].content), /SKILLS: probe — act after inspection \(v2\)/);
  assert.equal(rows("live_injected").filter(row => row.component_kind === "memory").at(-1).version, 2);
});

test("a conforming work library function is published and bound", async () => {
  const root = mkdtempSync(join(tmpdir(), "layered-tool-"));
  mkdirSync(join(root, "work", "lib"), { recursive: true });
  writeFileSync(join(root, "work", "lib", "count.py"), "def count(args):\n    return len(args)\n");
  writeFileSync(join(root, "work", "lib", "ping.py"), "def ping():\n    return 'pong'\n");
  const { handlers, tools, python, rows } = setup({ root, harnessProfile: true });
  await handlers.before_agent_start({});
  assert.ok(tools.count);
  assert.ok(tools.ping);
  assert.match(readFileSync(join(root, "harness", "components", "tool", "count", "v1.json"), "utf8"), /def count/);
  const invoked = await tools.count.execute("id", { args: { a: 1 } });
  const pinged = await tools.ping.execute("id", {});
  assert.match(textOf(invoked.content), /ok/);
  assert.match(textOf(pinged.content), /ok/);
  assert.equal(python.runs, 2);
  assert.equal(rows("bound_invocation")[0].ok, true);
  assert.equal(rows("bound_invocation")[1].ok, true);
  const failed = setup({ root: mkdtempSync(join(tmpdir(), "layered-failed-tool-")), harnessProfile: true });
  mkdirSync(join(failed.root, "work", "lib"), { recursive: true });
  writeFileSync(join(failed.root, "work", "lib", "broken.py"), "def broken(args):\n    raise ValueError('bad input')\n");
  failed.python.run = async () => ({ text: "ValueError: bad input", error: "ValueError: bad input", acted: null, images: [], metrics: {}, truncated: false });
  await failed.handlers.before_agent_start({});
  assert.equal((await failed.tools.broken.execute("id", { args: {} })).isError, true);
  assert.equal(failed.rows("bound_invocation")[0].ok, false);
});

test("consult uses the parent model once without action tools and enforces the level limit", async () => {
  const { handlers, tools, rows } = setup({ harnessProfile: true, outputTokens: 4096 });
  await handlers.before_agent_start({});
  await tools.reflect_component.execute("id", { op: "define", kind: "memory", name: "notes", body: "Confirmed: x\nFalsified: UP does nothing" });
  const model = { id: "same-model" };
  let calls = 0;
  const ctx: any = { model, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: "test", headers: {} }),
    streamSimple: (selected: any, input: any, options: any) => {
      calls += 1;
      assert.equal(selected, model);
      assert.deepEqual(input.tools, []);
      assert.equal(options.maxTokens, 4096);
      assert.equal(input.messages[0].content.some((p: any) => p.type === "image"), true);
      assert.match(input.messages[0].content[0].text, /Valid actions \(propose ONLY from this set\): UP RESET/);
      assert.match(input.messages[0].content[0].text, /Falsified: \[notes\] Falsified: UP does nothing/);
      return { result: async () => ({ content: [{ type: "text", text: "two explanations" }], stopReason: "stop",
        usage: { input: 30, output: 10, totalTokens: 40 } }) };
    } } };
  for (let i = 0; i < 2; i++) {
    const result = await tools.consult.execute("id", { name: "reframer", question: "What changed?" }, undefined, undefined, ctx);
    assert.match(result.content[0].text, /two explanations/);
  }
  const blocked = await tools.consult.execute("id", { name: "reframer", question: "Again" }, undefined, undefined, ctx);
  assert.equal(blocked.isError, true);
  assert.equal(calls, 2);
  assert.equal(rows("consult").filter(row => row.ok).length, 2);
  assert.deepEqual((await tools.consult.execute("id", { name: "reframer", question: "Again" }, undefined, undefined, ctx)).isError, true);
});

test("consult limit persists across a resumed session and can be disabled for B1", async () => {
  const root = mkdtempSync(join(tmpdir(), "layered-consult-"));
  const first = setup({ root, harnessProfile: true });
  await first.handlers.before_agent_start({});
  const ctx: any = { model: { id: "same-model" }, modelRegistry: {
    getApiKeyAndHeaders: async () => ({ apiKey: "test", headers: {} }),
    streamSimple: () => ({ result: async () => ({ content: [], stopReason: "stop", usage: {} }) }) } };
  await first.tools.consult.execute("id", { name: "reframer", question: "First" }, undefined, undefined, ctx);
  const resumed = setup({ root, harnessProfile: true });
  await resumed.handlers.before_agent_start({});
  await resumed.tools.consult.execute("id", { name: "reframer", question: "Second" }, undefined, undefined, ctx);
  assert.equal((await resumed.tools.consult.execute("id", { name: "reframer", question: "Third" }, undefined, undefined, ctx)).isError, true);
  const b1 = setup({ harnessProfile: true, consult: false });
  assert.equal(b1.tools.consult, undefined);
  assert.ok(b1.tools.reflect_component);
  assert.ok(b1.tools.read_component);
});

test("whole-level trajectory keeps first change, death and final steps within its cap", () => {
  const steps = Array.from({ length: 50 }, (_, i) => ({ step: i + 1, action: "UP", tries: i, same: i > 0,
    new: i === 0, death: i === 29, level_up: false, source: null, predict_off: null,
    claims_failed: [], claims_held: [] })) as any;
  const summary = compressedTrajectory(steps);
  assert.ok(summary.length <= 3000);
  assert.match(summary, /s1 UP/);
  assert.match(summary, /s30 UP.*DEATH/);
  assert.match(summary, /s48 UP/);
  assert.match(summary, /s50 UP/);
  assert.match(summary, /s3–s29/);
  assert.match(summary, /no-new-interior-state/);
  assert.match(summary, /unchanged-frame/);
});

test("long trajectory preserves critical markers within the character budget", () => {
  const steps = Array.from({ length: 180 }, (_, i) => ({ step: i + 1, action: "UP", tries: i,
    same: i > 0, changed: i === 0, new: i === 0, death: i % 7 === 0 && i > 0, level_up: false,
    source: "long_method_name", predict_off: null, claims_failed: [], claims_held: [] })) as any;
  const summary = compressedTrajectory(steps);
  assert.ok(summary.length <= 3000);
  assert.match(summary, /s1 UP/);
  assert.match(summary, /s176 UP.*DEATH/);
  assert.match(summary, /s178 UP/);
  assert.match(summary, /s180 UP/);
});

test("the gradient line is appended to state messages when enabled", async () => {
  const { handlers, python } = setup({ gradient: true });
  python.gradient = () => ({ actions_this_level: 5, budget_left: 40, surprises: 1, unchecked_batches: 2,
    repeated_sequences: 0, expect_hits: "1/2" });
  const opened = await handlers.before_agent_start({});
  assert.match(textOf(opened.message.content),
    /Gradient: 5 actions this level \(budget left 40\) · surprises 1 · unchecked batches 2 · repeated routes 0 · expect hits 1\/2/);
});

test("only an acting call ends the decision, and a second call in the same reply is not run", async () => {
  const { handlers, sent, python, game, rows, call } = setup({ reminder: true, flags: { tags: true } });
  await handlers.before_agent_start({});
  handlers.turn_start();
  await call();
  assert.equal(sent.length, 0);
  python.next = batch({ stop_reason: "stop_on" });
  game.step = game.actions_used = 12; game.budget_left = 3;
  const acted = await call();
  assert.equal(acted.terminate, true);
  assert.equal(sent.length, 0);
  const refused = await call();
  assert.match(refused.content[0].text, /^Not run/);
  assert.equal(python.runs, 2);
  const opened = await handlers.before_agent_start({});
  const text = textOf(opened.message.content);
  assert.match(text, /Last batch: 12 executed: (UP ){9}UP \(\+2 more\); stopped: stop_on/);
  assert.match(text, /BUDGET: 3 actions left/);
  assert.match(text, /Start your reply with updated/);
  assert.equal(opened.message.content[1].type, "image");
  handlers.turn_start();
  python.next = null;
  await call();
  assert.equal(python.runs, 3);
  assert.deepEqual(rows("python").map(row => [row.acted, row.actions, row.stop_reason]),
    [[false, 0, null], [true, 12, "stop_on"], [false, 0, null]]);
});

test("a level change ends the segment and the next segment opens with it", async () => {
  const { handlers, sent, python, game, rows, call } = setup();
  await handlers.before_agent_start({});
  python.next = batch({ executed: 1, actions: ["UP"], level_changed: true, stop_reason: "level_change" });
  game.levels_completed = 1; game.level = 2;
  assert.equal((await call()).terminate, true);
  assert.equal(sent.length, 0);
  assert.equal(handlers.agent_before_settle(settle), undefined);
  handlers.agent_settled();
  assert.equal(rows("segment_end")[0].reason, "level_change");
  const opened = await handlers.before_agent_start({});
  assert.match(textOf(opened.message.content), /LEVEL COMPLETE: 1 of 3[\s\S]*Last batch: 1 executed: UP; stopped: level_change/);
});

test("game over ends the decision and is announced next", async () => {
  const { handlers, sent, python, game, call } = setup();
  await handlers.before_agent_start({});
  python.next = batch({ game_over: true, stop_reason: "game_over" });
  game.state = "GAME_OVER";
  assert.equal((await call()).terminate, true);
  assert.equal(sent.length, 0);
  assert.match(textOf((await handlers.before_agent_start({})).message.content), /GAME_OVER: this attempt FAILED/);
});

test("note blocks are overwritten one by one, carried and persisted", async () => {
  const { handlers, entries, python, sent, call } = setup();
  await handlers.before_agent_start({});
  handlers.message_end(say("World model: walls are gray\nsecond line\n\n**Plan:** go up"));
  handlers.message_end(say("## Plan\ngo left"));
  handlers.message_end(say("no blocks here"));
  assert.deepEqual(entries.map(entry => entry.type), [MEMORY_TYPE, MEMORY_TYPE]);
  assert.deepEqual(entries[1].data, { "World model": "walls are gray\nsecond line", Plan: "go left" });
  python.next = batch();
  await call();
  assert.match(textOf((await handlers.before_agent_start({})).message.content), /World model: walls are gray\nsecond line\nPlan: go left/);
  assert.deepEqual(extractTags("The plan is simple.\nPlanning ahead"), {});
});

test("eviction drops whole user blocks, keeps call/result pairs and the latest state, strips older images", () => {
  const image = { type: "image", data: "x", mimeType: "image/png" };
  const block = (id: string) => [{ role: "custom", customType: STATE_TYPE, content: [{ type: "text", text: id }, image] },
    { role: "assistant", content: [{ type: "text", text: "a".repeat(4000) }, { type: "toolCall", id, name: "python", arguments: { code: "x" } }] },
    { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "r".repeat(4000) }] }];
  const messages = [{ role: "user", content: "Begin." }, ...block("1"), ...block("2"), ...block("3")];
  const all = evict(messages, 1e9, 1e9, 0);
  assert.equal(all.messages.length, messages.length);
  assert.deepEqual(all.messages.map((message: any) => Array.isArray(message.content) && message.content.includes(image)).filter(Boolean).length, 1);
  const some = evict(messages, 5500, 5500, 0);
  assert.equal(some.messages[0].content[0].text, "2");
  const tight = evict(messages, 10, 10, 0);
  assert.equal(tight.messages[0].content[0].text, "3");
  assert.deepEqual(tight.messages.at(-1).toolCallId, "3");
  assert.equal(evict(messages, 1e9, 1e9, 2).messages[0].content[0].text, "2");
  for (const result of [all, some, tight]) {
    const calls = result.messages.filter((m: any) => m.role === "assistant").flatMap((m: any) => m.content.filter((p: any) => p.type === "toolCall").map((p: any) => p.id));
    assert.deepEqual(calls, result.messages.filter((m: any) => m.role === "toolResult").map((m: any) => m.toolCallId));
  }
});

test("a context overflow error makes the next request drop one more block", async () => {
  const { handlers, rows } = setup({ contextTarget: 1e9 });
  await handlers.before_agent_start({});
  const messages = ["1", "2"].map(text => ({ role: "custom", customType: STATE_TYPE, content: [{ type: "text", text }] }));
  assert.equal(handlers.context({ messages }, {}).messages.length, 2);
  handlers.message_end(say("", { stopReason: "error", errorMessage: "maximum context length exceeded" }));
  const recovered = handlers.context({ messages }, {}).messages;
  assert.equal(recovered.length, 2);
  assert.match(recovered[0].content[0].text, /Earlier context was trimmed/);
  assert.equal(handlers.context({ messages }, {}).messages.length, 2);
  assert.equal(rows("evict").length, 1);
  handlers.agent_settled();
  assert.equal(rows("segment_end")[0].reason, "context_overflow");
});

test("eviction keeps its cut until the retained window exceeds the cap", () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({ role: "user", content: `block ${index} ${"x".repeat(80)}` }));
  const first = evict(messages.slice(0, 8), 70, 30, 0);
  const stable = evict(messages.slice(0, 9), 70, 30, 0, first.cut);
  assert.equal(stable.cut, first.cut);
  const moved = evict(messages, 70, 30, 0, stable.cut);
  assert.ok(moved.cut >= stable.cut);
});

test("segment_end flags an oversized raw session relative to the model cap", async () => {
  const { handlers, rows } = setup({ contextCap: 100, contextTarget: 50, rollAfter: 2 });
  await handlers.before_agent_start({});
  const messages = Array.from({ length: 30 }, (_, i) => (
    { role: "custom", customType: STATE_TYPE, content: [{ type: "text", text: `state ${i} ${"x".repeat(40)}` }] }));
  handlers.context({ messages }, {});
  handlers.agent_settled();
  const end = rows("segment_end")[0];
  assert.equal(end.roll_threshold, 200);
  assert.equal(end.session_oversized, true);
  assert.ok(end.raw_estimate > 200);
  const small = setup({ contextCap: 100, contextTarget: 50, rollAfter: 2 });
  await small.handlers.before_agent_start({});
  small.handlers.context({ messages: messages.slice(0, 2) }, {});
  small.handlers.agent_settled();
  assert.equal(small.rows("segment_end")[0].session_oversized, false);
});

test("continuation is bounded by idle count, action budget, soft limits, length stops and outcome", async () => {
  const idle = setup();
  await idle.handlers.before_agent_start({});
  for (let count = 0; count < 2; count += 1) {
    const result = idle.handlers.agent_before_settle(settle);
    assert.equal(result.continue, true);
    assert.match(textOf(result.entries[0].content), /^You stopped without taking an action[\s\S]*Level 1 of 3/);
  }
  assert.equal(idle.handlers.agent_before_settle(settle), undefined);
  idle.handlers.agent_settled();
  assert.equal(idle.rows("segment_end")[0].reason, "idle");
  idle.python.next = batch();
  await idle.handlers.before_agent_start({});
  await idle.call();
  assert.equal(idle.handlers.agent_before_settle(settle), undefined);
  assert.equal(idle.handlers.agent_before_settle({ ...settle, outcome: "aborted" }), undefined);
  idle.handlers.message_end(say("cut", { stopReason: "length" }));
  assert.equal(idle.handlers.agent_before_settle(settle), undefined);

  const spent = setup();
  await spent.handlers.before_agent_start({});
  spent.game.budget_left = 0;
  assert.equal(spent.handlers.agent_before_settle(settle), undefined);
  const tokens = setup({ segmentTokens: 15 });
  await tokens.handlers.before_agent_start({});
  tokens.handlers.message_end(say("hi"));
  assert.equal(tokens.handlers.agent_before_settle(settle), undefined);
});

test("frames are scaled PNGs", () => {
  const png = framePng(grid, 8, true);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [528, 524]);
  const plain = framePng(grid, 4, false);
  assert.deepEqual([plain.readUInt32BE(16), plain.readUInt32BE(20)], [grid[0].length * 4, grid.length * 4]);
});

test("stuck steps raise an escalating STUCK event", async () => {
  const { handlers, game } = setup();
  game.stale_steps = 8;
  assert.match(textOf((await handlers.before_agent_start({})).message.content),
    /STUCK: 8 steps without a new state\. Before acting: which layer is failing[\s\S]*harness_state/);
  game.stale_steps = 17;
  assert.match(textOf((await handlers.before_agent_start({})).message.content), /STUCK: 17 steps[\s\S]*Enumerate 2-3 alternative framings/);
  game.stale_steps = 40;
  assert.match(textOf((await handlers.before_agent_start({})).message.content), /STUCK: 40 steps[\s\S]*Stop and review in full/);
});

test("a review freeze shows in the state message and echoes an active revision", async () => {
  const { handlers, sent, python, game, call, root } = setup({ flags: { review: true } });
  const opened = await handlers.before_agent_start({});
  assert.match(opened.systemPrompt, /REVIEW REQUIRED[\s\S]*Active revision/);
  handlers.turn_start();
  game.review_required = "GAME_OVER number 2 on this level";
  python.next = batch({ executed: 1, actions: ["UP"], stop_reason: "review required" });
  python.reviews = [{ t: "now", trigger: "GAME_OVER number 2 on this level", layer: "representation",
    diagnosis: "the moving strip is a timer", evidence: [3], change: "treat the top strip as HUD",
    test: "interior unchanged when the strip ticks" }];
  await call();
  const text = textOf(sent[0].message.content);
  assert.match(text, /REVIEW REQUIRED \(GAME_OVER number 2 on this level\)[\s\S]*review\(layer=/);
  assert.match(text, /Active revision: treat the top strip as HUD/);
  const row = JSON.parse(readFileSync(join(root, "harness", "review.jsonl"), "utf8").trim());
  assert.equal(row.layer, "representation");
  assert.equal(row.trigger, "GAME_OVER number 2 on this level");
  const logMd = readFileSync(join(root, "work", "review_log.md"), "utf8");
  assert.match(logMd, /layer: representation[\s\S]*treat the top strip as HUD/);
  python.reviews = undefined;
  handlers.turn_start();
  python.next = batch({ executed: 1, actions: ["UP"], review_test: "untested" });
  await call();
  const next = textOf(sent[1].message.content);
  assert.match(next, /Review test: untested/);
  assert.doesNotMatch(next, /Active revision/);
});

test("a surprise batch is announced with the running hit rate", async () => {
  const { handlers, sent, python, call } = setup();
  await handlers.before_agent_start({});
  handlers.turn_start();
  python.next = batch({ surprise: true, expect_hits: "7/10", stop_reason: "surprise" });
  await call();
  const text = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(text, /SURPRISE: the last action did not match expect/);
  assert.match(text, /Expectations: 7\/10 recent predictions held/);
});

test("folding collapses old tool results to their env line and strips their images", () => {
  const block = (id: string, text: string) => [{ role: "user", content: [{ type: "text", text: id }] },
    { role: "assistant", content: [{ type: "toolCall", id, name: "python", arguments: {} }] },
    { role: "toolResult", toolCallId: id, content: [{ type: "text", text }, { type: "image", data: "x", mimeType: "image/png" }] }];
  const messages = [...block("1", "noise\n[env] executed 1 | level 1"), ...block("2", "only noise"), ...block("3", "recent")];
  const { messages: out, folded } = fold(messages, 1);
  assert.equal(folded, 3);
  assert.match(out[2].content[0].text, /^\[env\] executed 1 \| level 1\n\[folded \d+ chars\]$/);
  assert.equal(out[5].content[0].text, "only noise");
  assert.equal(out[5].content.length, 1);
  assert.equal(out[2].content.length, 1);
  assert.deepEqual(out[8], messages[8]);
  assert.equal(fold(messages, 0).folded, 0);
});

test("near the window the history is compacted into one summary message plus the last block", async () => {
  const { handlers, rows, root } = setup({ contextCap: 1e9, contextTarget: 1e9 });
  await handlers.before_agent_start({});
  handlers.message_end(say("World model: gray walls block movement"));
  const block = (text: string) => [{ role: "custom", customType: STATE_TYPE, content: [{ type: "text", text }] },
    { role: "assistant", content: [{ type: "text", text: "t".repeat(400) }] }];
  const messages = [...block("one"), ...block("two"), ...block("three")];
  const out = handlers.context({ messages }, { model: { contextWindow: 16500 } }).messages;
  assert.equal(out.length, 3);
  assert.match(out[0].content[0].text, /^Earlier history was compacted away[\s\S]*World model: gray walls[\s\S]*Progress: level 1 of 3/);
  assert.equal(out[1].content[0].text, "three");
  assert.equal(rows("compact").length, 1);
  const snapshot = readFileSync(join(root, "harness", "context.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(snapshot.at(-1).messages.length, 3);
  assert.equal(typeof snapshot.at(-1).total_estimate, "number");
  assert.equal(compactHistory([{ role: "user", content: [] }], "s"), null);
});

test("compaction carries the claims ledger, open hypotheses and review pointer", async () => {
  const { handlers, python } = setup({ contextCap: 1e9, contextTarget: 1e9 });
  python.evolutionDigest = () => "Durable knowledge in work/: up_moves: validated (3 support / 0 counter / 3 checked) [game scale] | unresolved hypotheses to probe next: down_noop | past reviews: work/review_log.md";
  await handlers.before_agent_start({});
  const block = (text: string) => [{ role: "custom", customType: STATE_TYPE, content: [{ type: "text", text }] },
    { role: "assistant", content: [{ type: "text", text: "t".repeat(400) }] }];
  const out = handlers.context({ messages: [...block("one"), ...block("two")] }, { model: { contextWindow: 16500 } }).messages;
  assert.match(out[0].content[0].text, /up_moves: validated[\s\S]*down_noop[\s\S]*work\/review_log\.md/);
});

test("the notebook tool patches sections, persists them and the state message carries them", async () => {
  const { handlers, tools, entries } = setup({ notebook: true });
  await tools.notebook.execute("id", { op: "replace", section: "controls", text: "UP moves the cursor" });
  await tools.notebook.execute("id", { op: "append", section: "controls", text: "SPACE confirms" });
  const bad = await tools.notebook.execute("id", { op: "replace", section: "nonsense", text: "x" });
  assert.match(bad.content[0].text, /Unknown section/);
  assert.equal(entries.filter(entry => entry.type === NOTEBOOK_TYPE).length, 2);
  const opened = await handlers.before_agent_start({});
  assert.match(textOf(opened.message.content), /controls: UP moves the cursor\nSPACE confirms/);
  await tools.notebook.execute("id", { op: "delete", section: "controls" });
  assert.doesNotMatch(textOf((await handlers.before_agent_start({})).message.content), /UP moves the cursor/);
});

test("memory survives a process restart through memory.json", async () => {
  const first = setup();
  await first.handlers.before_agent_start({});
  first.handlers.message_end(say("World model: two keys open two doors"));
  const second = setup({ root: first.root });
  const opened = await second.handlers.before_agent_start({});
  assert.match(textOf(opened.message.content), /World model: two keys open two doors/);
});

test("pure-observation calls are capped per turn and nudge mentions observe limit", async () => {
  const { handlers, rows, call } = setup({ maxObserveCallsPerTurn: 2 });
  await handlers.before_agent_start({});
  handlers.turn_start();
  const first = await call();
  assert.equal(first.terminate, undefined);
  assert.match(first.content[0].text, /\[observe 1\/2: no action taken/);
  const second = await call();
  assert.equal(second.terminate, true);
  assert.equal(second.details.observe_limit, true);
  assert.match(second.content[0].text, /\[observe 2\/2: observation limit reached/);
  const third = await call();
  assert.equal(third.terminate, true);
  assert.match(third.content[0].text, /Not run: observation limit reached/);
  assert.equal(rows("observe_limit").length, 1);
  const settled = handlers.agent_before_settle(settle);
  assert.equal(settled.continue, true);
  assert.match(textOf(settled.entries[0].content), /OBSERVE LIMIT: static inspection already ran 1 turn/);
});

test("foldPreActionObservations collapses pure-observe results before an acting result", () => {
  const obs = (id: string, text: string) => [
    { role: "assistant", content: [{ type: "toolCall", id, name: "python", arguments: {} }] },
    { role: "toolResult", toolCallId: id, content: [{ type: "text", text }, { type: "image", data: "x", mimeType: "image/png" }] },
  ];
  const act = (id: string, text: string) => [
    { role: "assistant", content: [{ type: "toolCall", id, name: "python", arguments: {} }] },
    { role: "toolResult", toolCallId: id, content: [{ type: "text", text }] },
  ];
  const messages = [...obs("1", "big grid dump"), ...act("2", "ok\n[env] executed 1 (UP)"), ...obs("3", "latest observe")];
  const { messages: out, folded } = foldPreActionObservations(messages);
  assert.equal(folded, 1);
  assert.equal(out[1].content.length, 1);
  assert.match(out[1].content[0].text, /^\[folded pre-action observe: 13 chars\]$/);
  assert.equal(out[3].content[0].text, "ok\n[env] executed 1 (UP)");
  assert.equal(out[5].content[0].text, "latest observe");
});

test("same-turn tool mount feedback, failure notices, stale notice, and carried unverified list work in harnessProfile", async () => {
  const root = mkdtempSync(join(tmpdir(), "layered-m2-"));
  const { handlers, tools, python, game, call } = setup({ root, harnessProfile: true });
  await handlers.before_agent_start({});
  handlers.turn_start();
  python.run = async () => {
    mkdirSync(join(root, "work", "lib"), { recursive: true });
    writeFileSync(join(root, "work", "lib", "scan.py"), "def scan():\n    return 1\n");
    writeFileSync(join(root, "work", "lib", "bad.py"), "def bad(:\n");
    return { text: "wrote libs", truncated: false, acted: null, images: [], metrics: {} };
  };
  const mounted = textOf((await call()).content);
  assert.match(mounted, /\[tool mounted: scan v1/);
  assert.match(mounted, /\[tool publish failed: work\/lib\/bad\.py/);

  await tools.reflect_component.execute("id", { op: "define", kind: "skill", name: "unused_sk", body: "steps", summary: "unused summary" });
  python.run = async () => ({ text: "ValueError: boom", error: "ValueError: boom", acted: null, images: [], metrics: {}, truncated: false });
  writeFileSync(join(root, "work", "lib", "flaky.py"), "def flaky():\n    raise ValueError('boom')\n");
  await handlers.before_agent_start({});
  for (let i = 0; i < 3; i += 1) {
    handlers.turn_start();
    const errRes = await tools.flaky.execute("id", {});
    assert.equal(errRes.isError, true);
  }
  game.actions_used = 15;
  python.run = async () => ({ text: "ok", truncated: false, acted: batch({ executed: 1, actions: ["UP"], level_changed: true, steps: [{
    step: 1, action: "UP", tries: 0, same: false, last_try: null, new: true, level: 1, changed: true, death: false, level_up: true,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false }] }), images: [], metrics: {} });
  handlers.turn_start();
  await call();
  game.level = 2; game.levels_completed = 1;
  const lvl2Text = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(lvl2Text, /Carried from earlier levels \(unverified on L2\)/);
  assert.match(lvl2Text, /COMPONENT NOTICE: tool\/flaky v1 failed 3 consecutive times/);
  assert.match(lvl2Text, /LEVEL COMPLETE: 1 of 3/);
  assert.match(lvl2Text, /Consolidate reusable patterns into Skill/);
  const staleRes = textOf((await handlers.before_agent_start({})).message.content);
  assert.doesNotMatch(staleRes, /unused_sk.*has 0 reads/);
  await tools.reflect_component.execute("id", { op: "define", kind: "skill", name: "l2_unused", body: "steps", summary: "l2 unused" });
  game.actions_used = 30;
  const onceStale = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(onceStale, /COMPONENT NOTICE: skill\/l2_unused v1 has 0 reads across 15 actions/);
  const twiceStale = textOf((await handlers.before_agent_start({})).message.content);
  assert.doesNotMatch(twiceStale, /l2_unused v1 has 0 reads/);

  game.state = "GAME_OVER";
  python.run = async () => ({ text: "dead", truncated: false, acted: batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 31, action: "DOWN", tries: 0, same: false, last_try: null, new: false, level: 2, changed: false, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: 12 }] }), images: [], metrics: {} });
  handlers.turn_start();
  await call();
  const deathText = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(deathText, /Fatal transition: step 31, action DOWN \(REPEATS death at step 12\)/);
  assert.match(deathText, /Memory's Falsified section via reflect_component/);
});

test("stall includes effort/progress line and length truncation performs bounded recovery", async () => {
  const { handlers, game, python, rows, call } = setup({ harnessProfile: true, outputTokens: 4096, maxLengthRecoveries: 2 });
  await handlers.before_agent_start({});
  game.stale_steps = 12;
  python.run = async () => ({ text: "ok", truncated: true, acted: batch({ executed: 1, actions: ["MOUSE(x=0,y=0)"], steps: [{
    step: 1, action: "MOUSE(x=0,y=0)", tries: 1, same: true, last_try: 0, new: false, level: 1, changed: false, death: false,
    level_up: false, source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, region_tries: 4 }] }),
    images: [], metrics: {} });
  handlers.turn_start();
  await call();
  const stallText = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(stallText, /EFFORT\/PROGRESS \(last 1 actions\): new_states=0, same_repeats=1, repeat_mouse_regions=1/);
  assert.match(stallText, /STALL: 12 steps/);

  handlers.message_end(say("thinking too long", { stopReason: "length" }));
  assert.equal(handlers.agent_before_settle(settle), undefined);
  handlers.agent_settled();
  assert.equal(rows("segment_end").at(-1).reason, "length");

  const opened = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(opened, /LENGTH RECOVERY \(1\/2\)/);
  const adapted = handlers.before_provider_request({ payload: { enable_thinking: true, reasoning_effort: "high", max_tokens: 4096 } }, { model: { maxTokens: 16384 } });
  assert.equal(adapted.enable_thinking, false);
  assert.equal(adapted.reasoning_effort, "none");
  assert.equal(adapted.max_tokens, 8192);

  handlers.message_end(say("still cut off", { stopReason: "length" }));
  handlers.agent_settled();
  assert.equal(rows("segment_end").at(-1).reason, "length_exhausted");
});

test("consult inherits noImage modality, includes causal_briefing, and rejects empty length output", async () => {
  const { handlers, tools, game } = setup({ harnessProfile: true, noImage: true });
  game.causal_briefing = "RIGHT x4: 2 cells\nInvariant: action-invariant rows [63]";
  await handlers.before_agent_start({});
  let seenOptions: any;
  let seenContent: any[] = [];
  const ctx: any = { model: { id: "same-model", maxTokens: 8192 }, modelRegistry: {
    streamSimple: (_m: any, input: any, opts: any) => {
      seenOptions = opts;
      seenContent = input.messages[0].content;
      return { result: async () => ({ content: [], stopReason: "length", usage: { input: 10, output: 1500, totalTokens: 1510 } }) };
    } } };
  const res = await tools.consult.execute("id", { name: "reframer", question: "Why no progress?" }, undefined, undefined, ctx);
  assert.equal("reasoning" in seenOptions, false);
  assert.equal(seenOptions.maxTokens, 8192);
  assert.equal(seenContent.some((p: any) => p.type === "image"), false);
  assert.match(seenContent[0].text, /Causal evidence:\nRIGHT x4[\s\S]*Frame:/);
  assert.equal(res.isError, true);
  assert.match(textOf(res.content), /empty output at stopReason=length/);
});

test("memory-coupled adaptive folding relaxes foldAfter while memory is empty", async () => {
  const { handlers, tools, rows } = setup({ harnessProfile: true, foldAfter: 4, contextCap: 1e9, contextTarget: 1e9 });
  await handlers.before_agent_start({});
  const msgs = Array.from({ length: 6 }, (_, i) => [
    { role: "user", content: [{ type: "text", text: `u${i}` }] },
    { role: "assistant", content: [{ type: "toolCall", id: `c${i}`, name: "python", arguments: {} }] },
    { role: "toolResult", toolCallId: `c${i}`, content: [{ type: "text", text: `noise ${i}\n[env] executed 1` }] },
  ]).flat();
  handlers.context({ messages: msgs }, { model: { contextWindow: 128000 } });
  assert.equal(rows("fold").length, 0);
  await tools.reflect_component.execute("id", { op: "define", kind: "memory", name: "m", body: "Confirmed: x" });
  handlers.context({ messages: msgs }, { model: { contextWindow: 128000 } });
  assert.equal(rows("fold").at(-1).keep_blocks, 4);
});

test("boardInventory appears on fresh board and consult in harnessProfile and can be disabled", async () => {
  const { handlers, tools, game, python, call } = setup({ harnessProfile: true });
  game.frame = Array.from({ length: 16 }, () => Array(16).fill(0));
  game.frame[4][5] = 7;
  game.frame[2][2] = 8;
  const first = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(first, /Board inventory.*P=1\/1@\(5,4\)-\(5,4\).*R=1\/1@\(2,2\)-\(2,2\)/);

  const nextFrame = game.frame.map((r: number[]) => [...r]);
  nextFrame[2][2] = 0; nextFrame[2][3] = 8;
  game.frame = nextFrame;
  python.next = batch({ executed: 1, actions: ["UP"] });
  await call();
  const second = textOf((await handlers.before_agent_start({})).message.content);
  assert.doesNotMatch(second, /Board inventory/);

  let briefing = "";
  const ctx: any = { model: { id: "same-model" }, modelRegistry: {
    streamSimple: (_m: any, input: any) => {
      briefing = input.messages[0].content[0].text;
      return { result: async () => ({ content: [{ type: "text", text: "ok" }], stopReason: "stop", usage: { input: 10, output: 5, totalTokens: 15 } }) };
    } } };
  await tools.consult.execute("id", { name: "reframer", question: "What is untested?" }, undefined, undefined, ctx);
  assert.match(briefing, /Board inventory.*P=1\/1@\(5,4\)-\(5,4\)/);
  assert.match(briefing, /Unchanged symbols since attempt start: P/);

  const off = setup({ harnessProfile: true, boardInventory: false });
  assert.doesNotMatch(textOf((await off.handlers.before_agent_start({})).message.content), /Board inventory/);
});
