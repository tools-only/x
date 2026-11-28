import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LayeredComponents } from "../demo/arc_layered_components.ts";
import test from "node:test";
import { compactHistory, compressedTrajectory, evict, extractTags, fold, foldPreActionObservations, framePng, installLayered, MEMORY_TYPE, NOTEBOOK_TYPE, renderDecisionWindow, STATE_TYPE, structuralSnapshot } from "../demo/arc_layered_extension.ts";

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

test("Phase 1 parent gets only a bounded active panel and contradicted advice stays folded after eviction", async () => {
  const root = mkdtempSync(join(tmpdir(), "phase-one-context-"));
  const store = new LayeredComponents(join(root, "harness", "components"));
  store.reflect("add", "memory", "bad", "do not resurrect this text", "", undefined, { witness: "False" });
  store.reflect("add", "memory", "long", "x".repeat(2200));
  store.reflect("add", "memory", "hot", "new observation");
  store.recordChange("memory", "hot", 1, 0);
  const { handlers, python, tools } = setup({ root, harnessProfile: true, contextCap: 2048, contextTarget: 512, foldAfter: 0 });
  python.memoryCheckStats = { "bad/witness": { counter: 1, witness: "s1" } };
  assert.equal(tools.reflect_component, undefined);
  const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
  const { messages } = handlers.context({ messages: [user("old".repeat(5000)), user("current")] }, {});
  const all = messages.map((message: any) => textOf(message.content)).join("\n");
  const panel = all.split("## ACTIVE HARNESS").at(-1)!;
  assert.ok(panel.length + "## ACTIVE HARNESS".length <= 2500);
  assert.match(panel, /\[NEW\] MEMORY hot/);
  assert.match(panel, /\[CONTRADICTED\] bad/);
  assert.doesNotMatch(all, /do not resurrect this text/);
});

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

test("Phase 1 context exposes current Memory and the skill index on the latest message", async () => {
  const root = mkdtempSync(join(tmpdir(), "layered-components-fixture-"));
  const store = new LayeredComponents(join(root, "harness", "components"));
  store.reflect("add", "memory", "current", "first");
  store.reflect("revise", "memory", "current", "revised");
  store.reflect("define", "skill", "probe", "inspect then act", "act after inspection");
  const { handlers, tools, rows } = setup({ root, harnessProfile: true });
  assert.equal(tools.reflect_component, undefined);
  assert.match(textOf((await tools.read_component.execute("id", { kind: "memory", name: "current" })).content), /revised/);
  const first = await handlers.before_agent_start({});
  const second = await handlers.before_agent_start({});
  const out = handlers.context({ messages: [first.message, second.message] }, {}).messages;
  assert.match(first.systemPrompt, /ACTIVE HARNESS/);
  assert.doesNotMatch(textOf(out[0].content), /MEMORY current/);
  assert.match(textOf(out[1].content), /MEMORY current v2: revised/);
  assert.match(textOf(out[1].content), /SKILLS: probe/);
  assert.equal(rows("live_injected").at(-1).version, 2);
});

test("Phase 1 parent turn does not publish a file found under work/lib", async () => {
  const root = mkdtempSync(join(tmpdir(), "layered-tool-"));
  mkdirSync(join(root, "work", "lib"), { recursive: true });
  writeFileSync(join(root, "work", "lib", "count.py"), "def count(args):\n    return len(args)\n");
  const { handlers, tools, call } = setup({ root, harnessProfile: true });
  await handlers.before_agent_start({});
  await call();
  assert.equal(tools.count, undefined);
});

