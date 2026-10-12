/**
 * Diagnostic for the self-harness capabilities of 2026-10-10
 * (docs/plans/2026-10-10-self-harness-priority-plan.md): the real thin
 * extension with a fake ExtensionAPI, the real skill sandbox, and a local HTTP
 * stand-in for the ARC bridge. It checks that the project shows the agent no
 * frame comparison of its own, and what the extension does with a prediction,
 * a predictor skill, the agent's own frame-diff skill, the working-set log, the
 * carried reasoning and the consolidation view. Pi's request assembly and
 * schema validation are covered by `arc-thin-smoke --self-harness`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import arcThinExtension from "../demo/arc_thin_extension.ts";
import { repairActionArguments } from "../demo/arc_thin_boundary.ts";

type Grid = number[][];
/** Text the project must never put in front of the agent: its own frame comparisons and derived views. */
const RUNTIME_ANALYSIS = /PIXEL CHANGES|MOVED|LATEST ACTION|changed_cells|Coarse color layout|Uniform 2x2 pixel map/;

/** A 16x16 world: a 2x2 block of 4s that action A moves right and action B moves down; cell (0,0) cycles 0,1,2 with every action. */
function startBridge(): Promise<{ server: Server; url: string }> {
	let x = 3, y = 5, actions = 0;
	const grid = (): Grid => {
		const g = Array.from({ length: 16 }, () => Array(16).fill(0));
		for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g[y + dy][x + dx] = 4;
		g[0][0] = actions % 3;
		return g;
	};
	const state = () => ({
		frames: [grid()], state: "PLAYING", levels_completed: 0, agent_available_actions: ["ACTION1", "ACTION2"],
		action_budget: { used: actions, maximum: null, total_used: actions, total_maximum: null },
	});
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => { body += chunk; });
		request.on("end", () => {
			response.setHeader("content-type", "application/json");
			if (request.url === "/state") return response.end(JSON.stringify(state()));
			const before = grid();
			const action = JSON.parse(body || "{}").action;
			if (action === "ACTION1") x += 1; else y += 1;
			actions += 1;
			const after = grid();
			const cells = [];
			for (let row = 0; row < 16; row += 1) for (let col = 0; col < 16; col += 1)
				if (before[row][col] !== after[row][col]) cells.push({ row, col, before: before[row][col], value: after[row][col] });
			// The production bridge reports a delta; the extension keeps its count for evaluation and shows none of it.
			response.end(JSON.stringify({ ...state(), public_transition: { level_changed: false },
				observation_delta: { frame_available: true, changed_cells: cells.length, cells } }));
		});
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () =>
		resolve({ server, url: `http://127.0.0.1:${(server.address() as any).port}` })));
}

