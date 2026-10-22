import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';
import { renderArcLatestFrameRuns } from '../demo/arc_agi_3_official_adapter.ts';

async function fixture(mode: string = 'query') {
  let n = 0, unavailable = false;
  const grid = (v: number) => Array.from({ length: 64 }, (_, y) => Array.from({ length: 64 }, (_, x) => (x + y + v) % 16));
  const state = () => ({ frames: unavailable ? [] : [grid(n + 1), grid(n)], state: 'PLAYING', levels_completed: 0,
    agent_available_actions: ['ACTION1', 'RESET'], action_budget: { used: n, maximum: null, total_used: n, total_maximum: null } });
  const server = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      if (req.url !== '/state') n++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...state(), observation_delta: { frame_available: !unavailable, changed_cells: 4096, cells: [] },
        public_transition: { level_changed: false } }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'query-observation-'));
  const env = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'disabled',
    ARC_HARNESS_CRITIC: 'disabled', ARC_REFINE_EVERY: '1000000' });
  if (mode) process.env.ARC_THIN_OBSERVATION = mode; else delete process.env.ARC_THIN_OBSERVATION;
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
    getThinkingLevel: () => 'off' } as any);
  const ctx: any = { model: { input: ['text', 'image'] } };
  await handlers.get('session_start')({}, ctx);
  return { root, grid, state, unavailable: () => unavailable = true,
    call: (name: string, args: any) => tools.get(name).execute('query', args, undefined, undefined, ctx),
    async project() {
      await handlers.get('before_agent_start')({ prompt: 'Decide.', systemPromptOptions: { sections: {} } }, ctx);
      return (await handlers.get('context')({ messages: [{ role: 'user', content: 'Decide.' }] }, ctx)).messages;
    },
    async close() {
      await handlers.get('session_shutdown')?.({}, ctx);
      await new Promise<void>(r => server.close(() => r()));
      for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
      Object.assign(process.env, env);
    }
  };
}

test('explicit query keeps every raw frame outside context and returns exact requested measurements/images', async () => {
  const h = await fixture();
  try {
    const messages = await h.project(), content = messages[0].content;
    assert.equal(content.filter((b: any) => b.type === 'image').length, 0, 'no automatic image even for vision model');
    const text = JSON.stringify(messages);
    assert.ok(text.length < 1500, 'initial context must stay metadata-sized for a dense 64×64 frame');
    assert.ok(!text.includes(renderArcLatestFrameRuns(h.state(), { derived: false }).split('\n')[5]));
    assert.match(text, /data\/observations\/0.json/);
    assert.match(text, /64.*64/);
    assert.doesNotMatch(text, /row 0:|0123456789abcdef|0-0:0/);
    const raw = JSON.parse(readFileSync(join(h.root, 'workspace/data/observations/0.json'), 'utf8'));
    assert.deepEqual(raw.frames, h.state().frames);
    const query = await h.call('python', { code: '[grid[2][3], state["frames"][0][2][3], len(grid), len(state["frames"])]' });
    assert.match(query.content[0].text, /\[5,6,64,2\]/);
    const image = await h.call('read', { path: 'data/frames/0.png' });
    assert.equal(image.content.find((b: any) => b.type === 'image')?.mimeType, 'image/png');
    assert.ok(Buffer.from(image.content.find((b: any) => b.type === 'image').data, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    const animation = await h.call('read', { path: raw.frame_images[0] });
    assert.equal(animation.content.find((b: any) => b.type === 'image')?.mimeType, 'image/png');
    await assert.rejects(h.call('write', { path: 'data/observations/0.json', content: '{}' }), /read-only/);
    await assert.rejects(h.call('read', { path: '../run-config.json' }), /invalid workspace path/);
    await h.call('arc_action', repairActionArguments({ action: 'ACTION1' }));
    assert.match(JSON.stringify(await h.project()), /data\/observations\/1.json/);
    const historical = await h.call('python', { code: '[grid[2][3], prev_grid[2][3], history.grid(0)[2][3], state["frames"][0][2][3]]' });
    assert.match(historical.content[0].text, /\[6,5,5,7\]/);
    await h.call('arc_action', repairActionArguments({ action: 'RESET' }));
    assert.match(JSON.stringify(await h.project()), /data\/observations\/2.json/);
    assert.deepEqual(JSON.parse(readFileSync(join(h.root, 'workspace/data/observations/0.json'), 'utf8')).frames, [h.grid(1),h.grid(0)]);
    h.unavailable();
    await h.call('arc_action', repairActionArguments({ action: 'ACTION1' }));
    const unavailable = JSON.stringify(await h.project());
    assert.match(unavailable, /unavailable/);
    assert.doesNotMatch(unavailable, /data\/observations\/2.json/);
    assert.equal(JSON.parse(readFileSync(join(h.root, 'workspace/data/current.json'), 'utf8')).grid, null);
    assert.match((await h.call('python', { code: '[grid, len(state["frames"])]' })).content[0].text, /\[null,0\]/);
  } finally { await h.close(); }
});

test('invalid observation mode fails rather than silently changing delivery', () => {
  const old = { ...process.env };
  try {
    process.env.ARC_THIN_FOUNDATION = 'native'; process.env.ARC_THIN_OBSERVATION = 'typo';
    assert.throws(() => arcThinExtension({} as any), /must be query, inline or ch/);
  } finally { process.env = old; }
});

test('explicit inline delivery retains the old full grid/image option', async () => {
  const h = await fixture('inline');
  try { const messages = await h.project(); assert.ok(messages[0].content.some((b: any) => b.type === 'image')); }
  finally { await h.close(); }
});
