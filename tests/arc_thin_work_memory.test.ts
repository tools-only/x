/**
 * Work memory (docs/plans/2026-10-20-work-memory.md), the pure parts: code keys and definitions, python addresses, the
 * transcript's references and collapsed decisions, what an action told, what a board already showed, and the spin streak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockNote, boardFacts, boardText, cellRefs, codeKey, collapseRepeatedDecisions, defBlocks, noveltyOf, objectRegions, pythonMark,
  referenceRepeats, repeatedBlocks, spinStreak, topStatements } from '../demo/arc_thin_work_memory.ts';

test('a computation is its code without comments and spacing; strings, a # inside them included, are code', () => {
  assert.equal(codeKey('# look\ng = grid  # current\n\nprint(len(g))\n'), 'g=grid\nprint(len(g))');
  assert.equal(codeKey('g = grid\nprint(len(g))'), codeKey('# other words\ng = grid\nprint( len(g) )  # same'));
  assert.equal(codeKey('pts = [(x, y) for y in range(64)]'), codeKey('pts=[(x,y) for y in range(64)]'));
  assert.notEqual(codeKey("print('a  b')"), codeKey("print('a b')"));
  assert.equal(codeKey("x = '#5' # five"), "x='#5'");
  assert.equal(codeKey('s = """\n# kept\n"""  # dropped'), 's="""\n# kept\n"""');
  assert.equal(codeKey('if a:\n    b = (1,\n        2)'), 'if a:\n    b=(1,\n2)');
  assert.deepEqual(cellRefs('a = cell(3)\nb = cell( 12 )\ncell(7, 2, 10)\n# cell(9)'), [3, 12, 7]);
});

test('top-level statements: a loop with its body, an if with its else, a decorator with its definition', () => {
  const code = '# start\nx = 1\nfor y in range(3):\n    x += y\n\n# then\nif x:\n    print(x)\nelse:\n    pass\n@cache\ndef f(a):\n    return a\nf(x)';
  assert.deepEqual(topStatements(code).map((s) => [s.start, s.end, s.lines]), [[1, 2, 1], [2, 4, 2], [6, 10, 4], [10, 13, 3], [13, 14, 1]]);
});

const loop = 'cur = grid\ndiffs = []\nfor y in range(64):\n    for x in range(64):\n        if prev[y][x] != cur[y][x]:\n            diffs.append((x, y))\nprint(len(diffs))';
const p7 = `prev = history.grid(11)\n${loop}`;
const again = `# what changed since #13?\nprev = history.grid(13)\n${loop.replace('!= cur', '!=cur')}\nprint(diffs[:5])`;

test('lines a cell retypes from an earlier one are found as whole statements, at least four lines and not the whole cell', () => {
  const blocks = repeatedBlocks(again, [{ id: 3, code: 'print(1)' }, { id: 7, code: p7 }]);
  assert.deepEqual(blocks, [{ from: 3, to: 9, id: 7, a: 2, b: 8 }]);
  assert.equal(blockNote(blocks), 'lines 3-9 = P7 lines 2-8');
  assert.deepEqual(repeatedBlocks(`n = 2\n${p7}`, [{ id: 7, code: p7 }]), [{ from: 2, to: 9, id: 7 }], 'all of P7');
  assert.equal(blockNote([{ from: 2, to: 9, id: 7 }]), 'lines 2-9 = all of P7');
  assert.deepEqual(repeatedBlocks('a = 1\nfor y in range(3):\n    print(y)', [{ id: 1, code: 'for y in range(3):\n    print(y)\nb = 2' }]), [], 'two lines are not a block');
  assert.deepEqual(repeatedBlocks(p7, [{ id: 7, code: p7 }]), [], 'the whole cell is a repeat, not a block');
});

test('a python result says its address and what it repeats', () => {
  assert.deepEqual(pythonMark('[P12]\n3'), { id: 12 });
  assert.deepEqual(pythonMark('[P15 = P12: same code]\n3'), { id: 15, same: 12, note: 'same code' });
  assert.deepEqual(pythonMark('[P15 = P12: same code on the same state, not run again]\n3')?.same, 12);
  assert.deepEqual(pythonMark('[P15: lines 3-9 = P7 lines 2-8; lines 11-14 = all of P9]\n3'),
    { id: 15, blocks: [{ from: 3, to: 9, id: 7, a: 2, b: 8 }, { from: 11, to: 14, id: 9 }] });
  assert.equal(pythonMark('3\n[P12]'), undefined);
});

test('definitions are found with their signature and a key of their body', () => {
  const code = 'import json\ndef find(g, c):\n    out = []\n    def inner(x):\n        return x\n    return out\n\nprint(find(grid, 3))\n';
  const defs = defBlocks(code);
  assert.deepEqual(defs.map((d) => [d.name, d.signature, d.start, d.end]), [['find', 'find(g, c)', 1, 6], ['inner', 'inner(x)', 3, 5]]);
  assert.equal(defBlocks('def find(g, c):\n    out = []  # list\n    def inner(x):\n        return x\n    return out\n')[0].key, defs[0].key);
});

test('a python result says its address and what it repeats', () => {
  assert.deepEqual(pythonMark('[P12]\n3'), { id: 12 });
  assert.deepEqual(pythonMark('[P15 = P12: same code]\n3'), { id: 15, same: 12, note: 'same code' });
  assert.deepEqual(pythonMark('[P15 = P12: same code on the same state, not run again]\n3')?.same, 12);
  assert.equal(pythonMark('3\n[P12]'), undefined);
});

const call = (id: string, name: string, args: any) => ({ role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }] });
const result = (id: string, text: string, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: 'x', content: [{ type: 'text', text }], isError });
const user = (text = 'Decide the next action.') => ({ role: 'user', content: text });

test('in the transcript a repeated cell is cell(k), a function defined again unchanged is a stub, a repeated arc_action keeps its actions only', () => {
  const body = 'def area(g):\n    return sum(1 for row in g for v in row if v)\n';
  const messages = [
    user(),
    call('a', 'python', { code: `# first look\n${body}print(area(grid))` }), result('a', '[P1]\n12'),
    call('b', 'python', { code: `# first look\n${body}print(area(grid))` }), result('b', '[P2 = P1: same code]\n12'),
    call('c', 'python', { code: `# the board changed?\n${body}print(area(grid))` }), result('c', '[P3 = P1: same code, other comments]\n13'),
    call('d', 'python', { code: `${body}print(area(prev_grid))` }), result('d', '[P4]\n12'),
    call('e', 'arc_action', { reasoning: 'walk right, long reasons', actions: [{ name: 'ACTION1' }] }), result('e', '#1 ACTION1 → changed=2'),
    user(),
    call('f', 'arc_action', { reasoning: 'walk right, long reasons', actions: [{ name: 'ACTION1' }] }), result('f', '#2 ACTION1 → changed=2'),
  ];
  const out = referenceRepeats(messages);
  const code = (i: number) => out[i].content[0].arguments.code;
  assert.equal(code(1), messages[1].content[0].arguments.code, 'the first one stays whole');
  assert.equal(code(3), 'cell(1)');
  assert.equal(code(5), '# the board changed?\ncell(1)', 'new comments stay, the code goes');
  assert.equal(code(7), 'def area(g): ...  # same as in P1\nprint(area(prev_grid))');
  assert.equal(out[9].content[0].arguments.reasoning, 'walk right, long reasons');
  assert.deepEqual(out[12].content[0].arguments, { actions: [{ name: 'ACTION1' }] });
  assert.equal(referenceRepeats(out).length, out.length);
  assert.equal(messages[3].content[0].arguments.code.includes('def area'), true, 'the messages themselves are not changed');
});

test('in the transcript lines retyped from an earlier call are the call that runs them', () => {
  const messages = [user(), call('a', 'python', { code: p7 }), result('a', '[P7]\n3'),
    call('b', 'python', { code: again }), result('b', '[P8: lines 3-9 = P7 lines 2-8]\n3\n[]')];
  const out = referenceRepeats(messages);
  assert.equal(out[1], messages[1]);
  assert.equal(out[3].content[0].arguments.code, '# what changed since #13?\nprev = history.grid(13)\ncell(7, 2, 8)\nprint(diffs[:5])');
});

test('consecutive decisions with the same prompt and calls are shown once, with their count and their actions', () => {
  const decision = (k: number) => [user(), call(`p${k}`, 'python', { code: 'cell(3)' }), result(`p${k}`, `[P${10 + k} = P3: same code]\nbar 54/64`),
    call(`a${k}`, 'arc_action', { reasoning: '(as in an earlier identical call)', actions: [{ name: 'ACTION6', x: 31, y: 5 }] }),
    result(`a${k}`, `#${40 + k} ACTION6(31,5) → changed=0`)];
  const other = [user(), call('z', 'arc_action', { reasoning: 'try', actions: [{ name: 'ACTION7' }] }), result('z', '#50 ACTION7 → changed=0')];
  const out = collapseRepeatedDecisions([...decision(1), ...decision(2), ...decision(3), ...other]);
  assert.equal(out.length, 5 + 3);
  assert.equal(out[2].content[0].text, '(this decision was made 3 times in a row with the same prompt and calls; the earlier 2 are not shown; ' +
    'their actions: #41–#42 ACTION6(31,5) → changed=0 (×2))\n[P13 = P3: same code]\nbar 54/64');
  assert.equal(out[4].content[0].text, '#43 ACTION6(31,5) → changed=0');
  assert.equal(collapseRepeatedDecisions(other).length, 3);
});

const row = (n: number, action: string, extra: Record<string, unknown> = {}) => ({ n, action, decision: n, changed_cells: 0, level_changed: false, state: 'NOT_FINISHED', ...extra });

test('an action is new from a board, known when it gave the same result there before, diverged when it gave another', () => {
  const hashes = new Map([[0, 'A'], [1, 'A'], [2, 'B'], [3, 'A'], [4, 'A'], [5, 'C']]);
  const rows = [row(1, 'ACTION1'), row(2, 'ACTION2', { changed_cells: 4 }), row(3, 'RESET'), row(4, 'ACTION1'), row(5, 'ACTION1')];
  assert.deepEqual(noveltyOf(rows[0], [], hashes), { novelty: 'new' });
  assert.deepEqual(noveltyOf(rows[1], rows.slice(0, 1), hashes), { novelty: 'new' }, 'ACTION2 was never played from board A');
  assert.deepEqual(noveltyOf(rows[3], rows.slice(0, 3), hashes), { novelty: 'known', known_from: 1 });
  assert.deepEqual(noveltyOf(rows[4], rows.slice(0, 4), hashes), { novelty: 'diverged', diverged_from: 4 }, 'from board A ACTION1 gave A twice, C now');
});

test('what a board already showed: where it was seen, what was played from it and what came of it, and what never was', () => {
  const grid = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (x === 2 && y === 2) || (x === 5 && y === 6) ? 9 : x === 6 && y === 1 ? 3 : 0));
  const hashes = new Map([[0, 'A'], [1, 'A'], [2, 'A'], [3, 'B'], [4, 'A']]);
  const rows = [row(1, 'ACTION1'), row(2, 'ACTION1'), row(3, 'ACTION6', { x: 2, y: 2, changed_cells: 1 }), row(4, 'ACTION7', { changed_cells: 1 })];
  const facts = boardFacts(rows, hashes, 4, grid, ['RESET', 'ACTION1', 'ACTION2', 'ACTION6', 'ACTION7']);
  assert.deepEqual(facts.seen, [0, 1, 2]);
  assert.deepEqual(facts.tried.map((t) => [t.label, t.count, t.outcome]), [['ACTION1', 2, 'no change'], ['ACTION6(2,2)', 1, '1 cells changed']]);
  assert.deepEqual(facts.untried, [{ action: 'ACTION2' }, { action: 'ACTION7' }, { action: 'ACTION6', x: 6, y: 1 }, { action: 'ACTION6', x: 5, y: 6 }]);
  assert.equal(boardText(facts), 'THIS BOARD (status cells masked) was here before: the start, #1, #2. From it: ACTION1 ×2 → no change; ' +
    'ACTION6(2,2) → 1 cells changed. Never tried from it: ACTION2; ACTION7; clicks on 2 of 3 objects: ACTION6(6,1), ACTION6(5,6).');
  assert.equal(boardText(boardFacts(rows, new Map([[0, 'A'], [4, 'Z']]), 4, grid, ['ACTION1'])), '', 'a board not seen before says nothing');
  assert.deepEqual(objectRegions(grid).map((r) => [r.x, r.y, r.size]), [[6, 1, 1], [2, 2, 1], [5, 6, 1]]);
});

test('decisions in a row that only replayed known results: a RESET is neutral, a new result or a level change ends the streak', () => {
  const r = (n: number, decision: number, action: string, novelty: string, extra: Record<string, unknown> = {}) =>
    ({ n, decision, action, novelty, level_changed: false, ...extra }) as any;
  const rows = [r(1, 1, 'ACTION1', 'new'), r(2, 2, 'ACTION1', 'known', { known_from: 1 }), r(3, 3, 'RESET', 'known'),
    r(4, 4, 'ACTION6', 'known', { x: 3, y: 4, known_from: 2 }), r(5, 4, 'ACTION1', 'known', { known_from: 1 })];
  assert.deepEqual(spinStreak(rows), { streak: 2, decisions: [4, 2], moves: ['ACTION6(3,4)', 'ACTION1'], since: 1 });
  assert.equal(spinStreak([...rows, r(6, 5, 'ACTION2', 'new')]).streak, 0);
  assert.equal(spinStreak([...rows, r(6, 5, 'ACTION2', 'known', { level_changed: true })]).streak, 0);
  assert.equal(spinStreak([...rows, r(6, 5, 'ACTION2', 'diverged')]).streak, 0);
  assert.equal(spinStreak(rows.map(({ novelty, ...rest }) => rest)).streak, 0, 'rows without novelty (older runs) never spin');
});

test('repeated arc_action omits reasoning and note instead of emitting copyable placeholder text', () => {
  const input = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'arc_action', arguments: { action: 'ACTION1', note: 'same' } }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'b', name: 'arc_action', arguments: { action: 'ACTION1', note: 'same' } }] }];
  const out = referenceRepeats(input);
  assert.equal('note' in out[1].content[0].arguments, false);
});
