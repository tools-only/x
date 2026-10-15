/**
 * Offline scripted provider for the thin ARC self-harness smoke
 * (src/autoresearch_pi/arc_thin_e2e.py run_arc_thin_smoke).
 *
 * One script step per agent request. Requests whose system prompt is the
 * ask_analyst prompt are answered with text and do not advance the script.
 * Every request, with its full tool schemas, is recorded in
 * <ARC_RUN_ROOT>/smoke-requests.jsonl so the runner can check what the model
 * actually saw.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scriptedProviderTransport } from "../tests/pi_scripted_provider_transport.ts";

/** say: a text block sent before the tool calls (the scripted model has no reasoning channel; text stands in for it). */
type Step = { kind: "decide" | "consolidate"; calls?: Array<[string, Record<string, unknown>]>; text?: string; say?: string; think?: string };

const COUNT_COLOR = "def run(state, args):\n    g = state['grid']\n    return {'count': sum(r.count(args['color']) for r in g)}\n";

const DEFAULT_SCRIPT: Step[] = [
	// Decision 1: exercise every authoring tool, then two actions in one message.
	{ kind: "decide", calls: [["memory", { op: "set", key: "controls.action1", text: "ACTION1 changes cell (0,0)", confidence: 2 }]] },
	// Batch without op; `set` arrives as a JSON string, as some models send it. Three rivals for one question.
	{ kind: "decide", calls: [["memory", {
		set: JSON.stringify([{ key: "state_1", text: "per-step note 1" }, { key: "state_2", text: "per-step note 2" }]),
		hypotheses: [
			{ key: "hyp.counter", question: "controls", claim: "cell (0,0) counts actions", predicts: "every action changes cell (0,0)", next_test: "ACTION4" },
			{ key: "hyp.mover", question: "controls", claim: "ACTION1 moves an object", predicts: "a shape changes position" },
			{ key: "hyp.paint", question: "controls", claim: "actions recolor a region" },
		],
	}]] },
	// Invalid as a whole: evidence names a nonexistent action; the valid set must not be applied either.
	{ kind: "decide", calls: [["memory", {
		set: [{ key: "atomic_probe", text: "must not be saved" }],
		hypotheses: [{ key: "counter", status: "rejected",
			evidence: { action: 999, condition: "start", observed: "not observed", verdict: "refutes" } }],
	}]] },
	{ kind: "decide", calls: [["skill", { op: "set", name: "count_color", description: "count cells of args['color']", source: "def run(state, args)\n    return 1\n" }]] },
	{ kind: "decide", calls: [["skill", { op: "set", name: "count_color", description: "count cells of args['color']", source: COUNT_COLOR }]] },
	{ kind: "decide", calls: [["run_skill", { name: "count_color" }]] },
	{ kind: "decide", calls: [["run_skill", { name: "count_color", args: { color: 0 } }]] },
	// A strategy names its premise and the components it uses; an unknown component is ignored, not refused.
	{ kind: "decide", calls: [["memory", { strategies: [{ key: "track", plan: "follow the moving object",
		depends_on: ["hyp.mover"], uses: ["skill:count_color", "prompt", "skill:nope"] }] }]] },
	// Never saved: rejected by the run_skill schema; the decision continues.
	{ kind: "decide", calls: [["run_skill", { name: "bottom_row" }]] },
	{ kind: "decide", calls: [["prompt", { op: "set", text: "SMOKE-OVERLAY: check memory controls.* before acting." }]] },
	{ kind: "decide", calls: [["ask_analyst", { question: "Which cells are non-zero?", include_memory: true }]] },
	{ kind: "decide", calls: [
		["arc_action", { action: "ACTION1", note: "probe ACTION1" }],
		["arc_action", { action: "ACTION2", note: "second action in one message must be blocked" }],
	] },
	// Decision 2: one test against the rivals it bears on; an untested rival is deleted (kept as a note).
	// Evidence arrives as a list, a shape the schema rejects; the boundary repair turns it into one entry per result.
	{ kind: "decide", calls: [["memory", { delete: ["hyp.paint"], tests: [{ action: 1, condition: "first action of the game",
		observed: "cell (0,0) changed; nothing moved", verdicts: { "hyp.counter": "supports" } }],
		hypotheses: [{ key: "hyp.counter", evidence: [{ action: 1, condition: "first action of the game", observed: "cell (0,0) changed", verdict: "supports" }] }] }]] },
	// A second skill widens the run_skill name enum; deleting it narrows it again. The save omits op (inferred as set).
	{ kind: "decide", calls: [["skill", { name: "scratch", description: "temporary", source: "def run(state, args):\n    return 0\n" }]] },
	{ kind: "decide", calls: [["skill", { op: "delete", name: "scratch" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "probe ACTION4" }]] },
	// Consolidation: one call records evidence, rejects rivals with their scope, cleans up per-step entries.
	// Rejecting hyp.mover suspends strat.track, which depends on it.
	{ kind: "consolidate", calls: [["memory", {
		set: [{ key: "plan", text: "test ACTION3 next", confidence: 2 }],
		delete: ["state_*"],
		hypotheses: [
			{ key: "hyp.counter", next_test: "ACTION3",
				evidence: { action: 2, condition: "after ACTION1", observed: "cell (0,0) changed again", verdict: "supports" } },
			{ key: "hyp.static", claim: "actions change nothing", status: "rejected",
				evidence: { action: 1, condition: "first action of the game", observed: "3 cells changed", verdict: "refutes" } },
			{ key: "hyp.mover", status: "rejected",
				evidence: { action: 2, condition: "after ACTION1", observed: "no shape moved", verdict: "refutes" } },
		],
	}]] },
	{ kind: "consolidate", text: "Consolidated." },
	// Decision 3: one message carries the updates and the action. A hypothesis sent through set with an
	// over-long text is routed and clipped; an invalid test fails without blocking the action.
	{ kind: "decide", calls: [
		["memory", { strategies: [{ key: "strat.probe", plan: "probe ACTION3 against hyp.counter", depends_on: ["counter"] }] }],
		["memory", { set: [{ key: "hyp.probe2", text: `ACTION3 ${"repeats ".repeat(80)}` }] }],
		["memory", { tests: [{ action: 2, condition: "c", observed: "o", verdicts: { "hyp.nope": "supports" } }] }],
		["arc_action", { action: "ACTION3", note: "probe ACTION3" }],
	] },
	// Decision 4: REVISIONS now shows what followed the suspension; the batched results are shown once.
	{ kind: "decide", calls: [["arc_action", { action: "ACTION2", note: "probe ACTION2" }]] },
];

