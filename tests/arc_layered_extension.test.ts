import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evict, extractTags, framePng, installLayered, MEMORY_TYPE, STATE_TYPE } from "../demo/arc_layered_extension.ts";

const grid = Array.from({ length: 64 }, () => Array(64).fill(0));

function setup(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, any> = {}, sent: any[] = [], entries: any[] = [];
  let tool: any;
  const pi: any = { on: (name: string, handler: any) => { handlers[name] = handler; }, registerTool: (definition: any) => { tool = definition; },
    sendMessage: (message: any, options: any) => sent.push({ message, options }),
    appendEntry: (type: string, data: any) => entries.push({ type, data }) };
  const game: any = { level: 1, levels_completed: 0, win_levels: 3, state: "NOT_FINISHED", step: 0, actions_used: 0, budget_left: 40,
    valid_actions: ["UP", "RESET"], frame: grid };
  const python: any = { next: null, runs: 0, init: async () => game, state: () => game, close() {},
    async run() { this.runs += 1; return { text: "ok", truncated: false, acted: this.next, metrics: {} }; } };
  const root = mkdtempSync(join(tmpdir(), "layered-"));
  installLayered(pi, python, { scale: 4, gridLines: false, reminder: false, contextTarget: 0, idleContinuations: 2, segmentSeconds: 600,
    segmentTokens: 100000, maxActionsPerCall: 16, outputTokens: 0, root, ...overrides } as any);
  const rows = (kind: string) => readFileSync(join(root, "harness", "layered.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    .filter(row => row.kind === kind);
  return { handlers, sent, entries, game, python, rows, tool: () => tool,
    call: () => tool.execute("id", { code: "x" }, undefined, undefined, {}) };
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
  assert.doesNotMatch(opened.systemPrompt, /\{\{/);
  assert.equal(opened.message.customType, STATE_TYPE);
  assert.match(textOf(opened.message.content), /Level 1 of 3 \| NOT_FINISHED \| step 0 \| actions used 0 \| budget left 40/);
  assert.doesNotMatch(textOf(opened.message.content), /\{\{|Last batch/);
  assert.equal(opened.message.content[1].type, "image");
  assert.deepEqual(Object.keys(tool().parameters.properties), ["code"]);
  assert.deepEqual(handlers.session_before_compact(), { cancel: true });
});

test("only an acting call steers a state message, and a second call in the same reply is not run", async () => {
  const { handlers, sent, python, game, rows, call } = setup({ reminder: true });
  await handlers.before_agent_start({});
  handlers.turn_start();
  await call();
  assert.equal(sent.length, 0);
  python.next = batch({ stop_reason: "stop_on" });
  game.step = game.actions_used = 12; game.budget_left = 3;
  const acted = await call();
  assert.equal(acted.terminate, undefined);
  assert.deepEqual(sent[0].options, { deliverAs: "steer" });
  const text = textOf(sent[0].message.content);
  assert.match(text, /Last batch: 12 executed: (UP ){9}UP \(\+2 more\); stopped: stop_on/);
  assert.match(text, /BUDGET: 3 actions left/);
  assert.match(text, /Start your reply with updated/);
  assert.equal(sent[0].message.content[1].type, "image");
  const refused = await call();
  assert.match(refused.content[0].text, /^Not run/);
  assert.equal(python.runs, 2);
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

test("game over stays in the segment and is announced", async () => {
  const { handlers, sent, python, game, call } = setup();
  await handlers.before_agent_start({});
  python.next = batch({ game_over: true, stop_reason: "game_over" });
  game.state = "GAME_OVER";
  assert.equal((await call()).terminate, undefined);
  assert.match(textOf(sent[0].message.content), /GAME_OVER: only RESET/);
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
  assert.match(textOf(sent[0].message.content), /World model: walls are gray\nsecond line\nPlan: go left/);
  assert.deepEqual(extractTags("The plan is simple.\nPlanning ahead"), {});
});

test("eviction drops whole user blocks, keeps call/result pairs and the latest state, strips older images", () => {
  const image = { type: "image", data: "x", mimeType: "image/png" };
  const block = (id: string) => [{ role: "custom", customType: STATE_TYPE, content: [{ type: "text", text: id }, image] },
    { role: "assistant", content: [{ type: "text", text: "a".repeat(4000) }, { type: "toolCall", id, name: "python", arguments: { code: "x" } }] },
    { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "r".repeat(4000) }] }];
  const messages = [{ role: "user", content: "Begin." }, ...block("1"), ...block("2"), ...block("3")];
  const all = evict(messages, 1e9, 0);
  assert.equal(all.messages.length, messages.length);
  assert.deepEqual(all.messages.map((message: any) => Array.isArray(message.content) && message.content.includes(image)).filter(Boolean).length, 1);
  const some = evict(messages, 5500, 0);
  assert.equal(some.messages[0].content[0].text, "2");
  const tight = evict(messages, 10, 0);
  assert.equal(tight.messages[0].content[0].text, "3");
  assert.deepEqual(tight.messages.at(-1).toolCallId, "3");
  assert.equal(evict(messages, 1e9, 2).messages[0].content[0].text, "2");
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
  assert.equal(handlers.context({ messages }, {}).messages.length, 1);
  assert.equal(rows("evict").length, 1);
  handlers.agent_settled();
  assert.equal(rows("segment_end")[0].reason, "context_overflow");
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
  assert.equal(idle.handlers.agent_before_settle(settle).continue, true);
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
