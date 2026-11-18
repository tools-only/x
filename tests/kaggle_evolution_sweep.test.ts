import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, SelfRoot, hash } from '../demo/self_root.ts';
import { validatePythonComponent } from '../demo/arc_thin_components.ts';

const contract = () => {
  const value: any = {
    source: 'user_contract', authority: 'fixture', decisions: 'fixture', readonly_reason: 'fixture',
    boundaries: [...FLOOR], capabilities: ['read', 'ls', 'grep', 'run_harness_tool'],
    writable: ['components.tool', 'components.prompt', 'components.skill', 'components.memory', 'components.subagent', 'orchestration', 'policy'],
    budget: { requests: 40, tokens: 100000, seconds: 600, usd: 1, storage_bytes: 10000000 },
    acceptance: { checker: 'fixture' }, inherit_defaults: false, heartbeat: false,
  };
  return { ...value, content_hash: hash(value) };
};

test('Kaggle M10 runs seven ordered hot-evolution turns after induction', async () => {
  const self = new SelfRoot(contract(), undefined, validatePythonComponent, undefined, undefined, { mechanisms: { meta: true, sweep: true } } as any) as any;
  const tick = () => self.boundary(() => undefined, () => undefined);
  await tick();
  await self.transaction({ baseRevision: 1, orchestration: {
    revision: 1, roles: [{ id: 'agent' }], slots: [], steps: [{ id: 'work', role: 'agent' }], decisions: [], transitions: [],
    contract: { task_goal: 'Improve a Kaggle result through reproducible experiments',
      task_acceptance: 'Validate candidate scores locally and record leaderboard outcomes',
      loop_policy: { look_when: [{ on: 'segment_boundary', look: 'Compare local validation scores with the previous experiment' }] } },
  } });
  await tick();

  self.fact('request_record', { pin: { mode: 'execute' } });
  self.outcome({ source: 'kaggle_public_leaderboard', submission_ref: 1, public_score: 0.91 });
  await tick();
  assert.equal(self.reviewSelfView().evolution_pass.trigger, 'task_feedback_checkpoint');

  await self.exit({ reason: 'Induction complete', result: { reason: 'Review the scored experiment window', carry: ['test the strongest explanation next'] } });
  await tick();
  const expected = ['Context', 'Skill', 'Tool', 'Subagent', 'Memory', 'Loop', 'Prompt'];
  const observed = [];
  for (const focus of expected) {
    const frame = self.reviewSelfView().evolution_pass.sweep;
    assert.equal(frame.focus, focus);
    observed.push(frame.focus);
    self.pin();
    if (focus === 'Tool') {
      await self.transaction({ components: [{ op: 'define', kind: 'tool', name: 'cv_compare', source: '# program: on\ndef run(args):\n    return args' }] });
    }
    await tick();
    if (focus === 'Tool') assert.ok(self.active().some((component: any) => component.kind === 'tool' && component.name === 'cv_compare'));
  }
  assert.deepEqual(observed, expected);
  assert.equal(self.review, undefined);
  assert.equal(self.export().root.ledger.filter((row: any) => row.type === 'meta_pass_sweep_turn').length, 7);
});
