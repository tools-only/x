/** Deliberately small JSON Schema subset for task-local pure tools. */

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const COMMON = new Set(["type"]);
const TYPE_KEYS: Record<string, Set<string>> = {
	object: new Set(["properties", "required", "additionalProperties"]),
	array: new Set(["items", "minItems", "maxItems"]),
	string: new Set(["minLength", "maxLength"]),
	number: new Set(["minimum", "maximum"]),
	integer: new Set(["minimum", "maximum"]),
	boolean: new Set(), null: new Set(),
};
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class TaskJsonSchemaError extends Error {
	readonly code: "invalid_program" | "invalid_input" | "invalid_output" | "cancelled";
	readonly path: string;
	constructor(code: "invalid_program" | "invalid_input" | "invalid_output" | "cancelled", message: string, path: string) {
		super(message); this.name = "TaskJsonSchemaError"; this.code = code; this.path = path;
	}
	toJSON() { return { format: "task-pure-expression-error-v1", code: this.code, message: this.message, path: this.path }; }
}

function record(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function schemaError(message: string, path: string): never { throw new TaskJsonSchemaError("invalid_program", message, path); }

export function validateTaskJsonSchema(schema: unknown, path = "$.schema"): Record<string, unknown> {
	let nodes = 0;
	let staticWork = 0;
	const charge = (amount: number, at: string) => {
		staticWork += amount;
		if (staticWork > 100_000) schemaError("schema static work limit exceeded", at);
	};
	const visit = (value: unknown, at: string, depth: number): void => {
		charge(1, at);
		nodes += 1;
		if (nodes > 2_048 || depth > 32) schemaError("schema complexity limit exceeded", at);
		if (!record(value)) schemaError("schema must be an object", at);
		const type = value.type;
		if (typeof type !== "string" || !TYPES.has(type)) schemaError("schema.type must be one supported JSON type", `${at}.type`);
		const allowed = new Set([...COMMON, ...TYPE_KEYS[type]]);
		for (const key of Object.keys(value)) if (!allowed.has(key)) schemaError(`unsupported schema keyword: ${key}`, `${at}.${key}`);
		if (type === "object") {
			if (value.properties !== undefined && !record(value.properties)) schemaError("properties must be an object", `${at}.properties`);
			const properties = (value.properties ?? {}) as Record<string, unknown>;
			for (const [key, child] of Object.entries(properties)) {
				charge(key.length + 1, `${at}.properties.${key}`);
				if (key.length > 4_096) schemaError("schema property name is too long", `${at}.properties.${key}`);
				if (FORBIDDEN_KEYS.has(key)) schemaError("forbidden schema property name", `${at}.properties.${key}`);
				visit(child, `${at}.properties.${key}`, depth + 1);
			}
			if (value.required !== undefined) {
				if (!Array.isArray(value.required) || value.required.some((key) => typeof key !== "string")) schemaError("required must be an array of strings", `${at}.required`);
				const required = value.required as string[];
				if (required.length > 32_768) schemaError("required exceeds schema collection limit", `${at}.required`);
				for (const key of required) { charge(key.length + 1, `${at}.required`); if (key.length > 4_096) schemaError("required property name is too long", `${at}.required`); }
				if (new Set(required).size !== required.length) schemaError("required entries must be unique", `${at}.required`);
				for (const key of required) if (!Object.prototype.hasOwnProperty.call(properties, key)) schemaError(`required property has no schema: ${key}`, `${at}.required`);
			}
			if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") schemaError("additionalProperties must be boolean", `${at}.additionalProperties`);
		} else if (type === "array") {
			// Omitted items leaves element types unconstrained in JSON Schema.
			if (value.items !== undefined) visit(value.items, `${at}.items`, depth + 1);
			for (const key of ["minItems", "maxItems"] as const) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) schemaError(`${key} must be a nonnegative safe integer`, `${at}.${key}`);
			if (Number(value.minItems ?? 0) > Number(value.maxItems ?? Number.MAX_SAFE_INTEGER)) schemaError("minItems must not exceed maxItems", at);
		} else if (type === "string") {
			for (const key of ["minLength", "maxLength"] as const) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) schemaError(`${key} must be a nonnegative safe integer`, `${at}.${key}`);
			if (Number(value.minLength ?? 0) > Number(value.maxLength ?? Number.MAX_SAFE_INTEGER)) schemaError("minLength must not exceed maxLength", at);
		} else if (type === "number" || type === "integer") {
			for (const key of ["minimum", "maximum"] as const) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) schemaError(`${key} must be a finite number`, `${at}.${key}`);
			if (Number(value.minimum ?? -Infinity) > Number(value.maximum ?? Infinity)) schemaError("minimum must not exceed maximum", at);
		}
	};
	visit(schema, path, 1);
	return schema as Record<string, unknown>;
}

