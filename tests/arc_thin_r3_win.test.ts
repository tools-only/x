import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitWinTest, recordFailedClaim, winTestState } from '../demo/arc_thin_win_tests.ts';
import type { Grid, StatusMask } from '../demo/arc_thin_effects.ts';
const mask:StatusMask={rows:new Set(),cols:new Set(),ticker:new Set()};
const grid:Grid=[[0,0,0,0],[0,1,0,0],[0,0,0,0]];
test('G2 blocks a repeated false claim and releases when a new class appears',()=>{
 const state=winTestState();recordFailedClaim(state,grid,{n:3,action:'ACTION6',x:1,y:1,predict:{level_changed:true},level_changed:false},mask);
 const same=admitWinTest(state,{action:'ACTION6',x:1,y:1,claim:true},grid,mask,'on','shadow');assert.equal(same.admit,false);assert.equal(same.rows[0].gate,'G2');
 const novel:Grid=[[0,0,0,0],[0,1,2,0],[0,0,0,0]];const released=admitWinTest(state,{action:'ACTION6',x:1,y:1,claim:true},novel,mask,'on','shadow');assert.equal(released.admit,true);assert.equal(released.rows[0].verdict,'released');
});
test('G2b remains shadow and never blocks a non-claim action',()=>{const state=winTestState();recordFailedClaim(state,grid,{n:1,action:'ACTION6',x:1,y:1,predict:{level_changed:true}},mask);recordFailedClaim(state,grid,{n:2,action:'ACTION6',x:1,y:1,predict:{level_changed:true}},mask);const result=admitWinTest(state,{action:'ACTION6',x:1,y:1},grid,mask,'on','shadow');assert.equal(result.admit,true);assert.equal(result.rows[0].verdict,'would_refuse');});
