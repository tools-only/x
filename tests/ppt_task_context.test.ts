import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { projectPptTaskContext } from '../demo/ppt_task_context.ts';

const state = (content = 'Current state: revision 1') => ({ role: 'custom', customType: 'ppt-work-state', content, timestamp: 1 });
const call = (id: string, name = 'write', args: any = { path: 'artifacts/source.html', content: 'ORIGINAL_SOURCE_'+'x'.repeat(10000) }) =>
  ({ role: 'assistant', content: [{ type: 'thinking', thinking: 'retain this reasoning' }, { type: 'toolCall', id, name, arguments: args }], timestamp: 2 });
const result = (id: string, text: string, isError = false) =>
  ({ role: 'toolResult', toolCallId: id, toolName: 'write', content: [{ type: 'text', text }], isError, timestamp: 3 });

test('completed turns shrink with exact archives; active, failed and unanswered calls remain intact', () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'ppt-context-')));
  const source: any[] = [state(), call('old'), result('old', 'START\n'+'data '.repeat(3000)+'\nEND'),
    call('failed'), result('failed', 'FAILURE_'+'e'.repeat(9000), true), call('unanswered'),
    call('recent1', 'write', { path: 'artifacts/recent1.txt', content: 'short' }), result('recent1', 'recent1 '.repeat(2000)), call('recent2', 'write', { path: 'artifacts/recent2.txt', content: 'short' }), result('recent2', 'recent2 '.repeat(2000)),
    { role: 'user', content: 'next task turn', timestamp: 4 }, state('Current state: revision 2'), call('active', 'write', { path: 'artifacts/current.txt', content: 'short' }), result('active', 'ACTIVE_'+'a'.repeat(9000))];
  const before = JSON.stringify(source);
  const projected: any[] = projectPptTaskContext(source, workspace);
  assert.equal(JSON.stringify(source), before, 'durable input is untouched');
  assert.ok(JSON.stringify(projected).length < before.length);
  assert.deepEqual(projected.slice(11), source.slice(11));
  for (const i of [3, 4, 5, 6, 7, 8, 9]) assert.deepEqual(projected[i], source[i]);
  assert.equal(projected[1].content[0].thinking, 'retain this reasoning');
  const argsRef = /results\/r\d+\.txt/.exec(projected[1].content[1].arguments.content)![0];
  assert.deepEqual(JSON.parse(workspace.read(argsRef)), source[1].content[1].arguments);
  const resultRef = /(?:full: |full result: )(results\/r\d+\.txt)/.exec(projected[2].content[0].text)![1];
  assert.equal(workspace.read(resultRef), source[2].content[0].text);
  assert.equal(projected[1].content[1].id, projected[2].toolCallId);
  assert.deepEqual(projectPptTaskContext(source, workspace), projected, 'projection is deterministic');
  const extended = [...source, call('more'), result('more', 'later output')];
  assert.deepEqual(projectPptTaskContext(extended, workspace).slice(0, 11), projected.slice(0, 11), 'tool continuation keeps prior bytes');
});

test('historical images become directly readable original files, while recent receipt text survives', () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'ppt-context-image-')));
  const bytes = Buffer.from([0, 128, 255, 1]);
  const source: any[] = [state(), call('render', 'office', { op: 'render' }), { ...result('render', 'render v1; source hash abc'),
    content: [{ type: 'text', text: 'render v1; source hash abc' }, { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }] }, state('Current state: revision 2')];
  const projected: any[] = projectPptTaskContext(source, workspace);
  assert.equal(projected[2].content[0].text, 'render v1; source hash abc');
  const ref = /results\/ppt-context-[a-f0-9]+\.png/.exec(projected[2].content[1].text)![0];
  assert.deepEqual(readFileSync(workspace.path(ref)), bytes);
  assert.equal(source[2].content[1].type, 'image');
});

test('an initial or unfinished task turn keeps its full context', () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'ppt-context-active-')));
  const source: any[] = [state(), call('unanswered'), call('active', 'write', { path: 'artifacts/current.txt', content: 'short' }), result('active', 'x'.repeat(20000))];
  assert.deepEqual(projectPptTaskContext(source, workspace), source);
});



test('successful source arguments are compact from their first replay, preserving a stable active-turn prefix', () => {
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), 'ppt-context-write-')));
  const source: any[] = [state(), call('saved'), result('saved', 'written successfully')];
  const first: any[] = projectPptTaskContext(source, workspace);
  assert.match(first[1].content[1].arguments.content, /Historical content/);
  assert.match(source[1].content[1].arguments.content, /^ORIGINAL_SOURCE_x{10000}$/);
  const next: any[] = [...source, call('next', 'read', { path: 'artifacts/source.html' }), result('next', 'exact read')];
  assert.deepEqual(projectPptTaskContext(next, workspace).slice(0, source.length), first);
  assert.deepEqual(first[2], source[2], 'latest tool result stays exact');
});
