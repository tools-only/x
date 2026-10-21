/**
 * Memory for the thin ARC harness: short facts, a few competing hypotheses and
 * the strategies that depend on them.
 *
 * - A hypothesis answers a question ("controls", "goal"); only hypotheses with
 *   the same question compete. It keeps its prediction, every test result with
 *   the condition it was tested under, and the next distinguishing test.
 * - A test can be recorded once with a verdict for every rival it bears on.
 *   Rivals it did not assess are reported. A refutation the agent has not acted
 *   on marks the hypothesis "contested"; only the agent rejects or narrows it.
 * - A strategy names the hypotheses it depends on and the harness components it
 *   uses. Rejecting or deleting a premise suspends the active strategy that
 *   depends on it (the dependency is the agent's own authorization). Deleting an
 *   untested hypothesis leaves a one-line note, so the alternative is not lost.
 * - Each change of course is logged as a revision with a snapshot of the linked
 *   components; renderRevisions shows what the agent did afterwards.
 *
 * One memory call is one atomic batch. Pure functions; the extension persists
 * the returned rows to memory.jsonl and renders the state into the working set.
 * Design: docs/plans/2026-10-09-thin-hypothesis-memory.md and
 * docs/plans/2026-10-09-thin-hypothesis-strategy-lifecycle.md
 */

export const MAX_FACTS = 40;
/** Room for 2-4 rivals on each of two open questions, as the system prompt asks. */
export const MAX_HYPOTHESES = 8;
export const MAX_EVIDENCE = 6;
export const MAX_STRATEGIES = 4;
/** Dropped notes stay visible for the last DROPPED_CALLS deleting actions, every note of each (at most MAX_HYPOTHESES lines). */
export const DROPPED_CALLS = 3;
export const HYP_PREFIX = "hyp.";
export const STRAT_PREFIX = "strat.";
export const VERDICTS = ["supports", "refutes", "inconclusive"] as const;
export const STATUSES = ["open", "supported", "contested", "rejected"] as const;
export const STRATEGY_STATUSES = ["active", "suspended", "done", "abandoned"] as const;

export type Verdict = typeof VERDICTS[number];
export type Status = typeof STATUSES[number];
export type StrategyStatus = typeof STRATEGY_STATUSES[number];
export type Fact = { text: string; confidence: number; at?: number };
export type Evidence = { action?: number; condition: string; observed: string; verdict: Verdict };
export type Hypothesis = {
	claim: string; question?: string; predicts?: string; status: Status; next_test?: string; evidence: Evidence[];
	/** Action of the refutation that made it contested. */
	contested_at?: number;
	/** Optional Python check(t) the runtime runs on every recorded transition (arc_thin_claims.ts). */
	check?: string;
};
/** since: action count when it last became active; spent: actions while active before that. */
/** steps: the action sequence the agent planned after action #steps_from; the runtime only matches it against the moves taken. */
export type Strategy = {
	plan: string; status: StrategyStatus; depends_on: string[]; uses: string[]; since: number; spent: number; note?: string;
	steps?: string[]; steps_from?: number;
};
export type Dropped = { key: string; claim: string; question?: string; at: number; results: number };
/** linked: component ref → snapshot tag at the revision ("v2", "deleted", a text hash). */
export type Revision = { at: number; causes: string[]; active_before?: string; active_after?: string; linked: Record<string, string> };
export type MemoryState = {
	facts: Map<string, Fact>; hypotheses: Map<string, Hypothesis>; strategies: Map<string, Strategy>;
	dropped: Dropped[]; revisions: Revision[];
};
/**
 * Harness components outside memory that a strategy can use; checks: the rendered check line per hypothesis key;
 * checkSources: each check's code under its hypothesis (the full memory read on demand, not the per-decision views).
 */
export type ComponentContext = { skills?: Record<string, number>; overlay?: string; checks?: Record<string, string>; factProvenance?: boolean; checkSources?: boolean };
export type GoalSupportCheck = (key: string, hypothesis: { question?: string; status?: Status; check?: string }) => string | undefined;

export type HypothesisInput = {
	key: string; claim?: string; question?: string; predicts?: string; status?: Status; next_test?: string; evidence?: Partial<Evidence>;
	/** Python source defining check(t); "" removes the check. */
	check?: string;
};
export type TestInput = { action?: number; condition?: string; observed?: string; verdicts?: Record<string, Verdict> };
export type StrategyInput = { key: string; plan?: string; depends_on?: string[]; uses?: string[]; status?: StrategyStatus; steps?: string[] | string };
export const MAX_STEPS = 64;

/**
 * Action labels as arc_action reports them (ACTION4, ACTION6(3,7), RESET). "A4", lower case, spaces and a single
 * string of labels separated by spaces or commas are accepted; undefined when any label is not an action.
 */
export function normalizeSteps(raw: unknown): string[] | undefined {
	const items = typeof raw === "string" ? raw.split(/[\s,;]+(?![^()]*\))/) : Array.isArray(raw) ? raw.map(String) : undefined;
	if (!items) return undefined;
	const steps: string[] = [];
	for (const item of items) {
		const label = item.toUpperCase().replace(/\s+/g, "").replace(/^A(\d)/, "ACTION$1");
		if (!label) continue;
		if (!/^(ACTION[1-7](\(\d{1,2},\d{1,2}\))?|RESET)$/.test(label)) return undefined;
		steps.push(label);
	}
	return steps;
}

/**
 * How far the moves after #steps_from follow the planned steps. Mechanical: labels are compared one by one and
 * tracking stops at the first move that differs; whether the plan is still right is the agent's judgement.
 */
export function stepsProgress(s: Pick<Strategy, "steps" | "steps_from">, actions: string[]): string {
	const steps = s.steps ?? [];
	if (!steps.length) return "";
	const from = s.steps_from ?? 0;
	const taken = actions.slice(from);
	let k = 0;
	while (k < steps.length && k < taken.length && taken[k] === steps[k]) k += 1;
	const head = `steps planned after #${from}: ${k}/${steps.length} followed`;
	if (k === steps.length) return `${head} (#${from + 1}–#${from + k}); all done`;
	if (k < taken.length) return `${head}; #${from + k + 1} was ${taken[k]} where step ${k + 1} is ${steps[k]}, so the steps are no longer tracked`;
	const next = steps.slice(k, k + 8);
	return `${head}; next ${next.join(", ")}${steps.length - k > next.length ? `, … (${steps.length - k} left)` : ""}`;
}
export type MemoryParams = {
	op?: "set" | "delete" | "list" | "update";
	key?: string; text?: string; confidence?: number;
	set?: Array<{ key: string; text: string; confidence?: number; replaces?: string[] | string }>;
	delete?: string[];
	hypotheses?: HypothesisInput[];
	tests?: TestInput[];
	strategies?: StrategyInput[];
};

/** A memory.jsonl row (the extension adds a timestamp). */
export type MemoryRow =
	| { key: string; deleted: true; dropped?: Dropped }
	| { key: string; text: string; confidence: number }
	| { key: string; hyp: Hypothesis }
	| { key: string; strat: Strategy }
	| { key: "rev"; rev: Revision };

export type MemoryPlan =
	| { ok: true; rows: MemoryRow[]; receipt: string }
	| { ok: false; error: string };

