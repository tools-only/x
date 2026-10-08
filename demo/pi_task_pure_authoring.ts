/** Validate normal Python syntax or legacy IR; authored Python runs only in WASI. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	validateTaskPureExpressionProgram as validateIR, validateTaskPureExpressionInputAccess as validateIRInputAccess,
	TASK_PURE_EXPRESSION_FORMAT, PURE_EXPRESSION_DEFAULT_LIMITS, PureExpressionError,
	type PureExpressionLimitRequest, type ValidatedPureExpressionProgram,
} from "./pi_task_pure_expression.ts";

import { TASK_PYTHON_FORMAT, taskPythonRuntimeIdentity, taskPythonLimits,
	type ValidatedTaskPythonProgram } from "./pi_task_python.ts";
export { TASK_PYTHON_FORMAT } from "./pi_task_python.ts";

export const TASK_PURE_PYTHON_FORMAT = "task-pure-python-v1" as const;
export function isTaskPureAuthoringProgram(program: any): boolean {
	return program?.format === TASK_PURE_EXPRESSION_FORMAT || isTaskPythonAuthoringProgram(program);
}
export function isTaskPythonAuthoringProgram(program: any): boolean {
	return program?.format === TASK_PYTHON_FORMAT || program?.format === TASK_PURE_PYTHON_FORMAT;
}
export type PureSourceEvidence = {
	format: typeof TASK_PURE_PYTHON_FORMAT | typeof TASK_PYTHON_FORMAT; source: string; source_sha256: string;
	compiler_sha256: string; python_version: string; compiled_expression_sha256?: string;
};
export type AuthoredPureProgram = (ValidatedPureExpressionProgram | ValidatedTaskPythonProgram) & { source_evidence?: PureSourceEvidence };
export class PureAuthoringError extends PureExpressionError {
	readonly issues: Array<{ path: string; message: string }>;
	constructor(issues: Array<{ path: string; message: string }>) {
		super("invalid_program", issues.map(issue => issue.message).join("; "), "$.source",
			{ steps: 0, constructed_elements: 0, allocation_bytes: 0, input_bytes: 0, output_bytes: 0 },
			{ ...PURE_EXPRESSION_DEFAULT_LIMITS });
		this.issues = issues;
	}
}
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const helper = fileURLToPath(new URL("./pi_task_pure_python_lower.py", import.meta.url));
let compilerHash: string | undefined;
let compilerScript: string | undefined;
const cache = new Map<string, { evidence: PureSourceEvidence; bytes: number }>();
let cachedBytes = 0;
const invalid = (message: string, path = "$.source"): never => {
	throw new PureExpressionError("invalid_program", message, path,
		{ steps: 0, constructed_elements: 0, allocation_bytes: 0, input_bytes: 0, output_bytes: 0 },
		{ ...PURE_EXPRESSION_DEFAULT_LIMITS });
};

export function validateTaskPureExpressionProgram(program: unknown, limits?: PureExpressionLimitRequest): AuthoredPureProgram {
	if (!program || typeof program !== "object" || Array.isArray(program)
		|| !isTaskPythonAuthoringProgram(program)) return validateIR(program, limits);
	const authored = program as Record<string, unknown>;
	if (![Object.prototype, null].includes(Object.getPrototypeOf(authored))) invalid("program must be a plain object", "$");
	if (Object.keys(authored).some(key => !["format", "source", "limits", "runtime"].includes(key)))
		invalid("Python program accepts format, source, and optional limits", "$");
	if (typeof authored.source !== "string" || !authored.source.trim()) invalid("source must be nonempty Python");
	const source = authored.source as string;
	if (Buffer.from(source, "utf8").toString("utf8") !== source)
		invalid("source must contain valid Unicode without unpaired surrogates");
	if (Buffer.byteLength(source, "utf8") > 16 * 1024) invalid("source exceeds 16KiB");
	if (!compilerHash) {
		const helperBytes = readFileSync(helper);
		compilerScript = helperBytes.toString("utf8");
		compilerHash = hash(Buffer.concat([helperBytes, readFileSync(fileURLToPath(import.meta.url))]));
	}
	const key = hash(`${compilerHash}\0${authored.format}\0${source}`);
	let compiled = cache.get(key);
	if (!compiled) {
		// Execute the trusted helper bytes that were hashed, so a later file
		// edit cannot silently change the compiler behind saved provenance.
		const child = spawnSync("python", ["-I", "-S", "-c", compilerScript!], {
			input: source, encoding: "utf8", timeout: 2000, maxBuffer: 512 * 1024,
			windowsHide: true, shell: false,
		});
		if (child.error) invalid(`source parser failed: ${child.error.message}`);
		let result: any;
		try { result = JSON.parse(child.stdout); } catch { invalid("source parser returned invalid output"); }
		if (child.status !== 0 || result.ok !== true) {
			const diagnostics = Array.isArray(result.errors) && result.errors.length
				? result.errors.slice(0, 8) : [result.error ?? { message: "parser failure" }];
			const sourceLines = source.split(/\r?\n/);
			const issues = diagnostics.map((error: any) => {
				const line = Number.isSafeInteger(error.line) && error.line > 0 ? error.line : undefined;
				const column = Number.isSafeInteger(error.column) && error.column > 0 ? error.column : undefined;
				const sourceLine = line !== undefined ? sourceLines[line - 1] : undefined;
				const start = Math.max(0, (column ?? 1) - 61);
				const snippet = sourceLine !== undefined ? `; source: ${JSON.stringify(sourceLine.slice(start, start + 120))}` : "";
				return { path: "$.source", message: `source rejected${line !== undefined ? ` at line ${line}${column !== undefined ? `, column ${column}` : ""}` : ""}: ${String(error.message).slice(0, 240)}${snippet}` };
			});
			if (Number.isSafeInteger(result.omitted_errors) && result.omitted_errors > 0)
				issues.push({ path: "$.source", message: `${result.omitted_errors} additional source diagnostics omitted` });
			// Source rejection must not hide independent malformed limit fields.
			// Validate independent execution-limit fields as well.
			try { taskPythonLimits(authored.limits ?? {}, limits); }
			catch (error: any) {
				issues.push({ path: String(error.path ?? "$.limits"), message: String(error.message).slice(0, 240) });
			}
			throw new PureAuthoringError(issues);
		}
		compiled = { evidence: {
			format: authored.format as typeof TASK_PURE_PYTHON_FORMAT | typeof TASK_PYTHON_FORMAT,
			source: source, source_sha256: hash(source),
			compiler_sha256: compilerHash, python_version: "3.12.0",
		}, bytes: Buffer.byteLength(source) };
		while (cache.size >= 8 || cachedBytes + compiled.bytes > 128 * 1024) {
			const firstKey = cache.keys().next().value!;
			cachedBytes -= cache.get(firstKey)!.bytes; cache.delete(firstKey);
		}
		cache.set(key, compiled); cachedBytes += compiled.bytes;
	}
	const runtime = taskPythonRuntimeIdentity();
	if (authored.runtime !== undefined && JSON.stringify(authored.runtime) !== JSON.stringify(runtime))
		invalid("saved Python runtime changed; publish a new version", "$.runtime");
	return { format: TASK_PYTHON_FORMAT, source: source,
		limits: { ...(authored.limits as any ?? {}) },
		effective_limits: taskPythonLimits(authored.limits ?? {}, limits), runtime,
		source_evidence: { ...compiled.evidence } };
}

/** Static IR access checks apply to the old IR. Python input is checked at invocation. */
export function validateTaskAuthoringInputAccess(program: AuthoredPureProgram, schema: unknown): void {
	if (program.format === TASK_PURE_EXPRESSION_FORMAT) validateIRInputAccess(program, schema);
}
