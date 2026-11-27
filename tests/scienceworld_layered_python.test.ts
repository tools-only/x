import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ScienceWorldLayeredPython, type ScienceWorldLayeredConfig } from "../demo/scienceworld_layered_python.ts";

class FakeBridge {
  observation = "You are in a kitchen.";
  level = 1;
  levels = 0;
  used = 0;
  runState = "NOT_FINISHED";
  last = "";
  snapshot() {
    return {
      task: "1-1", variation: 0, level: this.level, levels_completed: this.levels, win_levels: 2,
      state: this.runState, observation: this.observation, score: 0, step: this.used,
      actions_used: this.used, budget_left: 40 - this.used, level_budget: 20, level_budget_left: 20 - this.used,
      look: "kitchen", inventory: "empty", task_description: "Boil water.", valid_actions: ["look around", "open fridge"],
      last: this.last,
    };
  }
  async state() { return this.snapshot(); }
  async act(payload: { action: string }) {
    this.used += 1;
    this.last = payload.action;
    if (payload.action === "look around") this.observation = "You see a stove.";
    return { state: this.snapshot(), transition: { action: payload.action, state: this.runState } };
  }
}

function config(): ScienceWorldLayeredConfig {
  return { timeoutMs: 30000, outputChars: 8192, maxActionsPerCall: 16,
    workDir: join(mkdtempSync(join(tmpdir(), "sw-python-")), "work") };
}

test("init binds the observation and submit_actions drives the bridge", async () => {
  const bridge = new FakeBridge();
  const python = new ScienceWorldLayeredPython(bridge as any, config());
  try {
    const state = await python.init();
    assert.equal(state.observation, "You are in a kitchen.");
    const first = await python.run("print(current_obs.observation, valid_actions[:2])");
    assert.match(first.text, /You are in a kitchen\./);
    assert.match(first.text, /look around/);
    const acted = await python.run("submit_actions('look around')");
    assert.equal(acted.acted?.executed, 1);
    assert.equal(bridge.used, 1);
    const after = await python.run("print(current_obs.observation)");
    assert.match(after.text, /You see a stove\./);
  } finally {
    python.close();
  }
});

test("a non-action cell returns no action batch", async () => {
  const python = new ScienceWorldLayeredPython(new FakeBridge() as any, config());
  try {
    await python.init();
    const out = await python.run("print(1 + 1)");
    assert.equal(out.acted, null);
    assert.match(out.text, /2/);
  } finally {
    python.close();
  }
});