export const emptyMemory = (): MemoryState => ({
	facts: new Map(), hypotheses: new Map(), strategies: new Map(), dropped: [], revisions: [],
});

export function resetMemory(state: MemoryState): void {
	state.facts.clear(); state.hypotheses.clear(); state.strategies.clear();
	state.dropped.length = 0; state.revisions.length = 0;
}

/** Replay one stored row; also used to apply a committed plan. Legacy rows are facts. */
export function applyRow(state: MemoryState, row: any): void {
	const key = String(row?.key ?? "");
	if (!key) return;
	if (row.rev && typeof row.rev === "object") { state.revisions.push(row.rev as Revision); return; }
	if (row.deleted) {
		state.facts.delete(key); state.hypotheses.delete(key); state.strategies.delete(key);
		if (row.dropped && typeof row.dropped === "object") state.dropped.push(row.dropped as Dropped);
		return;
	}
	if (row.hyp && typeof row.hyp === "object") {
		state.hypotheses.set(key, row.hyp as Hypothesis);
		const index = state.dropped.findIndex((item) => item.key === key);
		if (index >= 0) state.dropped.splice(index, 1);
		return;
	}
	if (row.strat && typeof row.strat === "object") { state.strategies.set(key, row.strat as Strategy); return; }
	if (typeof row.text === "string") state.facts.set(key, { text: row.text, confidence: Number(row.confidence) || 3,
		...(Number.isInteger(row.at) && row.at >= 0 ? {at:row.at} : {}) });
}

const prefixed = (prefix: string) => (key: string) => {
	const trimmed = String(key).trim();
	return trimmed.startsWith(prefix) ? trimmed : prefix + trimmed;
};
const hypKey = prefixed(HYP_PREFIX);
const stratKey = prefixed(STRAT_PREFIX);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const names = (keys: string[], max = 12) => keys.length <= max ? keys.join(", ") : `${keys.slice(0, max).join(", ")}, … (+${keys.length - max})`;
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const textHash = (text: string) => {
	let hash = 5381;
	for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
	return `#${hash.toString(36)}`;
};
const hasRefutation = (h: Hypothesis | undefined) => Boolean(h?.evidence.some((e) => e.verdict === "refutes"));

/** Snapshot tag of one component reference; undefined when the reference is malformed. */
function componentTag(ref: string, facts: Map<string, Fact>, ctx: ComponentContext): string | undefined {
	if (ref === "prompt") return ctx.overlay ? textHash(ctx.overlay) : "empty";
	const [kind, ...rest] = ref.split(":");
	const name = rest.join(":");
	if (!name) return undefined;
	if (kind === "skill") return ctx.skills?.[name] !== undefined ? `v${ctx.skills[name]}` : "deleted";
	if (kind === "memory") return facts.has(name) ? textHash(facts.get(name)!.text) : "deleted";
	return undefined;
}

/** Hypotheses that compete with `key`: same question, not rejected. */
function rivalsOf(hypotheses: Map<string, Hypothesis>, key: string): string[] {
	const question = hypotheses.get(key)?.question;
	if (!question) return [];
	return [...hypotheses].filter(([other, h]) => other !== key && h.question === question && h.status !== "rejected").map(([other]) => other);
}

/** One recorded test on a question, with the verdict it gave each hypothesis it was recorded against. */
export type QuestionTest = { id: string; action?: number; verdicts: Map<string, Verdict> };

/**
 * The tests recorded on one question, from the results the hypotheses still
 * hold (each keeps its latest MAX_EVIDENCE). Results belong to the same test
 * when they share an action number, or a condition and observation when they
 * have none. Rejected hypotheses count: their refutation is often the result
 * that separated them from a rival.
 */
export function questionTests(hypotheses: Map<string, Hypothesis>, question: string): QuestionTest[] {
	const tests = new Map<string, QuestionTest>();
	for (const [key, h] of hypotheses) {
		if (h.question !== question) continue;
		for (const e of h.evidence) {
			const id = e.action !== undefined ? `#${e.action}` : `${e.condition}|${e.observed}`;
			const test = tests.get(id) ?? { id, ...(e.action !== undefined ? { action: e.action } : {}), verdicts: new Map<string, Verdict>() };
			test.verdicts.set(key, e.verdict);
			tests.set(id, test);
		}
	}
	return [...tests.values()];
}

/** A test told rivals apart when it gave at least two of them different verdicts. Counting only; no judgement. */
export const toldApart = (test: QuestionTest) => new Set(test.verdicts.values()).size >= 2;

/** Tests that gave `key` a different verdict than at least one hypothesis with the same question. */
export function testsToldApart(hypotheses: Map<string, Hypothesis>, key: string): QuestionTest[] {
	const question = hypotheses.get(key)?.question;
	return question ? questionTests(hypotheses, question).filter((test) => test.verdicts.has(key) && toldApart(test)) : [];
}

const sameQuestion = (hypotheses: Map<string, Hypothesis>, question: string | undefined) =>
	question ? [...hypotheses].filter(([, h]) => h.question === question).length : 0;

const premiseLine = (hypotheses: Map<string, Hypothesis>, key: string) => {
	const h = hypotheses.get(key);
	if (!h) return `${key} (deleted)`;
	const rivals = rivalsOf(hypotheses, key);
	return `${key} [${h.status}] ` + (rivals.length
		? `(rivals: ${rivals.map((r) => `${r} [${hypotheses.get(r)!.status}]`).join(", ")})`
		: `(no recorded rival${h.question ? ` for "${h.question}"` : "; set question to group rivals"})`);
};

/**
 * Validate a memory call against the current state and return the rows to
 * append. Nothing is applied when any part is invalid.
 */
