/** Self-Harness evidence board: mechanical replay and scoring of declared predictors.
 *
 * Advisory only. The board reads canonical transitions and saved components through
 * a catalog, runs declared predictors itself, and appends to its own ledger. It never
 * edits, disables or hides a component and never blocks an environment action.
 * Design: docs/plans/2026-10-08-self-harness-evidence-board.md
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_MIN_SUPPORT = 3;
const ERROR_STREAK = 3;
export const DIGEST_LIMIT = 1500;

type Grid = number[][];
export type BoardAction = { action: string; x?: number; y?: number };
export type BoardTransition = {
	t: number; epoch: number; level_index: number; action: BoardAction;
	before: Grid; after: Grid; before_hash: string; after_hash: string; before_ref?: string;
	flags: { reset: boolean; level_changed: boolean; game_over: boolean };
};
export type BoardState = { t: number; epoch: number; level_index: number; grid: Grid; grid_hash: string; actions: string[] };
export type BoardSource = { transitions(): BoardTransition[]; current(): BoardState | undefined; sync?(): Promise<void> };

/** A saved component as the board sees it. `ref` names an exact version. */
export type BoardComponent = { ref: string; name: string; version: number; predicts?: unknown; program: unknown };
export type BoardCatalog = {
	/** Latest saved version of every active component. */
	components(): BoardComponent[];
	/** Exact `kind:name@vN`, or `kind:name` for the latest version. */
	resolve(ref: string): BoardComponent | undefined;
};
/** Run a component on one grid: with `actions` it predicts, without it observes. */
export type BoardEvaluator = (component: BoardComponent, call: { grid: Grid; level_index: number; actions?: BoardAction[] }) => Promise<unknown>;

export type PredictsContract = {
	lens_ref?: string; feature?: string; scope: "task" | "level";
	covers: Array<"reset" | "level_changed">; clicks: Array<[number, number]>; repair: boolean;
};
type Counts = { applicable: number; correct: number; wrong: number; abstain: number; error: number; not_applicable: number };
export type PredictorStatus = {
	ref: string; name: string; feature: string; scope: "task" | "level"; scope_level: number | null; repair: boolean;
	status: "replaying" | "untested" | "supported" | "falsified" | "erroring" | "inactive_level";
	replay: Counts; live: Counts; processed: number; total: number;
	counterexample?: Record<string, any>; last_error?: string;
};

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const gridHash = (grid: Grid) => hash(grid).slice(0, 16);
export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
	? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) ?? "null";
const preview = (value: unknown, limit = 120) => { const text = JSON.stringify(value) ?? "null"; return text.length > limit ? `${text.slice(0, limit)}…` : text; };
const emptyCounts = (): Counts => ({ applicable: 0, correct: 0, wrong: 0, abstain: 0, error: 0, not_applicable: 0 });
export const actionKey = (action: BoardAction) => action.x === undefined ? action.action : `${action.action}(${action.x},${action.y})`;

/** Validate an authored contract. Rejection is reported; it never affects the component. */
export function normalizePredictsContract(value: unknown): { contract?: PredictsContract; issues: string[] } {
	const issues: string[] = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) return { issues: ["predicts must be an object"] };
	const input = value as Record<string, unknown>;
	if (typeof input.invalid === "string") return { issues: [input.invalid] };
	for (const key of Object.keys(input)) if (!["lens_ref", "feature", "scope", "covers", "clicks", "repair"].includes(key))
		issues.push(`unknown predicts field: ${key}`);
	const lensRef = input.lens_ref === undefined ? undefined : String(input.lens_ref);
	if (lensRef !== undefined && !/^(tool|skill):[a-z][a-z0-9_-]*(@v[1-9]\d*)?$/.test(lensRef))
		issues.push("lens_ref must name a saved component, e.g. skill:name or skill:name@v2");
	const feature = input.feature === undefined ? undefined : String(input.feature).trim();
	if (feature !== undefined && (!feature || feature.length > 64)) issues.push("feature must be 1-64 characters");
	const scope = input.scope === undefined ? "task" : input.scope;
	if (scope !== "task" && scope !== "level") issues.push("scope must be task or level");
	const covers = input.covers === undefined ? [] : input.covers;
	if (!Array.isArray(covers) || covers.some(item => item !== "reset" && item !== "level_changed")) issues.push("covers may contain only reset and level_changed");
	const clicks = input.clicks === undefined ? [] : input.clicks;
	if (!Array.isArray(clicks) || clicks.length > 16 || clicks.some(item => !Array.isArray(item) || item.length !== 2
		|| item.some(n => !Number.isInteger(n) || n < 0 || n > 63))) issues.push("clicks must be at most 16 [x,y] integer pairs in 0..63");
	if (input.repair !== undefined && typeof input.repair !== "boolean") issues.push("repair must be true or false");
	if (issues.length) return { issues };
	return { issues, contract: { ...(lensRef ? { lens_ref: lensRef } : {}), ...(feature ? { feature } : {}),
		scope: scope as "task" | "level", covers: [...new Set(covers as any[])], clicks: clicks as Array<[number, number]>,
		repair: input.repair === true } };
}