test("consult uses the parent model once without action tools and enforces the level limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "consult-memory-"));
  new LayeredComponents(join(root, "harness", "components")).reflect("add", "memory", "notes", "Confirmed: x\nFalsified: UP does nothing");
  const { handlers, tools, rows } = setup({ root, harnessProfile: true, outputTokens: 4096 });
  await handlers.before_agent_start({});
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
  assert.equal(b1.tools.reflect_component, undefined);
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

test("context measurement pairs the local estimate with provider input including cached tokens", async () => {
  const { handlers, root } = setup();
  const opened = await handlers.before_agent_start({});
  handlers.context({ messages: [opened.message] }, { model: { contextWindow: 175000 } });
  handlers.before_provider_request({ payload: {} }, { model: { api: "openai-completions" } });
  handlers.message_end(say("done", { usage: { input: 120, cacheRead: 80, cacheWrite: 0, output: 5, totalTokens: 205 } }));
  const rows = readFileSync(join(root, "harness", "context-calibration.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(rows[0].reported_input_with_cache, 200);
  assert.ok(rows[0].message_estimate > 0);
  assert.ok(rows[0].request_id);
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
  assert.match(deathText, /Layer 2 \(Active capabilities & execution\):/);
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

test("foldPreActionObservations folds python observations only and preserves consult/read_component/reflect_component", () => {
  const messages = [
    { role: "assistant", content: [
      { type: "toolCall", id: "p1", name: "python", arguments: {} },
      { type: "toolCall", id: "c1", name: "consult", arguments: {} },
      { type: "toolCall", id: "r1", name: "read_component", arguments: {} },
      { type: "toolCall", id: "m1", name: "reflect_component", arguments: {} },
    ] },
    { role: "toolResult", toolCallId: "p1", content: [{ type: "text", text: "grid scan output" }] },
    { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "consult framing answer" }] },
    { role: "toolResult", toolCallId: "r1", content: [{ type: "text", text: "skill body text" }] },
    { role: "toolResult", toolCallId: "m1", content: [{ type: "text", text: "memory/rules v1 active" }] },
    { role: "toolResult", toolName: "python", content: [{ type: "text", text: "moved\n[env] executed 1" }] },
  ];
  const res = foldPreActionObservations(messages);
  assert.equal(res.folded, 1);
  assert.match(res.messages[1].content[0].text, /folded pre-action observe/);
  assert.equal(res.messages[2].content[0].text, "consult framing answer");
  assert.equal(res.messages[3].content[0].text, "skill body text");
  assert.equal(res.messages[4].content[0].text, "memory/rules v1 active");
});

test("stuck audits obey cooldown and per-level cap, and Last evolution feedback closes the loop", async () => {
  const { handlers, tools, game, python, rows, call, root } = setup({ harnessProfile: true, stuckAfter: 8 });
  await handlers.before_agent_start({});
  // Simulate 30 consecutive stuck steps without new state -> should cap at 3 audits (not 30!)
  let auditTexts = 0;
  for (let i = 1; i <= 30; i += 1) {
    game.stale_steps = 8 + i - 1;
    game.actions_used = i;
    game.step = i;
    const msg = textOf((await handlers.before_agent_start({})).message.content);
    if (msg.includes("Layer 2 (Active capabilities & execution):")) auditTexts += 1;
  }
  assert.equal(auditTexts, 3);
  assert.equal(rows("dual_audit_shown").length, 3);

  // Evolution + verify sync + live context injection + GAME_OVER consult trajectory + Last evolution feedback
  python.memoryCheckStats = {};
  python.syncMemoryChecks = async (checks: Array<{ id: string; expr: string }>) => {
    python.memoryCheckStats = Object.fromEntries(checks.map(c => [c.id, {
      support: 2, counter: 1, checked: 3, by_level: { "1": { support: 2, counter: 1, checked: 3 } },
      witness: "L1 s3 DOWN (0 cells)", error: null,
    }]));
    return python.memoryCheckStats;
  };
  const ref = await tools.reflect_component.execute("id", {
    op: "define", kind: "memory", name: "rules", body: "Confirmed: UP moves", verify: { move_ok: "t.action == 'UP'" },
  });
  assert.match(textOf(ref.content), /\[verify: move_ok: 2\/3 held, 1 failed \(L1 s3 DOWN \(0 cells\)\)\]/);

  // Context hook live-injects [verify: ...] onto the state message
  const stateMsg = { role: "custom", customType: STATE_TYPE, content: [{ type: "text", text: "state header" }] };
  const ctxOut = handlers.context({ messages: [stateMsg] }, { model: { contextWindow: 128000 } });
  assert.match(ctxOut.messages[0].content[0].text, /MEMORY rules v1: Confirmed: UP moves \[verify: move_ok: 2\/3 held, 1 failed/);

  // Death records failed attempt, preserves trajectory for consult, shows Last evolution, and flushes replay on shutdown
  game.state = "GAME_OVER";
  game.step = 35;
  python.run = async () => ({ text: "dead", truncated: false, acted: batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 35, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 4,
    change_box: [1, 1, 2, 2],
  }] }), images: [], metrics: {}, usedLibs: [] });
  handlers.turn_start();
  await call();
  const deathText = textOf((await handlers.before_agent_start({})).message.content);
  assert.match(deathText, /Last evolution \(L1 s30\): memory\/rules v1 -> \[verify: move_ok: 2\/3 held/);
  assert.match(deathText, /diff=4 cells box=\[1,1,2,2\]/);

  let consultBriefing = "";
  const consultCtx: any = { model: { id: "same-model" }, modelRegistry: {
    streamSimple: (_m: any, input: any) => {
      consultBriefing = input.messages[0].content[0].text;
      return { result: async () => ({ content: [{ type: "text", text: "try LEFT" }], stopReason: "stop", usage: { input: 10, output: 5, totalTokens: 15 } }) };
    } } };
  await tools.consult.execute("id", { name: "reframer", question: "Why death?" }, undefined, undefined, consultCtx);
  assert.match(consultBriefing, /s35 DOWN DEATH/);

  handlers.session_shutdown();
  assert.match(readFileSync(join(root, "work", "replay", "level_1.md"), "utf8"), /## Layer 2: Active capabilities & execution/);
});

test("clean-context boundary evolution runs with evolution-only tools and keeps parent context free of audit walls", async () => {
  const { handlers, game, python, rows, call, root } = setup({ harnessProfile: true, evolution: true, noImage: true });
  await handlers.before_agent_start({});
  python.memoryCheckStats = {};
  python.syncMemoryChecks = async (checks: Array<{ id: string; expr: string }>) => {
    python.memoryCheckStats = Object.fromEntries(checks.map(c => [c.id, {
      support: 1, counter: 0, checked: 1, by_level: { "1": { support: 1, counter: 0, checked: 1 } },
      witness: null, error: null,
    }]));
    return python.memoryCheckStats;
  };
  let forbidSeen = false;
  const origRun = python.run.bind(python);
  python.run = async (code: string, sig?: AbortSignal, opts?: { forbidActions?: boolean }) => {
    if (opts?.forbidActions) {
      forbidSeen = true;
      return { text: "inspected ok", truncated: false, acted: null, images: [], metrics: {}, decoratedTools: ["finder"], usedLibs: [] };
    }
    return origRun(code, sig);
  };

  game.state = "GAME_OVER";
  game.step = 5;
  python.next = batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 5, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 2,
  }] });
  handlers.turn_start();
  await call();

  let streamCalls = 0;
  let seenToolNames: string[] = [];
  const ctx: any = {
    model: { id: "same-model", maxTokens: 4096 },
    modelRegistry: {
      streamSimple: (_model: any, input: any) => {
        streamCalls += 1;
        seenToolNames = (input.tools ?? []).map((t: any) => t.name);
        if (streamCalls === 1) {
          return { result: async () => ({
            role: "assistant", stopReason: "toolUse", usage: { input: 200, output: 50, totalTokens: 250 },
            content: [
              { type: "toolCall", id: "e1", name: "python_inspect", arguments: { code: "print(current_frame.shape)" } },
              { type: "toolCall", id: "e2", name: "reflect_component", arguments: {
                op: "add", kind: "memory", name: "rules", body: "Falsified: DOWN is fatal", verify: { ok: "t.action != 'DOWN'" } } },
            ],
          }) };
        }
        return { result: async () => ({
          role: "assistant", stopReason: "toolUse", usage: { input: 260, output: 30, totalTokens: 290 },
          content: [
            { type: "toolCall", id: "e3", name: "finish_evolution", arguments: { decision: "evolved", note: "recorded fatal rule" } },
          ],
        }) };
      },
    },
  };

  const parentStart = await handlers.before_agent_start({}, ctx);
  const parentMsg = textOf(parentStart.message.content);
  assert.equal(streamCalls, 2);
  assert.equal(forbidSeen, true);
  assert.deepEqual(seenToolNames, ["reflect_component", "read_component", "python_inspect", "finish_evolution"]);
  assert.match(parentMsg, /EVOLUTION \(game_over\): evolved \[memory\/rules v1\] — recorded fatal rule/);
  const ctxOut = handlers.context({ messages: [{ role: "custom", customType: STATE_TYPE, content: parentStart.message.content }] }, { model: { contextWindow: 102400 } }).messages;
  assert.match(textOf(ctxOut[0].content), /MEMORY rules v1: Falsified: DOWN is fatal \[verify: ok: 1\/1 held\]/);
  assert.doesNotMatch(parentMsg, /Layer 2 \(Active capabilities & execution\):/);
  const evoRows = rows("evolution_round");
  assert.equal(evoRows.length, 1);
  assert.equal(evoRows[0].ok, true);
  assert.equal(evoRows[0].decision, "evolved");
  const usageText = readFileSync(join(root, "harness", "usage.jsonl"), "utf8");
  assert.match(usageText, /"kind":"evolution"/);
  const compChanges = rows("component_change");
  assert.equal(compChanges.length, 1);
  assert.equal(compChanges[0].component_kind, "memory");
  const evoTrace = readFileSync(join(root, "harness", "evolution-trace.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.equal(evoTrace.length, 2);
  assert.equal(evoTrace[1].exit_reason, "finish_evolution");
  assert.ok(evoTrace[0].dossier_chars > 0);
});