export function planMemoryUpdate(state: MemoryState, params: MemoryParams, actionCount: number, ctx: ComponentContext = {}, goalSupport?: GoalSupportCheck): MemoryPlan {
	const op = params.op ?? (params.set || params.delete || params.hypotheses || params.tests || params.strategies ? "update"
		: params.text !== undefined ? "set" : undefined);
	if (op === "list") return { ok: true, rows: [], receipt: renderMemory(state, actionCount, [], ctx) };
	if (!op) return { ok: false, error: "memory needs set=[...], delete=[...], hypotheses=[...], tests=[...] or strategies=[...] (or key+text, or op=\"list\")." };

	const errors: string[] = [];
	const notes: string[] = [];
	const sets = [...(params.set ?? [])];
	const deletes = [...(params.delete ?? [])];
	// A corrected belief retires the ones it corrects in the same call: `replaces` deletes them. At decision 77 of a
	// real run (hypstrategy ls20, 2026-10-11) "toggles", "extends up" and the corrected "moves up" were all shown
	// side by side, because the agent wrote each correction under a new key and never deleted the old ones.
	const replaced: string[] = [];
	for (const item of sets) {
		const list = Array.isArray(item?.replaces) ? item.replaces : typeof item?.replaces === "string" ? [item.replaces] : [];
		for (const old of list.map((key) => String(key).trim()).filter((key) => key && key !== String(item.key ?? "").trim())) {
			if (!deletes.includes(old)) deletes.push(old);
			replaced.push(`${String(item.key).trim()} replaces ${old}`);
		}
	}
	if (op === "delete") {
		if (params.key) deletes.push(params.key);
		else if (!deletes.length) errors.push(`op="delete" needs key or delete=[...]`);
	} else if (params.key !== undefined || params.text !== undefined) {
		if (!params.key || !nonEmpty(params.text)) errors.push("a single set needs both key and text");
		else sets.push({ key: params.key, text: params.text, ...(params.confidence !== undefined ? { confidence: params.confidence } : {}) });
	}

	const facts = new Map(state.facts);
	const hypotheses = new Map(state.hypotheses);
	const strategies = new Map(state.strategies);
	const rows: MemoryRow[] = [];
	const changedHyps = new Map<string, string[]>();
	const changedStrats = new Map<string, string[]>();
	const touch = (map: Map<string, string[]>, key: string, note?: string) => {
		const list = map.get(key) ?? [];
		if (note) list.push(note);
		map.set(key, list);
	};
	const activeBefore = [...state.strategies].find(([, s]) => s.status === "active")?.[0];

	// ------------------------------------------------------------ deletes
	const deleted: string[] = [];
	const missing: string[] = [];
	const dropped: Dropped[] = [];
	const deletedHyps: string[] = [];
	const deletedRecords: string[] = [];
	const causes: string[] = [];
	for (const raw of deletes) {
		const pattern = String(raw).trim();
		const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : undefined;
		if (prefix !== undefined && prefix.length < 2) { errors.push(`delete "${pattern}": a prefix needs at least 2 characters`); continue; }
		const all = [...facts.keys(), ...hypotheses.keys(), ...strategies.keys()];
		const matches = prefix !== undefined ? all.filter((key) => key.startsWith(prefix))
			: all.includes(pattern) ? [pattern]
			: hypotheses.has(hypKey(pattern)) ? [hypKey(pattern)]
			: strategies.has(stratKey(pattern)) ? [stratKey(pattern)] : [];
		if (!matches.length) { missing.push(pattern); continue; }
		for (const key of matches) {
			const h = hypotheses.get(key);
			const s = strategies.get(key);
			let tombstone: Dropped | undefined;
			if (h) {
				deletedHyps.push(key);
				// What is being dropped, counted from the records as they stood before this call.
				if (sameQuestion(state.hypotheses, h.question) >= 2)
					deletedRecords.push(`${key} ${h.evidence.length} result(s), ${h.evidence.filter((e) => e.verdict === "refutes").length} refuting, ` +
						`${testsToldApart(state.hypotheses, key).length} that told it apart from a rival`);
				// A deleted alternative that was never refuted stays visible as one line.
				if (!hasRefutation(h)) {
					tombstone = { key, claim: clip(h.claim, 160), ...(h.question ? { question: h.question } : {}), at: actionCount, results: h.evidence.length };
					dropped.push(tombstone);
				}
			}
			if (s?.status === "active") causes.push(`${key} deleted`);
			facts.delete(key); hypotheses.delete(key); strategies.delete(key);
			changedHyps.delete(key); changedStrats.delete(key);
			rows.push({ key, deleted: true, ...(tombstone ? { dropped: tombstone } : {}) });
			deleted.push(key);
		}
	}

	// ------------------------------------------------------------ facts
	const setKeys: string[] = [];
	for (const item of sets) {
		const key = String(item?.key ?? "").trim();
		if (!key) { errors.push("set: every entry needs key"); continue; }
		if (key.startsWith(HYP_PREFIX) || key.startsWith(STRAT_PREFIX)) {
			errors.push(`set "${key}": keys starting with ${HYP_PREFIX} or ${STRAT_PREFIX} are hypotheses or strategies; use hypotheses=[...] or strategies=[...]`);
			continue;
		}
		if (!nonEmpty(item.text)) { errors.push(`set "${key}": needs text`); continue; }
		const confidence = Math.min(5, Math.max(1, Math.round(Number(item.confidence ?? facts.get(key)?.confidence ?? 3)) || 3));
		facts.set(key, { text: item.text, confidence });
		rows.push({ key, text: item.text, confidence });
		setKeys.push(key);
	}

	// ------------------------------------------------------------ hypotheses and tests
	const explicitStatus = new Set<string>();
	const claimChanged = new Set<string>();
	const statusBefore = new Map<string, Status | undefined>();
	/** Appended results, grouped by test (same action number, or one tests[] item). */
	const appended: Array<{ key: string; group: string; action?: number; verdict: Verdict }> = [];

	const checkAction = (value: unknown, problems: string[]): number | undefined => {
		const action = value === undefined || value === null ? undefined : Number(value);
		if (action !== undefined && !(Number.isInteger(action) && action >= 1 && action <= actionCount))
			problems.push(`action #${value} does not exist (actions so far: ${actionCount})`);
		return action;
	};
	const appendEvidence = (key: string, evidence: Evidence, group: string) => {
		const h = hypotheses.get(key)!;
		const next = { ...h, evidence: [...h.evidence, evidence] };
		let note = `+evidence ${evidence.action !== undefined ? `#${evidence.action} ` : ""}${evidence.verdict}`;
		while (next.evidence.length > MAX_EVIDENCE) {
			// Refutations carry the scope of a rejection; drop the oldest other result first.
			const drop = next.evidence.findIndex((row) => row.verdict !== "refutes");
			next.evidence.splice(drop >= 0 ? drop : 0, 1);
			note += " (oldest result dropped)";
		}
		hypotheses.set(key, next);
		touch(changedHyps, key, note);
		appended.push({ key, group, ...(evidence.action !== undefined ? { action: evidence.action } : {}), verdict: evidence.verdict });
	};

	for (const item of params.hypotheses ?? []) {
		if (!nonEmpty(item?.key)) { errors.push("hypotheses: every entry needs key"); continue; }
		const key = hypKey(item.key);
		const existing = hypotheses.get(key);
		if (!existing && !nonEmpty(item.claim)) { errors.push(`${key}: a new hypothesis needs claim`); continue; }
		if (!statusBefore.has(key)) statusBefore.set(key, state.hypotheses.get(key)?.status);
		const claim = nonEmpty(item.claim) ? item.claim.trim() : existing!.claim;
		if (existing && claim !== existing.claim) claimChanged.add(key);
		if (item.status) explicitStatus.add(key);
		const question = nonEmpty(item.question) ? item.question.trim().toLowerCase().slice(0, 40) : existing?.question;
		const proposed = { key, question, status: item.status ?? existing?.status ?? "open", check: typeof item.check === "string" ? item.check : existing?.check };
		const refusal = goalSupport?.(key, proposed);
		if (refusal) { errors.push(refusal); continue; }
		const next: Hypothesis = {
			claim,
			...(question ? { question } : {}),
			...(nonEmpty(item.predicts) ? { predicts: item.predicts.trim() } : existing?.predicts ? { predicts: existing.predicts } : {}),
			status: item.status ?? existing?.status ?? "open",
			...(nonEmpty(item.next_test) ? { next_test: item.next_test.trim() } : existing?.next_test ? { next_test: existing.next_test } : {}),
			evidence: [...(existing?.evidence ?? [])],
			...(existing?.contested_at !== undefined ? { contested_at: existing.contested_at } : {}),
			...(typeof item.check === "string" ? (item.check.trim() ? { check: item.check.replace(/\s+$/, "") + "\n" } : {})
				: existing?.check ? { check: existing.check } : {}),
		};
		hypotheses.set(key, next);
		touch(changedHyps, key, existing ? (typeof item.check === "string" && item.check.trim() !== (existing.check ?? "").trim()
			? (item.check.trim() ? "check updated" : "check removed") : undefined)
			: item.check?.trim() ? "new, with check" : "new");
		const e = item.evidence;
		if (e !== undefined) {
			const problems: string[] = [];
			if (!nonEmpty(e.condition)) problems.push("condition (the state that mattered when you tested)");
			if (!nonEmpty(e.observed)) problems.push("observed");
			if (!VERDICTS.includes(e.verdict as Verdict)) problems.push(`verdict (${VERDICTS.join("|")})`);
			const action = checkAction(e.action, problems);
			if (problems.length) { errors.push(`${key} evidence needs ${problems.join(", ")}`); continue; }
			appendEvidence(key, { ...(action !== undefined ? { action } : {}), condition: e.condition!.trim(), observed: e.observed!.trim(), verdict: e.verdict as Verdict },
				action !== undefined ? `#${action}` : `evidence:${key}`);
		}
	}

	const testLines: string[] = [];
	(params.tests ?? []).forEach((test, index) => {
		const problems: string[] = [];
		if (!nonEmpty(test?.condition)) problems.push("condition (the state that mattered when you tested)");
		if (!nonEmpty(test?.observed)) problems.push("observed");
		const action = checkAction(test?.action, problems);
		const entries = Object.entries(test?.verdicts ?? {});
		if (!entries.length) problems.push(`verdicts {"hyp.<name>": ${VERDICTS.join("|")}} for the hypotheses this test bears on`);
		const resolved: Array<[string, Verdict]> = [];
		for (const [rawKey, verdict] of entries) {
			const key = hypKey(rawKey);
			if (!hypotheses.has(key)) problems.push(`${key} does not exist (hypotheses: ${names([...hypotheses.keys()]) || "none"})`);
			else if (!VERDICTS.includes(verdict)) problems.push(`${key}: verdict must be ${VERDICTS.join("|")}`);
			else resolved.push([key, verdict]);
		}
		const label = `tests[${index}]${action !== undefined ? ` #${action}` : ""}`;
		if (problems.length) { errors.push(`${label} needs ${problems.join(", ")}`); return; }
		for (const [key, verdict] of resolved) {
			if (!statusBefore.has(key)) statusBefore.set(key, state.hypotheses.get(key)?.status);
			appendEvidence(key, { ...(action !== undefined ? { action } : {}), condition: test.condition!.trim(), observed: test.observed!.trim(), verdict },
				action !== undefined ? `#${action}` : `tests[${index}]`);
		}
		testLines.push(`${action !== undefined ? `#${action}` : label} → ${resolved.map(([key, verdict]) => `${key} ${verdict}`).join(", ")}`);
	});

	// A refutation the agent did not act on in the same call leaves the hypothesis contested.
	const contested: string[] = [];
	for (const key of changedHyps.keys()) {
		const h = hypotheses.get(key);
		if (!h) continue;
		const refuted = appended.filter((item) => item.key === key && item.verdict === "refutes");
		let next = h;
		if (refuted.length && !explicitStatus.has(key) && !claimChanged.has(key) && h.status !== "rejected") {
			next = { ...h, status: "contested", contested_at: refuted.at(-1)!.action ?? actionCount };
			contested.push(key);
		} else if (next.status !== "contested" && next.contested_at !== undefined) {
			const { contested_at: _, ...rest } = next;
			next = rest;
		}
		hypotheses.set(key, next);
	}

	// Rivals a recorded test did not assess (same question, not rejected).
	const unassessed: string[] = [];
	for (const group of new Set(appended.map((item) => item.group))) {
		const inGroup = appended.filter((item) => item.group === group);
		const named = new Set(inGroup.map((item) => item.key));
		const questions = new Set(inGroup.map((item) => hypotheses.get(item.key)?.question).filter(Boolean));
		const left = [...hypotheses].filter(([key, h]) => !named.has(key) && h.question && questions.has(h.question) && h.status !== "rejected")
			.map(([key]) => key);
		if (left.length) unassessed.push(`${group.startsWith("#") ? group : "this test"}: ${left.join(", ")}`);
	}

	// ------------------------------------------------------------ strategies
	const explicitActive = new Set<string>();
	const ignoredUses: string[] = [];
	// A new strategy without a status becomes active unless this call activates another one.
	const items = (params.strategies ?? []).filter((item) => nonEmpty(item?.key));
	const defaultActive = items.some((item) => item.status === "active") ? undefined
		: items.find((item) => !item.status && !strategies.has(stratKey(item.key)))?.key;
	const setStatus = (key: string, s: Strategy, status: StrategyStatus, note?: string): Strategy => {
		if (s.status === status) return note ? { ...s, note } : s;
		const leaving = s.status === "active";
		const next: Strategy = {
			...s, status,
			spent: s.spent + (leaving ? Math.max(0, actionCount - s.since) : 0),
			since: status === "active" ? actionCount : s.since,
		};
		if (note) next.note = note; else delete next.note;
		if (leaving) causes.push(`${key} ${status}${note ? ` (${note})` : ""}`);
		return next;
	};
	for (const item of params.strategies ?? []) {
		if (!nonEmpty(item?.key)) { errors.push("strategies: every entry needs key"); continue; }
		const key = stratKey(item.key);
		const existing = strategies.get(key);
		if (!existing && !nonEmpty(item.plan)) { errors.push(`${key}: a new strategy needs plan`); continue; }
		const depends = item.depends_on === undefined ? existing?.depends_on ?? [] : [...new Set(item.depends_on.map((k) => hypKey(k)))];
		const unknown = depends.filter((k) => !hypotheses.has(k) && !existing?.depends_on.includes(k));
		if (unknown.length) {
			errors.push(`${key}: depends_on ${unknown.join(", ")} does not exist (hypotheses: ${names([...hypotheses.keys()]) || "none"}); create it in the same call`);
			continue;
		}
		let uses = existing?.uses ?? [];
		if (item.uses !== undefined) {
			uses = [];
			for (const raw of item.uses) {
				const ref = String(raw).trim();
				const tag = componentTag(ref, facts, ctx);
				if (tag === undefined || tag === "deleted") ignoredUses.push(ref); else if (!uses.includes(ref)) uses.push(ref);
			}
		}
		let next: Strategy = existing
			? { ...existing, ...(nonEmpty(item.plan) ? { plan: item.plan.trim() } : {}), depends_on: depends, uses }
			: { plan: item.plan!.trim(), status: "suspended", depends_on: depends, uses, since: actionCount, spent: 0 };
		if (item.steps !== undefined) {
			const steps = normalizeSteps(item.steps);
			if (!steps) { errors.push(`${key}: steps must be action names such as ACTION4, ACTION6(3,7) or RESET`); continue; }
			if (steps.length > MAX_STEPS) { errors.push(`${key}: at most ${MAX_STEPS} steps`); continue; }
			const { steps: _steps, steps_from: _from, ...rest } = next;
			next = steps.length ? { ...rest, steps, steps_from: actionCount } : rest;
		}
		const status = item.status ?? (existing ? existing.status : item.key === defaultActive ? "active" : "suspended");
		if (item.status === "active" || (!existing && status === "active")) explicitActive.add(key);
		next = setStatus(key, next, status);
		strategies.set(key, next);
		touch(changedStrats, key, existing ? (existing.status !== next.status ? `→ ${next.status}` : undefined) : `new, ${next.status}`);
		if (item.steps !== undefined)
			touch(changedStrats, key, next.steps ? `${next.steps.length} steps tracked from #${actionCount + 1}` : "steps cleared");
	}
	if (explicitActive.size > 1) errors.push(`only one strategy can be active; this call activates ${[...explicitActive].join(", ")}`);
	// Activating one strategy suspends the one that was active.
	const activated = [...explicitActive][0];
	if (activated) for (const [key, s] of strategies) if (key !== activated && s.status === "active") {
		strategies.set(key, setStatus(key, s, "suspended", `replaced by ${activated} after #${actionCount}`));
		touch(changedStrats, key, `→ suspended (replaced by ${activated})`);
	}

	// Rejected or deleted premises suspend the active strategy that depends on them.
	// A hypothesis created already rejected is a record, not a change of course.
	const newlyRejected = [...changedHyps.keys()].filter((key) => state.hypotheses.has(key)
		&& hypotheses.get(key)?.status === "rejected" && statusBefore.get(key) !== "rejected");
	for (const key of newlyRejected) causes.push(`${key} rejected`);
	for (const premise of [...newlyRejected, ...deletedHyps]) {
		for (const [key, s] of strategies) {
			if (!s.depends_on.includes(premise)) continue;
			if (deletedHyps.includes(premise) && !newlyRejected.includes(premise) && !causes.includes(`${premise} deleted`)) causes.push(`${premise} deleted`);
			if (s.status !== "active" || explicitActive.has(key)) continue;
			const why = `${premise} ${newlyRejected.includes(premise) ? "rejected" : "deleted"} after #${actionCount}`;
			strategies.set(key, setStatus(key, s, "suspended", why));
			touch(changedStrats, key, `→ suspended (${why})`);
		}
	}

	if (facts.size > MAX_FACTS)
		errors.push(`memory would hold ${facts.size} facts (max ${MAX_FACTS}); delete more in the same call, e.g. delete=["state_*"]`);
	if (hypotheses.size > MAX_HYPOTHESES)
		errors.push(`memory would hold ${hypotheses.size} hypotheses (max ${MAX_HYPOTHESES}); delete or merge one in the same call`);
	if (strategies.size > MAX_STRATEGIES)
		errors.push(`memory would hold ${strategies.size} strategies (max ${MAX_STRATEGIES}); delete a done or abandoned one in the same call`);
	if (errors.length)
		return { ok: false, error: `memory NOT changed (nothing in this call was applied):\n- ${errors.join("\n- ")}` };

	for (const key of changedHyps.keys()) rows.push({ key, hyp: hypotheses.get(key)! });
	for (const key of changedStrats.keys()) rows.push({ key, strat: strategies.get(key)! });

	// One revision row per call that changed course; it snapshots the components linked to it.
	const activeAfter = [...strategies].find(([, s]) => s.status === "active")?.[0];
	if (causes.length) {
		const affected = new Set<string>();
		if (activeBefore && activeBefore !== activeAfter) affected.add(activeBefore);
		for (const [key, s] of strategies)
			if (s.depends_on.some((k) => newlyRejected.includes(k) || deletedHyps.includes(k))) affected.add(key);
		const linked: Record<string, string> = {};
		for (const key of affected)
			for (const ref of (strategies.get(key) ?? state.strategies.get(key))?.uses ?? [])
				linked[ref] = componentTag(ref, state.facts, ctx) ?? "deleted";
		rows.push({ key: "rev", rev: {
			at: actionCount, causes: [...new Set(causes)],
			...(activeBefore ? { active_before: activeBefore } : {}), ...(activeAfter ? { active_after: activeAfter } : {}), linked,
		} });
	}
	if (!rows.length && !missing.length) return { ok: false, error: "memory call had nothing to change" };

	// ------------------------------------------------------------ receipt
	if (contested.length)
		notes.push(`contested: ${contested.join(", ")} — narrow the claim to where it held, reject it, or restate its status`);
	for (const key of changedHyps.keys()) {
		const h = hypotheses.get(key)!;
		// Rejecting a hypothesis is the agent's judgment; missing evidence is a
		// description of its record, not a reason to discard an otherwise valid batch.
		if (h.status === "rejected" && !hasRefutation(h))
			notes.push(`${key} rejected without a recorded refutation`);
		if (h.status === "supported" && statusBefore.get(key) !== "supported") {
			const rivals = rivalsOf(hypotheses, key);
			if (rivals.length) notes.push(`${key} supported; rivals still open under "${h.question}": ${rivals.join(", ")} — support for one does not refute them`);
		}
		if (newlyRejected.includes(key) && h.question) {
			if (sameQuestion(hypotheses, h.question) >= 2 && !testsToldApart(hypotheses, key).length)
				notes.push(`${key} rejected; no recorded test gave it a different verdict than a rival`);
			const left = rivalsOf(hypotheses, key);
			notes.push(left.length
				? `"${h.question}" still has ${left.map((r) => `${r} [${hypotheses.get(r)!.status}]`).join(", ")} — rejecting ${key} does not confirm them`
				: `no live hypothesis left for "${h.question}": propose the next alternatives`);
		}
	}
	if (activated && changedStrats.has(activated)) {
		const s = strategies.get(activated)!;
		notes.push(`${activated} active; premises: ${s.depends_on.length ? s.depends_on.map((k) => premiseLine(hypotheses, k)).join("; ") : "none named (depends_on)"}`);
	}
	for (const [key, s] of strategies) {
		if (!changedStrats.has(key) || s.status !== "suspended" || state.strategies.get(key)?.status !== "active") continue;
		if (s.uses.length) notes.push(`${key} suspended; it uses ${s.uses.join(", ")} — revise or delete whatever encoded the dropped premise`);
	}

	const hypNotes = [...changedHyps].map(([key, list]) => `${key} (${list.length ? list.join(" ") : "updated"}` +
		`${statusBefore.get(key) && statusBefore.get(key) !== hypotheses.get(key)!.status ? ` → ${hypotheses.get(key)!.status}` : ""})`);
	const parts = [
		setKeys.length ? `set ${names(setKeys)}` : "",
		replaced.length ? names(replaced, 6) : "",
		deleted.length ? `deleted ${deleted.length} (${names(deleted)})` : "",
		dropped.length ? `kept as one-line notes because no refutation was recorded: ${names(dropped.map((d) => d.key))} (re-create one to test it)` : "",
		deletedRecords.length ? `deleted with: ${deletedRecords.join("; ")}` : "",
		hypNotes.length ? `hypotheses ${hypNotes.join("; ")}` : "",
		testLines.length ? `tests ${testLines.join("; ")}` : "",
		unassessed.length ? `rivals not assessed by ${unassessed.join("; ")}` : "",
		changedStrats.size ? `strategies ${[...changedStrats].map(([key, list]) => `${key}${list.length ? ` (${list.join(", ")})` : ""}`).join("; ")}` : "",
		ignoredUses.length ? `ignored uses (not a saved skill, memory key or "prompt"): ${ignoredUses.join(", ")}` : "",
		missing.length ? `not found: ${names(missing)}` : "",
		...notes,
	].filter(Boolean);
	return { ok: true, rows, receipt: `memory: ${parts.join("; ")}. Now ${facts.size} facts, ${hypotheses.size} hypotheses, ${strategies.size} strategies.` };
}

/** Commit planned rows to the in-memory state. */
export function applyRows(state: MemoryState, rows: MemoryRow[]): void {
	for (const row of rows) applyRow(state, row);
}

export function renderFacts(state: MemoryState, provenance = false): string {
	if (state.facts.size === 0) return `MEMORY: empty — save what you learn with memory(set=[{key, text}]).`;
	return [`MEMORY (${state.facts.size}):`,
		...[...state.facts].map(([key, entry]) => `- ${key}: ${JSON.stringify(entry.text)} (conf ${entry.confidence})${provenance ? factSource(entry) : ''}`)].join("\n");
}
const factSource = (entry: Fact) => entry.at !== undefined ? ` [recorded at #${entry.at}; check current applicability]` : ' [source unknown]';

/**
 * A bounded parent-facing memory view. Durable memory remains lossless in
 * memory.jsonl and in the skill state; this view avoids charging every parent
 * turn for old prose that is already superseded by the current hypothesis and
 * strategy. Keys remain visible so the Agent can request the full view when a
 * detail matters.
 */
export function renderFactsCompact(state: MemoryState, maxChars = 2200, provenance = false): string {
	if (state.facts.size === 0) return `MEMORY: empty — save what you learn with memory(set=[{key, text}]).`;
	const entries = [...state.facts];
	const lines = [`MEMORY (${state.facts.size}; compact parent view):`];
	let room = Math.max(320, maxChars - lines[0].length);
	for (const [key, entry] of entries) {
		const prefix = `- ${key} (conf ${entry.confidence})${provenance ? factSource(entry) : ''}: `;
		const budget = Math.max(40, Math.min(220, room - prefix.length - 1));
		const text = entry.text.length > budget ? `${entry.text.slice(0, Math.max(0, budget - 1))}…` : entry.text;
		const line = `${prefix}${JSON.stringify(text)}`;
		if (lines.join("\n").length + line.length + 1 > maxChars && lines.length > 1) break;
		lines.push(line);
		room -= line.length + 1;
	}
	const shown = lines.length - 1;
	if (shown < entries.length)
		lines.push(`- … ${entries.length - shown} older/longer entries retained; use memory(op="list") only when a full detail is needed.`);
	return lines.join("\n");
}

/**
 * Notes from the last DROPPED_CALLS actions that deleted untested hypotheses.
 * A batch is shown whole: one call often drops several alternatives together
 * (a real run dropped four at once, the correct one first), and a recency cut
 * by line would hide the earliest of them.
 */
export function visibleDropped(dropped: Dropped[]): Dropped[] {
	const calls = [...new Set(dropped.map((item) => item.at))].slice(-DROPPED_CALLS);
	return dropped.filter((item) => calls.includes(item.at)).slice(-MAX_HYPOTHESES);
}

const STATUS_ORDER: Record<Status, number> = { open: 0, contested: 1, supported: 2, rejected: 3 };
const lastTested = (h: Hypothesis) => Math.max(0, ...h.evidence.map((e) => e.action ?? 0));
/** Evidence lines shown per live hypothesis; the rest is counted (all of it stays in memory.jsonl and state.hypotheses). */
const SHOWN_EVIDENCE = 2;

/**
 * Hypothesis evidence as shown at every decision: identical records once, the latest SHOWN_EVIDENCE, and the
 * latest refutation even when older (it is what keeps a claim scoped). Memory was the largest section of the
 * working set in the 2026-10-10/11 runs (5.3-5.6k chars, more than the grid), with the same records repeated.
 */
function evidenceLines(h: Hypothesis): string[] {
	const line = (e: Hypothesis["evidence"][number]) =>
		`  ${e.action !== undefined ? `#${e.action}` : "(no action)"} ${e.verdict} when ${JSON.stringify(e.condition)}: ${e.observed}`;
	const unique: Array<Hypothesis["evidence"][number]> = [];
	const seen = new Set<string>();
	for (const e of h.evidence) {
		const id = `${e.action ?? ""}|${e.verdict}|${e.condition}|${e.observed}`;
		if (!seen.has(id)) { seen.add(id); unique.push(e); }
	}
	const shown = unique.slice(-SHOWN_EVIDENCE);
	const refutation = [...unique].reverse().find((e) => e.verdict === "refutes");
	if (refutation && !shown.includes(refutation)) shown.unshift(refutation);
	const hidden = unique.length - shown.length;
	return [...(hidden > 0 ? [`  (${hidden} earlier result(s) not shown; state.hypotheses has all)`] : []), ...shown.map(line)];
}

export function renderHypotheses(state: MemoryState, actionCount: number, checks: Record<string, string> = {}, sources = false): string {
	const all = [...state.hypotheses];
	const count = (status: Status) => all.filter(([, h]) => h.status === status).length;
	const lines = [all.length
		? `HYPOTHESES (${STATUSES.map((s) => `${count(s)} ${s}`).join(", ")}; only hypotheses with the same question compete; ` +
			`a refutation only covers the condition it was tested under):`
		: `HYPOTHESES: none — keep 2-4 competing ones per question with memory(hypotheses=[{key:"hyp.<name>", question, claim, predicts, next_test}]).`];
	const questions = [...new Set(all.map(([, h]) => h.question ?? ""))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1));
	const grouped = questions.some(Boolean);
	for (const question of questions) {
		const members = all.filter(([, h]) => (h.question ?? "") === question)
			.sort((a, b) => STATUS_ORDER[a[1].status] - STATUS_ORDER[b[1].status]);
		// Which recorded tests gave rivals different verdicts: a count of the agent's own records.
		const tests = question && members.length >= 2 ? questionTests(state.hypotheses, question) : [];
		const apart = tests.filter(toldApart);
		const apartLabel = apart.slice(-4).map((test) => test.action !== undefined ? `#${test.action}` : "(no action)").join(", ");
		if (grouped) lines.push(!question ? "no question (no rivals):" : `question "${question}":` + (tests.length
			? ` ${tests.length} test(s) recorded, ${apart.length ? `${apart.length} told rivals apart (${apartLabel})` : "none told rivals apart"}`
			: ""));
		const latestRivalTest = question ? Math.max(0, ...members.map(([, h]) => lastTested(h))) : 0;
		for (const [key, h] of members) {
			// A rejected hypothesis is a settled record: its claim and the refutation that scopes it (a refutation only
			// covers the condition it was tested under). Its other evidence and its prediction stay in memory.jsonl.
			if (h.status === "rejected") {
				const refutation = [...h.evidence].reverse().find((e) => e.verdict === "refutes");
				const more = h.evidence.length - (refutation ? 1 : 0);
				lines.push(`- ${key} [rejected] ${h.claim}` + (more > 0 ? ` (${more} other result(s) kept)` : ""));
				if (refutation) lines.push(`  ${refutation.action !== undefined ? `#${refutation.action}` : "(no action)"} refutes when ` +
					`${JSON.stringify(refutation.condition)}: ${refutation.observed}`);
			} else {
				lines.push(`- ${key} [${h.status}] ${h.claim}`);
				if (h.predicts) lines.push(`  predicts: ${h.predicts}`);
				if (h.check) lines.push(`  ${checks[key] ?? "check: not run yet"}`);
				// The code itself, where the full memory is read on demand: the refinements' working checks were never
				// visible to the agent as examples (decision views carry the claim and the counts only).
				if (h.check && sources) lines.push("  check source:", ...h.check.replace(/\s+$/, "").split("\n").map((line) => `    ${line}`));
				for (const line of evidenceLines(h)) lines.push(line);
			}
			const last = lastTested(h);
			lines.push(`  last tested: ${last ? `#${last} (${actionCount - last} actions ago)` : "never"}` +
				(h.next_test ? ` · next test: ${h.next_test}` : "") +
				(h.status === "rejected" && !hasRefutation(h) ? " · rejected without a recorded refutation" : "") +
				(members.length >= 2 && (h.status === "supported" || h.status === "rejected") && !apart.some((test) => test.verdicts.has(key))
					? ` · ${h.status} without a test that told it apart from a rival` : ""));
			if (h.status === "contested")
				lines.push(`  ! refuted at #${h.contested_at ?? "?"} since its last revision: narrow the claim to where it held, reject it, or restate its status`);
			if (h.status !== "rejected" && latestRivalTest > last && !h.evidence.some((e) => e.action === latestRivalTest))
				lines.push(`  not assessed by the rival test #${latestRivalTest}`);
		}
	}
	const dropped = visibleDropped(state.dropped);
	if (dropped.length) {
		lines.push(`dropped without a recorded refutation (re-create one to test it):`);
		for (const d of dropped)
			lines.push(`- ${d.key} at #${d.at}${d.question ? ` ("${d.question}")` : ""}, ${d.results} result(s): ${JSON.stringify(d.claim)}`);
	}
	return lines.join("\n");
}