// Ledger + critic: in the mock game the 9 on row 3 moves right on ACTION1/4 and left on ACTION2/3.
const POSITION = "def run(state, args):\n    return state['grid'][3].index(9)\n";
const LEDGER_SCRIPT: Step[] = [
	{ kind: "decide", calls: [["skill", { op: "set", name: "pos", description: "x of the 9 on row 3", source: POSITION }]] },
	// What a move should do goes in predict.text (a plain string becomes text); the former expect field folds into it.
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", idea: "move right", predict: { text: "the 9 moves right by one" } }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", idea: "move right", expect: "x".repeat(400) }]] },
	// A missed level-change prediction is a failure: it calls the critic before the next decision.
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", idea: "move right", predict: { level_changed: true } }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION3", idea: "move left", predict: "the 9 moves left" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION2", idea: "move left" }]] },
];
// One structured line that is kept, one about an unknown key citing a nonexistent action that is dropped, and a suggestion.
const CRITIC_REPLY = "- goal | contradicted | #3 predicted a level change that did not happen; #1-#3 only moved the 9 right | " +
	"whether the level changes when the 9 reaches an edge\n- hyp.nothing | untested | #99 shows a pattern that does not exist | none\nsuggest: ACTION2";
// Environment failure (MOCK_ARC_FAIL_AFTER=1): the second and later steps return no frame. Each failed
// decision must end at once; a retry inside the same decision would consume the next step.
const ENVIRONMENT_SCRIPT: Step[] = [
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "works" }]] },
	{ kind: "decide", calls: [["memory", { set: [{ key: "plan", text: "keep probing" }] }], ["arc_action", { action: "ACTION2", note: "environment fails" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION3", note: "environment fails again" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "must never be requested" }]] },
];
// Self-harness capabilities (docs/plans/2026-10-10-self-harness-priority-plan.md), run with the carried reasoning
// on. In the mock game the 9 on row 3 moves right on ACTION1/4, left on ACTION2/3. The project shows no frame
// comparison, so the scripted agent writes its own (CHANGES) on state["history"].
const STEP_PREDICTOR = "def run(state, args):\n    a = state['proposed_action']['action']\n" +
	"    x = state['grid'][3].index(9) + (1 if a in ('ACTION1', 'ACTION4') else -1)\n    return {'cells': [[x, 3, 9]]}\n";
const CHANGES = "def run(state, args):\n    h = state['history']\n    out = []\n    for t in h.transitions():\n" +
	"        a, b = h.grid(t['n'] - 1), h.grid(t['n'])\n" +
	"        out.append({'n': t['n'], 'action': t['action'], 'changed': [[x, y, a[y][x], b[y][x]] for y in range(len(b)) " +
	"for x in range(len(b[y])) if a[y][x] != b[y][x]]})\n    return out\n";
// A skill is the method and its product an artifact: board returns the row it parsed under "artifacts", and reader,
// saved afterwards, reads it from state["artifacts"] without parsing the grid again.
const BOARD = "def run(state, args):\n    row = state['grid'][3]\n    return {'x': row.index(9), 'artifacts': {'row3': row}}\n";
const READER = "def run(state, args):\n    row = state['artifacts'].get('row3')\n    info = state['artifact_info'].get('row3', {})\n" +
	"    return {'nine_at': row.index(9) if row else None, 'from': info.get('skill')}\n";
const SELF_HARNESS_SCRIPT: Step[] = [
	// Decision 1: rivals, a predictor skill and a predicted action in one message.
	{ kind: "decide", say: "SMOKE-REASONING-1: I expect ACTION1 to move the 9 right.", calls: [
		["memory", { hypotheses: [
			{ key: "hyp.right", question: "controls", claim: "ACTION1 moves the 9 right" },
			{ key: "hyp.left", question: "controls", claim: "ACTION1 moves the 9 left" },
		] }],
		["skill", { op: "set", name: "step", description: "predicts the next move", source: STEP_PREDICTOR }],
		["arc_action", { action: "ACTION1", note: "test the rivals", predict: { cells: [[3, 3, 9]], level_changed: false } }],
	] },
	// Decision 2: one test that tells the rivals apart; a wrong prediction of the agent and a right one of the skill.
	{ kind: "decide", calls: [
		["memory", { tests: [{ action: 1, condition: "start", observed: "the 9 moved one cell right", verdicts: { "hyp.right": "supports", "hyp.left": "refutes" } }] }],
		["arc_action", { action: "ACTION2", predict: { cells: [[4, 3, 9]] }, predict_skill: "step" }],
	] },
	// Decision 3: the agent writes its own frame-diff tool on history and an artifact producer; the refuted rival
	// is deleted with a receipt, and the active strategy lists its planned steps.
	{ kind: "decide", calls: [
		["skill", { op: "set", name: "changes", description: "cells each action changed", source: CHANGES }],
		["skill", { op: "set", name: "board", description: "row 3 as an artifact", source: BOARD }],
	] },
	{ kind: "decide", calls: [
		["run_skill", { name: "changes" }],
		["skill", { op: "set", name: "reader", description: "reads the row3 artifact", source: READER }],
	] },
	{ kind: "decide", calls: [
		["memory", { delete: ["hyp.left"], hypotheses: [{ key: "hyp.right", status: "supported" }],
			strategies: [{ key: "strat.walk", plan: "walk right, then back", depends_on: ["hyp.right"], steps: "A4 ACTION3 action1" }] }],
		["arc_action", { action: "ACTION4", predict_skill: "step" }],
	] },
	{ kind: "consolidate", text: "Consolidated." },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION3", predict: { level_changed: false, state: "PLAYING" } }]] },
];
// Session continuity (ARC_THIN_CONTINUITY=session, one earlier decision in view): decision 2 must see decision 1's
// text, calls and receipts; decision 3 must see decision 2 only, with a note that one earlier decision is not shown.
const CONTINUITY_SCRIPT: Step[] = [
	{ kind: "decide", say: "SMOKE-CONTINUITY-1: ACTION1 should move the 9 right.", calls: [
		["skill", { op: "set", name: "pos", description: "x of the 9 on row 3", source: POSITION }],
		["arc_action", { action: "ACTION1", note: "first move" }],
	] },
	{ kind: "decide", say: "SMOKE-CONTINUITY-2: it moved; now left.", calls: [["arc_action", { action: "ACTION3", note: "second move" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "third move" }]] },
];
// Claims checked against history and one-off python (docs/plans/2026-10-12-falsifiable-self-harness-plan.md). In the
// mock game the 9 on row 3 starts at x=2 and moves right on ACTION1/4, left on ACTION2/3. hyp.right's check holds on
// #1, hyp.wrong's fails there, and hyp.broken's check does not compile: it is reported and the update still commits.
const RIGHT_CHECK = "def check(t):\n    if t.action != 'ACTION1':\n        return None\n" +
	"    return t.after[3].index(9) == t.before[3].index(9) + 1\n";
const WRONG_CHECK = "def check(t):\n    if t.action != 'ACTION1':\n        return None\n" +
	"    return t.after[3].index(9) == t.before[3].index(9) - 1\n";
const CLAIMS_SCRIPT: Step[] = [
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "probe" }]] },
	{ kind: "decide", calls: [["memory", { hypotheses: [
		{ key: "hyp.right", question: "controls", claim: "ACTION1 moves the 9 one cell right", check: RIGHT_CHECK },
		{ key: "hyp.wrong", question: "controls", claim: "ACTION1 moves the 9 one cell left", check: WRONG_CHECK },
		{ key: "hyp.broken", question: "goal", claim: "a check that does not compile", check: "def check(t)\n    return True\n" },
	] }]] },
	{ kind: "decide", calls: [["python", { code: "x = history.grid(1)[3].index(9)\nprint('nine at', x)\nx + 1" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION4", note: "second move" }]] },
	{ kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "third move" }]] },
];
const HISTORY_SCRIPT: Step[] = Array.from({ length: 30 }, (_, n): Step => ({
  kind: 'decide', say: `HISTORY_${n}:` + 'z'.repeat(700),
  calls: [['arc_action', { action: 'ACTION1', note: `history boundary ${n}` }]],
}));
const FOUNDATION_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['write', { path: 'notes/evidence.md', content: 'FOUNDATION_EXACT_NOTE\nCOUNTEREXAMPLE' }]] },
  { kind: 'decide', calls: [['edit', { path: 'notes/evidence.md', edits: [{ oldText: 'EXACT_NOTE', newText: 'EDITED_NOTE' }] }]] },
  { kind: 'decide', calls: [['read', { path: 'notes/evidence.md', offset: 2, limit: 1 }],
    ['python', { code: "[line for line in open('notes/evidence.md').read().splitlines() if 'EDITED_NOTE' in line]" }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1', note: 'workspace smoke' }]] },
  { kind: 'decide', calls: [['read', { path: 'data/current.json' }], ['write', { path: 'data/forbidden.json', content: 'forbidden' }],
    ['read', { path: '../run-config.json' }], ['python', { code: "import os\nprint(os.environ.get('PI_ARC_ACTION_TOKEN', 'NO_TOKEN'))" }],
    ['python', { code: "open('/host-secret')" }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'isolation smoke' }]] },
  { kind: 'decide', calls: [['read', { path: 'data/frames/1.json' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'later parent' }]] },
];
const QUERY_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['python', { code: '[grid[3].index(9), len(state["frames"])]' }],
    ...(process.env.ARC_HARNESS_CRITIC !== 'disabled' ? [['refine', { focus: 'query observation diagnostic' }] as [string, Record<string, unknown>]] : [])] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }]] },
  { kind: 'decide', calls: [['python', { code: '[grid[3].index(9), prev_grid[3].index(9), history.grid(0)[3].index(9)]' }]] },
  { kind: 'decide', calls: [['read', { path: 'data/frames/1.png' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4' }]] },
  { kind: 'decide', calls: [['read', { path: 'data/observations/0.json' }],
    ['python', { code: '[grid[3].index(9), history.grid(1)[3].index(9)]' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4' }]] },
];
const NATIVE_CLAIMS_SCRIPT: Step[] = CLAIMS_SCRIPT.map(step => ({...step, calls:step.calls?.map(([name,args]) =>
  name==='python' ? ['read',{path:'data/frames/1.json'}] : [name,args]) as Step['calls']}));
NATIVE_CLAIMS_SCRIPT[2] = {kind:'decide',calls:Array.from({length:8},(_,i)=>['read',{
  path:'data/frames/1.json',offset:1,limit:i+1}]) as Step['calls']};
const NATIVE_COMPARE = '"""Compare measured values."""\ndef run(x: int, bias: int = 2):\n    from lib.offset import plus\n    return plus(x, bias)\n';
// The view is a tool marked '# view: on' (observers/ is the older place and still loads); the subagent lives in agents/.
const NATIVE_VIEW = (value: string, mark = 'on') => `"""Where the marker is."""\n# view: ${mark}\ndef run(args, env):\n    return ${value}\n`;
const COMPONENT_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['write', { path: 'lib/offset.py', content: 'def plus(x, y):\n    return x + y\n' }],
    ['write', { path: 'tools/compare.py', content: NATIVE_COMPARE }]] },
  { kind: 'decide', calls: [['compare', { x: 40 }]] },
  { kind: 'decide', calls: [['write', { path: 'prompts/probe.md', content: '---\nactive: true\n---\nNATIVE_STANDING_RULE' }],
    ['write', { path: 'skills/probe/SKILL.md', content: '---\nname: probe\ndescription: NATIVE_SKILL_DESCRIPTION\n---\nNATIVE_SKILL_BODY_READ_ON_DEMAND' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }]] },
  { kind: 'decide', calls: [['write', { path: 'tools/position.py', content: NATIVE_VIEW('env.grid[3].index(9)') }],
    ['write', { path: 'agents/check.md', content: '---\ndescription: check measurements\ntools: [read, python, compare]\n---\nReturn exact computed value.' }],
    ['write', { path: 'skills/probe/scripts/helper.py', content: 'def answer():\n    return 42\n' }]] },
  { kind: 'decide', calls: [['python', { code: 'from skills.probe.scripts.helper import answer\nanswer()' }]] },
  { kind: 'decide', calls: [['consult', { agent: 'check', question: 'Compute compare(x=40).', refs: ['data/current.json'] }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4' }]] },
  { kind: 'decide', calls: [['write', { path: 'tools/compare.py', content: 'def run(x: int)\n    return x\n' }]] },
  { kind: 'decide', calls: [['compare', { args: { x: 40 } }]] },
  { kind: 'decide', calls: [['write', { path: 'prompts/probe.md', content: '---\nactive: false\n---\nNATIVE_STANDING_RULE' }],
    ['write', { path: 'tools/position.py', content: NATIVE_VIEW('999', 'off') }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION3' }]] },
  { kind: 'decide', calls: [['write', { path: 'tools/compare.py', content: NATIVE_COMPARE.replace('= 2', '= 3') }]] },
  { kind: 'decide', calls: [['compare', { x: 40 }]] },
  { kind: 'decide', calls: [['write', { path: 'lib/offset.py', content: 'def plus(x, y):\n    return x + y + 10\n' }]] },
  { kind: 'decide', calls: [['compare', { x: 40 }], ['read', { path: 'skills/probe/SKILL.md' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }]] },
  { kind: 'decide', calls: [['write', { path: 'skills/probe/SKILL.md', content: '---\nname: probe\ndescription: REVISED_SKILL_DESCRIPTION\n---\nREVISED_SKILL_BODY' }],
    ['write', { path: 'agents/check.md', content: '---\ndescription: REVISED_ROLE\ntools: [compare]\n---\nReturn the updated computed value.' }],
    ['write', { path: 'tools/position.py', content: NATIVE_VIEW('777') }]] },
  // The older role argument still reaches the subagent.
  { kind: 'decide', calls: [['consult', { role: 'check', question: 'Compute compare(x=40).' }],
    ['memory', { set: [{ key: 'accepted', text: 'VALID_IN_PARTIAL_BATCH' }, { key: 'unfinished' }],
      hypotheses: [{ key: 'partial', claim: 'PARTIAL_CLAIM', evidence: { verdict: 'supports' } }] }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4' }]] },
  { kind: 'decide', calls: [['read', { path: 'skills/probe/SKILL.md' }],
    ['memory', { set: [{ key: 'corrupt_batch', text: 'NEVER_APPLIED' }], tests: [{ action: 999, verdicts: { partial: 'supports' } }] }]] },
  { kind: 'decide', calls: [['python', { code: "import os\nos.rename('tools/compare.py', 'tools/_off/compare.py')\nos.remove('tools/_off/compare.py')\nos.rename('tools/position.py', 'tools/_off/position.py')\nos.remove('agents/check.md')\nos.remove('skills/probe/SKILL.md')\nos.remove('prompts/probe.md')" }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION3' }]] },
  { kind: 'decide', calls: [['compare', { x: 40 }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }]] },
];
// The Pi process is restarted between the two halves: the python session comes back from its checkpoint.
const RECEIPT_SCRIPT: Step[] = process.env.ARC_THIN_NATIVE_RESTART === '1' ? [
  { kind: 'decide', calls: [['read', { path: '$last_result', offset: 41, limit: 1 }],
    ['python', { code: 'kept_across_restart.append(len(kept_across_restart))\n[kept_across_restart, twice(21)]' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4' }]] },
] : [
  { kind: 'decide', calls: [['python', { code: "def twice(v):\n    return 2 * v\nkept_across_restart = [41]\n" +
    // Longer than the 8,000-character inline limit, so it is saved as a result and read back by offset.
    "print('\\n'.join('COUNTEREXAMPLE_MIDDLE_EXACT' if i == 40 else 'line %d: ' % i + 'x' * 80 for i in range(120)))\n1" }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }]] },
];
// Native call cap: eighteen same-shape python calls in one message (the sixteenth is the last allowed and says so,
// the next two are not run and do not end the decision), then an action in the same decision; the tool list is the
// same throughout and the next decision has its calls back.
const BUDGET_SCRIPT: Step[] = [
  { kind: 'decide', calls: Array.from({ length: 18 }, (_, n) => ['python', { code: `cell = history.grid(0)[0][${n}]\nprint('cell', ${n}, cell)` }] as [string, any]) },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1', note: 'after the cap' }]] },
  { kind: 'decide', calls: [['python', { code: 'print(len(grid))' }], ['memory', { set: [{ key: 'budget', text: 'BUDGET_RECORDED' }] }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'budget reset' }]] },
];
// Reuse: one computation typed twice (REPEATED WORK names it), then once in each of the next two decisions (an
// adoption gap: investigated by the side call), then saved as a tool; typing it again is matched with that tool.
const cellCode = (n: number) => `cell = history.grid(0)[0][${n}]\nprint('cell', ${n}, cell)`;
const REUSE_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['python', { code: cellCode(1) }], ['python', { code: cellCode(2) }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1', note: 'reuse 1' }]] },
  { kind: 'decide', calls: [['python', { code: cellCode(3) }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'reuse 2' }]] },
  { kind: 'decide', calls: [['python', { code: cellCode(4) }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1', note: 'reuse 3' }]] },
  { kind: 'decide', calls: [['write', { path: 'tools/cell.py', content: '"""Read one cell of the first frame."""\ndef run(x: int):\n    cell = history.grid(0)[0][x]\n    print(\'cell\', x, cell)\n    return cell\n' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'reuse 4' }]] },
  { kind: 'decide', calls: [['python', { code: cellCode(5) }], ['python', { code: cellCode(6) }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1', note: 'reuse 5' }]] },
];
// Activation: saved code acts in a closed loop (python save= runs env.act and stops itself when a prediction misses;
// the saved tool does it again), unsaved code cannot act, the agent writes its guidance for refinements and starts
// one itself, and repeated python work makes a refinement save a tool; a later decision is told what changed.
const actCode = (predict: string) => `out = []\nfor a in ('ACTION1', 'ACTION4'):\n    obs = env.act(a, predict=${predict})\n` +
  `    out.append(obs['n'])\n    if obs['missed']: break\nout`;
const ACTIVATION_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['python', { code: `# Probe two moves.\n${actCode('{"level_changed": False}')}`, save: 'probe' }]] },
  { kind: 'decide', calls: [['probe', { args: {} }]] },
  // Reasoning stays within the decision; what python defines stays for later calls.
  { kind: 'decide', think: 'THINK_MARK_DECISION3', calls: [['python', { code: 'show(x0=0, y0=0, x1=7, y1=7)' }],
    ['python', { code: "def plus_one(v):\n    return v + 1\nkept_value = 41\nenv.remember(op='set', key='smoke.remember', text='REMEMBER_MARK written from python')" }],
    ['write', { path: 'prompts/refine.md', content: '---\nactive: false\n---\nREFINE_GUIDE_MARK prefer goal tests.' }]] },
  // Coordinates on an action that takes none are ignored, and the receipt says so.
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1', x: 5, y: 5, note: 'unsaved code did not act' }]] },
  { kind: 'decide', calls: [['python', { code: actCode('{"level_changed": True}'), save: 'miss' }]] },
  { kind: 'decide', calls: [['python', { code: cellCode(1) }], ['python', { code: cellCode(2) }], ['python', { code: cellCode(3) }],
    ['python', { code: 'plus_one(kept_value)' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'after repeated cells' }]] },
  // A planned sequence in one call (Continual Harness's take_actions).
  { kind: 'decide', calls: [['refine', { focus: 'write a goal test into the strategy' }],
    ['arc_action', { action: 'ACTION1', note: 'refinement had time', then: ['ACTION4', { action: 'ACTION1' }] }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'notice shown' }]] },
];
// Fork (tools/run_fork_smoke.py): a run started from the activation smoke's snapshot after decision 3 uses the python
// session names that decision defined, and its first action continues the source's numbering.
const FORK_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['python', { code: '(plus_one(kept_value), len(history))' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4', note: 'after fork' }]] },
];
// Promotion (docs/plans/2026-10-14-knowledge-promotion.md), on the mock game where ACTION1/ACTION4 move the 9 in row 3
// one cell right and it wraps at the edge: a belief rewritten three times makes a refinement write it as a checked
// hypothesis; four holds and failing controls make one write prompts/rules.md citing it; the wrap at #8 fails the check
// and a refinement revises the rule. A computation retyped after it was saved as a tool is named in its own result.
// One scripted step per request: a non-acting call and the action that ends its decision are separate steps.
const act = (action: string): Step => ({ kind: 'decide', calls: [['arc_action', { action }]] });
const believe = (text: string): Step => ({ kind: 'decide', calls: [['memory', { set: [{ key: 'belief.move', text }] }]] });
const PROMOTION_SCRIPT: Step[] = [
  believe('ACTION1 moves the 9 right'), act('ACTION1'),
  believe('ACTION1 moves the 9 one cell right'), act('ACTION1'),
  believe('ACTION1 and ACTION4 move the 9 right'), act('ACTION4'),
  { kind: 'decide', calls: [['python', { code: 'grid[3].index(9)', save: 'nine' }]] }, act('ACTION1'),
  // The saved tool is active from the next decision on; retyping its computation there is named in the result.
  { kind: 'decide', calls: [['python', { code: 'grid[3].index(9)' }]] }, act('ACTION1'),
  act('ACTION2'), act('ACTION4'), act('ACTION1'), act('ACTION1'), act('ACTION4'),
];
const PROMOTION_CHECK = "def check(t):\n    if t['action'] not in ('ACTION1', 'ACTION4'):\n        return None\n" +
  "    return t['after'][3].index(9) == t['before'][3].index(9) + 1";
const MIGRATION_SCRIPT: Step[] = [
  { kind: 'decide', calls: [['run_skill', { name: 'old', args: { extra: 2 } }], ['read', { path: 'notes/controls.md' }]] },
  { kind: 'decide', calls: [['producer', { args: {} }]] },
  { kind: 'decide', calls: [['old', { args: { extra: 2 } }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }]] },
  { kind: 'decide', calls: [['read', { path: 'artifacts/route.json' }]] },
  { kind: 'decide', calls: [['arc_action', { action: 'ACTION4' }]] },
];
// Fixed-step refinements (ARC_REFINE_EVERY=2): one action per decision. The refinements the schedule starts reply late
// (below): the first edits the strategy, the second fails at the provider, later ones make no edit.
const SCHEDULE_SCRIPT: Step[] = Array.from({ length: 12 }, (_, n): Step => ({
  kind: 'decide', calls: [['arc_action', { action: n % 2 ? 'ACTION4' : 'ACTION1', note: `schedule ${n}` }]],
}));
const SCRIPT = process.env.ARC_THIN_SMOKE_SCRIPT === 'history' ? HISTORY_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'query' ? QUERY_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'nativeclaims' ? NATIVE_CLAIMS_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'migration' ? MIGRATION_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'schedule' ? SCHEDULE_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'budget' ? BUDGET_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'reuse' ? REUSE_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'activation' ? ACTIVATION_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'promotion' ? PROMOTION_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'fork' ? FORK_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'receipts' ? RECEIPT_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'components' ? COMPONENT_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === 'foundation' ? FOUNDATION_SCRIPT
  : process.env.ARC_THIN_SMOKE_SCRIPT === "ledger" ? LEDGER_SCRIPT
	: process.env.ARC_THIN_SMOKE_SCRIPT === "environment" ? ENVIRONMENT_SCRIPT
	: process.env.ARC_THIN_SMOKE_SCRIPT === "selfharness" ? SELF_HARNESS_SCRIPT
	: process.env.ARC_THIN_SMOKE_SCRIPT === "continuity" ? CONTINUITY_SCRIPT
	: process.env.ARC_THIN_SMOKE_SCRIPT === "claims" ? CLAIMS_SCRIPT : DEFAULT_SCRIPT;

const textOf = (message: any): string => typeof message?.content === "string"
	? message.content
	: (Array.isArray(message?.content) ? message.content : [])
		.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");

export default function arcThinSmokeProvider(pi: ExtensionAPI) {
	const log = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "smoke-requests.jsonl");
	let step = 0;
	let toolCall = 0;
	let probeOrdinary = 0;
	let checkpoints = 0;
	let scheduledRefinements = 0;
	const idleFaults=new Set<number>();

	pi.registerProvider("offline-arc-thin-smoke", {
		api: "openai-completions",
		apiKey: "offline",
		baseUrl: "http://unused.invalid",
		models: [{
			id: "scripted", name: "scripted", reasoning: false, input: process.env.ARC_THIN_SMOKE_SCRIPT === 'query' ? ["text", "image"] : ["text"],
			contextWindow: 175000, maxTokens: 16384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
		streamSimple: scriptedProviderTransport((model, context, options) => {
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], stopReason: "stop", timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = "aborted";
				stream.push({ type: "error", reason: "aborted", error: output });
				stream.end();
				return stream;
			}
			const messages: any[] = context.messages ?? [];
			// Pi 0.87 carries the prompt and the tool declarations in a leading system message (0.80.6 passed
			// context.systemPrompt and context.tools), so the runner's prompt is the first user message, not messages[0].
			const systemPrompt = String(context.systemPrompt || getCurrentSystemPrompt(messages as any) || "");
			const tools: any[] = (context.tools?.length ? context.tools : getCurrentTools(messages as any)) ?? [];
      if (process.env.ARC_THIN_SMOKE_SCRIPT === 'receipts' && systemPrompt.includes('context summarization assistant')) {
        const evidence = messages.map(textOf).join('\n');
        appendFileSync(join(process.env.ARC_RUN_ROOT!, 'native-summary-input.jsonl'), JSON.stringify({ systemPrompt, messages }) + '\n');
        const refs = [...new Set(evidence.match(/results\/(?:r\d+|[a-f0-9]{64})\.txt/g) ?? [])];
        output.content = [{ type: 'text', text: 'Native checkpoint: exact evidence is retained behind receipts.\n' + refs.map(ref => 'ref: ' + ref).join('\n') }];
        stream.push({ type: 'start', partial: output }); stream.push({ type: 'done', reason: 'stop', message: output }); stream.end(); return stream;
      }
      // Fixed-step refinements (schedule script). Each reply comes 400 ms late, two or three scripted decisions after it
      // started, so the notice has to say what was played after the record it was made from.
      if (process.env.ARC_THIN_SMOKE_SCRIPT === 'schedule' && systemPrompt.startsWith('You maintain the harness of an agent')) {
        appendFileSync(join(process.env.ARC_RUN_ROOT!, 'refiner-inputs.jsonl'), JSON.stringify({ systemPrompt, input: messages.map(textOf).join('\n') }) + '\n');
        const call = ++scheduledRefinements;
        setTimeout(() => {
          if (call === 2) {
            output.stopReason = 'error';
            output.errorMessage = 'SCRIPTED_PROVIDER_ERROR';
            stream.push({ type: 'error', reason: 'error', error: output }); stream.end(); return;
          }
          output.content = [{ type: 'text', text: call === 1
            ? 'FILE prompts/strategy.md\nOpen questions\n- what ends a level\nNext experiment\n- SCHEDULED_STRATEGY_MARK\nFailure modes\n- none yet\nEND\nWHY first scheduled review, #1-#2'
            : 'NONE nothing new since the last refinement' }];
          stream.push({ type: 'start', partial: output }); stream.push({ type: 'done', reason: 'stop', message: output }); stream.end();
        }, 400);
        return stream;
      }
      // Diagnostic-only usage crosses Pi's threshold after the long-result turn is eligible.
      // No manual compact RPC or production provider changes drive this automatic path. Requests are counted, not
      // messages: with the summarised history a request carries only the current decision's prompt.
      if (process.env.ARC_THIN_SMOKE_AUTO_COMPACTION === '1' && !systemPrompt.includes('context summarization assistant')
          && textOf([...messages].reverse().find((m: any) => m.role === 'user')).includes('Checkpoint before restart') && ++checkpoints === 3) {
        output.usage.input = 174100;
        output.usage.totalTokens = 174101;
      }
			if (process.env.ARC_THIN_COMPACTION_PROBE) {
				const summary = systemPrompt.includes("context summarization assistant");
				const transcript = messages.map((message) => ({ role: message?.role, text: textOf(message),
					calls: (Array.isArray(message?.content) ? message.content : []).filter((block: any) => block?.type === "toolCall")
						.map((block: any) => ({ name: block.name, arguments: block.arguments })) }));
				appendFileSync(join(process.env.ARC_RUN_ROOT ?? process.cwd(), "probe-provider.jsonl"),
					JSON.stringify({ summary, systemPrompt, transcript }) + "\n", "utf8");
				const evidence = transcript.map((item) => item.text).join("\n");
				if (summary) {
					const answer = [evidence.includes("REFUTED_HYPOTHESIS")
						? "Native checkpoint: hypothesis MOVES_RIGHT was refuted; prefer ACTION4."
						: "Native checkpoint: no refutation in input.",
						evidence.includes("DECISIVE_COUNTEREXAMPLE_AFTER_2000") ? "DECISIVE_COUNTEREXAMPLE_AFTER_2000" : "COUNTEREXAMPLE_NOT_IN_INPUT",
						evidence.includes("REFUTED_HYPOTHESIS") ? "REFUTED_HYPOTHESIS" : "REFUTATION_NOT_IN_INPUT"].join("\n");
					if (process.env.ARC_THIN_COMPACTION_PROBE === "V6") {
						const signal = options?.signal;
						const finish = () => {
							output.stopReason = "aborted";
							stream.push({ type: "error", reason: "aborted", error: output });
							stream.end();
						};
						if (signal?.aborted) finish();
						else signal?.addEventListener("abort", finish, { once: true });
						return stream;
					}
					if (process.env.ARC_THIN_COMPACTION_PROBE === "V7") {
						output.stopReason = "length";
						output.content.push({ type: "text", text: answer.slice(0, 20) });
						stream.push({ type: "start", partial: output });
						stream.push({ type: "done", reason: "length", message: output });
						stream.end();
						return stream;
					}
					output.content.push({ type: "text", text: answer });
					stream.push({ type: "start", partial: output });
					stream.push({ type: "text_start", contentIndex: 0, partial: output });
					stream.push({ type: "text_delta", contentIndex: 0, delta: answer, partial: output });
					stream.push({ type: "text_end", contentIndex: 0, content: answer, partial: output });
					stream.push({ type: "done", reason: "stop", message: output });
				} else if (probeOrdinary++ > 0) {
					output.content.push({ type: "text", text: "Scripted probe action recorded." });
					stream.push({ type: "start", partial: output });
					stream.push({ type: "done", reason: "stop", message: output });
				} else {
					const action = evidence.includes("REFUTED_HYPOTHESIS") && evidence.includes("DECISIVE_COUNTEREXAMPLE_AFTER_2000")
						? "ACTION4" : "ACTION1";
					const block = { type: "toolCall" as const, id: `compaction-probe-${++toolCall}`,
						name: "arc_action", arguments: { action, note: "scripted compaction evidence check" } };
					output.content.push(block);
					output.stopReason = "toolUse";
					stream.push({ type: "start", partial: output });
					stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
					stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(block.arguments), partial: output });
					stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: output });
					stream.push({ type: "done", reason: "toolUse", message: output });
				}
				stream.end();
				return stream;
			}
      const consult = systemPrompt.startsWith('CONSULT_ROLE');
      if (process.env.ARC_THIN_SMOKE_SCRIPT==='length' && !idleFaults.has(-1)) {
        idleFaults.add(-1);output.content=[{type:'text',text:'Unfinished investigation.'}];output.stopReason='length';
        stream.push({type:'start',partial:output});stream.push({type:'done',reason:'length',message:output});stream.end();return stream;
      }
      if (consult && process.env.ARC_THIN_SMOKE_CONSULT_LENGTH==='1' && !messages.some((m:any)=>m.role==='assistant')) {
        appendFileSync(join(process.env.ARC_RUN_ROOT!,'consult-length.jsonl'),JSON.stringify({role:systemPrompt.split('\n')[0],continuation:false})+'\n');
        output.content=[{type:'text',text:'Incomplete measurement; continue.'}]; output.stopReason='length';
        stream.push({type:'start',partial:output});stream.push({type:'done',reason:'length',message:output});stream.end();return stream;
      }
			if (process.env.ARC_THIN_SMOKE_SCRIPT === 'recovery') {
				const path=join(process.env.ARC_RUN_ROOT!, 'harness', 'trajectory.jsonl');
				const n=existsSync(path) ? readFileSync(path,'utf8').split('\n').filter(Boolean).length : 0;
				if (n<3 && !idleFaults.has(n)) {
					idleFaults.add(n); stream.push({type:'start',partial:output});
					const cancelled=() => {
						output.usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
						output.stopReason='aborted'; stream.push({type:'error',reason:'aborted',error:output}); stream.end();
					};
					options.signal?.addEventListener('abort',cancelled,{once:true});
					return stream;
				}
			}
			const analyst = systemPrompt.includes("careful visual analyst") || consult;
			const adoption = systemPrompt.startsWith("You review why an agent keeps rebuilding");
			const refiner = systemPrompt.startsWith("You maintain the harness of an agent");
			const critic = systemPrompt.includes("You review an agent") || adoption || refiner;
			const head = textOf(messages.find((message) => message?.role === "user") ?? messages[0]);
			// The runner's review prompts start with "CONSOLIDATE" (ordinary) or "RECOVER CONSOLIDATION" (after a length stop).
			const consolidating = /^(CONSOLIDATE\b|RECOVER CONSOLIDATION\b)/.test(head.trimStart());
			let planned: Step | undefined;
      if (consult) {
        const result = messages.find((m: any) => m.role === 'toolResult' && m.toolName === 'compare');
        planned = result ? { kind: 'decide', text: 'CONSULT_SEMANTIC: ' + textOf(result) }
          : { kind: 'decide', calls: [['arc_action', { action: 'ACTION1' }], ['compare', { x: 40 }]] };
      }
			else if (analyst) planned = { kind: "decide", text: "ANALYST: only cell (0,0) is non-zero; it counts actions." };
			else if (adoption) planned = { kind: "decide", text: messages.map(textOf).join("\n").includes("no component was saved")
				? "missing | `cell = history.grid(0)[0][n]` typed in every call | tools/cell.py run(x: int) returning the cell\nnot a cause line"
				: "varies | ADOPTION_UNEXPECTED_FINDING | none" };
			else if (refiner) {
				const why = messages.map(textOf).join("\n");
				appendFileSync(join(process.env.ARC_RUN_ROOT ?? process.cwd(), "refiner-inputs.jsonl"), JSON.stringify({ systemPrompt, input: why }) + "\n");
				planned = { kind: "decide", text: why.includes("the rule is in dispute")
					? "FILE prompts/rules.md\n- ACTION1 and ACTION4 move the 9 one cell right except at the right edge, where it wraps (hyp.right_wrap)\nEND\nWHY hyp.right failed at the edge"
					: why.includes("a candidate rule for prompts/rules.md")
					? "FILE prompts/rules.md\n- ACTION1 and ACTION4 move the 9 one cell right (hyp.right)\nEND\nWHY hyp.right held on every move it applied to"
					: why.includes("no hypothesis carries a check")
					? `HYPOTHESIS hyp.right\nclaim: ACTION1 and ACTION4 move the 9 in row 3 one cell right\nquestion: what the actions do\npredicts: the 9 one column further right\ncheck:\n${PROMOTION_CHECK}\nEND\nWHY belief.move was restated three times`
					: why.includes("redone")
					? "FILE tools/cell_reader.py\n# Read one cell of the first frame.\ncell = history.grid(0)[0][args.get('x', 0)]\ncell\nEND\nWHY the same cell lookup was typed at #4-#5"
					// Asked by the agent: an attempt to replace the agent's own tool, which the runtime refuses.
					: why.includes("the agent asked") ? "FILE tools/probe.py\n# view: on\ngrid[0]\nEND\nWHY replace the probe with a view"
					: "FILE prompts/strategy.md\nRules\n- ACTION1 changes the grid (conf 2, #1)\nOpen questions\n- what ends a level\nNext experiment\n- REFINED_NEXT_EXPERIMENT\nFailure modes\n- none yet\nEND\nWHY first refinement after #6" };
			}
			else if (critic) planned = { kind: "decide", text: CRITIC_REPLY };
			else if (['recovery','death','length'].includes(process.env.ARC_THIN_SMOKE_SCRIPT!)) planned={kind:'decide',calls:[['arc_action',{action:'ACTION1'}]]};
			else {
				planned = SCRIPT[step];
				if (planned && (planned.kind === "consolidate") === consolidating) step += 1;
				else planned = consolidating
					? { kind: "consolidate", text: "Script exhausted or out of order during consolidation." }
					: { kind: "decide", calls: [["arc_action", { action: "ACTION1", note: "fallback after script" }]] };
			}
      // A tool the run does not offer (refine without refinements) is left out of the scripted message.
      if (planned?.calls && !analyst && !critic) {
        const offered = new Set(tools.map((tool: any) => tool.name ?? tool.function?.name));
        planned = { ...planned, calls: planned.calls.filter(([name]) => name !== 'refine' || offered.has('refine')) };
      }
      if (planned?.calls) planned = { ...planned, calls: planned.calls.map(([name, args]) => [name,
        args.path === '$last_result' ? { ...args, path: messages.map(textOf).join('\n').match(/results\/(?:r\d+|[a-f0-9]{64})\.txt/)?.[0] ?? 'missing' } : args]) };
			appendFileSync(log, JSON.stringify({
				t: new Date().toISOString(), analyst, critic, consolidating, step,
				// With retained history the first user message is an old decision; the current one is the last.
				current: textOf([...messages].reverse().find((message) => message?.role === "user") ?? messages[0]),
				// message_count excludes Pi's leading system message so the runner's checks keep the 0.80.6 meaning
				// (1 = the first request of a decision).
				message_count: messages.filter((message) => message?.role !== "system").length, roles: messages.map((message) => message?.role),
        image_blocks: messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])
          .filter((b: any) => b.type === 'image').map(() => ({ role: m.role, tool: m.toolName }))),
				tools: tools.map((tool: any) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
				system_prompt: systemPrompt, head,
				// Reasoning the request carries from earlier assistant turns (kept within the current decision only).
				reasoning_in_context: messages.filter((m: any) => m?.role === "assistant").flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
					.filter((b: any) => b?.type === "thinking").map((b: any) => String(b.thinking)),
        ...(process.env.ARC_THIN_SMOKE_SCRIPT==='nativeclaims' ? {latest_user:textOf(messages.findLast((m:any)=>m.role==='user'))} : {}),
				last_tool_results: messages.filter((message) => message?.role === "toolResult")
					.map((message) => ({ tool: message.toolName, is_error: message.isError, text: textOf(message).slice(0, 1200) })),
				// What earlier messages the request carried (continuity checks): user prompts, assistant text and calls.
				transcript: messages.filter((message) => message?.role !== "system").map((message) => ({
					role: message?.role,
					text: textOf(message).slice(0, message?.role === "user" ? 160 : process.env.ARC_THIN_SMOKE_SCRIPT === "history" ? 1000 : 600),
					...(message?.role === "assistant" ? {
						blocks: (Array.isArray(message.content) ? message.content : []).map((block: any) => block?.type),
						calls: (Array.isArray(message.content) ? message.content : []).filter((block: any) => block?.type === "toolCall")
							.map((block: any) => ({ name: block.name, arguments: block.arguments })),
					} : {}),
				})),
				planned,
			}) + "\n", "utf8");

			stream.push({ type: "start", partial: output });
			if (planned.think) {
				// Scripted reasoning, signed like Qwen's reasoning_content, to check what the next request carries.
				const contentIndex = output.content.length;
				output.content.push({ type: "thinking", thinking: planned.think, thinkingSignature: "reasoning_content" } as any);
				stream.push({ type: "thinking_start", contentIndex, partial: output } as any);
				stream.push({ type: "thinking_delta", contentIndex, delta: planned.think, partial: output } as any);
				stream.push({ type: "thinking_end", contentIndex, content: planned.think, partial: output } as any);
			}
			if (planned.say) {
				const contentIndex = output.content.length;
				output.content.push({ type: "text", text: planned.say });
				stream.push({ type: "text_start", contentIndex, partial: output });
				stream.push({ type: "text_delta", contentIndex, delta: planned.say, partial: output });
				stream.push({ type: "text_end", contentIndex, content: planned.say, partial: output });
			}
			if (planned.calls?.length) {
				output.stopReason = "toolUse";
				for (const [name, args] of planned.calls) {
					const contentIndex = output.content.length;
					const block = { type: "toolCall" as const, id: `arc-thin-smoke-${++toolCall}`, name, arguments: args };
					output.content.push(block);
					stream.push({ type: "toolcall_start", contentIndex, partial: output });
					stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(args), partial: output });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				}
			} else {
				const text = planned.text ?? "";
				output.content.push({ type: "text", text });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
			}
			stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
			stream.end();
			return stream;
		}),
	});
}
