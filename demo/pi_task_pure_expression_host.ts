/** Trusted host preparation for pure-expression inputs; never imported by the evaluator. */
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { latestArcObservationSnapshot } from "./pi_arc_observation_snapshot.ts";
import { assertParentTaskResourceBindingHost, resolveAuthorizedTaskResourceForBinding } from "./pi_task_resource_store.ts";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const EXACT_REF = /^([a-z_]+):([^@/\\*]+)@v([1-9]\d*)$/;
// Exact current snapshot reuse below keeps the common path to one bounded
// scan. Eight MiB covers a long online ARC decision history without treating
// the ever-growing JSONL as an unbounded implicit Tool input.
const DEFAULT_SCAN_BYTES = 8 * 1_024 * 1_024;
const DEFAULT_RECORD_BYTES = 512 * 1_024;
const DEFAULT_PREPARATION_BYTES = 8 * 1_024 * 1_024;
const MAX_BINDINGS = 64;
const MAX_PATH_LENGTH = 64;

export class PureExpressionHostError extends Error {
	readonly code = "invalid_input" as const;
	readonly path: string;
	constructor(message: string, path: string) { super(message); this.name = "PureExpressionHostError"; this.path = path; }
	toJSON() { return { format: "task-pure-expression-error-v1", code: this.code, message: this.message, path: this.path }; }
}

export type PureExpressionInvocationEnvelope = {
	parameters: Record<string, unknown>;
	bindings: Array<{ name: string; ref: string; path: Array<string | number> }>;
};

export type PreparedPureExpressionInput = {
	input: Record<string, unknown>;
	provenance: {
		format: "task-pure-expression-input-provenance-v1";
		parameters_sha256: string;
		prepared_input_sha256: string;
		bindings: Array<Record<string, unknown>>;
	};
	preparation: {
		parameter_bytes: number;
		prepared_input_bytes: number;
		resource_scan_bytes: number;
		parsed_resource_records: number;
		resolved_value_bytes: number;
		work_bytes: number;
	};
};

function fail(message: string, path: string): never { throw new PureExpressionHostError(message, path); }

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
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
			&& value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
		else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
		else bytes += 3;
	}
	return bytes;
}

function strictJsonText(value: unknown, path: string, maxBytes: number): string {
	let estimated = 0;
	const active = new WeakSet<object>();
	const reserve = (bytes: number, at: string) => {
		if (!Number.isSafeInteger(bytes) || bytes < 0 || estimated + bytes > maxBytes) fail("JSON value exceeds preparation byte limit", at);
		estimated += bytes;
	};
	const walk = (item: unknown, at: string, depth: number): void => {
		if (depth > 64) fail("JSON depth exceeds preparation limit", at);
		if (item === null) { reserve(4, at); return; }
		if (typeof item === "boolean") { reserve(item ? 4 : 5, at); return; }
		if (typeof item === "number") {
			if (!Number.isFinite(item)) fail("JSON numbers must be finite", at);
			reserve(String(item).length, at); return;
		}
		if (typeof item === "string") {
			if (item.length > maxBytes) fail("JSON string exceeds preparation byte limit", at);
			reserve(quotedJsonBytes(item), at); return;
		}
		if (typeof item !== "object" || item === undefined) fail("value must contain JSON types only", at);
		if (active.has(item as object)) fail("value must be acyclic JSON", at);
		active.add(item as object);
		if (Array.isArray(item)) {
			if (item.length > 32_768) fail("JSON collection exceeds preparation limit", at);
			reserve(2 + Math.max(0, item.length - 1), at);
			for (let index = 0; index < item.length; index += 1) walk(item[index], `${at}[${index}]`, depth + 1);
		} else {
			if (!isRecord(item)) fail("JSON objects must have a plain or null prototype", at);
			const keys = Object.keys(item);
			if (keys.length > 32_768) fail("JSON collection exceeds preparation limit", at);
			reserve(2 + Math.max(0, keys.length - 1), at);
			for (const key of keys) {
				if (FORBIDDEN_KEYS.has(key)) fail("forbidden JSON object key", `${at}.${key}`);
				if (key.length > maxBytes) fail("JSON key exceeds preparation byte limit", `${at}.${key}`);
				reserve(quotedJsonBytes(key) + 1, `${at}.${key}`);
				walk(item[key], `${at}.${key}`, depth + 1);
			}
		}
		active.delete(item as object);
	};
	walk(value, path, 1);
	const text = JSON.stringify(value);
	if (text === undefined || Buffer.byteLength(text, "utf8") > maxBytes) fail("JSON value exceeds preparation byte limit", path);
	return text;
}