function readRows(path: string): Record<string, any>[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap(line => {
		try { return [JSON.parse(line)]; } catch { return []; } // a writer may still be appending
	});
}

const SIMPLE_ACTIONS = ["ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION7", "RESET"];

/** ARC transitions from the bridge's canonical events. The bridge persists
 * bridge-events.jsonl only opportunistically, so live runs supply a fetcher for
 * its /events endpoint; offline diagnostics read the saved file. Read-only. */
export class ArcBridgeEventSource implements BoardSource {
	private offset = 0;
	private partial = "";
	private cursor = 0;
	private previous?: Record<string, any>;
	private epoch = 0;
	private items: BoardTransition[] = [];
	private latest?: Record<string, any>;
	private initial?: Record<string, any>;
	private preActionFrames?: Map<string, Grid>;
	constructor(private readonly root: string,
		private readonly fetchEvents?: (after: number) => Promise<{ events: Record<string, any>[]; next: number }>) {}

	/** Remember the pre-game state so the first action has a before-frame when the
	 * bridge did not persist a pre-action snapshot. Only a state with zero actions qualifies. */
	seedInitial(state: Record<string, any> | undefined) {
		if (!this.initial && state && Number(state.action_budget?.total_used) === 0 && Array.isArray(state.frames)) this.initial = state;
	}

	/** Pull new events from the live bridge; a no-op for file-backed sources. */
	async sync(): Promise<void> {
		if (!this.fetchEvents) return;
		const window = await this.fetchEvents(this.cursor);
		if (!Number.isSafeInteger(window?.next) || window.next < this.cursor || !Array.isArray(window.events)) return;
		for (const event of window.events) this.ingest(event);
		this.cursor = window.next;
	}

	private preActionFrame(ref: unknown): Grid | undefined {
		const id = /^pre_action_state:([^@]+)@v1$/.exec(String(ref ?? ""))?.[1];
		if (!id) return undefined;
		if (!this.preActionFrames) {
			this.preActionFrames = new Map();
			for (const row of readRows(join(this.root, "pre-action-states.jsonl"))) {
				const frame = (row.public_state?.frames ?? []).at(-1);
				if (row.state_id && Array.isArray(frame)) this.preActionFrames.set(String(row.state_id), frame);
			}
		}
		const frame = this.preActionFrames.get(id);
		if (!frame) this.preActionFrames = undefined; // the bridge may append it later
		return frame;
	}

	private ingest(event: Record<string, any>) {
		if (event.event === "forced_action") { this.previous = event.frame; this.latest = event.frame; return; }
		if (event.event !== "action") return;
		const frame = event.frame ?? {};
		const before = (this.previous?.frames ?? []).at(-1) ?? this.preActionFrame(event.pre_action_state?.resource_ref)
			?? (Number(event.index) === 1 ? (this.initial?.frames ?? []).at(-1) : undefined);
		const after = (frame.frames ?? []).at(-1);
		const reset = event.action === "RESET";
		if (reset) this.epoch += 1;
		if (Array.isArray(before) && Array.isArray(after) && before.length && after.length) {
			const levelAfter = Number(frame.levels_completed ?? event.level_before ?? 0);
			const action: BoardAction = { action: String(event.action) };
			if (Number.isInteger(event.coordinates?.x) && Number.isInteger(event.coordinates?.y) && !SIMPLE_ACTIONS.includes(action.action)) {
				action.x = event.coordinates.x; action.y = event.coordinates.y;
			}
			this.items.push({ t: Number(event.index), epoch: this.epoch, level_index: Number(event.level_before ?? 0), action,
				before, after, before_hash: gridHash(before), after_hash: gridHash(after),
				...(event.pre_action_state?.resource_ref ? { before_ref: String(event.pre_action_state.resource_ref) } : {}),
				flags: { reset, level_changed: levelAfter !== Number(event.level_before ?? 0)
					|| frame.public_transition?.level_changed === true, game_over: frame.state === "GAME_OVER" } });
		}
		this.previous = frame;
		this.latest = frame;
	}

