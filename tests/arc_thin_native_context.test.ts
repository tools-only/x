import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeHistory } from '../demo/arc_thin_native_context.ts';
import {readFileSync} from 'node:fs';

test('native production instructions explicitly prefer amortized offload without a creation quota', () => {
  const prompt = readFileSync(new URL('../demo/prompts/arc_thin_native_system.md', import.meta.url), 'utf8');
  assert.match(prompt, /Prefer suitable existing harness components/);
  assert.match(prompt, /creation and checking cost/);
  assert.match(prompt, /current evidence to check applicability/);
});

test('native projection retains all decisions and exact results, strips thinking, pairs aborted calls', () => {
  const history: any[] = [{ role: 'system', sections: { preamble: 'base' } },
    { role: 'compactionSummary', content: 'refuted H0' }];
  for (let n = 0; n < 12; n++) history.push({ role: 'user', content: `decision ${n}` },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret reasoning' },
      { type: 'toolCall', id: String(n), name: 'compare', arguments: { x: n } }] },
    { role: 'toolResult', toolCallId: String(n), content: [{ type: 'text', text: `EXACT ${n}` + 'Z'.repeat(1000) }] });
  history.push({ role: 'assistant', content: [{ type: 'toolCall', id: 'aborted', name: 'compare' }] },
    { role: 'toolResult', toolCallId: 'orphan', content: [{ type: 'text', text: 'orphan' }] });
  const projected = projectNativeHistory(history);
  assert.equal(projected.filter(m => m.role === 'user').length, 12);
  assert.equal(projected.filter(m => m.role === 'toolResult').length, 12);
  assert.equal(JSON.stringify(projected).includes('secret reasoning'), false);
  assert.equal(JSON.stringify(projected).includes('aborted'), false);
  assert.equal(JSON.stringify(projected).includes('orphan'), false);
  assert.deepEqual(projected[0], history[0]);
  assert.deepEqual(projected[projected.length - 1], history[37]);
  assert.equal(JSON.stringify(projectNativeHistory(history, true)).includes('secret reasoning'), true);
  assert.equal(JSON.stringify(history).includes('aborted'), true, 'canonical history is immutable');
});
