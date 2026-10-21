/** R1 goal admission/replay tests. Recorded data only; no ARC runner or provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateTaskPython } from '../demo/pi_task_python.ts';
import { arcSkillGuestProgram } from '../demo/arc_thin_skill_guest.ts';
import { applyRows, emptyMemory, planMemoryUpdate } from '../demo/arc_thin_memory.ts';
import { claimVersion } from '../demo/arc_thin_claims.ts';
import { GOAL_CHECK_HELP, goalAdmissionMode, goalStanding, goalSupportRefusal, goalVerdict, type GoalCheckRow } from '../demo/arc_thin_goal_admission.ts';
import { advanceCarry, buildLevelCarry, partitionRules, renderCarry, type CarryInput } from '../demo/arc_thin_level_carry.ts';

const root = new URL('../demo/fixtures/goal-r1/', import.meta.url);
const fixture = (arm: string) => {
  const read = (name: string): any[] => {
    const path = new URL(`${arm}/harness/${name}.jsonl`, root);
    return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  };
  const trajectory = read('trajectory');
  const rulesPath = new URL(`${arm}/workspace/prompts/rules.md`, root);
  let rulesText = ''; try { rulesText = readFileSync(rulesPath, 'utf8'); } catch { /* optional prompt */ }
  const input: CarryInput = { trajectory, memoryRows: read('memory'), claimRows: read('claim_checks'), goalRows: [],
    observerRuns: read('observer_runs'), rulesText };
  return { read, input };
};

function replayGoalAdmission(rows: any[]): { refused: number; supported: number } {
  const state = emptyMemory(); let refused = 0, supported = 0;
  for (const row of rows) {
    if (!row.hyp || row.key?.slice(0, 4) !== 'hyp.' || row.by === 'check') continue;
    const hyp = row.hyp;
    if (hyp.question?.trim().toLowerCase() !== 'goal') continue;
    if (hyp.status === 'supported') supported++;
    const key = row.key, version = claimVersion(hyp.check ?? '');
    const plan = planMemoryUpdate(state, { hypotheses: [{ key, claim: hyp.claim, question: hyp.question, status: hyp.status,
      ...(hyp.check ? { check: hyp.check } : {}) }] }, Number(row.at ?? 0), {}, (k, candidate) =>
      goalSupportRefusal(k, { ...candidate, version }, [], Number(row.level ?? 0)));
    if (!plan.ok) { refused++; continue; }
    applyRows(state, plan.rows);
  }
  return { refused, supported };
}

