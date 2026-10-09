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
 * Memory arguments: JSON-string repair (prepareMemoryArguments), then
 * - an unknown op is dropped when batch fields are present (inferred instead);
 * - set/key entries whose key starts with hyp. or strat. become hypotheses or strategies;
 * - an evidence list becomes one hypothesis entry per result;
 * - over-long strings are clipped.
 */
export function repairMemoryArguments(raw: any): any {
	const args = prepareMemoryArguments(raw);
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

/** Skill arguments: infer a missing or unknown op from the fields present. */
export function repairSkillArguments(args: any): any {
	if (!isObject(args)) return args;
	if (["set", "delete", "get"].includes(args.op)) return args;
	const { op: _ignored, ...rest } = args;
	return { ...rest, op: typeof args.source === "string" && args.source.trim() ? "set" : "get" };
}

/** arc_action arguments: an over-long note is clipped rather than refusing the action. */
export function repairActionArguments(args: any): any {
	if (!isObject(args) || typeof args.note !== "string") return args;
	return { ...args, note: clip(args.note.replace(/\s+/g, " ").trim(), LIMITS.note) };
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
