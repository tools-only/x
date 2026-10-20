/**
 * ARC_THIN_CH (the native default since 2026-10-20) against an HTTP stand-in for the bridge. Continual Harness's part is
 * the game observation, the ARC action tool and the ARC information (user, 2026-10-20: "only align the observation and
 * pre-defined tools, information of CH; the core and main mechanism should always be our meta-harness"); the decision
 * around them is this harness's: its working set, its transcript of earlier decisions, active prompts in the system
 * prompt, one acting call per decision, RESET as the agent's own action, reviews. The renderers themselves are compared
 * with CH's own output in arc_thin_ch_view.test.ts.
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
  // RESET is offered once the attempt has an action, as the bridge offers it.
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
    for (const f of handlers.get(name) ?? []) { const r = await f(event, ctx); if (r) out = { ...out, ...r }; }
    return out;
  };
  await emit('session_start', {});
  // The session as Pi keeps it: each prompt, the assistant's messages and the tool results.
  const messages: any[] = [];
  let system = '', sections: Record<string, string> = {}, projected: any[] = [], calls = 0;
  return {
    submitted, tool: (name: string) => tools.get(name), system: () => system, sections: () => sections, active: () => active,
    projected: () => projected,
    rows: () => readFileSync(join(root, 'harness', 'trajectory.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    /** A new decision (or review): the runner's prompt, then the head the model receives. */
    async decide(prompt = 'Decide the next action.') {
      const event: any = { prompt, systemPromptOptions: { sections: {} } };
      await emit('before_agent_start', event);
      system = String(event.systemPromptOptions.customPrompt ?? '');
      sections = event.systemPromptOptions.sections;
      messages.push({ role: 'user', content: prompt });
      projected = (await emit('context', { messages })).messages;
      return projected.at(-1);
    },
    /** One assistant message with these calls (or text only), then each call run and its result kept. */
    async respond(...called: Array<[string, any]>) {
      const blocks = called.map(([name, args]) => ({ type: 'toolCall', id: `c${++calls}`, name, arguments: args }));
      const assistant = { role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: 'thinking' }],
        stopReason: blocks.length ? 'toolUse' : 'stop', usage: { input: 0, output: 0 } };
      messages.push(assistant);
      await emit('message_end', { message: assistant });
      const results = [];
      for (const block of blocks) {
        const tool = tools.get(block.name);
        let result: any, isError = false;
        try { result = await tool.execute(block.id, tool.prepareArguments ? tool.prepareArguments(block.arguments) : block.arguments, undefined, undefined, ctx); }
        catch (error) { result = { content: [{ type: 'text', text: String((error as Error).message) }], details: {} }; isError = true; }
        const changed = await emit('tool_result', { toolName: block.name, toolCallId: block.id, input: block.arguments,
          content: result.content, details: result.details, isError });
        const content = changed?.content ?? result.content;
        isError = changed?.isError ?? isError;
        messages.push({ role: 'toolResult', toolCallId: block.id, toolName: block.name, content, isError });
        results.push({ ...result, isError, text: content.map((b: any) => b.text ?? '').join('\n') });
      }
      return results;
    },
    /** The provider failed this turn. */
    async fail(errorMessage: string) {
      const message = { role: 'assistant', content: [], stopReason: 'error', errorMessage, usage: { input: 0, output: 0 } };
      messages.push(message);
      await emit('message_end', { message });
    },
    async close() {
      await emit('session_shutdown', {});
      await new Promise<void>((r) => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
      Object.assign(process.env, env);
    },
  };
}
const textOf = (message: any) => typeof message.content === 'string' ? message.content
  : message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