test("renderDecisionWindow drops oldest blocks and preserves latest decision", () => {
  const blocks = [1, 2, 3].map(d => ({
    decision: d, level: 1, stepStart: d, stepEnd: d, reasoningTail: `think ${d} ` + "x".repeat(80),
    pythonCalls: [{ code: `print(${d})`, result: `out ${d}`, acted: true }],
    actions: [`s${d} UP diff=1`], consults: [],
  }));
  const rendered = renderDecisionWindow(blocks, 260);
  assert.match(rendered, /\[2 earlier decision\(s\).*omitted\]/);
  assert.match(rendered, /\[d3 L1 s3\.\.3\]/);
  assert.doesNotMatch(rendered, /\[d1 L1/);
});

test("evolution rejects a claim of change when no component changed", async () => {
  const { handlers, game, python, rows, call } = setup({ harnessProfile: true, evolution: true, noImage: true });
  await handlers.before_agent_start({});
  handlers.turn_start();
  game.state = "GAME_OVER"; game.step = 2;
  python.next = batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 2, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 2,
  }] });
  await call();
  const ctx: any = { model: { id: "same-model", maxTokens: 4096, contextWindow: 102400 }, modelRegistry: {
    streamSimple: () => ({ result: async () => ({ role: "assistant", stopReason: "toolUse", usage: { input: 1, output: 1, totalTokens: 2 },
      content: [{ type: "toolCall", id: "finish", name: "finish_evolution", arguments: { decision: "evolved", note: "created tool" } }] }) }),
  } };
  await handlers.before_agent_start({}, ctx);
  const entry = rows("evolution_round")[0];
  assert.equal(entry.decision, "incomplete");
  assert.deepEqual(entry.mutations, []);
  assert.equal(entry.claimed_decision, "evolved");
});

test("invalid verify syntax is rejected before a memory version is saved", async () => {
  const { handlers, game, python, rows, call, root } = setup({ harnessProfile: true, evolution: true, noImage: true });
  await handlers.before_agent_start({});
  handlers.turn_start(); game.state = "GAME_OVER"; game.step = 2;
  python.next = batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 2, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 2,
  }] });
  await call();
  const ctx: any = { model: { id: "same-model", maxTokens: 4096, contextWindow: 102400 }, modelRegistry: {
    streamSimple: () => ({ result: async () => ({ role: "assistant", stopReason: "toolUse", usage: { input: 1, output: 1, totalTokens: 2 },
      content: [{ type: "toolCall", id: "bad", name: "reflect_component", arguments: { op: "add", kind: "memory", name: "bad_rule", body: "test", verify: { rule: "t.action ==" } } }] }) }),
  } };
  await handlers.before_agent_start({}, ctx);
  assert.equal(new LayeredComponents(join(root, "harness", "components")).current("memory", "bad_rule"), undefined);
  assert.equal(rows("component_change").length, 0);
});

test("historical verify errors do not write a memory version", async () => {
  const { handlers, game, python, rows, call, root } = setup({ harnessProfile: true, evolution: true, noImage: true });
  python.validateMemoryChecks = async () => ({ "bad_rule/rule": { error: "AttributeError: missing" } });
  await handlers.before_agent_start({});
  handlers.turn_start(); game.state = "GAME_OVER"; game.step = 2;
  python.next = batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 2, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 2,
  }] });
  await call();
  const ctx: any = { model: { id: "same-model", maxTokens: 4096, contextWindow: 102400 }, modelRegistry: {
    streamSimple: () => ({ result: async () => ({ role: "assistant", stopReason: "toolUse", usage: { input: 1, output: 1, totalTokens: 2 },
      content: [{ type: "toolCall", id: "bad", name: "reflect_component", arguments: { op: "add", kind: "memory", name: "bad_rule", body: "test", verify: { rule: "t.missing > 0" } } }] }) }),
  } };
  await handlers.before_agent_start({}, ctx);
  assert.equal(new LayeredComponents(join(root, "harness", "components")).current("memory", "bad_rule"), undefined);
  assert.equal(rows("component_change").length, 0);
});

