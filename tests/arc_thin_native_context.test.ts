import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryFields, clipEnds, collapseRepeatedCalls, freezeHistory, projectNativeHistory, summarizeHistory, visibleActions } from '../demo/arc_thin_native_context.ts';
import {readFileSync} from 'node:fs';

test('native production instructions prefer reuse and evidence-led applicability without a creation quota', () => {
  const prompt = readFileSync(new URL('../demo/prompts/arc_thin_native_system.md', import.meta.url), 'utf8');
  assert.match(prompt, /Reuse your saved components before re-deriving or rewriting anything/);
  assert.match(prompt, /applicability on current evidence/);
});

test('Self Task prompt exposes the short path for each reusable component category without requiring a save', () => {
  const prompt = readFileSync(new URL('../demo/prompts/arc_thin_self_baseline.md', import.meta.url), 'utf8');
  for (const path of ['prompts/strategy.md', 'skills/method/SKILL.md', 'tools/helper.py', 'agents/helper.md'])
    assert.ok(prompt.includes(path), `missing Task path ${path}`);
  assert.match(prompt, /briefly consider each kind and Skip any without it/i);
  assert.match(prompt, /No component is required\./);
  assert.match(prompt, /check the active component index before recreating work/i);
  assert.match(prompt, /At the next related solving decision, first read the relevant skill or call the saved tool with current state\/arguments/i);
  assert.match(prompt, /If it does not apply, briefly skip it and act; if a trial fails, revise or retire it/i);
  assert.match(prompt, /The live grid is `state\["grid"\]`/);
  assert.match(prompt, /After a KeyError.*stop repeating that failed probe/i);
  assert.match(prompt, /Do not repeat an equivalent Python probe/i);
  assert.match(prompt, /After a probe and one feedback confirm the same effect or displacement rule/i);
  assert.match(prompt, /Do not spend another decision re-proving the confirmed effect just to earn permission to batch/i);
  assert.match(prompt, /3.7 predictable actions total, including the first action/i);
  assert.match(prompt, /If an intermediate result could change the next action, submit one action and check it first/i);

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
  // The two newest results are shown in full except that a line of dumped data (over 400 characters) is a one-line stub
  // (2026-10-14, pr-01); older ones keep their first line, clipped.
  for (const n of [29, 28]) assert.ok(all.text.includes(`[line 1: 1008 chars not shown; starts "EXACT ${n}${'Z'.repeat(70)}`), String(n));
  assert.match(all.text, /→ EXACT 27Z{192}… <1008 chars>/);
  assert.match(all.text, /said: walking the corridor\nwalk\(\{"args":\{"steps":2\}\}\) → walk v1 →\n#7 ACTION1 → changed 3\n#8 ACTION4 → changed 0/);
  // Long arguments are clipped.
  assert.match(all.text, /python\(\{"code":"print\(5\)\\n#+… <\d+ chars>\)/);
  // The budget keeps the newest decisions and says where the rest lives; one oversized decision does not empty it.
  const tight = summarizeHistory(history, { budget: 3000 });
  assert.ok(tight.decisions >= 2 && tight.decisions < 30 && tight.omitted === 30 - tight.decisions);
  assert.match(tight.text, /older not shown: memory, your prompts and tools, data\/trajectory\.jsonl/);
  assert.ok(tight.text.includes('EXACT 29') && !tight.text.includes('EXACT 0Z'));
  // An oversized decision of short lines (one line of dumped data would be a stub) is clipped, not dropped.
  const lines = decisions(3).map(m => m.role === 'toolResult'
    ? { ...m, content: [{ type: 'text', text: `${m.content[0].text.slice(0, 7)}\n` + ('Z'.repeat(99) + '\n').repeat(500) }] } : m);
  const huge = summarizeHistory(lines, { budget: 3000, resultChars: 40_000 });
  assert.equal(huge.decisions, 1);
  assert.ok(huge.text.includes('EXACT 2') && huge.text.length < 3300);
  assert.deepEqual(summarizeHistory([{ role: 'user', content: 'first decision' }]), { text: '', decisions: 0, omitted: 0 });
});

test('visible actions are read from action receipts in the summary', () => {
  const seen = visibleActions('arc_action({"action":"ACTION1"}) → #12 ACTION1 → level_changed=false\n#13 ACTION4 → changed 2\n' +
    'python({}) → #14 not an action\nsaid: #15 ACTION1 later');
  assert.deepEqual([...seen], [12, 13]);
});

test('a long result keeps its start and its end, receipts from the middle, and where the whole text is', () => {
  // pilot-01: a dumped grid filled the head-only clip and the diffs printed after it were lost.
  const body = 'STATE ' + '[0, 0, 5, 5], '.repeat(600) + '\n#4 ACTION2 → changed 3\n' + 'D'.repeat(6000) + '\nDIFF 52 cells at (10,12)';
  const saved: string[] = [];
  const shown = clipEnds(body, 5000, text => { saved.push(text); return 'results/r7.txt'; });
  assert.ok(shown.length < 5300, String(shown.length));
  const at = body.indexOf('#4 ACTION2');
  assert.ok(at > 1500 && at < body.length - 3500, 'the receipt is from the omitted middle');
  assert.ok(shown.startsWith('STATE [0, 0, 5, 5]') && shown.endsWith('DIFF 52 cells at (10,12)'));
  assert.match(shown, /… <\d+ of \d+ chars omitted; full: results\/r7\.txt> …\n#4 ACTION2 → changed 3\n/);
  assert.deepEqual(saved, [body]);
  assert.equal(clipEnds('short', 5000, () => { throw Error('not saved'); }), 'short');
  // The summary uses it for the newest results.
  const history = [{ role: 'user', content: 'decision 0' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'python', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'a', toolName: 'python', content: [{ type: 'text', text: body }] },
    { role: 'user', content: 'decision 1' }];
  assert.ok(summarizeHistory(history, { budget: 100_000 }).text.includes('DIFF 52 cells'));
});

test('earlier decisions are a frozen transcript: no reasoning or images, results clipped, same bytes on every request', () => {
  const history = decisions(3, 9000);
  history[2] = { role: 'user', content: [{ type: 'text', text: 'decision 0' }, { type: 'image', data: 'png' }] };
  let saves = 0;
  const save = () => { saves++; return 'results/r1.txt'; };
  const frozen = freezeHistory(history, { save });
  assert.equal(frozen.filter(m => m.role === 'user').length, 3);
  assert.equal(JSON.stringify(frozen).includes('secret reasoning'), false);
  assert.equal(JSON.stringify(frozen).includes('"image"'), false);
  const results = frozen.filter(m => m.role === 'toolResult').map(m => m.content[0].text);
  // Each result is one 9,007-character line of data: a stub that says where the whole result is.
  assert.ok(results.every(text => text.length < 5300 && text.startsWith('[line 1: 9007 chars not shown; starts "EXACT') && text.includes('results/r1.txt')),
    results.map(t => t.length).join());
  assert.equal(saves, 3);
  // A later request sees the same earlier decisions plus one more; the shared part is unchanged.
  const later = freezeHistory([...history, { role: 'user', content: 'decision 3' }], { save });
  assert.deepEqual(later.slice(0, frozen.length), frozen);
  assert.equal(JSON.stringify(history).includes('secret reasoning'), true, 'canonical history is immutable');
});

test('rounds that repeated the same calls show once with their count; receipts of the results left out are kept', () => {
  // su15-r1-B2 (2026-10-16): one python call 20 times in a row; the gateway refused every request that carried them.
  const round = (id: string, args: any, text: string, name = 'python') => [
    { role: 'assistant', content: [{ type: 'text', text: `try ${id}` }, { type: 'toolCall', id, name, arguments: args }] },
    { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }] }];
  const same = [{ role: 'user', content: 'decision 1' },
    ...Array.from({ length: 5 }, (_, i) => round(`p${i}`, { code: "print('same')" }, 'same')).flat()];
  const collapsed = collapseRepeatedCalls(same);
  assert.equal(collapsed.length, 3);
  assert.equal(collapsed[1].content[1].id, 'p4', 'the last round is kept');
  assert.equal(collapsed[2].toolCallId, 'p4', 'the result answers the call that is kept');
  assert.equal(collapsed[2].content[0].text, "(This call was made 5 times in a row; every result was the same:)\nsame");
  // Acting calls whose results differ: the last result, and the earlier action receipts (the record of what was played).
  const acting = [{ role: 'user', content: 'decision 2' },
    ...round('a0', { code: 'act()', x: 1 }, 'moved\n#4 ACTION1 → changed=2'),
    ...round('a1', { x: 1, code: 'act()' }, 'moved\n#5 ACTION1 → changed=2'),
    ...round('a2', { code: 'act()', x: 1 }, 'moved\n#6 ACTION1 → changed=3')];
  const played = collapseRepeatedCalls(acting);
  assert.equal(played.length, 3, 'arguments compare whatever their key order');
  assert.equal(played[2].content[0].text, '(This call was made 3 times in a row; 2 earlier results are not shown; their action receipts:\n' +
    '#4 ACTION1 → changed=2\n#5 ACTION1 → changed=2\nThe last result:)\nmoved\n#6 ACTION1 → changed=3');
  // A refused call is not a repeat of one that ran (B2's calls 17-20 hit the decision's call cap): two rounds remain.
  const refusedRound = (id: string) => [
    { role: 'assistant', content: [{ type: 'toolCall', id, name: 'python', arguments: { code: "print('same')" } }] },
    { role: 'toolResult', toolCallId: id, toolName: 'python', isError: true, content: [{ type: 'text', text: 'this call was NOT run' }] }];
  const capped = collapseRepeatedCalls([...same, ...refusedRound('q0'), ...refusedRound('q1')]);
  assert.deepEqual(capped.filter(m => m.role === 'toolResult').map(m => m.content[0].text), [
    "(This call was made 5 times in a row; every result was the same:)\nsame",
    '(This call was made 2 times in a row; every result was the same:)\nthis call was NOT run']);
  // A run goes on across decision prompts and messages without calls, which stay in place (su15-l0-1, 2026-10-17: the
  // gateway counts identical calls across prompts). A different call or a message of another kind ends it; single
  // rounds are untouched.
  const across = [{ role: 'user', content: 'decision 3' }, ...round('s0', { code: 'x' }, '#7 ACTION3 → changed=1'),
    { role: 'user', content: 'decision 4' }, ...round('s1', { code: 'x' }, '#8 ACTION3 → changed=1'),
    { role: 'assistant', content: [{ type: 'text', text: 'thinking aloud' }] }, ...round('s2', { code: 'x' }, '#9 ACTION3 → changed=1'),
    ...round('s3', { code: 'y' }, 'r')];
  const merged = collapseRepeatedCalls(across);
  assert.deepEqual(merged.map(m => m.role), ['user', 'user', 'assistant', 'assistant', 'toolResult', 'assistant', 'toolResult']);
  assert.equal(merged[3].content[1].id, 's2');
  assert.equal(merged[4].content[0].text, '(This call was made 3 times in a row, in 2 decisions; 2 earlier results are not shown; ' +
    'their action receipts:\n#7 ACTION3 → changed=1\n#8 ACTION3 → changed=1\nThe last result:)\n#9 ACTION3 → changed=1');
  assert.deepEqual(merged.slice(5), across.slice(-2));
  const ended = [...round('t0', { code: 'x' }, 'r'), { role: 'compactionSummary', summary: 'earlier' }, ...round('t1', { code: 'x' }, 'r')];
  assert.deepEqual(collapseRepeatedCalls(ended), ended);
  // In the frozen transcript by default; collapseRepeats: false keeps every copy. A finished decision keeps its bytes.
  const history = [...same, { role: 'user', content: 'decision 2' }];
  assert.equal(freezeHistory(history).filter(m => m.role === 'toolResult').length, 1);
  assert.equal(freezeHistory(history, { collapseRepeats: false }).filter(m => m.role === 'toolResult').length, 5);
  assert.deepEqual(freezeHistory([...history, ...round('n0', { code: 'z' }, 'r')]).slice(0, 4), freezeHistory(history).slice(0, 4));
  // Unless its run of repeated calls goes on: then it changes from where the run ended before.
  const grown = freezeHistory([...history, ...round('p5', { code: "print('same')" }, 'same'), { role: 'user', content: 'decision 3' }]);
  assert.deepEqual(grown.slice(0, 1), freezeHistory(history).slice(0, 1));
  assert.deepEqual(grown.map(m => m.role), ['user', 'user', 'assistant', 'toolResult', 'user']);
  assert.equal(grown[3].content[0].text, "(This call was made 6 times in a row, in 2 decisions; every result was the same:)\nsame");
});

test('a tool-calling message with no short fields is told so once, on the result, without rewriting earlier rounds', () => {
  // ls20-r01 measured carry_blocks=0 over 21 assistant messages: the model answered with reasoning and a call and
  // never a <carry> block, so "fields" mode replayed nothing and the stored response was the only continuity.
  const round = (i: number, carry?: string) => ([
    { role: 'assistant', content: [{ type: 'thinking', thinking: `derivation ${i}${carry ? ` <carry>${carry}</carry>` : ''}` },
      { type: 'toolCall', id: `c${i}`, name: 'python' }] },
    { role: 'toolResult', toolCallId: `c${i}`, content: [{ type: 'text', text: `result ${i}` }] }]);
  const messages: any[] = [{ role: 'user', content: 'DECIDE' }, ...round(0), ...round(1), ...round(2)];
  const projected = carryFields(messages);
  const reminders = projected.filter(m => JSON.stringify(m).includes('carry-missing'));
  assert.equal(reminders.length, 1, 'one probe per projection, not a reminder on every result');
  assert.equal(reminders[0].toolCallId, 'c0', 'the gap is reported on the result of the message that left it');
  assert.doesNotMatch(JSON.stringify(projected), /derivation/, 'the reminder does not bring reasoning prose back');

  // Append-only: each later request must start with the previous one byte for byte, or the stored response the
  // continuation stands on no longer matches its verified local prefix.
  let previous = '';
  for (let i = 1; i <= 3; i++) {
    const snapshot = JSON.stringify(carryFields(messages.slice(0, 1 + 2 * i))).slice(0, -1);
    assert.ok(snapshot.startsWith(previous), `request ${i} rewrote an earlier message`);
    previous = snapshot;
  }

  // A model that does write the block gets it carried and is not reminded at all.
  const writes: any[] = [{ role: 'user', content: 'DECIDE' }, ...round(0, 'probe: press ACTION1'), ...round(1, 'probe: press ACTION2')];
  const kept = JSON.stringify(carryFields(writes));
  assert.doesNotMatch(kept, /carry-missing/);
  assert.match(kept, /probe: press ACTION1/);
  assert.match(kept, /probe: press ACTION2/);
});

test('the native instructions state what a prediction is for, which the native foundation had left unsaid', () => {
  // ls20-r01 and ls20-r02 played 29 and 7 actions with prediction hits=0 and misses=0: the agent moved its acting
  // into env.act and stopped predicting, so nothing was scored, no hypothesis check was tested and no judgment was
  // promoted. The legacy prompt states the contract; the native one mentioned predict only as a parameter name.
  const prompt = readFileSync(new URL('../demo/prompts/arc_thin_native_system.md', import.meta.url), 'utf8');
  // Where predict goes depends on the action tool (a then list, or CH's action list under ARC_THIN_OBSERVATION=ch).
  assert.match(prompt, /predict carries it, \{\{predict_on\}\}\. That is what gets scored, what a hypothesis check is tested against/);
  assert.match(prompt, /\{\{list_stop\}\} stops at the first missed prediction/);
  assert.match(prompt, /level or WIN transition, predict it explicitly/);
});