/** services=false pins the ledger and critic off (most cases check the base path); true leaves them at their default. */
function load(root: string, url: string, env: Record<string, string> = {}, services = false) {
	for (const name of ["ARC_THIN_CARRY_REASONING", "ARC_HARNESS_LEDGER", "ARC_HARNESS_CRITIC", "ARC_HARNESS_BOARD",
		"ARC_THIN_CONTINUITY", "ARC_THIN_CONTINUITY_DECISIONS"]) delete process.env[name];
	Object.assign(process.env, { ARC_RUN_ROOT: root, ARC_THIN_VARIANT: "treatment", PI_ARC_BRIDGE_URL: url,
		...(services ? {} : { ARC_HARNESS_LEDGER: "disabled", ARC_HARNESS_CRITIC: "disabled" }), ...env });
	const tools = new Map<string, any>();
	const handlers = new Map<string, (...args: any[]) => any>();
	let active: string[] = [];
	arcThinExtension({
		registerTool(tool: any) { tools.set(tool.name, tool); },
		setActiveTools(names: string[]) { active = names.filter((name) => tools.has(name)); },
		getActiveTools: () => active.slice(),
		getAllTools: () => [...tools.values()],
		on(event: string, handler: (...args: any[]) => any) { handlers.set(event, handler); },
		getThinkingLevel: () => "off",
	} as any);
	const call = async (name: string, params: Record<string, unknown>) =>
		(await tools.get(name).execute("call", params, undefined, undefined, {})).content[0].text as string;
	const rows = (file: string) => readFileSync(join(root, "harness", file), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	return {
		tools, call, rows, active: () => active.slice(),
		invoke: (name: string, params: any) => tools.get(name).execute("call", params, undefined, undefined, {}),
		project: (messages: any[]) => handlers.get("context")!({ messages }, {}),
		providerRequest: (payload: any) => handlers.get("before_provider_request")!({ payload }, {}),
		start: () => handlers.get("session_start")!({}, {}),
		/** The system prompt the next decision would run with. */
		systemPrompt: async () => (await handlers.get("before_agent_start")!({ prompt: "Decide the next action." }, {})).systemPrompt as string,
		/** One decision: start the run, build the working set the model would see, and return its text. */
		decide: async (prompt = "Decide the next action.") => {
			await handlers.get("before_agent_start")!({ prompt }, {});
			const result = await handlers.get("context")!({ messages: [{ role: "user", content: prompt }] }, {});
			return result.messages[0].content[0].text as string;
		},
		/** The model's message for this decision, as Pi reports it. */
		say: (content: any[]) => handlers.get("message_end")!({ message: { role: "assistant", content } }),
		act: (params: Record<string, unknown>) => call("arc_action", repairActionArguments(params)),
	};
}

test("session continuity keeps earlier decisions without reasoning, large arguments or unanswered calls", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-continuity-")), url, { ARC_THIN_CONTINUITY: "session", ARC_THIN_CONTINUITY_DECISIONS: "2" });
		await h.start();
		await h.decide();
		const source = `def run(state, args):\n    return ${"1 + ".repeat(200)}1\n`;
		const session = [
			{ role: "user", content: [{ type: "text", text: "Decide the next action." }] },
			{ role: "assistant", content: [{ type: "thinking", thinking: "SECRET-REASONING" }, { type: "text", text: "Plan: probe ACTION1." },
				{ type: "toolCall", id: "s1", name: "skill", arguments: { op: "set", name: "probe", source } },
				{ type: "toolCall", id: "a1", name: "arc_action", arguments: { action: "ACTION1" } }] },
			{ role: "toolResult", toolCallId: "s1", toolName: "skill", content: [{ type: "text", text: "x".repeat(2000) }] },
			{ role: "toolResult", toolCallId: "a1", toolName: "arc_action", content: [{ type: "text", text: "#1 ACTION1 → level_changed=false" }] },
			// An aborted reply: reasoning and a call that never ran.
			{ role: "user", content: [{ type: "text", text: "Decide the next action." }] },
			{ role: "assistant", stopReason: "aborted", content: [{ type: "thinking", thinking: "half a thought" },
				{ type: "toolCall", id: "a2", name: "arc_action", arguments: { action: "ACTION2" } }] },
			{ role: "user", content: [{ type: "text", text: "RECOVER TURN." }] },
		];
		const projected = (await h.project(session)).messages;
		assert.deepEqual(projected.map((message: any) => message.role), ["user", "assistant", "toolResult", "toolResult", "user", "user"]);
		const text = JSON.stringify(projected);
		assert.doesNotMatch(text, /SECRET-REASONING|half a thought|"a2"/);
		assert.equal(projected[1].content[1].arguments.source, `<${source.length} chars>`);
		assert.equal(projected[2].content[0].text.length, 401);
		assert.match(projected.at(-1).content[0].text, /^RECOVER TURN\.\n\nHYPOTHESES/);
		// One decision in view: the older one is dropped with a note.
		const h1 = load(mkdtempSync(join(tmpdir(), "thin-continuity-1-")), url, { ARC_THIN_CONTINUITY: "session", ARC_THIN_CONTINUITY_DECISIONS: "1" });
		await h1.start();
		await h1.decide();
		const one = (await h1.project(session)).messages;
		assert.match(one[0].content[0].text, /^\(1 earlier decision not shown/);
		assert.equal(one.length, 2);
		// The default rebuild mode shows only the current decision.
		const h0 = load(mkdtempSync(join(tmpdir(), "thin-continuity-0-")), url);
		await h0.start();
		await h0.decide();
		assert.equal((await h0.project(session)).messages.length, 1);
		assert.match(await h.systemPrompt(), /Your last 2 decisions stay in view/);
		assert.match(await h0.systemPrompt(), /Earlier conversation and unsaved reasoning are not carried forward/);
	} finally { server.close(); }
});

