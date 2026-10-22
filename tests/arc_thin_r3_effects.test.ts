import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configOf, effectOf, objectsOf, type Grid, type StatusMask } from '../demo/arc_thin_effects.ts';
import { r3Config, r3Rebuild } from '../demo/arc_thin_r3.ts';
import { statusMask } from '../demo/arc_thin_ledger.ts';

const emptyMask: StatusMask = { rows: new Set(), cols: new Set(), ticker: new Set() };
const board = (x: number, y = 1): Grid => Array.from({ length: 5 }, (_, yy) => Array.from({ length: 7 }, (_, xx) => xx === x && yy === y ? 1 : 0));

test('G0 derives object classes, configuration, movement and masked status cost from grids', () => {
  const before = board(1), after = board(4);
  const objects = objectsOf(before, emptyMask);
  assert.deepEqual(objects.map(({ colour, size }) => [colour, size]), [[1, 1]]);
  assert.equal(configOf(objects), '1:1');
  const receipt = effectOf(before, after, { n: 1, action: 'ACTION6', x: 1, y: 1, levels_completed: 0 }, emptyMask, { attempt: 0, transitions: 9 });
  assert.equal(receipt.kind, 'move'); assert.equal(receipt.masked, 2); assert.deepEqual(receipt.steps, [3]);
  assert.equal(receipt.newState, true); assert.equal(receipt.dest, '1:1');
  const masked = { rows: new Set([1]), cols: new Set<number>(), ticker: new Set<string>() };
  const status = effectOf(before, after, { n: 2, action: 'ACTION6', x: 1, y: 1 }, masked, { attempt: 0 });
  assert.equal(status.masked, 0); assert.equal(status.status, 2); assert.equal(status.kind, 'inert');
});

test('effect replay is deterministic and remembers resets across attempts', () => {
  const rows = [{ n: 1, action: 'ACTION1', levels_completed: 0 }, { n: 2, action: 'RESET', levels_completed: 0 }, { n: 3, action: 'ACTION1', levels_completed: 0 }];
  const grids = new Map([[0, board(1)], [1, board(2)], [2, board(1)], [3, board(2)]]);
  const first = r3Rebuild(rows, grids, emptyMask), second = r3Rebuild(rows, grids, emptyMask);
  assert.deepEqual(first.receipts, second.receipts); assert.equal(first.attempt, 1); assert.equal(first.receipts[2].replayOf, 1);
});

test('R3 modes are bounded by the total mode and defaults follow the plan', () => {
  const defaults = r3Config({});
  assert.equal(defaults.mode, 'off'); assert.equal(defaults.gates.effects, 'off'); assert.equal(defaults.gates.win_lock, 'off');
  assert.equal(r3Config({ ARC_THIN_R3: 'on' }).gates.win_lock, 'shadow');
  assert.equal(r3Config({ ARC_THIN_R3: 'shadow', ARC_THIN_R3_FUSE: 'on' }).gates.fuse, 'shadow');
  assert.throws(() => r3Config({ ARC_THIN_R3: 'yes' }), /off, shadow or on/);
  assert.throws(() => r3Config({ ARC_THIN_R3: 'on', ARC_THIN_R3_PROGRESS_AFTER: '0' }), />= 1/);
});

test('su15 profile stays a fixture and core gates never read it', () => {
  const profile = JSON.parse(readFileSync(new URL('../demo/fixtures/goal-r3/su15-profile.json', import.meta.url), 'utf8'));
  assert.deepEqual(profile.statusMask.rows, [63]);
  for (const file of ['../demo/arc_thin_r3.ts', '../demo/arc_thin_effects.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8'); assert.doesNotMatch(source, /fixtures\/|ARC_THIN_R3_PROFILE/);
  }
});

const recorded = JSON.parse(readFileSync(new URL('../demo/fixtures/goal-r3/su15-grids.json', import.meta.url), 'utf8')) as Record<string, { states: Array<{n:number;grid:Grid}>; trajectory: Array<{n:number;action:string;x?:number;y?:number;level_changed?:boolean;state?:string;levels_completed?:number}> }>;
function replay(name: string, transform: (grid: Grid) => Grid = grid => grid) {
  const run=recorded[name], grids=new Map(run.states.map(row => [row.n, transform(row.grid)]));
  const transitions=run.trajectory.map(row => { const a=grids.get(row.n-1)!,b=grids.get(row.n)!,changes:Array<[number,number,number|undefined,number|undefined]>=[];
    for(let y=0;y<Math.max(a.length,b.length);y++)for(let x=0;x<Math.max(a[y]?.length??0,b[y]?.length??0);x++)if(a[y]?.[x]!==b[y]?.[x])changes.push([x,y,a[y]?.[x],b[y]?.[x]]);return changes; });
  const derived=statusMask(transitions),mask={rows:derived.rows,cols:derived.cols,ticker:derived.ticker};
  return { mask, rows:run.trajectory.map(row=>effectOf(grids.get(row.n-1),grids.get(row.n),row,mask,{attempt:0,transitions:transitions.length})) };
}
test('recorded su15 snippets derive the profile mask and cited 6.1 effect kind counts', () => {
  for(const name of Object.keys(recorded)) assert.deepEqual([...replay(name).mask.rows], [63], name);
  const counts=(name:string)=>Object.fromEntries(['level','game_over','reset','inert','move','struct'].map(kind=>[kind,replay(name).rows.filter(row=>row.kind===kind).length]));
  assert.deepEqual(counts('lr-g61-l2'), { level:1, game_over:0, reset:0, inert:0, move:4, struct:7 });
  assert.deepEqual(counts('g61-1'), { level:1, game_over:0, reset:0, inert:3, move:5, struct:7 });
});
test('mask and effect kinds are invariant under colour permutation and horizontal reflection', () => {
  const transform=(grid:Grid)=>grid.map(row=>row.slice().reverse().map(value=>value===0?9:value===9?0:(value+3)%16));
  for(const name of Object.keys(recorded)) { const base=replay(name), changed=replay(name,transform);
    assert.deepEqual([...changed.mask.rows],[...base.mask.rows]); assert.deepEqual([...changed.mask.cols],[...base.mask.cols]);
    assert.deepEqual(changed.rows.map(row=>row.kind),base.rows.map(row=>row.kind));
  }
});