function hash(text: string): string { return createHash("sha256").update(text).digest("hex"); }

function validateEnvelope(value: unknown): PureExpressionInvocationEnvelope {
	if (!isRecord(value)) fail("invocation must be an object", "$invocation");
	const keys = Object.keys(value);
	if (keys.some((key) => !["parameters", "bindings"].includes(key))) fail("invocation allows only parameters and bindings", "$invocation");
	const parameters = value.parameters ?? {};
	const bindings = value.bindings ?? [];
	if (!isRecord(parameters)) fail("parameters must be a JSON object", "$invocation.parameters");
	for (const key of Object.keys(parameters)) if (FORBIDDEN_KEYS.has(key)) fail("forbidden parameter key", `$invocation.parameters.${key}`);
	if (!Array.isArray(bindings) || bindings.length > MAX_BINDINGS) fail(`bindings must be an array of at most ${MAX_BINDINGS} items`, "$invocation.bindings");
	const names = new Set(Object.keys(parameters));
	const validated = bindings.map((binding, index) => {
		const bindingPath = `$invocation.bindings[${index}]`;
		if (!isRecord(binding) || Object.keys(binding).some((key) => !["name", "ref", "path"].includes(key))
			|| !["name", "ref", "path"].every((key) => Object.prototype.hasOwnProperty.call(binding, key))) {
			fail("binding requires exactly name, ref, and path", bindingPath);
		}
		if (typeof binding.name !== "string" || !binding.name || FORBIDDEN_KEYS.has(binding.name)) fail("binding name must be a non-forbidden string", `${bindingPath}.name`);
		if (names.has(binding.name)) fail(
			Object.prototype.hasOwnProperty.call(parameters, binding.name)
				? `binding ${binding.name} already fills input.${binding.name}; omit parameters.${binding.name} (no $binding placeholder) and keep the binding`
				: "binding names must be unique", `${bindingPath}.name`);
		names.add(binding.name);
		if (typeof binding.ref !== "string" || !EXACT_REF.test(binding.ref)) fail("binding ref must be an exact kind:name@vN reference", `${bindingPath}.ref`);
		if (!Array.isArray(binding.path) || binding.path.length > MAX_PATH_LENGTH) fail(`binding path must contain at most ${MAX_PATH_LENGTH} segments`, `${bindingPath}.path`);
		const path = binding.path.map((segment, pathIndex) => {
			if (typeof segment === "string") {
				if (!segment || FORBIDDEN_KEYS.has(segment) || segment.length > 4_096) fail("binding string path segment is invalid or forbidden", `${bindingPath}.path[${pathIndex}]`);
				// Provider-facing task-tool schemas use strings for path segments to
				// avoid anyOf/null schemas at OpenAI-compatible gateways. Preserve
				// the public contract by accepting canonical decimal indices and
				// converting them at the object/array boundary below.
				return segment;
			}
			if (!Number.isSafeInteger(segment) || (segment as number) < 0) fail("binding array path segment must be a nonnegative safe integer", `${bindingPath}.path[${pathIndex}]`);
			return segment as number;
		});
		return { name: binding.name, ref: binding.ref, path };
	});
	return { parameters, bindings: validated };
}

