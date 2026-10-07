/** Immutable task resource captured from the existing parent /state read. */
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";
import { assertTaskRecordScope, ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { taskRecords } from "./pi_task_resource_store.ts";

const ACTION_BUDGET_FIELDS = [
	"used", "maximum", "total_used", "total_maximum", "level", "baseline_actions", "multiplier",
] as const;

function finiteNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
	return value;
}

function stringList(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings`);
	return [...value];
}

function numericFrames(value: unknown): number[][][] {
	if (!Array.isArray(value) || value.length > 64) throw new Error("frames must be a bounded array");
	return value.map((frame, frameIndex) => {
		if (!Array.isArray(frame) || frame.length > 256) throw new Error(`frames[${frameIndex}] must be a bounded row array`);
		return frame.map((row, rowIndex) => {
			if (!Array.isArray(row) || row.length > 256) throw new Error(`frames[${frameIndex}][${rowIndex}] must be a bounded numeric row`);
			return row.map((cell, columnIndex) => finiteNumber(cell, `frames[${frameIndex}][${rowIndex}][${columnIndex}]`));
		});
	});
}

/** Select only bridge fields that are part of the public ARC observation. */
export function canonicalArcPublicState(source: Record<string, unknown>): Record<string, unknown> {
	const state: Record<string, unknown> = Object.create(null);
	for (const key of ["game_id", "state", "guid"] as const) {
		if (Object.prototype.hasOwnProperty.call(source, key)) state[key] = String(source[key]);
	}
	for (const key of ["levels_completed", "win_levels"] as const) {
		if (Object.prototype.hasOwnProperty.call(source, key)) state[key] = finiteNumber(source[key], key);
	}
	if (Object.prototype.hasOwnProperty.call(source, "full_reset")) {
		if (typeof source.full_reset !== "boolean") throw new Error("full_reset must be boolean");
		state.full_reset = source.full_reset;
	}
	if (Object.prototype.hasOwnProperty.call(source, "available_actions")) state.available_actions = stringList(source.available_actions, "available_actions");
	if (Object.prototype.hasOwnProperty.call(source, "agent_available_actions")) state.agent_available_actions = stringList(source.agent_available_actions, "agent_available_actions");
	if (Object.prototype.hasOwnProperty.call(source, "frames")) state.frames = numericFrames(source.frames);
	if (source.action_budget !== undefined) {
		if (!source.action_budget || typeof source.action_budget !== "object" || Array.isArray(source.action_budget)) throw new Error("action_budget must be an object");
		const raw = source.action_budget as Record<string, unknown>;
		const budget: Record<string, unknown> = Object.create(null);
		for (const key of ACTION_BUDGET_FIELDS) {
			if ((key === "maximum" || key === "total_maximum") && raw[key] === null) {
				budget[key] = null;
				continue;
			}
			if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
			budget[key] = key === "baseline_actions"
				? (() => {
					if (!Array.isArray(raw[key])) throw new Error("action_budget.baseline_actions must be an array");
					return raw[key].map((item, index) => finiteNumber(item, `action_budget.baseline_actions[${index}]`));
				})()
				: finiteNumber(raw[key], `action_budget.${key}`);
		}
		state.action_budget = budget;
	}
	return state;
}

export type ObservationSnapshotRecord = {
	format: "task-observation-snapshot-v1";
	snapshot_id: string;
	version: 1;
	status: "active";
	public_state: Record<string, unknown>;
	source_digest: string;
	content_sha256: string;
	captured_at: string;
	decision_cycle_id: string;
	decision_cycle_sequence: number;
	observation_epoch?: number | null;
	bridge_event_cutoff?: number | null;
	latest_successful_action_event_boundary: Record<string, unknown>;
	recordedAt: string;
	task_id: string;
	task_root_fingerprint: string;
};

export function registerArcObservationSnapshot(
	rootInput: string,
	source: Record<string, unknown>,
	options: { captured_at?: string; decision_cycle_id?: string;
		bridge_events?: { after: number; next: number; events: Record<string, any>[] } } = {},
): { ref: string; record: ObservationSnapshotRecord } {
	const scope = ensureTaskScope(rootInput);
	const prior = taskRecords(scope.root, "observation_snapshot");
	const sequence = prior.reduce((maximum, row) => Math.max(maximum, Number(row.decision_cycle_sequence ?? 0)), 0) + 1;
	const previous = prior.reduce<Record<string, any> | undefined>((latest, row) =>
		!latest || Number(row.decision_cycle_sequence) > Number(latest.decision_cycle_sequence) ? row : latest, undefined);
	const window = options.bridge_events;
	let epoch: number | null = null;
	if (window) {
		if (!Number.isSafeInteger(window.after) || window.after < 0 || !Number.isSafeInteger(window.next)
			|| window.next < window.after || !Array.isArray(window.events)
			|| window.events.length !== window.next - window.after
			|| (typeof previous?.bridge_event_cutoff === "number" && window.next < previous.bridge_event_cutoff))
			throw new Error("observation bridge event window must be a complete monotonic cutoff");
		// Complete history starts at zero. Incremental history can inherit an
		// epoch only from a snapshot at exactly the same previous cutoff.
		epoch = window.after === 0 ? 0 : previous?.bridge_event_cutoff === window.after
			&& typeof previous.observation_epoch === "number" ? previous.observation_epoch : null;
		for (const event of window.events) {
			if (!event || !["action", "forced_action"].includes(event.event)) continue;
			const levelChanged = event.frame?.public_transition?.level_changed === true
				|| (event.level_before !== undefined && event.frame?.levels_completed !== undefined
					&& Number(event.level_before) !== Number(event.frame.levels_completed));
			if (epoch !== null && (event.action === "RESET" || levelChanged)) epoch += 1;
		}
	}
	const publicState = canonicalArcPublicState(source);
	const serialized = JSON.stringify(publicState);
	const digest = createHash("sha256").update(serialized).digest("hex");
	const capturedAt = options.captured_at ?? new Date().toISOString();
	const budget = publicState.action_budget as Record<string, unknown> | undefined;
	const boundary = {
		total_used: Number(budget?.total_used ?? 0),
		level: Number(publicState.levels_completed ?? budget?.level ?? 0),
		state: String(publicState.state ?? "UNKNOWN"),
	};
	const snapshotId = `parent-state-${sequence}`;
	const record = stampTaskRecord(scope, {
		format: "task-observation-snapshot-v1" as const,
		snapshot_id: snapshotId,
		version: 1 as const,
		status: "active" as const,
		public_state: publicState,
		source_digest: digest,
		content_sha256: digest,
		captured_at: capturedAt,
		decision_cycle_id: options.decision_cycle_id ?? `parent-decision-cycle-${sequence}`,
		decision_cycle_sequence: sequence,
		observation_epoch: epoch,
		bridge_event_cutoff: window?.next ?? null,
		latest_successful_action_event_boundary: boundary,
		recordedAt: capturedAt,
	}) as ObservationSnapshotRecord;
	appendFileSync(join(scope.root, "observation-snapshots.jsonl"), JSON.stringify(record) + "\n", "utf8");
	return { ref: `observation_snapshot:${snapshotId}@v1`, record };
}

export function latestArcObservationSnapshot(
	rootInput: string,
	maxScanBytes: number,
	options: { include_earlier?: boolean } = {},
): { ref: string; record: ObservationSnapshotRecord; scanned_bytes: number;
	earlier?: { ref: string; record: ObservationSnapshotRecord } } | undefined {
	const scope = ensureTaskScope(rootInput);
	const path = join(scope.root, "observation-snapshots.jsonl");
	if (!existsSync(path)) return undefined;
	const actual = relative(realpathSync(scope.root), realpathSync(path));
	if (actual.startsWith("..") || isAbsolute(actual)) throw new Error("observation snapshot file resolves outside this task");
	const size = statSync(path).size;
	if (size > maxScanBytes) throw new Error(`observation snapshot scan exceeds binding preparation limit: ${size} bytes`);
	let latest: ObservationSnapshotRecord | undefined;
	// Opt-in locator preparation reuses this bounded read; ordinary latest
	// callers retain their existing output and do not retain a history array.
	const candidates: ObservationSnapshotRecord[] = [];
	for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
		let value: Record<string, unknown>;
		try { value = JSON.parse(line); } catch { continue; }
		assertTaskRecordScope(scope, value, "observation-snapshots.jsonl");
		if (value.format !== "task-observation-snapshot-v1") continue;
		if (options.include_earlier) candidates.push(value as ObservationSnapshotRecord);
		if (!latest || Number(value.decision_cycle_sequence ?? 0) > latest.decision_cycle_sequence) latest = value as ObservationSnapshotRecord;
	}
	if (!latest) return undefined;
	let earlier: ObservationSnapshotRecord | undefined;
	for (const candidate of candidates) {
		if (candidate.decision_cycle_sequence >= latest.decision_cycle_sequence
			|| candidate.public_state.game_id !== latest.public_state.game_id
			|| candidate.public_state.guid !== latest.public_state.guid
			|| Number(candidate.latest_successful_action_event_boundary.total_used)
				>= Number(latest.latest_successful_action_event_boundary.total_used)) continue;
		if (!earlier || candidate.decision_cycle_sequence > earlier.decision_cycle_sequence) earlier = candidate;
	}
	return { ref: `observation_snapshot:${latest.snapshot_id}@v1`, record: latest, scanned_bytes: size,
		...(earlier ? {earlier:{ref:`observation_snapshot:${earlier.snapshot_id}@v1`,record:earlier}} : {}) };
}

/** Locator only: no pixel delivery, implicit live binding or game interpretation. */
export function arcFinalFrameBinding(snapshot: {ref:string; record:ObservationSnapshotRecord}, name = "grid") {
	const frames = snapshot.record.public_state.frames;
	if (!Array.isArray(frames) || !frames.length) return undefined;
	const final = frames[frames.length - 1];
	if (!Array.isArray(final) || !final.length || final.some(row => !Array.isArray(row) || !row.length)) return undefined;
	// Match the existing provider-facing string path schema; the host also
	// accepts numeric segments, but a prepared call need not rely on conversion.
	return {name,ref:snapshot.ref,path:["public_state","frames",String(frames.length - 1)]};
}
