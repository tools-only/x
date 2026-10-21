import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalStanding } from './arc_thin_goal_admission.ts';
import { advanceCarry, buildLevelCarry, partitionRules, renderCarry, ruleScope, type CarryInput } from './arc_thin_level_carry.ts';

function replay(arm: string) {
	const root = new URL(`./fixtures/goal-r1/${arm}/`, import.meta.url);
	const read = (name: string) => readFileSync(new URL(`harness/${name}.jsonl`, root), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
	const rulesText = readFileSync(new URL('workspace/prompts/rules.md', root), 'utf8');
	const input: CarryInput = { trajectory: read('trajectory'), memoryRows: read('memory'), claimRows: read('claim_checks'),
		goalRows: [], observerRuns: read('observer_runs'), rulesText };
	return { input, rulesText };
}

for (const [arm, expectedWin] of [['ga-p0-on-1', 60], ['ga-p0-shadow-1', 63]] as const) test(`carry replay counts match ${arm}`, () => {
	const { input, rulesText } = replay(arm);
	const carry = buildLevelCarry(input, 0);
	assert.equal(carry.win.n, expectedWin);
	assert.equal(carry.cost.actions, input.trajectory.filter(row => Number(row.n) <= expectedWin && Number(row.level ?? row.levels_before ?? (Number(row.levels_completed ?? 0) - (row.level_changed ? 1 : 0))) === 0).length);
	assert.equal(carry.cost.resets, 1);
	assert.equal(carry.cost.game_overs, 1);
	const expectedChecks = [...new Set(input.claimRows.filter(row => row.level === 0).map(row => `${row.key}@${row.version}`))].sort();
	assert.deepEqual(carry.pieces.filter(piece => piece.kind === 'check').map(piece => piece.ref).sort(), expectedChecks);
	const expectedViews = new Set(input.observerRuns.filter(row => {
		const n = Number(String(row.key).split('@').at(-1));
		const transition = input.trajectory.find(item => Number(item.n) === n);
		return transition && Number(transition.levels_completed ?? 0) - (transition.level_changed ? 1 : 0) === 0;
	}).map(row => String(row.key).split('@')[0]).filter(path => path.startsWith('tools/')));
	assert.equal(carry.pieces.filter(piece => piece.kind === 'view').length, expectedViews.size);
	assert.equal(carry.pieces.filter(piece => piece.kind === 'rule').length, rulesText.split(/\r?\n/).filter(line => ruleScope(line) === 0).length);
	const win = input.trajectory.find(row => row.level_changed)!;
	const literalRows = input.trajectory.map(row => {
		const met = row.action === win.action && row.x === win.x && row.y === win.y;
		return { key: 'hyp.literal', version: 'v1', n: Number(row.n), level: Number(row.levels_completed ?? 0) - (row.level_changed ? 1 : 0), met,
			verdict: met && row.level_changed ? 'win_held' as const : met ? 'false_win' as const : row.level_changed ? 'missed_win' as const : 'quiet' as const };
	});
	assert.equal(goalStanding(literalRows, 'hyp.literal', 'v1', 0), arm === 'ga-p0-on-1' ? 'falsified' : 'supported');
	const advanced = advanceCarry(carry, input);
	assert.ok(advanced.deltas.some(delta => delta.to === 'changed'));
	assert.ok(advanced.deltas.some(delta => delta.to === 'dropped'));
	if (arm === 'ga-p0-shadow-1') {
		assert.equal(carry.pieces.filter(piece => piece.kind === 'view').length, 3);
		assert.equal(carry.pieces.filter(piece => piece.kind === 'rule').length, 1);
		assert.ok(advanced.deltas.some(delta => delta.kind === 'view' && delta.to === 'held'));
		assert.ok(advanced.carry.pieces.some(piece => piece.kind === 'goal' && piece.state === 'new'));
		assert.deepEqual(partitionRules(rulesText, carry, 1).counts, { rules: 6, carried: 1 });
	} else {
		assert.equal(carry.pieces.filter(piece => piece.kind === 'view').length, 0);
		assert.equal(carry.pieces.filter(piece => piece.kind === 'rule').length, 0);
		assert.deepEqual(partitionRules(rulesText, carry, 1).counts, { rules: 7, carried: 0 });
	}
	assert.ok(renderCarry(carry).length <= 900);
});

test('rule scope and cited check partition are typed and prose-independent', () => {
	const carry = { from_level: 0, to_level: 1, win: { n: 60, action: 'ACTION1' }, cost: { actions: 60, resets: 1, game_overs: 1 },
		pieces: [{ ref: 'hyp.changed@v1', kind: 'check' as const, from: { level: 0, evidence: 'holds 2 fails 4' }, state: 'changed' as const, at: 72 },
			{ ref: 'hyp.held@v1', kind: 'check' as const, from: { level: 0, evidence: 'holds 3 fails 0' }, state: 'held' as const, at: 75 }] };
	const lines = '- Level 1: old claim (hyp.changed)\n- Level 1: stable claim (hyp.held)\n- unrelated prose Level 1: no scope\n';
	const partition = partitionRules(lines, carry, 1);
	assert.match(partition.carried, /fails on level 2 since #72/);
	assert.match(partition.rules, /held on level 2: 75/);
	assert.equal(partitionRules(lines, carry, 0).rules, lines.trim());
});
