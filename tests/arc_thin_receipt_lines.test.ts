import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, LONG_LINE_CHARS } from '../demo/arc_thin_workspace.ts';

// The shape of kernel-02's first python result: a dumped dict on one line, the findings the code printed, another dump.
const dump = (n: number) => '{' + Array.from({ length: n }, (_, i) => `'k${i}': [4, 4, 5, 9]`).join(', ') + '}';
const findings = ['changed: 52', ...Array.from({ length: 52 }, (_, i) => `(${30 + i % 5}, ${40 + Math.floor(i / 5)}, 3, 12)`)];
const body = ['feedback: ' + dump(800), ...findings, 'state: ' + dump(2400), '', '→ null'].join('\n');

test('a receipt stubs long lines and shows the short lines the code printed whole', () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'receipt-lines-')));
  const receipt = w.receipt(body);
  for (const line of findings) assert.ok(receipt.includes(line), line);
  assert.match(receipt, /\[line 1: \d+ chars not shown; starts "feedback: \{/);
  assert.match(receipt, /\[line 55: \d+ chars not shown; starts "state: \{/);
  assert.match(receipt, /2 long lines not shown, every other line whole/);
  assert.match(receipt, /ref: results\/r000001\.txt\nread results\/r000001\.txt with offset\/limit for exact lines, or open it in python\./);
  assert.ok(receipt.length < 2000, String(receipt.length));
  assert.equal(w.read('results/r000001.txt'), body);
});

test('a receipt with only short lines keeps the start-and-end preview', () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'receipt-short-')));
  const many = Array.from({ length: 400 }, (_, i) => `row ${i}: ` + 'x'.repeat(60)).join('\n');
  const receipt = w.receipt(many);
  assert.match(receipt, /Preview partial; omitted lines/);
  assert.match(receipt, /row 0:/);
  assert.match(receipt, /row 399:/);
  assert.doesNotMatch(receipt, /not shown/);
  assert.ok(receipt.length < 1500);
});

test('when the stubbed text is still too long, stubs take the place of long lines in the preview', () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'receipt-mixed-')));
  const mixed = ['x'.repeat(LONG_LINE_CHARS + 1), ...Array.from({ length: 300 }, (_, i) => `row ${i}: ` + 'y'.repeat(40))].join('\n');
  const receipt = w.receipt(mixed);
  assert.match(receipt, /L1: \[line 1: 401 chars not shown/);
  assert.match(receipt, /row 299:/);
});

test('a receipt for a file that already exists points at it and saves nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'receipt-source-'));
  const w = new Workspace(root);
  const receipt = w.receipt(body, 'ok', [], 'data/current.json');
  assert.match(receipt, /ref: data\/current\.json\nread data\/current\.json with offset\/limit/);
  assert.deepEqual(readdirSync(join(w.root, 'results')), []);
  assert.equal(existsSync(join(root, '.harness', 'result-index.jsonl')), false);
  assert.equal(w.receipt('short', 'ok', [], 'data/current.json'), 'short');
});
