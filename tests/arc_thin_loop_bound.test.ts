/**
 * Loop-bound artifacts (docs/plans/2026-10-20-loop-bound-artifacts.md) in the native extension against an HTTP stand-in
 * for the bridge: saved code bound where it enters the decision (a view, a predictor), a review's test lines pinned as next
 * experiments, the call points (a refine point before acting, a consult before a review writes), the hidden-state signal
 * and the predictors' disagreement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';

/**
 * A 16x16 board: a click on (8,8) completes the first level, any other click toggles its cell, and ACTION1 toggles (0,0)
 * on every second press only (a count the board does not show).
 */
async function world() {
	let n = 0, levels = 0, presses = 0;
	const start = () => { const g = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0)); g[8][8] = 9; return g; };
	let grid = start();
	const apply = (action?: string, x?: number, y?: number) => {
		const before = grid.map((r) => [...r]);
		let changed = false;
		if (action === 'ACTION1') { presses += 1; if (presses % 2 === 0) grid[0][0] = grid[0][0] ? 0 : 4; }
		else if (levels === 0 && x === 8 && y === 8) { levels = 1; changed = true; grid = start(); grid[3][3] = 7; grid[8][8] = 0; }
		else if (x !== undefined && y !== undefined) grid[y][x] = grid[y][x] ? 0 : 5;
		n += 1;
		return { changed, cells: before.flatMap((r, i) => r.filter((c, j) => c !== grid[i][j])).length };
	};
	const body = (step?: { changed: boolean; cells: number }) => ({ frames: [grid], state: 'NOT_FINISHED', levels_completed: levels,
		agent_available_actions: ['RESET', 'ACTION1', 'ACTION6'], action_budget: { used: n, maximum: 200, total_used: n, total_maximum: null },
		observation_delta: { frame_available: true, changed_cells: step?.cells ?? 0, cells: [] }, public_transition: { level_changed: Boolean(step?.changed) } });
	const server: Server = createServer((req, res) => {
		let text = ''; req.on('data', (chunk) => text += chunk); req.on('end', () => {
			const call = req.url === '/action' ? JSON.parse(text || '{}') : undefined;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(body(call ? apply(call.action, call.x, call.y) : undefined)));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, root: mkdtempSync(join(tmpdir(), 'loop-bound-')) };
}

/** One extension instance. Model calls are answered at once: a consult with `answer`, a refinement with NONE. */
async function attach(w: { url: string; root: string }, env: Record<string, string> = {}, answer = 'Clicks next to the marked cell were never tried.') {
	const saved = { ...process.env };
	Object.assign(process.env, { ARC_RUN_ROOT: w.root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment', PI_ARC_BRIDGE_URL: w.url,
		ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled', ARC_REFINE_EVERY: '1000', ARC_REFINE_GOAL_TEST_AFTER: '1000',
		ARC_REFINE_UNCHECKED_AFTER: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ...env });
	const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
	arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
		getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
		getThinkingLevel: () => 'off' } as any);
	const consulted: string[] = [];
	const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 10, output: 5 } });
	const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'] }, modelRegistry: {
		getApiKeyAndHeaders: async () => ({ apiKey: 'k', headers: {} }),
		streamSimple: (_model: any, context: any) => {
			const consult = String(context.systemPrompt ?? '').startsWith('CONSULT_ROLE');
			if (consult) consulted.push(JSON.stringify(context.messages[0].content));
			return { result: async () => reply(consult ? answer : 'NONE') };
		} } };
	await handlers.get('session_start')({}, ctx);
	let sections: Record<string, string> = {};
	const text = (result: any) => (result.content ?? []).map((b: any) => b.text ?? '').join('\n');
	const call = async (name: string, params: any) => {
		const tool = tools.get(name);
		try { return text(await tool.execute('t', tool.prepareArguments ? tool.prepareArguments(params) : params, undefined, undefined, ctx)); }
		catch (error) { return `REFUSED: ${(error as Error).message}`; }
	};
	const head = async (prompt: string) => (await handlers.get('context')({ messages: [{ role: 'user', content: prompt }] }, ctx)).messages[0]
		.content.map((b: any) => b.text ?? '').join('\n');
	return {
		consulted, sections: () => sections,
		file: (path: string) => existsSync(join(w.root, path)) ? readFileSync(join(w.root, path), 'utf8') : '',
		rows: (name: string) => existsSync(join(w.root, 'harness', name))
			? readFileSync(join(w.root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
		/** A new decision (or review): the runner's prompt, then the head the model receives. */
		async begin(prompt = 'Decide the next action.') {
			const event: any = { prompt, systemPromptOptions: { sections: {} } };
			await handlers.get('before_agent_start')(event, ctx);
			sections = event.systemPromptOptions.sections;
			return head(prompt);
		},
		/** The next request of the same decision: what was saved since is bound at its start. */
		request: (prompt = 'Decide the next action.') => head(prompt),
		act: (params: any) => call('arc_action', params),
		call,
		async close() {
			await new Promise((r) => setTimeout(r, 200));
			await handlers.get('session_shutdown')?.({}, ctx);
			for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
			Object.assign(process.env, saved);
		},
	};
}

const done = (w: { server: Server }) => new Promise<void>((r) => w.server.close(() => r()));

test('saved code that takes no args is a view, a predict(state, action) tool is scored at each action, and the index says what each did', async () => {
	const w = await world();
	const h = await attach(w);
	try {
		await h.begin();
		assert.match(await h.call('python', { code: '# Marked cells.\n[(x, y) for y, row in enumerate(grid) for x, v in enumerate(row) if v]', save: 'marks' }),
			/tools\/marks\.py → tool marks v1: saved · loaded/);
		assert.match(await h.call('python', { code: '"""Clicks change nothing but their cell."""\ndef predict(state, action):\n    return {"level_changed": False}\n',
			save: 'still' }), /tools\/still\.py → tool still v1: saved · loaded/);
		await h.request();
		assert.match(await h.act({ action: 'ACTION6', x: 1, y: 1 }), /\| tools\/still\.py v1 predicted: level_changed=false ok/);
		const head = await h.begin();
		assert.match(head, /tool marks v1 active: Marked cells\. · view, shown after each new state · ran \d+×, output changed \d+×/);
		assert.match(head, /tool still v1 active: Clicks change nothing but their cell\. · predictor, run at each action · 1 prediction\(s\), 1 right/);
		assert.match(head, /marks v1 state #1[^:]*: → \[\[1,1\],\[8,8\]\]/, 'the view shows its output with the state');
		assert.equal(h.rows('trajectory.jsonl')[0].predictors[0].path, 'tools/still.py');
		// A view whose output is the same on every state is a snapshot: after CONSTANT_VIEW_RUNS states only its head is shown.
		assert.match(await h.call('python', { code: '# The first frame.\n"level one: " + "x" * 300', save: 'first' }), /tools\/first\.py → tool first v1: saved · loaded/);
		for (let x = 2; x < 8; x += 1) { await h.begin(); await h.act({ action: 'ACTION6', x, y: 2 }); }
		const later = await h.begin();
		assert.match(later, /first v1 state #\d+ \(the same output on all \d+ states since #\d+: a snapshot, not a view of the state; "# view: off" makes it a tool you call\): → "level one: x+…/);
		assert.doesNotMatch(later, /marks v1 state #\d+ \(the same output/, 'a view whose output changes is shown in full');
	} finally { await h.close(); await done(w); }
});

test('a refine point: every REFINE_EVERY actions a decision acts only after refine(focus), which takes the scheduled refinement\'s place', async () => {
	const w = await world();
	const h = await attach(w, { ARC_REFINE_EVERY: '2' });
	try {
		await h.begin(); await h.act({ action: 'ACTION6', x: 1, y: 1 });
		assert.doesNotMatch(await h.begin(), /REFINE POINT/);
		await h.act({ action: 'ACTION6', x: 2, y: 2 });
		const head = await h.begin();
		assert.match(head, /^Decide the next action\.\n\nREFINE POINT \(every 2 actions; no refine call yet\): before acting, call refine\(focus\)/);
		assert.match(head, /\n- Last refinement: none yet\n- Ran without helping: nothing\n- Python redone on this level: none/);
		assert.match(await h.act({ action: 'ACTION6', x: 3, y: 3 }), /^REFUSED: this decision is a refine point/);
		assert.match(await h.call('python', { code: 'env.act("ACTION6", 3, 3)' }), /no action taken: this decision is a refine point/);
		assert.match(await h.call('refine', { focus: 'turn the marked-cell listing into a view' }), /Refinement started in the background|A refinement is running/);
		assert.match(await h.act({ action: 'ACTION6', x: 3, y: 3 }), /^#3 ACTION6\(3,3\)/);
		assert.doesNotMatch(await h.begin(), /REFINE POINT/, 'the next point is REFINE_EVERY actions after the call');
		assert.deepEqual(h.rows('call_points.jsonl').map((row) => [row.kind, row.at, row.point ?? null]), [['refine_point', 2, null], ['refine', 2, true]]);
		assert.ok(!h.rows('refiner.jsonl').some((row) => (row.triggers ?? []).some((t: string) => /actions since the last refinement/.test(t))),
			'no scheduled refinement of its own');
		assert.ok(h.rows('refiner.jsonl').some((row) => row.kind === 'start' && /^the agent asked: turn the marked-cell listing/.test(row.triggers?.[0] ?? '')));
	} finally { await h.close(); await done(w); }
});

test('a level review consults a subagent before it writes; its test lines are pinned one at a time as goal tests, each result said', async () => {
	const w = await world();
	const h = await attach(w);
	try {
		await h.begin(); await h.act({ action: 'ACTION6', x: 1, y: 1 });
		await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8 });
		const review = await h.begin('LEVEL REVIEW. Level 1 is complete; this turn takes no action.');
		assert.match(review, /^LEVEL REVIEW[^\n]*\n\nCONSULT FIRST \(every review\): [^\n]*You have none yet: first write agents\/<name>\.md/);
		const lessons = '---\nactive: true\n---\n1. Level 1 only: a click on the marked cell completed it.\n' +
			'- test: ACTION6(3,3) — the new marked cell completes the level\n- **test:** ACTION1 — the move key completes it\n' +
			'- test: a click near the corner — it completes the level\n';
		assert.match(await h.call('write', { path: 'prompts/lessons.md', content: lessons }), /^REFUSED: this review consults first/);
		assert.match(await h.call('memory', { op: 'set', key: 'win', text: 'the marked cell' }), /^REFUSED: this review consults first/);
		assert.match(await h.call('write', { path: 'agents/scout.md', content: '---\ndescription: reads a level record\ntools: [read]\n---\nSay what was never tried.\n' }),
			/agents\/scout\.md → subagent scout v1: saved · loaded/);
		await h.request('LEVEL REVIEW. Level 1 is complete; this turn takes no action.');
		assert.match(await h.call('consult', { agent: 'scout', question: 'What was never tried?', refs: ['data/record.md'] }), /Clicks next to the marked cell were never tried/);
		assert.match(h.consulted[0], /LEVEL 1 RECORD/, 'the subagent reads the record');
		const saved = await h.call('write', { path: 'prompts/lessons.md', content: lessons });
		assert.match(saved, /prompts\/lessons\.md → prompt lessons v1: saved · loaded/);
		assert.match(saved, /\nnote: 2 of 3 test lines will be pinned one at a time from your next decision; not pinned: "a click near the corner — it completes the level" names no move \(write ACTIONn, or ACTION6\(x,y\) for a click\)/);
		// The next decision: the first test is the strategy's next experiment and carries the level-change prediction.
		await h.begin();
		assert.match(h.file('workspace/prompts/strategy.md'),
			/- First: ACTION6\(3,3\); test 1 of 2 from prompts\/lessons\.md: the new marked cell completes the level \(predicts the level change\)/);
		assert.match(await h.act({ action: 'ACTION6', x: 3, y: 3 }), /\| predicted \(the pinned test's prediction\): level_changed=true MISS \(saw false\)/);
		const next = await h.begin();
		assert.match(next, /TEST RESULT \(prompts\/lessons\.md, test 1 of 2\): ACTION6\(3,3\), the new marked cell completes the level: played at #3: the level did not change, so its prediction missed\. Pinned next: ACTION1, test 2 of 2: the move key completes it\./);
		assert.match(h.file('workspace/prompts/strategy.md'), /- First: ACTION1; test 2 of 2 from prompts\/lessons\.md/);
		assert.doesNotMatch(h.file('workspace/prompts/strategy.md'), /ACTION6\(3,3\); test 1/);
		// A rewrite that keeps the played test does not pin it again.
		const rewrite = await h.call('write', { path: 'prompts/lessons.md', content: lessons + 'ACTION6(3,3) did not complete it.\n' });
		assert.match(rewrite, /\nnote: 1 of 3 test lines will be pinned [^\n]*; test 1, ACTION6\(3,3\): already played as a test on this level/);
		await h.begin();
		assert.match(h.file('workspace/prompts/strategy.md'), /- First: ACTION1; test 2 of 2 from prompts\/lessons\.md/);
		assert.doesNotMatch(h.file('workspace/prompts/strategy.md'), /ACTION6\(3,3\); test 1/);
		assert.deepEqual(h.rows('refiner.jsonl').filter((row) => row.kind === 'tests').map((row) => [row.version, row.count, row.played ?? 0]), [[1, 2, 0], [2, 2, 1]]);
		assert.deepEqual(h.rows('call_points.jsonl').map((row) => row.kind), ['consult_point', 'consult', 'consult_use']);
	} finally { await h.close(); await done(w); }
});

test('a review that has not saved its file by its last call may write it with one more call, and only it', async () => {
	// su15-lb-cb-q38 (2026-10-20): the consult and seven python calls used the review's ten; the write of lessons was refused.
	const w = await world();
	const h = await attach(w);
	try {
		await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8 });
		const REVIEW = 'LEVEL REVIEW. Level 1 is complete; this turn takes no action.';
		await h.begin(REVIEW);
		await h.call('write', { path: 'agents/scout.md', content: '---\ndescription: reads a level record\ntools: [read]\n---\nSay what was never tried.\n' });
		await h.request(REVIEW);
		assert.match(await h.call('consult', { agent: 'scout', question: 'What was never tried?', refs: ['data/record.md'] }), /never tried/);
		for (let i = 3; i < 10; i += 1) await h.call('python', { code: `${i}` });
		assert.match(await h.call('python', { code: '10' }),
			/\(This was tool call 10 of 10 for this review: finish now; one more call is accepted, the write of prompts\/lessons\.md\.\)/);
		assert.match(await h.call('write', { path: './prompts/lessons.md', content: '---\nactive: true\n---\n- test: ACTION6(3,3) — the new marked cell completes the level\n' }),
			/prompts\/lessons\.md → prompt lessons v1: saved · loaded/);
		assert.match(await h.call('write', { path: 'prompts/rules.md', content: '- one more\n' }), /this review used its 10 tool calls; it ends here/);
		await h.begin();
		assert.match(h.file('workspace/prompts/strategy.md'), /- First: ACTION6\(3,3\); test 1 of 1 from prompts\/lessons\.md/);
	} finally { await h.close(); await done(w); }
});

test('the same board and action with a different result is said in the receipt; two predictors that disagree pin the move that separates them', async () => {
	const w = await world();
	const h = await attach(w);
	try {
		await h.begin();
		assert.doesNotMatch(await h.act({ action: 'ACTION1' }), /different result/);
		await h.begin();
		assert.match(await h.act({ action: 'ACTION1' }),
			/\| the same board \(status cells aside\) and action at #1 gave a different result: something not on the board decides the outcome/);
		await h.begin();
		await h.call('python', { code: '"""ACTION1 leaves the corner."""\ndef predict(state, action):\n    return {"cells": [[0, 0, state["grid"][0][0]]]}\n', save: 'same' });
		await h.call('python', { code: '"""ACTION1 flips the corner."""\ndef predict(state, action):\n    return {"cells": [[0, 0, 0 if state["grid"][0][0] else 4]]}\n', save: 'flip' });
		await h.begin();
		assert.match(h.file('workspace/prompts/strategy.md'),
			/- First: ACTION1; your predictors disagree on it: tools\/flip\.py: \(0,0\)=0; tools\/same\.py: \(0,0\)=4/);
		const receipt = await h.act({ action: 'ACTION1' });
		assert.match(receipt, /\| tools\/flip\.py v1 predicted: cells=1 predicted value\(s\) \[1 as change\] MISS/);
		assert.match(receipt, /\| tools\/same\.py v1 predicted: cells=1 predicted value\(s\) \[0 as change\] ok/);
		assert.match(await h.begin(), /TEST RESULT \(predictor tools, test 1 of 1\): ACTION1, the predictors disagree .*: played at #3: the level did not change\./);
		assert.doesNotMatch(h.file('workspace/prompts/strategy.md'), /- First: ACTION1;/, 'a disagreement already tested is not pinned again');
	} finally { await h.close(); await done(w); }
});