test("failed tool publication restores the previous work file", async () => {
  const { handlers, game, python, call, root } = setup({ harnessProfile: true, evolution: true, noImage: true });
  const lib = join(root, "work", "lib"); mkdirSync(lib, { recursive: true });
  const path = join(lib, "probe.py"); writeFileSync(path, "def probe():\n    return 1\n");
  await handlers.before_agent_start({}); handlers.turn_start(); game.state = "GAME_OVER"; game.step = 2;
  python.next = batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 2, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 2,
  }] });
  const ctx: any = { model: { id: "same-model", maxTokens: 4096, contextWindow: 102400 }, modelRegistry: {
    streamSimple: () => ({ result: async () => ({ role: "assistant", stopReason: "toolUse", usage: { input: 1, output: 1, totalTokens: 2 },
      content: [{ type: "toolCall", id: "inspect", name: "python_inspect", arguments: { code: "test" } }] }) }),
  } };
  await call();
  python.run = async () => {
    writeFileSync(path, "def probe():\n    return (\n");
    return { text: "prepared", decoratedTools: ["probe"], usedLibs: [], metrics: {}, images: [], acted: null };
  };
  await handlers.before_agent_start({}, ctx);
  assert.equal(readFileSync(path, "utf8"), "def probe():\n    return 1\n");
});

test("restart recovers an interrupted tool publication and preserves a committed one", () => {
  const root = mkdtempSync(join(tmpdir(), "layered-publish-recovery-"));
  const lib = join(root, "work", "lib"), harness = join(root, "harness");
  mkdirSync(lib, { recursive: true }); mkdirSync(harness, { recursive: true });
  const store = new LayeredComponents(join(harness, "components"));
  store.reflect("define", "tool", "saved", "def saved():\n    return 2\n", "saved()");
  writeFileSync(join(lib, "saved.py"), "def saved():\n    return 2\n");
  writeFileSync(join(lib, "pending.py"), "def pending():\n    return 9\n");
  writeFileSync(join(harness, "tool-publication-pending.json"), JSON.stringify({
    files: { "saved.py": "def saved():\n    return 1\n" }, heads: {},
  }));
  setup({ root, harnessProfile: true });
  assert.equal(readFileSync(join(lib, "saved.py"), "utf8"), "def saved():\n    return 2\n");
  assert.equal(existsSync(join(lib, "pending.py")), false);
  assert.equal(existsSync(join(harness, "tool-publication-pending.json")), false);
});

