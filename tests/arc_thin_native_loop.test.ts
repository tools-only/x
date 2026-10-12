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
