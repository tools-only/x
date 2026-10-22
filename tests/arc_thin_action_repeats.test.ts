/** Native arc_action against an HTTP stand-in: an action that keeps changing nothing, and one the state does not offer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

async function fixture(extra: Record<string, string> = {}) {
  const submitted: string[] = [];
  let n = 0;
  // ACTION2 changes 50 cells; any other action only the counter in the corner.
  const grid = () => Array.from({ length: 64 }, (_, y) => Array.from({ length: 64 }, (_, x) => x + y ? 0 : n % 10));
  const server = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const action = req.url === '/action' ? JSON.parse(body).action : undefined;
      if (action) { submitted.push(action); n += 1; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ frames: [grid()], state: 'PLAYING', levels_completed: 0,
        agent_available_actions: ['ACTION1', 'ACTION2', 'RESET'],
        action_budget: { used: n, maximum: null, total_used: n, total_maximum: null },
        observation_delta: { frame_available: true, changed_cells: action === 'ACTION2' ? 50 : 1, cells: [] },
        public_transition: { level_changed: false } }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: mkdtempSync(join(tmpdir(), 'action-repeats-')), ARC_THIN_FOUNDATION: 'native',
    ARC_THIN_VARIANT: 'treatment', ARC_THIN_OBSERVATION: 'query', PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`,
    ARC_HARNESS_LEDGER: 'disabled', ARC_HARNESS_CRITIC: 'disabled', ...extra });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const ctx: any = { model: { input: ['text'] } };
  await handlers.get('session_start')({}, ctx);
  const tool = () => tools.get('arc_action');
  return { submitted, tool,
    decide: () => handlers.get('before_agent_start')({ prompt: 'Decide.', systemPromptOptions: { sections: {} } }, ctx),
    // A later assistant message of the same decision (one arc_action per message).
    message: () => handlers.get('message_end')({ message: { role: 'assistant', content: [], usage: { input: 0, output: 0 } } }),
    call: (args: any) => tool().execute('call', args, undefined, undefined, ctx),
    act: (args: any) => tool().execute('call', tool().prepareArguments(args), undefined, undefined, ctx),
    async close() {
      await handlers.get('session_shutdown')?.({}, ctx);
      await new Promise<void>(r => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
      Object.assign(process.env, env);
    },
  };
}

test('an action that changed at most 2 cells three times in a row is refused the fourth time, until another is played', async () => {
  // su15-l0-1 and su15-l0-2 (2026-10-17) played one click 20 and 30 times in a row, each changing 1-2 cells.
  const h = await fixture();
  try {
    for (let i = 0; i < 3; i++) { await h.decide(); await h.act({ action: 'ACTION1', note: 'same' }); }
    await h.decide();
    await assert.rejects(h.act({ action: 'ACTION1', note: 'same' }),
      /ACTION1 was NOT played: the last 3 actions \(#1-#3\) were this same action and each changed at most 2 cells; play a different action/);
    h.message();
    await assert.rejects(h.act({ action: 'ACTION1', note: 'same' }), /was NOT played/);
    h.message();
    const ended = await h.act({ action: 'ACTION1', note: 'same' });
    assert.equal(ended.terminate, true, 'the third identical refusal ends the decision');
    assert.match(ended.content[0].text, /^Repeated unchanged error; decision ends: ACTION1 was NOT played/);
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION1', 'ACTION1'], 'refused calls never reach the environment');
    await h.decide(); await h.act({ action: 'ACTION2' });
    await h.decide(); await h.act({ action: 'ACTION1', note: 'same' });
    assert.deepEqual(h.submitted, ['ACTION1', 'ACTION1', 'ACTION1', 'ACTION2', 'ACTION1'], 'another action lifts the refusal');
  } finally { await h.close(); }
  const off = await fixture({ ARC_THIN_NO_EFFECT_REPEATS: '0' });
  try {
    for (let i = 0; i < 4; i++) { await off.decide(); await off.act({ action: 'ACTION1' }); }
    assert.equal(off.submitted.length, 4, 'ARC_THIN_NO_EFFECT_REPEATS=0 plays every one');
  } finally { await off.close(); }
});

test('an action the state does not offer reaches the tool, which refuses it with what is available', async () => {
  // su15-l0-1 (2026-10-17) sent RESET 20 times just after a RESET; Pi's enum check rejected each without saying why.
  const h = await fixture();
  try {
    await h.decide();
    assert.deepEqual(h.tool().parameters.properties.action.enum, ['ACTION1', 'ACTION2', 'RESET'], 'the enum stays per state');
    const prepared = h.tool().prepareArguments({ action: 'ACTION9', note: 'n' });
    assert.deepEqual(prepared, { action: 'ACTION1', note: 'n', unavailable_action: 'ACTION9' }, 'carried past the enum check');
    await assert.rejects(h.call(prepared),
      /action 'ACTION9' is not currently available \(available now: ACTION1, ACTION2, RESET\); nothing was played/);
    h.message();
    await h.act({ action: 'ACTION2' });
    // A planned step is checked when its turn comes.
    await h.decide();
    const planned = await h.act({ action: 'ACTION1', then: [{ action: 'ACTION9' }, { action: 'ACTION2' }] });
    assert.match(planned.content[0].text, /then: 0 of 2 played; stopped: action 'ACTION9' is not currently available \(available now: ACTION1, ACTION2, RESET; last action played: #2 ACTION1\); nothing was played\./);
    assert.deepEqual(h.submitted, ['ACTION2', 'ACTION1'], 'unavailable actions never reach the environment');
  } finally { await h.close(); }
});
