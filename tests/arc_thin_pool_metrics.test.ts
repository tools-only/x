import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {TaskPythonPool} from '../demo/pi_task_python_pool.ts';
import {arcSkillGuestProgram,SKILL_LIMITS} from '../demo/arc_thin_skill_guest.ts';

test('persistent WASI reports queue/startup cost and removes completed abort listeners', async () => {
  const pool=new TaskPythonPool(), controller=new AbortController();
  try {
    const value=await pool.evaluate(arcSkillGuestProgram(SKILL_LIMITS),
      {mode:'run',source:'def run(state,args): return 7',state:{},args:{}},controller.signal);
    assert.equal(getEventListeners(controller.signal,'abort').length,0);
    assert.ok(value.transport.queue_ms>=0);
    assert.ok(value.transport.startup_ms>=0);
    assert.equal(value.value.value,7);
  } finally {pool.close();}
});