test("boundary evolution blocks same-turn finish_evolution after error and marks max_rounds_exhausted as incomplete", async () => {
  const { handlers, game, python, rows, call, root } = setup({ harnessProfile: true, evolution: true, noImage: true });
  await handlers.before_agent_start({});
  handlers.turn_start();
  game.state = "GAME_OVER";
  game.step = 2;
  python.next = batch({ executed: 1, actions: ["DOWN"], game_over: true, steps: [{
    step: 2, action: "DOWN", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 2,
  }] });
  await call();

  let sawDossier = "";
  let roundCalls = 0;
  const origMax = process.env.ARC_LAYERED_EVOLUTION_MAX_ROUNDS;
  process.env.ARC_LAYERED_EVOLUTION_MAX_ROUNDS = "2";
  try {
    const ctx: any = {
      model: { id: "same-model", maxTokens: 4096, contextWindow: 102400 },
      modelRegistry: {
        streamSimple: (_m: any, input: any) => {
          roundCalls += 1;
          if (roundCalls === 1) sawDossier = input.messages[0].content[0].text;
          return { result: async () => ({
            role: "assistant", stopReason: "toolUse", usage: { input: 200, output: 40, totalTokens: 240 },
            content: roundCalls === 1
              ? [
                  { type: "toolCall", id: "b1", name: "read_component", arguments: { kind: "memory", name: "missing" } },
                  { type: "toolCall", id: "b2", name: "finish_evolution", arguments: { decision: "no_change", note: "premature" } },
                ]
              : [{ type: "toolCall", id: "b3", name: "read_component", arguments: { kind: "memory", name: "still_missing" } }],
          }) };
        },
      },
    };
    const parentMsg = textOf((await handlers.before_agent_start({}, ctx)).message.content);
    assert.equal(roundCalls, 2);
    assert.match(sawDossier, /DECISIONS SINCE LAST REVIEW:/);
    assert.match(sawDossier, /Branch reuse \(last \d+\):/);
    assert.match(sawDossier, /Tooling gap:/);
    assert.doesNotMatch(parentMsg, /EVOLUTION \(game_over\): no_change/);
    const evoRows = rows("evolution_round");
    assert.equal(evoRows[0].decision, "incomplete");
    assert.equal(evoRows[0].exit_reason, "max_rounds_exhausted");
    const traceLines = readFileSync(join(root, "harness", "evolution-trace.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
    assert.equal(traceLines[0].results[1].ok, false);
    assert.match(traceLines[0].results[1].preview, /Blocked finish_evolution/);
  } finally {
    if (origMax === undefined) delete process.env.ARC_LAYERED_EVOLUTION_MAX_ROUNDS;
    else process.env.ARC_LAYERED_EVOLUTION_MAX_ROUNDS = origMax;
  }
});

test("unscoped 100%-failing verify rule emits fallback note and keeps Memory active instead of [CONTRADICTED]", async () => {
  const { handlers, game, python, call } = setup({ harnessProfile: true, evolution: true, noImage: true });
  await handlers.before_agent_start({});
  python.memoryCheckStats = {};
  python.syncMemoryChecks = async (checks: Array<{ id: string; expr: string }>) => {
    python.memoryCheckStats = Object.fromEntries(checks.map(c => [c.id,
      c.id === "probe_mem/bad_scope"
        ? { support: 0, counter: 4, checked: 4, by_level: { "1": { support: 0, counter: 4, checked: 4 } }, witness: "L1 s4 UP", error: null, unscoped: true }
        : { support: 1, counter: 1, checked: 2, by_level: { "1": { support: 1, counter: 1, checked: 2 } }, witness: "L1 s4 DOWN", error: null, unscoped: false },
    ]));
    return python.memoryCheckStats;
  };
  game.state = "GAME_OVER";
  game.step = 4;
  python.next = batch({ executed: 1, actions: ["UP"], game_over: true, steps: [{
    step: 4, action: "UP", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 1,
  }] });
  handlers.turn_start();
  await call();

  let round = 0;
  let reflectReply = "";
  const ctx: any = {
    model: { id: "same-model", maxTokens: 4096 },
    modelRegistry: {
      streamSimple: (_m: any, input: any) => {
        round += 1;
        if (round === 2) {
          const toolMsg = input.messages.find((m: any) => m.role === "toolResult" && m.toolName === "reflect_component");
          reflectReply = textOf(toolMsg?.content ?? []);
        }
        return { result: async () => ({
          role: "assistant", stopReason: "toolUse", usage: { input: 100, output: 20, totalTokens: 120 },
          content: round === 1
            ? [{ type: "toolCall", id: "r1", name: "reflect_component", arguments: {
                op: "add", kind: "memory", name: "probe_mem", body: "Try UP next", verify: { bad_scope: "t.after_frame.step == 999" } } }]
            : [{ type: "toolCall", id: "r2", name: "finish_evolution", arguments: { decision: "evolved", note: "saved probe" } }],
        }) };
      },
    },
  };
  const parentStart = await handlers.before_agent_start({}, ctx);
  assert.match(reflectReply, /\[verify fallback: bad_scope failed all historical transitions with 0 support/);
  assert.match(reflectReply, /bad_scope: unscoped \(ignored\)/);

  const ctxOut = handlers.context({ messages: [{ role: "custom", customType: STATE_TYPE, content: parentStart.message.content }] }, { model: { contextWindow: 102400 } }).messages;
  const panel = textOf(ctxOut[0].content);
  assert.match(panel, /\[NEW\] MEMORY probe_mem v1: Try UP next/);
  assert.doesNotMatch(panel, /\[CONTRADICTED\] probe_mem/);

  // A genuinely contradicted scoped rule (counter > 0, unscoped: false) still folds
  python.memoryCheckStats["probe_mem/bad_scope"] = { support: 1, counter: 1, checked: 2, by_level: {}, witness: "L1 s5 UP", error: null, unscoped: false };
  const ctxFolded = handlers.context({ messages: [{ role: "custom", customType: STATE_TYPE, content: parentStart.message.content }] }, { model: { contextWindow: 102400 } }).messages;
  assert.match(textOf(ctxFolded[0].content), /\[CONTRADICTED\] probe_mem v1/);
});

test("harnessProfile gates stuck/stall until 16 stale steps and adds level_complete inspect cap to dossier", async () => {
  const { handlers, game, python, rows, call } = setup({ harnessProfile: true, evolution: true, noImage: true, stuckAfter: 16 });
  await handlers.before_agent_start({});

  let calls = 0;
  let levelCompleteDossier = "";
  const ctx: any = {
    model: { id: "same-model", maxTokens: 4096 },
    modelRegistry: {
      streamSimple: (_m: any, input: any) => {
        calls += 1;
        const text = input.messages[0].content[0].text;
        if (text.includes("LEVEL_COMPLETE")) levelCompleteDossier = text;
        return { result: async () => ({
          role: "assistant", stopReason: "toolUse", usage: { input: 50, output: 10, totalTokens: 60 },
          content: [{ type: "toolCall", id: `c${calls}`, name: "finish_evolution", arguments: { decision: "no_change", note: "ok" } }],
        }) };
      },
    },
  };

  // stale_steps = 12 must NOT trigger stall/stuck in harnessProfile (threshold >= 16)
  game.stale_steps = 12;
  game.actions_used = 12;
  python.next = batch({ executed: 12, actions: Array(12).fill("UP") });
  handlers.turn_start();
  await call();
  await handlers.before_agent_start({}, ctx);
  assert.equal(calls, 0);

  // stale_steps = 16 DOES trigger evolution
  game.stale_steps = 16;
  game.actions_used = 16;
  python.next = batch({ executed: 4, actions: Array(4).fill("UP") });
  handlers.turn_start();
  await call();
  await handlers.before_agent_start({}, ctx);
  assert.equal(calls, 1);
  assert.equal(rows("evolution_round").length, 1);

  // level_complete includes the at-most-1 python_inspect instruction
  game.level = 2;
  game.stale_steps = 0;
  python.next = batch({ executed: 1, actions: ["UP"], level_changed: true });
  handlers.turn_start();
  await call();
  await handlers.before_agent_start({}, ctx);
  assert.match(levelCompleteDossier, /Boundary rule \(LEVEL_COMPLETE\): use at most 1 python_inspect call/);
});

test("Phase 2 contradiction audits deduplicate versions, cool down and cap at three", async () => {
  const root = mkdtempSync(join(tmpdir(), "cognitive-"));
  const store = new LayeredComponents(join(root, "harness", "components"));
  for (let i = 0; i < 4; i++) store.reflect("add", "memory", `rule${i}`, "test", "", undefined, { check: "True" });
  const { handlers, game, python, rows } = setup({ root, harnessProfile: true, evolution: true, noImage: true });
  await handlers.before_agent_start({});
  let calls = 0;
  const ctx: any = { model: { id: "same", maxTokens: 4096 }, modelRegistry: { streamSimple: () => {
    calls++;
    return { result: async () => ({ role: "assistant", stopReason: "toolUse", usage: { input: 1, output: 1, totalTokens: 2 },
      content: [{ type: "toolCall", id: "done", name: "finish_evolution", arguments: { decision: "no_change", note: "reviewed" } }] }) };
  } } };
  python.memoryCheckStats = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`rule${i}/check`, { support: 1, counter: 1, checked: 2, by_level: {}, witness: "witness", error: null }]));
  for (const step of [4, 5, 8, 9, 12, 16, 20]) { game.step = step; await handlers.before_agent_start({}, ctx); }
  assert.equal(calls, 3);
  assert.equal(rows("evolution_round").filter((row: any) => row.boundary === "verify_contradiction").length, 3);
});

