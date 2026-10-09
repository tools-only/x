import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { TaskPythonPool } from "../demo/pi_task_python_pool.ts";
import { SKILL_LIMITS, guestFailure, skillGuestProgram, type GuestResult } from "../demo/arc_thin_skill_guest.ts";
import { ArcBridgeEventSource, HarnessBoard, normalizePredictsContract, gridHash,
	type BoardCatalog, type BoardComponent, type BoardEvaluator, type BoardSource, type BoardTransition } from "../demo/pi_harness_board.ts";

const project = join(import.meta.dirname, "..");
const stage80 = join(project, "runs/arc-stage80-ordinary-gpt-ls20-20261004");
const stage60 = join(project, "runs/arc-evidence-effort-stage60-ordinary-gpt-ls20-20261004");
const pool = new TaskPythonPool();
after(() => pool.close());

/** The thin harness evaluator: the real skill guest in the persistent WASI host. */
function guestEvaluator(timeoutMs = 5000): BoardEvaluator {
	const guest = skillGuestProgram({ ...SKILL_LIMITS, timeout_ms: timeoutMs });
	return async (component, call) => {
		const result = (await pool.evaluate(guest, { mode: "run", source: String(component.program),
			state: { grid: call.grid, levels_completed: call.level_index },
			args: call.actions ? { actions: call.actions } : {} })).value as GuestResult;
		if (!result.ok) throw new Error(guestFailure(result));
		return result.value;
	};
}

function catalogOf(skills: Array<{ name: string; version?: number; source: string; predicts?: unknown }>): BoardCatalog {
	const components: BoardComponent[] = skills.map(skill => ({ ref: `skill:${skill.name}@v${skill.version ?? 1}`, name: skill.name,
		version: skill.version ?? 1, predicts: skill.predicts, program: skill.source }));
	return { components: () => components,
		resolve: ref => components.find(item => item.ref === ref || `skill:${item.name}` === ref) };
}

// Level-one footprint hypothesis from the stage64/stage80 public audits, as a thin skill.
const FOOTPRINT = (alwaysMove = false) => `
OFFSETS = {'ACTION1': (0, -5), 'ACTION2': (0, 5), 'ACTION3': (-5, 0), 'ACTION4': (5, 0)}

def anchor(grid):
    found = [(x, y) for y in range(len(grid) - 4) for x in range(len(grid[0]) - 4)
             if all(grid[y + dy][x + dx] == (12 if dy < 2 else 9) for dy in range(5) for dx in range(5))]
    return [found[0][0], found[0][1]] if len(found) == 1 else None

def step(g, a, item):
    if a is None or item['action'] not in OFFSETS:
        return None
    dx, dy = OFFSETS[item['action']]
    x, y = a[0] + dx, a[1] + dy
    if x < 0 or y < 0 or x + 5 > len(g[0]) or y + 5 > len(g):
        return a
    clear = ${alwaysMove ? "True" : "all(g[y + j][x + i] == 3 for j in range(5) for i in range(5))"}
    return [x, y] if clear else a

def run(state, args):
    g = state['grid']
    a = anchor(g)
    if 'actions' not in args:
        return a
    return [step(g, a, item) for item in args['actions']]
`;

const ledgerDir = () => mkdtempSync(join(tmpdir(), "harness-board-"));
const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).filter(name => name !== "board.jsonl")
	.map(name => [name, createHash("sha256").update(readFileSync(join(dir, name))).digest("hex")]));

test("contract validation is separate and reports issues without throwing", () => {
	assert.deepEqual(normalizePredictsContract({}).contract, { scope: "task", covers: [], clicks: [], repair: false });
	assert.equal(normalizePredictsContract({ feature: "pos", scope: "level", clicks: [[1, 2]], repair: true }).contract!.repair, true);
	assert.match(normalizePredictsContract({ scope: "episode" }).issues.join(), /scope/);
	assert.match(normalizePredictsContract({ lens_ref: "skill:Bad Name" }).issues.join(), /lens_ref/);
	assert.match(normalizePredictsContract({ extra: 1 }).issues.join(), /unknown predicts field/);
	assert.match(normalizePredictsContract([]).issues.join(), /object/);
});

