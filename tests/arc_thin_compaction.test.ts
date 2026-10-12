import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("Pi native compaction preserves decisive evidence through the next ARC request and action", () => {
	const root = mkdtempSync(join(tmpdir(), "arc-thin-compaction-"));
	const command = spawnSync(process.execPath, ["--experimental-transform-types",
		join(project, "tools", "arc_thin_compaction_probe.ts"), root,
		join(project, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")],
		{ cwd: project, encoding: "utf8", timeout: 120000 });
	assert.equal(command.status, 0, command.stderr || command.stdout);
	const config = JSON.parse(readFileSync(join(root, "run-config.json"), "utf8"));
	assert.equal(config.pi_version, "0.87.0");
	const results = JSON.parse(readFileSync(join(root, "summary.json"), "utf8"));
	for (const variant of ["V1", "V2", "V3", "V4", "V5"]) {
		const result = results.find((entry: any) => entry.variant === variant);
		assert.equal(result.compact.success, true, JSON.stringify(result));
		assert.equal(result.nextRequestHasSummary, true, variant);
		assert.equal(result.preparation.counterexampleInInput, true, variant);
		assert.equal(result.counterexampleInNext, true, variant);
		assert.deepEqual(result.actions, ["ACTION4"], variant);
		const provider = rows(join(root, variant, "probe-provider.jsonl"));
		const ordinary = provider.find((entry: any) => !entry.summary);
		assert.match(JSON.stringify(ordinary), /CURRENT STATE/);
		assert.match(JSON.stringify(ordinary), /REFUTED_HYPOTHESIS/);
		const budget = rows(join(root, variant, "harness", "context_budget.jsonl"));
		assert.ok(budget.some((entry: any) => entry.compaction_event && entry.tokensBefore > 0
			&& entry.summary_chars > 0 && entry.usage.input_tokens >= 1 && entry.usage.output_tokens >= 1
			&& entry.wall_ms >= 0), variant);
	}
	const split = results.find((entry: any) => entry.variant === "V3");
	assert.equal(split.preparation.isSplitTurn, true);
	assert.equal(split.summaryRequests, 2);
	assert.equal(split.stored.usage.totalTokens, 4);
	const repeated = results.find((entry: any) => entry.variant === "V5");
	assert.equal(repeated.secondCompact.success, true);
	assert.ok(rows(join(root, "V5", "compaction-probe.jsonl"))
		.some((entry: any) => entry.event === "preparation" && entry.previousSummaryChars > 0));
	for (const variant of ["V6", "V7", "V8"]) {
		const result = results.find((entry: any) => entry.variant === variant);
		assert.equal(result.compact.success, false);
		assert.equal(result.stored, undefined);
	}
	assert.equal(results.find((entry: any) => entry.variant === "V6").failed.aborted, true);
	assert.match(results.find((entry: any) => entry.variant === "V7").compact.error, /token cap/);
	assert.equal(results.find((entry: any) => entry.variant === "V8").summaryRequests, 0);
});
