/**
 * A task-independent, deterministic evaluator for the task-pure-expression-v1
 * JSON AST.  This module deliberately has no host, adapter, resource, clock,
 * filesystem, network, process, package-loader, or environment dependency.
 */

export const TASK_PURE_EXPRESSION_FORMAT = "task-pure-expression-v1" as const;

export const TASK_PURE_EXPRESSION_OPERATORS = Object.freeze([
	"input", "literal", "var", "let", "get", "index", "object", "array",
	"add", "subtract", "multiply", "eq", "lt", "lte", "and", "or", "not", "if",
	"range", "map", "flat_map", "filter", "all", "length", "assert",
	"grid_reachability",
] as const);

export const PURE_EXPRESSION_DEFAULT_LIMITS = Object.freeze({
	ast_nodes: 2_048,
	ast_depth: 32,
	json_depth: 32,
	input_bytes: 128 * 1_024,
	steps: 250_000,
	collection_length: 8_192,
	constructed_elements: 100_000,
	allocation_bytes: 8 * 1_024 * 1_024,
	output_bytes: 64 * 1_024,
});

export const PURE_EXPRESSION_HARD_LIMITS = Object.freeze({
	ast_nodes: 8_192,
	ast_depth: 64,
	json_depth: 64,
	input_bytes: 512 * 1_024,
	steps: 1_000_000,
	collection_length: 32_768,
	constructed_elements: 500_000,
	allocation_bytes: 32 * 1_024 * 1_024,
	output_bytes: 256 * 1_024,
});

export type PureExpressionLimitName = keyof typeof PURE_EXPRESSION_DEFAULT_LIMITS;
export type PureExpressionLimits = Record<PureExpressionLimitName, number>;
export type PureExpressionLimitRequest = Partial<PureExpressionLimits>;

export type PureExpressionErrorCode =
	| "invalid_program"
	| "invalid_input"
	| "invalid_output"
	| "type_error"
	| "missing_field"
	| "index_out_of_bounds"
	| "assertion_failed"
	| "budget_exhausted"
	| "output_too_large"
	| "cancelled";

export interface PureExpressionConsumption {
	steps: number;
	constructed_elements: number;
	allocation_bytes: number;
	input_bytes: number;
	output_bytes: number;
}

export class PureExpressionError extends Error {
	readonly code: PureExpressionErrorCode;
	readonly path: string;
	readonly consumed: PureExpressionConsumption;
	readonly effective_limits: PureExpressionLimits;

	constructor(
		code: PureExpressionErrorCode,
		message: string,
		path: string,
		consumed: PureExpressionConsumption,
		effectiveLimits: PureExpressionLimits,
	) {
		super(message);
		this.name = "PureExpressionError";
		this.code = code;
		this.path = path;
		this.consumed = { ...consumed };
		this.effective_limits = { ...effectiveLimits };
	}

	toJSON(): Record<string, unknown> {
		return {
			format: "task-pure-expression-error-v1",
			code: this.code,
			message: this.message,
			path: this.path,
			consumed: this.consumed,
			effective_limits: this.effective_limits,
		};
	}
}

export interface ValidatedPureExpressionProgram {
	format: typeof TASK_PURE_EXPRESSION_FORMAT;
	expression: Record<string, unknown>;
	limits: PureExpressionLimitRequest;
	effective_limits: PureExpressionLimits;
	static_usage: { ast_nodes: number; ast_depth: number; literal_elements: number; literal_bytes: number; program_bytes: number };
}

export interface PureExpressionEvaluation {
	value: unknown;
	output_json: string;
	effective_limits: PureExpressionLimits;
	consumed: PureExpressionConsumption;
}

export interface PureExpressionEvaluationOptions {
	runtime_limits?: PureExpressionLimitRequest;
	is_cancelled?: () => boolean;
}

const LIMIT_NAMES = Object.keys(PURE_EXPRESSION_DEFAULT_LIMITS) as PureExpressionLimitName[];
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const BINARY_OPS = new Set(["add", "subtract", "multiply", "eq", "lt", "lte", "and", "or"]);
const MAX_AST_STRING_CODE_UNITS = 4_096;
const EMPTY_CONSUMPTION = (): PureExpressionConsumption => ({
	steps: 0, constructed_elements: 0, allocation_bytes: 0, input_bytes: 0, output_bytes: 0,
});

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function pathKey(path: string, key: string | number): string {
	return typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validBindingName(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && !FORBIDDEN_KEYS.has(value);
}

function utf8Bytes(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
			&& value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
	}
	return bytes;
}

function quotedJsonBytes(value: string): number {
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c
			|| code === 0x0a || code === 0x0d || code === 0x09) bytes += 2;
		else if (code < 0x20) bytes += 6;
		else if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
			&& value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4;
			index += 1;
		} else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
		else bytes += 3;
	}
	return bytes;
}

