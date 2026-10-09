/** Ordinary CPython in WASI; the guest receives JSON, never host capabilities. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const TASK_PYTHON_FORMAT = "task-python-v1" as const;
export const TASK_PYTHON_MODULE_SHA256 = "e5dc5a398b07b54ea8fdb503bf68fb583d533f10ec3f930963e02b9505f7a763";
export const TASK_PYTHON_DEFAULT_LIMITS = Object.freeze({
	input_bytes: 128 * 1024, output_bytes: 64 * 1024, json_depth: 32,
	allocation_bytes: 8 * 1024 * 1024, memory_bytes: 128 * 1024 * 1024,
	fuel: 1_000_000_000, timeout_ms: 20_000,
});
const HARD_LIMITS = Object.freeze({
	input_bytes: 512 * 1024, output_bytes: 256 * 1024, json_depth: 64,
	allocation_bytes: 32 * 1024 * 1024, memory_bytes: 256 * 1024 * 1024,
	fuel: 4_000_000_000, timeout_ms: 30_000,
});
export type TaskPythonLimits = { -readonly [K in keyof typeof TASK_PYTHON_DEFAULT_LIMITS]: number };
export type TaskPythonRuntime = { python_version: string; wasmtime_version: string; module_sha256: string; runner_sha256: string };
export type ValidatedTaskPythonProgram = {
	format: typeof TASK_PYTHON_FORMAT; source: string; limits: Partial<TaskPythonLimits>;
	effective_limits: TaskPythonLimits; runtime: TaskPythonRuntime;
};
export class TaskPythonError extends Error {
	constructor(readonly code: string, message: string, readonly path = "$program",
		readonly consumed?: Record<string, number>, readonly effective_limits?: TaskPythonLimits) { super(message); }
	toJSON() { return { format: "task-python-error-v1", code: this.code, message: this.message,
		path: this.path, ...(this.consumed ? { consumed: this.consumed } : {}),
		...(this.effective_limits ? { effective_limits: this.effective_limits } : {}) }; }
}
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const runner = fileURLToPath(new URL("./pi_task_python_runtime.py", import.meta.url));
const require = createRequire(import.meta.url);
export function taskPythonRuntimeIdentity(): TaskPythonRuntime {
	return { python_version: "3.12.0", wasmtime_version: "49.0.0",
		module_sha256: TASK_PYTHON_MODULE_SHA256, runner_sha256: hash(readFileSync(runner)) };
}
export function taskPythonLimits(request: unknown = {}, ceiling?: Partial<Record<string, number>>): TaskPythonLimits {
	if (!request || typeof request !== "object" || Array.isArray(request))
		throw new TaskPythonError("invalid_program", "Python limits must be an object", "$.limits");
	const result = { ...TASK_PYTHON_DEFAULT_LIMITS } as TaskPythonLimits;
	for (const [key, value] of Object.entries(request)) {
		if (!Object.hasOwn(HARD_LIMITS, key) || !Number.isSafeInteger(value) || (value as number) < 1)
			throw new TaskPythonError("invalid_program", "Unknown or invalid Python execution limit", `$.limits.${key}`);
		if ((value as number) > HARD_LIMITS[key as keyof TaskPythonLimits])
			throw new TaskPythonError("invalid_program", "Python limit exceeds the runtime ceiling", `$.limits.${key}`);
		result[key as keyof TaskPythonLimits] = value as number;
	}
	if (ceiling) for (const key of Object.keys(result) as Array<keyof TaskPythonLimits>)
		if (ceiling[key] !== undefined) {
			if (!Number.isSafeInteger(ceiling[key]) || ceiling[key]! < 1)
				throw new TaskPythonError("invalid_program", "Invalid runtime execution ceiling", `$.limits.${key}`);
			result[key] = Math.min(result[key], ceiling[key]!);
		}
	return result;
}
function modulePath(): string {
	try { return require.resolve("@antonz/python-wasi/dist/python.wasm"); }
	catch { throw new TaskPythonError("environment_unavailable", "Install @antonz/python-wasi@3.12.0 for task Python"); }
}
let checkedRuntime: string | undefined;
export function assertTaskPythonRuntimeAvailable(runtime: TaskPythonRuntime): void {
	if (JSON.stringify(runtime) !== JSON.stringify(taskPythonRuntimeIdentity()))
		throw new TaskPythonError("version_conflict", "This Python tool's pinned runtime has changed; publish a new version");
	const path = modulePath();
	const key = JSON.stringify(runtime) + path;
	if (checkedRuntime === key) return;
	const child = spawnSync("python", ["-I", runner, "--check", path], {
		encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024, windowsHide: true, shell: false,
	});
	let response: any;
	try { response = JSON.parse(child.stdout); } catch { /* Report the infrastructure failure below. */ }
	if (child.error || child.status !== 0 || response?.ok !== true)
		throw new TaskPythonError("environment_unavailable", String(response?.error ?? child.error?.message
			?? "Task Python runtime unavailable; install the self-harness-python Python extra").slice(0, 1200));
	if (JSON.stringify(response.runtime) !== JSON.stringify(runtime))
		throw new TaskPythonError("version_conflict", "Python runtime identity does not match the saved tool");
	checkedRuntime = key;
}
function checkJson(value: unknown, depth: number, maximum: number): void {
	if (depth > maximum) throw new TaskPythonError("invalid_output", "JSON exceeds json_depth", "$output");
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (typeof value !== "object" || value === undefined)
		throw new TaskPythonError("invalid_output", "Python result must be finite JSON", "$output");
	for (const child of Object.values(value)) checkJson(child, depth + 1, maximum);
}
export async function evaluateTaskPython(program: ValidatedTaskPythonProgram, input: Record<string, unknown>,
	signal?: AbortSignal) {
	if (signal?.aborted) throw new TaskPythonError("cancelled", "Python calculation cancelled");
	assertTaskPythonRuntimeAvailable(program.runtime);
	const limits = program.effective_limits;
	const inputJson = JSON.stringify(input);
	if (Buffer.byteLength(inputJson) > limits.input_bytes)
		throw new TaskPythonError("invalid_input", "Input exceeds input_bytes", "$input");
	const response = await new Promise<any>((resolve, reject) => {
		const child = spawn("python", ["-I", runner, "--run", modulePath()], {
			stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false,
		});
		const chunks: Buffer[] = [];
		let bytes = 0, diagnostic = "", failure: TaskPythonError | undefined;
		const stop = (code: string, message: string) => {
			failure ??= new TaskPythonError(code, message, "$program", undefined, limits);
			child.kill();
		};
		const cancel = () => stop("cancelled", "Python calculation cancelled");
		const timer = setTimeout(() => stop("timeout", "Python calculation exceeded timeout_ms"), limits.timeout_ms);
		signal?.addEventListener("abort", cancel, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > limits.output_bytes * 6 + 16 * 1024) stop("invalid_output", "Python result envelope exceeds output budget");
			else chunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString("utf8")).slice(0, 2048); });
		child.stdin.on("error", () => { /* Process termination is handled by close/error. */ });
		child.on("error", error => { failure ??= new TaskPythonError("environment_unavailable", error.message); });
		child.on("close", () => {
			clearTimeout(timer); signal?.removeEventListener("abort", cancel);
			if (failure) { reject(failure); return; }
			try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
			catch { reject(new TaskPythonError("runtime_error", diagnostic || "Python runtime returned no valid result")); }
		});
		if (signal?.aborted) cancel();
		else child.stdin.end(JSON.stringify({ source: program.source, input, limits, runtime: program.runtime }));
	});
	if (signal?.aborted) throw new TaskPythonError("cancelled", "Python calculation cancelled");
	return taskPythonResult(program, response);
}

/** Shared trusted-boundary checks for one guest response. */
export function taskPythonResult(program: ValidatedTaskPythonProgram, response: any) {
	const limits = program.effective_limits;
	if (!response?.ok) throw new TaskPythonError("runtime_error", String(response?.error ?? "Python execution failed"),
		"$program", response?.consumed, limits);
	if (JSON.stringify(response.runtime) !== JSON.stringify(program.runtime))
		throw new TaskPythonError("version_conflict", "Executed Python runtime differs from the saved version");
	checkJson(response.value, 0, limits.json_depth);
	const output = JSON.stringify(response.value);
	if (typeof output !== "string" || Buffer.byteLength(output) > limits.output_bytes)
		throw new TaskPythonError("invalid_output", "JSON result exceeds output_bytes", "$output");
	return { value: response.value, output_json: output, consumed: response.consumed,
		effective_limits: limits, runtime: response.runtime };
}

export function taskPythonModulePath(): string { return modulePath(); }
