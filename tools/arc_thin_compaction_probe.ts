import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager, convertToLlm, serializeConversation, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const source = fileURLToPath(import.meta.url);
const project = resolve(dirname(source), "..");
const counterexample = "DECISIVE_COUNTEREXAMPLE_AFTER_2000";
const refutation = "REFUTED_HYPOTHESIS";
const logRow = (path: string, value: unknown) => appendFileSync(path, JSON.stringify(value) + "\n", "utf8");

export default function compactionProbe(pi: ExtensionAPI) {
	const file = join(process.env.ARC_RUN_ROOT ?? process.cwd(), "compaction-probe.jsonl");
	const record = (event: string, value: Record<string, unknown>) => logRow(file, { t: new Date().toISOString(), event, ...value });
	pi.on("session_before_compact", (event, ctx) => {
		const preparation = event.preparation;
		const serialized = serializeConversation(convertToLlm(preparation.messagesToSummarize));
		const lines = serialized.split(/(?=\[(?:Assistant thinking|Tool result|Assistant|User)\]:)/);
		const chars = (prefix: string) => lines.filter((line) => line.startsWith(prefix)).reduce((sum, line) => sum + line.length, 0);
		const projection = ctx.sessionManager.buildSessionProjection();
		record("preparation", {
			reason: event.reason, willRetry: event.willRetry,
			messagesToSummarize: preparation.messagesToSummarize.length,
			turnPrefixMessages: preparation.turnPrefixMessages.length, isSplitTurn: preparation.isSplitTurn,
			previousSummaryChars: preparation.previousSummary?.length ?? 0,
			tokensBefore: preparation.tokensBefore, firstKeptEntryId: preparation.firstKeptEntryId,
			settings: preparation.settings, serializedChars: serialized.length,
			histogram: { reasoning: chars("[Assistant thinking]"), toolResult: chars("[Tool result]"),
				other: serialized.length - chars("[Assistant thinking]") - chars("[Tool result]") },
			counterexampleInInput: serialized.includes(counterexample), refutationInInput: serialized.includes(refutation),
			clippedResults: (serialized.match(/more characters truncated/g) ?? []).length,
			branch: ctx.sessionManager.getBranch().map((entry) => ({ id: entry.id, type: entry.type })),
			projection: projection.entries.map((entry) => ({ id: entry.sourceEntry.id, type: entry.sourceEntry.type,
				roles: entry.messages.map((message) => message.role) })),
		});
	});
	pi.on("session_compact", (event) => record("stored", { reason: event.reason, willRetry: event.willRetry,
		id: event.compactionEntry.id, firstKeptEntryId: event.compactionEntry.firstKeptEntryId,
		tokensBefore: event.compactionEntry.tokensBefore, summary: event.compactionEntry.summary,
		usage: event.compactionEntry.usage }));
	pi.on("session_compact_failed", (event) => record("failed", { reason: event.reason, willRetry: event.willRetry,
		aborted: event.aborted, errorMessage: event.errorMessage }));
	pi.on("context", (event) => { record("context_input", { roles: event.messages.map((message) => message.role),
		containsSummary: JSON.stringify(event.messages).includes("Native checkpoint:") }); });
}

type Rpc = { send: (type: string, params?: Record<string, unknown>) => Promise<any>;
	wait: (predicate: (value: any) => boolean, start?: number) => Promise<any>; events: any[]; close: () => void };
