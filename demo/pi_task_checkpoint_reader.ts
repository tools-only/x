/** Reconstruct the authoritative parent checkpoint without forcing snapshot writes. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
type Row = Record<string, any>;

export function readCurrentTaskCheckpoint(root: string): Row {
	let checkpoint: Row = {};
	const snapshot = join(root,"task-checkpoint.json");
	if (existsSync(snapshot)) {
		try { const value = JSON.parse(readFileSync(snapshot,"utf8")); if (value && typeof value === "object" && !Array.isArray(value)) checkpoint = value; }
		catch { /* patches remain authoritative after an interrupted snapshot */ }
	}
	const journal = join(root,"task-checkpoint-patches.jsonl");
	if (!existsSync(journal)) return checkpoint;
	const patches = readFileSync(journal,"utf8").split(/\r?\n/).filter(Boolean).flatMap(line => {
		try { const record = JSON.parse(line); return record?.format === "task-local-checkpoint-patch-v1" && record.patch && typeof record.patch === "object" ? [record] : []; }
		catch { return []; }
	});
	for (let index = Number(checkpoint.patch_sequence ?? 0); index < patches.length; index++) {
		const record = patches[index];
		checkpoint = {...checkpoint,...record.patch,format:"task-local-checkpoint-v1",
			revision:Math.max(Number(checkpoint.revision ?? 0)+1,Number(record.revision ?? 0)),patch_sequence:index+1,recordedAt:record.recordedAt};
	}
	return checkpoint;
}