test("session continuity carries one native compaction checkpoint ahead of retained decisions", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-compaction-projection-")), url,
			{ ARC_THIN_CONTINUITY: "session", ARC_THIN_CONTINUITY_DECISIONS: "1" });
		await h.start();
		await h.decide();
		const summary = { role: "compactionSummary", summary: "REFUTED_HYPOTHESIS: do not repeat ACTION1",
			tokensBefore: 9000, timestamp: Date.now() };
		const projected = (await h.project([summary,
			{ role: "user", content: [{ type: "text", text: "Retained decision." }] },
			{ role: "assistant", content: [{ type: "text", text: "Try ACTION4." }] },
			{ role: "user", content: [{ type: "text", text: "Current decision." }] },
		])).messages;
		assert.deepEqual(projected.map((message: any) => message.role),
			["compactionSummary", "user", "assistant", "user"]);
		assert.equal(projected[0].summary, summary.summary);
		assert.match(projected.at(-1).content[0].text, /CURRENT STATE/);
		const rebuild = load(mkdtempSync(join(tmpdir(), "thin-compaction-rebuild-")), url);
		await rebuild.start();
		await rebuild.decide();
		assert.deepEqual((await rebuild.project([summary,
			{ role: "user", content: [{ type: "text", text: "Current decision." }] },
		])).messages.map((message: any) => message.role), ["user"]);
	} finally { server.close(); }
});

test("memory rejection without evidence commits through the native tool and reaches the next decision", async () => {
	const bridge = await startBridge();
	try {
		const root = mkdtempSync(join(tmpdir(), "thin-memory-rejection-"));
		const h = load(root, bridge.url);
		await h.start(); await h.decide();
		await h.call("memory", { set: [{ key: "old_plan", text: "enter the box" }],
			hypotheses: [{ key: "box", claim: "entering the box wins" }],
			strategies: [{ key: "enter", plan: "enter the box", depends_on: ["box"] }] });
		const receipt = await h.call("memory", { delete: ["old_plan"], set: [{ key: "next_plan", text: "try another route" }],
			hypotheses: [{ key: "box", status: "rejected" }] });
		assert.doesNotMatch(receipt, /NOT changed/);
		assert.match(receipt, /rejected without a recorded refutation/);
		const saved = h.rows("memory.jsonl").filter((row: any) => row.key === "hyp.box").at(-1);
		assert.equal(saved.hyp.status, "rejected");
		assert.deepEqual(saved.hyp.evidence, []);
		await h.act({ action: "ACTION1" });
		const head = await h.decide();
		assert.match(head, /hyp\.box \[rejected\]/);
		assert.match(head, /rejected without a recorded refutation/);
		assert.match(head, /strat\.enter \[suspended/);
		assert.match(head, /- next_plan .*"try another route"/);
		assert.doesNotMatch(head, /old_plan:/);
		assert.equal(h.rows("trajectory.jsonl").at(-1).n, 1);
	} finally { await new Promise<void>((resolve) => bridge.server.close(() => resolve())); }
});

test("a committed memory update ends neither a review nor a decision; invalid calls remain repairable", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-review-settle-")), url);
		await h.start();
		await h.decide("CONSOLIDATE. Update memory once.");
		await h.say([{ type: "toolCall", name: "memory" }]);
		await assert.rejects(h.invoke("memory", { tests: [{ observed: "missing condition" }] }));
		const result = await h.invoke("memory", { set: [{ key: "control", text: "A moves right" }] });
		// The review may go on to fix a skill (tu93 2026-10-11: "I can't update the skill this turn").
		assert.equal(result.terminate, false);
		assert.equal((await h.invoke("prompt", { op: "set", text: "Check coordinates" })).terminate, false);
		assert.match(await h.decide(), /A moves right/);
		// An ordinary decision continues after the receipt and ends with the action.
		await h.say([{ type: "toolCall", name: "memory" }]);
		assert.equal((await h.invoke("memory", { set: [{ key: "next", text: "Try B" }] })).terminate, false);
		await h.act({ action: "ACTION1" });
		assert.equal(h.rows("trajectory.jsonl").length, 1);
		assert.equal(h.rows("memory.jsonl").at(-1).at, 0);
	} finally { server.close(); }
});

test("after a decision that ended without arc_action, the follow-up turn exposes only arc_action", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-force-action-")), url);
		await h.start();
		await h.decide();
		await h.say([{ type: "toolCall", name: "memory" }]);
		assert.equal((await h.invoke("memory", { set: [{ key: "fact", text: "saved" }] })).terminate, false);
		await h.decide("Decide the next action. Your previous decision ended without arc_action; end this one with exactly one arc_action.");
		assert.deepEqual(h.active(), ["arc_action"]);
	} finally { server.close(); }
});