export function renderStrategies(state: MemoryState, actionCount: number, ctx: ComponentContext = {}, actions: string[] = []): string {
	if (state.strategies.size === 0)
		return `STRATEGY: none — write what you are pursuing as memory(strategies=[{key:"strat.<name>", plan, depends_on:["hyp.<name>"], uses}]).`;
	const order: Record<StrategyStatus, number> = { active: 0, suspended: 1, done: 2, abandoned: 3 };
	const lines = ["STRATEGY:"];
	for (const [key, s] of [...state.strategies].sort((a, b) => order[a[1].status] - order[b[1].status])) {
		const spent = s.spent + (s.status === "active" ? Math.max(0, actionCount - s.since) : 0);
		const head = s.status === "active" ? `active since #${s.since}, ${spent} actions` : `${s.status}${s.note ? ` (${s.note})` : ""}, ${spent} actions spent`;
		lines.push(`- ${key} [${head}] ${s.plan}`);
		const premises = s.depends_on.map((k) => {
			const h = state.hypotheses.get(k);
			return h ? `${k} [${h.status}${h.status === "contested" && h.contested_at !== undefined ? ` at #${h.contested_at}` : ""}]` : `${k} (deleted)`;
		});
		const uses = s.uses.map((ref) => {
			const tag = componentTag(ref, state.facts, ctx);
			return tag === "deleted" ? `${ref} (deleted)` : ref.startsWith("skill:") ? `${ref} ${tag}` : ref;
		});
		lines.push(`  depends on: ${premises.join(", ") || "(none named)"}${uses.length ? ` · uses: ${uses.join(", ")}` : ""}`);
		const progress = s.status === "active" ? stepsProgress(s, actions) : "";
		if (progress) lines.push(`  ${progress}`);
	}
	return lines.join("\n");
}