function launch(command: string[], cwd: string, env: NodeJS.ProcessEnv, eventPath: string): Rpc {
	const child = spawn(process.execPath, command, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
	const events: any[] = [];
	let stderr = "";
	createInterface({ input: child.stdout }).on("line", (line) => {
		try { const value = JSON.parse(line); events.push(value); logRow(eventPath, value); } catch { stderr += line + "\n"; }
	});
	child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-10000); });
	let id = 0;
	const wait = async (predicate: (value: any) => boolean, start = 0) => {
		const deadline = Date.now() + 90000;
		while (Date.now() < deadline) {
			const found = events.slice(start).find(predicate);
			if (found) return found;
			if (child.exitCode !== null) throw new Error(`Pi exited ${child.exitCode}: ${stderr}`);
			await new Promise((done) => setTimeout(done, 20));
		}
		throw new Error(`Pi RPC timeout; stderr: ${stderr}`);
	};
	return {
		events, wait, close: () => child.kill(),
		send: async (type, params = {}) => {
			const request = { id: ++id, type, ...params };
			logRow(eventPath, { rpc_request: request });
			child.stdin.write(JSON.stringify(request) + "\n");
			return wait((value) => value.type === "response" && value.id === request.id);
		},
	};
}

function seed(root: string, variant: string): string {
	const manager = SessionManager.create(root, join(root, "sessions"));
	const count = variant === "V8" ? 1 : variant === "V4" ? 8 : 20;
	const text = (value: string) => [{ type: "text" as const, text: value }];
	for (let index = 0; index < count; index++) {
		manager.appendMessage({ role: "user", content: text(`Decision ${index}: inspect the current grid.`), timestamp: Date.now() });
		const callId = `seed-${index}`;
		manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "offline-arc-thin-smoke",
			model: "scripted", timestamp: Date.now(), stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: index === 1 ? "THINKING_MARKER_".repeat(350) : "Check evidence." },
				{ type: "text", text: index === 1 ? "Hypothesis MOVES_RIGHT." : index === 2
					? `${refutation}: ACTION1 did not move right; ACTION4 is the correct follow-up.` : `Decision ${index} recorded.` },
				{ type: "toolCall", id: callId, name: "arc_action", arguments: { action: "ACTION1" } },
			], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
		const body = index === 3 ? "R".repeat(2200) + counterexample + "R".repeat(7800)
			: `Receipt ${index}: ` + "observed grid; ".repeat(140);
		manager.appendMessage({ role: "toolResult", toolCallId: callId, toolName: "arc_action",
			content: text(body), isError: false, timestamp: Date.now() });
	}
	return manager.getSessionFile()!;
}

