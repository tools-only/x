import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveOrchestrationSession } from '../demo/live_orchestration_core.ts';

const protocol = (key: string, expected: unknown, next: string) => ({
  roles: [{ id: 'agent' }, { id: 'other' }],
  slots: [],
  steps: [{ id: 'review', role: 'agent', decision: 'inspect' }, { id: 'edit', role: 'agent' }, { id: 'revise', role: 'agent' }],
  decisions: [{ id: 'inspect', judge: 'agent', question: 'Agent-authored question', evidence: [{ type: 'office.look', freshness: 'current' }], output: { type: 'object', required: [key], properties: { [key]: { type: 'array', items: { type: 'integer' } } } } }],
  transitions: [{ id: 'redo', from: 'review', on: { type: 'decision', id: 'inspect', path: `/${key}`, equals: expected }, requires: [{ type: 'office.look', currentArtifact: true }], to: next },
    { id: 'finish', from: 'review', on: { type: 'decision', id: 'inspect', path: `/${key}`, equals: [] }, requires: [{ type: 'office.look', currentArtifact: true }], to: 'complete' }],
});

test('agent-defined decision shape and branch drive the same generic executor', () => {
  const self = new LiveOrchestrationSession();
  self.recordAction('office.render', { artifactVersion: 2, artifactHash: 'deck-v2' }, true);
  self.recordAction('office.look', { artifactVersion: 2, artifactHash: 'deck-v2', pages: [1, 2] });
  self.reflect({ baseRevision: 1, orchestration: protocol('pagesToChange', [3], 'revise'), authorized: true });
  const receipt = self.decide({ decisionId: 'inspect', actor: 'agent', evidenceRefs: ['action-2'], result: { pagesToChange: [3] } });
  assert.equal(receipt.accepted, true);
  assert.equal(self.advance().step, 'revise');

  self.reflect({ baseRevision: 2, orchestration: protocol('selectedIds', ['a'], 'edit'), authorized: true });
  assert.equal(self.current.orchestration.decisions[0].output.required[0], 'selectedIds');
});

test('rejects forged or stale evidence, unauthorized decisions and stale reflection without partial commit', () => {
  const self = new LiveOrchestrationSession();
  self.recordAction('office.render', { artifactVersion: 1, artifactHash: 'deck-v1' }, true);
  self.recordAction('office.look', { artifactVersion: 1, artifactHash: 'deck-v1' });
  self.reflect({ baseRevision: 1, orchestration: protocol('pagesToChange', [1], 'revise'), authorized: true });
  assert.throws(() => self.decide({ decisionId: 'inspect', actor: 'other', evidenceRefs: ['action-2'], result: { pagesToChange: [1] } }), /unauthorized/);
  assert.throws(() => self.decide({ decisionId: 'inspect', actor: 'agent', evidenceRefs: ['forged'], result: { pagesToChange: [1] } }), /evidence/);
  self.recordAction('office.render', { artifactVersion: 2, artifactHash: 'deck-v2' }, true);
  assert.throws(() => self.decide({ decisionId: 'inspect', actor: 'agent', evidenceRefs: ['action-2'], result: { pagesToChange: [1] } }), /stale/);
  const before = self.current.revision;
  assert.throws(() => self.reflect({ baseRevision: 1, orchestration: protocol('selectedIds', [], 'edit'), authorized: true }), /stale revision/);
  assert.equal(self.current.revision, before);
  assert.equal(self.current.revision, 2);
});

test('rejects unauthorized and malformed reflection atomically', () => {
  const self = new LiveOrchestrationSession();
  const before = self.current.revision;
  assert.throws(() => self.reflect({ baseRevision: 1, orchestration: protocol('x', [], 'missing'), authorized: false }), /unauthorized/);
  assert.throws(() => self.reflect({ baseRevision: 1, orchestration: { ...protocol('x', [], 'revise'), transitions: [] }, authorized: true }), /reachable/);
  assert.equal(self.current.revision, before);
});

test('freshness never moves backward, source edits invalidate evidence, and decisions are not replayable', () => {
  const self = new LiveOrchestrationSession();
  const definition: any = protocol('status', 'revise', 'revise');
  definition.steps[0].actions = ['office.look'];
  definition.steps[0].actions.push('office.render');
  definition.decisions[0].output.properties.status = { type: 'string', enum: ['clean', 'revise'] };
  definition.decisions[0].output.required = ['status'];
  definition.transitions = [{ id: 'revise', from: 'review', on: { type: 'decision', id: 'inspect', path: '/status', equals: 'revise' }, requires: [{ type: 'office.look', freshness: 'current' }], to: 'revise' }];
  self.reflect({ baseRevision: 1, orchestration: definition, authorized: true });
  self.recordAction('office.render', { artifactVersion: 4, artifactHash: 'hash-4' }, true);
  self.recordAction('office.look', { artifactVersion: 4, artifactHash: 'hash-4' });
  self.recordAction('office.look', { artifactVersion: 3, artifactHash: 'hash-3' });
  assert.throws(() => self.decide({ decisionId: 'inspect', actor: 'agent', evidenceRefs: ['action-3'], result: { status: 'revise' } }), /stale/);
  self.decide({ decisionId: 'inspect', actor: 'agent', evidenceRefs: ['action-2'], result: { status: 'revise' } });
  assert.equal(self.advance().step, 'revise');
  assert.equal(self.advance().status, 'stalled');
  const edited = new LiveOrchestrationSession();
  edited.reflect({ baseRevision: 1, orchestration: definition, authorized: true });
  edited.recordAction('office.render', { artifactVersion: 4, artifactHash: 'hash-4' }, true);
  edited.recordAction('office.look', { artifactVersion: 4, artifactHash: 'hash-4' });
  edited.invalidateArtifact();
  assert.throws(() => edited.decide({ decisionId: 'inspect', actor: 'agent', evidenceRefs: ['action-2'], result: { status: 'clean' } }), /stale/);
});

test('action receipt transitions are constrained by the current step', () => {
  const self = new LiveOrchestrationSession();
  const definition: any = { roles: [{ id: 'agent' }], slots: [],
    steps: [{ id: 'render', role: 'agent', actions: ['office.render'] }, { id: 'review', role: 'agent' }], decisions: [],
    transitions: [{ id: 'rendered', from: 'render', on: { type: 'action', action: 'office.render' }, requires: [{ type: 'office.render', currentArtifact: true }], to: 'review' }] };
  self.reflect({ baseRevision: 1, orchestration: definition, authorized: true });
  assert.throws(() => self.recordAction('office.look', { artifactVersion: 1, artifactHash: 'x' }), /not allowed/);
  const action = self.recordAction('office.render', { artifactVersion: 1, artifactHash: 'x' }, true);
  assert.equal(action.transition.step, 'review');
  assert.equal(self.step, 'review');
});
