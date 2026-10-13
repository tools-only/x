import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';

test('long output receipt retains exact middle evidence behind a stable ranged read reference', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'receipts-')));
  const body = Array.from({ length: 80 }, (_, i) => i === 40 ? 'COUNTEREXAMPLE_MIDDLE_EXACT' : `line ${i}: ` + 'x'.repeat(80)).join('\n');
  const receipt = w.receipt(body, 'ok');
  assert.ok(receipt.length < 1500);
  assert.match(receipt, /ref: results\/r\d{6}\.txt/);
  assert.match(receipt, /partial|omitted/);
  const ref = /ref: (results\/[^\s]+)/.exec(receipt)![1];
  assert.equal(w.read(ref), body);
  assert.equal(w.receipt(body, 'ok'), receipt);
  // A second distinct body gets the next short name; a fresh Workspace on the same root keeps the numbering.
  assert.match(w.receipt(body + '\nmore', 'ok'), /ref: results\/r000002\.txt/);
  assert.equal(new Workspace(join(w.root, '..')).receipt(body, 'ok'), receipt);
  assert.match(new Workspace(join(w.root, '..')).receipt(body + '\nthird', 'ok'), /ref: results\/r000003\.txt/);
  const read = w.fileTools().find(t => t.name === 'read')!;
  const recovered = await read.execute('readback', { path: ref, offset: 41, limit: 1 }, undefined, undefined, {} as any);
  assert.equal(recovered.content[0].text.split('\n')[0], 'COUNTEREXAMPLE_MIDDLE_EXACT');
  assert.equal(w.receipt('short', 'ok'), 'short');
});

test('short result IDs survive restart and concurrent workspace owners without rewriting evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'receipt-ids-'));
  const a = new Workspace(root), b = new Workspace(root);
  const x = 'alpha\n'.repeat(600), y = 'beta\n'.repeat(600);
  const ref = (receipt: string) => /ref: (results\/[^\s]+)/.exec(receipt)![1];
  const ax = ref(a.receipt(x)), by = ref(b.receipt(y));
  assert.notEqual(ax, by);
  assert.equal(ref(new Workspace(root).receipt(x)), ax);
  assert.equal(a.read(ax), x); assert.equal(b.read(by), y);
  // A lost index is recoverable from immutable files, IDs and exact hashes.
  writeFileSync(join(root, '.harness', 'result-index.jsonl'), 'incomplete');
  assert.equal(ref(new Workspace(root).receipt(x)), ax);
  const old = 'results/' + 'a'.repeat(64) + '.txt'; a.runtimeWrite(old, 'old evidence');
  assert.equal(new Workspace(root).read(old), 'old evidence');
});

test('receipt marks a partial single line and an explicit configurable inline threshold', () => {
  const root = mkdtempSync(join(tmpdir(), 'receipt-preview-'));
  const w = new Workspace(root);
  const body = 'head\n' + 'middle'.repeat(350) + '\ntail';
  assert.match(w.receipt(body), /tail/);
  assert.match(w.receipt(body), /omitted|partial/);
  assert.equal(new Workspace(root, {inlineChars:3000}).receipt(body), body);
});
