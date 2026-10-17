import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_BASE, PROMOTE_HOLDS, RULES_CHARS, citedKeys, controlSegments, promotionTriggers, promotionView,
  type ClaimRow, type ControlRecord } from '../demo/arc_thin_claims.ts';
import { parseRefinerReply } from '../demo/arc_thin_refiner.ts';
import { isEmptyValue } from '../demo/arc_thin_native_runtime.ts';
import { codeShape, componentLines, coveringComponent, type PythonRun } from '../demo/arc_thin_reuse.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';
import { freezeHistory, historyResult } from '../demo/arc_thin_native_context.ts';

test('the rules prompt is written by refinements only: the agent is pointed to its own places', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'rules-owner-')));
  assert.throws(() => w.mutate({ op: 'write', path: 'prompts/rules.md', content: 'notes' }), /kept by refinements.*prompts\/strategy\.md.*notes\//);
  assert.throws(() => w.path('prompts/RULES.md', true), /kept by refinements/);
  const write = w.fileTools().find((t) => t.name === 'write')!;
  await assert.rejects(write.execute('w', { path: 'prompts/rules.md', content: 'x' }, undefined, undefined, {} as any), /kept by refinements/);
  w.runtimeWrite('prompts/rules.md', '---\nactive: true\n---\n- r (hyp.r)\n');
  assert.match(w.read('prompts/rules.md'), /hyp\.r/);
  w.mutate({ op: 'write', path: 'prompts/strategy.md', content: '---\nactive: true\n---\nplan' });
});

