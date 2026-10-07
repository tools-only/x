/** Compile authored syntax to the existing bounded IR; never execute source. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	validateTaskPureExpressionProgram as validateIR,
	TASK_PURE_EXPRESSION_FORMAT, PURE_EXPRESSION_DEFAULT_LIMITS, PureExpressionError,
	type PureExpressionLimitRequest, type ValidatedPureExpressionProgram,
} from "./pi_task_pure_expression.ts";

export const TASK_PURE_PYTHON_FORMAT = "task-pure-python-v1" as const;
export function isTaskPureAuthoringProgram(program: any): boolean {
	return program?.format === TASK_PURE_EXPRESSION_FORMAT || program?.format === TASK_PURE_PYTHON_FORMAT;
}
export type PureSourceEvidence = {
	format: typeof TASK_PURE_PYTHON_FORMAT; source: string; source_sha256: string;
	compiler_sha256: string; python_version: string; compiled_expression_sha256: string;
};
export type AuthoredPureProgram = ValidatedPureExpressionProgram & { source_evidence?: PureSourceEvidence };
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
const cache = new Map<string, { expression: Record<string, unknown>; evidence: PureSourceEvidence; bytes: number }>();
let cachedBytes = 0;
const invalid = (message: string, path = "$.source"): never => {
	throw new PureExpressionError("invalid_program", message, path,
		{ steps: 0, constructed_elements: 0, allocation_bytes: 0, input_bytes: 0, output_bytes: 0 },
		{ ...PURE_EXPRESSION_DEFAULT_LIMITS });
};

export function validateTaskPureExpressionProgram(program: unknown, limits?: PureExpressionLimitRequest): AuthoredPureProgram {
	if (!program || typeof program !== "object" || Array.isArray(program)
		|| (program as any).format !== TASK_PURE_PYTHON_FORMAT) return validateIR(program, limits);
	const authored = program as Record<string, unknown>;
	if (![Object.prototype, null].includes(Object.getPrototypeOf(authored))) invalid("program must be a plain object", "$");
	if (Object.keys(authored).some(key => !["format", "source", "limits"].includes(key)))
		invalid("source program accepts only format, source, and optional limits", "$");
	if (typeof authored.source !== "string" || !authored.source.trim()) invalid("source must be a nonempty expression");
	if (Buffer.from(authored.source, "utf8").toString("utf8") !== authored.source)
		invalid("source must contain valid Unicode without unpaired surrogates");
	if (Buffer.byteLength(authored.source, "utf8") > 16 * 1024) invalid("source exceeds 16KiB");
	if (!compilerHash) {
		const helperBytes = readFileSync(helper);
		compilerScript = helperBytes.toString("utf8");
		compilerHash = hash(Buffer.concat([helperBytes, readFileSync(fileURLToPath(import.meta.url))]));
	}
	const key = hash(`${compilerHash}\0${authored.source}`);
	let compiled = cache.get(key);
	if (!compiled) {
		// Execute the trusted helper bytes that were hashed, so a later file
		// edit cannot silently change the compiler behind saved provenance.
		const child = spawnSync("python", ["-I", "-S", "-c", compilerScript!], {
			input: authored.source, encoding: "utf8", timeout: 2000, maxBuffer: 512 * 1024,
			windowsHide: true, shell: false,
		});
		if (child.error) invalid(`source parser failed: ${child.error.message}`);
		let result: any;
		try { result = JSON.parse(child.stdout); } catch { invalid("source parser returned invalid output"); }
		if (child.status !== 0 || result.ok !== true) {
			const diagnostics = Array.isArray(result.errors) && result.errors.length
				? result.errors.slice(0, 8) : [result.error ?? { message: "parser failure" }];
			const issues = diagnostics.map((error: any) => ({ path: "$.source",
				message: `source rejected: ${String(error.message).slice(0, 240)}` }));
			if (Number.isSafeInteger(result.omitted_errors) && result.omitted_errors > 0)
				issues.push({ path: "$.source", message: `${result.omitted_errors} additional source diagnostics omitted` });
			// Source rejection must not hide independent malformed limit fields.
			// Reuse the native validator; ignore placeholder-specific AST errors.
			try { validateIR({ format: TASK_PURE_EXPRESSION_FORMAT, limits: authored.limits ?? {},
				expression: { op: "literal", value: null } }, limits); }
			catch (error) {
				if (error instanceof PureExpressionError && error.path.startsWith("$.limits"))
					issues.push({ path: error.path.slice(0, 200), message: error.message.slice(0, 240) });
			}
			throw new PureAuthoringError(issues);
		}
		const expression = result.expression;
		const expressionJSON = JSON.stringify(expression);
		// The parser has its own hard caps; the existing IR validator also proves
		// lexical scopes, keys, operations and actual publication limits below.
		validateIR({ format: TASK_PURE_EXPRESSION_FORMAT, expression, limits: authored.limits ?? {} }, limits);
		compiled = { expression, evidence: {
			format: TASK_PURE_PYTHON_FORMAT, source: authored.source,
			source_sha256: hash(authored.source), compiler_sha256: compilerHash,
			python_version: String(result.source_info?.python_version ?? "unknown"),
			compiled_expression_sha256: hash(expressionJSON),
		}, bytes: Buffer.byteLength(expressionJSON) + Buffer.byteLength(authored.source) };
		if (compiled.bytes <= 128 * 1024) {
			while (cache.size >= 8 || cachedBytes + compiled.bytes > 128 * 1024) {
				const firstKey = cache.keys().next().value!;
				cachedBytes -= cache.get(firstKey)!.bytes; cache.delete(firstKey);
			}
			cache.set(key, compiled); cachedBytes += compiled.bytes;
		}
	}
	const expression = JSON.parse(JSON.stringify(compiled.expression));
	return { ...validateIR({ format: TASK_PURE_EXPRESSION_FORMAT, expression, limits: authored.limits ?? {} }, limits),
		source_evidence: { ...compiled.evidence } };
}
