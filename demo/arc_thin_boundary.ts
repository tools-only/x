/**
 * Tool-boundary repair for the thin ARC harness: coerce common argument slips
 * into the intended form instead of rejecting the call. A rejected call costs
 * the agent a full model round trip; in the 2026-10-09 real runs about 30 of
 * 32 memory refusals were format slips (evidence as a list, over-long text,
 * hypothesis keys in set, missing op). Repairs never invent content: they
 * reshape, clip, or infer an operation from the fields that are present.
 * Design: docs/plans/2026-10-09-thin-decision-loop-efficiency.md
 */
import { prepareMemoryArguments } from "./arc_thin_memory.ts";
import { normalizePrediction } from "./arc_thin_prediction.ts";

/** Field limits the tools document; longer values are clipped, never refused. */
export const LIMITS = { text: 600, claim: 300, predicts: 300, next_test: 300, condition: 200, observed: 300, plan: 300, question: 40, note: 300 } as const;

const clip = (value: unknown, max: number) =>
	typeof value === "string" && value.length > max ? `${value.slice(0, max - 1)}…` : value;
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const MEMORY_OPS = new Set(["set", "delete", "list", "update"]);
/** Op names models use for the documented ones (an unknown op is dropped and inferred from the fields). */
const MEMORY_OP_ALIASES: Record<string, string> = {
	get: "list", read: "list", show: "list", view: "list", all: "list",
	add: "set", put: "set", write: "set", upsert: "set", save: "set",
	remove: "delete", del: "delete",
};

function clipFields(item: Record<string, any>, fields: Array<keyof typeof LIMITS>): Record<string, any> {
	const out = { ...item };
	for (const field of fields) if (field in out) out[field] = clip(out[field], LIMITS[field]);
	return out;
}

/**
 * Parse a JSON array/object string; when it is only missing its closing
 * brackets (a model stopped early, as in the 2026-10-09 ls20 run), close them.
 * Returns undefined when the text is not repairable JSON.
 */
export function parseLooseJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;
	try { return JSON.parse(trimmed); } catch { /* try closing it */ }
	const stack: string[] = [];
	let inString = false, escaped = false;
	for (const ch of trimmed) {
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") inString = true;
		else if (ch === "[" || ch === "{") stack.push(ch === "[" ? "]" : "}");
		else if (ch === "]" || ch === "}") { if (stack.pop() !== ch) return undefined; }
	}
	if (!stack.length && !inString) return undefined;
	try { return JSON.parse(trimmed + (inString ? "\"" : "") + stack.reverse().join("")); } catch { return undefined; }
}

/** Optional fields sent as null mean "not given": drop them instead of failing the schema. */
const dropNulls = (item: unknown) => isObject(item)
	? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null)) : item;

/** Close truncated JSON strings and drop nulls before the memory module's own repair. */
function preRepair(raw: any): any {
	if (!isObject(raw)) return raw;
	const out: Record<string, any> = dropNulls(raw) as Record<string, any>;
	for (const field of ["set", "delete", "hypotheses", "tests", "strategies"]) {
		if (typeof out[field] === "string") {
			const parsed = parseLooseJson(out[field]);
			if (parsed !== undefined) out[field] = parsed;
		}
		if (Array.isArray(out[field])) out[field] = out[field].map((item: unknown) => {
			const clean = dropNulls(item);
			if (!isObject(clean)) return clean;
			for (const nested of ["evidence", "verdicts", "depends_on", "uses"])
				if (typeof clean[nested] === "string") {
					const parsed = parseLooseJson(clean[nested]);
					if (parsed !== undefined) clean[nested] = parsed;
				}
			return clean;
		});
	}
	return out;
}

/**
 * Memory arguments: truncated-JSON and null repair (preRepair), JSON-string repair
 * (prepareMemoryArguments), then
 * - an unknown op is dropped when batch fields are present (inferred instead);
 * - set/key entries whose key starts with hyp. or strat. become hypotheses or strategies;
 * - an evidence list becomes one hypothesis entry per result;
 * - over-long strings are clipped.
 */
