/**
 * The refinement pipeline: turns the agent's trajectory into one harness edit, off the decision path. It is runtime
 * machinery, not a component, as in both reference systems (Continual Harness's Refiner runs at level-up, game over
 * and stagnation; Prime Agent's /refine applies "the smallest relevant edit", records its trigger and outcome, plans in
 * the background, can be rolled back, and can be called by the agent). Adapted to the workspace foundation:
 *   - one edit per call, to any capability category: a prompt (the strategy or the rules), a memory entry (a fact or a
 *     checked hypothesis), a tool or a skill;
 *   - the edit goes through the same lifecycle as the agent's own writes (binder: validated, versioned, restorable);
 *   - the agent starts one with refine(focus) and shapes it with prompts/refine.md; it is told once what changed.
 */
import { RULES_CHARS, RULES_PATH } from "./arc_thin_claims.ts";
export { RULES_PATH, RULES_CHARS };

export const STRATEGY_PATH = "prompts/strategy.md";
export const REFINE_GUIDE_PATH = "prompts/refine.md";
export const STRATEGY_CHARS = 1500;

export const REFINER_SYSTEM = "You maintain the harness of an agent playing an ARC-AGI-3 game (64x64 integer grid, hidden rules and goal). " +
	"The harness has five kinds of capability: prompts (prompts/strategy.md is the agent's current plan and prompts/rules.md holds " +
	"the rules its checks have established; both are applied at every decision), memory (facts with a confidence 1-5, and " +
	"hypotheses with a check(t) the runtime runs on every recorded move), tools (tools/<name>.py, python the agent calls by name), " +
	"skills (skills/<name>/SKILL.md, a procedure read on demand) and subagents. You are called after an event (WHY NOW). From the " +
	"record, make the single most useful small edit, so the agent re-derives less and acts on what the evidence shows.\n" +
	"How understanding moves: a belief the agent states (in memory or its notes) becomes a HYPOTHESIS with a check; a check that " +
	"keeps holding becomes a line of prompts/rules.md that cites its key; a cited check that fails puts the rule in dispute, and " +
	"you narrow or remove that line. The runtime counts the checks; the WHY NOW line says which step is due. Consolidate settled " +
	"or contradicted memory into one MEMORY entry that replaces them, and keep the strategy's next experiment current.\n" +
	"Reply with exactly one of:\nFILE <path>\n<the complete new file content>\nEND\nWHY <one line: the evidence, citing actions like #12 or #3-#7>\n" +
	"or\nMEMORY <key> <confidence 1-5> [replaces <key>, <key>]\n<the fact or rule, one or two sentences>\nEND\nWHY <one line>\n" +
	"or\nHYPOTHESIS hyp.<name>\nclaim: <one sentence>\nquestion: <the question it answers; rivals share it>\npredicts: <what a move shows if it holds>\n" +
	"check:\n<python defining check(t)>\nEND\nWHY <one line>\n" +
	"or\nNONE <one line: why no edit helps now>\n" +
	"A check sees one recorded move: t['action'] (e.g. 'ACTION1'), t.get('x'), t.get('y'), t['level_changed'], t['state'], t['levels_completed'], " +
	"t['changed_cells'] (how many cells the move changed), t['before'] and t['after'] (the grids, rows of ints, before[y][x]); t.get of " +
	"any other key fails. It returns True when the claim holds on that move, False when " +
	"the move contradicts it, None when the move does not bear on it. It is also run on mismatched moves; one that is True on those " +
	"too tests nothing and is not promoted.\n" +
	`FILE paths: prompts/rules.md (under ${RULES_CHARS} characters; one rule per line, each ending with the key of the check that ` +
	"keeps it: '- <the rule in one sentence> (hyp.<name>)'; a goal rule only after a level change confirmed it), " +
	`prompts/strategy.md (under ${STRATEGY_CHARS} characters, three parts: Open questions, Next experiment, Failure modes; when no ` +
	"step has tested how a level is won, the next experiment is a goal test), tools/<name>.py, lib/<name>.py or skills/<name>/SKILL.md " +
	"(frontmatter name and description). A tool is a script " +
	"or def run(args, env): args is a dict; env has state, grid, history (history.grid(n)), frame(n) and act(action, x=None, y=None, " +
	"predict=None), which takes one action and returns the observation (grid, changed_cells, level_changed, state, missed), so code " +
	"can stop when nothing changes. A tool with the line '# view: on' near its top is run after every new state and its output is " +
	"shown to the agent each decision: use one to report positions the agent keeps reading off the grid; it must return a value " +
	"(a view that returns None shows nothing). Never replace a file the " +
	"agent wrote (marked AGENT'S below): add a new path instead; you may rewrite prompts/strategy.md, prompts/rules.md and files marked REFINED. " +
	"Never invent observations; " +
	"a rule without evidence gets confidence 1.";

