import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../demo/arc_thin_workspace.ts';

test('long output receipt retains exact middle evidence behind a stable ranged read reference', async () => {
  const w = new Workspace(mkdtempSync(join(tmpdir(), 'receipts-')));
  const body = Array.from({ length: 80 }, (_, i) => i === 40 ? 'COUNTEREXAMPLE_MIDDLE_EXACT' : `line ${i}: ` + 'x'.repeat(80)).join('\n');
  const receipt = w.receipt(body, 'ok');
  assert.ok(receipt.length < 1500);
  assert.match(receipt, /saved as results\/r1\.txt/);
  const ref = /saved as (results\/[^\s;]+)/.exec(receipt)![1];
  assert.equal(w.read(ref), body);
  assert.equal(w.receipt(body, 'ok'), receipt);
  // A second distinct body gets the next short name; a fresh Workspace on the same root keeps the numbering.
  assert.match(w.receipt(body + '\nmore', 'ok'), /saved as results\/r2\.txt/);
  assert.equal(new Workspace(join(w.root, '..')).receipt(body, 'ok'), receipt);
  assert.match(new Workspace(join(w.root, '..')).receipt(body + '\nthird', 'ok'), /saved as results\/r3\.txt/);
  const read = w.fileTools().find(t => t.name === 'read')!;
  const recovered = await read.execute('readback', { path: ref, offset: 41, limit: 1 }, undefined, undefined, {} as any);
  assert.equal(recovered.content[0].text.split('\n')[0], 'COUNTEREXAMPLE_MIDDLE_EXACT');
  assert.equal(w.receipt('short', 'ok'), 'short');
});