test("Phase 2 structural evidence describes actions, dimensions, symbols and connected regions", () => {
  assert.deepEqual(structuralSnapshot({ frame: [[0,0,0],[1,0,1]], valid_actions: ["B", "A"] }), {
    actions: ["A", "B"], rows: 2, columns: 3, symbols: [0,1], nonModalSymbolRegions: 2,
  });
});
test("Phase 2 cross-level health failure isolates game tool and archives local advice", async () => {
  const root = mkdtempSync(join(tmpdir(), "variant-"));
  const store = new LayeredComponents(join(root, "harness", "components"));
  store.reflect("add", "memory", "local", "local advice");
  store.reflect("add", "tool", "broken", "def broken(): return None", "broken()", undefined, undefined, { scope: "game" });
  const { handlers, python, game, call, rows } = setup({ root, harnessProfile: true, evolution: false, noImage: true });
  await handlers.before_agent_start({});
  game.level = 2; game.levels_completed = 1;
  python.next = batch({ executed: 1, actions: ["UP"], level_changed: true, steps: [{ step: 1, level: 1, action: "UP", level_up: true, claims_failed: [], claims_held: [] }] });
  const run = python.run.bind(python);
  python.run = async () => ({ ...await run(), steps: python.next.steps });
  await call();
  python.run = async () => ({ text: "", error: "empty tool result", acted: null, metrics: {}, images: [] });
  await handlers.before_agent_start({});
  const latest = new LayeredComponents(join(root, "harness", "components"));
  assert.equal(latest.current("memory", "local")?.status, "dormant");
  assert.equal(latest.current("tool", "broken")?.status, "variant_broken");
  assert.equal(rows("tool_health_check")[0].ok, false);
  assert.equal(rows("cross_level_delta").length, 1);
});

test("Phase 2 two surprising batches trigger audit, then cognitive cooldown blocks repetition", async () => {
 const { handlers, python, game, call, rows } = setup({ harnessProfile: true, evolution: true, noImage: true });
 await handlers.before_agent_start({});
 const ctx: any = { model: { id: "same", maxTokens: 4096 }, modelRegistry: { streamSimple: () => ({ result: async () => ({
   role: "assistant", stopReason: "toolUse", usage: { input: 1, output: 1, totalTokens: 2 },
   content: [{ type: "toolCall", id: "finish", name: "finish_evolution", arguments: { decision: "no_change", note: "review" } }],
 }) }) } };
 for (const step of [2, 5, 6]) {
   game.step = step; game.actions_used = step;
   python.next = batch({ executed: 1, actions: ["UP"], surprise: true });
   handlers.turn_start(); await call(); await handlers.before_agent_start({}, ctx);
 }
 assert.equal(rows("evolution_round").filter((row: any) => row.boundary === "repeated_surprise").length, 1);
 // After cooldown (>=6 steps), a non-surprise followed by ONE surprise must NOT immediately re-trigger repeated_surprise
 game.step = 13; game.actions_used = 13;
 python.next = batch({ executed: 1, actions: ["UP"], surprise: false });
 handlers.turn_start(); await call(); await handlers.before_agent_start({}, ctx);
 game.step = 14; game.actions_used = 14;
 python.next = batch({ executed: 1, actions: ["UP"], surprise: true });
 handlers.turn_start(); await call(); await handlers.before_agent_start({}, ctx);
 assert.equal(rows("evolution_round").filter((row: any) => row.boundary === "repeated_surprise").length, 1);
});

test("Phase 2 active panel hides dormant/variant_broken, orders prompt > level > game memory, and caps active memories at 6", () => {
  const root = mkdtempSync(join(tmpdir(), "phase2-panel-"));
  const store = new LayeredComponents(join(root, "harness", "components"));
  store.reflect("add", "memory", "game_rule", "game rule", "", undefined, undefined, { scope: "game", status: "provisional" });
  for (let i = 1; i <= 6; i += 1) {
    store.reflect("add", "memory", `lvl_${i}`, `level mem ${i}`, "", undefined, undefined, { scope: "level" });
  }
  store.reflect("add", "memory", "sleeping", "should stay hidden", "", undefined, undefined, { scope: "level", status: "dormant" });
  store.reflect("define", "tool", "broken_tool", "def broken_tool():\n  return 1", "broken_tool()", undefined, undefined, { scope: "game", status: "variant_broken" });
  store.reflect("define", "prompt", "pacing", "probe 1 step");

  const { handlers } = setup({ root, harnessProfile: true, evolution: true, noImage: true });
  const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
  const { messages } = handlers.context({ messages: [user("state")] }, { model: { contextWindow: 102400 } });
  const panel = textOf(messages[0].content).split("## ACTIVE HARNESS").at(-1)!;
  assert.doesNotMatch(panel, /DORMANT|should stay hidden|broken_tool|variant_broken/);
  assert.match(panel, /PROMPT pacing v1: probe 1 step/);
  assert.ok(panel.indexOf("PROMPT pacing") < panel.indexOf("MEMORY lvl_1"));
  assert.doesNotMatch(panel, /MEMORY game_rule/); // 6 level memories fill the <=6 cap ahead of game_rule
});

test("Phase 3 read_archive is opt-in and returns archived evidence through the parent tool", async () => {
 const plain = setup();
 assert.equal(plain.tools.read_archive, undefined);
 const { LayeredArchive } = await import("../demo/arc_layered_archive.ts");
 const root = mkdtempSync(join(tmpdir(), "archive-runtime-"));
 const archive = new LayeredArchive(join(root, "harness", "archive"));
 const id = archive.save([{ type: "text", text: "old evidence" }]);
 const enabled = setup({ root, recoverableFold: true });
 const reply = await enabled.tools.read_archive.execute("read", { id });
 assert.match(reply.content[0].text, /old evidence/);
 assert.equal(enabled.rows("archive_read").length, 1);
 const invalid = await enabled.tools.read_archive.execute("read", { id: "../secret" });
 assert.equal(invalid.isError, true);
});

