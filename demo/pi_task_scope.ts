import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, realpathSync, unlinkSync, readdirSync, rmdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";

export type TaskScope = {
	taskId: string;
	root: string;
	rootFingerprint: string;
	markerPath: string;
};

type TaskScopeMarker = {
	format: "task-local-scope-v1";
	task_id: string;
	root: string;
	root_fingerprint: string;
	createdAt: string;
	status?: "active" | "closed";
};

function rootFingerprint(root: string): string {
	return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

function requestedTaskId(root: string): string {
	const explicit = String(process.env.PI_AUTORESEARCH_TASK_ID ?? "").trim();
	// A unique run root is itself a valid task boundary for adapters that do
	// not have a separate benchmark task id. ARC and other runners can provide
	// a semantic id when a root may be resumed.
	return explicit || `root-${rootFingerprint(root)}`;
}

function readMarker(path: string): TaskScopeMarker | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<TaskScopeMarker>;
		if (value.format !== "task-local-scope-v1"
			|| typeof value.task_id !== "string"
			|| typeof value.root !== "string"
			|| typeof value.root_fingerprint !== "string") {
			throw new Error("invalid task scope marker");
		}
		return value as TaskScopeMarker;
	} catch (error) {
		throw new Error(`cannot read task scope marker ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Establish or resume the immutable task boundary for a task-local runtime. */
export function ensureTaskScope(rootInput: string): TaskScope {
	const root = resolve(rootInput);
	const fingerprint = rootFingerprint(root);
	const taskId = requestedTaskId(root);
	const markerPath = join(root, ".task-scope.json");
	mkdirSync(root, { recursive: true });
	const existing = readMarker(markerPath);
	if (existing && (existing.task_id !== taskId
		|| existing.root !== root
		|| existing.root_fingerprint !== fingerprint)) {
		throw new Error(
			`task scope mismatch: root belongs to task '${existing.task_id}' but runtime requested '${taskId}'`,
		);
	}
	if (existing?.status === "closed") {
		if (process.env.PI_AUTORESEARCH_RESUME_TASK !== "enabled"
			|| process.env.PI_AUTORESEARCH_TASK_ID !== existing.task_id) {
			throw new Error("task scope is closed (audit only); explicit same-task identity and PI_AUTORESEARCH_RESUME_TASK=enabled are required to resume");
		}
		writeFileSync(markerPath, JSON.stringify({ ...existing, status: "active" }) + "\n", "utf8");
	}
	if (!existing) {
		const marker: TaskScopeMarker = {
			format: "task-local-scope-v1",
			task_id: taskId,
			root,
			root_fingerprint: fingerprint,
			createdAt: new Date().toISOString(),
		};
		const temporary = `${markerPath}.tmp`;
		writeFileSync(temporary, JSON.stringify(marker) + "\n", "utf8");
		// The runner refuses non-empty roots for fresh benchmark runs, so an
		// existing marker always means resume/continue rather than a new task.
		renameSync(temporary, markerPath);
	}
	return { taskId, root, rootFingerprint: fingerprint, markerPath };
}

export function stampTaskRecord<T extends Record<string, unknown>>(
	scope: TaskScope,
	record: T,
): T & { task_id: string; task_root_fingerprint: string } {
	return { ...record, task_id: scope.taskId, task_root_fingerprint: scope.rootFingerprint };
}

/** Print-mode task owner shutdown. Never called on new/reload/fork or by children. */
export function closeTaskScope(rootInput: string): void {
	const root = resolve(rootInput);
	const markerPath = join(root, ".task-scope.json");
	const marker = readMarker(markerPath);
	if (!marker || marker.root !== root) throw new Error("cannot close mismatched task scope");
	const cache = join(root, "task-context-cache");
	if (existsSync(cache)) {
		if (lstatSync(cache).isSymbolicLink() || realpathSync(cache) !== join(realpathSync(root), "task-context-cache")) throw new Error("refusing external cache cleanup");
		const journal = join(cache, "messages.jsonl");
		if (existsSync(journal)) {
			if (lstatSync(journal).isSymbolicLink()) throw new Error("refusing linked cache cleanup");
			unlinkSync(journal);
		}
		if (!readdirSync(cache).length) rmdirSync(cache);
	}
	const temporary = `${markerPath}.tmp`;
	writeFileSync(temporary, JSON.stringify({ ...marker, status: "closed", closedAt: new Date().toISOString() }) + "\n");
	renameSync(temporary, markerPath);
}

/** Reject copied records from another task while accepting pre-scope legacy records. */
export function assertTaskRecordScope(
	scope: TaskScope,
	record: Record<string, unknown>,
	label: string,
): void {
	const taskId = record.task_id;
	const fingerprint = record.task_root_fingerprint;
	if (taskId !== undefined && taskId !== scope.taskId) {
		throw new Error(`task scope mismatch in ${label}: record belongs to '${String(taskId)}'`);
	}
	if (fingerprint !== undefined && fingerprint !== scope.rootFingerprint) {
		throw new Error(`task root mismatch in ${label}: record belongs to '${String(fingerprint)}'`);
	}
}

export function assertTaskRecordsScope(
	scope: TaskScope,
	records: Record<string, unknown>[],
	label: string,
): void {
	for (const record of records) assertTaskRecordScope(scope, record, label);
}