const section = (text: string, name: string) => text.slice(text.indexOf(name)).split(/\n\n(?=## |# Step)/)[0];

test('a decision opens with this harness\'s working set and the game as CH shows it, with a PNG of each grid rendered as text', async () => {
  const h = await fixture();
  try {
    const head = await h.decide(), text = textOf(head);
    assert.match(text, /^Decide the next action\.\n\nMEMORY: empty\./, 'the runner\'s prompt and this harness\'s working set come first');
    const order = ['## RECENT HISTORY', '# Step: 1', '## OBSERVATIONS SINCE LAST QUERY', '## CURRENT STATE'].map((name) => text.indexOf(name));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `CH's blocks in CH's order: ${order}`);
    assert.doesNotMatch(text, /## TOOL RESULTS FROM PREVIOUS TURN|## TURN|PREVIOUS CONVERSATION STOPPED/, 'CH\'s loop is not this harness\'s');
    assert.match(section(text, '## RECENT HISTORY'), /══ Level 1 — started at step None ══\n\(no actions yet\)/);
    assert.match(text, /### ACTION step 0: RESET\nRESULT: state NOT_PLAYED -> NOT_FINISHED; score 0 -> 0; source=auto_reset/,
      'the bridge\'s first RESET is CH\'s step 0');
    const current = section(text, '## CURRENT STATE');
    assert.match(current, /available actions: \n {2}ACTION1: \(1, W, Up\)\.\n {2}ACTION2: \(2, S, Down\)\./);
    assert.match(current, /Grid current_state_frame \(8x8\) \[hex 0-f = color 0-15\]:\n00000000\n00000000\n09000000/);
    assert.equal(head.content.filter((b: any) => b.type === 'image').length, 1);
    assert.match(h.system(), /^Play ARC-AGI-3 [\s\S]*\n## ARC\n[\s\S]*ACTION7=Undo\/Back · RESET=the level's starting grid again/);
    assert.doesNotMatch(h.system(), /Soft guideline|GAME SETTING|RESET is not one of your actions|At most 2 tool calls/);
    assert.deepEqual(Object.keys(h.tool('arc_action').parameters.properties).sort(), ['actions', 'reasoning']);
  } finally { await h.close(); }
});

test('arc_action plays a list in order, cut at its first entry that is not offered and stopped by a level change; the next decision shows each step and keeps the earlier one in the conversation', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [played] = await h.respond(['arc_action', { reasoning: 'walk right', actions: [{ name: 'ACTION1' }, { name: 'action1' }, { name: 'RESET' }, { name: 'ACTION1' }] }]);
    assert.equal(played.terminate, true, 'a list that played ends the decision');
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION1'], 'RESET was not offered when the list was sent: it and the rest are not played');
    assert.match(played.text, /^#1 ACTION1 → changed=2 [\s\S]*\n#2 ACTION1 → [\s\S]*\nnot played: entry 3 \(unknown action name/);
    const [first, second] = h.rows();
    assert.equal(first.source, 'arc_action');
    assert.equal(first.note, 'walk right', 'the list\'s reasoning is its first step\'s note');
    assert.deepEqual([first.batch_position, second.batch_position, second.batch_total, second.batch_id], [1, 2, 2, first.batch_id]);
    assert.equal(first.batch_rejected[0].position, 3);
    assert.deepEqual(first.grid_change, [[9, 0, 1, 2, 2, 1, 1], [0, 9, 1, 2, 2, 2, 2]]);
    const text = textOf(await h.decide());
    assert.match(text, /# Step: 3/);
    assert.match(text, new RegExp(`### ACTION step 1: ACTION1\nRESULT: state NOT_FINISHED -> NOT_FINISHED; score 0 -> 0; source=arc_action; ` +
      `final_grid_changed=yes; transient_animation=no; batch=${first.batch_id}\\[1/2\\]`));
    assert.match(text, /\[arc_action\] step 2 {2}ACTION1 → 2 cells changed: color 9→0: r2 c2; color 0→9: r2 c3/);
    assert.doesNotMatch(text, /### ACTION step 0/, 'shown once');
    assert.match(section(text, '## CURRENT STATE'), /available actions: \n {2}RESET: Start or restart a game\./, 'RESET, offered now, is listed first');
    assert.ok(h.projected().some((m) => m.role === 'toolResult' && /^#1 ACTION1 → changed=2/.test(textOf(m))),
      'the earlier decision\'s call and result stay in the conversation');
    await h.respond(['arc_action', { reasoning: 'finish', actions: [{ name: 'ACTION4' }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted.slice(2), ['ACTION4'], 'the rest of a list stops at a level change');
  } finally { await h.close(); }
});

test('a list sent as text, a single entry, the earlier {action, then} shape and a name with protocol text after it are read as lists', async () => {
  const h = await fixture();
  try {
    await h.decide();
    await h.respond(['arc_action', { reasoning: 'r', actions: '[{"name": "ACTION1", "predict": {"level_changed": false}}]' }]);
    await h.decide();
    await h.respond(['arc_action', { reasoning: 'r', actions: { name: 'ACTION2' } }]);
    await h.decide();
    await h.respond(['arc_action', { action: 'ACTION1', predict: { level_changed: false }, then: [{ action: 'ACTION2' }], note: 'old shape' }]);
    await h.decide();
    await h.respond(['arc_action', { reasoning: 'r', actions: [{ name: 'ACTION2<|tool_call_end|>' }] }]);
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION2', 'ACTION1', 'ACTION2', 'ACTION2']);
    const rows = h.rows();
    assert.equal(rows[0].prediction.fields[0].hit, true, 'the prediction inside the text is scored');
    assert.equal(rows[2].note, 'old shape');
    assert.equal(rows[2].prediction.fields[0].hit, true);
  } finally { await h.close(); }
});

test('a missed prediction ends the list; a list that plays nothing is refused with the reason, and the decision goes on', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [none] = await h.respond(['arc_action', { reasoning: 'start over', actions: [{ name: 'RESET' }] }]);
    assert.equal(none.isError, true);
    assert.notEqual(none.terminate, true);
    assert.equal(none.text, 'nothing was played: entry 1: unknown action name / not in available_actions / invalid args (ACTION6 needs x,y ' +
      'in 0..63) ({"name":"RESET"}); available now: ACTION1, ACTION2, ACTION3, ACTION4');
    const [played] = await h.respond(['arc_action', { reasoning: 'walk', actions: [{ name: 'ACTION1', predict: { level_changed: true } }, { name: 'ACTION1' }] }]);
    assert.equal(played.terminate, true);
    assert.deepEqual(h.submitted, ['ACTION1'], 'its prediction missed, so the rest of the list was not played');
    assert.match(played.text, /\nplayed 1 of 2; stopped: #1's prediction missed\./);
  } finally { await h.close(); }
});

test('after GAME_OVER nothing is played for the agent: RESET is its own action, and the history shows the ended attempt', async () => {
  const h = await fixture();
  try {
    await h.decide();
    const [over] = await h.respond(['arc_action', { reasoning: 'test', actions: [{ name: 'ACTION3' }, { name: 'ACTION1' }] }]);
    assert.match(over.text, /\nplayed 1 of 2; stopped: state GAME_OVER at #1\./);
    const text = textOf(await h.decide());
    assert.deepEqual(h.submitted, ['ACTION3'], 'no RESET is played for the agent');
    assert.match(section(text, '## CURRENT STATE'), /^## CURRENT STATE\nstate: GAME_OVER\n[\s\S]*\n {2}RESET: Start or restart a game\. Must be called first when NOT_PLAYED or after GAME_OVER to play again\./);
    await h.respond(['arc_action', { reasoning: 'again', actions: [{ name: 'RESET' }, { name: 'ACTION1' }] }]);
    assert.deepEqual(h.submitted, ['ACTION3', 'RESET', 'ACTION1']);
    assert.equal(h.rows()[1].source, 'arc_action');
    assert.match(textOf(await h.decide()),
      /══ Level 1 — started at step 1 ══\nAttempt 1 \(steps 1-1, 1 steps\): GAME_OVER after ACTION3 at step 1\.\nAttempt 2 — current \(started step 3\):\n\[arc_action\] step 3 {2}ACTION1 → /);
  } finally { await h.close(); }
});

test('active prompts are system-prompt sections, as in this harness, not part of the game\'s observation', async () => {
  const h = await fixture();
  try {
    await h.decide();
    await h.respond(['write', { path: 'prompts/lessons.md', content: '---\nactive: true\n---\n# Level 1\nTest the marker first.\n' }]);
    const text = textOf(await h.decide());
    assert.match(h.sections().prompt_lessons ?? '', /# Level 1\nTest the marker first\./);
    assert.doesNotMatch(text, /Test the marker first/);
  } finally { await h.close(); }
});

test('observations are delivered once a decision\'s prompt is answered: after a provider error, or a review, they are shown again', async () => {
  const h = await fixture();
  try {
    assert.match(textOf(await h.decide()), /### ACTION step 0: RESET/);
    await h.fail('Connection error.');
    assert.match(textOf(await h.decide()), /### ACTION step 0: RESET/, 'not delivered: the model never answered that prompt');
    await h.respond(['arc_action', { reasoning: 'walk', actions: [{ name: 'ACTION1' }, { name: 'ACTION2' }] }]);
    const review = textOf(await h.decide('STALL REVIEW. Level 1 is still open after 2 actions (since it began at action 1); this turn takes no action.'));
    assert.ok(!h.active().includes('arc_action'), h.active().join(','));
    assert.match(review,
      /\nLEVEL 1 RECORD SO FAR \(the level on screen; it is not completed\)\. The runtime's counts; what they mean is yours to write\.\n- #1–#2: 2 actions in 1 attempt; no RESET; no GAME_OVER\.\n- No move of the level predicted a level change\.\n/);
    assert.match(review, /### ACTION step 1: ACTION1/);
    assert.doesNotMatch(review, /### ACTION step 0/);
    await h.respond(['write', { path: 'prompts/review.md', content: '---\nactive: true\n---\n1. Walked right twice.\n' }]);
    assert.match(textOf(await h.decide()), /### ACTION step 1: ACTION1[\s\S]*### ACTION step 2: ACTION2/, 'a review does not deliver them');
    assert.match(h.sections().prompt_review ?? '', /1\. Walked right twice\./);
  } finally { await h.close(); }
});
