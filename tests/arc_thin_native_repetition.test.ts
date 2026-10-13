import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptionGaps, codeShape, componentLines, coordinateSentences, families, kitOf, parseAdoptionReply, repetitionText, type PythonRun } from '../demo/arc_thin_reuse.ts';

// Python calls from foundation-native-ls20-real-20261012-02 (abridged): the same frame diff typed three times.
const diff = (a: number, b: number) => `
cur = history.grid(${b})
prev = history.grid(${a})
diffs = []
for y in range(64):
    for x in range(64):
        if cur[y][x] != prev[y][x]:
            diffs.append((x, y, prev[y][x], cur[y][x]))
print("ndiffs:", len(diffs))  # count
`;
const run = (code: string, decision = 0, level = 0, kit = ''): PythonRun => ({ level, kit, decision, ...codeShape(code) });

test('code shape ignores numbers, comments and blank lines', () => {
  assert.equal(codeShape(diff(0, 1)).shape, codeShape(diff(2, 3)).shape);
  assert.equal(codeShape(diff(0, 1)).gist, 'cur = history.grid(1)');
  assert.notEqual(codeShape(diff(0, 1)).shape, codeShape('print(grid[0][0])').shape);
  // Identifiers containing digits are not numbers.
  assert.notEqual(codeShape('g0 = 1').shape, codeShape('g1 = 1').shape);
});

test('repetition names recomputed work, and a saved component that turned constants into parameters covers it', () => {
  const unrelated = run('import collections\nprint(collections.Counter(v for r in grid for v in r))');
  assert.equal(repetitionText([unrelated, run(diff(0, 1))]), '');
  const runs = [unrelated, run(diff(0, 1)), run(diff(1, 2)), run(diff(2, 3))];
  const text = repetitionText(runs);
  assert.match(text, /^REPEATED WORK: 2 of your last 4 python calls on this level redid one computation/);
  assert.match(text, /`cur = history\.grid\(1\)` ×3\)/);
  assert.match(text, /leaves your reasoning for what is new/);
  // Mostly shared lines count as the same computation.
  const variant = diff(3, 4).replace('print("ndiffs:", len(diffs))', 'print(diffs[:5])');
  assert.match(repetitionText([run(diff(0, 1)), run(variant)]), /1 of your last 2/);
  const tool = componentLines('tools/diff.py', '"""Changed cells between two frames."""\ndef run(a: int, b: int):\n' +
    '    cur = history.grid(b)\n    prev = history.grid(a)\n    diffs = []\n    for y in range(64):\n        for x in range(64):\n' +
    '            if cur[y][x] != prev[y][x]:\n                diffs.append((x, y, prev[y][x], cur[y][x]))\n    return diffs\n');
  assert.match(repetitionText(runs, [tool]), /×3, tools\/diff\.py already covers it\)/);
  // An unrelated component with one generic line in common does not.
  const generic = componentLines('tools/count.py', 'def run(c: int):\n    cur = 0\n    return sum(v == c for r in grid for v in r)\n');
  assert.equal(families(runs, [generic]).find(f => f.runs.length === 3)!.covered, undefined);
  assert.equal(kitOf({ 'tools/a.py': 2, 'notes/x.md': 1, 'lib/u.py': 1 }), 'lib/u.py@1,tools/a.py@2');
});

test('an adoption gap needs rebuilding in two later decisions after the repetition was shown, and is reported once', () => {
  const runs = [run(diff(0, 1), 1), run(diff(1, 2), 1), run(diff(2, 3), 2)];
  const shapes = new Set(runs.map(r => r.shape));
  const shown = new Map([...shapes].map(s => [s, 1]));
  assert.deepEqual(adoptionGaps(runs, [], shown, new Set()), [], 'one later decision is not persistent');
  runs.push(run(diff(3, 4), 3));
  const [gap] = adoptionGaps(runs, [], shown, new Set());
  assert.equal(gap.after.length, 2);
  assert.equal(gap.shownAt, 1);
  assert.equal(gap.total, 4);
  assert.deepEqual(adoptionGaps(runs, [], shown, new Set(gap.shapes)), [], 'investigated once');
  assert.deepEqual(adoptionGaps(runs, [], new Map(), new Set()), [], 'never shown, no gap');
});

test('coordinate sentences are counted in reasoning text', () => {
  const counted = coordinateSentences('The block is at (34,15). It moved up. Rows r20-r24 hold 12 and 9.\nThe bar spans x33-54. I should test the goal next.');
  assert.deepEqual(counted, { sentences: 5, coordinate: 3 });
});

test('adoption review replies keep only cause lines', () => {
  const parsed = parseAdoptionReply('missing | `diff typed each time` | tools/diff.py run(a: int, b: int)\nfriction | x | y\nsomething else\nvaries | a | b\nstale | c | d');
  assert.deepEqual(parsed.lines, ['missing: `diff typed each time`; smallest change: tools/diff.py run(a: int, b: int)',
    'friction: x; smallest change: y', 'varies: a; smallest change: b']);
  assert.deepEqual(parsed.dropped, ['something else', 'stale | c | d']);
});
