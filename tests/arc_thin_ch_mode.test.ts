/**
 * ARC_THIN_CH (the native default since 2026-10-20) against an HTTP stand-in for the bridge: each decision's prompt is
 * Continual Harness's working prompt, arc_action is CH's take_actions, RESET is the harness's after GAME_OVER, and a
 * decision's tool results and why it stopped without acting reach the next one. The renderers themselves are compared with
 * CH's own output in arc_thin_ch_view.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

async function fixture() {
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
        agent_available_actions: [...(acted ? ['RESET'] : []), 'ACTION1', 'ACTION2', 'ACTION3', 'ACTION4'],
        action_budget: { used: submitted.length, maximum: null, total_used: submitted.length, total_maximum: null },
        observation_delta: { frame_available: true, changed_cells: changed, cells: [] }, public_transition: { level_changed: levelChanged } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'ch-mode-'));
  const env = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'disabled',
    ARC_HARNESS_CRITIC: 'disabled', ARC_REFINE_EVERY: '1000000' });
  delete process.env.ARC_THIN_CH;
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
  let system = '', calls = 0;
  return {
    submitted, tool: (name: string) => tools.get(name), system: () => system,
    rows: () => readFileSync(join(root, 'harness', 'trajectory.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    /** A new decision: the runner's prompt, then the head the model receives. */
    async decide(prompt = 'Decide the next action.') {
      const event: any = { prompt, systemPromptOptions: { sections: {} } };
      await emit('before_agent_start', event);
      system = String(event.systemPromptOptions.customPrompt ?? '');
      return (await emit('context', { messages: [{ role: 'user', content: prompt }] })).messages[0];
    },
    /** One assistant message with these calls (or text only), then each call run and its result message ended. */
    async respond(...called: Array<[string, any]>) {
      const blocks = called.map(([name, args]) => ({ type: 'toolCall', id: `c${++calls}`, name, arguments: args }));
      await emit('message_end', { message: { role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: 'thinking' }],
        usage: { input: 0, output: 0 } } });
      const results = [];
      for (const block of blocks) {
        await emit('tool_execution_start', { toolCallId: block.id, toolName: block.name, args: block.arguments });
        const tool = tools.get(block.name);
        let result: any, isError = false;
        try { result = await tool.execute(block.id, tool.prepareArguments ? tool.prepareArguments(block.arguments) : block.arguments, undefined, undefined, ctx); }
        catch (error) { result = { content: [{ type: 'text', text: String((error as Error).message) }], details: {} }; isError = true; }
        const shown = await emit('message_end', { message: { role: 'toolResult', toolCallId: block.id, toolName: block.name,
          content: result.content, details: result.details, isError } });
        results.push({ ...result, shown: shown?.message?.content?.[0]?.text ?? result.content?.[0]?.text });
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
const textOf = (head: any) => head.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
const section = (text: string, name: string) => text.slice(text.indexOf(name)).split(/\n\n(?=## |# Step)/)[0];

test('a decision opens with CH\'s working prompt: history, step, observations since the last query, tool results, state, turn', async () => {
  const h = await fixture();
  try {
    const head = await h.decide(), text = textOf(head);
    const order = ['## RECENT HISTORY', '# Step: 1', '## OBSERVATIONS SINCE LAST QUERY', '## TOOL RESULTS FROM PREVIOUS TURN', '## CURRENT STATE', '## TURN']
      .map((name) => text.indexOf(name));
    assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `sections in CH order: ${order}`);
    assert.doesNotMatch(text, /^Decide the next action/, 'the runner\'s plain prompt adds nothing to the working prompt');
    assert.match(section(text, '## RECENT HISTORY'), /══ Level 1 — started at step None ══\n\(no actions yet\)/);
    assert.match(text, /### ACTION step 0: RESET\nRESULT: state NOT_PLAYED -> NOT_FINISHED; score 0 -> 0; source=auto_reset/,
      'the bridge\'s first RESET is CH\'s step 0');
    assert.match(text, /## TOOL RESULTS FROM PREVIOUS TURN\n\(none\)/);
    const current = section(text, '## CURRENT STATE');
    assert.match(current, /available actions: \n {2}ACTION1: \(1, W, Up\)\.\n {2}ACTION2: \(2, S, Down\)\./);
    assert.match(current, /Grid current_state_frame \(8x8\) \[hex 0-f = color 0-15\]:\n00000000\n00000000\n09000000/);
    assert.match(section(text, '## TURN'), /at most 24 non-action turns/);
    assert.equal(head.content.filter((b: any) => b.type === 'image').length, 1, 'the PNG of each grid rendered as text');
    assert.match(h.system(), /## INPUT FORMAT[\s\S]*ACTION7=Undo\/Back[\s\S]*RESET is not one of your actions[\s\S]*## GAME SETTING/);
    assert.deepEqual(Object.keys(h.tool('arc_action').parameters.properties).sort(), ['actions', 'reasoning']);
  } finally { await h.close(); }
});

test('arc_action plays a list in order, truncated at its first bad entry and stopped by a level change; the next prompt shows each step', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [played] = await h.respond(['arc_action', { reasoning: 'walk right', actions: [{ name: 'ACTION1' }, { name: 'action1' }, { name: 'RESET' }, { name: 'ACTION1' }] }]);
    assert.equal(played.terminate, true, 'a list that played ends the decision');
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION1'], 'RESET and everything after it is not played');
    const [first, second] = h.rows();
    assert.equal(first.source, 'arc_action');
    assert.equal(first.note, 'walk right', 'the list\'s reasoning is its first step\'s');
    assert.deepEqual([first.batch_position, second.batch_position, second.batch_total, second.batch_id], [1, 2, 2, first.batch_id]);
    assert.equal(first.batch_rejected[0].position, 3);
    assert.deepEqual(first.grid_change, [[9, 0, 1, 2, 2, 1, 1], [0, 9, 1, 2, 2, 2, 2]]);
    const text = textOf(await h.decide());
    assert.match(text, /# Step: 3/);
    assert.match(text, new RegExp(`### ACTION step 1: ACTION1\nRESULT: state NOT_FINISHED -> NOT_FINISHED; score 0 -> 0; source=arc_action; ` +
      `final_grid_changed=yes; transient_animation=no; batch=${first.batch_id}\\[1/2\\]`));
    assert.match(text, /\[arc_action\] step 2 {2}ACTION1 → 2 cells changed: color 9→0: r2 c2; color 0→9: r2 c3/);
    assert.doesNotMatch(text, /### ACTION step 0/, 'shown once');
    await h.respond(['arc_action', { reasoning: 'finish', actions: [{ name: 'ACTION4' }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted.slice(2), ['ACTION4'], 'the rest of a list stops at a level change');
  } finally { await h.close(); }
});

test('a list that plays nothing returns CH\'s record and the decision goes on; its record reaches the next prompt', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [none] = await h.respond(['arc_action', { reasoning: 'start over', actions: [{ name: 'RESET' }] }]);
    assert.notEqual(none.terminate, true);
    assert.equal(h.submitted.length, 0);
    assert.match(none.shown, /^### TOOL RESULT\nname: arc_action\nargs: \{"reasoning": "start over", "actions": \[\{"name": "RESET"\}\]\}\n\nresult:\n```json\n\{\n {2}"success": false,\n {2}"executed": 0,/);
    const [memo] = await h.respond(['memory', { op: 'set', key: 'goal', text: 'reach the right edge' }]);
    assert.match(memo.shown, /^### TOOL RESULT\nname: memory\nargs: \{"op": "set", "key": "goal", "text": "reach the right edge"\}/,
      'within a decision a result reads as CH\'s record');
    await h.respond();
    const text = textOf(await h.decide());
    assert.match(section(text, '## TOOL RESULTS FROM PREVIOUS TURN'), /name: arc_action[\s\S]*name: memory/);
    assert.match(text, /## PREVIOUS CONVERSATION STOPPED WITHOUT ACTION\nReason: model response contained no function calls/);
  } finally { await h.close(); }
});

test('after GAME_OVER the harness plays RESET, the next prompt starts a new attempt, and carried results are dropped', async () => {
  const h = await fixture();
  try {
    await h.decide();
    await h.respond(['memory', { op: 'set', key: 'risk', text: 'ACTION3 may end the game' }], ['arc_action', { reasoning: 'test', actions: [{ name: 'ACTION3' }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted, ['ACTION3']);
    const text = textOf(await h.decide());
    assert.deepEqual(h.submitted, ['ACTION3', 'RESET']);
    assert.equal(h.rows().at(-1).source, 'auto_reset');
    assert.match(text, /### ACTION step 2: RESET\nRESULT: state GAME_OVER -> NOT_FINISHED; score 0 -> 0; source=auto_reset/);
    // CH's history: the RESET ends the attempt, and until the next one has a step the last attempt is shown in detail.
    assert.match(text, /══ Level 1 — started at step 1 ══\n\[arc_action\] step 1 {2}ACTION3 → → GAME_OVER/);
    assert.match(text, /## TOOL RESULTS FROM PREVIOUS TURN\n\(none\)/);
    assert.doesNotMatch(text, /PREVIOUS CONVERSATION STOPPED/);
  } finally { await h.close(); }
});

test('active prompts open the working prompt, where CH puts its base policy, and leave the system prompt', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [saved] = await h.respond(['write', { path: 'prompts/lessons.md', content: '---\nactive: true\n---\n# Level 1\nTest the marker first.\n' }]);
    assert.match(saved.shown, /^### TOOL RESULT\nname: write\n/);
    const text = textOf(await h.decide());
    assert.match(text, /^<prompt_lessons>\n# Level 1\nTest the marker first\.\n+<\/prompt_lessons>\n\n/);
    assert.doesNotMatch(h.system(), /Test the marker first/);
  } finally { await h.close(); }
});

test('a decision ends after its 24th turn, and the next prompt says so', async () => {
  const h = await fixture();
  try {
    await h.decide();
    let last: any;
    for (let turn = 1; turn <= 24; turn += 1) [last] = await h.respond(['memory', { op: 'set', key: `k${turn}`, text: `note ${turn}` }]);
    assert.equal(last.terminate, true);
    const text = textOf(await h.decide());
    assert.match(text, /Reason: max_conversation_turns: hit MAX_CONVERSATION_TURNS=24 without an action/);
    assert.match(section(text, '## TOOL RESULTS FROM PREVIOUS TURN'), /^## TOOL RESULTS FROM PREVIOUS TURN\n16 tool calls ran/, 'the last 16 are carried');
  } finally { await h.close(); }
});

test('after a provider error the next prompt shows the same observations again and says why the decision stopped', async () => {
  const h = await fixture();
  try {
    assert.match(textOf(await h.decide()), /### ACTION step 0: RESET/);
    await h.fail('Connection error.');
    const text = textOf(await h.decide());
    assert.match(text, /### ACTION step 0: RESET/, 'not delivered: the model never answered that prompt');
    assert.match(text, /## PREVIOUS CONVERSATION STOPPED WITHOUT ACTION\nReason: vlm_error: Connection error\./);
  } finally { await h.close(); }
});