function atOwnPath(record: unknown, segments: Array<string | number>, basePath: string): unknown {
	let value = record;
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		const path = `${basePath}.path[${index}]`;
		if (typeof segment === "number") {
			if (!Array.isArray(value)) fail("numeric binding path requires an array", path);
			if (segment >= value.length) fail("binding array path is out of range", path);
			value = value[segment];
		} else {
			if (Array.isArray(value) && /^(?:0|[1-9]\d*)$/.test(segment)) {
				const index = Number(segment);
				if (!Number.isSafeInteger(index) || index >= value.length) fail("binding array path is out of range", path);
				value = value[index];
				continue;
			}
			if (!isRecord(value)) fail("string binding path requires an object", path);
			if (!Object.prototype.hasOwnProperty.call(value, segment)) fail("binding path field is missing", path);
			value = value[segment];
		}
	}
	return value;
}

export function preparePureExpressionInput(
	pi: ExtensionAPI,
	root: string,
	envelopeValue: unknown,
	options: { max_input_bytes: number; max_scan_bytes?: number; max_record_bytes?: number; max_preparation_bytes?: number },
): PreparedPureExpressionInput {
	try { assertParentTaskResourceBindingHost(pi, root); }
	catch (error) { fail(error instanceof Error ? error.message : String(error), "$invocation"); }
	const envelope = validateEnvelope(envelopeValue);
	const maxScanBytes = options.max_scan_bytes ?? DEFAULT_SCAN_BYTES;
	const maxRecordBytes = options.max_record_bytes ?? DEFAULT_RECORD_BYTES;
	const maxPreparationBytes = options.max_preparation_bytes ?? DEFAULT_PREPARATION_BYTES;
	let workBytes = 0;
	const chargeWork = (bytes: number, path: string) => {
		if (!Number.isSafeInteger(bytes) || bytes < 0 || workBytes + bytes > maxPreparationBytes) fail("host preparation work budget exhausted", path);
		workBytes += bytes;
	};
	const parameterText = strictJsonText(envelope.parameters, "$invocation.parameters", options.max_input_bytes);
	const parameterBytes = Buffer.byteLength(parameterText, "utf8");
	chargeWork(parameterBytes, "$invocation.parameters");
	if (parameterBytes > options.max_input_bytes) fail("parameters exceed input byte limit", "$invocation.parameters");
	type CachedResolution = ReturnType<typeof resolveAuthorizedTaskResourceForBinding> & {
		record_text: string; record_sha256: string; content_sha256: string;
	};
	const resolved = new Map<string, CachedResolution>();
	let resourceScanBytes = 0;
	let parsedRecords = 0;
	let resolvedValueBytes = 0;
	const prepared: Record<string, unknown> = JSON.parse(parameterText);
	const bindingProvenance: Array<Record<string, unknown>> = [];
	// This metadata scan does not resolve or bind a value. It identifies the
	// latest already-captured parent observation for an explicit stale marker.
	const latest = envelope.bindings.length
		? latestArcObservationSnapshot(root, Math.max(1, maxScanBytes - resourceScanBytes))
		: undefined;
	resourceScanBytes += latest?.scanned_bytes ?? 0;
	chargeWork(latest?.scanned_bytes ?? 0, "$invocation.bindings");
	for (let index = 0; index < envelope.bindings.length; index += 1) {
		const binding = envelope.bindings[index];
		const bindingPath = `$invocation.bindings[${index}]`;
		let resolution = resolved.get(binding.ref);
		if (!resolution) {
			// The current observation was already parsed by the metadata scan.
			// Reusing that exact immutable record avoids charging/reading the
			// growing snapshot history twice on the common live-frame path.
			if (latest && binding.ref === latest.ref) {
				const recordText = strictJsonText(latest.record, `${bindingPath}.ref`, maxRecordBytes);
				const recordBytes = Buffer.byteLength(recordText, "utf8");
				chargeWork(recordBytes * 2, `${bindingPath}.ref`);
				const recordHash = hash(recordText);
				resolution = { record: latest.record, record_text: recordText,
					record_sha256: recordHash,
					content_sha256: String(latest.record.content_sha256 ?? recordHash),
					scan: { file_bytes: 0, scanned_bytes: 0, parsed_records: 0, record_bytes: recordBytes } };
				resolved.set(binding.ref, resolution);
			}
		}
		if (!resolution) {
			const remaining = maxScanBytes - resourceScanBytes;
			if (remaining < 1) fail("resource scan budget exhausted", `${bindingPath}.ref`);
			try {
				const raw = resolveAuthorizedTaskResourceForBinding(pi, root, binding.ref, {
					max_scan_bytes: remaining, max_record_bytes: maxRecordBytes,
				});
				const recordText = strictJsonText(raw.record, `${bindingPath}.ref`, maxRecordBytes);
				const recordBytes = Buffer.byteLength(recordText, "utf8");
				chargeWork(raw.scan.file_bytes + recordBytes * 2, `${bindingPath}.ref`);
				const recordHash = hash(recordText);
				resolution = { ...raw, record_text: recordText, record_sha256: recordHash,
					content_sha256: String(raw.record.content_sha256 ?? recordHash) };
			} catch (error) { fail(error instanceof Error ? error.message : String(error), `${bindingPath}.ref`); }
			resolved.set(binding.ref, resolution);
			resourceScanBytes += resolution.scan.file_bytes;
			parsedRecords += resolution.scan.parsed_records;
		}
		const selected = atOwnPath(resolution.record, binding.path, bindingPath);
		const remainingInput = options.max_input_bytes - parameterBytes - resolvedValueBytes;
		if (remainingInput < 1) fail("prepared input exceeds input byte limit", bindingPath);
		const selectedText = strictJsonText(selected, bindingPath, remainingInput);
		const selectedBytes = Buffer.byteLength(selectedText, "utf8");
		chargeWork(selectedBytes * 3, bindingPath);
		resolvedValueBytes += selectedBytes;
		if (parameterBytes + resolvedValueBytes > options.max_input_bytes) fail("prepared input exceeds input byte limit", bindingPath);
		prepared[binding.name] = JSON.parse(selectedText);
		const snapshot = resolution.record.format === "task-observation-snapshot-v1" ? resolution.record : undefined;
		bindingProvenance.push({
			name: binding.name,
			ref: binding.ref,
			path: binding.path,
			task_id: snapshot?.task_id ?? null,
			task_root_fingerprint: snapshot?.task_root_fingerprint ?? null,
			observation_epoch: snapshot?.observation_epoch ?? null,
			bridge_event_cutoff: snapshot?.bridge_event_cutoff ?? null,
			frame_index: snapshot && binding.path[0] === "public_state" && binding.path[1] === "frames"
				&& binding.path.length >= 3 && Number.isSafeInteger(Number(binding.path[2])) ? Number(binding.path[2]) : null,
			record_sha256: resolution.record_sha256,
			content_sha256: resolution.content_sha256,
			resolved_value_sha256: hash(selectedText),
			resolved_value_bytes: selectedBytes,
			capture_boundary: snapshot?.latest_successful_action_event_boundary ?? null,
			captured_at: snapshot?.captured_at ?? null,
			current_observed_boundary: latest?.record.latest_successful_action_event_boundary ?? null,
			current_observed_at: latest?.record.captured_at ?? null,
			historical_or_stale: Boolean(snapshot && latest && binding.ref !== latest.ref),
		});
	}
	const preparedText = strictJsonText(prepared, "$prepared_input", options.max_input_bytes);
	const preparedBytes = Buffer.byteLength(preparedText, "utf8");
	chargeWork(preparedBytes * 2 + parameterBytes, "$prepared_input");
	if (preparedBytes > options.max_input_bytes) fail("prepared input exceeds input byte limit", "$prepared_input");
	return {
		input: prepared,
		provenance: {
			format: "task-pure-expression-input-provenance-v1",
			parameters_sha256: hash(parameterText),
			prepared_input_sha256: hash(preparedText),
			bindings: bindingProvenance,
		},
		preparation: {
			parameter_bytes: parameterBytes, prepared_input_bytes: preparedBytes,
			resource_scan_bytes: resourceScanBytes, parsed_resource_records: parsedRecords,
			resolved_value_bytes: resolvedValueBytes, work_bytes: workBytes,
		},
	};
}