	private refresh() {
		if (this.fetchEvents) return;
		const path = join(this.root, "bridge-events.jsonl");
		if (!existsSync(path)) return;
		const size = statSync(path).size;
		if (size < this.offset) { this.offset = 0; this.partial = ""; this.previous = undefined; this.items = []; this.epoch = 0; }
		if (size === this.offset) return;
		const buffer = readFileSync(path).subarray(this.offset);
		this.offset = size;
		const text = this.partial + buffer.toString("utf8");
		const lines = text.split(/\r?\n/);
		this.partial = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			try { this.ingest(JSON.parse(line)); } catch { /* damaged diagnostic line */ }
		}
	}

	transitions(): BoardTransition[] { this.refresh(); return this.items; }

	current(): BoardState | undefined {
		this.refresh();
		const grid = (this.latest?.frames ?? []).at(-1);
		if (!Array.isArray(grid) || !grid.length) return undefined;
		return { t: this.items.at(-1)?.t ?? 0, epoch: this.epoch, level_index: Number(this.latest!.levels_completed ?? 0),
			grid, grid_hash: gridHash(grid),
			actions: (this.latest!.agent_available_actions ?? this.latest!.available_actions ?? []).map(String) };
	}
}

type Predictor = { component: BoardComponent; contract: PredictsContract; lens?: BoardComponent;
	feature: string; scope_level: number | null; registered_after_t: number };

export class HarnessBoard {
	private lensCache = new Map<string, { value?: unknown; error?: string }>();
	private currentCache = new Map<string, { value?: unknown[]; error?: string }>();
	readonly minSupport: number;
	readonly ledgerPath: string;
	constructor(ledgerPath: string, readonly source: BoardSource, readonly catalog: BoardCatalog,
		readonly evaluate: BoardEvaluator, options: { minSupport?: number } = {}) {
		this.ledgerPath = ledgerPath;
		this.minSupport = options.minSupport ?? DEFAULT_MIN_SUPPORT;
	}

	ledger(): Record<string, any>[] { return readRows(this.ledgerPath); }

	append(row: Record<string, any>) {
		mkdirSync(dirname(this.ledgerPath), { recursive: true });
		appendFileSync(this.ledgerPath, JSON.stringify({ format: "harness-board-event-v1", ...row,
			recordedAt: new Date().toISOString() }) + "\n", "utf8");
	}

	/** Latest saved version of each component that declares a contract. Registration is recorded once. */
	predictors(): { accepted: Predictor[]; rejected: Array<{ ref: string; issues: string[] }> } {
		const contracts = new Map(this.ledger().filter(row => row.kind === "contract").map(row => [row.predictor_ref, row]));
		const accepted: Predictor[] = [];
		const rejected: Array<{ ref: string; issues: string[] }> = [];
		for (const component of this.catalog.components()) {
			if (component.predicts === undefined) continue;
			let row = contracts.get(component.ref);
			if (!row) {
				const { contract, issues } = normalizePredictsContract(component.predicts);
				let lensRef = contract?.lens_ref;
				if (lensRef) {
					const lens = this.catalog.resolve(lensRef);
					if (!lens) issues.push(`lens_ref not found: ${lensRef}`);
					else lensRef = lens.ref; // pin the exact lens version used for scoring
				}
				const state = this.source.current();
				row = { kind: "contract", predictor_ref: component.ref, status: issues.length ? "rejected" : "accepted",
					...(issues.length ? { issues } : { contract: { ...contract, ...(lensRef ? { lens_ref: lensRef } : {}) } }),
					scope_level: state?.level_index ?? 0, registered_after_t: this.source.transitions().at(-1)?.t ?? 0 };
				this.append(row);
				contracts.set(component.ref, row);
			}
			if (row.status !== "accepted") { rejected.push({ ref: component.ref, issues: row.issues ?? [] }); continue; }
			const contract = row.contract as PredictsContract;
			accepted.push({ component, contract, lens: contract.lens_ref ? this.catalog.resolve(contract.lens_ref) : undefined,
				feature: contract.feature ?? contract.lens_ref ?? `self:${component.ref}`,
				scope_level: contract.scope === "level" ? Number(row.scope_level ?? 0) : null,
				registered_after_t: Number(row.registered_after_t ?? 0) });
		}
		return { accepted, rejected };
	}