const actionMix = (labels: string[]) => {
	const counts = new Map<string, number>();
	for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${label}×${n}`).join(" ");
};

/**
 * What happened after each recent change of course: the action mix after vs.
 * the same number of actions before, the strategy active now, and whether the
 * components linked to the abandoned strategy changed since. Mechanical only.
 * actions[i] is the label of action #(i+1).
 */
export function renderRevisions(state: MemoryState, actions: string[], ctx: ComponentContext = {}, horizon = 24, window = 8): string {
	const now = actions.length;
	const recent = state.revisions.filter((rev) => now - rev.at <= horizon).slice(-2);
	if (!recent.length) return "";
	const active = [...state.strategies].find(([, s]) => s.status === "active")?.[0];
	const lines = ["REVISIONS (what you did after changing course):"];
	for (const rev of recent) {
		const after = actions.slice(rev.at, rev.at + window);
		const before = actions.slice(Math.max(0, rev.at - Math.max(after.length, 1)), rev.at);
		const behaviour = after.length
			? `next ${after.length}: ${actionMix(after)} | ${before.length} before: ${actionMix(before) || "none"}`
			: "no action since";
		const unchanged: string[] = [];
		const changed: string[] = [];
		for (const [ref, tag] of Object.entries(rev.linked)) {
			const current = componentTag(ref, state.facts, ctx) ?? "deleted";
			if (current === tag) unchanged.push(ref.startsWith("skill:") ? `${ref} ${tag}` : ref);
			else changed.push(`${ref} ${current === "deleted" ? "deleted" : ref.startsWith("skill:") ? `${tag}→${current}` : "revised"}`);
		}
		lines.push(`- after #${rev.at}: ${rev.causes.join("; ")}. Active now: ${active ?? "none"}. ${behaviour}.` +
			(unchanged.length ? ` Linked, unchanged since: ${unchanged.join(", ")}.` : "") +
			(changed.length ? ` Linked, changed: ${changed.join(", ")}.` : ""));
	}
	return lines.join("\n");
}

