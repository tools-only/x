/**
 * The ask_analyst request for the thin ARC harness: a tool-less model call that
 * sees only what this request carries. The inputs are named in the system
 * prompt, in the message, and again in the receipt, so neither the analyst nor
 * the agent can take an answer about one grid for an answer about another.
 * Found in the 2026-10-10 ls20 run: asked for history.grid(0), the analyst
 * described the current grid as the starting grid, and the agent stored the
 * false claim in memory. Design: docs/plans/2026-10-10-self-harness-priority-plan.md §10.8
 */

export const ANALYST_SYSTEM = [
	"You are a careful visual analyst for a 64x64 integer grid. Answer the question precisely; cite coordinates (x,y).",
	"You have no tools. You see only the inputs listed under INPUTS in the message: no earlier states, no history, no frames, nothing else from the run.",
	"If the question needs something you were not given (for example the starting grid, an earlier action, or state[\"history\"]), say first which input is missing,",
	"then answer only what the given inputs support. Never present a given grid as a different one.",
].join(" ");

export type AnalystInputs = {
	question: string;
	/** Rendered current grid and the number of actions taken so far. */
	current: string; actions: number;
	/** Rendered grid before the last action, when requested; null when there is none yet. */
	previous?: string | null;
	memory?: string;
};

/** What the analyst was given, in words; shown to the analyst and repeated in the receipt. */
export function analystInputs(inputs: AnalystInputs): string {
	const at = inputs.actions ? `after action #${inputs.actions}` : "before any action";
	return [`the current grid (${at})`,
		...(inputs.previous ? [`the grid before action #${inputs.actions}`] : []),
		...(inputs.memory !== undefined ? ["the agent's memory"] : [])].join(", ");
}

export function analystMessage(inputs: AnalystInputs): string {
	const at = inputs.actions ? `after action #${inputs.actions}` : "before any action";
	const parts = [
		`INPUTS: ${analystInputs(inputs)}. Nothing else from this run is visible to you.`,
		`QUESTION: ${inputs.question}`,
		`CURRENT GRID (${at})\n${inputs.current}`,
	];
	if (inputs.previous !== undefined)
		parts.push(inputs.previous ? `PREVIOUS GRID (before action #${inputs.actions})\n${inputs.previous}` : "PREVIOUS GRID: none yet.");
	if (inputs.memory !== undefined) parts.push(inputs.memory);
	return parts.join("\n\n");
}

/** The receipt line that travels with the answer, so a later reader knows what it was based on. */
export const analystReceipt = (answer: string, inputs: AnalystInputs) =>
	`${answer}\n\n(analyst saw only: ${analystInputs(inputs)})`;
