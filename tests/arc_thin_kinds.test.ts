import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { canonicalKinds, canonicalRefinerSystem, canonicalSystemTemplate, VIEW_RULE } from '../demo/arc_thin_kinds.ts';
import { REFINER_HEAD, REFINER_SYSTEM } from '../demo/arc_thin_refiner.ts';
import { loadPrompt } from '../demo/prompt_loader.ts';

// docs/plans/2026-10-21-components-by-default-canonical-forms.md, S1 (ARC_THIN_KINDS=canonical): the kinds of the harness
// in one canonical form for the agent and the refiner. Text only; the claim it tests (no skills from text alone) needs a run.

const KINDS = ['Prompts', 'Memory', 'Scripts', 'Skills', 'Hooks', 'Subagents', 'Tools'];
const bullets = (block: string) => block.split(/\r?\n/).filter((line) => line.startsWith('- ')).map((line) => /^- (\w+):/.exec(line)![1]);

/** The native extension on a 4x4 board, enough to render its system prompt (and the refiner's) under `env`. */
async function fixture(env: Record<string, string> = {}) {
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0));
  const body = { frames: [grid], state: 'NOT_FINISHED', levels_completed: 0, agent_available_actions: ['RESET', 'ACTION6'],
    action_budget: { used: 0, maximum: 100, total_used: 0, total_maximum: null }, observation_delta: { frame_available: true, changed_cells: 0, cells: [] },
    public_transition: { level_changed: false } };
  const server = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'kinds-'));
  const saved = { ...process.env };
  Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment', ARC_THIN_OBSERVATION: 'query',
    PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}`, ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled',
    ARC_REFINE_EVERY: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ...env });
  const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
  arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
    getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f), getThinkingLevel: () => 'off' } as any);
  const systems: string[] = [];
  const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'] }, modelRegistry: {
    streamSimple: (_model: any, context: any) => { systems.push(String(context.systemPrompt)); return { result: () => new Promise(() => {}) }; } } };
  await handlers.get('session_start')({}, ctx);
  const event: any = { prompt: 'Decide.', systemPromptOptions: { sections: {} } };
  await handlers.get('before_agent_start')(event, ctx);
  return { system: String(event.systemPromptOptions.customPrompt), tools,
    /** The charter the refiner's model call receives: the agent asks for a refinement and the call is read, never answered. */
    async refinerSystem() {
      await tools.get('refine').execute('t', { focus: 'check the charter' }, undefined, undefined, ctx);
      for (let i = 0; i < 100 && !systems.length; i += 1) await new Promise((r) => setTimeout(r, 50));
      return systems[0] ?? '';
    },
    async close() {
    await handlers.get('session_shutdown')?.({}, ctx);
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  } };
}

test('the canonical capability block names the seven kinds in order, and nothing else in the native template changes', async () => {
  const legacy = loadPrompt('arc_thin_native_system.md');
  for (const consult of [true, false]) {
    const canonical = canonicalSystemTemplate(legacy, { consult, persist: false, skills: false });
    assert.deepEqual(bullets(canonical), consult ? KINDS : KINDS.filter((kind) => kind !== 'Subagents'));
    const outside = (text: string, block: RegExp) => text.replace(block, '');
    const block = /^Your harness has [\s\S]*?(?=\r?\n\{\{refine\}\})/m;
    assert.equal(outside(canonical, block), outside(legacy, block), 'everything outside the block is the legacy template');
  }
});

test('flag on: the rendered system prompt states the canonical kinds and is no longer than the legacy one; flag off renders the legacy template', async () => {
  const off = await fixture();
  const on = await fixture({ ARC_THIN_KINDS: 'canonical' });
  const withScripts = await fixture({ ARC_THIN_KINDS: 'canonical', ARC_THIN_PERSIST_DEFS: '1' });
  try {
    assert.match(off.system, /Your harness has five kinds of capability:/);
    assert.match(off.system, /- Tool: tools\/<name>\.py; python\(code, save="name"\) publishes it\./);
    assert.deepEqual(bullets(on.system), KINDS);
    assert.match(on.system, /Your harness has seven kinds of capability:/);
    assert.doesNotMatch(on.system, /save="name"/, 'the python tool description carries the save contract');
    const lf = (text: string) => text.replace(/\r\n/g, '\n');
    assert.ok(lf(on.system).length <= lf(off.system).length, `canonical ${lf(on.system).length} chars, legacy ${lf(off.system).length}`);
    assert.ok(on.system.length <= off.system.length, `with the template's own line ends: ${on.system.length} against ${off.system.length}`);
    // The mechanisms of S2 and S3 are not described while their flags are off, and S2's is when its flag is on.
    assert.doesNotMatch(on.system, /persist as lib|metadata\.trigger: level_start/);
    assert.match(withScripts.system, /- Scripts: functions you define in python persist as lib\/<name>\.py \(import lib\.<name>\)\./);
    assert.ok(withScripts.system.length <= off.system.length, `with S2's sentence: ${withScripts.system.length} against ${off.system.length}`);
    // The consult tool states what its subagent may spend, once, in its description.
    assert.match(on.tools.get('consult').description, /6 model rounds of at most 1024 output tokens each and 120 s/);
    assert.doesNotMatch(off.tools.get('consult').description, /model rounds/);
    // The refiner's model call carries the matching charter (the flag reaches the real side call, not only the function).
    const [offCharter, onCharter] = [await off.refinerSystem(), await on.refinerSystem()];
    assert.ok(offCharter.startsWith(REFINER_SYSTEM), 'flag off: the legacy charter, as it was');
    assert.ok(onCharter.startsWith(REFINER_HEAD) && /The harness has seven kinds of capability: prompts \(/.test(onCharter) && onCharter.includes(VIEW_RULE), 'flag on: the canonical charter');
  } finally { await off.close(); await on.close(); await withScripts.close(); }
});

