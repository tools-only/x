/** Regression at the native extension/HTTP boundary; provider assembly is checked separately. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import arcThinExtension from "../demo/arc_thin_extension.ts";

test("action schema follows live scope through actions, RESET, failures and recovery", async () => {
	let scope: Record<string, unknown> = { agent_available_actions: ["RESET", "ACTION1"], available_actions: ["ACTION5", "ACTION6"] };
	let failed = false, submitted = 0;
	const state = () => ({ frames: [Array.from({ length: 64 }, () => Array(64).fill(0))], state: "PLAYING", ...scope });
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", chunk => { body += chunk; });
		request.on("end", () => {
			response.setHeader("content-type", "application/json");
			if (failed) { response.statusCode = 503; return response.end(JSON.stringify({ error: "state unavailable" })); }
			if (request.url === "/action") {
				submitted += 1;
				const action = JSON.parse(body).action;
				if (action === "ACTION1") scope = { agent_available_actions: ["RESET", "ACTION6"] };
				if (action === "RESET") scope = { agent_available_actions: ["ACTION3"] };
			}
			response.end(JSON.stringify(state()));
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	try {
		for (const variant of ["treatment", "control"]) {
			scope = { agent_available_actions: ["RESET", "ACTION1"], available_actions: ["ACTION5", "ACTION6"] };
			Object.assign(process.env, { ARC_RUN_ROOT: mkdtempSync(join(tmpdir(), "thin-action-scope-")),
				ARC_THIN_VARIANT: variant, ARC_HARNESS_LEDGER: "disabled", ARC_HARNESS_CRITIC: "disabled",
				PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}` });
			const tools = new Map<string, any>(), hooks = new Map<string, any>();
			let active: string[] = [];
			arcThinExtension({ registerTool: (tool: any) => tools.set(tool.name, tool),
				on: (name: string, hook: any) => hooks.set(name, hook), getActiveTools: () => active,
				setActiveTools: (names: string[]) => { active = names; }, getThinkingLevel: () => "off" } as any);
			const decide = (prompt = "Decide") => hooks.get("before_agent_start")({ prompt }, {});
			const action = () => tools.get("arc_action");
			const values = () => action().parameters.properties.action.enum;
			const act = (name: string) => action().execute("call", { action: name }, undefined, undefined, {});
			assert.deepEqual(values(), [], "no environment scope is invented during loading");
			await hooks.get("session_start")({}, {});
			await decide();
			assert.deepEqual(values(), ["RESET", "ACTION1"]);
			assert.ok(active.includes("arc_action"));
			assert.equal(action().parameters.properties.x, undefined);
			assert.doesNotMatch(action().description, /ACTION6/);
			const stale = action();
			await act("ACTION1");
			assert.deepEqual(values(), ["RESET", "ACTION6"], "action response refreshes scope immediately");
			assert.ok(action().parameters.properties.x && action().parameters.properties.y);
			await decide();
			const before = submitted;
			await assert.rejects(stale.execute("stale", { action: "ACTION1" }, undefined, undefined, {}), /not currently available/);
			assert.equal(submitted, before, "stale-schema calls do not reach the environment");
			await decide();
			await act("RESET");
			assert.deepEqual(values(), ["ACTION3"], "RESET/level changes remove old affordances");
			assert.equal(action().parameters.properties.y, undefined);
			failed = true;
			await decide();
			assert.deepEqual(values(), []);
			assert.ok(!active.includes("arc_action"), "failed observation cannot leave a stale action active");
			failed = false;
			scope = { available_actions: ["ACTION5"] };
			await decide();
			assert.deepEqual(values(), ["ACTION5"], "use public scope if agent-specific scope is absent");
			assert.ok(active.includes("arc_action"));
			scope = { agent_available_actions: [], available_actions: ["RESET", "ACTION5"] };
			await decide();
			assert.deepEqual(values(), [], "explicit empty scope does not fall back to broader permissions");
			assert.ok(!active.includes("arc_action"));
			scope = { agent_available_actions: ["ACTION7"] };
			await decide();
			assert.deepEqual(values(), ["ACTION7"], "scope is authoritative, without a hard-coded vocabulary");
			if (variant === "treatment") {
				await decide("CONSOLIDATE: review");
				assert.ok(!active.includes("arc_action"), "scope refresh preserves consolidation restrictions");
			}
		}
	} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("installed Pi sends current action enums and rejects unavailable actions before HTTP submission", { timeout: 60_000 }, async () => {
	// Match the ARC runner's installed Node/Pi resolution, with a local-package fallback.
	const installedCli = join(dirname(realpathSync(process.execPath)), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
	const cli = process.env.PI_SCOPE_PROBE_CLI ?? (existsSync(installedCli) ? installedCli
		: join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "bundle", "cli.js"));
	const root = process.env.ARC_SCOPE_PROBE_ROOT ? resolve(process.env.ARC_SCOPE_PROBE_ROOT) : mkdtempSync(join(tmpdir(), "thin-scope-pi-"));
	mkdirSync(root, { recursive: true });
	let actions = ["RESET", "ACTION1"], submitted: string[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", chunk => { body += chunk; });
		request.on("end", () => {
			if (request.url === "/action") {
				const action = JSON.parse(body).action;
				submitted.push(action);
				actions = action === "ACTION1" ? ["RESET", "ACTION6"] : action === "ACTION6" ? ["RESET"] : action === "RESET" ? ["ACTION3"] : [];
			}
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ frames: [Array.from({ length: 64 }, () => Array(64).fill(0))],
				state: "PLAYING", levels_completed: 0, agent_available_actions: actions, available_actions: ["ACTION5", "ACTION6"] }));
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const child = spawn(process.execPath, [cli, "--mode", "rpc", "--provider", "offline-arc-action-scope", "--model", "scripted",
		"--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
		"--extension", resolve("demo/arc_thin_extension.ts"), "--extension", resolve("tools/arc_thin_action_scope_probe.ts")], {
		cwd: resolve("."), env: { ...process.env, ARC_RUN_ROOT: root, ARC_THIN_VARIANT: "control",
			PI_ARC_BRIDGE_URL: `http://127.0.0.1:${(server.address() as any).port}` }, stdio: ["pipe", "pipe", "pipe"],
	});
	const events: any[] = [];
	let stderr = "", complete: (() => void) | undefined, reject: ((error: Error) => void) | undefined;
	child.stderr.on("data", chunk => { stderr += chunk; });
	const lines = createInterface({ input: child.stdout });
	lines.on("line", line => {
		let event: any;
		try { event = JSON.parse(line); } catch { return; }
		events.push(event);
		if (event.type === "agent_end") complete?.();
		if (event.type === "response" && event.success === false) reject?.(new Error(event.error));
	});
	child.on("exit", code => reject?.(new Error(`Pi exited ${code}: ${stderr}`)));
	try {
		for (let decision = 0; decision < 5; decision++) {
			await new Promise<void>((resolve, rejectPromise) => {
				const timer = setTimeout(() => rejectPromise(new Error(`Pi timeout: ${stderr}`)), 20_000);
				complete = () => { clearTimeout(timer); resolve(); };
				reject = error => { clearTimeout(timer); rejectPromise(error); };
				child.stdin.write(JSON.stringify({ type: "prompt", message: "Decide the next action." }) + "\n");
			});
		}
		const requests = readFileSync(join(root, "scope-provider-requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
		const tools = requests.map(row => row.tools.find((tool: any) => tool.name === "arc_action"));
		assert.deepEqual(tools.map(tool => tool?.parameters.properties.action.enum ?? []),
			[["RESET", "ACTION1"], ["RESET", "ACTION1"], ["RESET", "ACTION1"], ["RESET", "ACTION6"], ["RESET"], ["ACTION3"], []]);
		assert.deepEqual(tools.map(tool => !!tool?.parameters.properties.x), [false, false, false, true, false, false, false]);
		assert.deepEqual(submitted, ["ACTION1", "ACTION6", "RESET", "ACTION3"], "unavailable calls never reach the bridge");
		const errors = events.filter(row => row.type === "tool_execution_end" && row.isError);
		assert.equal(errors.length, 2, "both deliberate negative calls fail schema validation");
		assert.ok(errors.every(row => JSON.stringify(row.result).includes("Validation failed")), JSON.stringify(errors));
		writeFileSync(join(root, "scope-summary.json"), JSON.stringify({ passed: true, provider: "scripted", environment: "HTTP stand-in",
			requests: requests.length, submitted, validation_errors: errors.length, enums: tools.map(tool => tool?.parameters.properties.action.enum ?? []) }, null, 2));
	} finally {
		complete = undefined; reject = undefined;
		child.kill(); lines.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
		writeFileSync(join(root, "pi-events.jsonl"), events.map(row => JSON.stringify(row)).join("\n") + "\n");
		writeFileSync(join(root, "pi-stderr.log"), stderr);
	}
});