test('T1 P0 document gate and workspace beforeWrite seam are gone', async () => {
  const { Workspace } = await import('../demo/arc_thin_workspace.ts');
  const root = mkdtempSync(join(process.cwd(), '.goal-r1-workspace-unit-'));
  try {
    const w = new Workspace(root);
    assert.equal('beforeWrite' in w, false);
    w.runtimeWrite('prompts/rules.md', '- Level 1: a recorded rule (hyp.check)\n');
    w.runtimeWrite('prompts/strategy.md', 'Next experiment: apply the recorded move.\n');
    assert.match(w.read('prompts/rules.md'), /Level 1/);
    assert.match(w.read('prompts/strategy.md'), /Next experiment/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('T2 E1 refuses unsupported recorded goal statuses; open and rejected remain writable', () => {
  const { read } = fixture('ga-p0-shadow-1');
  const replay = replayGoalAdmission(read('memory'));
  const expected = read('memory').filter(row => row.hyp?.question?.trim().toLowerCase() === 'goal' && row.hyp.status === 'supported').length;
  assert.equal(replay.supported, expected);
  assert.ok(expected > 0);
  assert.equal(expected, 4);
  assert.equal(replay.refused, expected);
  const state = emptyMemory();
  for (const status of ['open', 'rejected'] as const) {
    const plan = planMemoryUpdate(state, { hypotheses: [{ key: `hyp.${status}`, claim: 'candidate', question: 'goal', status }] }, 0,
      {}, (key, hyp) => goalSupportRefusal(key, hyp, [], 0));
    assert.equal(plan.ok, true);
  }
  assert.match(GOAL_CHECK_HELP, /t\.before/);
});

test('T3 a real winning prediction supports, then a current-level false win is refused with its action number', () => {
  const rows: GoalCheckRow[] = [{ key: 'hyp.exit', version: 'v1', n: 8, level: 0, met: true, verdict: goalVerdict(true, { level_changed: true }) }];
  assert.equal(goalStanding(rows, 'hyp.exit', 'v1', 0), 'supported');
  rows.push({ key: 'hyp.exit', version: 'v1', n: 12, level: 1, met: true, verdict: goalVerdict(true, { level_changed: false }) });
  assert.equal(goalStanding(rows, 'hyp.exit', 'v1', 1), 'falsified');
  assert.match(goalSupportRefusal('hyp.exit', { question: 'goal', status: 'supported', version: 'v1' }, rows, 1)!, /#12/);
});

test('T4 the sandbox rejects any read of a hidden outcome field', async () => {
  const result = await evaluateTaskPython(arcSkillGuestProgram(), { mode: 'claims', strict: true, hidden_fields: ['level_changed'],
    claims: [{ key: 'goal', source: "def check(t):\n    return t['level_changed']\n" }],
    segments: [{ start: 1, grid: [[0]], steps: [{ n: 1, grid: [[1]] }] }], transitions: { '1': { action: 'ACTION1' } } });
  const output = (result as any).value.value.goal.results[0];
  assert.equal(output[1], 'error');
  assert.equal(goalVerdict(null, { level_changed: true }), 'missed_win');
});

for (const [arm, win] of [['ga-p0-on-1', 60], ['ga-p0-shadow-1', 63]] as const) test(`T5/T6 replay builds and advances L1 carry for ${arm}`, () => {
  const { read, input } = fixture(arm);
  const carry = buildLevelCarry(input, 0);
  assert.equal(carry.win.n, win);
  const levelRows = input.trajectory.filter(row => Number(row.level ?? row.levels_before ?? (Number(row.levels_completed ?? 0) - (row.level_changed ? 1 : 0))) === 0 && Number(row.n) <= win);
  assert.equal(carry.cost.resets, levelRows.filter(row => row.action === 'RESET').length);
  assert.equal(carry.cost.game_overs, levelRows.filter(row => row.state === 'GAME_OVER').length);
  const rendered = renderCarry(carry);
  assert.ok(rendered.length <= 900);
  if (!carry.pieces.some(piece => piece.kind === 'goal')) assert.match(rendered, /goal: none carried/);
  assert.ok(carry.pieces.some(piece => piece.kind === 'check'));
  if (arm === 'ga-p0-shadow-1') {
    assert.equal(carry.pieces.filter(piece => piece.kind === 'view').length, 3);
    assert.equal(carry.pieces.filter(piece => piece.kind === 'rule').length, 1);
  } else {
    assert.equal(carry.pieces.filter(piece => piece.kind === 'view').length, 0);
    assert.equal(carry.pieces.filter(piece => piece.kind === 'rule').length, 0);
  }
  const advanced = advanceCarry(carry, input);
  assert.ok(carry.pieces.every(piece => advanced.carry.pieces.some(next => next.ref === piece.ref && next.kind === piece.kind)));
  assert.ok(advanced.deltas.every(delta => delta.level === 1));
  assert.ok(read('claim_checks').length > 0);
});

test('T7 only typed level scope and hyp cites affect partition; shadow leaves source text unchanged', () => {
  const carry = { from_level: 0, to_level: 1, win: { n: 60, action: 'ACTION1' }, cost: { actions: 60, resets: 1, game_overs: 1 },
    pieces: [{ ref: 'hyp.changed@v1', kind: 'check' as const, from: { level: 0, evidence: 'holds 2 fails 4' }, state: 'changed' as const, at: 72 },
      { ref: 'hyp.held@v1', kind: 'check' as const, from: { level: 0, evidence: 'holds 3 fails 0' }, state: 'held' as const, at: 75 }] };
  const rules = '- Level 1: old claim (hyp.changed)\n- Level 1: stable claim (hyp.held)\n';
  const result = partitionRules(rules, carry, 1);
  assert.match(result.carried, /fails on level 2 since #72/);
  assert.match(result.rules, /held on level 2: 75/);
  assert.equal(partitionRules(rules, carry, 0).rules, rules.trim());
});

test('T8 missing consult records are unknown and do not become synthetic failures', () => {
  const { read } = fixture('ga-p0-shadow-1');
  const points = read('call_points');
  const due = points.filter(row => row.kind === 'consult_point');
  assert.ok(due.length > 0);
  // Source records show which consult points have a completed consult; absence is not treated as a failure.
  const succeeded = new Set(points.filter(row => row.kind === 'consult').map(row => `${row.at}:${row.decision}`));
  assert.ok(due.some(row => !succeeded.has(`${row.at}:${row.decision}`)));
  assert.equal(points.some(row => row.kind === 'consult' && row.outcome === 'failed'), false);
});

test('T9 goal-check ask names the winning action in replay call points', () => {
  const { input } = fixture('ga-p0-on-1');
  const win = input.trajectory.find(row => row.level_changed);
  assert.ok(win);
  assert.equal(goalAdmissionMode(), 'shadow');
  const extension = readFileSync(new URL('../demo/arc_thin_extension.ts', import.meta.url), 'utf8');
  assert.match(extension, /no goal check predicted the win at #\$\{row\.n\} \(\$\{actionLabel\(row\)\}\): write question "goal" with check\(t\)/);
  const runner = readFileSync(new URL('../src/autoresearch_pi/arc_thin_e2e.py', import.meta.url), 'utf8');
  assert.match(runner, /Add a goal hypothesis with a check\(t\) that predicts this level change from the before grid and the winning action/);
  const action = win.action === 'ACTION6' && win.x !== undefined ? `ACTION6(${win.x},${win.y})` : win.action;
  assert.equal(action, 'ACTION6(44,19)');
  assert.match(extension, /actionLabel\(row\).*write question "goal" with check\(t\)/);
});