test('an earlier result keeps the lines code printed as findings and drops dumped data', () => {
  const dump = '[' + Array.from({ length: 52 }, (_, i) => `(${30 + i % 5}, ${40 + i}, 3, 12)`).join(', ') + ']';
  const text = ['== ACTION1 == ndiffs=52', dump, 'bbox x 13 38 y 40 62', '#1 ACTION1 → changed=52'].join('\n');
  const saved: string[] = [];
  const shown = historyResult(text, 5000, (body) => { saved.push(body); return 'results/r000009.txt'; });
  assert.match(shown, /^== ACTION1 == ndiffs=52\n\[line 2: \d+ chars not shown; starts "\[\(30, 40, 3, 12\)/);
  assert.match(shown, /bbox x 13 38 y 40 62\n#1 ACTION1 → changed=52\n\(full result: results\/r000009\.txt\)$/);
  assert.deepEqual(saved, [text]);
  assert.equal(historyResult('short\nlines', 5000), 'short\nlines');
  // The frozen transcript applies the same rule, and leaves results without long lines untouched.
  const messages = [{ role: 'user', content: 'Decide.' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'python', arguments: {} }, { type: 'toolCall', id: 'b', name: 'python', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'a', toolName: 'python', content: [{ type: 'text', text }] },
    { role: 'toolResult', toolCallId: 'b', toolName: 'python', content: [{ type: 'text', text: 'small' }] }];
  const frozen = freezeHistory(messages);
  const results = frozen.filter((m: any) => m.role === 'toolResult');
  assert.match(results[0].content[0].text, /chars not shown/);
  assert.deepEqual(results[1].content, messages[3].content);
  assert.deepEqual(freezeHistory(messages), frozen, 'a finished decision renders to the same bytes every time');
});

const rows = (key: string, version: string, results: Array<true | false | null>, level = 0): ClaimRow[] =>
  results.map((result, i) => ({ key, version, n: i + 1, level, result }));
const hyp = (version?: string, status = 'open') => ({ status, ...(version ? { version } : {}) });

test('a check that keeps holding is offered as a rule only once its controls show it discriminates', () => {
  const held = rows('hyp.a', 'v1', [true, true, null, true, true]);
  const hypotheses = new Map([['hyp.a', hyp('v1')]]);
  assert.deepEqual(promotionView(hypotheses, held, new Map(), '').needControls, [{ key: 'hyp.a', version: 'v1' }]);
  const vacuous = new Map<string, ControlRecord>([['hyp.a@v1', { key: 'hyp.a', version: 'v1', results: [true, true, null] }]]);
  assert.deepEqual(promotionView(hypotheses, held, vacuous, '').vacuous, ['hyp.a']);
  const sharp = new Map<string, ControlRecord>([['hyp.a@v1', { key: 'hyp.a', version: 'v1', results: [false, true] }]]);
  const view = promotionView(hypotheses, held, sharp, '');
  assert.deepEqual(view.candidates, [{ key: 'hyp.a', version: 'v1', holds: 4, levels: 1 }]);
  assert.match(promotionTriggers(view)[0], /hyp\.a held on 4 recorded moves, never failed.*candidate rule for prompts\/rules\.md/);
});

test('too few holds, a failure, an error, a rejected status or no check keep a hypothesis out of the rules', () => {
  const controls = new Map<string, ControlRecord>([['hyp.a@v1', { key: 'hyp.a', version: 'v1', results: [false] }]]);
  const one = (results: Array<true | false | null>, status = 'open') =>
    promotionView(new Map([['hyp.a', hyp('v1', status)]]), rows('hyp.a', 'v1', results), controls, '').candidates.length;
  assert.equal(one(Array(PROMOTE_HOLDS - 1).fill(true)), 0);
  assert.equal(one([true, true, true, true, false]), 0);
  assert.equal(one([true, true, true, true], 'rejected'), 0);
  assert.equal(one([true, true, true, true]), 1);
  const erred: ClaimRow[] = [...rows('hyp.a', 'v1', [true, true, true, true]), { key: 'hyp.a', version: 'v1', n: 5, level: 0, result: 'error' }];
  assert.equal(promotionView(new Map([['hyp.a', hyp('v1')]]), erred, controls, '').candidates.length, 0);
  // Results of an earlier version of the check do not count for the current one.
  assert.equal(promotionView(new Map([['hyp.a', hyp('v2')]]), rows('hyp.a', 'v1', [true, true, true, true]), controls, '').candidates.length, 0);
  assert.equal(promotionView(new Map([['hyp.a', hyp()]]), rows('hyp.a', 'v1', [true, true, true, true]), controls, '').candidates.length, 0);
});

test('a cited rule whose check fails is in dispute; a cited key with no check is reported; an over-long rules prompt is', () => {
  const rules = '---\nactive: true\n---\n- the piece moves right (hyp.a)\n- the bar counts actions (hyp.bar)\n';
  assert.deepEqual(citedKeys(rules), ['hyp.a', 'hyp.bar']);
  const view = promotionView(new Map([['hyp.a', hyp('v1')]]), rows('hyp.a', 'v1', [true, true, false, true, false]), new Map(), rules);
  assert.deepEqual(view.refuted, [{ key: 'hyp.a', failing: [3, 5] }]);
  assert.deepEqual(view.unchecked, ['hyp.bar']);
  assert.equal(view.candidates.length, 0);
  // A cited key that names no hypothesis at all, apart from one that exists without a check (su15-r04-e1's refinements
  // cited hyp.action6_mechanic, hyp.border_cost and hyp.action7_noop, none of which existed).
  assert.deepEqual(view.missing, ['hyp.bar']);
  assert.deepEqual(promotionView(new Map([['hyp.a', hyp('v1')], ['hyp.bar', hyp()]]), [], new Map(), rules).missing, []);
  assert.match(promotionTriggers(view)[0], /hyp\.a, cited in prompts\/rules\.md, failed at #3, #5: the rule is in dispute/);
  const long = promotionView(new Map(), [], new Map(), 'x'.repeat(RULES_CHARS + 1));
  assert.equal(long.overCap, true);
  assert.match(promotionTriggers(long).at(-1)!, /over 1500 characters/);
});

test('control transitions pair the grid before one move with the grid after a different move', () => {
  const g = (v: number) => [[v]];
  const grids = new Map([[0, g(0)], [1, g(1)], [2, g(2)], [3, g(2)], [4, g(4)]]);
  const { segments, sources } = controlSegments([1, 2, 3, 4], grids, 3);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], { start: CONTROL_BASE, grid: g(0), steps: [{ n: CONTROL_BASE, grid: g(2) }] });
  assert.equal(sources.get(CONTROL_BASE), 1);
  // Move 2 and move 3 end on the same grid: 2 is paired with 4, never with 3.
  assert.deepEqual(segments[1].steps[0].grid, g(4));
  for (const segment of segments) assert.ok(segment.steps[0].n >= CONTROL_BASE);
  assert.equal(controlSegments([1], grids).segments.length, 0, 'one move has nothing to pair with');
});

test('a refinement can add a checked hypothesis', () => {
  const edit = parseRefinerReply('HYPOTHESIS hyp.right\nclaim: ACTION1 moves the piece right\nquestion: what actions do\n' +
    'predicts: one column further right\ncheck:\n```python\ndef check(t):\n    return None\n```\nEND\nWHY restated three times');
  assert.deepEqual(edit, { kind: 'hypothesis', key: 'hyp.right', claim: 'ACTION1 moves the piece right', question: 'what actions do',
    predicts: 'one column further right', check: 'def check(t):\n    return None\n', why: 'restated three times' });
  assert.equal(parseRefinerReply('HYPOTHESIS right\nclaim: x\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('HYPOTHESIS hyp.x\nquestion: q\nEND').kind, 'invalid');
  assert.equal(parseRefinerReply('HYPOTHESIS hyp.x\nclaim: c\ncheck:\nreturn True\nEND').kind, 'invalid');
  assert.deepEqual(parseRefinerReply('HYPOTHESIS hyp.x\nclaim: c\nEND\nWHY w'), { kind: 'hypothesis', key: 'hyp.x', claim: 'c', why: 'w' });
  // The rules prompt is a prompt component like the strategy: frontmatter is added when missing.
  const rules = parseRefinerReply('FILE prompts/rules.md\n- the piece moves right (hyp.right)\nEND\nWHY held 4 times');
  assert.equal(rules.kind, 'file');
  assert.match((rules as any).content, /^---\nactive: true\n---\n- the piece moves right \(hyp\.right\)\n$/);
});

test('an empty view output is recognised in every shape a view returns', () => {
  for (const value of [null, undefined, '', '  ', [], {}, { stdout: '', has_value: false }, { stdout: '\n', has_value: true, value: null }])
    assert.equal(isEmptyValue(value), true, JSON.stringify(value));
  for (const value of [0, false, 'x', [1], { a: 1 }, { stdout: 'pos 3', has_value: false }, { stdout: '', has_value: true, value: 3 }])
    assert.equal(isEmptyValue(value), false, JSON.stringify(value));
});

test('a saved component that computes a retyped call is named once the call has been typed twice', () => {
  const run = (code: string): PythonRun => ({ ...codeShape(code), level: 0, kit: 'k' });
  const tool = componentLines('tools/nine.py', 'grid[3].index(9)\n');
  assert.equal(coveringComponent([run('grid[3].index(9)')], [tool]), undefined);
  assert.equal(coveringComponent([run('grid[3].index(9)'), run('grid[3].index(9)')], [tool]), 'tools/nine.py');
  assert.equal(coveringComponent([run('grid[3].index(9)'), run('sum(map(sum, grid))')], [tool]), undefined);
  assert.equal(coveringComponent([run('grid[3].index(9)'), run('grid[3].index(9)')], []), undefined);
});