/** The whole memory as shown in the working set (revisions need the action labels). */
export function renderMemory(state: MemoryState, actionCount: number, actions: string[] = [], ctx: ComponentContext = {}): string {
	return [renderHypotheses(state, actionCount, ctx.checks, ctx.checkSources), renderStrategies(state, actionCount, ctx, actions), renderRevisions(state, actions, ctx), renderFacts(state,ctx.factProvenance)]
		.filter(Boolean).join("\n\n");
}

/**
 * Memory as a one-line-per-entry index (native mode): what is under test first, then the active strategy, then facts,
 * newest first. The full entries are a file the agent reads when a detail matters (Continual Harness shows a memory
 * overview, not the bodies; the full sections were 2.3-3.6k characters of every decision in the 2026-10-12 run).
 */
export function renderMemoryIndex(state: MemoryState, actionCount: number, checks: Record<string, string> = {}, maxChars = 1600, fullPath = "data/memory.md"): string {
	const clip = (text: string, n: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat; };
	const lines: string[] = [];
	const live = [...state.hypotheses].filter(([, h]) => h.status !== "rejected").sort((a, b) => STATUS_ORDER[a[1].status] - STATUS_ORDER[b[1].status]);
	for (const [key, h] of live) {
		const last = lastTested(h);
		lines.push(`- ${key} [${h.status}] ${clip(h.claim, 110)}` + (h.check ? ` · ${clip(checks[key] ?? "check: not run yet", 60)}` : "") +
			` · tested ${last ? `#${last}` : "never"}` + (h.status === "contested" ? ` · refuted at #${h.contested_at ?? "?"}` : ""));
	}
	for (const [key, s] of state.strategies) if (s.status === "active") lines.push(`- ${key} [active since #${s.since}] ${clip(s.plan, 110)}`);
	for (const [key, f] of [...state.facts].reverse()) lines.push(`- ${key} (conf ${f.confidence}) ${clip(f.text, 100)}`);
	const rejected = [...state.hypotheses].filter(([, h]) => h.status === "rejected").length;
	const inactive = [...state.strategies].filter(([, s]) => s.status !== "active").length;
	const head = `MEMORY INDEX (one line per entry; full text in ${fullPath}` +
		(rejected || inactive ? `; ${rejected} rejected hypotheses and ${inactive} inactive strategies only there` : "") + "):";
	if (!lines.length) return `MEMORY: empty — save beliefs, hypotheses and strategies with memory.`;
	const out = [head];
	for (const line of lines) {
		if (out.join("\n").length + line.length + 1 > maxChars) { out.push(`- … ${lines.length - out.length + 1} more in ${fullPath}`); break; }
		out.push(line);
	}
	return out.join("\n");
}

/**
 * The memory as each native decision sees it. notes: a line the runtime adds under a hypothesis (what a contesting check
 * says). Contested hypotheses come first, then the active strategy's premises.
 */
export function renderDecisionMemory(state: MemoryState, actionCount: number, checks: Record<string, string> = {}, maxChars = 4000,
	notes: Record<string, string> = {}): string {
 const clip = (text: string, n: number) => text.length > n ? text.slice(0, n) + '… [partial; data/memory.md]' : text;
 const active = [...state.strategies].filter(([, s]) => s.status === 'active');
 const linked = new Set(active.flatMap(([, s]) => s.depends_on));
 const questions = new Set([...linked].map(k => state.hypotheses.get(k)?.question).filter(Boolean));
 const live = [...state.hypotheses].filter(([, h]) => h.status !== 'rejected');
 if (!linked.size) for (const [, h] of live) if (h.question) questions.add(h.question);
 const selected = [...state.hypotheses].filter(([k, h]) => linked.has(k) || h.status !== 'rejected' || Boolean(h.question && questions.has(h.question)));
 const blocks: string[] = active.map(([k, s]) => `- ${k} [active] ${s.plan}\n  premises: ${s.depends_on.join(', ') || 'none named'}; methods: ${s.uses.join(', ') || 'none named'}`);
 const rank = ([k, h]: [string, Hypothesis]) => (h.status === 'contested' ? 2 : 0) + (linked.has(k) ? 1 : 0);
 selected.sort((a, b) => rank(b) - rank(a));
 for (const [k, h] of selected) {
  const evidence = [...h.evidence].reverse();
  const chosen = [evidence.find(e => e.verdict === 'refutes'), evidence.find(e => e.verdict === 'supports'), evidence[0]];
  const lines = [`- ${k} [${h.status}]${h.question ? ` question=${h.question}` : ''}: ${clip(h.claim, 450)}`];
  if (h.next_test) lines.push(`  next test: ${clip(h.next_test, 400)}`);
  if (h.predicts) lines.push(`  predicts: ${clip(h.predicts, 300)}`);
  for (const e of [...new Set(chosen.filter(Boolean))] as Evidence[])
   lines.push(`  #${e.action ?? '?'} ${e.verdict} under ${JSON.stringify(e.condition)}: ${clip(e.observed, 300)}`);
  if (h.check) lines.push(`  ${checks[k] ?? 'check: not run yet'}`);
  if (notes[k]) lines.push(`  ${notes[k]}`);
  if (h.status === 'rejected' && !evidence.some(e => e.verdict === 'refutes')) lines.push('  rejected without recorded refutation');
  blocks.push(lines.join('\n'));
 }
 const used = new Set(active.flatMap(([, s]) => s.uses).map(k => k.replace(/^memory:/, '')));
 const facts = [...state.facts].reverse().sort(([a], [b]) => Number(used.has(b)) - Number(used.has(a)));
 for (const [k, f] of facts) blocks.push(`- ${k} [confidence ${f.confidence}] ${clip(f.text, 600)}`);
 const unselected = [...state.hypotheses].filter(([k]) => !selected.some(([key]) => key === k));
 for (const [k, h] of unselected) blocks.push(`- ${k} [${h.status}] details: data/memory.md`);
 if (!blocks.length) return 'MEMORY: empty.';
 const out = ['CURRENT KNOWLEDGE (parent-authored judgments; full evidence: data/memory.md):'];
 let omitted = 0;
 for (const block of blocks) {
  if (out.join('\n').length + block.length + 100 > maxChars) { omitted++; continue; }
  out.push(block);
 }
 if (omitted) out.push(`${omitted} entries omitted by presentation budget; exact details: data/memory.md.`);
 return out.join('\n');
}

/** Plain data for skills (state.memory / state.hypotheses / state.strategies). */
export function memoryForSkills(state: MemoryState): { memory: Record<string, Fact>; hypotheses: Record<string, Hypothesis>; strategies: Record<string, Strategy> } {
	return { memory: Object.fromEntries(state.facts), hypotheses: Object.fromEntries(state.hypotheses), strategies: Object.fromEntries(state.strategies) };
}

const parseJson = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	const text = value.trim();
	if (!text.startsWith("[") && !text.startsWith("{")) return value;
	try { return JSON.parse(text); } catch { return value; }
};