export function repairMemoryArguments(raw: any): any {
	const args = prepareMemoryArguments(preRepair(raw));
	if (!isObject(args)) return args;
	const out: Record<string, any> = { ...args };
	if (out.op !== undefined && !MEMORY_OPS.has(out.op)) {
		const alias = typeof out.op === "string" ? MEMORY_OP_ALIASES[out.op.trim().toLowerCase()] : undefined;
		if (alias) out.op = alias; else delete out.op;
	}
	const hypotheses: any[] = Array.isArray(out.hypotheses) ? [...out.hypotheses] : [];
	const strategies: any[] = Array.isArray(out.strategies) ? [...out.strategies] : [];
	const route = (key: unknown, text: unknown): boolean => {
		if (typeof key !== "string") return false;
		const trimmed = key.trim();
		if (trimmed.startsWith("hyp.")) { hypotheses.push({ key: trimmed, ...(typeof text === "string" ? { claim: text } : {}) }); return true; }
		if (trimmed.startsWith("strat.")) { strategies.push({ key: trimmed, ...(typeof text === "string" ? { plan: text } : {}) }); return true; }
		return false;
	};
	if (Array.isArray(out.set)) {
		out.set = out.set.filter((item: any) => !(isObject(item) && route(item.key, item.text)))
			.map((item: any) => isObject(item) ? clipFields(item, ["text"]) : item);
		if (!out.set.length) delete out.set;
	}
	if (out.op !== "delete" && out.op !== "list" && route(out.key, out.text)) { delete out.key; delete out.text; delete out.op; }
	if (typeof out.text === "string") out.text = clip(out.text, LIMITS.text);
	const expanded: any[] = [];
	for (const item of hypotheses) {
		if (!isObject(item)) { expanded.push(item); continue; }
		const fixed = clipFields(item, ["claim", "predicts", "next_test", "question"]);
		// A check is code: never clipped, and unescaped once when it arrives on one line with literal "\n".
		if (typeof fixed.check === "string") fixed.check = unescapeSource(fixed.check);
		const evidence = Array.isArray(fixed.evidence) ? fixed.evidence : fixed.evidence === undefined ? [] : [fixed.evidence];
		const [first, ...rest] = evidence.map((e: any) => isObject(e) ? clipFields(e, ["condition", "observed"]) : e);
		expanded.push({ ...fixed, ...(first !== undefined ? { evidence: first } : {}) });
		if (first === undefined) delete expanded.at(-1).evidence;
		for (const e of rest) expanded.push({ key: fixed.key, evidence: e });
	}
	if (expanded.length) out.hypotheses = expanded; else delete out.hypotheses;
	if (strategies.length) out.strategies = strategies.map((item) => isObject(item) ? clipFields(item, ["plan"]) : item);
	if (Array.isArray(out.tests)) out.tests = out.tests.map((item: any) => isObject(item) ? clipFields(item, ["condition", "observed"]) : item);
	return out;
}

/**
 * Skill arguments: infer a missing or unknown op from the fields present, and undo one level of string escaping
 * when the whole source arrives on one line with literal "\n" sequences (tu93, 2026-10-11: the first save failed
 * as a syntax error and cost a decision). A source with a real line break is never changed.
 */
export function repairSkillArguments(args: any): any {
	if (!isObject(args)) return args;
	const out = typeof args.source === "string" ? { ...args, source: unescapeSource(args.source) } : args;
	if (["set", "delete", "get"].includes(out.op)) return out;
	const { op: _ignored, ...rest } = out;
	return { ...rest, op: typeof out.source === "string" && out.source.trim() ? "set" : "get" };
}

