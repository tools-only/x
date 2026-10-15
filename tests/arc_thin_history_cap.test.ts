import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundHistory, callChars, sentChars } from '../demo/arc_thin_native_context.ts';

/** Decision d: its prompt, one call with arguments, the call's result. */
const decision = (d: number, size = 100) => [
  { role: 'user', content: [{ type: 'text', text: `DECISION_${d} ` + 'h'.repeat(size) }] },
  { role: 'assistant', content: [{ type: 'toolCall', id: `c${d}`, name: 'python', arguments: { code: 'x'.repeat(size) } }] },
  { role: 'toolResult', toolCallId: `c${d}`, toolName: 'python', content: [{ type: 'text', text: `#${d + 1} ACTION1 → changed=1` }] },
];
const decisions = (n: number, size = 100) => Array.from({ length: n }, (_, d) => decision(d, size)).flat();
const paired = (messages: any[]) => {
  const calls = messages.flatMap((m) => m.role === 'assistant' ? m.content.filter((b: any) => b.type === 'toolCall').map((b: any) => b.id) : []);
  return JSON.stringify(calls) === JSON.stringify(messages.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId));
};

test('unset limits keep the transcript exactly as it is', () => {
  const messages = decisions(4);
  const out = boundHistory(messages);
  assert.equal(out.messages, messages);
  assert.deepEqual([out.kept, out.dropped, out.oversize], [4, 0, false]);
  assert.equal(boundHistory(messages, { decisions: 0, maxChars: 0 }).messages, messages);
});

test('the newest decisions are kept whole, the oldest dropped first, and the first kept prompt says where the rest is', () => {
  const out = boundHistory(decisions(10), { decisions: 6 });
  assert.deepEqual([out.kept, out.dropped, out.oversize], [6, 4, false]);
  const text = JSON.stringify(out.messages);
  assert.doesNotMatch(text, /DECISION_3 /);
  assert.match(text, /DECISION_4 /);
  assert.match(out.messages[0].content[0].text, /^\(4 earlier decisions are not shown here: data\/trajectory\.jsonl, data\/frames\/, results\/ and data\/memory\.md hold their record\.\)$/);
  assert.match(out.messages[0].content[1].text, /^DECISION_4 /);
  assert.ok(paired(out.messages), 'every call keeps its result');
});

test('the character limit counts call arguments and holds, the note aside', () => {
  const messages = decisions(10, 1000);
  assert.ok(callChars(messages[1]) > 1000 && sentChars(messages[1]) === callChars(messages[1]));
  const one = messages.slice(0, 3).reduce((n, m) => n + sentChars(m), 0);
  const out = boundHistory(messages, { maxChars: 3 * one + 10 });
  assert.equal(out.kept, 3);
  assert.ok(out.chars - out.messages[0].content[0].text.length <= 3 * one + 10, String(out.chars));
  assert.ok(paired(out.messages));
});

test('the newest decision is kept even when it alone is over the limit', () => {
  const out = boundHistory([...decisions(3), ...decision(3, 50_000)], { maxChars: 10_000 });
  assert.deepEqual([out.kept, out.dropped, out.oversize], [1, 3, true]);
  assert.match(JSON.stringify(out.messages), /DECISION_3 /);
});

test('a length recovery belongs to the decision it continues', () => {
  const messages = decisions(3);
  messages.splice(6, 0, { role: 'user', content: [{ type: 'text', text: 'RECOVER ACTION: continue the decision' }] } as any);
  const out = boundHistory(messages, { decisions: 2 });
  assert.deepEqual([out.kept, out.dropped], [2, 1]);
  const text = JSON.stringify(out.messages);
  assert.match(text, /DECISION_1 /);
  assert.match(text, /RECOVER ACTION/);
});

test('a compaction summary in front stays, and the same input gives the same bytes', () => {
  const messages = [{ role: 'compactionSummary', summary: 'SUMMARY', timestamp: 1 }, ...decisions(5)];
  const out = boundHistory(messages, { decisions: 2 });
  assert.equal(out.messages[0].role, 'compactionSummary');
  assert.deepEqual([out.kept, out.dropped], [2, 3]);
  assert.equal(JSON.stringify(boundHistory(messages, { decisions: 2 })), JSON.stringify(out));
});
