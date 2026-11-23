import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LayeredPython, type LayeredConfig } from "../demo/arc_layered_python.ts";

class FakeBridge {
  row = 6; levels = 0; used = 0; last = "";
  frame() {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(0));
    grid[this.row][3] = 2;
    return { frames: [grid], state: this.levels >= 2 ? "WIN" : "NOT_FINISHED", levels_completed: this.levels, win_levels: 2,
      agent_available_actions: ["RESET", "ACTION1", "ACTION2", "ACTION6", "ACTION7"],
      action_budget: { total_used: this.used, total_maximum: 50 }, observation_delta: { changed_cells: 2 } };
  }
  async state() { return this.frame(); }
  async act(payload: { action: string }) {
    this.used += 1; this.last = payload.action;
    if (payload.action === "ACTION1") this.row -= 1;
    if (payload.action === "RESET") this.row = 6;
    if (this.row === 4) { this.levels += 1; this.row = 6; }
    return this.frame();
  }
}

const config = (extra: Partial<LayeredConfig> = {}): LayeredConfig => ({ numericGrid: true, namespaceResetPerCall: false, undo: false,
  timeoutMs: 30000, outputChars: 4096, maxActionsPerCall: 16, workDir: join(mkdtempSync(join(tmpdir(), "layered-")), "work"),
  competition: false, ...extra });

async function session(extra: Partial<LayeredConfig> = {}) {
  const bridge = new FakeBridge();
  const python = new LayeredPython(bridge as any, config(extra));
  await python.init();
  return { bridge, python };
}

test("variables refresh inside the same call after submit_actions", async () => {
  const { python } = await session();
  const out = await python.run("before = current_frame.ascii\nr = submit_actions('UP')\nprint(before != current_frame.ascii, last_action, len(history), previous_frame.ascii == before)\nprint(valid_actions)");
  python.close();
  assert.match(out.text, /^True UP 2 True/);
  assert.match(out.text, /\['RESET', 'UP', 'DOWN', 'MOUSE'\]/);
  assert.equal(out.acted?.executed, 1);
  assert.match(out.text, /\[env\] executed 1 \(UP\)/);
});

test("a level change stops the batch and later submits in the same call", async () => {
  const { python } = await session();
  const out = await python.run("a = submit_actions(['UP'] * 5)\nb = submit_actions('UP')\nprint(a['executed_count'], a['stop_reason'], b['executed_count'], b['stop_reason'])");
  assert.match(out.text, /^2 level_change 0 previous_level_change/);
  assert.equal(out.acted?.level_changed, true);
  const next = await python.run("submit_actions('UP')['executed_count'], current_frame.level");
  python.close();
  assert.match(next.text, /^\(1, 2\)/);
});

test("a second consecutive RESET needs confirmation, UNDO is off", async () => {
  const { python, bridge } = await session();
  const out = await python.run("print(submit_actions('RESET')['executed_count'])\nprint(submit_actions('RESET')['stop_reason'])\nprint(submit_actions('UNDO')['stop_reason'])");
  assert.match(out.text, /^1\na second consecutive RESET[^\n]*\nUNDO is not available/);
  const confirmed = await python.run("submit_actions('RESET', confirm_full_reset=True)['executed_count']");
  python.close();
  assert.match(confirmed.text, /^1/);
  assert.equal(bridge.used, 2);
});

test("output is truncated with a marker; errors keep only user frames", async () => {
  const { python } = await session();
  const out = await python.run("print('x' * 5000)");
  const failed = await python.run("def f():\n    return 1 / 0\nf()");
  python.close();
  assert.equal(out.truncated, true);
  assert.match(out.text, /\[truncated 905 chars\]$/);
  assert.match(failed.text, /ZeroDivisionError/);
  assert.doesNotMatch(failed.text, /prelude|kernel/);
});

test("open() reaches work/ only", async () => {
  const { python } = await session();
  const dir = (python as any).workDir as string;
  const out = await python.run([
    "with open('work/notes.md', 'w') as f: f.write('hello')",
    "with open('notes.md', 'a') as f: f.write(' world')",
    "print(open('work/notes.md').read())",
    "for bad in ['../escape.txt', 'C:/Windows/x.txt', 'work/../../x']:",
    "    try:\n        open(bad, 'w').close()\n    except PermissionError as e:\n        print('denied')",
    "try:\n    open('missing.txt')\nexcept FileNotFoundError:\n    print('missing')",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^hello world\ndenied\ndenied\ndenied\nmissing/);
  assert.equal(readFileSync(join(dir, "notes.md"), "utf8"), "hello world");
});

test("namespace persists by default and resets per call when configured", async () => {
  const kept = await session();
  await kept.python.run("x = 41");
  const persisted = await kept.python.run("x + 1");
  kept.python.close();
  assert.match(persisted.text, /^42/);
  const fresh = await session({ namespaceResetPerCall: true, numericGrid: false });
  await fresh.python.run("x = 41; submit_actions('UP')");
  const reset = await fresh.python.run("print('x' in globals(), len(history), len(transitions))\ntry:\n    current_frame.grid\nexcept AttributeError:\n    print('no grid')");
  fresh.python.close();
  assert.match(reset.text, /^False 2 1\nno grid/);
});

test("segmentation, diff and frames_of", async () => {
  const { python } = await session();
  const out = await python.run([
    "seg = current_frame.segmentation",
    "dot = [n for n in seg['nodes'] if n['color'] == 'g'][0]",
    "print(len(seg['nodes']), dot['pixels'], dot['boundary'], seg['nodes'][0]['children'], len(seg['adjacency_list']))",
    "submit_actions('UP')",
    "d = diff(previous_frame, current_frame)",
    "print(d['count'], d['bbox'], len(frames_of(1)), ascii(current_frame, (5, 2, 6, 5)))",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^2 1 \[\[6, 3\], \[6, 4\], \[7, 4\], \[7, 3\]\] \[1\] 1\n2 \(5, 3, 6, 3\) 1 WgW/);
});

test("a timed-out call ends the kernel; the next call restores history but not names", async () => {
  const { python } = await session({ timeoutMs: 2000 });
  await python.run("x = 1; submit_actions('UP')");
  const timedOut = await python.run("while True: pass");
  const after = await python.run("print('x' in globals(), len(history), last_action)");
  python.close();
  assert.equal(timedOut.kernelRestarted, true);
  assert.match(timedOut.text, /compute time.*\nThe Python kernel ended/s);
  assert.match(after.text, /^False 2 UP/);
});