/**
 * Pi prepareArguments hook: some models send arrays/objects as JSON strings,
 * a single key where a list is expected, or verdicts as a list of pairs.
 * Never throws.
 */
export function prepareMemoryArguments(args: any): any {
	if (!args || typeof args !== "object" || Array.isArray(args)) return args;
	const out = { ...args };
	for (const field of ["set", "delete", "hypotheses", "tests", "strategies"]) {
		if (!(field in out)) continue;
		let value = parseJson(out[field]);
		if (field === "delete" && typeof value === "string") value = [value];
		if (field !== "delete" && value && typeof value === "object" && !Array.isArray(value)) value = [value];
		out[field] = value;
	}
	if (Array.isArray(out.hypotheses))
		out.hypotheses = out.hypotheses.map((item: any) => item && typeof item === "object" && "evidence" in item
			? { ...item, evidence: parseJson(item.evidence) } : item);
	if (Array.isArray(out.tests))
		out.tests = out.tests.map((item: any) => {
			if (!item || typeof item !== "object") return item;
			let verdicts = parseJson(item.verdicts);
			if (Array.isArray(verdicts))
				verdicts = Object.fromEntries(verdicts.filter((pair: any) => pair && typeof pair === "object" && pair.key)
					.map((pair: any) => [String(pair.key), pair.verdict]));
			return { ...item, verdicts };
		});
	if (Array.isArray(out.strategies))
		out.strategies = out.strategies.map((item: any) => {
			if (!item || typeof item !== "object") return item;
			const fix = (value: unknown) => { const parsed = parseJson(value); return typeof parsed === "string" ? [parsed] : parsed; };
			return { ...item, ...("depends_on" in item ? { depends_on: fix(item.depends_on) } : {}), ...("uses" in item ? { uses: fix(item.uses) } : {}),
				...("steps" in item ? { steps: normalizeSteps(parseJson(item.steps)) ?? item.steps } : {}) };
		});
	return out;
}
