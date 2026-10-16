import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeLoopGuard} from '../demo/arc_thin_native_loop.ts';

test('native investigation permits distinct calls beyond six and stops only unchanged repeated observations/errors', () => {
  const guard = new NativeLoopGuard();
  for (let n=0;n<12;n++) assert.equal(guard.record('read',{path:'results/r000001.txt',offset:n},'v1',false), false);
  assert.equal(guard.record('read',{path:'same'},'v1',false),false);
  assert.equal(guard.record('read',{path:'same'},'v1',false),false);
  assert.equal(guard.record('read',{path:'same'},'v1',false),true);
  assert.equal(guard.record('read',{path:'same'},'v2',false),false);
  guard.reset();
  assert.equal(guard.record('python',{code:'broken'},'v1',true),false);
  assert.equal(guard.record('python',{code:'broken'},'v1',true),false);
  assert.equal(guard.record('python',{code:'broken'},'v1',true),true);
  assert.equal(guard.record('python',{code:'fixed'},'v1',false),false);
});

test('a call that succeeded repeats only with the same result and state; ARC_THIN_LOOP_RESULTS=0 keeps the earlier rule', () => {
  // su15-r1-B2 (2026-10-16): one python call 20 times in a row with the same output.
  const guard = new NativeLoopGuard();
  const code = {code: "print('same')"};
  assert.equal(guard.record('python', code, 'v1', false, 'same'), false);
  assert.equal(guard.record('python', code, 'v1', false, 'same'), false);
  assert.equal(guard.record('python', code, 'v1', false, 'same'), true);
  // The same call whose output changes is not a repeat: code that acts or reads a changing session.
  guard.reset();
  for (let n = 0; n < 6; n++) assert.equal(guard.record('python', code, 'v1', false, `n=${n}`), false);
  // Nor is it one after the state changed (an action, a saved component, memory).
  guard.reset();
  assert.equal(guard.record('python', code, 'v1', false, 'same'), false);
  assert.equal(guard.record('python', code, 'v1', false, 'same'), false);
  assert.equal(guard.record('python', code, 'v2', false, 'same'), false);
  // Reads still repeat by their arguments alone.
  guard.reset();
  for (const [i, text] of ['a', 'b', 'c'].entries()) assert.equal(guard.record('read', {path: 'x'}, 'v1', false, text), i === 2);
  const earlier = new NativeLoopGuard({results: false});
  for (let n = 0; n < 5; n++) assert.equal(earlier.record('python', code, 'v1', false, 'same'), false);
  assert.equal(earlier.record('read', {path: 'x'}, 'v1', false), false);
});