/**
 * The refinement ledger (ARC_REFINE_LEDGER, on by default; ported from claude/refiner-ledger-20261016, record
 * docs/plans/2026-10-16-refinement-ledger.md there): what became of the refinements' own latest edits, and what an edit
 * was expected to change. In su15-r2 a strategy rewritten to "complete row 63" was followed twice into GAME_OVER (#207,
 * #240), and nothing told the next refinement; in su15-l0-1 the refinements rewrote one goal line seven times.
 */
export const REFINER_LEDGER_SYSTEM = "\nYOUR EARLIER EDITS, when present, lists your latest edits and what the record shows since the agent " +
	"was told of each. An edit that was not used, or whose expectation failed, is the first thing to revise or replace, before " +
	"adding another. After an edit's WHY line you may say what it should change:\nEXPECT within <N> actions: <one sentence: what " +
	"the agent's moves will show if the edit is used and right>\n<python defining check(t), as for hypotheses: True when a move " +
	"shows it, False when a move contradicts it, None when the move does not bear on it>\nEND\nThe runtime runs it on the moves " +
	"after the agent is told of the edit and reports the result under YOUR EARLIER EDITS.";

export const EXPECT_MAX_ACTIONS = 60;
/** What an edit is expected to change: a check on the moves that follow it. `within` is absent when the reply named none. */
export type Expectation = { claim: string; within?: number; check: string };

/** One of the refinements' latest edits as the runtime found it; the extension counts, this module only renders. */
export type LedgerEntry = {
	/** The action count the edit's record ended at ("after #N", as the agent's notice says). */
	at: number;
	/** The action count when the agent was told of it (the decision start that showed the notice); absent: not yet. */
	told?: number;
	/** What it edited, e.g. "prompts/strategy.md v5" or "memory hyp.reach". */
	target: string;
	why: string;
	/** What became of it: "still current", "rewritten by a refinement (now v6)", "deleted by the agent at #81". */
	now: string;
	/** The record since the agent was told, e.g. "14 actions (1 RESET), no level change". */
	since?: string;
	/** Use the runtime can count: tool calls, a view's output, a hypothesis check's results. */
	use?: string;
	/** The expectation and what the moves since showed. */
	expect?: string;
};

const clip = (text: string, chars: number) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > chars ? flat.slice(0, chars - 1) + "…" : flat;
};

/** The ledger section of a refinement's input, newest edit first, within `maxChars`. */
export function renderEditLedger(entries: LedgerEntry[], maxChars = 1800): string {
	if (!entries.length) return "";
	const lines = ["YOUR EARLIER EDITS (newest first; what the record shows since the agent was told of each):"];
	let used = lines[0].length;
	for (const [i, entry] of entries.entries()) {
		const line = `- after #${entry.at} ${entry.target} (${entry.now}): "${clip(entry.why, 140)}" · ` +
			(entry.told === undefined ? "not shown to the agent yet" : `since #${entry.told}: ${entry.since ?? "no actions"}`) +
			(entry.use ? ` · ${entry.use}` : "") + (entry.expect ? ` · ${entry.expect}` : "");
		if (used + line.length + 1 > maxChars) { lines.push(`- (${entries.length - i} older edit(s) not shown)`); break; }
		lines.push(line);
		used += line.length + 1;
	}
	return lines.join("\n");
}

const EDITABLE = /^(prompts\/[a-z0-9_-]+\.md|(tools|lib)\/[a-z_][a-z0-9_]*\.py|skills\/[a-z0-9_-]+\/SKILL\.md)$/;

/** An EXPECT block after the edit: the expectation, or why it could not be used. */
type Expects = { expect?: Expectation; expectError?: string };

export type RefinerEdit =
	| ({ kind: "file"; path: string; content: string; why: string } & Expects)
	| ({ kind: "memory"; key: string; confidence: number; text: string; why: string; replaces?: string[] } & Expects)
	| ({ kind: "hypothesis"; key: string; claim: string; question?: string; predicts?: string; check?: string; why: string } & Expects)
	| { kind: "none"; why: string }
	| { kind: "invalid"; why: string };

/** Code fences around a python body are tolerated, as in a hypothesis check. */
const unfence = (code: string) => code.replace(/^\s*```[a-z]*\s*\r?\n/, "").replace(/\r?\n\s*```\s*$/, "").trimEnd();