	private async observe(predictor: Predictor, grid: Grid, gridKey: string, level_index: number) {
		const lens = predictor.contract.lens_ref ? predictor.lens : predictor.component;
		const key = `${lens?.ref ?? predictor.contract.lens_ref}|${gridKey}`;
		const cached = this.lensCache.get(key);
		if (cached) return cached;
		let result: { value?: unknown; error?: string };
		if (!lens) result = { error: `lens unavailable: ${predictor.contract.lens_ref}` };
		else try { result = { value: await this.evaluate(lens, { grid, level_index }) }; }
		catch (error) { result = { error: String(error instanceof Error ? error.message : error).slice(0, 300) }; }
		if (this.lensCache.size > 4096) this.lensCache.clear();
		this.lensCache.set(key, result);
		return result;
	}

	private async predict(predictor: Predictor, grid: Grid, level_index: number, actions: BoardAction[]): Promise<unknown[]> {
		const value = await this.evaluate(predictor.component, { grid, level_index, actions });
		if (!Array.isArray(value) || value.length !== actions.length)
			throw new Error("a predictor must return a list aligned with args['actions'] (None to abstain)");
		return value;
	}

	private applicable(predictor: Predictor, transition: BoardTransition): boolean {
		if (transition.flags.reset && !predictor.contract.covers.includes("reset")) return false;
		if (transition.flags.level_changed && !predictor.contract.covers.includes("level_changed")) return false;
		return predictor.scope_level === null || transition.level_index === predictor.scope_level;
	}

	/** Score unscored transitions until the deadline. Returns whether work remains. */
	async advance(deadline: number): Promise<{ pending: boolean }> {
		await this.source.sync?.();
		const transitions = this.source.transitions();
		const { accepted } = this.predictors();
		const cursors = new Map<string, number>();
		for (const row of this.ledger()) if (row.kind === "score")
			cursors.set(row.predictor_ref, Math.max(cursors.get(row.predictor_ref) ?? -1, Number(row.t)));
		for (const predictor of accepted) {
			const ref = predictor.component.ref;
			let cursor = cursors.get(ref) ?? -1;
			for (const transition of transitions) {
				if (transition.t <= cursor) continue;
				if (Date.now() >= deadline) return { pending: true };
				const phase = transition.t <= predictor.registered_after_t ? "replay" : "live";
				const base = { kind: "score", predictor_ref: ref, t: transition.t, phase,
					action: transition.action, level_index: transition.level_index, epoch: transition.epoch };
				if (!this.applicable(predictor, transition)) {
					this.append({ ...base, outcome: "not_applicable" });
				} else {
					let row: Record<string, any>;
					try {
						const [predicted] = await this.predict(predictor, transition.before, transition.level_index, [transition.action]);
						if (predicted === null || predicted === undefined) row = { ...base, outcome: "abstain" };
						else {
							const observed = await this.observe(predictor, transition.after, transition.after_hash, transition.level_index);
							if (observed.error !== undefined) row = { ...base, outcome: "error", error: `lens: ${observed.error}` };
							else if (canonicalJson(predicted) === canonicalJson(observed.value)) row = { ...base, outcome: "correct" };
							else row = { ...base, outcome: "wrong", predicted, observed: observed.value,
								...(transition.before_ref ? { before_ref: transition.before_ref } : {}) };
						}
					} catch (error) {
						row = { ...base, outcome: "error", error: String(error instanceof Error ? error.message : error).slice(0, 300) };
					}
					this.append(row);
				}
				cursor = transition.t;
			}
		}
		return { pending: false };
	}

