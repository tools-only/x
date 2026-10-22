/**
 * ARC_THIN_OBSERVATION=ch (the runner's native default since 2026-10-20) against an HTTP stand-in for the bridge:
 * Continual Harness's game observation (RECENT HISTORY, # Step, OBSERVATIONS SINCE LAST QUERY, CURRENT STATE, PNGs) in
 * place of this harness's current-state block, and arc_action taking CH's action list, inside this harness's own
 * decision: the transcript of earlier decisions, its prompts, reviews and caps, and RESET as the agent's action. The
 * renderers themselves are compared with CH's own output in arc_thin_ch_view.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

async function fixture(extra: Record<string, string> = {}) {
  const submitted: string[] = [];
  // A marker on row 2 that ACTION1 moves right; ACTION2 does nothing; ACTION3 ends the game; ACTION4 completes the level.
  let x = 1, level = 0, state = 'NOT_FINISHED', acted = false;
  const grid = () => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => r === 2 && c === x ? 9 : level));
  const server = createServer((req, res) => {
    let text = ''; req.on('data', (c) => text += c); req.on('end', () => {
      let changed = 0, levelChanged = false;
      if (req.url === '/action') {
        const { action } = JSON.parse(text);
        submitted.push(action);
        if (action === 'RESET') { x = 1; state = 'NOT_FINISHED'; acted = false; changed = 2; }
        else {
          acted = true;
          if (action === 'ACTION1') { x += 1; changed = 2; }
          if (action === 'ACTION3') state = 'GAME_OVER';
          if (action === 'ACTION4') { level += 1; levelChanged = true; changed = 64; }
        }
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ frames: [grid()], state, levels_completed: level,
        agent_available_actions: state === 'GAME_OVER' ? ['RESET'] : [...(acted ? ['RESET'] : []), 'ACTION1', 'ACTION2', 'ACTION3', 'ACTION4'],
        action_budget: { used: submitted.length, maximum: null, total_used: submitted.length, total_maximum: null },
        observation_delta: { frame_available: true, changed_cells: changed, cells: [] }, public_transition: { level_changed: levelChanged } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'ch-observation-'));
  const env = { ...process.env };
  delete process.env.ARC_THIN_OBSERVATION; // Exercise the extension's native default, not an explicit CH override.
  // The reviews' consult-first call point is tested in arc_thin_loop_bound.test.ts.
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'disabled',
    ARC_HARNESS_CRITIC: 'disabled', ARC_REFINE_EVERY: '1000000', ARC_THIN_REVIEW_CONSULT: '0', ...extra });
  const tools = new Map<string, any>(), handlers = new Map<string, any[]>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()],
    on: (e: string, f: any) => handlers.set(e, [...(handlers.get(e) ?? []), f]), getThinkingLevel: () => 'off' } as any);
  const ctx: any = { model: { input: ['text', 'image'] } };
  const emit = async (name: string, event: any) => {
    let out: any;
    for (const f of handlers.get(name) ?? []) out = (await f(event, ctx)) ?? out;
    return out;
  };
  await emit('session_start', {});
  let system = '', sections: Record<string, string> = {}, calls = 0;
  /** The session as Pi keeps it: each decision's prompt, then its assistant messages and tool results. */
  const session: any[] = [];
  return {
    submitted, tool: (name: string) => tools.get(name), system: () => system, sections: () => sections, active: () => active,
    rows: () => readFileSync(join(root, 'harness', 'trajectory.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    logs: (name: string) => readFileSync(join(root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    /** A new decision: the runner's prompt, then the messages the model receives (earlier decisions, then the head). */
    async decide(prompt = 'Decide the next action.') {
      const event: any = { prompt, systemPromptOptions: { sections: {} } };
      await emit('before_agent_start', event);
      system = String(event.systemPromptOptions.customPrompt ?? '');
      sections = event.systemPromptOptions.sections;
      session.push({ role: 'user', content: prompt, timestamp: Date.now() });
      return (await emit('context', { messages: [...session] })).messages as any[];
    },
    /** One assistant message with these calls (or text only), then each call run and its result. */
    async respond(...called: Array<[string, any]>) {
      const blocks = called.map(([name, args]) => ({ type: 'toolCall', id: `c${++calls}`, name, arguments: args }));
      const message = { role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: 'thinking' }], usage: { input: 0, output: 0 },
        stopReason: blocks.length ? 'toolUse' : 'stop', timestamp: Date.now() };
      await emit('message_end', { message });
      session.push(message);
      const results = [];
      for (const block of blocks) {
        const tool = tools.get(block.name);
        let result: any, isError = false;
        try { result = await tool.execute(block.id, tool.prepareArguments ? tool.prepareArguments(block.arguments) : block.arguments, undefined, undefined, ctx); }
        catch (error) { result = { content: [{ type: 'text', text: String((error as Error).message) }], details: {} }; isError = true; }
        session.push({ role: 'toolResult', toolCallId: block.id, toolName: block.name, content: result.content, isError, timestamp: Date.now() });
        results.push({ ...result, isError, text: result.content?.[0]?.text });
      }
      return results;
    },
    /** The provider failed this turn. */
    fail: (errorMessage: string) => emit('message_end', { message: { role: 'assistant', content: [], stopReason: 'error', errorMessage,
      usage: { input: 0, output: 0 } } }),
    async close() {
      await emit('session_shutdown', {});
      await new Promise<void>((r) => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
      Object.assign(process.env, env);
    },
  };
}
const head = (messages: any[]) => messages.at(-1);
const textOf = (message: any) => message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
const section = (text: string, name: string) => text.slice(text.indexOf(name)).split(/\n\n(?=## |# Step)/)[0];

test('native defaults to CH observation and action list, after this harness\'s own sections', async () => {
  const h = await fixture();
  try {
    const messages = await h.decide(), text = textOf(head(messages));
    assert.match(text, /^Decide the next action\.\n\n/, 'the runner\'s prompt stays');
    const order = ['## RECENT HISTORY', '# Step: 1', '## OBSERVATIONS SINCE LAST QUERY', '## CURRENT STATE'].map((name) => text.indexOf(name));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `observation blocks in CH order: ${order}`);
    assert.ok(text.indexOf('MEMORY') < order[0], 'this harness\'s memory comes first');
    assert.match(section(text, '## RECENT HISTORY'), /══ Level 1 — started at step None ══\n\(no actions yet\)/);
    assert.match(text, /### ACTION step 0: RESET\nRESULT: state NOT_PLAYED -> NOT_FINISHED; score 0 -> 0; source=auto_reset/,
      'the bridge\'s first RESET is CH\'s step 0');
    const current = section(text, '## CURRENT STATE');
    assert.match(current, /available actions: \n {2}ACTION1: \(1, W, Up\)\.\n {2}ACTION2: \(2, S, Down\)\./);
    assert.match(current, /Grid current_state_frame \(8x8\) \[hex 0-f = color 0-15\]:\n00000000\n00000000\n09000000/);
    assert.doesNotMatch(text, /TOOL RESULTS FROM PREVIOUS TURN|## TURN|PREVIOUS CONVERSATION STOPPED|RECENT ACTIONS/);
    assert.equal(head(messages).content.filter((b: any) => b.type === 'image').length, 1, 'the PNG of each grid rendered as text');
    assert.match(h.system(), /A decision ends after an acting call \(arc_action, which plays its list of actions in order/);
    assert.match(h.system(), /predict carries it, on each entry of arc_action's list and on env\.act\. [\s\S]*An action list stops at the first missed prediction/);
    assert.match(h.system(), /## INPUT FORMAT[\s\S]*## COORDINATE SYSTEM[\s\S]*ACTION7=Undo\/Back · RESET=restart the level[\s\S]*## GAME SETTING/);
    assert.doesNotMatch(h.system(), /Soft guideline|RESET is not one of your actions|non-action turns/);
    assert.deepEqual(Object.keys(h.tool('arc_action').parameters.properties).sort(), ['actions', 'predict_skill', 'reasoning']);
  } finally { await h.close(); }
});

test('CH actions retain per-step predictions, predictor tools, experiment tags and immediate goal/carry feedback', async () => {
  const h = await fixture({ ARC_HARNESS_LEDGER: 'enabled', ARC_THIN_GOAL_ADMISSION: 'on', ARC_THIN_LEVEL_CARRY: 'on' });
  try {
    await h.decide();
    const results = await h.respond(
      ['memory', { hypotheses: [{ key: 'hyp.goal', question: 'goal', claim: 'every action wins',
        check: 'def check(t):\n    return True', status: 'open' }] }],
      ['write', { path: 'tools/predictor.py', content: '# view: off\ndef predict(state, action):\n    return {"level_changed": False}\n' }],
      ['write', { path: 'tools/current.py', content: '# view: on\nprint(grid[2].index(9))\n' }]);
    assert.ok(results.every(r => !r.isError), JSON.stringify(results));
    // Bind the tools at the next request; the view is read-only and the predictor runs before each real action.
    await h.decide();
    const [played] = await h.respond(['arc_action', { reasoning: 'test two steps', idea: 'first-default', actions: [
      { name: 'ACTION1', predict: { cells: [[2, 2, 9]], level_changed: false }, predict_skill: 'missing', idea: 'move-first' },
      { name: 'ACTION2', predict: { cells: [[2, 2, 9]], level_changed: false }, idea: 'wait-second' }] }]);
    assert.match(played.text, /GOAL_OUTCOME hyp.goal: false_win at #1/);
    assert.match(played.text, /GOAL_OUTCOME hyp.goal: false_win at #2/);
    const rows = h.rows();
    assert.deepEqual(rows.map(row => row.idea), ['move-first', 'wait-second']);
    assert.deepEqual(rows.map(row => row.prediction.misses), [0, 0]);
    assert.equal(rows[0].skill_prediction.name, 'missing', 'entry predictor selector reaches the existing skill boundary');
    assert.equal(rows[0].skill_prediction.error, 'no such skill');
    assert.ok(rows.every(row => row.predictors.some((p: any) => p.path === 'tools/predictor.py' && p.hits === 1)));
    await h.decide();
    const [win] = await h.respond(['arc_action', { reasoning: 'win', actions: [{ name: 'ACTION4' }, { name: 'ACTION1' }] }]);
    assert.match(win.text, /GOAL_OUTCOME hyp.goal: win_held at #3/);
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION2', 'ACTION4'], 'the list stops at the real level change');
    const next = textOf(head(await h.decide()));
    assert.match(next, /CARRIED FROM LEVEL 1/);
    assert.match(next, /## RECENT HISTORY[\s\S]*## CURRENT STATE/);
    await h.respond(['arc_action', { reasoning: 'observe current level', actions: [{ name: 'ACTION1' }] }]);
    await h.decide(); // the new state's view has run and carry has advanced
    const [continued] = await h.respond(['arc_action', { reasoning: 'continue', actions: [{ name: 'ACTION2' }] }]);
    assert.match(continued.text, /CARRY DELTA \(level 2\): view tools\/current.py@1/);
    assert.ok(h.logs('goal_checks.jsonl').some(row => row.n === 3 && row.verdict === 'win_held'));
    assert.ok(h.logs('observer_runs.jsonl').some(row => row.n === 4 && row.ok));
    await h.decide();
    const [pythonAction] = await h.respond(['python', { code: 'print(env.act("ACTION2", predict={"level_changed": False}))' }]);
    assert.equal(pythonAction.isError, false, pythonAction.text);
    assert.match(pythonAction.text, /GOAL_OUTCOME hyp.goal: false_win at #6/);
    assert.equal(h.rows().at(-1).prediction.hits, 1, 'env.act keeps the same prediction and goal feedback under CH');
  } finally { await h.close(); }
});

test('CH control keeps the action list and live refusal boundary without prediction or experiment fields', async () => {
  const h = await fixture({ ARC_THIN_VARIANT: 'control' });
  try {
    await h.decide();
    const properties = h.tool('arc_action').parameters.properties;
    assert.deepEqual(Object.keys(properties).sort(), ['actions', 'reasoning']);
    assert.deepEqual(Object.keys(properties.actions.items.properties).sort(), ['name', 'x', 'y']);
    const [refused] = await h.respond(['arc_action', { reasoning: 'unavailable', actions: [{ name: 'ACTION6', x: 0, y: 0 }] }]);
    assert.equal(refused.isError, true);
    assert.deepEqual(h.submitted, []);
    const [played] = await h.respond(['arc_action', { reasoning: 'move', actions: [{ name: 'ACTION1' }] }]);
    assert.equal(played.isError, false, played.text);
    assert.deepEqual(h.submitted, ['ACTION1']);
  } finally { await h.close(); }
});

test('arc_action plays a list in order, cut at its first bad entry and stopped by a level change; the next decision shows each step', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [played] = await h.respond(['arc_action', { reasoning: 'walk right', actions: [{ name: 'ACTION1' }, { name: 'action1' }, { name: 'ACTION9' }, { name: 'ACTION1' }] }]);
    assert.equal(played.terminate, true, 'a list that played ends the decision');
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION1'], 'the unknown name and everything after it is not played');
    assert.match(played.text, /^#1 ACTION1 → changed=2[\s\S]*\n#2 ACTION1 → changed=2[\s\S]*\nnot played: entry 3 and the rest/);
    const [first, second] = h.rows();
    assert.equal(first.source, 'arc_action');
    assert.equal(first.note, 'walk right', 'the list\'s reasoning is its first step\'s note');
    assert.deepEqual([first.batch_position, second.batch_position, second.batch_total, second.batch_id], [1, 2, 2, first.batch_id]);
    assert.equal(first.batch_rejected[0].position, 3);
    assert.deepEqual(first.grid_change, [[9, 0, 1, 2, 2, 1, 1], [0, 9, 1, 2, 2, 2, 2]]);
    const messages = await h.decide(), text = textOf(head(messages));
    assert.ok(messages.length > 1, 'the earlier decision stays in view as a transcript');
    assert.match(text, /# Step: 3/);
    assert.match(text, new RegExp(`### ACTION step 1: ACTION1\nRESULT: state NOT_FINISHED -> NOT_FINISHED; score 0 -> 0; source=arc_action; ` +
      `final_grid_changed=yes; transient_animation=no; batch=${first.batch_id}\\[1/2\\]`));
    assert.match(text, /\[arc_action\] steps 1-2 {2}ACTION1 ×2 → 2 cells changed|\[arc_action\] step 2 {2}ACTION1 → 2 cells changed/);
    assert.doesNotMatch(text, /### ACTION step 0/, 'shown once');
    assert.match(section(text, '## CURRENT STATE'), / {2}RESET: Start or restart a game\./, 'RESET is offered to the agent once it has acted');
    await h.respond(['arc_action', { reasoning: 'finish', actions: [{ name: 'ACTION4' }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted.slice(2), ['ACTION4'], 'the rest of a list stops at a level change');
  } finally { await h.close(); }
});

test('a list stops at a missed prediction, not at repeats that change nothing; a list that plays nothing is refused and the decision goes on', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [missed] = await h.respond(['arc_action', { reasoning: 'probe', actions: [
      { name: 'ACTION1', predict: { level_changed: true } }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted, ['ACTION1']);
    assert.match(missed.text, /played 1 of 2; stopped: #1's prediction missed/);
    await h.decide();
    const [repeated] = await h.respond(['arc_action', { reasoning: 'wait', actions: [{ name: 'ACTION2' }, { name: 'ACTION2' }, { name: 'ACTION2' }, { name: 'ACTION2' }] }]);
    assert.deepEqual(h.submitted.slice(1), ['ACTION2', 'ACTION2', 'ACTION2', 'ACTION2'],
      'no refusal of repeats here: a level that goes long without progress gets the runner\'s stall review instead');
    assert.doesNotMatch(repeated.text, /stopped|NOT played/);
    await h.decide();
    const [none] = await h.respond(['arc_action', { reasoning: 'try', actions: [{ name: 'ACTION6' }] }]);
    assert.equal(none.isError, true);
    assert.notEqual(none.terminate, true);
    assert.match(none.text, /arc_action executed no actions; .*entry 1: unknown action name .*available now: RESET, ACTION1, ACTION2, ACTION3, ACTION4/);
  } finally { await h.close(); }
});

test('a list sent as text, a single entry, bare names, the earlier {action, then} shape and a name with protocol text after it are read as lists', async () => {
  const h = await fixture();
  try {
    const sent: any[] = [
      { reasoning: 'r', actions: '[{"name": "ACTION1", "predict": {"level_changed": false}}]' },
      { reasoning: 'r', actions: { name: 'ACTION2' } },
      { action: 'ACTION1', predict: { level_changed: false }, then: [{ action: 'ACTION2' }], note: 'old shape' },
      { reasoning: 'r', actions: [{ name: 'ACTION2<|tool_call_end|>' }] },
      { reasoning: 'r', actions: ['ACTION1', 'A2'], predict: { level_changed: false } },
    ];
    for (const args of sent) { await h.decide(); await h.respond(['arc_action', args]); }
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION2', 'ACTION1', 'ACTION2', 'ACTION2', 'ACTION1', 'ACTION2']);
    const rows = h.rows();
    assert.equal(rows[0].prediction.fields[0].hit, true, 'the prediction inside the text is scored');
    assert.equal(rows[2].note, 'old shape', 'the earlier shape\'s note is the list\'s reasoning');
    assert.equal(rows[2].prediction.fields[0].hit, true);
    assert.equal(rows[5].prediction.fields[0].hit, true, 'a prediction sent beside the list is its first action\'s');
  } finally { await h.close(); }
});

test('RESET is the agent\'s: after GAME_OVER nothing resets by itself, and RESET plays from the list', async () => {
  const h = await fixture();
  try {
    await h.decide();
    await h.respond(['arc_action', { reasoning: 'test', actions: [{ name: 'ACTION3' }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted, ['ACTION3']);
    const text = textOf(head(await h.decide()));
    assert.deepEqual(h.submitted, ['ACTION3'], 'no automatic RESET');
    assert.match(section(text, '## CURRENT STATE'), /state: GAME_OVER\n[\s\S]*available actions: \n {2}RESET: /);
    await h.respond(['arc_action', { reasoning: 'start over', actions: [{ name: 'reset' }] }]);
    assert.deepEqual(h.submitted, ['ACTION3', 'RESET']);
    // CH's history: the RESET ends the attempt, and until the next one has a step the last attempt is shown in detail.
    assert.match(textOf(head(await h.decide())), /══ Level 1 — started at step 1 ══\n\[arc_action\] step 1 {2}ACTION3 → → GAME_OVER/);
  } finally { await h.close(); }
});

test('observations a decision showed but the model never answered are shown again', async () => {
  const h = await fixture();
  try {
    assert.match(textOf(head(await h.decide())), /### ACTION step 0: RESET/);
    await h.fail('Connection error.');
    assert.match(textOf(head(await h.decide())), /### ACTION step 0: RESET/, 'not delivered: the model never answered that prompt');
    await h.respond();
    assert.doesNotMatch(textOf(head(await h.decide())), /### ACTION step 0: RESET/, 'answered: shown once');
  } finally { await h.close(); }
});

test('a stall review starts from the level\'s record and the current state, without arc_action; its review.md opens the next decision\'s head without changing the system prompt, and the next decision still shows what happened since the last one', async () => {
  const h = await fixture();
  try {
    await h.decide();
    await h.respond(['arc_action', { reasoning: 'walk', actions: [{ name: 'ACTION1' }, { name: 'ACTION2' }] }]);
    const review = textOf(head(await h.decide('STALL REVIEW. Level 1 is still open after 2 actions (since it began at action 1); this turn takes no action.')));
    assert.ok(!h.active().includes('arc_action'), h.active().join(','));
    assert.match(review, /\nLEVEL 1 RECORD SO FAR \(the level on screen; it is not completed\)\. The runtime's counts; what they mean is yours to write\.\n- #1–#2: 2 actions in 1 attempt; no RESET; no GAME_OVER\./);
    assert.match(review, /## CURRENT STATE\nstate: NOT_FINISHED/);
    assert.doesNotMatch(review, /## RECENT HISTORY|### ACTION step/, 'a review sees the current state only');
    const system = h.system();
    await h.respond(['write', { path: 'prompts/review.md', content: '---\nactive: true\n---\n1. Walked right twice.\n' }]);
    const parts = head(await h.decide()).content, text = textOf({ content: parts });
    assert.match(text, /### ACTION step 1: ACTION1[\s\S]*### ACTION step 2: ACTION2/, 'the review did not take them from this decision');
    assert.match(text, /^Decide the next action\.\n\n<prompt_review>\n[\s\S]*1\. Walked right twice\.\n[\s\S]*<\/prompt_review>\n\n/, 'the active prompt opens the head');
    assert.doesNotMatch(text.slice(text.indexOf('## RECENT HISTORY'), text.indexOf('\nHARNESS (')), /Walked right twice/,
      'it is not part of the game\'s observation (the capability index after it lists it in one line)');
    assert.ok(!Object.keys(h.sections()).some(name => name.startsWith('prompt_')), 'no component prompt in system sections');
    assert.equal(h.system(), system, 'the system prompt is the one before the write');
    // The board was seen at #1: what was played from it is the head's last part, after the images.
    assert.match(parts.at(-1).text ?? '', /^THIS BOARD \(status cells masked\) was here before: #1\. From it: ACTION2 → no change\./);
    const image = parts.findIndex((b: any) => b.type === 'image');
    assert.ok(image > 0 && image < parts.length - 1, `the record follows the images: ${parts.map((b: any) => b.type)}`);
  } finally { await h.close(); }
});

test('ARC_THIN_CONTEXT_LAYOUT=0: an active prompt is a system-prompt section and not in the head', async () => {
  const h = await fixture({ ARC_THIN_CONTEXT_LAYOUT: '0' });
  try {
    await h.decide();
    await h.respond(['write', { path: 'prompts/review.md', content: '---\nactive: true\n---\n1. Walked right twice.\n' }]);
    const text = textOf(head(await h.decide()));
    assert.match(h.sections().prompt_review ?? '', /1\. Walked right twice\./);
    assert.doesNotMatch(text.slice(0, text.indexOf('\nHARNESS (')), /Walked right twice/,
      'the capability index after the observation lists it in one line');
  } finally { await h.close(); }
});