async function variantRun(root: string, variant: string, cli: string) {
	mkdirSync(root, { recursive: true });
	mkdirSync(join(root, ".pi"), { recursive: true });
	mkdirSync(join(root, ".pi-agent"), { recursive: true });
	const probeSettings = JSON.stringify({ compaction: {
		enabled: false, reserveTokens: 1200, keepRecentTokens: variant === "V3" ? 200 : 1600 } });
	writeFileSync(join(root, ".pi", "settings.json"), probeSettings);
	writeFileSync(join(root, ".pi-agent", "settings.json"), probeSettings);
	const session = seed(root, variant);
	const actions: string[] = [];
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/action") {
			let body = "";
			request.on("data", (chunk) => { body += chunk; });
			request.on("end", () => { actions.push(JSON.parse(body).action); response.end(JSON.stringify(state)); });
		} else if (request.url === "/state") response.end(JSON.stringify(state));
		else { response.statusCode = 404; response.end("{}"); }
	});
	const state = { frames: [[[0, 0], [0, 9]]], state: "PLAYING", levels_completed: 0,
		agent_available_actions: ["ACTION1", "ACTION4"], available_actions: ["ACTION1", "ACTION4"] };
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("probe bridge did not bind");
	const env = { ...process.env, PI_CODING_AGENT_DIR: join(root, ".pi-agent"), ARC_RUN_ROOT: root,
		ARC_GAME: "ls20", ARC_THIN_VARIANT: "treatment", ARC_THIN_CONTINUITY: "session",
		ARC_THIN_CONTINUITY_DECISIONS: "8", ARC_HARNESS_LEDGER: "disabled", ARC_HARNESS_CRITIC: "disabled",
		PI_ARC_BRIDGE_URL: `http://127.0.0.1:${address.port}`, PI_ARC_ACTION_TOKEN: "scripted-probe",
		ARC_THIN_COMPACTION_PROBE: variant };
	const rpc = launch([cli, "--mode", "rpc", "--provider", "offline-arc-thin-smoke", "--model", "scripted",
		"--session", session, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		"--no-builtin-tools", "--extension", join(project, "demo", "arc_thin_extension.ts"),
		"--extension", source, "--extension", join(project, "tools", "arc_thin_smoke_provider.ts")], root, env,
		join(root, "pi-events.jsonl"));
	try {
		logRow(join(root, "compaction-probe.jsonl"), { event: "rpc_state", response: await rpc.send("get_state") });
		const started = Date.now();
		let compact: any;
		if (variant === "V6") {
			const pending = rpc.send("compact");
			await rpc.wait((event) => event.type === "compaction_start");
			await new Promise((done) => setTimeout(done, 100));
			await rpc.send("abort");
			compact = await pending;
		} else compact = await rpc.send("compact");
		const wallMs = Date.now() - started;
		const before = rpc.events.length;
		if (compact.success) {
			await rpc.send("prompt", { message: "Decision after native compaction: use retained evidence." });
			await rpc.wait((event) => event.type === "agent_end", before);
		}
		let secondCompact: any;
		if (variant === "V5" && compact.success) secondCompact = await rpc.send("compact");
		const requests = readRows(join(root, "probe-provider.jsonl"));
		const hooks = readRows(join(root, "compaction-probe.jsonl"));
		const projection = SessionManager.open(session).buildSessionProjection();
		const ordinary = requests.filter((request) => !request.summary);
		const result = { variant, compact, secondCompact, wallMs, preparation: hooks.find((row) => row.event === "preparation"),
			stored: hooks.find((row) => row.event === "stored"), failed: hooks.find((row) => row.event === "failed"),
			summaryRequests: requests.filter((request) => request.summary).length,
			ordinaryRequests: ordinary.length, nextRequestHasSummary: JSON.stringify(ordinary[0] ?? {}).includes("Native checkpoint:"),
			counterexampleInNext: JSON.stringify(ordinary[0] ?? {}).includes(counterexample), actions,
			projectionRoles: projection.messages.map((message) => message.role),
			contextBudgetRows: readRows(join(root, "harness", "context_budget.jsonl")).length };
		logRow(join(dirname(root), "compaction-probe.jsonl"), result);
		return result;
	} finally { rpc.close(); server.close(); }
}

function readRows(path: string): any[] {
	try { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
	catch { return []; }
}

if (resolve(process.argv[1] ?? "") === source) {
	const root = resolve(process.argv[2] ?? join(project, "runs", `arc-thin-compaction-probe-${Date.now()}`));
	const cli = resolve(process.argv[3] ?? join(project, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"));
	const version = JSON.parse(readFileSync(resolve(dirname(cli), "..", "package.json"), "utf8")).version;
	if (version !== "0.87.0") throw new Error(`Refusing mixed Pi version ${version} at ${cli}`);
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "run-config.json"), JSON.stringify({ pi_cli: cli, pi_version: version,
		provider: "offline-arc-thin-smoke", model: "scripted", paidTokens: 0, continuity: "session" }, null, 2) + "\n");
	const results = [];
	for (const variant of (process.argv[4] ? [process.argv[4]] : ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"])) {
		try { results.push(await variantRun(join(root, variant), variant, cli)); }
		catch (error) { const result = { variant, error: String(error) }; results.push(result);
			logRow(join(root, "compaction-probe.jsonl"), result); }
	}
	writeFileSync(join(root, "summary.json"), JSON.stringify(results, null, 2) + "\n");
	console.log(JSON.stringify({ root, results }, null, 2));
	if (results.every((result) => "error" in result)) process.exitCode = 1;
}
