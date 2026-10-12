import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeShape, kitOf, repetitionText, type PythonRun } from '../demo/arc_thin_native_runtime.ts';

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
const run = (code: string, level = 0, kit = ''): PythonRun => ({ level, kit, ...codeShape(code) });

test('code shape ignores numbers, comments and blank lines', () => {
  assert.equal(codeShape(diff(0, 1)).shape, codeShape(diff(2, 3)).shape);
  assert.equal(codeShape(diff(0, 1)).gist, 'cur = history.grid(1)');
  assert.notEqual(codeShape(diff(0, 1)).shape, codeShape('print(grid[0][0])').shape);
  // Identifiers containing digits are not numbers.
  assert.notEqual(codeShape('g0 = 1').shape, codeShape('g1 = 1').shape);
});

test('repetition names recomputed work and resets when a component is saved', () => {
  const unrelated = run('import collections\nprint(collections.Counter(v for r in grid for v in r))');
  assert.equal(repetitionText([unrelated, run(diff(0, 1))]), '');
  const text = repetitionText([unrelated, run(diff(0, 1)), run(diff(1, 2)), run(diff(2, 3))]);
  assert.match(text, /^REPEATED WORK: 2 of your last 4 python calls/);
  assert.match(text, /`cur = history\.grid\(1\)` ×3/);
  assert.match(text, /tools\/<name>\.py/);
  assert.match(text, /observers\/<name>\.py/);
  // Mostly shared lines count as the same computation.
  const variant = diff(3, 4).replace('print("ndiffs:", len(diffs))', 'print(diffs[:5])');
  assert.match(repetitionText([run(diff(0, 1)), run(variant)]), /1 of your last 2/);
  // Only saved tools, observers and libraries define the kit.
  assert.equal(kitOf({ 'tools/a.py': 2, 'notes/x.md': 1, 'lib/u.py': 1 }), 'lib/u.py@1,tools/a.py@2');
});