	status(): PredictorStatus[] {
		const { accepted } = this.predictors();
		const ledger = this.ledger();
		const transitions = this.source.transitions();
		const lastT = transitions.at(-1)?.t ?? 0;
		const current = this.source.current();
		return accepted.map(predictor => {
			const ref = predictor.component.ref;
			const scores = ledger.filter(row => row.kind === "score" && row.predictor_ref === ref);
			const replay = emptyCounts(), live = emptyCounts();
			for (const row of scores) {
				const counts = row.phase === "replay" ? replay : live;
				counts[row.outcome as keyof Counts] += 1;
				if (["correct", "wrong"].includes(row.outcome)) counts.applicable += 1;
			}
			const wrong = scores.find(row => row.outcome === "wrong");
			const attempts = scores.filter(row => ["correct", "wrong", "error"].includes(row.outcome));
			const streak = attempts.slice(-ERROR_STREAK);
			const cursor = scores.reduce((maximum, row) => Math.max(maximum, Number(row.t)), 0);
			const replayTarget = Math.min(predictor.registered_after_t, lastT);
			const status: PredictorStatus["status"] = wrong ? "falsified"
				: streak.length === ERROR_STREAK && streak.every(row => row.outcome === "error") ? "erroring"
				: predictor.scope_level !== null && current && current.level_index !== predictor.scope_level ? "inactive_level"
				: replayTarget > 0 && cursor < replayTarget ? "replaying"
				: replay.correct + live.correct >= this.minSupport ? "supported" : "untested";
			return { ref, name: predictor.component.name, feature: predictor.feature, scope: predictor.contract.scope,
				scope_level: predictor.scope_level, repair: predictor.contract.repair, status, replay, live,
				processed: scores.length, total: transitions.length,
				...(wrong ? { counterexample: wrong } : {}),
				...(attempts.at(-1)?.outcome === "error" ? { last_error: attempts.at(-1)!.error } : {}) };
		});
	}

