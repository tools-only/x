import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimVersion } from './arc_thin_claims.ts';
import { goalStanding } from './arc_thin_goal_admission.ts';
import { advanceCarry, buildLevelCarry, partitionRules, renderCarry, ruleScope, type CarryInput } from './arc_thin_level_carry.ts';

function replay(arm: string) {
  const root = new URL('./fixtures/goal-r1/' + arm + '/', import.meta.url);
  const read = (name: string) => readFileSync(new URL('harness/' + name + '.jsonl', root), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const rulesText = readFileSync(new URL('workspace/prompts/rules.md', root), 'utf8');
  const input: CarryInput = { trajectory: read('trajectory'), memoryRows: read('memory'), claimRows: read('claim_checks'),
    goalRows: [], observerRuns: read('observer_runs'), rulesText };
  return { input, rulesText };
}
function asOf(input: CarryInput, n: number): CarryInput {
  return { ...input, trajectory: input.trajectory.filter(row => Number(row.n) <= n),
    memoryRows: input.memoryRows.filter(row => Number(row.at ?? 0) <= n),
    claimRows: input.claimRows.filter(row => Number(row.n) <= n), goalRows: input.goalRows.filter(row => Number(row.n) <= n),
    observerRuns: input.observerRuns.filter(row => Number(String(row.key ?? '').split('@').at(-1)) <= n) };
}

for (const [arm, win] of [['ga-p0-on-1', 60], ['ga-p0-shadow-1', 63]] as const) {
  test('T-B1 live base and as-of-t replay: ' + arm, () => {
    const { input, rulesText } = replay(arm);
    const carry = buildLevelCarry(asOf(input, win), 0);
    assert.equal(carry.win.n, win);
    assert.equal(carry.cost.actions, input.trajectory.filter(row => Number(row.n) <= win && Number(row.level ?? row.levels_before ?? (Number(row.levels_completed ?? 0) - (row.level_changed ? 1 : 0))) === 0).length);
    assert.equal(carry.cost.resets, 1);
    assert.equal(carry.cost.game_overs, 1);
    assert.ok(!carry.pieces.some(piece => piece.ref.startsWith('hyp.action6_marker@')));
    const lateKey = arm === 'ga-p0-on-1' ? 'hyp.late_on' : 'hyp.late_shadow';
    const futureCheck = ['def check(t):', '    return True', ''].join(String.fromCharCode(10));
    const futureInput = { ...input, memoryRows: [...input.memoryRows, { key: lateKey, at: win + 70, hyp: { status: 'open', check: futureCheck } }],
      claimRows: [...input.claimRows, { key: lateKey, version: claimVersion(futureCheck), n: 1, level: 0, result: true }] };
    assert.ok(!buildLevelCarry(asOf(futureInput, win), 0).pieces.some(piece => piece.ref.startsWith(lateKey + '@')));
    const expectedLive = arm === 'ga-p0-on-1' ? ['hyp.action6_sequential_erosion'] : ['hyp.action6_mechanic'];
    assert.deepEqual(carry.pieces.filter(piece => piece.kind === 'check').map(piece => piece.ref.split('@')[0]).sort(), expectedLive);
    assert.equal(carry.pieces.filter(piece => piece.kind === 'view').length, arm === 'ga-p0-shadow-1' ? 3 : 0);
    assert.equal(carry.pieces.filter(piece => piece.kind === 'rule').length, arm === 'ga-p0-shadow-1' ? 1 : 0);
    assert.ok(renderCarry(carry).length <= 900);
    if (arm === 'ga-p0-shadow-1') assert.ok(rulesText.split(/\r?\n/).filter(line => ruleScope(line) === 0).length > 0);
  });

  test('T-B2/T-B3 deletion drives a single terminal drop: ' + arm, () => {
    const { input } = replay(arm);
    const carry = buildLevelCarry(asOf(input, win), 0);
    let liveCarry = carry;
    const drops: any[] = [];
    const l2 = input.trajectory.filter(row => Number(row.n) > win);
    for (const row of l2) {
      const next = advanceCarry(liveCarry, asOf(input, Number(row.n)));
      drops.push(...next.deltas.filter(delta => delta.to === 'dropped'));
      liveCarry = next.carry;
    }
    const carriedRefs = new Set(carry.pieces.map(piece => piece.ref));
    const carriedDropsAt63 = drops.filter(delta => carriedRefs.has(delta.ref) && delta.at === 63);
    assert.equal(carriedDropsAt63.length, arm === 'ga-p0-on-1' ? 1 : 0);
    for (const delta of drops) {
      const source = input.memoryRows.filter(row => row.key === delta.ref.split('@')[0] && Number(row.at) <= delta.at).at(-1);
      assert.ok(source?.deleted || source?.hyp?.status === 'rejected', JSON.stringify(delta));
      assert.equal(drops.filter(other => other.ref === delta.ref).length, 1);
    }
    for (const piece of liveCarry.pieces.filter(item => drops.some(delta => delta.ref === item.ref)))
      assert.equal(piece.state, 'dropped');
    if (carry.pieces.some(piece => piece.kind === 'check')) {
      const piece = carry.pieces.find(item => item.kind === 'check')!;
      const deletedAt = input.memoryRows.find(row => row.key === piece.ref.split('@')[0] && row.deleted);
      if (deletedAt) {
        const later = advanceCarry(liveCarry, { ...asOf(input, Number(deletedAt.at) + 5),
          memoryRows: [...asOf(input, Number(deletedAt.at) + 5).memoryRows,
            { key: piece.ref.split('@')[0], at: Number(deletedAt.at) + 5, hyp: { check: 'def check(t): return True', status: 'open' } }] });
        assert.equal(later.carry.pieces.find(item => item.ref === piece.ref)?.state, 'dropped');
        assert.equal(later.deltas.some(delta => delta.ref === piece.ref && delta.to === 'dropped'), false);
      }
    }
  });

  test('T-B4 held/changed checks surface within the first three L2 actions: ' + arm, () => {
    const { input } = replay(arm);
    let carry = buildLevelCarry(asOf(input, win), 0), early: any[] = [];
    for (const row of input.trajectory.filter(row => Number(row.n) > win).slice(0, 3)) {
      const next = advanceCarry(carry, asOf(input, Number(row.n)));
      early.push(...next.deltas);
      carry = next.carry;
    }
    assert.ok(early.some(delta => delta.to === 'held' || delta.to === 'changed'), JSON.stringify(early));
  });
}

test('T-B5 post-win goal checks receive back-standing only after the win row is judged', () => {
  const win = { n: 63, action: 'ACTION6(44,19)', level_changed: true, levels_completed: 1 };
  const carry = { from_level: 0, to_level: 1, win: { n: 63, action: 'ACTION6(44,19)' },
    cost: { actions: 63, resets: 1, game_overs: 1 }, pieces: [] as any[] };
  const check = 'def check(t):\n    return t.action == "ACTION6"\n';
  const version = claimVersion(check);
  const memory = [{ key: 'hyp.goal', at: 70, hyp: { question: 'goal', status: 'open', check } }];
  const base: CarryInput = { trajectory: [win, { n: 70, action: 'ACTION1', levels_completed: 1 }],
    memoryRows: memory, claimRows: [], goalRows: [], observerRuns: [], rulesText: '' };
  const make = (row?: any) => advanceCarry(carry, { ...base, goalRows: row ? [row] : [] });
  const explains = make({ key: 'hyp.goal', version, n: 63, level: 0, met: true, verdict: 'win_held' });
  assert.equal(explains.carry.pieces[0].back?.standing, 'explains');
  assert.match(renderCarry(explains.carry), /goal hyp\.goal: new -- explains the level-1 win at #63 \(ACTION6 44,19\)/);
  const missed = make({ key: 'hyp.goal', version, n: 63, level: 0, met: false, verdict: 'missed_win' });
  assert.equal(missed.carry.pieces[0].back?.standing, 'contradicts');
  assert.equal(missed.carry.pieces[0].back?.n, 63);
  const falseWin = make({ key: 'hyp.goal', version, n: 63, level: 0, met: true, verdict: 'win_held' });
  const withFalse = advanceCarry(carry, { ...base, goalRows: [
    { key: 'hyp.goal', version, n: 20, level: 0, met: true, verdict: 'false_win' },
    { key: 'hyp.goal', version, n: 63, level: 0, met: true, verdict: 'win_held' },
  ] });
  assert.equal(withFalse.carry.pieces[0].back?.standing, 'contradicts');
  assert.equal(withFalse.carry.pieces[0].back?.n, 20);
  assert.equal(make().deltas.length, 0);
  const silent = advanceCarry(carry, { ...base, goalRows: [{ key: 'hyp.goal', version, n: 63, level: 0, met: null, verdict: 'missed_win', error: 'check failed' }] });
  assert.equal(silent.carry.pieces[0].back?.standing, 'silent');
  const noCheck = advanceCarry(carry, { ...base, memoryRows: [{ key: 'hyp.goal', at: 70, hyp: { question: 'goal', status: 'open' } }] });
  assert.equal(noCheck.deltas[0].why, 'first written on this level');
  assert.equal(goalStanding([{ key: 'hyp.goal', version, n: 63, level: 0, met: true, verdict: 'win_held' }], 'hyp.goal', version, 0), 'supported');
});

test('rule scope and cited check partition remain typed', () => {
  const carry = { from_level: 0, to_level: 1, win: { n: 60, action: 'ACTION1' }, cost: { actions: 60, resets: 1, game_overs: 1 },
    pieces: [{ ref: 'hyp.changed@v1', kind: 'check' as const, from: { level: 0, evidence: 'holds 2 fails 4' }, state: 'changed' as const, at: 72 },
      { ref: 'hyp.held@v1', kind: 'check' as const, from: { level: 0, evidence: 'holds 3 fails 0' }, state: 'held' as const, at: 75 }] };
  const lines = '- Level 1: old claim (hyp.changed)\n- Level 1: stable claim (hyp.held)\n- unrelated prose Level 1: no scope\n';
  const partition = partitionRules(lines, carry, 1);
  assert.match(partition.carried, /fails on level 2 since #72/);
  assert.match(partition.rules, /held on level 2: 75/);
  assert.equal(partitionRules(lines, carry, 0).rules, lines.trim());
});

test('first successful old-view execution is evidence of execution, not semantic carry', () => {
  const carry = { from_level: 0, to_level: 1, win: { n: 10, action: 'ACTION1' },
    cost: { actions: 10, resets: 0, game_overs: 0 }, pieces: [{ ref: 'tools/view.py@1', kind: 'view' as const,
      from: { level: 0, evidence: 'ran 1 ok 0 errors' }, state: 'prior' as const }] };
  const input: CarryInput = { trajectory: [{ n: 11, action: 'ACTION1', level: 1 }], memoryRows: [], claimRows: [], goalRows: [],
    observerRuns: [{ key: 'tools/view.py@1@11', n: 11, version: 1, ok: true, value: 'some output' }], rulesText: '' };
  const advanced = advanceCarry(carry, input);
  assert.equal(advanced.carry.pieces[0].state, 'prior');
  assert.equal(advanced.carry.pieces[0].at, 11);
  assert.equal(advanced.deltas.length, 0);
});
