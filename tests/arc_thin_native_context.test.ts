import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeHistory, summarizeHistory, visibleActions } from '../demo/arc_thin_native_context.ts';
import {readFileSync} from 'node:fs';

test('native production instructions explicitly prefer amortized offload without a creation quota', () => {
  const prompt = readFileSync(new URL('../demo/prompts/arc_thin_native_system.md', import.meta.url), 'utf8');
  assert.match(prompt, /Reuse your saved components/);
  assert.match(prompt, /creation and checking cost/);
  assert.match(prompt, /applicability on current evidence/);
});

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

test('earlier decisions are one summarised section: newest results whole, older ones a line, action receipts kept', () => {
  const history = decisions(30);
  // An acting tool call in decision 3: its receipts are kept even when the result is old.
  history.splice(history.findIndex(m => m.content === 'decision 4'), 0,
    { role: 'assistant', content: [{ type: 'text', text: 'walking the corridor' }, { type: 'toolCall', id: 'walk', name: 'walk', arguments: { args: { steps: 2 } } }] },
    { role: 'toolResult', toolCallId: 'walk', toolName: 'walk', content: [{ type: 'text', text: 'walk v1 →\n[3, 0]\nACTED 2 action(s). This decision ends.\n#7 ACTION1 → changed 3\n#8 ACTION4 → changed 0' }] });
  const all = summarizeHistory(history, { budget: 1_000_000 });
  assert.equal(all.decisions, 30);
  assert.equal(all.omitted, 0);
  assert.match(all.text, /^RECENT HISTORY \(your last 30 decisions, summarised, newest last\):/);
  assert.equal(all.text.includes('secret reasoning'), false);
  // The two newest results are whole; older ones keep their first line, clipped.
  assert.ok(all.text.includes('EXACT 29' + 'Z'.repeat(1000)) && all.text.includes('EXACT 28' + 'Z'.repeat(1000)));
  assert.match(all.text, /→ EXACT 27Z{192}… <1008 chars>/);
  assert.match(all.text, /said: walking the corridor\nwalk\(\{"args":\{"steps":2\}\}\) → walk v1 →\n#7 ACTION1 → changed 3\n#8 ACTION4 → changed 0/);
  // Long arguments are clipped.
  assert.match(all.text, /python\(\{"code":"print\(5\)\\n#+… <\d+ chars>\)/);
  // The budget keeps the newest decisions and says where the rest lives; one oversized decision does not empty it.
  const tight = summarizeHistory(history, { budget: 3000 });
  assert.ok(tight.decisions >= 2 && tight.decisions < 30 && tight.omitted === 30 - tight.decisions);
  assert.match(tight.text, /older not shown: memory, your prompts and tools, data\/trajectory\.jsonl/);
  assert.ok(tight.text.includes('EXACT 29') && !tight.text.includes('EXACT 0Z'));
  const huge = summarizeHistory(decisions(3, 50_000), { budget: 3000, resultChars: 40_000 });
  assert.equal(huge.decisions, 1);
  assert.ok(huge.text.includes('EXACT 2') && huge.text.length < 3300);
  assert.deepEqual(summarizeHistory([{ role: 'user', content: 'first decision' }]), { text: '', decisions: 0, omitted: 0 });
});

test('visible actions are read from action receipts in the summary', () => {
  const seen = visibleActions('arc_action({"action":"ACTION1"}) → #12 ACTION1 → level_changed=false\n#13 ACTION4 → changed 2\n' +
    'python({}) → #14 not an action\nsaid: #15 ACTION1 later');
  assert.deepEqual([...seen], [12, 13]);
});