test("L4/L5 methodology evolution path supports minimal base prompt, process profile, and L5 prompt creation", async () => {
  const { handlers, game, python, call } = setup({ harnessProfile: true, minimalBasePrompt: true, evolution: true, noImage: true, stuckAfter: 16 });
  const opened = await handlers.before_agent_start({});
  assert.match(opened.systemPrompt, /submit_actions/);
  assert.match(opened.systemPrompt, /## ACTIVE HARNESS/);
  assert.doesNotMatch(opened.systemPrompt, /## Working method|small probe batches/);

  game.stale_steps = 16;
  game.actions_used = 16;
  game.unchecked_batches = 4;
  const steps = Array.from({ length: 6 }, (_, i) => ({
    step: i + 1, action: "UP", tries: i, same: i > 0, last_try: i > 0 ? i : null, new: false, level: 1,
    changed: false, death: false, level_up: false, source: null, fatal: false, claims_failed: [], claims_held: [],
    predict_off: null, same_death: false,
  }));
  python.next = batch({ executed: 6, actions: Array(6).fill("UP") });
  const origRun = python.run.bind(python);
  python.run = async () => ({ ...(await origRun()), steps });
  handlers.turn_start();
  await call();

  let evoSysPrompt = "";
  let evoDossier = "";
  let reflectToolDesc = "";
  let round = 0;
  const ctx: any = {
    model: { id: "same", maxTokens: 4096 },
    modelRegistry: {
      streamSimple: (_m: any, input: any) => {
        round += 1;
        if (round === 1) {
          evoSysPrompt = input.systemPrompt;
          evoDossier = input.messages[0].content[0].text;
          reflectToolDesc = input.tools.find((t: any) => t.name === "reflect_component")?.description ?? "";
        }
        return { result: async () => ({
          role: "assistant", stopReason: "toolUse", usage: { input: 50, output: 20, totalTokens: 70 },
          content: round === 1
            ? [{ type: "toolCall", id: "p1", name: "reflect_component", arguments: {
                op: "add", kind: "prompt", layer: "L5", scope: "game", name: "probe_discipline",
                body: "when: before acting on unverified mechanics\nUse 1-step probes with tight expect= instead of blind batches." } }]
            : [{ type: "toolCall", id: "p2", name: "finish_evolution", arguments: { decision: "evolved", note: "added L5 probe discipline" } }],
        }) };
      },
    },
  };

  await handlers.before_agent_start({}, ctx);
  assert.match(evoSysPrompt, /kind='prompt', layer='L5'/);
  assert.match(evoSysPrompt, /kind='skill', layer='L4'/);
  assert.match(evoSysPrompt, /scope='level' vs scope='game'/);
  assert.match(evoSysPrompt, /Executable-first offloading/);
  assert.match(evoSysPrompt, /revised AT MOST 2 times per level/);
  assert.match(reflectToolDesc, /L5 prompt.*L4 skill/);
  assert.match(evoDossier, /- Process profile \(last \d+ decisions\): acting=1, max_batch=6, large_batches\(>=4\)=1, unchecked_batches=4/);
  assert.match(evoDossier, /Harness slots \(active\): prompt=0\/1, skill=0\/2, memory=0\/6/);

  const ctxOut = handlers.context({ messages: [{ role: "user", content: [{ type: "text", text: "state" }] }] }, { model: { contextWindow: 102400 } });
  const panel = textOf(ctxOut.messages[0].content).split("## ACTIVE HARNESS").at(-1)!;
  assert.match(panel, /\[NEW\] PROMPT probe_discipline v1:/);
});

test("method_drift cognitive audit triggers on >=4 unchecked_batches without waiting for stall or surprise", async () => {
  const { handlers, game, python, call, rows } = setup({ harnessProfile: true, evolution: true, noImage: true, stuckAfter: 16 });
  await handlers.before_agent_start({});
  const ctx: any = {
    model: { id: "same", maxTokens: 4096 },
    modelRegistry: {
      streamSimple: () => ({ result: async () => ({
        role: "assistant", stopReason: "toolUse", usage: { input: 20, output: 10, totalTokens: 30 },
        content: [{ type: "toolCall", id: "m1", name: "finish_evolution", arguments: { decision: "no_change", note: "checked" } }],
      }) }),
    },
  };
  game.step = 5;
  game.actions_used = 5;
  game.stale_steps = 4; // well below 16
  game.unchecked_batches = 4;
  python.next = batch({ executed: 1, actions: ["UP"], surprise: false });
  handlers.turn_start();
  await call();
  await handlers.before_agent_start({}, ctx);
  assert.equal(rows("evolution_round").filter((r: any) => r.boundary === "method_drift").length, 1);
});

test("prompt revision circuit-breaker blocks >2 revisions of the same prompt on one level", async () => {
  const { handlers, game, python, call } = setup({ harnessProfile: true, evolution: true, noImage: true, stuckAfter: 16 });
  await handlers.before_agent_start({});
  let blockedReply = "";
  const specs = [
    { op: "add", body: "v1", decision: "evolved" },
    { op: "revise", body: "v2", decision: "evolved" },
    { op: "revise", body: "v3", decision: "evolved" },
    { op: "revise", body: "v4", decision: "no_change" },
  ] as const;
  for (const [idx, step] of [5, 8, 11, 14].entries()) {
    const spec = specs[idx]!;
    let subRound = 0;
    const ctx: any = {
      model: { id: "same", maxTokens: 4096 },
      modelRegistry: {
        streamSimple: (_m: any, input: any) => {
          subRound += 1;
          if (subRound === 2 && idx === 3) {
            const toolResults = input.messages.filter((m: any) => m.role === "toolResult" && m.toolName === "reflect_component");
            blockedReply = textOf(toolResults.at(-1)?.content ?? []);
          }
          return { result: async () => ({
            role: "assistant", stopReason: "toolUse", usage: { input: 20, output: 10, totalTokens: 30 },
            content: subRound === 1
              ? [{ type: "toolCall", id: `p${idx}`, name: "reflect_component", arguments: {
                  op: spec.op, kind: "prompt", layer: "L5", scope: "game", name: "pace", body: spec.body } }]
              : [{ type: "toolCall", id: `pf${idx}`, name: "finish_evolution", arguments: { decision: spec.decision, note: `audit ${idx + 1}` } }],
          }) };
        },
      },
    };
    game.state = "GAME_OVER";
    game.step = step;
    game.actions_used = step;
    python.next = batch({ executed: 1, actions: ["UP"], game_over: true, steps: [{
      step, action: "UP", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
      source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 1,
    }] });
    handlers.turn_start();
    await call();
    await handlers.before_agent_start({}, ctx);
  }
  assert.match(blockedReply, /already revised 2x on this level; stop rewriting prose/);
});

test("calling a published bound tool records bound_invocation once without duplicate lib_invocation", async () => {
  const isoRoot = mkdtempSync(join(tmpdir(), "layered-bound-dedup-"));
  const { handlers: h2, game: g2, python: p2, rows: r2, tools: t2 } = setup({
    root: isoRoot, harnessProfile: true, evolution: true, noImage: true, stuckAfter: 16,
  });
  let round = 0;
  const evoCtx: any = {
    model: { id: "same", maxTokens: 4096 },
    modelRegistry: {
      streamSimple: () => {
        round += 1;
        return { result: async () => ({
          role: "assistant", stopReason: "toolUse", usage: { input: 20, output: 10, totalTokens: 30 },
          content: round === 1
            ? [{ type: "toolCall", id: "t1", name: "python_inspect", arguments: { code: "@tool\ndef check_grid():\n    return {'ok': True}" } }]
            : [{ type: "toolCall", id: "t2", name: "finish_evolution", arguments: { decision: "evolved", note: "published" } }],
        }) };
      },
    },
  };
  mkdirSync(join(isoRoot, "work", "lib"), { recursive: true });
  writeFileSync(join(isoRoot, "work", "lib", "check_grid.py"), "def check_grid():\n    return {'ok': True}\n", "utf8");
  p2.run = async (code: string) => {
    p2.runs += 1;
    const calledCheck = code.includes("check_grid");
    return { text: "{'ok': True}", truncated: false, acted: null, usedLibs: calledCheck ? ["check_grid"] : [], decoratedTools: ["check_grid"], images: [], metrics: {} };
  };
  await h2.before_agent_start({});
  g2.state = "GAME_OVER";
  g2.step = 5;
  p2.next = batch({ executed: 1, actions: ["UP"], game_over: true, steps: [{
    step: 5, action: "UP", tries: 0, same: false, last_try: 0, new: false, level: 1, changed: true, death: true, level_up: false,
    source: null, fatal: false, claims_failed: [], claims_held: [], predict_off: null, same_death: false, changed_cells: 1,
  }] });
  await t2.python.execute("id1", { code: "submit_actions('UP')" }, undefined, undefined, {});
  p2.next = null;
  await h2.before_agent_start({}, evoCtx);
  assert.ok(t2.check_grid, "check_grid bound tool should be registered");

  await t2.check_grid.execute("b1", {}, undefined);
  assert.equal(r2("bound_invocation").length, 1);
  assert.equal(r2("lib_invocation").length, 0);

  await t2.python.execute("p1", { code: "check_grid()" }, undefined, undefined, {});
  assert.equal(r2("bound_invocation").length, 1);
  assert.equal(r2("lib_invocation").length, 1);
});

test("foldAfter: 0 with recoverableFold disabled preserves pre-action python observations for KV cache", () => {
  const { handlers, rows, root } = setup({ harnessProfile: true, foldAfter: 0, noImage: true });
  const observeText = "OBSERVATION_DETAIL_" + "a".repeat(300);
  const messages = [
    { role: "user", content: [{ type: "text", text: "turn 1" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "python", arguments: { code: "print(1)" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "python", content: [{ type: "text", text: observeText }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "python", arguments: { code: "submit_actions('UP')" } }] },
    { role: "toolResult", toolCallId: "c2", toolName: "python", content: [{ type: "text", text: "[env] executed 1 (UP)" }] },
  ];
  const out = handlers.context({ messages }, { model: { contextWindow: 128000 } });
  const joined = out.messages.map((m: any) => textOf(m.content)).join("\n");
  assert.match(joined, /OBSERVATION_DETAIL_aaa/);
  assert.equal(existsSync(join(root, "harness", "layered.jsonl")) ? rows("fold").length : 0, 0);
});

test("calibrated context overflow protection triggers earlier eviction/compaction and clamps max_tokens", async () => {
  const { handlers, rows } = setup({
    harnessProfile: true, foldAfter: 0, noImage: true,
    outputTokens: 4096, contextCap: 24000, contextTarget: 12000, compactMargin: 8000,
  });
  const modelCtx = { model: { api: "openai-completions", contextWindow: 30000, maxTokens: 8192 } };
  const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
  const stateMsg = (text: string) => ({ role: "custom", customType: STATE_TYPE, content: [{ type: "text", text }] });

  // Sample 1 (<4000 est): establishes calibratedOverhead (~2000)
  handlers.context({ messages: [user("x".repeat(4000)), stateMsg("cur")] }, modelCtx);
  handlers.before_provider_request({ payload: {} }, modelCtx);
  await handlers.message_end({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }],
      usage: { input: 2000, cacheRead: 1000, cacheWrite: 0, output: 10, totalTokens: 3010 } },
  });

  // Sample 2 (>=4000 est): ~5000 est vs 11000 reported -> calibratedRatio ~ 1.8
  handlers.context({ messages: [user("y".repeat(16000)), user("z".repeat(4000)), stateMsg("cur")] }, modelCtx);
  handlers.before_provider_request({ payload: {} }, modelCtx);
  await handlers.message_end({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }],
      usage: { input: 9000, cacheRead: 2000, cacheWrite: 0, output: 10, totalTokens: 11010 } },
  });

  // Now ~12,500 uncalibrated estimate fits raw contextCap (24,000),
  // but calibrated estimate (~24,500) exceeds effectiveCap and hardTarget (22,000), triggering evict/compact
  const heavy = [user("a".repeat(20000)), user("b".repeat(20000)), user("c".repeat(10000)), stateMsg("cur")];
  handlers.context({ messages: heavy }, modelCtx);
  assert.ok(rows("evict").length + rows("compact").length >= 1, "expected calibrated evict or compact");

  // Single indivisible latest state block cannot be evicted/compacted away, so before_provider_request clamps max_tokens
  handlers.context({ messages: [stateMsg("m".repeat(58000))] }, modelCtx);
  const adapted = handlers.before_provider_request({ payload: {} }, modelCtx);
  assert.ok(adapted.max_tokens < 4096 && adapted.max_tokens >= 512, `expected clamped max_tokens < 4096, got ${adapted.max_tokens}`);
});