function resolveLimits(
	requested: unknown,
	runtime: PureExpressionLimitRequest | undefined,
	forPublication: boolean,
): PureExpressionLimits {
	if (requested !== undefined && !isRecord(requested)) {
		throw new PureExpressionError("invalid_program", "program.limits must be an object", "$.limits", EMPTY_CONSUMPTION(), { ...PURE_EXPRESSION_DEFAULT_LIMITS });
	}
	const request = (requested ?? {}) as Record<string, unknown>;
	for (const key of Object.keys(request)) {
		if (!LIMIT_NAMES.includes(key as PureExpressionLimitName)) {
			throw new PureExpressionError("invalid_program", `unknown limit: ${key}`, `$.limits.${key}`, EMPTY_CONSUMPTION(), { ...PURE_EXPRESSION_DEFAULT_LIMITS });
		}
	}
	const effective = {} as PureExpressionLimits;
	for (const key of LIMIT_NAMES) {
		const authored = request[key];
		if (authored !== undefined && (!Number.isSafeInteger(authored) || (authored as number) <= 0)) {
			throw new PureExpressionError("invalid_program", `${key} must be a positive safe integer`, `$.limits.${key}`, EMPTY_CONSUMPTION(), { ...PURE_EXPRESSION_DEFAULT_LIMITS });
		}
		if (forPublication && typeof authored === "number" && authored > PURE_EXPRESSION_HARD_LIMITS[key]) {
			throw new PureExpressionError("invalid_program", `${key} exceeds the runtime hard ceiling`, `$.limits.${key}`, EMPTY_CONSUMPTION(), { ...PURE_EXPRESSION_DEFAULT_LIMITS });
		}
		const runtimeValue = runtime?.[key];
		if (runtimeValue !== undefined && (!Number.isSafeInteger(runtimeValue) || runtimeValue <= 0)) {
			throw new Error(`invalid runtime limit: ${key}`);
		}
		effective[key] = Math.min(
			typeof authored === "number" ? authored : PURE_EXPRESSION_DEFAULT_LIMITS[key],
			runtimeValue ?? PURE_EXPRESSION_HARD_LIMITS[key],
			PURE_EXPRESSION_HARD_LIMITS[key],
		);
	}
	return effective;
}

interface JsonMeasure {
	bytes: number;
	elements: number;
	depth: number;
}

