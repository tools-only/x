import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  competition: false, expect: true, graph: true, ...extra });

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
  assert.match(out.text, /\[905 chars omitted from the middle\]/);
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

test("os.makedirs under work/ is a no-op and nested writes work", async () => {
  const { python } = await session();
  const dir = (python as any).workDir as string;
  const out = await python.run([
    "import os",
    "os.makedirs('work/claims', exist_ok=True)",
    "os.mkdir('work/claims')",
    "with open('work/claims/rule.py', 'w') as f: f.write('def check(transition):\\n    return None\\n')",
    "print(open('work/claims/rule.py').read().splitlines()[0])",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^def check\(transition\):/);
  assert.match(readFileSync(join(dir, "claims", "rule.py"), "utf8"), /return None/);
});

test("the host back-tests work/world_model.py and reports the hit rate", async () => {
  const { python } = await session();
  const out = await python.run([
    "with open('work/world_model.py', 'w') as f: f.write('def predict(frame, action):\\n    return frame.grid\\n')",
    "submit_actions(['UP', 'UP'])",
    "print('ran')",
  ].join("\n"));
  assert.match(out.text, /ran/);
  await python.run("pass");
  assert.equal(python.gradient().model, "0/2");
  const next = await python.run("m = harness_state['model']\nprint(m['tested'], m['correct'] < m['tested'])");
  python.close();
  assert.match(next.text, /^2 True/);
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
    "print(d['count'], d['bbox'], len(frames_of(1)), current_frame.ascii((5, 2, 6, 5)))",
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

test("system frame data is copied out, so a model edit cannot corrupt it", async () => {
  const { python } = await session();
  const out = await python.run("copy = current_frame.grid\ncopy[0][0] = 15\nprint(current_frame.grid[0][0])\ncurrent_frame._grids = ()\n");
  const next = await python.run("print(current_frame.grid[0][0], 2 in [cell for row in current_frame.grid for cell in row])");
  python.close();
  assert.match(out.text, /^0/);
  assert.match(next.text, /^0 True/);
});

test("a value assigned to result is returned like Duck's return slot", async () => {
  const { python } = await session();
  const out = await python.run("x = 1\nresult = {'answer': x + 1}\nprint('noise')");
  python.close();
  assert.match(out.text, /^noise\n\{'answer': 2\}$/);
});

test("trimmed names are not bound by default and .ascii still compares as a string", async () => {
  const { python } = await session();
  const out = await python.run(
    "print([name for name in ('show', 'segment', 'gameplay_changed', 'valid_actions_raw') if name in globals()])\n" +
    "print(current_frame.ascii == str(current_frame.ascii), hasattr(current_frame, 'hash'), hasattr(current_frame, 'frames'))");
  python.close();
  assert.match(out.text, /^\[\]\nTrue False False/);
});

test("modules written under work/ and work/harness/lib can be imported", async () => {
  const { python } = await session();
  const first = await python.run([
    "with open('work/world_model.py', 'w') as f: f.write('VALUE = 7\\n')",
    "with open('work/harness/lib/helpers.py', 'w') as f: f.write('def twice(v): return v * 2\\n')",
    "import world_model, helpers",
    "print(world_model.VALUE, helpers.twice(3))",
  ].join("\n"));
  const second = await python.run([
    "with open('work/world_model.py', 'w') as f: f.write('VALUE = 8\\n')",
    "import importlib, world_model",
    "print(importlib.reload(world_model).VALUE)",
  ].join("\n"));
  python.close();
  assert.match(first.text, /^7 6\n/);
  assert.match(second.text, /^8\n/);
});

test("history carries changed and hash; the batch summary lands in last_action_result", async () => {
  const { python } = await session();
  const out = await python.run([
    "first = history[-1]",
    "batch = submit_actions('UP')",
    "print(first.changed, isinstance(first.hash, str), history[-1].changed, isinstance(history[-1].hash, str))",
    "print(batch['executed_count'], last_action_result['executed_count'], last_action_result['stop_reason'], last_action_result['levels_completed'])",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^False True True True\n1 1 None 0\n/);
});

test("an expect miss stops the batch, marks surprise and tracks the hit rate", async () => {
  const { python } = await session();
  const hit = await python.run("result = submit_actions('UP', expect=(1, 3))");
  assert.match(hit.text, /'surprise': False/);
  assert.match(hit.text, /'expect_hits': '1\/1'/);
  assert.equal(hit.acted?.surprise, undefined);
  const miss = await python.run("result = submit_actions(['UP', 'UP'], expect=(5, 9))");
  assert.match(miss.text, /SURPRISE: did not match expect/);
  assert.match(miss.text, /'stop_reason': 'surprise'/);
  assert.match(miss.text, /'expect_hits': '1\/2'/);
  assert.equal(miss.acted?.surprise, true);
  assert.equal(miss.acted?.expect_hits, "1/2");
  const invalid = await python.run("try:\n    submit_actions('UP', expect='big change')\nexcept ValueError:\n    print('rejected')");
  const wide = await python.run("try:\n    submit_actions('UP', expect=(1, 100))\nexcept ValueError:\n    print('too wide')");
  python.close();
  assert.match(invalid.text, /rejected/);
  assert.match(wide.text, /too wide/);
});

test("graph helpers summarise seen states; known no-ops are skipped unless forced", async () => {
  const { python } = await session();
  const out = await python.run([
    "submit_actions(['UP', 'DOWN'])",
    "g = graph_summary()",
    "print(g['states'], g['edges'], g['frontier_count'], replay_to(history[-1].hash), replay_to('ffffffff'))",
  ].join("\n"));
  assert.match(out.text, /^2 2 2 \[\] None/);
  const skip = await python.run("result = submit_actions(['DOWN', 'UP'], skip_known_noops=True)");
  assert.match(skip.text, /DOWN: skipped, a known no-op/);
  assert.match(skip.text, /'executed_count': 1/);
  assert.match(skip.text, /'skipped_noops': 1/);
  const route = await python.run("print(bfs_graph(lambda f: f.grid[5][3] == 2))\nprint(submit_actions('DOWN', force=True, skip_known_noops=True)['executed_count'])");
  python.close();
  assert.match(route.text, /^\['UP'\]\n1/);
});

test("expect and graph helpers are disabled by default for ablations", async () => {
  const { python } = await session({ expect: false, graph: false });
  const out = await python.run([
    "print('bfs_graph' in globals(), 'graph_summary' in globals())",
    "try:\n    submit_actions('UP', expect=(1, 3))\nexcept ValueError as e:\n    print('expect off')",
    "print(submit_actions('UP')['executed_count'])",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^False False\nexpect off\n1/);
});

test("harness_state is bound with run evidence and refreshes between calls", async () => {
  const { python } = await session();
  const first = await python.run([
    "with open('work/notes.md', 'w') as f: f.write('x')",
    "submit_actions('UP')",
    "h = harness_state",
    "print(h['progress']['steps_since_level'], h['cost']['python_calls'], h['predictions']['unchecked_batches'])",
  ].join("\n"));
  assert.match(first.text, /^0 1 0/);
  await python.run("1 / 0");
  await python.run("submit_actions(['DOWN', 'DOWN'], stop_on_noop=False)");
  await python.run("submit_actions(['DOWN', 'DOWN'], stop_on_noop=False)");
  const second = await python.run([
    "h = harness_state",
    "print(h['progress']['steps_since_level'], h['progress']['stale_steps'], h['attempts']['repeated_sequences'], h['predictions']['unchecked_batches'])",
    "print(len(h['attempts']['recent']), h['errors'][-1].split(':')[-1].strip(), h['artifacts'][0]['path'], h['progress']['resets'])",
  ].join("\n"));
  await python.run("submit_actions('UP', expect=(1, 3))");
  const third = await python.run("h = harness_state\nprint(h['predictions']['unchecked_batches'], h['predictions']['expect_hits'])");
  python.close();
  assert.match(second.text, /^5 4 1 3\n5 division by zero work\/notes\.md 0/);
  assert.match(third.text, /^0 1\/1/);
});

test("a completed level freezes submit_actions until a review unfreezes it", async () => {
  const { python } = await session({ review: true });
  const levelUp = await python.run("print(submit_actions(['UP'] * 3)['stop_reason'])");
  assert.match(levelUp.text, /^level_change/);
  const frozen = await python.run([
    "try:\n    submit_actions('UP')\nexcept RuntimeError as e:\n    print(str(e)[:14])",
    "try:\n    review(layer='vibes', diagnosis='d', evidence=[1], change='c', test='t')\nexcept ValueError:\n    print('bad layer')",
    "try:\n    review(layer='goal', diagnosis='d', evidence=[], change='c', test='t')\nexcept ValueError:\n    print('no evidence')",
    "try:\n    review(layer='goal', diagnosis='d', evidence=[1], change='none', test=' ')\nexcept ValueError:\n    print('no test')",
    "r = review(layer='goal', diagnosis='reach row 4', evidence=[1, 2], change='go up fast', test='two UPs complete a level', place='prompt', artifact='work/prompt.md')",
    "print(r['unfrozen'], submit_actions('UP')['executed_count'])",
  ].join("\n"));
  python.close();
  assert.match(frozen.text, /^ReviewRequired\nbad layer\nno evidence\nno test\nTrue 1/);
  assert.equal(frozen.reviews?.length, 1);
  assert.equal((frozen.reviews?.[0] as any).layer, "goal");
  assert.match(String((frozen.reviews?.[0] as any).trigger), /complete/);
});

test("the first acting batch after a review reports whether its expect held", async () => {
  const { python } = await session({ review: true });
  await python.run("submit_actions(['UP'] * 3)");
  const out = await python.run([
    "try:\n    review(layer='goal', diagnosis='d', evidence=[1], change='goal', test='t')\nexcept ValueError:\n    print('layer name rejected')",
    "review(layer='goal', diagnosis='d', evidence=[1], change='rows fill upward', test='UP keeps changing cells', place='memory', artifact='work/claims.md')",
    "print(submit_actions('RESET')['review_test'])",
    "r = submit_actions('UP', expect=lambda before, after: True)",
    "print(r['review_test'], harness_state['predictions'].get('last_review_test'))",
    "print(submit_actions('UP')['review_test'])",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^layer name rejected\nNone\nhit hit\nNone/);
  assert.equal((out.acted as any)?.review_test, undefined);
});

test("a callable review test runs after every later action and is mounted in harness_state", async () => {
  const { python } = await session({ review: true });
  await python.run("submit_actions(['UP'] * 3)");
  const out = await python.run([
    "review(layer='rule', diagnosis='UP always changes the frame', evidence=[1], change='keep going up', test=lambda t: t.action == 'UP', place='memory', artifact='work/claims.md')",
    "r = submit_actions(['UP', 'UP'])",
    "print(harness_state['predictions']['review_checks'])",
  ].join("\n"));
  const mounted = await python.run(
    "print(harness_state['reviews'][-1]['change'], '|', harness_state['reviews'][-1]['test'])");
  python.close();
  assert.match(out.text, /\{'r1': '2 ok \/ 0 fail'\}/);
  assert.match(mounted.text, /keep going up \| <callable/);
});

test("a review must declare a landing place and the host verifies the artifact", async () => {
  const { python } = await session({ review: true });
  await python.run("submit_actions(['UP'] * 3)");
  const out = await python.run([
    "try:\n    review(layer='goal', diagnosis='d', evidence=[1], change='c', test='t')\nexcept ValueError:\n    print('no place')",
    "try:\n    review(layer='goal', diagnosis='d', evidence=[1], change='c', test='t', place='vibes', artifact='work/x.py')\nexcept ValueError:\n    print('bad place')",
    "try:\n    review(layer='goal', diagnosis='d', evidence=[1], change='c', test='t', place='tool', artifact='lib/x.py')\nexcept ValueError:\n    print('bad artifact')",
    "review(layer='goal', diagnosis='push up', evidence=[1], change='push the block up', test='UP changes cells', place='tool', artifact='work/lib/up.py')",
    "f = open('work/lib/up.py', 'w')\nf.write('def up():\\n    return 1\\n')\nf.close()",
    "r = submit_actions('UP')",
    "print(r['review_test'])",
  ].join("\n"));
  python.close();
  assert.match(out.text, /^no place\nbad place\nbad artifact\nuntested/);
  assert.equal((out.acted as any)?.review_placement, "placed");
  assert.equal((out.acted as any)?.review_artifact, "work/lib/up.py");
  assert.equal((out.reviews?.[0] as any).place, "tool");
  assert.equal((out.reviews?.[0] as any).placed, true);
});

test("a declared-but-unwritten artifact is reported as unplaced", async () => {
  const { python } = await session({ review: true, reviewStuckSteps: 2 });
  await python.run("submit_actions(['DOWN'] * 4, stop_on_noop=False)");
  const out = await python.run([
    "review(layer='rule', diagnosis='DOWN is a noop', evidence=[1, 2], change='move with UP only', test='UP changes cells', place='memory', artifact='work/claims.md')",
    "r = submit_actions('UP')",
    "print(r['review_test'])",
  ].join("\n"));
  python.close();
  assert.equal((out.acted as any)?.review_placement, "unplaced");
  assert.equal((out.acted as any)?.review_artifact, "work/claims.md");
});

test("claims are executed on every transition and validated by the host ledger", async () => {
  const { python } = await session({ claims: true });
  await python.run([
    "f = open('work/claims/up_moves.py', 'w')",
    "f.write('\"UP moves the piece\"\\ndef check(t):\\n    return True if t.action == \"UP\" else None\\n')",
    "f.close()",
  ].join("\n"));
  await python.run("print(submit_actions(['UP'] * 2)['executed_count'])");
  const third = await python.run("submit_actions('UP')\nprint('ok')");
  const fourth = await python.run("c = harness_state['claims']['up_moves']\nprint(c['state'], c['support'], c['counter'], c['scale'])");
  python.close();
  assert.deepEqual((third.acted as any)?.claims_validated, ["up_moves"]);
  assert.match(fourth.text, /^validated 3 0 game/);
});

test("a counterexample falsifies a claim and editing the file resets its record", async () => {
  const { python } = await session({ claims: true });
  await python.run([
    "f = open('work/claims/down_changes.py', 'w')",
    "f.write('def check(t):\\n    return t.after_frame.grid != t.before_frame.grid if t.action == \"DOWN\" else None\\n')",
    "f.close()",
    "f = open('work/claims/boom.py', 'w')",
    "f.write('def check(t):\\n    raise ValueError(\"broken claim\")\\n')",
    "f.close()",
  ].join("\n"));
  const second = await python.run("r = submit_actions('DOWN')\nprint(r['executed_count'])");
  const third = await python.run(
    "c = harness_state['claims']\nprint(c['down_changes']['state'], 'broken claim' in c['boom'].get('error', ''))");
  await python.run("f = open('work/claims/down_changes.py', 'w')\nf.write('def check(t):\\n    return None\\n')\nf.close()");
  const fifth = await python.run(
    "c = harness_state['claims']['down_changes']\nprint(c['state'], c['support'], c['counter'])");
  python.close();
  assert.deepEqual((second.acted as any)?.claims_falsified, ["down_changes"]);
  assert.match(third.text, /^falsified True/);
  assert.match(fifth.text, /^hypothesis 0 0/);
});

test("stagnation freezes acting mid-batch and the freeze survives calls", async () => {
  const { python } = await session({ review: true, reviewStuckSteps: 2 });
  const out = await python.run("r = submit_actions(['DOWN'] * 4, stop_on_noop=False)\nprint(r['executed_count'], r['stop_reason'])");
  assert.match(out.text, /^2 review required: 2 steps without a new state/);
  const blocked = await python.run([
    "try:\n    submit_actions('UP')\nexcept RuntimeError as e:\n    print('frozen')",
    "review(layer='rule', diagnosis='DOWN does nothing here', evidence=[1, 2], change='none', test='UP changes the frame')",
    "print(submit_actions('UP')['executed_count'])",
  ].join("\n"));
  python.close();
  assert.match(blocked.text, /^frozen\n1/);
});

test("a half-spent level budget freezes acting once", async () => {
  const { python } = await session({ review: true });
  await python.run("submit_actions(['DOWN'] * 16, stop_on_noop=False)");
  const out = await python.run("r = submit_actions(['DOWN'] * 16, stop_on_noop=False)\nprint(r['executed_count'], r['stop_reason'])");
  python.close();
  assert.match(out.text, /^9 review required: half the level budget/);
});

test("review triggers can be restricted to a subset", async () => {
  const { python } = await session({ review: true, reviewStuckSteps: 2, reviewTriggers: ["game_over"] });
  const out = await python.run("r = submit_actions(['DOWN'] * 8, stop_on_noop=False)\nprint(r['executed_count'], r.get('stop_reason'))");
  python.close();
  assert.match(out.text, /^8 None/);
});

test("work/startup.py runs once at kernel start and surfaces errors", async () => {
  const { python } = await session();
  const dir = (python as any).workDir as string;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "startup.py"), "GREETING = 'from-startup'\n");
  const out = await python.run("print(GREETING)");
  assert.match(out.text, /^from-startup/);
  const again = await python.run("print(GREETING)");
  assert.match(again.text, /^from-startup/);
  python.close();
  const { python: broken } = await session();
  const dir2 = (broken as any).workDir as string;
  mkdirSync(dir2, { recursive: true });
  writeFileSync(join(dir2, "startup.py"), "raise ValueError('boom')\n");
  const bad = await broken.run("print('alive')");
  broken.close();
  assert.match(bad.text, /\[startup\] work\/startup.py failed: ValueError: boom/);
  assert.match(bad.text, /alive/);
});