export function assertTaskJsonSchemaValue(
	schema: Record<string, unknown>,
	value: unknown,
	code: "invalid_input" | "invalid_output",
	path: string,
	options: { max_visits?: number; max_string_code_units?: number; is_cancelled?: () => boolean } = {},
): { visits: number; string_code_units: number } {
	const fail = (message: string, at: string): never => { throw new TaskJsonSchemaError(code, message, at); };
	const maximumVisits = options.max_visits ?? 1_000_000;
	const maximumStringUnits = options.max_string_code_units ?? 512 * 1_024;
	let visits = 0, stringUnits = 0, nextCancellation = 1;
	const charge = (amount: number, at: string, strings = 0) => {
		visits += amount; stringUnits += strings;
		if (visits > maximumVisits || stringUnits > maximumStringUnits) fail("schema validation work limit exceeded", at);
		while (nextCancellation <= visits) {
			if (options.is_cancelled?.()) throw new TaskJsonSchemaError("cancelled", "schema validation cancelled", at);
			nextCancellation += 256;
		}
	};
	const visit = (shape: Record<string, unknown> | undefined, item: unknown, at: string, depth: number): void => {
		charge(1, at);
		if (depth > 64) fail("JSON value depth exceeds schema validation limit", at);
		const unconstrained = shape === undefined;
		if (unconstrained) shape = { type: item === null ? "null" : Array.isArray(item) ? "array" : typeof item };
		const type = shape.type;
		if (type === "null") { if (item !== null) fail("expected null", at); return; }
		if (type === "boolean") { if (typeof item !== "boolean") fail("expected boolean", at); return; }
		if (type === "string") {
			if (typeof item !== "string") fail("expected string", at);
			let length = 0;
			for (let index = 0; index < item.length; index += 1) {
				charge(1, at, 1);
				const code = item.charCodeAt(index);
				if (code >= 0xd800 && code <= 0xdbff && index + 1 < item.length
					&& item.charCodeAt(index + 1) >= 0xdc00 && item.charCodeAt(index + 1) <= 0xdfff) { index += 1; charge(1, at, 1); }
				length += 1;
			}
			if (shape.minLength !== undefined && length < Number(shape.minLength)) fail("string is shorter than minLength", at);
			if (shape.maxLength !== undefined && length > Number(shape.maxLength)) fail("string is longer than maxLength", at);
			return;
		}
		if (type === "number" || type === "integer") {
			if (typeof item !== "number" || !Number.isFinite(item) || (type === "integer" && !Number.isSafeInteger(item))) fail(`expected ${type}`, at);
			if (shape.minimum !== undefined && item < Number(shape.minimum)) fail("number is below minimum", at);
			if (shape.maximum !== undefined && item > Number(shape.maximum)) fail("number is above maximum", at);
			return;
		}
		if (type === "array") {
			if (!Array.isArray(item)) fail("expected array", at);
			if (shape.minItems !== undefined && item.length < Number(shape.minItems)) fail("array is shorter than minItems", at);
			if (shape.maxItems !== undefined && item.length > Number(shape.maxItems)) fail("array is longer than maxItems", at);
			for (let index = 0; index < item.length; index += 1) { charge(1, at); visit(shape.items as Record<string, unknown> | undefined, item[index], `${at}[${index}]`, depth + 1); }
			return;
		}
		if (type === "object") {
			if (!record(item)) fail("expected object", at);
			const properties = (shape.properties ?? {}) as Record<string, Record<string, unknown>>;
			for (const key of ((shape.required as string[] | undefined) ?? [])) { charge(key.length + 1, `${at}.${key}`); if (!Object.prototype.hasOwnProperty.call(item, key)) fail(`missing required property: ${key}`, `${at}.${key}`); }
			for (const [key, child] of Object.entries(item)) {
				charge(key.length + 1, `${at}.${key}`);
				if (FORBIDDEN_KEYS.has(key)) fail("forbidden object key", `${at}.${key}`);
				if (Object.prototype.hasOwnProperty.call(properties, key)) visit(properties[key], child, `${at}.${key}`, depth + 1);
				else if (shape.additionalProperties === false) fail(`additional property is not allowed: ${key}`, `${at}.${key}`);
				else if (unconstrained) visit(undefined, child, `${at}.${key}`, depth + 1);
			}
			return;
		}
		fail(`unsupported schema type at runtime: ${String(type)}`, at);
	};
	visit(schema, value, path, 1);
	return { visits, string_code_units: stringUnits };
}