export function unescapeSource(source: string): string {
	if (/[\r\n]/.test(source) || !source.includes("\\n")) return source;
	return source.replace(/\\(\\|n|t|r|"|')/g, (_match, c: string) => ({ n: "\n", t: "\t", r: "" } as Record<string, string>)[c] ?? c);
}

/**
 * arc_action arguments: an over-long note is clipped rather than refusing the
 * action, and an optional prediction keeps its well-formed fields only. A
 * prediction is never a reason to reject the action. The former separate
 * `expect` field is folded into `predict.text`, its single replacement.
 */
export function repairActionArguments(args: any): any {
	if (!isObject(args)) return args;
	const out: Record<string, any> = { ...args };
	if (typeof out.note === "string") out.note = clip(out.note.replace(/\s+/g, " ").trim(), LIMITS.note);
	if ("expect" in out) {
		const expect = typeof out.expect === "string" ? out.expect.trim() : "";
		delete out.expect;
		if (expect) {
			const given = normalizePrediction(out.predict) ?? {};
			out.predict = { ...given, text: given.text ?? expect };
		}
	}
	if ("predict" in out) {
		const predict = normalizePrediction(out.predict);
		if (predict) out.predict = predict; else delete out.predict;
	}
	if ("predict_skill" in out) {
		if (typeof out.predict_skill === "string" && out.predict_skill.trim()) out.predict_skill = out.predict_skill.trim().slice(0, 40);
		else delete out.predict_skill;
	}
	// Further actions: a JSON string or bare action names become step objects; an unusable list is dropped, never a
	// reason to reject the first action.
	if ("then" in out) {
		let steps = out.then;
		if (typeof steps === "string") { try { steps = JSON.parse(steps); } catch { steps = steps.split(/[\s,]+/).filter(Boolean); } }
		steps = Array.isArray(steps) ? steps.map((step: any) => typeof step === "string" ? { action: step.trim().toUpperCase() } : step)
			.filter((step: any) => isObject(step) && typeof step.action === "string") : [];
		for (const step of steps) {
			if ("predict" in step) { const predict = normalizePrediction(step.predict); if (predict) step.predict = predict; else delete step.predict; }
		}
		if (steps.length) out.then = steps; else delete out.then;
	}
	return out;
}

/**
 * Bridge failures that mean the environment, not the agent's choice, failed:
 * transport timeouts or aborts, connection errors, and bridge responses with a
 * 5xx status (502 = environment error, 500 = bridge fault). A 4xx response (an
 * action that is not available, bad coordinates) is the agent's to fix.
 */
export function isEnvironmentFailure(error: unknown): boolean {
	const status = Number((error as { status?: unknown } | undefined)?.status);
	if (Number.isInteger(status) && status > 0) return status >= 500;
	const name = error instanceof Error ? error.name : "";
	const message = error instanceof Error ? error.message : String(error);
	if (name === "TimeoutError" || name === "AbortError") return true;
	return /aborted due to timeout|timed out|fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(message);
}

/** A tool as Pi lists it: its name and its parameter schema, with the tool's own argument preparation when known. */
export type ToolShape = { name: string; description?: string; parameters?: any; prepareArguments?: (args: any) => any };
export type ToolValidator = (tool: ToolShape, call: { type: "toolCall"; id: string; name: string; arguments: any }) => unknown;

/**
 * Whether a tool takes exactly these arguments: each key the model sent is one the tool declares, and, prepared by the
 * tool's own prepareArguments as Pi prepares them, they pass its schema (ls20-p01-r2: a memory call with a 770-char
 * text, which memory clips to 600 before its schema, was otherwise taken by no tool and left unrepaired).
 */
function takes(tool: ToolShape, args: unknown, validate: ToolValidator): boolean {
	const declared = tool.parameters?.properties;
	if (!isObject(args) || !isObject(declared) || Object.keys(args).some((key) => !(key in declared))) return false;
	try {
		const prepared = typeof tool.prepareArguments === "function" ? tool.prepareArguments(args) : args;
		validate(tool, { type: "toolCall", id: "name-repair", name: tool.name, arguments: prepared });
		return true;
	} catch { return false; }
}

/**
 * Tool calls that reached the agent loop under the wrong name. On the yibu Responses route, when one message called
 * several different tools, every later call arrived with the first call's name and its own arguments (ls20-r03b: 2
 * calls; ls20-p01-r1: 6 in its first two decisions, e.g. python {path, limit}, read {code}, write {op, set}). Pi takes
 * a function call's name from the stream's output_item.added event and never revises it, so each such call failed
 * validation and its work was lost, and the request after it read nothing from the provider's cache.
 *
 * Only that shape is repaired: a later call that carries the first call's name, in a message with two or more calls,
 * whose named tool does not take its arguments while exactly one other active tool does. The block is renamed in
 * place, before Pi validates and runs it, so the run, the session and the transcript all hold the corrected call. A
 * call that validates, the first call, and a call no tool or several tools would take are never changed.
 */
export function repairToolCallNames(message: any, tools: ToolShape[], validate: ToolValidator): Array<{ id: string; from: string; to: string }> {
	const calls = (Array.isArray(message?.content) ? message.content : []).filter((block: any) => block?.type === "toolCall");
	if (calls.length < 2) return [];
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const repairs: Array<{ id: string; from: string; to: string }> = [];
	for (const call of calls.slice(1)) {
		if (call.name !== calls[0].name) continue;
		const named = byName.get(call.name);
		if (named && takes(named, call.arguments, validate)) continue;
		const others = tools.filter((tool) => tool.name !== call.name && takes(tool, call.arguments, validate));
		if (others.length !== 1) continue;
		repairs.push({ id: String(call.id), from: String(call.name), to: others[0].name });
		call.name = others[0].name;
	}
	return repairs;
}