test("repeated skill calls are short-circuited and distinct calls have a bounded budget", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-tool-budget-")), url);
		await h.start();
		await h.call("skill", { op: "set", name: "probe", description: "small probe",
			source: "def run(state, args):\n    return {'x': args.get('x', 0)}" });
		await h.decide();
		await h.say([{ type: "toolCall", name: "run_skill" }]);
		assert.equal((await h.invoke("run_skill", { name: "probe", args: { x: 1 } })).terminate, false);
		const duplicate = await h.invoke("run_skill", { name: "probe", args: { x: 1 } });
		assert.equal(duplicate.terminate, true);
		assert.match(duplicate.content[0].text, /already ran/);
		assert.equal(h.rows("skill_runs.jsonl").filter((row: any) => !row.duplicate && !row.automatic).length, 1);

		await h.decide();
		await h.say([{ type: "toolCall", name: "run_skill" }]);
		for (let x = 0; x < 4; x += 1)
			assert.equal((await h.invoke("run_skill", { name: "probe", args: { x } })).terminate, false);
		const capped = await h.invoke("run_skill", { name: "probe", args: { x: 4 } });
		assert.equal(capped.terminate, true);
		assert.match(capped.content[0].text, /budget \(4\)/);
	} finally { server.close(); }
});

test("resident instructions stay compact while durable counterexamples and full observations survive", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-context-")), url);
		await h.start();
		const system = await h.systemPrompt();
		assert.ok(system.length < 3000, `resident system has ${system.length} characters`);
		await h.act({ action: "ACTION1" });
		await h.decide();
		await h.call("memory", { hypotheses: [{ key: "exit", question: "goal", claim: "the exit wins",
			status: "rejected", evidence: { action: 1, condition: "pattern unmatched", observed: "no level change", verdict: "refutes" } }] });
		const before = await h.decide();
		await h.act({ action: "ACTION1" });
		const after = await h.decide();
		assert.match(after, /pattern unmatched/);
		assert.match(after, /no level change/);
		assert.match(after, /rejected/);
		assert.notEqual(before.split("CURRENT STATE")[1], after.split("CURRENT STATE")[1]);
		const audit = h.rows("context_budget.jsonl").at(-1);
		assert.equal(audit.system_chars, system.length);
		assert.ok(audit.tools_json_chars > 0);
		assert.ok(audit.message_text_chars >= after.length);
		assert.equal(audit.images, 0);
		const projection = await h.project([
			{ role: "user", content: "old full grid" },
			{ role: "assistant", content: [{ type: "text", text: "old reasoning" }] },
			{ role: "user", content: "Decide the next action." },
			{ role: "assistant", content: [{ type: "toolCall", name: "memory", id: "m1", arguments: {} }] },
			{ role: "toolResult", content: [{ type: "text", text: "current tool result" }], toolCallId: "m1" },
		]);
		assert.equal(projection.messages.length, 3);
		assert.doesNotMatch(JSON.stringify(projection), /old full grid|old reasoning/);
		assert.match(JSON.stringify(projection), /pattern unmatched/);
		assert.match(JSON.stringify(projection), /current tool result/);
		const payload = { enable_thinking: false, max_tokens: 2048, messages: [], apiKey: "must-not-log" };
		assert.equal(await h.providerRequest(payload), undefined);
		assert.equal(payload.enable_thinking, false);
		const policy = h.rows("provider_policy.jsonl").at(-1);
		assert.equal(policy.enable_thinking, false);
		assert.doesNotMatch(JSON.stringify(policy), /must-not-log|apiKey/);
	} finally { server.close(); }
});