test("bridge events become canonical transitions, including the first action via pre-action state",
	{ skip: !existsSync(stage80) }, () => {
	const source = new ArcBridgeEventSource(stage80);
	const transitions = source.transitions();
	assert.equal(transitions.length, 44);
	assert.equal(transitions.filter(item => item.level_index === 1).length, 11);
	assert.equal(transitions.filter(item => item.flags.level_changed).length, 1);
	assert.equal(source.current()!.level_index, 1);
	assert.equal(transitions[0].before_hash, gridHash(transitions[0].before));
});

test("stage80 footprint predictor replays 11/11 on level one including four blocked moves", { skip: !existsSync(stage80) }, async () => {
	const dir = ledgerDir();
	const board = new HarnessBoard(join(dir, "board.jsonl"), new ArcBridgeEventSource(stage80),
		catalogOf([{ name: "footprint", source: FOOTPRINT(), predicts: { feature: "anchor", scope: "level" } }]), guestEvaluator());
	assert.deepEqual(await board.advance(Date.now() + 120_000), { pending: false });
	const [status] = board.status();
	assert.equal(status.status, "supported");
	assert.equal(status.replay.correct, 11);
	assert.equal(status.replay.wrong, 0);
	const correct = new Set(board.ledger().filter(row => row.kind === "score" && row.outcome === "correct").map(row => row.t));
	// Blocked steps from tmp/arc-stage80-public-footprint-audit-20261004.json.
	for (const t of [36, 37, 39, 43]) assert.ok(correct.has(t), `blocked step ${t} predicted correctly`);
	assert.deepEqual(readdirSync(dir), ["board.jsonl"], "board writes only its own ledger");
});

test("stage60 footprint predictor replays 14/14 on level one", { skip: !existsSync(stage60) }, async () => {
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), new ArcBridgeEventSource(stage60),
		catalogOf([{ name: "footprint", source: FOOTPRINT(), predicts: { feature: "anchor", scope: "level" } }]), guestEvaluator());
	await board.advance(Date.now() + 120_000);
	const [status] = board.status();
	assert.equal(status.replay.correct, 14);
	assert.equal(status.replay.wrong, 0);
	assert.equal(status.status, "supported");
});

test("a wrong variant is falsified with an exact counterexample, delivered once, and the component stays untouched",
	{ skip: !existsSync(stage80) }, async () => {
	const skills = [{ name: "always_move", source: FOOTPRINT(true), predicts: { feature: "anchor", scope: "level" } }];
	const before = JSON.stringify(skills);
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), new ArcBridgeEventSource(stage80), catalogOf(skills), guestEvaluator());
	await board.advance(Date.now() + 120_000);
	const [status] = board.status();
	assert.equal(status.status, "falsified");
	assert.equal(status.counterexample!.t, 36);
	assert.equal(status.counterexample!.action.action, "ACTION3");
	assert.deepEqual(status.counterexample!.observed, [29, 40]);
	assert.deepEqual(status.counterexample!.predicted, [24, 40]);
	const first = await board.digest({ deadline: Date.now() + 30_000 });
	assert.match(first, /FALSIFIED at action 36 ACTION3: predicted \[24,40\], observed \[29,40\]/);
	const second = await board.digest({ deadline: Date.now() + 30_000 });
	assert.match(second, /falsified at action 36 ACTION3 \(details in board ledger\)/);
	assert.doesNotMatch(second, /FALSIFIED/);
	assert.equal(JSON.stringify(skills), before);
});

test("infrastructure timeouts become erroring, never falsified", { skip: !existsSync(stage80) }, async () => {
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), new ArcBridgeEventSource(stage80),
		catalogOf([{ name: "slow", source: "def run(state, args):\n    while True:\n        pass\n", predicts: { scope: "level" } }]),
		guestEvaluator(200));
	await board.advance(Date.now() + 120_000);
	const [status] = board.status();
	assert.equal(status.status, "erroring");
	assert.equal(status.replay.wrong, 0);
	assert.ok(status.replay.error >= 3);
});

