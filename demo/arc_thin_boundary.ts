/**
 * Tool-boundary repair for the thin ARC harness: coerce common argument slips
 * into the intended form instead of rejecting the call. A rejected call costs
 * the agent a full model round trip; in the 2026-10-09 real runs about 30 of
 * 32 memory refusals were format slips (evidence as a list, over-long text,
 * hypothesis keys in set, missing op). Repairs never invent content: they
 * reshape, clip, or infer an operation from the fields that are present.
 * Design: docs/plans/2026-10-09-thin-decision-loop-efficiency.md
 */
import { clampCoordinate } from "./arc_thin_ch_view.ts";
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
	for (const field of ["reasoning", "note"]) if (typeof out[field] === "string" && out[field].trim() === "(as in an earlier identical call)") delete out[field];
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
		steps = steps.slice(0, 11);
		if (steps.length) out.then = steps; else delete out.then;
	}
	return out;
}

/**
 * JSON whose closing brackets came in the wrong order: a closer that skips open brackets closes them first, closers
 * nothing opened are dropped, and the text ends with the first complete value. su15-ch-q38-1 (2026-10-20) sent action
 * lists such as `[{"name": "ACTION6", "x": 31, "y": 5, "predict": {"cells": []}]}]`, the entry still open when the
 * list closed. Returns undefined when even that does not parse.
 */
export function parseReorderedJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;
	const stack: string[] = [];
	let out = "", inString = false, escaped = false;
	for (const ch of trimmed) {
		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") inString = true;
		if (ch === "[" || ch === "{") stack.push(ch === "[" ? "]" : "}");
		if (ch === "]" || ch === "}") {
			if (!stack.includes(ch)) continue;
			while (stack.at(-1) !== ch) out += stack.pop();
			out += stack.pop();
			if (!stack.length) break;
			continue;
		}
		out += ch;
	}
	try { return JSON.parse(out + (inString ? "\"" : "") + stack.reverse().join("")); } catch { return undefined; }
}

/** An action named as a gateway may send it: `ACTION3'}]}}]` (vlm_backend._ACTION_PREFIX_RE), `action6`, `A6(12, 30)`. */
const ACTION_NAME = /^\s*(RESET|ACTION[1-7]|A[1-7])\b\s*(?:\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\))?/i;
const actionName = (name: string) => name.toUpperCase().replace(/^A(\d)$/, "ACTION$1");

/**
 * arc_action's Continual Harness arguments (ARC_THIN_OBSERVATION=ch): reasoning and a list of {name, x, y, predict}.
 * A list sent as text is parsed (closing brackets closed in order if needed), one entry sent alone is a list of one,
 * an entry given as a name ("ACTION1", "ACTION6(12,30)") becomes an object, an entry's `action` is its name, a name is
 * cut to its action, coordinates are clamped as CH clamps them, and each prediction keeps its well-formed fields. The
 * earlier arc_action shape, {action, x, y, predict, then, note}, reads as the list it describes, and a prediction sent
 * beside a list belongs to its first action. A missing reasoning reads as the note or as empty (CH: args.get("reasoning")
 * or ""). Nothing here rejects the call: what is still unusable is reported by the schema check or the tool's own check.
 */
export function repairActionList(args: any): any {
	if (!isObject(args)) return args;
	const { action, x, y, predict, then, note, ...rest } = repairActionArguments(args);
	const out: Record<string, any> = rest;
	const reasoning = out.reasoning ?? note;
	out.reasoning = typeof reasoning === "string" ? reasoning : reasoning == null ? "" : String(reasoning);
	const parsed = (value: unknown) => typeof value === "string" ? parseLooseJson(value) ?? parseReorderedJson(value) ?? value : value;
	let list: any = parsed(out.actions);
	if (isObject(list)) list = [list];
	if (list === undefined && typeof action === "string") {
		const further = parsed(then);
		list = [{ name: action, ...(x != null ? { x } : {}), ...(y != null ? { y } : {}) }, ...(Array.isArray(further) ? further : [])];
	}
	if (Array.isArray(list)) list = list.map((item: unknown) => {
		if (typeof item === "string") {
			const named = ACTION_NAME.exec(item);
			return named ? { name: actionName(named[1]), ...(named[2] !== undefined ? { x: Number(named[2]), y: Number(named[3]) } : {}) } : item;
		}
		if (!isObject(item)) return item;
		const entry: Record<string, any> = repairActionArguments(dropNulls(item));
		if (typeof entry.name !== "string" && typeof entry.action === "string") { entry.name = entry.action; delete entry.action; }
		const named = typeof entry.name === "string" ? ACTION_NAME.exec(entry.name) : null;
		if (named) {
			entry.name = actionName(named[1]);
			if (named[2] !== undefined && !("x" in entry) && !("y" in entry)) { entry.x = Number(named[2]); entry.y = Number(named[3]); }
		}
		for (const axis of ["x", "y"]) if (axis in entry) entry[axis] = clampCoordinate(entry[axis]);
		if ("predict" in entry) { const predict = normalizePrediction(entry.predict); if (predict) entry.predict = predict; else delete entry.predict; }
		return entry;
	});
	const first = Array.isArray(list) && isObject(list[0]) && !("predict" in list[0]) && predict != null ? normalizePrediction(predict) : undefined;
	if (first) list[0] = { ...list[0], predict: first };
	if (list !== undefined) out.actions = list;
	if ("predict_skill" in out) {
		if (typeof out.predict_skill === "string" && out.predict_skill.trim()) out.predict_skill = out.predict_skill.trim().slice(0, 40);
		else delete out.predict_skill;
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
