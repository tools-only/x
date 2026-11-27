import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installScienceWorldLayered, SCIENCEWORLD_STATE_TYPE } from "../demo/scienceworld_layered_extension.ts";

function setup(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, any> = {}, tools: Record<string, any> = {};
  const pi: any = {
    on: (name: string, handler: any) => { handlers[name] = handler; },
    registerTool: (definition: any) => { tools[definition.name] = definition; },
  };
  const game: any = { level: 1, levels_completed: 0, win_levels: 3, state: "NOT_FINISHED", step: 0, actions_used: 0,
    budget_left: 40, level_budget: 20, level_budget_left: 20, valid_actions: ["look around", "open door to kitchen"],
    observation: "You are in a room.", look: "room", inventory: "empty", task_description: "Find the key.", score: 0,
    stale_steps: 0, unchecked_batches: 0 };
  const python: any = {
    init: async () => game,
    state: () => game,
    close() {},
    syncMemoryChecks: async () => ({}),
    async run() { return { text: "ok", truncated: false, acted: null, metrics: {} }; },
  };
  const root = (overrides.root as string) ?? mkdtempSync(join(tmpdir(), "sw-layered-"));
  installScienceWorldLayered(pi, python, {
    root, harnessProfile: Boolean(overrides.harnessProfile), outputTokens: 4096, maxActionsPerCall: 16,
    idleContinuations: 2, timeoutMs: 30000, outputChars: 8192,
  });
  return { handlers, tools, game, python, root };
}
const textOf = (content: any[]) => content.filter(part => part.type === "text").map(part => part.text).join("\n");

test("opens with the scienceworld system prompt and a text observation", async () => {
  const { handlers, tools } = setup();
  const opened = await handlers.before_agent_start({});
  assert.match(opened.systemPrompt, /submit_actions/);
  assert.doesNotMatch(opened.systemPrompt, /\{\{/);
  assert.equal(opened.message.customType, SCIENCEWORLD_STATE_TYPE);
  assert.match(textOf(opened.message.content), /Find the key\./);
  assert.match(textOf(opened.message.content), /level 1\/3/);
  assert.deepEqual(Object.keys(tools.python.parameters.properties), ["code"]);
  assert.deepEqual(handlers.session_before_compact(), { cancel: true });
});

test("harness profile registers component tools and reflects memory", async () => {
  const { handlers, tools } = setup({ harnessProfile: true });
  assert.ok(tools.reflect_component);
  assert.ok(tools.read_component);
  await handlers.before_agent_start({});
  const saved = await tools.reflect_component.execute("id", { op: "define", kind: "memory", name: "current", body: "Confirmed: door north" });
  assert.match(saved.content[0].text, /memory\/current v1/);
  const read = await tools.read_component.execute("id", { kind: "memory", name: "current" });
  assert.match(read.content[0].text, /Confirmed: door north/);
});

test("acting ends the turn and an idle turn reopens it", async () => {
  const { handlers, tools, python, game } = setup();
  await handlers.before_agent_start({});
  python.run = async () => ({ text: "acted", truncated: false, acted: { executed: 1, actions: ["look around"], lines: ["look around: score 0"],
    level_changed: false, game_over: false, win: false }, metrics: {} });
  game.observation = "You see a table.";
  const result = await tools.python.execute("id", { code: "submit_actions('look around')" });
  assert.equal(result.terminate, true);
  assert.ok(result.details.acted);
  await handlers.before_agent_start({});
  const reopened = await handlers.agent_before_settle({ outcome: "completed", entries: [], continue: false });
  assert.ok(reopened.continue);
  assert.match(textOf(reopened.entries[0].content), /Continue/);
});