test('whatever flags are on, the canonical capability block is no longer than the legacy one', () => {
  const legacy = loadPrompt('arc_thin_native_system.md').replace(/\r\n/g, '\n');
  const block = /^Your harness has \{\{kinds\}\} kinds of capability:\n(?:- .*\n)+/m.exec(legacy)![0];
  for (const consult of [true, false]) {
    const old = block.replace('{{kinds}}', consult ? 'five' : 'four').replace('{{nonacting}}', consult ? 'subagents or views' : 'views')
      .replace('{{skill}}', 'skills/<name>/SKILL.md (name, description), a procedure read on demand.').replace(consult ? /$^/ : /^- Subagent:.*\n/m, '');
    for (const persist of [false, true]) for (const skills of [false, true]) {
      const now = canonicalKinds({ consult, persist, skills }).replace('{{nonacting}}', consult ? 'subagents or views' : 'views');
      assert.ok(now.length <= old.length, `consult=${consult} persist=${persist} skills=${skills}: ${now.length} against ${old.length}`);
      assert.equal(/lib\/<name>\.py \(import lib\.<name>\)/.test(now), persist, 'persistence is described only when S2 is on');
      assert.equal(/metadata\.trigger: level_start or stall/.test(now), skills, 'triggers are described only when S3 is on');
    }
  }
});

test('the agent and the refiner describe views in the same words; the legacy charter is left as it was', () => {
  assert.match(REFINER_SYSTEM, /A tool with the line '# view: on' near its top is run after every new state/);
  assert.doesNotMatch(REFINER_SYSTEM, /seven kinds/);
  const charter = canonicalRefinerSystem(REFINER_SYSTEM, { persist: false, skills: false });
  assert.ok(charter.startsWith(REFINER_HEAD) && REFINER_SYSTEM.startsWith(REFINER_HEAD), 'both are recognised as refinements');
  assert.match(charter, /The harness has seven kinds of capability: prompts \(/);
  assert.ok(charter.includes(VIEW_RULE) && canonicalKinds({ consult: true, persist: false, skills: false }).includes(VIEW_RULE));
  assert.doesNotMatch(charter, /near its top is run after every new state/);
  // The rest of the charter is the legacy one: its reply formats and the check's fields are still there.
  for (const kept of ['Reply with exactly one of:', 'FILE <path>', 'HYPOTHESIS hyp.<name>', "t['changed_cells']", "Never replace a file the agent wrote"]) assert.ok(charter.includes(kept), kept);
  // S2 and S3 appear in the charter only with their flags.
  assert.doesNotMatch(charter, /saves each function|metadata\.trigger/);
  const all = canonicalRefinerSystem(REFINER_SYSTEM, { persist: true, skills: true });
  assert.match(all, /saves each function the agent defines in python there/);
  assert.match(all, /metadata\.trigger level_start or stall shows it once/);
});
