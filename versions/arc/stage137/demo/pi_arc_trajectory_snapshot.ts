/** Fixed, task-scoped ARC trajectory evidence published before a child starts. */
import { appendFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureTaskScope, stampTaskRecord } from "./pi_task_scope.ts";
import { resolveTaskResource } from "./pi_task_resource_store.ts";

export type ArcTransition = {
	action_id: string; action: string; coordinates: unknown;
	state_before: string; state_after: string;
	level_before: number; level_after: number; level_changed: boolean;
	changed_cells: number; bbox: unknown;
};

export type ArcTrajectorySnapshot = {
	format: "task-arc-trajectory-snapshot-v1";
	snapshot_id: string; version: 1; status: "active";
	transitions: ArcTransition[];
	action_cutoff: string | null;
	source_count: number;
	source_sha256: string;
	canonical_source: "bridge-events.jsonl";
	recordedAt: string;
	task_id: string; task_root_fingerprint: string;
};

export async function publishArcTrajectorySnapshot(
	root: string, readTrajectory: () => Promise<Record<string, unknown>>,
): Promise<{ ref: string; record: ArcTrajectorySnapshot }> {
	const source = await readTrajectory();
	if (source.projection !== "transitions" || source.canonical_source !== "bridge-events.jsonl"
		|| !Array.isArray(source.items) || !source.summary || typeof source.summary !== "object") {
		throw new Error("invalid canonical ARC trajectory response");
	}
	const transitions = source.items as ArcTransition[];
	const summary = source.summary as Record<string, unknown>;
	if (transitions.some((item, index) => !item || typeof item !== "object"
		|| typeof item.action_id !== "string" || typeof item.action !== "string"
		|| !Number.isInteger(item.level_before) || !Number.isInteger(item.level_after)
		|| !Number.isInteger(item.changed_cells)
		|| (index > 0 && item.action_id === transitions[index - 1].action_id))
		|| Number(summary.actions_available) !== transitions.length
		|| summary.latest_action_id !== (transitions.at(-1)?.action_id ?? null)) {
		throw new Error("inconsistent canonical ARC trajectory response");
	}
	const scope = ensureTaskScope(root);
	const snapshotId = `arc-trajectory-${randomUUID()}`;
	const recordedAt = new Date().toISOString();
	const serialized = JSON.stringify(transitions);
	const record = stampTaskRecord(scope, {
		format: "task-arc-trajectory-snapshot-v1" as const,
		snapshot_id: snapshotId, version: 1 as const, status: "active" as const,
		transitions: structuredClone(transitions),
		action_cutoff: transitions.at(-1)?.action_id ?? null,
		source_count: transitions.length,
		source_sha256: createHash("sha256").update(serialized).digest("hex"),
		canonical_source: "bridge-events.jsonl" as const,
		recordedAt,
	}) as ArcTrajectorySnapshot;
	appendFileSync(join(scope.root, "arc-trajectory-snapshots.jsonl"), JSON.stringify(record) + "\n", "utf8");
	return { ref: `arc_trajectory_snapshot:${snapshotId}@v1`, record };
}

export function loadArcTrajectorySnapshot(root: string, ref: string): ArcTrajectorySnapshot {
	if (!/^arc_trajectory_snapshot:arc-trajectory-[a-f0-9-]+@v1$/.test(ref)) {
		throw new Error("invalid ARC trajectory snapshot reference");
	}
	const record = resolveTaskResource(root, ref) as ArcTrajectorySnapshot;
	if (record.format !== "task-arc-trajectory-snapshot-v1"
		|| !Array.isArray(record.transitions) || record.source_count !== record.transitions.length
		|| record.canonical_source !== "bridge-events.jsonl"
		|| record.action_cutoff !== (record.transitions.at(-1)?.action_id ?? null)
		|| record.source_sha256 !== createHash("sha256").update(JSON.stringify(record.transitions)).digest("hex")) {
		throw new Error("invalid ARC trajectory snapshot contents");
	}
	return record;
}

/** Mirrors the bridge's compact projection over its already canonical transitions. */
export function projectArcTrajectorySnapshot(
	snapshot: ArcTrajectorySnapshot, projection: string, lastN = 20,
): Record<string, unknown> {
	if (!["transitions", "repeated_actions", "level_boundaries"].includes(projection)) {
		throw new Error("unknown ARC trajectory projection");
	}
	if (!Number.isInteger(lastN) || lastN < 1 || lastN > 256) {
		throw new Error("last_n must be between 1 and 256 for a child snapshot");
	}
	const transitions = snapshot.transitions;
	const selected = transitions.slice(-lastN);
	const latestLevelChange = transitions.findLastIndex((item) => item.level_changed);
	let items: Record<string, unknown>[];
	if (projection === "level_boundaries") {
		items = selected.filter((item) => item.level_changed);
	} else if (projection === "repeated_actions") {
		items = [];
		let previousKey = "";
		for (const item of selected) {
			const key = JSON.stringify([item.action, item.level_before, item.level_after,
				item.state_after, item.changed_cells, item.bbox]);
			const previous = items.at(-1);
			if (previous && key === previousKey) {
				previous.end_action_id = item.action_id;
				previous.count = Number(previous.count) + 1;
			} else {
				items.push({ start_action_id: item.action_id, end_action_id: item.action_id,
					action: item.action, count: 1, level: item.level_before,
					level_after: item.level_after, state_after: item.state_after,
					changed_cells: item.changed_cells, bbox: item.bbox });
			}
			previousKey = key;
		}
	} else {
		items = selected;
	}
	return {
		projection,
		summary: {
			actions_available: transitions.length,
			actions_considered: selected.length,
			items_returned: items.length,
			current_level: transitions.at(-1)?.level_after ?? 0,
			latest_action_id: snapshot.action_cutoff,
			actions_since_level_change: latestLevelChange < 0 ? transitions.length
				: transitions.length - latestLevelChange - 1,
		},
		items,
		canonical_source: snapshot.canonical_source,
		snapshot_ref: `arc_trajectory_snapshot:${snapshot.snapshot_id}@v1`,
		action_cutoff: snapshot.action_cutoff,
		history_access: {
			complete_actions_available: transitions.length,
			older_actions_outside_view: Math.max(0, transitions.length - selected.length),
			read: { tool: "task_resource", action: "read",
				ref: `arc_trajectory_snapshot:${snapshot.snapshot_id}@v1`, offset: 0, limit: 2000 },
		},
	};
}
