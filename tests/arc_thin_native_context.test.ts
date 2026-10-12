import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeHistory, visibleActions } from '../demo/arc_thin_native_context.ts';

function decisions(count: number, resultChars = 1000): any[] {
  const history: any[] = [{ role: 'system', sections: { preamble: 'base' } },
    { role: 'compactionSummary', content: 'refuted H0' }];
  for (let n = 0; n < count; n++) history.push({ role: 'user', content: `decision ${n}` },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret reasoning' },
      { type: 'toolCall', id: String(n), name: 'python', arguments: { code: `print(${n})\n` + '#'.repeat(600) } }] },
    { role: 'toolResult', toolCallId: String(n), toolName: 'python', content: [{ type: 'text', text: `EXACT ${n}` + 'Z'.repeat(resultChars) }] });
  return history;
}

test('canonical native projection retains all decisions and exact results, strips thinking, pairs aborted calls', () => {
  const history = decisions(12);
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

test('banded projection keeps newest decisions exact, condenses the middle, drops the oldest with a note', () => {
  // 30 decisions: the last is the current one, 29 earlier.
  const history = decisions(30);
  const projected = projectNativeHistory(history, false, { verbatim: 4, condensed: 8 });
  const users = projected.filter(m => m.role === 'user');
  const text = (m: any) => typeof m.content === 'string' ? m.content : m.content.map((b: any) => b.text ?? '').join('\n');
  // Earlier 29: condensed from step(25)=24, dropped before step(17)=16 → 8 condensed, 5 verbatim, plus the current.
  assert.equal(users.length, 8 + 5 + 1);
  assert.match(text(users[0]), /16 earlier decisions not shown/);
  assert.match(text(users[0]), /The 8 decisions from here are condensed/);
  assert.match(text(users[0]), /decision 16$/);
  assert.equal(projected[0].role, 'system');
  assert.equal(projected[1].role, 'compactionSummary');
  const results = projected.filter(m => m.role === 'toolResult');
  assert.equal(results.length, 14);
  for (const result of results.slice(0, 8)) assert.ok(text(result).length < 360, 'condensed results are clipped');
  for (const result of results.slice(8)) assert.ok(text(result).length > 1000, 'newest results are exact');
  const calls = projected.filter(m => m.role === 'assistant').flatMap(m => m.content);
  assert.match(calls[0].arguments.code, /^print\(16\)\n#+… <\d+ chars>$/);
  assert.equal(calls.at(-1).arguments.code.length > 600, true);
  // Calls and results stay paired.
  const ids = new Set(calls.map((b: any) => b.id));
  assert.ok(results.every(r => ids.has(r.toolCallId)));
  assert.equal(JSON.stringify(projected).includes('secret reasoning'), false);
});

test('band edges move in steps, so the shown prefix is stable between steps', () => {
  const at = (count: number) => JSON.stringify(projectNativeHistory(decisions(count), false, { verbatim: 4, condensed: 8 }).slice(0, 6));
  assert.equal(at(26), at(27));
  assert.equal(at(27), at(28));
  // Under one step of earlier decisions past the verbatim band nothing is condensed.
  const short = projectNativeHistory(decisions(8), false, { verbatim: 4, condensed: 8 });
  assert.equal(short.filter(m => m.role === 'toolResult').every(m => m.content[0].text.length > 1000), true);
  // Whole-file sized results keep their head once their decision is no longer the current one.
  const long = projectNativeHistory(decisions(6, 5000), false, { verbatim: 4, condensed: 8 }).filter(m => m.role === 'toolResult');
  assert.equal(long.length, 6);
  for (const result of long.slice(0, -1)) assert.match(result.content[0].text, /… <5007 chars; repeat the call for the rest>$/);
  assert.equal(long.at(-1).content[0].text.length, 5007);
  assert.equal(projectNativeHistory(decisions(6, 5000)).filter(m => m.role === 'toolResult').every(m => m.content[0].text.length === 5007), true);
});

test('visible actions are read from arc_action receipts', () => {
  const seen = visibleActions([
    { role: 'toolResult', toolName: 'arc_action', content: [{ type: 'text', text: '#12 ACTION1 → level_changed=false' }] },
    { role: 'toolResult', toolName: 'python', content: [{ type: 'text', text: '#13 not an action' }] },
    { role: 'toolResult', toolName: 'arc_action', content: [{ type: 'text', text: 'one arc_action per decision; refused' }] },
  ]);
  assert.deepEqual([...seen], [12]);
});
