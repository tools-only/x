/** R1 goal admission/replay tests. Recorded data only; no ARC runner or provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateTaskPython } from '../demo/pi_task_python.ts';
import { arcSkillGuestProgram } from '../demo/arc_thin_skill_guest.ts';
import { applyRows, emptyMemory, planMemoryUpdate } from '../demo/arc_thin_memory.ts';
import { claimVersion } from '../demo/arc_thin_claims.ts';
import { GOAL_CHECK_HELP, goalAdmissionMode, goalStanding, goalSupportRefusal, goalVerdict, recurringGoalCheckAsk, levelGoalCheckAsk, formatGoalOutcome, type GoalCheckRow } from '../demo/arc_thin_goal_admission.ts';
import { consultBudgetError, consultFirstBlocks, consultServiceFailure } from '../demo/arc_thin_consult_release.ts';
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

test('T8 failed consult releases the same point; pre-attempt refusals remain', () => {
  const read = (arm: string) => readFileSync(new URL('../demo/fixtures/goal-r2/consult/' + arm + '.jsonl', import.meta.url), 'utf8')
    .split(String.fromCharCode(10)).filter(Boolean).map(line => JSON.parse(line));
  for (const [arm, expectedR1, expectedR2] of [['on', 13, 0], ['shadow', 14, 1]] as const) {
    let r1Refusals = 0, r2Refusals = 0, releasedPoints = 0;
    for (const point of read(arm)) {
      let released = false;
      let sawConsult = false;
      for (const result of point.results) {
        if (result.tool === 'consult') {
          sawConsult = true;
          if (result.isError && consultServiceFailure(result.text)) {
            released = true;
            releasedPoints++;
          }
        }
        if (result.isError && result.text.startsWith('this review consults first:')) {
          r1Refusals++;
          if (!released) r2Refusals++;
        }
      }
      assert.ok(point.results.length > 0);
      if (!sawConsult) assert.equal(released, false);
    }
    assert.equal(r1Refusals, expectedR1);
    assert.equal(r2Refusals, expectedR2);
    assert.ok(releasedPoints > 0);
  }
  assert.equal(consultServiceFailure('this review used its 10 tool calls; it ends here'), false);
  assert.equal(consultServiceFailure('tool argument validation failed'), false);
});

test('T9 recurring and level goal-check asks name the win and preserve the off behavior', () => {
  const win = { level: 1, n: 63, action: 'ACTION6(44,19)' };
  for (const actions of [12, 36, 60]) {
    const ask = recurringGoalCheckAsk({ mode: 'shadow', actions, noPrediction: true, hasLiveGoalCheck: false,
      levelStart: 64, lastAskedAt: actions === 12 ? 0 : actions - 24, win });
    assert.match(ask!, /write question "goal" with check\(t\)/);
    assert.match(ask!, /level-1 win at #63 \(ACTION6\(44,19\)\)/);
    assert.match(ask!, /every move on this level/);
  }
  const liveButNoPrediction = recurringGoalCheckAsk({ mode: 'shadow', actions: 12, noPrediction: true,
    hasLiveGoalCheck: true, levelStart: 64, lastAskedAt: 0, win });
  assert.ok(liveButNoPrediction, 'a live goal check does not silence a no-prediction branch');
  const predictionAndLiveCheck = recurringGoalCheckAsk({ mode: 'shadow', actions: 12, noPrediction: false,
    hasLiveGoalCheck: true, levelStart: 64, lastAskedAt: 0, win });
  assert.equal(predictionAndLiveCheck, undefined);
  const predictionWithoutLiveCheck = recurringGoalCheckAsk({ mode: 'shadow', actions: 12, noPrediction: false,
    hasLiveGoalCheck: false, levelStart: 64, lastAskedAt: 0, win });
  assert.ok(predictionWithoutLiveCheck, 'the missing live check keeps the ask active despite a predicted change');
  assert.equal(recurringGoalCheckAsk({ mode: 'off', actions: 12, noPrediction: true, hasLiveGoalCheck: false,
    levelStart: 64, lastAskedAt: 0, win }), '12 actions on this level and no step predicted a level change (no goal test yet)');
  assert.equal(levelGoalCheckAsk('off', { level: 1, n: 63, action: 'ACTION6(44,19)' }, false), undefined);
  assert.match(levelGoalCheckAsk('shadow', { level: 1, n: 63, action: 'ACTION6(44,19)' }, false)!, /judged against this win and every move on level 2/);
});

test('T10 E1 refusal cites the prior winning action and GOAL_OUTCOME is prefixed once', () => {
  const refusal = goalSupportRefusal('hyp.exit', { question: 'goal', status: 'supported' }, [], 1,
    { level: 0, n: 63, action: 'ACTION6(44,19)' })!;
  assert.match(refusal, /previous level 1 win was #63 \(ACTION6\(44,19\)\)/);
  assert.equal(formatGoalOutcome({ key: 'hyp.exit', version: 'v1', n: 63, level: 0, met: true, verdict: 'win_held' }),
    'GOAL_OUTCOME hyp.exit: win_held at #63 (level 1)');
});

test('S1 consult failures release consult-first only for recognized service prefixes', () => {
  for (const prefix of ['consult round budget exhausted', 'consult time budget exhausted', 'consult length continuation exhausted', 'consult aborted', 'consult error'])
    assert.equal(consultServiceFailure(prefix + ': detail'), true);
  assert.equal(consultBudgetError(6, false), 'consult round budget exhausted (6 rounds)');
  assert.equal(consultBudgetError(2, true), 'consult time budget exhausted (120 s)');
  assert.equal(consultServiceFailure('consult review call cap reached'), false);
  assert.equal(consultServiceFailure('no active subagent analyst'), false);
  assert.equal(consultFirstBlocks({ consultPoint: true, consulted: false }, 'prompts/lessons.md'), true);
  assert.equal(consultFirstBlocks({ consultPoint: true, consulted: false }, 'agents/analyst.md'), false);
  assert.equal(consultFirstBlocks({ consultPoint: true, consulted: true }, 'prompts/lessons.md'), false);
  const fixture = (arm: string) => readFileSync(new URL('../demo/fixtures/goal-r2/consult/' + arm + '.jsonl', import.meta.url), 'utf8')
    .split(String.fromCharCode(10)).filter(Boolean).map(line => JSON.parse(line));
  for (const arm of ['on', 'shadow']) {
    const points = fixture(arm);
    assert.ok(points.length > 0);
    const failures = points.flatMap(point => point.results).filter((result: any) => result.isError);
    assert.ok(failures.length > 0);
    assert.ok(failures.every((result: any) => result.text.length <= 120));
  }
  const extension = readFileSync(new URL('../demo/arc_thin_extension.ts', import.meta.url), 'utf8');
  assert.ok(extension.includes('consultServiceFailure(message)')); assert.ok(extension.includes('released: true'));
});

test('T11 recorded L2 trigger counts reproduce judged goal asks for both arms', () => {
  const records = [
    { actions: [14, 46], win: { level: 1, n: 60, action: 'ACTION6(44,19)' } },
    { actions: [12, 36, 60], win: { level: 1, n: 63, action: 'ACTION6(44,19)' } },
  ];
  for (const record of records) for (let i = 0; i < record.actions.length; i++) {
    const actions = record.actions[i];
    const ask = recurringGoalCheckAsk({ mode: 'on', actions, noPrediction: true, hasLiveGoalCheck: false,
      levelStart: record.win.n + 1, lastAskedAt: i ? actions - 24 : 0, win: record.win });
    assert.match(ask!, new RegExp('win at #' + record.win.n));
    assert.match(ask!, /every move on this level/);
  }
});
