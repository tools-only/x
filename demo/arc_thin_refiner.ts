/**
 * The refiner: turns the agent's trajectory into one harness edit, off the decision path. It replaces the advisory
 * critic in native mode. Distillation that depends on the acting agent noticing what to save was the main reason
 * our harness went unused; Continual Harness's Refiner and Prime Agent's /refine write into the harness instead.
 * Ours is adapted to the workspace foundation:
 *   - it is a role file (roles/refiner.md) the agent can read, revise or delete; its body is added to the instructions;
 *   - it makes one small edit per call (a note or a python component) that goes through the binder like any write,
 *     versioned, validated, with the trigger and its evidence logged (refiner.jsonl);
 *   - it runs in the background and never delays a decision; the agent is told once what changed.
 */
export const REFINER_PATH = "roles/refiner.md";
export const STRATEGY_PATH = "notes/strategy.md";
export const STRATEGY_CHARS = 1500;

export const REFINER_SEED = `---
description: Turns your trajectory into one harness edit after level changes, missed predictions, stalls and repeated work
tools: [read, python]
---
Prefer keeping notes/strategy.md current. Save a tool or observer only when the record shows the same computation or check recurring.
`;

export const REFINER_SYSTEM = "You maintain the harness of an agent playing an ARC-AGI-3 game (64x64 integer grid, hidden rules and goal). " +
	"The harness is the agent's workspace: notes/strategy.md is shown to the agent at every decision, and python components " +
	"run for it: tools/<name>.py (callable), observers/<name>.py (observe(state) runs on every new state; its output is shown " +
	"each decision) and lib/<name>.py (shared code). You are called after an event (WHY NOW). From the record, make the single " +
	"most useful small edit, so the agent re-derives less and acts on what the evidence shows.\n" +
	"Reply with exactly one of:\nFILE <path>\n<the complete new file content>\nEND\nWHY <one line: the evidence, citing actions like #12 or #3-#7>\n" +
	"or\nNONE <one line: why no edit helps now>\n" +
	"The path is notes/strategy.md, notes/<name>.md, tools/<name>.py, observers/<name>.py or lib/<name>.py. notes/strategy.md stays " +
	`under ${STRATEGY_CHARS} characters with four parts: Rules (each with confidence 1-5 and the actions that showed it), Open ` +
	"questions, Next experiment, Failure modes. A tool is either a script (its inputs are the dict args, its final expression is " +
	"the result) or a docstring plus one typed def run(...). A tool may return {\"actions\": [{\"action\": \"ACTION1\", " +
	"\"predict\": {\"level_changed\": false}}, ...]}: the runtime plays them and stops at the first missed prediction. Code sees " +
	"state, grid, prev_grid, history (history.grid(n)). Never invent observations; a rule without evidence gets confidence 1.";

const EDITABLE = /^(notes\/[a-z0-9_.-]+\.md|(tools|observers|lib)\/[a-z_][a-z0-9_]*\.py)$/;

export type RefinerEdit =
	| { kind: "file"; path: string; content: string; why: string }
	| { kind: "none"; why: string }
	| { kind: "invalid"; why: string };

/** One FILE ... END block (fences inside it are tolerated) and its WHY line, or NONE. */
export function parseRefinerReply(text: string): RefinerEdit {
	const none = /^\s*NONE\b[:\s]*(.*)$/m.exec(text);
	const file = /^\s*FILE\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$/m.exec(text);
	if (!file) return none ? { kind: "none", why: none[1].trim().slice(0, 300) } : { kind: "invalid", why: "no FILE ... END block or NONE line" };
	const path = file[1].replace(/^`|`$/g, "");
	if (!EDITABLE.test(path)) return { kind: "invalid", why: `path ${path} is not a note or a tools/observers/lib python file` };
	let content = file[2].replace(/^\s*```[a-z]*\s*\r?\n/, "").replace(/\r?\n\s*```\s*$/, "");
	if (!content.trim()) return { kind: "invalid", why: "empty file content" };
	if (path === STRATEGY_PATH && content.length > STRATEGY_CHARS) content = content.slice(0, STRATEGY_CHARS);
	const why = /^\s*WHY\b[:\s]*(.*)$/m.exec(text.slice((file.index ?? 0) + file[0].length))?.[1]?.trim() ?? "";
	return { kind: "file", path, content: content.endsWith("\n") ? content : content + "\n", why: why.slice(0, 300) };
}