/** The EXPECT block in `text` (a reply with its edit block taken out), if any. */
export function parseExpect(text: string): Expects {
	// "within 5:" without "actions" is a horizon too (su15-f2-src2 #62 wrote it, and it was read as part of the sentence).
	const match = /^\s*EXPECT\b[ \t]*(?:within[ \t]+(\d+)(?:[ \t]+actions?)?\b)?[ \t:]*([^\r\n]*)\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	if (!match) return {};
	const claim = match[2].trim().slice(0, 300);
	const check = unfence(match[3]);
	if (!claim) return { expectError: "an EXPECT needs a sentence saying what the moves will show" };
	if (!/\bdef\s+check\s*\(/.test(check)) return { expectError: "an EXPECT check must define check(t)" };
	const within = match[1] ? Math.max(1, Math.min(EXPECT_MAX_ACTIONS, Number(match[1]))) : undefined;
	return { expect: { claim, ...(within ? { within } : {}), check: check + "\n" } };
}

/** A HYPOTHESIS block: `field: value` lines, then `check:` and the python source up to END. */
function parseHypothesis(match: RegExpExecArray, why: string): RefinerEdit {
	const key = match[1];
	const body = match[2];
	const at = body.search(/^\s*check:\s*$/m);
	const head = at >= 0 ? body.slice(0, at) : body;
	const check = at >= 0 ? body.slice(at).replace(/^\s*check:\s*\r?\n/, "").replace(/^\s*```[a-z]*\s*\r?\n/, "").replace(/\r?\n\s*```\s*$/, "").trimEnd() : "";
	const field = (name: string) => new RegExp(`^\\s*${name}:\\s*(.+)$`, "m").exec(head)?.[1]?.trim();
	const claim = field("claim");
	if (!/^hyp\.[a-z0-9_.-]{1,40}$/i.test(key) || !claim) return { kind: "invalid", why: "a hypothesis needs a hyp.<name> key and a claim" };
	if (check && !/\bdef\s+check\s*\(/.test(check)) return { kind: "invalid", why: "the check must define check(t)" };
	const question = field("question"), predicts = field("predicts");
	return { kind: "hypothesis", key, claim: claim.slice(0, 400), ...(question ? { question: question.slice(0, 200) } : {}),
		...(predicts ? { predicts: predicts.slice(0, 300) } : {}), ...(check ? { check: check + "\n" } : {}), why };
}

/** One FILE, MEMORY or HYPOTHESIS block (fences inside it are tolerated), its WHY line and an optional EXPECT block, or NONE. */
export function parseRefinerReply(text: string): RefinerEdit {
	const none = /^\s*NONE\b[:\s]*(.*)$/m.exec(text);
	const file = /^\s*FILE\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	// The charter writes the optional part as "[replaces <key>, <key>]", and replies copy the brackets: all 5 invalid
	// replies in the 2026-10-16 refinement replay (96 replies) were such MEMORY lines. Brackets are accepted.
	const memory = /^\s*MEMORY\s+(\S+)\s+([1-5])(?:[ \t]+\[?replaces[ \t]+([^\r\n\]]+)\]?)?\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	const hypothesis = /^\s*HYPOTHESIS\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	const block = file ?? memory ?? hypothesis;
	if (!block) return none ? { kind: "none", why: none[1].trim().slice(0, 300) } : { kind: "invalid", why: "no FILE, MEMORY or HYPOTHESIS block ending in END, and no NONE line" };
	const end = (block.index ?? 0) + block[0].length;
	const why = (/^\s*WHY\b[:\s]*(.*)$/m.exec(text.slice(end))?.[1]?.trim() ?? "").slice(0, 300);
	// The expectation may come before or after the edit; the edit's own block is not searched.
	const expects = parseExpect(text.slice(0, block.index ?? 0) + "\n" + text.slice(end));
	if (!file && !memory) {
		const edit = parseHypothesis(hypothesis!, why);
		return edit.kind === "hypothesis" ? { ...edit, ...expects } : edit;
	}
	if (!file) {
		const body = memory![4].replace(/\s+/g, " ").trim();
		if (!/^[a-z0-9_.-]{1,40}$/i.test(memory![1]) || !body) return { kind: "invalid", why: "memory needs a short key and a text" };
		const replaces = (memory![3] ?? "").split(/[\s,]+/).map((key) => key.trim()).filter((key) => key && key !== memory![1]);
		return { kind: "memory", key: memory![1], confidence: Number(memory![2]), text: body.slice(0, 600), why, ...(replaces.length ? { replaces } : {}), ...expects };
	}
	const path = file[1].replace(/^`|`$/g, "");
	if (!EDITABLE.test(path)) return { kind: "invalid", why: `path ${path} is not a prompt, tool, library or skill file` };
	let content = file[2].replace(/^\s*```[a-z]*\s*\r?\n/, "").replace(/\r?\n\s*```\s*$/, "");
	if (!content.trim()) return { kind: "invalid", why: "empty file content" };
	// A prompt is applied only with its frontmatter; the strategy is always active.
	if (path.startsWith("prompts/") && !/^---\r?\n/.test(content)) content = `---\nactive: true\n---\n${content}`;
	if (path === STRATEGY_PATH) {
		const split = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/.exec(content);
		if (split && split[2].length > STRATEGY_CHARS) content = split[1] + split[2].slice(0, STRATEGY_CHARS);
	}
	return { kind: "file", path, content: content.endsWith("\n") ? content : content + "\n", why, ...expects };
}