function measureStaticJson(
	value: unknown,
	path: string,
	maxDepth: number,
	maxCollectionLength: number,
	seen: WeakSet<object>,
	depth = 1,
): JsonMeasure {
	if (depth > maxDepth) throw new Error(`${path}: JSON depth exceeds limit`);
	if (value === null) return { bytes: 4, elements: 0, depth };
	if (typeof value === "boolean") return { bytes: value ? 4 : 5, elements: 0, depth };
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${path}: numbers must be finite`);
		return { bytes: utf8Bytes(String(value)), elements: 0, depth };
	}
	if (typeof value === "string") {
		if (value.length > MAX_AST_STRING_CODE_UNITS) throw new Error(`${path}: string exceeds ${MAX_AST_STRING_CODE_UNITS} code units`);
		return { bytes: quotedJsonBytes(value), elements: 0, depth };
	}
	if (typeof value !== "object" || value === undefined) throw new Error(`${path}: value is not JSON`);
	if (seen.has(value as object)) throw new Error(`${path}: cyclic values are not JSON`);
	seen.add(value as object);
	let bytes = 2;
	let elements = 0;
	let deepest = depth;
	if (Array.isArray(value)) {
		if (value.length > maxCollectionLength) throw new Error(`${path}: collection length exceeds limit`);
		for (let index = 0; index < value.length; index += 1) {
			const child = measureStaticJson(value[index], pathKey(path, index), maxDepth, maxCollectionLength, seen, depth + 1);
			bytes += child.bytes + (index ? 1 : 0);
			elements += child.elements + 1;
			deepest = Math.max(deepest, child.depth);
		}
	} else {
		if (!isRecord(value)) throw new Error(`${path}: objects must have a plain or null prototype`);
		const keys = Object.keys(value);
		if (keys.length > maxCollectionLength) throw new Error(`${path}: collection length exceeds limit`);
		for (let index = 0; index < keys.length; index += 1) {
			const key = keys[index];
			if (FORBIDDEN_KEYS.has(key)) throw new Error(`${pathKey(path, key)}: forbidden object key`);
			if (key.length > MAX_AST_STRING_CODE_UNITS) throw new Error(`${pathKey(path, key)}: key exceeds ${MAX_AST_STRING_CODE_UNITS} code units`);
			const child = measureStaticJson(value[key], pathKey(path, key), maxDepth, maxCollectionLength, seen, depth + 1);
			bytes += quotedJsonBytes(key) + 1 + child.bytes + (index ? 1 : 0);
			elements += child.elements + 1;
			deepest = Math.max(deepest, child.depth);
		}
	}
	seen.delete(value as object);
	return { bytes, elements, depth: deepest };
}

interface StaticUsage {
	nodes: number;
	depth: number;
	literalElements: number;
	literalBytes: number;
}

function invalidProgram(message: string, path: string, limits: PureExpressionLimits): never {
	throw new PureExpressionError("invalid_program", message, path, EMPTY_CONSUMPTION(), limits);
}

function validateExpression(
	expression: unknown,
	path: string,
	bindings: ReadonlySet<string>,
	limits: PureExpressionLimits,
	usage: StaticUsage,
	depth: number,
	active: WeakSet<object>,
): void {
	if (!isRecord(expression)) invalidProgram("expression must be an object", path, limits);
	if (active.has(expression)) invalidProgram("cyclic AST is not allowed", path, limits);
	active.add(expression);
	usage.nodes += 1;
	usage.depth = Math.max(usage.depth, depth);
	if (usage.nodes > limits.ast_nodes) invalidProgram("AST node limit exceeded", path, limits);
	if (depth > limits.ast_depth) invalidProgram("AST depth limit exceeded", path, limits);
	const op = expression.op;
	if (typeof op !== "string") invalidProgram("expression.op must be a string", `${path}.op`, limits);
	const exact = (keys: readonly string[]) => {
		if (!sameKeys(expression, ["op", ...keys])) invalidProgram(`operator ${op} requires exactly: op, ${keys.join(", ")}`, path, limits);
	};
	const child = (key: string, nextBindings = bindings) => validateExpression(expression[key], `${path}.${key}`, nextBindings, limits, usage, depth + 1, active);
	if (op === "input") exact([]);
	else if (op === "literal") {
		exact(["value"]);
		try {
			const measured = measureStaticJson(expression.value, `${path}.value`, limits.json_depth, limits.collection_length, new WeakSet());
			usage.literalBytes += measured.bytes;
			usage.literalElements += measured.elements;
		} catch (error) {
			invalidProgram(error instanceof Error ? error.message : String(error), `${path}.value`, limits);
		}
		if (usage.literalBytes > limits.allocation_bytes) invalidProgram("literal byte limit exceeded", `${path}.value`, limits);
		if (usage.literalElements > limits.constructed_elements) invalidProgram("literal element limit exceeded", `${path}.value`, limits);
	} else if (op === "var") {
		exact(["name"]);
		if (!validBindingName(expression.name)) invalidProgram("var.name must be a nonempty, non-forbidden string", `${path}.name`, limits);
		if (!bindings.has(expression.name)) invalidProgram(`undeclared variable: ${expression.name}`, `${path}.name`, limits);
	} else if (op === "let") {
		exact(["name", "value", "body"]);
		if (!validBindingName(expression.name)) invalidProgram("let.name must be a nonempty, non-forbidden string", `${path}.name`, limits);
		child("value");
		child("body", new Set([...bindings, expression.name]));
	} else if (op === "get") {
		exact(["value", "key"]); child("value"); child("key");
	} else if (op === "index") {
		exact(["array", "index"]); child("array"); child("index");
	} else if (op === "object") {
		exact(["fields"]);
		if (!Array.isArray(expression.fields)) invalidProgram("object.fields must be an array", `${path}.fields`, limits);
		if (expression.fields.length > limits.collection_length) invalidProgram("object.fields exceeds collection limit", `${path}.fields`, limits);
		const keys = new Set<string>();
		for (let index = 0; index < expression.fields.length; index += 1) {
			const field = expression.fields[index];
			const fieldPath = `${path}.fields[${index}]`;
			if (!isRecord(field) || !sameKeys(field, ["key", "value"])) invalidProgram("object field requires exactly key and value", fieldPath, limits);
			if (typeof field.key !== "string" || FORBIDDEN_KEYS.has(field.key)) invalidProgram("object field key must be a non-forbidden string", `${fieldPath}.key`, limits);
			if (keys.has(field.key)) invalidProgram(`duplicate object key: ${field.key}`, `${fieldPath}.key`, limits);
			keys.add(field.key);
			validateExpression(field.value, `${fieldPath}.value`, bindings, limits, usage, depth + 1, active);
		}
	} else if (op === "array") {
		exact(["items"]);
		if (!Array.isArray(expression.items)) invalidProgram("array.items must be an array", `${path}.items`, limits);
		if (expression.items.length > limits.collection_length) invalidProgram("array.items exceeds collection limit", `${path}.items`, limits);
		for (let index = 0; index < expression.items.length; index += 1) {
			validateExpression(expression.items[index], `${path}.items[${index}]`, bindings, limits, usage, depth + 1, active);
		}
	} else if (BINARY_OPS.has(op)) {
		exact(["left", "right"]); child("left"); child("right");
	} else if (op === "not") {
		exact(["value"]); child("value");
	} else if (op === "if") {
		exact(["condition", "then", "else"]); child("condition"); child("then"); child("else");
	} else if (op === "range") {
		exact(["start", "stop"]); child("start"); child("stop");
	} else if (op === "map" || op === "flat_map") {
		exact(["array", "as", "body"]);
		if (!validBindingName(expression.as)) invalidProgram(`${op}.as must be a nonempty, non-forbidden string`, `${path}.as`, limits);
		child("array"); child("body", new Set([...bindings, expression.as]));
	} else if (op === "filter" || op === "all") {
		exact(["array", "as", "predicate"]);
		if (!validBindingName(expression.as)) invalidProgram(`${op}.as must be a nonempty, non-forbidden string`, `${path}.as`, limits);
		child("array"); child("predicate", new Set([...bindings, expression.as]));
	} else if (op === "length") {
		exact(["value"]); child("value");
	} else if (op === "assert") {
		exact(["condition", "value", "message"]);
		if (typeof expression.message !== "string") invalidProgram("assert.message must be a string", `${path}.message`, limits);
		child("condition"); child("value");
	} else if (op === "grid_reachability") {
		exact(["grid", "start", "target", "footprint", "offsets", "passable", "max_nodes"]);
		for (const key of ["grid", "start", "target", "footprint", "offsets", "passable", "max_nodes"]) child(key);
	} else invalidProgram(`unknown operator: ${op}`, `${path}.op`, limits);
	active.delete(expression);
}

export function validateTaskPureExpressionProgram(
	program: unknown,
	runtimeLimits?: PureExpressionLimitRequest,
): ValidatedPureExpressionProgram {
	if (!isRecord(program)) invalidProgram("program must be an object", "$", { ...PURE_EXPRESSION_DEFAULT_LIMITS });
	if (!sameKeys(program, ["format", "expression", "limits"])) invalidProgram("program requires exactly format, expression, and limits", "$", { ...PURE_EXPRESSION_DEFAULT_LIMITS });
	if (program.format !== TASK_PURE_EXPRESSION_FORMAT) invalidProgram(`unsupported program format: ${String(program.format)}`, "$.format", { ...PURE_EXPRESSION_DEFAULT_LIMITS });
	const effective = resolveLimits(program.limits, runtimeLimits, true);
	let programBytes = 0;
	try {
		const programMeasure = measureStaticJson(program, "$", PURE_EXPRESSION_HARD_LIMITS.json_depth,
			effective.collection_length, new WeakSet());
		programBytes = programMeasure.bytes;
		if (programBytes > effective.allocation_bytes) invalidProgram("program byte limit exceeded", "$", effective);
	} catch (error) {
		if (error instanceof PureExpressionError) throw error;
		invalidProgram(error instanceof Error ? error.message : String(error), "$", effective);
	}
	const usage: StaticUsage = { nodes: 0, depth: 0, literalElements: 0, literalBytes: 0 };
	validateExpression(program.expression, "$.expression", new Set(), effective, usage, 1, new WeakSet());
	return {
		format: TASK_PURE_EXPRESSION_FORMAT,
		expression: program.expression as Record<string, unknown>,
		limits: { ...(program.limits as PureExpressionLimitRequest) },
		effective_limits: effective,
		static_usage: {
			ast_nodes: usage.nodes, ast_depth: usage.depth,
			literal_elements: usage.literalElements, literal_bytes: usage.literalBytes,
			program_bytes: programBytes,
		},
	};
}

/** Reject only object reads that the declared input schema proves impossible. */
export function validateTaskPureExpressionInputAccess(
	validated: ValidatedPureExpressionProgram,
	inputSchema: unknown,
): void {
	const schema = isRecord(inputSchema) ? inputSchema : {};
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const nonObjects = new Set(["null", "boolean", "integer", "number", "string", "array"]);
	const visit = (node: unknown, path: string): void => {
		if (!isRecord(node)) return;
		const op = node.op;
		if (op === "get" && isRecord(node.value) && node.value.op === "input"
			&& isRecord(node.key) && node.key.op === "literal"
			&& typeof node.key.value === "string" && schema.additionalProperties === false
			&& !Object.prototype.hasOwnProperty.call(properties, node.key.value))
			invalidProgram(`input.${node.key.value} is not declared in closed input_schema.properties.${node.key.value}; declare its type or use an open schema.`,
				`${path}.key`, validated.effective_limits);
		if (op === "get" && isRecord(node.value) && node.value.op === "get"
			&& isRecord(node.value.value) && node.value.value.op === "input"
			&& isRecord(node.value.key) && node.value.key.op === "literal"
			&& typeof node.value.key.value === "string") {
			const field = node.value.key.value;
			const fieldSchema = properties[field];
			const type = isRecord(fieldSchema) ? fieldSchema.type : undefined;
			if (typeof type === "string" && nonObjects.has(type))
				invalidProgram(`input.${field} is ${type}; get requires an object. Read the input field directly or declare an object schema.`,
					`${path}.value`, validated.effective_limits);
		}
		const child = (key: string) => visit(node[key], `${path}.${key}`);
		if (op === "let") { child("value"); child("body"); }
		else if (op === "get") { child("value"); child("key"); }
		else if (op === "index") { child("array"); child("index"); }
		else if (op === "object" && Array.isArray(node.fields))
			for (let index = 0; index < node.fields.length; index += 1)
				visit((node.fields[index] as Record<string, unknown>)?.value, `${path}.fields[${index}].value`);
		else if (op === "array" && Array.isArray(node.items))
			for (let index = 0; index < node.items.length; index += 1) visit(node.items[index], `${path}.items[${index}]`);
		else if (["add", "subtract", "multiply", "eq", "lt", "lte", "and", "or"].includes(String(op)))
			{ child("left"); child("right"); }
		else if (op === "if") { child("condition"); child("then"); child("else"); }
		else if (op === "map" || op === "flat_map") { child("array"); child("body"); }
		else if (op === "filter" || op === "all") { child("array"); child("predicate"); }
		else if (op === "range") { child("start"); child("stop"); }
		else if (op === "assert") { child("condition"); child("value"); }
		else if (op === "grid_reachability")
			for (const key of ["grid", "start", "target", "footprint", "offsets", "passable", "max_nodes"]) child(key);
		else if (op === "length" || op === "not") child("value");
	};
	visit(validated.expression, "$.expression");
}

class RuntimeBudget {
	readonly limits: PureExpressionLimits;
	readonly consumed = EMPTY_CONSUMPTION();
	readonly isCancelled?: () => boolean;
	private nextCancellationCheck = 1;

	constructor(limits: PureExpressionLimits, isCancelled?: () => boolean) {
		this.limits = limits;
		this.isCancelled = isCancelled;
	}

	fail(code: PureExpressionErrorCode, message: string, path: string): never {
		throw new PureExpressionError(code, message, path, this.consumed, this.limits);
	}

	step(path: string, count = 1): void {
		if (!Number.isSafeInteger(count) || count < 0) this.fail("budget_exhausted", "invalid internal step charge", path);
		if (this.consumed.steps + count > this.limits.steps) this.fail("budget_exhausted", "step budget exhausted", path);
		const target = this.consumed.steps + count;
		while (this.nextCancellationCheck <= target) {
			if (this.isCancelled?.()) this.fail("cancelled", "evaluation cancelled", path);
			this.nextCancellationCheck += 256;
		}
		this.consumed.steps = target;
	}

	construct(elements: number, bytes: number, path: string): void {
		if (!Number.isSafeInteger(elements) || elements < 0 || !Number.isSafeInteger(bytes) || bytes < 0) {
			this.fail("budget_exhausted", "invalid internal allocation charge", path);
		}
		if (elements > this.limits.collection_length) this.fail("budget_exhausted", "collection length limit exceeded", path);
		if (this.consumed.constructed_elements + elements > this.limits.constructed_elements) {
			this.fail("budget_exhausted", "constructed element budget exhausted", path);
		}
		if (this.consumed.allocation_bytes + bytes > this.limits.allocation_bytes) {
			this.fail("budget_exhausted", "logical allocation budget exhausted", path);
		}
		this.consumed.constructed_elements += elements;
		this.consumed.allocation_bytes += bytes;
	}

	allocate(bytes: number, path: string): void {
		this.construct(0, bytes, path);
	}
}

function measureRuntimeJson(
	value: unknown,
	path: string,
	budget: RuntimeBudget,
	code: "invalid_input" | "type_error",
	depth = 1,
	active = new WeakSet<object>(),
): JsonMeasure {
	budget.step(path);
	if (depth > budget.limits.json_depth) budget.fail(code, "JSON depth limit exceeded", path);
	if (value === null) return { bytes: 4, elements: 0, depth };
	if (typeof value === "boolean") return { bytes: value ? 4 : 5, elements: 0, depth };
	if (typeof value === "number") {
		if (!Number.isFinite(value)) budget.fail(code, "numbers must be finite", path);
		return { bytes: utf8Bytes(String(value)), elements: 0, depth };
	}
	if (typeof value === "string") {
		budget.step(path, value.length);
		return { bytes: quotedJsonBytes(value), elements: 0, depth };
	}
	if (typeof value !== "object" || value === undefined) budget.fail(code, "value is not JSON", path);
	if (active.has(value as object)) budget.fail(code, "cyclic values are not JSON", path);
	active.add(value as object);
	let bytes = 2;
	let elements = 0;
	let deepest = depth;
	if (Array.isArray(value)) {
		if (value.length > budget.limits.collection_length) budget.fail(code, "collection length limit exceeded", path);
		for (let index = 0; index < value.length; index += 1) {
			const child = measureRuntimeJson(value[index], pathKey(path, index), budget, code, depth + 1, active);
			bytes += child.bytes + (index ? 1 : 0); elements += child.elements + 1; deepest = Math.max(deepest, child.depth);
		}
	} else {
		if (!isRecord(value)) budget.fail(code, "objects must have a plain or null prototype", path);
		const keys = Object.keys(value);
		if (keys.length > budget.limits.collection_length) budget.fail(code, "collection length limit exceeded", path);
		for (let index = 0; index < keys.length; index += 1) {
			const key = keys[index];
			if (FORBIDDEN_KEYS.has(key)) budget.fail(code, "forbidden object key", pathKey(path, key));
			budget.step(pathKey(path, key), key.length);
			const child = measureRuntimeJson(value[key], pathKey(path, key), budget, code, depth + 1, active);
			bytes += quotedJsonBytes(key) + 1 + child.bytes + (index ? 1 : 0); elements += child.elements + 1; deepest = Math.max(deepest, child.depth);
		}
	}
	active.delete(value as object);
	return { bytes, elements, depth: deepest };
}

function requireBoolean(value: unknown, path: string, budget: RuntimeBudget): boolean {
	if (typeof value !== "boolean") budget.fail("type_error", "expected boolean", path);
	return value;
}

function requireNumber(value: unknown, path: string, budget: RuntimeBudget): number {
	if (typeof value !== "number" || !Number.isFinite(value)) budget.fail("type_error", "expected finite number", path);
	return value;
}

function requireArray(value: unknown, path: string, budget: RuntimeBudget): unknown[] {
	if (!Array.isArray(value)) budget.fail("type_error", "expected array", path);
	return value;
}

function structuralEqual(left: unknown, right: unknown, path: string, budget: RuntimeBudget): boolean {
	budget.step(path);
	if (left === right) return true;
	if (left === null || right === null || typeof left !== typeof right) return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			if (!structuralEqual(left[index], right[index], pathKey(path, index), budget)) return false;
		}
		return true;
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		if (leftKeys.length !== rightKeys.length) return false;
		for (const key of leftKeys) {
			budget.step(pathKey(path, key), key.length + 1);
			if (!Object.prototype.hasOwnProperty.call(right, key)
				|| !structuralEqual(left[key], right[key], pathKey(path, key), budget)) return false;
		}
		return true;
	}
	return false;
}

function codePointLength(value: string, path: string, budget: RuntimeBudget): number {
	let length = 0;
	for (let index = 0; index < value.length; index += 1) {
		budget.step(path);
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
			&& value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) index += 1;
		length += 1;
	}
	return length;
}

function evaluateGridReachability(
	values: Record<string, unknown>, path: string, budget: RuntimeBudget,
): Record<string, unknown> {
	const grid = requireArray(values.grid, `${path}.grid`, budget);
	if (!grid.length || grid.length > 256) budget.fail("type_error", "grid must have 1..256 rows", `${path}.grid`);
	const first = requireArray(grid[0], `${path}.grid[0]`, budget);
	const gridWidth = first.length, gridHeight = grid.length;
	if (!gridWidth || gridWidth > 256) budget.fail("type_error", "grid must have 1..256 columns", `${path}.grid[0]`);
	for (let y = 0; y < gridHeight; y += 1) {
		const row = requireArray(grid[y], `${path}.grid[${y}]`, budget);
		if (row.length !== gridWidth) budget.fail("type_error", "grid rows must have equal width", `${path}.grid[${y}]`);
		for (let x = 0; x < gridWidth; x += 1) {
			budget.step(`${path}.grid[${y}][${x}]`);
			if (!Number.isSafeInteger(row[x])) budget.fail("type_error", "grid cells must be safe integers", `${path}.grid[${y}][${x}]`);
		}
	}
	const pair = (value: unknown, name: string): [number, number] => {
		const array = requireArray(value, `${path}.${name}`, budget);
		if (array.length !== 2 || !array.every(Number.isSafeInteger))
			budget.fail("type_error", `${name} must be two safe integers`, `${path}.${name}`);
		return [array[0] as number, array[1] as number];
	};
	const [width, height] = pair(values.footprint, "footprint");
	if (width < 1 || height < 1 || width > 32 || height > 32 || width > gridWidth || height > gridHeight)
		budget.fail("type_error", "footprint dimensions must fit the grid and be at most 32", `${path}.footprint`);
	const start = pair(values.start, "start"), target = pair(values.target, "target");
	for (const [name, point] of [["start", start], ["target", target]] as const) {
		if (point[0] < 0 || point[1] < 0 || point[0] + width > gridWidth || point[1] + height > gridHeight)
			budget.fail("type_error", `${name} footprint is outside the grid`, `${path}.${name}`);
	}
	const rawOffsets = requireArray(values.offsets, `${path}.offsets`, budget);
	if (!rawOffsets.length || rawOffsets.length > 8) budget.fail("type_error", "offsets must have 1..8 entries", `${path}.offsets`);
	const offsets = rawOffsets.map((value, index) => {
		const offset = pair(value, `offsets[${index}]`);
		if ((!offset[0] && !offset[1]) || Math.abs(offset[0]) > 256 || Math.abs(offset[1]) > 256)
			budget.fail("type_error", "offset must be nonzero and within 256 cells", `${path}.offsets[${index}]`);
		return offset;
	});
	const rawPassable = requireArray(values.passable, `${path}.passable`, budget);
	if (!rawPassable.length || rawPassable.length > 16 || !rawPassable.every(Number.isSafeInteger))
		budget.fail("type_error", "passable must contain 1..16 safe integers", `${path}.passable`);
	const passable = new Set(rawPassable as number[]);
	const maxNodes = values.max_nodes;
	if (!Number.isSafeInteger(maxNodes) || (maxNodes as number) < 1
		|| (maxNodes as number) > Math.min(8_192, budget.limits.collection_length))
		budget.fail("type_error", "max_nodes must be within the collection limit and at most 8192", `${path}.max_nodes`);
	const footprintPassable = (x: number, y: number): boolean => {
		if (x < 0 || y < 0 || x + width > gridWidth || y + height > gridHeight) return false;
		for (let dy = 0; dy < height; dy += 1) for (let dx = 0; dx < width; dx += 1) {
			budget.step(path);
			if (!passable.has((grid[y + dy] as number[])[x + dx])) return false;
		}
		return true;
	};
	type Node = { x: number; y: number; parent: number | null; via: number | null; distance: number };
	const nodes = new Map<number, Node>();
	const queue: number[] = [];
	const key = (x: number, y: number) => y * gridWidth + x;
	const startKey = key(...start), targetKey = key(...target);
	budget.construct(1, 80, path);
	nodes.set(startKey, { x: start[0], y: start[1], parent: null, via: null, distance: 0 });
	queue.push(startKey);
	let nearestKey = startKey, truncated = false;
	const distanceToTarget = (node: Node) => Math.abs(node.x - target[0]) + Math.abs(node.y - target[1]);
	for (let cursor = 0; cursor < queue.length && !truncated; cursor += 1) {
		budget.step(path);
		const parentKey = queue[cursor], parent = nodes.get(parentKey)!;
		for (let actionIndex = 0; actionIndex < offsets.length; actionIndex += 1) {
			budget.step(path);
			const [dx, dy] = offsets[actionIndex], x = parent.x + dx, y = parent.y + dy;
			if (!footprintPassable(x, y)) continue;
			const nextKey = key(x, y);
			if (nodes.has(nextKey)) continue;
			if (nodes.size >= (maxNodes as number)) { truncated = true; break; }
			budget.construct(1, 80, path);
			const next: Node = { x, y, parent: parentKey, via: actionIndex, distance: parent.distance + 1 };
			nodes.set(nextKey, next); queue.push(nextKey);
			const nearest = nodes.get(nearestKey)!;
			const delta = distanceToTarget(next) - distanceToTarget(nearest);
			if (delta < 0 || (delta === 0 && (next.distance < nearest.distance
				|| (next.distance === nearest.distance && (next.y < nearest.y || (next.y === nearest.y && next.x < nearest.x))))))
				nearestKey = nextKey;
		}
	}
	const pathTo = (destination: number): number[] => {
		const pathIndices: number[] = [];
		for (let current = destination; current !== startKey;) {
			budget.step(path);
			const node = nodes.get(current)!;
			pathIndices.push(node.via!); current = node.parent!;
		}
		budget.construct(pathIndices.length, pathIndices.length * 8, path);
		return pathIndices.reverse();
	};
	const reached = nodes.has(targetKey), nearest = nodes.get(nearestKey)!;
	const nearestPath = pathTo(nearestKey);
	const pathIndices = reached ? pathTo(targetKey) : null;
	budget.construct(8, 128, path);
	return { target_status: reached ? "reachable" : truncated ? "unknown_limit" : "unreachable",
		path: pathIndices, nearest_anchor: [nearest.x, nearest.y], nearest_path: nearestPath,
		reachable_count: nodes.size, truncated };
}

function evaluateExpression(
	expression: Record<string, unknown>,
	input: unknown,
	bindings: ReadonlyMap<string, unknown>,
	path: string,
	budget: RuntimeBudget,
): unknown {
	budget.step(path);
	const op = expression.op as string;
	const run = (key: string, nextBindings = bindings) => evaluateExpression(expression[key] as Record<string, unknown>, input, nextBindings, `${path}.${key}`, budget);
	if (op === "input") return input;
	if (op === "literal") return expression.value;
	if (op === "var") return bindings.get(expression.name as string);
	if (op === "let") {
		const value = run("value");
		const next = new Map(bindings); next.set(expression.name as string, value);
		return run("body", next);
	}
	if (op === "get") {
		const value = run("value"); const key = run("key");
		if (!isRecord(value)) budget.fail("type_error", "get.value must evaluate to an object", `${path}.value`);
		if (typeof key !== "string") budget.fail("type_error", "get.key must evaluate to a string", `${path}.key`);
		if (FORBIDDEN_KEYS.has(key)) budget.fail("type_error", "get.key is forbidden", `${path}.key`);
		budget.step(`${path}.key`, key.length);
		if (!Object.prototype.hasOwnProperty.call(value, key)) budget.fail("missing_field", `missing own field: ${key}`, path);
		return value[key];
	}
	if (op === "index") {
		const array = requireArray(run("array"), `${path}.array`, budget);
		const index = run("index");
		if (!Number.isSafeInteger(index)) budget.fail("type_error", "index must be a safe integer", `${path}.index`);
		if ((index as number) < 0 || (index as number) >= array.length) budget.fail("index_out_of_bounds", "array index is out of bounds", path);
		return array[index as number];
	}
	if (op === "object") {
		const fields = expression.fields as Array<Record<string, unknown>>;
		let keyBytes = 0;
		for (const field of fields) keyBytes += quotedJsonBytes(field.key as string) + 9;
		budget.construct(fields.length, keyBytes, path);
		const value: Record<string, unknown> = Object.create(null);
		for (let index = 0; index < fields.length; index += 1) value[fields[index].key as string] = evaluateExpression(fields[index].value as Record<string, unknown>, input, bindings, `${path}.fields[${index}].value`, budget);
		return value;
	}
	if (op === "array") {
		const items = expression.items as Array<Record<string, unknown>>;
		budget.construct(items.length, items.length * 8, path);
		const result: unknown[] = [];
		for (let index = 0; index < items.length; index += 1) result.push(evaluateExpression(items[index], input, bindings, `${path}.items[${index}]`, budget));
		return result;
	}
	if (op === "and") {
		const left = requireBoolean(run("left"), `${path}.left`, budget);
		return left ? requireBoolean(run("right"), `${path}.right`, budget) : false;
	}
	if (op === "or") {
		const left = requireBoolean(run("left"), `${path}.left`, budget);
		return left ? true : requireBoolean(run("right"), `${path}.right`, budget);
	}
	if (op === "not") return !requireBoolean(run("value"), `${path}.value`, budget);
	if (op === "if") return requireBoolean(run("condition"), `${path}.condition`, budget) ? run("then") : run("else");
	if (op === "eq") return structuralEqual(run("left"), run("right"), path, budget);
	if (op === "lt" || op === "lte") {
		const left = requireNumber(run("left"), `${path}.left`, budget); const right = requireNumber(run("right"), `${path}.right`, budget);
		return op === "lt" ? left < right : left <= right;
	}
	if (op === "add" || op === "subtract" || op === "multiply") {
		const left = requireNumber(run("left"), `${path}.left`, budget); const right = requireNumber(run("right"), `${path}.right`, budget);
		const value = op === "add" ? left + right : op === "subtract" ? left - right : left * right;
		if (!Number.isFinite(value)) budget.fail("type_error", "arithmetic produced a non-finite number", path);
		return value;
	}
	if (op === "range") {
		const start = run("start"); const stop = run("stop");
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop)) budget.fail("type_error", "range bounds must be safe integers", path);
		if ((stop as number) < (start as number)) budget.fail("type_error", "range stop must not be less than start", path);
		const length = (stop as number) - (start as number);
		if (!Number.isSafeInteger(length)) budget.fail("type_error", "range length overflow", path);
		budget.construct(length, length * 8, path);
		budget.step(path, length);
		const result: number[] = [];
		for (let value = start as number; value < (stop as number); value += 1) result.push(value);
		return result;
	}
	if (op === "map" || op === "flat_map" || op === "filter" || op === "all") {
		const source = requireArray(run("array"), `${path}.array`, budget);
		const name = expression.as as string;
		const result: unknown[] = [];
		if (op === "map") budget.construct(source.length, source.length * 8, path);
		for (let index = 0; index < source.length; index += 1) {
			budget.step(path);
			const next = new Map(bindings); next.set(name, source[index]);
			if (op === "map") result.push(evaluateExpression(expression.body as Record<string, unknown>, input, next, `${path}.body`, budget));
			else if (op === "flat_map") {
				const nested = requireArray(evaluateExpression(expression.body as Record<string, unknown>, input, next, `${path}.body`, budget), `${path}.body`, budget);
				if (result.length + nested.length > budget.limits.collection_length) budget.fail("budget_exhausted", "collection length limit exceeded", path);
				budget.construct(nested.length, nested.length * 8, path);
				for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) { budget.step(path); result.push(nested[nestedIndex]); }
			} else {
				const keep = requireBoolean(evaluateExpression(expression.predicate as Record<string, unknown>, input, next, `${path}.predicate`, budget), `${path}.predicate`, budget);
				if (op === "all") { if (!keep) return false; }
				else if (keep) { budget.construct(1, 8, path); result.push(source[index]); }
			}
		}
		return op === "all" ? true : result;
	}
	if (op === "length") {
		const value = run("value");
		if (Array.isArray(value)) return value.length;
		if (typeof value === "string") return codePointLength(value, path, budget);
		budget.fail("type_error", "length expects an array or string", path);
	}
	if (op === "assert") {
		if (!requireBoolean(run("condition"), `${path}.condition`, budget)) budget.fail("assertion_failed", expression.message as string, path);
		return run("value");
	}
	if (op === "grid_reachability") {
		const values: Record<string, unknown> = {};
		for (const key of ["grid", "start", "target", "footprint", "offsets", "passable", "max_nodes"]) values[key] = run(key);
		return evaluateGridReachability(values, path, budget);
	}
	budget.fail("invalid_program", `unknown operator at runtime: ${op}`, `${path}.op`);
}

function serializeJsonChunks(value: unknown, path: string, budget: RuntimeBudget, chunks: string[]): void {
	budget.step(path);
	const pushKnown = (chunk: string) => {
		budget.allocate(8 + utf8Bytes(chunk), path);
		chunks.push(chunk);
	};
	const pushQuoted = (text: string) => {
		const encodedBytes = quotedJsonBytes(text);
		// Reserve the chunk slot, encoded JSON, and a conservative UTF-16
		// temporary before invoking the native bounded string escaper.
		budget.allocate(8 + encodedBytes + text.length * 2, path);
		chunks.push(JSON.stringify(text));
	};
	if (value === null) { pushKnown("null"); return; }
	if (typeof value === "boolean") { pushKnown(value ? "true" : "false"); return; }
	if (typeof value === "number") {
		budget.allocate(8 + 32, path);
		chunks.push(String(value));
		return;
	}
	if (typeof value === "string") { budget.step(path, value.length); pushQuoted(value); return; }
	if (Array.isArray(value)) {
		pushKnown("[");
		for (let index = 0; index < value.length; index += 1) {
			if (index) pushKnown(",");
			serializeJsonChunks(value[index], pathKey(path, index), budget, chunks);
		}
		pushKnown("]");
		return;
	}
	if (isRecord(value)) {
		pushKnown("{");
		const keys = Object.keys(value);
		for (let index = 0; index < keys.length; index += 1) {
			const key = keys[index];
			if (index) pushKnown(",");
			budget.step(pathKey(path, key), key.length);
			pushQuoted(key); pushKnown(":");
			serializeJsonChunks(value[key], pathKey(path, key), budget, chunks);
		}
		pushKnown("}");
		return;
	}
	budget.fail("type_error", "output is not JSON", path);
}

export function evaluateTaskPureExpression(
	program: unknown,
	input: unknown,
	options: PureExpressionEvaluationOptions = {},
): PureExpressionEvaluation {
	const validated = validateTaskPureExpressionProgram(program, options.runtime_limits);
	const budget = new RuntimeBudget(validated.effective_limits, options.is_cancelled);
	const inputMeasure = measureRuntimeJson(input, "$input", budget, "invalid_input");
	budget.consumed.input_bytes = inputMeasure.bytes;
	if (inputMeasure.bytes > budget.limits.input_bytes) budget.fail("invalid_input", "input byte limit exceeded", "$input");
	const value = evaluateExpression(validated.expression, input, new Map(), "$.expression", budget);
	const outputMeasure = measureRuntimeJson(value, "$output", budget, "type_error");
	budget.consumed.output_bytes = outputMeasure.bytes;
	if (outputMeasure.bytes > budget.limits.output_bytes) budget.fail("output_too_large", "output byte limit exceeded", "$output");
	// Build one flat chunk vector rather than recursively materializing a string
	// at every nesting level. Each chunk and vector slot is reserved before it is
	// created; the final string is reserved before the only join.
	const chunks: string[] = [];
	serializeJsonChunks(value, "$output", budget, chunks);
	budget.allocate(outputMeasure.bytes, "$output");
	const outputJson = chunks.join("");
	return { value, output_json: outputJson, effective_limits: { ...budget.limits }, consumed: { ...budget.consumed } };
}