// Small synthetic source for disagreement, rejection and deadline behavior.
function syntheticSource(): BoardSource {
	const grid = (value: number) => [[value, 0], [0, 0]];
	const transitions: BoardTransition[] = [1, 2, 3].map(t => ({ t, epoch: 0, level_index: 0, action: { action: "ACTION1" },
		before: grid(t - 1), after: grid(t), before_hash: gridHash(grid(t - 1)), after_hash: gridHash(grid(t)),
		flags: { reset: false, level_changed: false, game_over: false } }));
	return { transitions: () => transitions,
		current: () => ({ t: 3, epoch: 0, level_index: 0, grid: grid(3), grid_hash: gridHash(grid(3)), actions: ["ACTION1", "ACTION2", "RESET"] }) };
}

test("comparable predictors that disagree are reported; rejected contracts leave the skill usable", async () => {
	const counter = "def run(state, args):\n    v = state['grid'][0][0]\n    return [v + 1 for a in args['actions']] if 'actions' in args else v\n";
	const alternative = "def run(state, args):\n    v = state['grid'][0][0]\n    return [(v + 1 if a['action'] == 'ACTION1' else v + 2) for a in args['actions']] if 'actions' in args else v\n";
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), syntheticSource(), catalogOf([
		{ name: "count_a", source: counter, predicts: { feature: "corner" } },
		{ name: "count_b", source: alternative, predicts: { feature: "corner" } },
		{ name: "bad", source: counter, predicts: { lens_ref: "skill:missing" } }]), guestEvaluator());
	await board.advance(Date.now() + 60_000);
	assert.deepEqual(board.status().map(item => item.status), ["supported", "supported"]);
	const current = await board.currentPredictions(Date.now() + 60_000);
	assert.deepEqual(current.disagreements, [{ feature: "corner", action: "ACTION2",
		values: { "skill:count_a@v1": 4, "skill:count_b@v1": 5 } }]);
	const digest = await board.digest({ deadline: Date.now() + 60_000 });
	assert.match(digest, /Disagreement \[corner\] on ACTION2/);
	assert.match(digest, /skill:bad@v1 contract rejected \(component unaffected\): lens_ref not found/);
	assert.ok(digest.length <= 1500);
});

test("a separate lens is pinned to its exact version at registration", async () => {
	const lens = "def run(state, args):\n    return state['grid'][0][0]\n";
	const predictor = "def run(state, args):\n    v = state['grid'][0][0]\n    return [v + 1 for a in args['actions']]\n";
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), syntheticSource(), catalogOf([
		{ name: "corner", version: 2, source: lens },
		{ name: "next_corner", source: predictor, predicts: { lens_ref: "skill:corner" } }]), guestEvaluator());
	await board.advance(Date.now() + 60_000);
	const contract = board.ledger().find(row => row.kind === "contract" && row.predictor_ref === "skill:next_corner@v1");
	assert.equal(contract!.contract.lens_ref, "skill:corner@v2");
	assert.equal(board.status()[0].status, "supported");
});

test("an expired deadline leaves work pending without scoring", async () => {
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), syntheticSource(), catalogOf([
		{ name: "count", source: "def run(state, args):\n    return [0 for a in args.get('actions', [])] if 'actions' in args else 0\n", predicts: {} }]),
		guestEvaluator());
	assert.deepEqual(await board.advance(Date.now() - 1), { pending: true });
	assert.equal(board.ledger().filter(row => row.kind === "score").length, 0);
	assert.equal(board.status()[0].status, "replaying");
});

test("components without a contract produce no digest", async () => {
	const board = new HarnessBoard(join(ledgerDir(), "board.jsonl"), syntheticSource(),
		catalogOf([{ name: "plain", source: "def run(state, args):\n    return 1\n" }]), guestEvaluator());
	assert.equal(await board.digest({ deadline: Date.now() + 1000 }), "");
});