	/** Predictions of live predictors for the current state, and disagreements among comparable ones. */
	async currentPredictions(deadline: number): Promise<{ state?: BoardState; rows: Array<{ ref: string; feature: string;
		observed?: string; predictions?: Record<string, unknown>; error?: string }>; disagreements: Array<{ feature: string;
		action: string; values: Record<string, unknown> }>; pending: boolean }> {
		const state = this.source.current();
		if (!state) return { rows: [], disagreements: [], pending: false };
		const statuses = new Map(this.status().map(item => [item.ref, item]));
		const { accepted } = this.predictors();
		const rows: Array<{ ref: string; feature: string; observed?: string; predictions?: Record<string, unknown>; error?: string }> = [];
		let pending = false;
		for (const predictor of accepted) {
			const ref = predictor.component.ref;
			const status = statuses.get(ref)?.status;
			if (!status || ["falsified", "erroring", "inactive_level"].includes(status)) continue;
			const actions: BoardAction[] = state.actions.filter(name => name !== "RESET" && name !== "ACTION6").map(action => ({ action }));
			if (state.actions.includes("ACTION6")) actions.push(...predictor.contract.clicks.map(([x, y]) => ({ action: "ACTION6", x, y })));
			if (!actions.length) continue;
			const key = `${ref}|${state.grid_hash}|${canonicalJson(actions)}`;
			let cached = this.currentCache.get(key);
			if (!cached) {
				if (Date.now() >= deadline) { pending = true; continue; }
				try { cached = { value: await this.predict(predictor, state.grid, state.level_index, actions) }; }
				catch (error) { cached = { error: String(error instanceof Error ? error.message : error).slice(0, 200) }; }
				if (this.currentCache.size > 512) this.currentCache.clear();
				this.currentCache.set(key, cached);
			}
			const observed = await this.observe(predictor, state.grid, state.grid_hash, state.level_index);
			rows.push({ ref, feature: predictor.feature,
				...(observed.error === undefined ? { observed: canonicalJson(observed.value) } : {}),
				...(cached.error !== undefined ? { error: cached.error } : { predictions: Object.fromEntries(actions.map((action, index) =>
					[actionKey(action), cached!.value![index]])) }) });
		}
		// Only predictors that declare the same feature and observe the current state
		// identically are comparable; otherwise their outputs are different quantities.
		const groups = new Map<string, typeof rows>();
		for (const row of rows) if (row.predictions && row.observed !== undefined) {
			const key = `${row.feature}|${row.observed}`;
			groups.set(key, [...(groups.get(key) ?? []), row]);
		}
		const disagreements: Array<{ feature: string; action: string; values: Record<string, unknown> }> = [];
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			for (const action of Object.keys(group[0].predictions!)) {
				const values = Object.fromEntries(group.flatMap(row => row.predictions![action] === null || row.predictions![action] === undefined
					? [] : [[row.ref, row.predictions![action]]]));
				if (new Set(Object.values(values).map(canonicalJson)).size > 1) disagreements.push({ feature: group[0].feature, action, values });
			}
		}
		return { state, rows, disagreements, pending };
	}

	/** Render the bounded digest. Falsification details are delivered once. */
	async digest(options: { deadline: number; pending?: boolean; announceContract?: string; notes?: string[] }): Promise<string> {
		const { rejected } = this.predictors();
		const statuses = this.status();
		const delivered = new Set(this.ledger().filter(row => row.kind === "delivered").map(row => `${row.predictor_ref}|${row.t}`));
		const lines: string[] = [];
		const fresh: Array<{ predictor_ref: string; t: number }> = [];
		for (const item of statuses) {
			const counts = (c: Counts) => `${c.correct}/${c.applicable}${c.abstain ? ` abstain ${c.abstain}` : ""}${c.error ? ` error ${c.error}` : ""}`;
			let line = `- ${item.ref} [${item.feature}] ${item.status}: replay ${counts(item.replay)}, live ${counts(item.live)}`;
			if (item.status === "replaying") line += ` (${item.processed}/${item.total} transitions)`;
			if (item.status === "erroring" && item.last_error) line += `; last error: ${item.last_error.slice(0, 120)}`;
			const counter = item.counterexample;
			if (counter) {
				const key = `${item.ref}|${counter.t}`;
				const where = `action ${counter.t} ${actionKey(counter.action ?? { action: "?" })}`;
				if (delivered.has(key)) line += `; falsified at ${where} (details in board ledger)`;
				else {
					line += `; FALSIFIED at ${where}: predicted ${preview(counter.predicted)}, observed ${preview(counter.observed)}`
						+ `${counter.before_ref ? `; before ${counter.before_ref}` : ""}`;
					fresh.push({ predictor_ref: item.ref, t: counter.t });
				}
			}
			lines.push(line);
		}
		for (const item of rejected) lines.push(`- ${item.ref} contract rejected (component unaffected): ${item.issues.join("; ").slice(0, 200)}`);
		const current = statuses.length ? await this.currentPredictions(options.deadline) : undefined;
		if (current?.rows.length) {
			lines.push(`Predictions for the current state (after action ${current.state!.t}):`);
			for (const row of current.rows) lines.push(`  ${row.ref}: ${row.error ? `error ${row.error}` : preview(row.predictions, 240)}`);
		}
		for (const item of current?.disagreements ?? [])
			lines.push(`Disagreement [${item.feature}] on ${item.action}: ${Object.entries(item.values).map(([ref, value]) => `${ref}=${preview(value, 60)}`).join(" vs ")}`);
		for (const note of options.notes ?? []) lines.push(note);
		if (options.pending || current?.pending) lines.push("Pending: board work continues after this request.");
		if (!lines.length) return options.announceContract ?? "";
		let text = `HARNESS BOARD (runtime facts from replaying declared predictors on canonical transitions; not advice):\n${lines.join("\n")}`;
		if (text.length > DIGEST_LIMIT) text = `${text.slice(0, DIGEST_LIMIT - 40)}\n… (truncated; see board ledger)`;
		for (const item of fresh) if (text.includes(`${item.predictor_ref} [`)) this.append({ kind: "delivered", ...item, measurement_basis: "context_hook" });
		return text;
	}
}