// The agent's own tools, written on the foundations the project provides (current grid, prev_grid, history).
const PREDICTOR = [
	"def run(state, args):",
	"    a = state['proposed_action']['action']",
	"    x, y = [(x, y) for y, row in enumerate(state['grid']) for x, v in enumerate(row) if v == 4][0]",
	"    return {'cells': [[x + 2, y, 4]] if a == 'ACTION1' else [[x, y + 3, 4]]}",       // right about ACTION1, wrong about ACTION2
].join("\n");
const FRAME_DIFF = [
	"def run(state, args):",
	"    h, a, b = state['history'], state['prev_grid'], state['grid']",
	"    block = lambda g: [(x, y) for y, row in enumerate(g) for x, v in enumerate(row) if v == 4][0]",
	"    return {'last_changed': [[x, y, a[y][x], b[y][x]] for y in range(len(b)) for x in range(len(b[y])) if a[y][x] != b[y][x]],",
	"            'tried': sorted({t['action'] for t in h.transitions()}), 'starts': [block(h.grid(n)) for n in range(len(h) + 1)],",
	"            'recent_keys': sorted(state['recent_actions'][-1].keys())}",
].join("\n");

test("the agent is shown no frame comparison; predictions are checked and its own skills do the comparing", async () => {
	const { server, url } = await startBridge();
	try {
		const root = mkdtempSync(join(tmpdir(), "thin-self-"));
		const h = load(root, url, {}, true);
		await h.start();
		const first = await h.decide();
		assert.match(first, /RECENT ACTIONS: none yet\./);
		assert.match(first, /CURRENT STATE\n[\s\S]*Lossless coordinate runs/);
		assert.doesNotMatch(first, RUNTIME_ANALYSIS);
		const system = await h.systemPrompt();
		assert.match(system, /A local change or matching slot does not\s+prove progress/);
		assert.match(system, /When expecting a level\/WIN transition, predict it explicitly/);

		// The agent's own prediction: two cells (one wrong) and the level flag, checked against the returned grid.
		const receipt = await h.act({ action: "ACTION1", note: "probe", predict: { cells: [[5, 5, 4], [3, 5, 4]], level_changed: false } });
		assert.match(receipt, /^#1 ACTION1 → level_changed=false state=PLAYING levels=0 [^\n]* \| predicted: cells=2 predicted value\(s\) \[1 as change\] MISS \(saw 1\/2 right; \(3,5\)=0\); level_changed=false ok$/);
		assert.doesNotMatch(receipt, RUNTIME_ANALYSIS);
		const second = await h.decide();
		assert.match(second, /RECENT ACTIONS \(last 1 of 1\):\n#1 ACTION1 → level_changed=false [^\n]* \| note: probe \| predicted: cells=2 predicted value\(s\) \[1 as change\] MISS/);
		assert.match(second, /PREDICTION CHALLENGE \(mechanical counterexample from action #1; this does not decide the goal\):/);
		assert.match(second, /Treat this as unresolved evidence before repeating the same explanation\./);
		assert.doesNotMatch(second, RUNTIME_ANALYSIS);
		// A cross-frame field is not part of the surface: it is dropped, and the action still goes through.
		assert.ok(!("moved" in h.tools.get("arc_action").parameters.properties.predict.properties));

		// A saved skill as the predictor: right about ACTION1, wrong about ACTION2. A predictor is a model: saving it
		// replays it at once on the move already recorded, seeing only what existed before that move.
		assert.match(await h.call("skill", { op: "set", name: "step", description: "predicts the move", source: PREDICTOR }),
			/skill set step v1[^\n]*\n- step v1 \(model, checked on recorded moves\): recorded moves \(fit\) 1\/1 right; claims 1\.0 cells per move, 1\.0 of them changes$/);
		assert.match(await h.act({ action: "ACTION1", predict_skill: "step" }), /\| step v1 predicted: cells=1 predicted value\(s\) \[1 as change\] ok$/);
		await h.decide();
		assert.match(await h.act({ action: "ACTION2", predict_skill: "step" }), /\| step v1 predicted: cells=1 predicted value\(s\) \[1 as change\] MISS \(saw 0\/1 right; \(5,8\)=0\)$/);
		const fourth = await h.decide();
		assert.match(fourth, /- step v1 — predicts the move \[as predictor: 1\/2 fields right\]/);
		// Later moves are checked as they happen and reported apart from the moves the model was written after.
		assert.match(fourth, /YOUR MODELS ON RECORDED MOVES \(each move replayed with only what existed before it\):\n- step v1 \(model, checked on recorded moves\): recorded moves \(fit\) 1\/1 right; moves since saving 1\/2 right, 1 wrong; claims 1\.0 cells per move, 1\.0 of them changes\n  wrong: #3 ACTION2: cells 1 predicted value\(s\) \[1 as change\]: 0\/1 right; \(5,8\)=0/);
		// A predictor is not run as an observer (it needs a proposed action), so it produces no automatic result or failure.
		assert.doesNotMatch(fourth, /YOUR SKILLS ON THE CURRENT STATE|FAILED/);
		// An unknown predictor or a malformed prediction never blocks the action.
		assert.match(await h.act({ action: "ACTION2", predict_skill: "nope", predict: "it goes down" }), /^#4 ACTION2 → level_changed=false [^|]* \| nope predicted: nothing \(no such skill\)$/);
		assert.doesNotMatch(await h.decide(), RUNTIME_ANALYSIS);

		// The agent's own frame comparison, from prev_grid and history: exact changes of the last action, and every earlier position.
		// Saving a skill also runs it once on the current state, so its result (or failure) needs no further message.
		assert.match(await h.call("skill", { op: "set", name: "frame_diff", source: FRAME_DIFF }),
			/skill set frame_diff v1 \(syntax ok\)[^\n]*\non the current state with args=\{\} it returns: \{"last_changed":\[\[0,0,0,1\]/);
		const diff = JSON.parse((await h.call("run_skill", { name: "frame_diff" })).split("→\n")[1]);
		assert.deepEqual(diff, {
			last_changed: [[0, 0, 0, 1], [5, 6, 4, 0], [6, 6, 4, 0], [5, 8, 0, 4], [6, 8, 0, 4]],
			tried: ["ACTION1", "ACTION2"], starts: [[3, 5], [4, 5], [5, 5], [5, 6], [5, 7]],
			// Skills see what the environment reported for an action, not a comparison.
			recent_keys: ["action", "budget", "level_changed", "levels_completed", "n", "state"],
		});
		// The foundation keeps the documented mapping form but also tolerates the
		// common Python attribute spelling used by an authored Skill.
		await h.call("skill", { op: "set", name: "attr_history", source: [
			"def run(state, args):",
			"    t = state['history'].transitions()[0]",
			"    return {'action': t.action, 'level_changed': t.level_changed}",
		].join("\n") });
		assert.deepEqual(JSON.parse((await h.call("run_skill", { name: "attr_history" })).split("→\n")[1]),
			{ action: "ACTION1", level_changed: false });
		// Saved skills become standing perception: the next decision shows what each computes on the current state.
		const fifth = await h.decide();
		assert.match(fifth, /YOUR SKILLS ON THE CURRENT STATE \(each run with args=\{\} after your last action\):\n/);
		assert.match(fifth, /- frame_diff v1: \{"last_changed":\[\[0,0,0,1\],\[5,6,4,0\],\[6,6,4,0\],\[5,8,0,4\],\[6,8,0,4\]\]/);
		assert.match(fifth, /- attr_history v1: unchanged from the prior state/);
		// A result Python can build but JSON cannot carry (tuple keys, sets) is converted, not refused; a failing
		// skill is still saved and its failure is shown at once.
		assert.match(await h.call("skill", { op: "set", name: "tally", source: "def run(state, args):\n    return {(1, 2): 3, 'seen': {3, 1}}\n" }),
			/it returns: \{"\[1, 2\]":3,"seen":\[1,3\]\}/);
		assert.match(await h.call("skill", { op: "set", name: "broken", source: "def run(state, args):\n    return state['nope']\n" }),
			/skill set broken v1[^\n]*\non the current state with args=\{\} it fails: KeyError: 'nope'/);

		const trajectory = h.rows("trajectory.jsonl");
		assert.deepEqual(trajectory.map((row) => [row.prediction?.hits, row.prediction?.misses, row.skill_prediction?.hits, row.skill_prediction?.misses, row.skill_prediction?.error]),
			[[1, 1, undefined, undefined, undefined], [undefined, undefined, 1, 0, undefined], [undefined, undefined, 0, 1, undefined],
				[undefined, undefined, undefined, undefined, "no such skill"]]);
		// The bridge's change count stays in the log for evaluation; no derived analysis is stored with it.
		assert.deepEqual(trajectory.map((row) => row.changed_cells), [5, 5, 5, 5]);
		assert.ok(trajectory.every((row) => !("moves" in row) && !("changes" in row)));
		assert.deepEqual(h.rows("states.jsonl").map((row) => row.n), [0, 1, 2, 3, 4]);
		assert.equal(existsSync(join(root, "harness", "errors.jsonl")), false, "no harness error was logged");
	} finally { server.close(); }
});

test("the working set is logged, reasoning is carried for one decision when asked, and a review sees every action since the last", async () => {
	const { server, url } = await startBridge();
	try {
		const root = mkdtempSync(join(tmpdir(), "thin-self-"));
		const h = load(root, url, { ARC_THIN_CARRY_REASONING: "60" });
		await h.start();
		await h.decide();
		await h.say([{ type: "thinking", thinking: `${"early steps ".repeat(20)}CONCLUSION: the block moves right on ACTION1.` },
			{ type: "toolCall", name: "arc_action", arguments: {} }]);
		await h.act({ action: "ACTION1" });

		// The end of the previous decision's reasoning is shown once.
		const second = await h.decide();
		assert.match(second, /YOUR REASONING AT THE PREVIOUS DECISION \(its last 60 characters;[^\n]*\):\n…[^\n]*CONCLUSION: the block moves right on ACTION1\./);
		assert.doesNotMatch(second, /early steps early steps early steps early steps early steps early steps/);
		await h.say([{ type: "text", text: "no thinking block this time" }]);
		await h.act({ action: "ACTION2" });
		const third = await h.decide();
		assert.match(third, /PREVIOUS DECISION[^\n]*\nno thinking block this time/);
		assert.doesNotMatch(third, /CONCLUSION/);
		for (let i = 0; i < 9; i += 1) { await h.act({ action: i % 2 ? "ACTION1" : "ACTION2" }); await h.decide(); }

		// A decision shows the last 8 actions; the review shows all 11 since the start.
		const decision = await h.decide();
		assert.match(decision, /RECENT ACTIONS \(last 8 of 11\):/);
		const review = await h.decide("CONSOLIDATE: no action this turn.");
		assert.match(review, /ACTIONS SINCE YOUR LAST REVIEW \(#1–#11, 11 of 11\):\n#1 ACTION1 [^\n]*\n#2 ACTION2 /);
		assert.doesNotMatch(review, RUNTIME_ANALYSIS);
		await h.act({ action: "ACTION1" }).catch(() => undefined);    // refused during consolidation
		await h.decide();
		await h.act({ action: "ACTION1" });
		const later = await h.decide("CONSOLIDATE: no action this turn.");
		assert.match(later, /ACTIONS SINCE YOUR LAST REVIEW \(#12–#12, 1 of 12\):/);

		// One log row per decision, with section sizes and the text the model was given (the grid by hash).
		const log = h.rows("working_set.jsonl");
		assert.equal(log.length, new Set(log.map((row) => row.decision)).size);
		assert.deepEqual(Object.keys(log[1].sections), ["memory", "skills", "recent", "resources", "reasoning", "state"]);
		// The previous turn's time and tokens (no deadline is set in this harness, so no time left is shown).
		assert.match(log[1].text, /RESOURCES: your last turn took \S+ and \S+ output tokens[^\n]*\. Reasoning and tool calls cost time, not actions\./);
		assert.ok(log[1].text.includes("YOUR REASONING AT THE PREVIOUS DECISION") && !log[1].text.includes("CURRENT STATE"));
		assert.equal(log[1].state_sha256.length, 16);
		assert.deepEqual(log.filter((row) => row.consolidating).map((row) => row.actions), [11, 12]);

		// After a restart the next review still starts where the last one ended.
		const again = load(root, url, { ARC_THIN_CARRY_REASONING: "60" });
		await again.start();
		await again.decide();
		await again.act({ action: "ACTION2" });
		assert.match(await again.decide("CONSOLIDATE: no action this turn."), /ACTIONS SINCE YOUR LAST REVIEW \(#13–#13, 1 of 13\):/);
	} finally { server.close(); }
});

test("history skills receive the foundation API during save backfill and later observation", async () => {
	const { server, url } = await startBridge();
	try {
		const root = mkdtempSync(join(tmpdir(), "thin-history-observe-"));
		const h = load(root, url, {}, true);
		await h.start();
		await h.decide();
		await h.call("skill", {
			op: "set", name: "history_count", description: "counts prior transitions",
			source: [
				"def run(state, args):",
				"    return {'transitions': len(state['history'].transitions())}",
			].join("\n"),
		});
		// Saving a Skill backfills the states already seen. The save path must
		// provide the same history foundation as the next-turn observer.
		await h.decide();
		await h.act({ action: "ACTION1" });
		await h.decide();
		const observations = h.rows("observations.jsonl").filter((row: any) => row.skill === "history_count");
		assert.ok(observations.length >= 2, "backfill and current-state observations should both exist");
		assert.ok(observations.every((row: any) => row.ok === true), JSON.stringify(observations));
		assert.ok(observations.every((row: any) => !String(row.error ?? "").includes("history")), JSON.stringify(observations));
	} finally { server.close(); }
});

test("the ledger and the critic run by default in the treatment variant and can be switched off", async () => {
	const { server, url } = await startBridge();
	try {
		// Nothing set: both services are on.
		const root = mkdtempSync(join(tmpdir(), "thin-self-"));
		const on = load(root, url, {}, true);
		await on.start();
		const prompt = await on.systemPrompt();
		assert.match(prompt, /\nIdeas\n- On arc_action you may add idea/);
		assert.match(prompt, /CRITIC note from an independent reviewer/);
		// One prediction surface: what the move should do goes in predict.text; the old expect field folds into it.
		const params = on.tools.get("arc_action").parameters.properties;
		assert.ok("idea" in params && !("expect" in params) && "text" in params.predict.properties);
		await on.act({ action: "ACTION1", idea: "probe right", expect: "the block moves" });
		assert.equal(on.rows("trajectory.jsonl")[0].idea, "probe right");
		assert.equal(on.rows("trajectory.jsonl")[0].expect, "the block moves");
		assert.equal(on.rows("trajectory.jsonl")[0].prediction, undefined);
		await on.decide();
		await on.act({ action: "ACTION1", idea: "probe right", predict: { text: "it moves again", level_changed: false } });
		assert.equal(on.rows("trajectory.jsonl")[1].expect, "it moves again");
		assert.equal(on.rows("trajectory.jsonl")[1].prediction.fields.length, 1);
		// The services' output reaches the agent; the agent's own view still carries no frame comparison from the runtime.
		assert.doesNotMatch(await on.decide(), /PIXEL CHANGES|MOVED|LATEST ACTION|Coarse color layout/);

		// Switched off explicitly: no ledger surface. The critic alone keeps the ledger, which it needs.
		const off = load(mkdtempSync(join(tmpdir(), "thin-self-")), url);
		await off.start();
		assert.doesNotMatch(await off.systemPrompt(), /\nIdeas\n|CRITIC note/);
		assert.ok(!("idea" in off.tools.get("arc_action").parameters.properties));
		const criticOnly = load(mkdtempSync(join(tmpdir(), "thin-self-")), url, { ARC_HARNESS_LEDGER: "disabled" }, true);
		await criticOnly.start();
		assert.match(await criticOnly.systemPrompt(), /\nIdeas\n[\s\S]*CRITIC note/);
		// The control variant never has them.
		const control = load(mkdtempSync(join(tmpdir(), "thin-self-")), url, { ARC_THIN_VARIANT: "control" }, true);
		await control.start();
		assert.ok(!("idea" in control.tools.get("arc_action").parameters.properties));
	} finally { server.close(); }
});

test("nothing is carried unless asked, and the control variant has neither a prediction surface nor a frame comparison", async () => {
	const { server, url } = await startBridge();
	try {
		const h = load(mkdtempSync(join(tmpdir(), "thin-self-")), url);
		await h.start();
		await h.decide();
		await h.say([{ type: "thinking", thinking: "some reasoning" }]);
		await h.act({ action: "ACTION1" });
		assert.doesNotMatch(await h.decide(), /PREVIOUS DECISION/);
		assert.deepEqual(Object.keys(h.tools.get("arc_action").parameters.properties.predict.properties).sort(), ["cells", "level_changed", "state", "text"]);
		assert.ok("predict_skill" in h.tools.get("arc_action").parameters.properties);

		const control = load(mkdtempSync(join(tmpdir(), "thin-self-")), url, { ARC_THIN_VARIANT: "control" });
		await control.start();
		await control.decide();
		assert.ok(!("predict" in control.tools.get("arc_action").parameters.properties));
		const receipt = await control.act({ action: "ACTION1", predict: { cells: [[0, 0, 1]] } });
		assert.doesNotMatch(receipt, /predicted/);
		assert.doesNotMatch(receipt, RUNTIME_ANALYSIS);
		assert.doesNotMatch(await control.decide(), RUNTIME_ANALYSIS);
	} finally { server.close(); }
});
