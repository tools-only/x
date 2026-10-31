import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import arcThinExtension from '../demo/arc_thin_extension.ts';
import { repairActionArguments } from '../demo/arc_thin_boundary.ts';
import { claimVersion } from '../demo/arc_thin_claims.ts';
import { levelRecord, type ReviewRow } from '../demo/arc_thin_level_review.ts';

// docs/plans/2026-10-20-level-review-lessons.md: the review after a level change, prompts/lessons.md, and the rule a
// refinement adds after a level change.

const row = (n: number, action: string, extra: Partial<ReviewRow> = {}): ReviewRow =>
	({ n, action, changed_cells: 2, level_changed: false, state: 'NOT_FINISHED', levels_completed: 0, ...extra });

test('the level record lists the level by attempt, the completing move, goal tests, hypotheses and repeats', () => {
	const check = 'def check(t):\n    return t["level_changed"]\n';
	const text = levelRecord({
		completed: 1,
		rows: [row(1, 'ACTION6', { x: 1, y: 1, changed_cells: 4 }), row(2, 'ACTION6', { x: 2, y: 2 }), row(3, 'RESET', { changed_cells: 10 }),
			row(4, 'ACTION6', { x: 1, y: 1, changed_cells: 4 }), row(5, 'ACTION6', { x: 2, y: 2 }), row(6, 'RESET', { changed_cells: 10 }),
			row(7, 'ACTION6', { x: 5, y: 5, changed_cells: 3, predict: { level_changed: true, text: 'the target ends it' } }),
			row(8, 'ACTION6', { x: 5, y: 5, changed_cells: 3 }),
			row(9, 'ACTION6', { x: 6, y: 6, changed_cells: 40, level_changed: true, levels_completed: 1, note: 'reach the target',
				predict: { level_changed: true }, bbox: { top: 0, left: 0, bottom: 15, right: 15 } }),
			row(10, 'ACTION6', { x: 1, y: 1, levels_completed: 1 })],
		memoryRows: [{ key: 'hyp.a', hyp: { claim: 'clicks move the block', status: 'open', check }, at: 0 },
			{ key: 'hyp.a', hyp: { claim: 'clicks move the block', status: 'rejected', check }, at: 6 },
			{ key: 'hyp.b', hyp: { claim: 'the target ends the level', status: 'open' }, at: 8, by: 'refinement' },
			{ key: 'hyp.c', hyp: { claim: 'a later belief', status: 'open' }, at: 12 }],
		checks: [{ key: 'hyp.a', version: claimVersion(check), n: 1, level: 0, result: true },
			{ key: 'hyp.a', version: claimVersion(check), n: 2, level: 0, result: false },
			{ key: 'hyp.a', version: claimVersion(check), n: 4, level: 0, result: false },
			{ key: 'hyp.a', version: claimVersion(check), n: 10, level: 1, result: true }],
		repeated: [5, 8, 12],
		python: [...[1, 2, 3].map(() => ({ kind: 'python', level: 0, shape: 's1', gist: 'g = grid' })),
			...[1, 2, 3, 4].map(() => ({ kind: 'python', level: 0, shape: 's0', gist: '' })), { kind: 'python', level: 1, shape: 's1', gist: 'g = grid' }],
	});
	assert.match(text, /^LEVEL 1 RECORD \(the level you just completed; level 2 is on screen now\)/);
	assert.match(text, /\n- #1–#9: 9 actions in 3 attempts; 2 RESETs; no GAME_OVER\.\n/);
	assert.match(text, /\n- Completed by #9 ACTION6\(6,6\), action 9 of the level: changed=40 in x0-15 y0-15; it predicted the level change; note: "reach the target"\.\n/);
	assert.match(text, /\n- Other moves that predicted a level change: #7 ACTION6\(5,5\) \("the target ends it"\)\.\n/);
	assert.match(text, /\n {2}- attempts 1–2, #1–#5: the same 2 moves each time, each ended by RESET: ACTION6\(1,1\)→4, ACTION6\(2,2\)→2\n/);
	assert.match(text, /\n {2}- attempt 3, #7–#9, 3 moves, completed the level: ACTION6\(5,5\)\*→3, ACTION6\(5,5\)→3, ACTION6\(6,6\)\*→40\n/);
	assert.match(text, /\n {2}- hyp\.a \(yours, written at #0\): "clicks move the block" → rejected at #6; its check on this level: holds 1, fails 2, n\/a 0\n/);
	assert.match(text, /\n {2}- hyp\.b \(a refinement's, written at #8\): "the target ends the level" → open when the level was completed; no check\n/);
	assert.doesNotMatch(text, /hyp\.c/, 'written after the level');
	assert.match(text, /\n- 2 moves gave the same result from the same state as an earlier move of their attempt: #5, #8\.\n/);
	assert.match(text, /\n- Python run again with the same code \(numbers aside\): cells with comments only ×4, `g = grid` ×3\.$/);
});

test('the record of the level being played (the stall review) has no completing move and gives its hypotheses as they stand now', () => {
	const text = levelRecord({
		completed: 2, ongoing: true,
		rows: [row(1, 'ACTION6', { x: 8, y: 8, level_changed: true, levels_completed: 1 }), row(2, 'ACTION6', { x: 1, y: 1, levels_completed: 1 }),
			row(3, 'ACTION6', { x: 1, y: 1, levels_completed: 1, state: 'GAME_OVER' }), row(4, 'RESET', { levels_completed: 1 }),
			row(5, 'ACTION6', { x: 2, y: 2, levels_completed: 1, predict: { level_changed: true } })],
		memoryRows: [{ key: 'hyp.a', hyp: { claim: 'the marked cell ends a level', status: 'open' }, at: 2 }],
	});
	assert.match(text, /^LEVEL 2 RECORD SO FAR \(the level on screen; it is not completed\)\./);
	assert.match(text, /\n- #2–#5: 4 actions in 2 attempts; 1 RESET; GAME_OVER at #3\.\n/);
	assert.doesNotMatch(text, /Completed by/);
	assert.match(text, /\n- Moves that predicted a level change: #5 ACTION6\(2,2\)\.\n/);
	assert.match(text, /\n {2}- attempt 1, #2–#3, 2 moves, ended in GAME_OVER: ACTION6\(1,1\)→2 ×2\n {2}- attempt 2, #5–#5, 1 move, not ended: ACTION6\(2,2\)\*→2\n/);
	assert.match(text, /\n {2}- hyp\.a \(yours, written at #2\): "the marked cell ends a level" → open now; no check$/);
});

/**
 * The native extension on a 16x16 board: a click on (8,8) completes the first level (the board changes), any other click
 * toggles its cell. Refinements wait until the test settles them.
 */
async function world() {
	let n = 0, levels = 0;
	const start = () => { const g = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0)); g[8][8] = 9; return g; };
	let grid = start();
	const apply = (x?: number, y?: number) => {
		const before = grid.map((r) => [...r]);
		let changed = false;
		if (levels === 0 && x === 8 && y === 8) { levels = 1; changed = true; grid = start(); grid[3][3] = 7; grid[8][8] = 0; }
		else if (x !== undefined && y !== undefined) grid[y][x] = grid[y][x] ? 0 : 5;
		n += 1;
		return { changed, cells: before.flatMap((r, i) => r.filter((c, j) => c !== grid[i][j])).length };
	};
	const body = (step?: { changed: boolean; cells: number }) => ({ frames: [grid], state: 'NOT_FINISHED', levels_completed: levels,
		agent_available_actions: ['RESET', 'ACTION6'], action_budget: { used: n, maximum: 200, total_used: n, total_maximum: null },
		observation_delta: { frame_available: true, changed_cells: step?.cells ?? 0, cells: [] }, public_transition: { level_changed: Boolean(step?.changed) } });
	const server: Server = createServer((req, res) => {
		let text = ''; req.on('data', (chunk) => text += chunk); req.on('end', () => {
			const call = req.url === '/action' ? JSON.parse(text || '{}') : undefined;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(body(call ? apply(call.x, call.y) : undefined)));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, root: mkdtempSync(join(tmpdir(), 'level-review-')) };
}

const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 100, output: 50 } });

/** One extension instance on `w` (a second one on the same world is a restart of the run). */
async function attach(w: { url: string; root: string }) {
	const saved = { ...process.env };
	// Only the events under test start refinements: no schedule, goal-test or unchecked-belief events. The reviews'
	// consult-first call point is tested in arc_thin_loop_bound.test.ts.
	Object.assign(process.env, { ARC_RUN_ROOT: w.root, ARC_THIN_FOUNDATION: 'native', ARC_THIN_VARIANT: 'treatment', PI_ARC_BRIDGE_URL: w.url,
		ARC_HARNESS_LEDGER: 'enabled', ARC_HARNESS_CRITIC: 'enabled', ARC_REFINE_EVERY: '1000', ARC_REFINE_GOAL_TEST_AFTER: '1000',
		ARC_REFINE_UNCHECKED_AFTER: '1000', ARC_THIN_NO_EFFECT_REPEATS: '0', ARC_THIN_REVIEW_CONSULT: '0' });
	const tools = new Map<string, any>(), handlers = new Map<string, any>(); let active: string[] = [];
	arcThinExtension({ registerTool: (t: any) => tools.set(t.name, t), setActiveTools: (v: string[]) => active = v,
		getActiveTools: () => active, getAllTools: () => [...tools.values()], on: (e: string, f: any) => handlers.set(e, f),
		getThinkingLevel: () => 'off' } as any);
	const inputs: string[] = [];
	const pending: Array<(value: any) => void> = [];
	const ctx: any = { model: { id: 'agent-model', provider: 'p', input: ['text'] }, modelRegistry: {
		streamSimple: (_model: any, context: any) => {
			inputs.push(context.messages[0].content[0].text);
			const settled = new Promise((resolve) => pending.push(resolve));
			return { result: () => settled };
		} } };
	await handlers.get('session_start')({}, ctx);
	let sections: Record<string, string> = {};
	const text = (result: any) => (result.content ?? []).map((b: any) => b.text ?? '').join('\n');
	const call = async (name: string, params: any) => text(await tools.get(name).execute('t', params, undefined, undefined, ctx));
	return {
		inputs, active: () => active, sections: () => sections,
		schema: (name: string) => tools.get(name)?.parameters,
		context: async (messages: any[]) => (await handlers.get('context')({ messages }, ctx)).messages,
		start: async (prompt: string) => handlers.get('before_agent_start')({ prompt, systemPromptOptions: { sections: {} } }, ctx),
		file: (path: string) => existsSync(join(w.root, path)) ? readFileSync(join(w.root, path), 'utf8') : '',
		rows: (name: string) => existsSync(join(w.root, 'harness', name))
			? readFileSync(join(w.root, 'harness', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
		async begin(prompt = 'Decide the next action.') {
			const event: any = { prompt, systemPromptOptions: { sections: {} } };
			await handlers.get('before_agent_start')(event, ctx);
			sections = event.systemPromptOptions.sections;
			const head = (await handlers.get('context')({ messages: [{ role: 'user', content: prompt }] }, ctx)).messages[0];
			return head.content.map((b: any) => b.text ?? '').join('\n');
		},
		act: (params: any) => call('arc_action', repairActionArguments(params)),
		call,
		async settle(value: any) { pending.shift()!(value); await new Promise((r) => setTimeout(r, 200)); },
		async calls(count: number) { for (let i = 0; i < 200 && inputs.length < count; i += 1) await new Promise((r) => setTimeout(r, 50)); },
		async close() {
			for (const resolve of pending.splice(0)) resolve(reply('NONE closing'));
			await new Promise((r) => setTimeout(r, 300));
			await handlers.get('session_shutdown')?.({}, ctx);
			for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
			Object.assign(process.env, saved);
		},
	};
}

const REVIEW = 'LEVEL REVIEW. Level 1 is complete; this turn takes no action. Rewrite prompts/lessons.md whole.';

test('a level review starts from the level record without arc_action, is bounded, and its prompts/lessons.md is in every later decision; the rule a refinement adds after the level change names the level', async () => {
	const w = await world();
	const h = await attach(w);
	try {
		await h.begin(); await h.act({ action: 'ACTION6', x: 1, y: 1 });
		await h.begin(); await h.act({ action: 'ACTION6', x: 2, y: 2 });
		await h.begin(); await h.act({ action: 'ACTION6', x: 8, y: 8, note: 'try the marked cell', predict: { level_changed: true } });
		const head = await h.begin(REVIEW);
		assert.ok(!h.active().includes('arc_action'), h.active().join(','));
		assert.match(head, /\nLEVEL 1 RECORD \(the level you just completed; level 2 is on screen now\)/);
		assert.match(head, /\n- Completed by #3 ACTION6\(8,8\), action 3 of the level: changed=\d+; it predicted the level change; note: "try the marked cell"\./);
		assert.doesNotMatch(head, /ACTIONS SINCE YOUR LAST REVIEW/);
		assert.equal(h.rows('working_set.jsonl').at(-1).level_review, true);
		// The refinement the level change started: a rule line without its level goes back once.
		await h.calls(1);
		assert.match(h.inputs[0], /^WHY NOW: level 1 reached at #3/);
		await h.settle(reply('FILE prompts/rules.md\n- A click on the marked cell completes the level (hyp.mark)\nEND\nWHY #3'));
		await h.calls(2);
		assert.match(h.inputs[1], /\nNOT APPLIED: each rule line added after a level change names the level that showed it, as "- Level 1: <the rule> \(hyp\.<name>\)"/);
		await h.settle(reply('FILE prompts/rules.md\n- Level 1: a click on the marked cell completed it (hyp.mark)\nEND\nWHY #3'));
		assert.match(h.file('workspace/prompts/rules.md'), /\n- Level 1: a click on the marked cell completed it \(hyp\.mark\)/);
		// The agent's lessons, then the review's bound: the tenth call says so, an eleventh ends the review.
		const lessons = '---\nactive: true\n---\n# Level 1 (won at #3)\n5. Next: test the new marked cell first.\n';
		assert.match(await h.call('write', { path: 'prompts/lessons.md', content: lessons }), /prompts\/lessons\.md → prompt lessons v1: saved · loaded · active from your next decision/);
		for (let i = 2; i < 10; i++) await h.call('memory', { op: 'set', key: `k${i}`, text: `fact ${i}` });
		assert.match(await h.call('memory', { op: 'set', key: 'k10', text: 'fact 10' }), /\(This was tool call 10 of 10 for this review: finish now\.\)/);
		assert.match(await h.call('memory', { op: 'set', key: 'k11', text: 'fact 11' }), /this review used its 10 tool calls; it ends here/);
		assert.match(await h.begin(), /<prompt_lessons>\n+# Level 1 \(won at #3\)\n5\. Next: test the new marked cell first\./, 'it opens the next head');
		assert.equal(h.sections().prompt_lessons, undefined, 'and is not a system-prompt section');
		assert.ok(h.active().includes('arc_action'));
		await h.act({ action: 'ACTION6', x: 3, y: 3 });
		assert.match(await h.begin(), /<prompt_lessons>\n+# Level 1 \(won at #3\)/, 'still there a decision later');
	} finally { await h.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});

test('a run restarted right after the decision that completed a level (a fork from its snapshot) still refines that level change', async () => {
	const w = await world();
	const first = await attach(w);
	try {
		await first.begin(); await first.act({ action: 'ACTION6', x: 1, y: 1 });
		await first.begin(); await first.act({ action: 'ACTION6', x: 8, y: 8 });
	} finally { await first.close(); }
	const second = await attach(w);
	try {
		await second.begin(REVIEW);
		await second.calls(1);
		assert.match(second.inputs[0] ?? '', /^WHY NOW: level 1 reached at #2/);
	} finally { await second.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});

test('a rule in dispute starts one refinement per check version and level, not one per failing move', async () => {
	// su15-lr-p13-q38 (2026-10-20): the rule a refinement scoped to level 1 cited a check that failed on every level-2 move;
	// the dispute was raised again at each new failing move, 18 refinements in 27 actions rewrote the rules prompt.
	const w = await world();
	const h = await attach(w);
	let settled = 0;
	const settleAll = async (n: number) => {
		await new Promise((r) => setTimeout(r, 1500));
		while (settled < h.inputs.length) {
			settled += 1;
			await h.settle(reply(`FILE prompts/rules.md\n- Level 1: a click never changes the board, seen to #${n} (hyp.never)\nEND\nWHY #${n}`));
		}
	};
	try {
		await h.begin();
		await h.call('memory', { hypotheses: [{ key: 'hyp.never', question: 'what a click does', claim: 'a click never changes the board',
			check: 'def check(t):\n    return False\n' }] });
		await h.call('write', { path: 'prompts/rules.md', content: '---\nactive: true\n---\n- Level 1: a click never changes the board (hyp.never)\n' });
		await h.act({ action: 'ACTION6', x: 1, y: 1 });
		for (let n = 2; n <= 5; n++) {
			await h.begin();
			await settleAll(n - 1);
			await h.act({ action: 'ACTION6', x: n, y: n });
		}
		await h.begin();
		await settleAll(5);
		const disputes = h.rows('refiner.jsonl').filter((row) => row.kind === 'start' && /the rule is in dispute/.test((row.triggers ?? []).join(' ')));
		assert.equal(disputes.length, 1, JSON.stringify(disputes.map((row) => row.triggers)));
		assert.match(h.file('workspace/prompts/rules.md'), /seen to #1 \(hyp\.never\)/);
	} finally { await h.close(); await new Promise<void>((r) => w.server.close(() => r())); }
});


test('A/B: ordinary Task with daemon and no pending creates and receives Self/Meta prompts', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { ARC_THIN_DAEMON: '1', ARC_THIN_PROCESS: '1' });
    const w = await world(); const h = await attach(w);
    try {
        assert.match(await h.begin(), /PROCESS EVIDENCE/);
        writeFileSync(join(w.root, 'harness/process.md'), '## Failures\n- fixture error\n## Successes\n- fixture reuse signal\n');
        for (const path of ['prompts/reusable.md', 'prompts/process/local.md']) {
            assert.match(await h.call('write', { path, content: `---\nactive: true\n---\nLOCAL_REUSE_RULE ${path}` }), /saved.*loaded/);
        }
        const head = await h.begin();
        assert.match(head, /PROCESS EVIDENCE/);
        assert.match(head, /## Failures[\s\S]*fixture error[\s\S]*## Successes[\s\S]*fixture reuse signal/);
        assert.ok(head.includes('LOCAL_REUSE_RULE') || Object.values(h.sections()).some(s => s.includes('LOCAL_REUSE_RULE')), head);
        const changes = readFileSync(join(w.root, '.harness/components.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        assert.ok(changes.some((r: any) => r.path === 'prompts/reusable.md' && r.by === 'agent' && r.layer === 'self' && r.kind === 'prompt' && !r.error));
        assert.ok(changes.some((r: any) => r.path === 'prompts/process/local.md' && r.by === 'agent' && r.layer === 'meta'));
        assert.ok(h.rows('working_set.jsonl').some((r: any) => r.active_prompt_versions?.['prompts/reusable.md'] === 1));
        assert.match(h.file('workspace/data/process.md'), /PROCESS EVIDENCE/);
        // A: reviews and consolidation receive the same evidence and active rules.
        for (const prompt of ['CONSOLIDATE. No action this turn.', REVIEW, 'STALL REVIEW. Review the current level.']) {
            const review = await h.begin(prompt);
            assert.match(review, /PROCESS EVIDENCE/);
            assert.match(review, /LOCAL_REUSE_RULE/);
            assert.ok(!h.active().includes('arc_action'));
        }
        writeFileSync(join(w.root, 'harness/daemon.json'), JSON.stringify({ format: 'daemon-v1', monitors: {},
            handled_through: 0, pending: { id: 'd1', from_decision: 0, through_decision: 5, reasons: ['fixture failure'] } }));
        const response = await h.begin('DAEMON RESPONSE. Handle pending maintenance.');
        assert.match(response, /PROCESS EVIDENCE/);
        assert.match(response, /LOCAL_REUSE_RULE/);
        assert.ok(!h.active().includes('arc_action') && h.active().includes('daemon_reply'));
        assert.match(await h.call('write', { path: 'prompts/process/staged.md', content: '---\nactive: true\n---\nSTAGED_RULE' }), /Staged/);
        assert.equal(h.file('workspace/prompts/process/staged.md'), '', 'maintenance stays isolated until publish');
        assert.match(await h.call('daemon_reply', { summary: 'fixture publication', publish: 'prompts/process/staged.md' }), /recorded/);
        assert.match(h.file('workspace/prompts/process/staged.md'), /STAGED_RULE/);
    } finally {
        await h.close(); w.server.close();
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
    }
});


test('after-action self_harness_hook is an isolated turn and reaches save, named use, then Task', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { ARC_THIN_SELF_BASELINE: '1', ARC_THIN_SELF_CONVERT: '0', ARC_THIN_PROCESS: '0', ARC_THIN_DAEMON: '0' });
    const w = await world(); const h = await attach(w);
    try {
        const task = await h.begin();
        assert.doesNotMatch(task, /SELF:|SELF REUSE|save checked reusable/i, 'task turn has no conversion cue');
        assert.match(await h.act({ action: 'RESET' }), /RESET/);
        const categoryContract = 'Review the bounded task summary and indexes first. If they show no concrete reusable candidate, Skip immediately. Consider Python code a candidate when its reusable logic is parameterized and can carry across levels; if its function body is bound to coordinates or current-level constants that cannot be lightly separated, Skip or first rewrite it as parameterized logic. For a candidate, read only one piece of key evidence needed to check it, then save or Skip and finish this hook. Choose the component and whether it is worth keeping; no component is required. Write/edit the existing workspace path directly and preserve its required frontmatter; Binder validates and versions writes. Do not reconstruct the game, inspect every candidate, or continue after save/Skip. No environment action. Finish now.';
        const projectedHook = JSON.stringify({ version: 'hook-summary-v1', window: { from: 1, through: 1 },
            complete: true, gaps: [], source_events: 3, source_chars: 1200,
            actions: [{ n: 1, action: 'RESET', changed_cells: 1, bbox: { top: 0, left: 0, bottom: 0, right: 0 },
                level_changed: false, state: 'PLAYING', levels_completed: 0 }],
            component_events: [], decision_and_tool_index: [{ event_id: 'e1', role: 'toolResult',
                text_excerpt: 'RESET completed', tool_calls: [{ name: 'arc_action', id: 'a1' }] }],
            read_pointers: ['harness/trajectory.jsonl (action receipts; filter n by action IDs)',
                'harness/working_set.jsonl (observation refs and per-decision summaries)',
                'harness/python_session.jsonl (Python definitions and execution events)',
                'harness/component_runs.jsonl (save/use/version events)',
                'session.jsonl (Pi event IDs listed above; audit pointer if read is unavailable)'] });
        assert.match(projectedHook, /hook-summary-v1/);
        assert.doesNotMatch(projectedHook, /FULL_TRACE_SENTINEL|BEGIN COMPLETE ORDERED TASK TRACE/);
        const hook = await h.begin(`SELF_HARNESS_HOOK action_id=1. BEGIN PROJECTED TASK TRACE\n${projectedHook}\nEND PROJECTED TASK TRACE\n${categoryContract}`);
        assert.match(hook, /HOOK RUNTIME FACTS/);
        assert.doesNotMatch(hook, /FULL_TRACE_SENTINEL/, 'the default hook request omits full task trace text');
        assert.match(hook, /Skip immediately/);
        assert.match(hook, /reusable logic is parameterized/);
        assert.match(hook, /bound to coordinates or current-level constants.*Skip or first rewrite it as parameterized logic/);
        assert.match(hook, /one piece of key evidence/);
        assert.match(hook, /finish this hook/);
        assert.match(hook, /"n":1/);
        assert.match(hook, /hook-summary-v1/);
        assert.match(hook, /read_pointers/);
        assert.doesNotMatch(hook, /current grid|available actions/i,
            'the projected tool index may name arc_action, but the hook receives no live grid or action menu');
        assert.equal(h.rows('component_runs.jsonl').filter(row => row.kind === 'save').length, 0,
            'a hook with no new function does not trigger host-side save');
        assert.ok(!h.active().includes('arc_action'), 'hook has no environment action tool');
        assert.ok(h.active().includes('self_component'));
        assert.equal(h.schema('arc_action').properties.then.maxItems, 11, 'native then is bounded at eleven follow-up actions');
        const afterSkip = await h.begin('Decide the next action.');
        assert.ok(h.active().includes('arc_action'), 'a skipped hook returns control to Task');
        assert.doesNotMatch(afterSkip, /SELF REUSE|SELF:/);
        await h.call('python', { code: 'def shift(values, delta):\n    return [value + delta for value in values]\n' });
        await h.call('python', { code: 'print(shift([3, 4], 2))' });
        assert.match(await h.act({ action: 'RESET' }), /RESET/);
        const saveProjection = JSON.stringify({ version: 'hook-summary-v1', window: { from: 2, through: 2 },
            complete: true, gaps: [], source_events: 5, source_chars: 1800,
            actions: [{ n: 2, action: 'RESET', changed_cells: 1, level_changed: false, state: 'PLAYING', levels_completed: 0 }],
            component_events: [], decision_and_tool_index: [
                { event_id: 'e2', role: 'assistant', text_excerpt: 'Define shift(values, delta) and check it.', tool_calls: [{ name: 'python', id: 'p1' }] },
                { event_id: 'e3', role: 'toolResult', text_excerpt: '5, 6', tool_calls: [] }],
            read_pointers: ['harness/trajectory.jsonl (action receipts; filter n by action IDs)',
                'harness/python_session.jsonl (Python definitions and execution events)',
                'session.jsonl (Pi event IDs listed above; audit pointer if read is unavailable)'] });
        const saveHook = await h.begin(`SELF_HARNESS_HOOK action_id=2. BEGIN PROJECTED TASK TRACE\n${saveProjection}\nEND PROJECTED TASK TRACE\n${categoryContract}`);
        assert.match(saveHook, /HOOK RUNTIME FACTS/);
        assert.match(saveHook, /"n":2/);
        assert.match(saveHook, /shift\(values, delta\)/, 'the indexed decision excerpt reaches the hook');
        assert.match(saveHook, /5, 6/, 'the indexed tool result reaches the hook');
        assert.doesNotMatch(saveHook, /FULL_TRACE_SENTINEL|"code":"def shift/,
            'the default hook receives projection excerpts rather than full trace text');
        assert.ok(!h.active().includes('arc_action'));
        assert.match(await h.call('self_component', { name: 'increment', content:
            'def run(state, args):\n    return {"value": args["value"] + 1}\n' }), /increment v1/);
        await h.context([{ role: 'user', content: 'continue hook request' }]);
        assert.ok(h.active().includes('increment'), 'saved version is registered for the next provider request');
        assert.match(await h.call('increment', { args: { value: 8 } }), /9/);
        const nextTask = await h.begin('Decide the next action.');
        assert.ok(h.active().includes('arc_action'));
        assert.ok(h.active().includes('increment'));
        assert.doesNotMatch(nextTask, /SELF REUSE|SELF:/);
        assert.ok(h.rows('self_harness_hook.jsonl').some(row => row.event === 'turn_start' && row.action_id === 1));
        assert.ok(h.rows('self_harness_hook.jsonl').some(row => row.event === 'turn_start' && row.action_id === 2));
        const shown = h.rows('self_harness_hook.jsonl').find(row => row.event === 'shown' && row.action_id === 2);
        assert.match(shown.header, /independent self_harness_hook turn with a clean context/);
        assert.match(shown.head_text, /hook-summary-v1|harness\.trajectory\.jsonl/);
        assert.match(shown.sha256, /^[a-f0-9]{64}$/);
        assert.ok(!shown.tool_names.includes('arc_action'));
    } finally {
        await h.close(); w.server.close();
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
    }
});

test('direct workspace skill and strategy writes bind on the next request and reject bad frontmatter without losing the last good version', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { ARC_THIN_SELF_BASELINE: '1', ARC_THIN_SELF_CONVERT: '0', ARC_THIN_PROCESS: '0', ARC_THIN_DAEMON: '0' });
    const w = await world(); const h = await attach(w);
    try {
        await h.begin();
        const skillBody = '---\nname: probe\ndescription: A reusable check.\n---\nCheck the input, then compare the result.';
        assert.match(await h.call('write', { path: 'skills/probe/SKILL.md', content: skillBody }), /skills\/probe\/SKILL\.md.*v1: saved/);
        const next = await h.begin('Use any relevant saved method.');
        assert.match(next, /skill probe v1 active: A reusable check.*read skills\/probe\/SKILL\.md/);
        assert.match(await h.call('read', { path: 'skills/probe/SKILL.md' }), /A reusable check/);

        const strategy = '---\nactive: true\n---\nDIRECT_STRATEGY_FOR_NEXT_DECISION';
        assert.match(await h.call('write', { path: 'prompts/strategy.md', content: strategy }), /prompts\/strategy\.md.*v1: saved/);
        assert.match(await h.begin('Make the next decision.'), /DIRECT_STRATEGY_FOR_NEXT_DECISION/);

        const badReceipt = await h.call('write', { path: 'skills/probe/SKILL.md', content: '---\nname: wrong\ndescription: broken\n---\nBAD' });
        assert.match(badReceipt, /NOT loaded/);
        const afterFailure = await h.begin('Continue.');
        assert.match(afterFailure, /skill probe v1 active \(v2 failed\): A reusable check/);
        assert.match(await h.call('read', { path: 'skills/probe/SKILL.md' }), /name: wrong/);
    } finally {
        await h.close(); w.server.close();
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
    }
});
