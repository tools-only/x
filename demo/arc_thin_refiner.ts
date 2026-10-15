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
	"t['before'] and t['after'] (the grids, rows of ints, before[y][x]). It returns True when the claim holds on that move, False when " +
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

const EDITABLE = /^(prompts\/[a-z0-9_-]+\.md|(tools|lib)\/[a-z_][a-z0-9_]*\.py|skills\/[a-z0-9_-]+\/SKILL\.md)$/;

/**
 * Whether a scheduled refinement is due (ARC_REFINE_TRIGGERS=fixed): the action count passed a multiple of `every` since
 * the last scheduled one. Multiples keep the schedule regular when one decision plays many actions.
 */
export const scheduleDue = (actions: number, last: number, every: number) =>
	every > 0 && Math.floor(actions / every) > Math.floor(last / every);

export type RefinerEdit =
	| { kind: "file"; path: string; content: string; why: string }
	| { kind: "memory"; key: string; confidence: number; text: string; why: string; replaces?: string[] }
	| { kind: "hypothesis"; key: string; claim: string; question?: string; predicts?: string; check?: string; why: string }
	| { kind: "none"; why: string }
	| { kind: "invalid"; why: string };

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

/** One FILE, MEMORY or HYPOTHESIS block (fences inside it are tolerated) and its WHY line, or NONE. */
export function parseRefinerReply(text: string): RefinerEdit {
	const none = /^\s*NONE\b[:\s]*(.*)$/m.exec(text);
	const file = /^\s*FILE\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	const memory = /^\s*MEMORY\s+(\S+)\s+([1-5])(?:[ \t]+replaces[ \t]+([^\r\n]+))?\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	const hypothesis = /^\s*HYPOTHESIS\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	const block = file ?? memory ?? hypothesis;
	if (!block) return none ? { kind: "none", why: none[1].trim().slice(0, 300) } : { kind: "invalid", why: "no FILE, MEMORY or HYPOTHESIS block ending in END, and no NONE line" };
	const why = (/^\s*WHY\b[:\s]*(.*)$/m.exec(text.slice((block.index ?? 0) + block[0].length))?.[1]?.trim() ?? "").slice(0, 300);
	if (!file && !memory) return parseHypothesis(hypothesis!, why);
	if (!file) {
		const body = memory![4].replace(/\s+/g, " ").trim();
		if (!/^[a-z0-9_.-]{1,40}$/i.test(memory![1]) || !body) return { kind: "invalid", why: "memory needs a short key and a text" };
		const replaces = (memory![3] ?? "").split(/[\s,]+/).map((key) => key.trim()).filter((key) => key && key !== memory![1]);
		return { kind: "memory", key: memory![1], confidence: Number(memory![2]), text: body.slice(0, 600), why, ...(replaces.length ? { replaces } : {}) };
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
	return { kind: "file", path, content: content.endsWith("\n") ? content : content + "\n", why };
}
