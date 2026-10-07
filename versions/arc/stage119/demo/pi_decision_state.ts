/** Validate optional authored knowledge before any durable mutation. */
import { Type } from "typebox";
import { isDeepStrictEqual } from "node:util";

type Row = Record<string, any>;
const object = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
const listFields = ["known_effects", "knowledge_gaps", "counterevidence"];
const decisionFields = [...listFields, "next_decision"];
const compatibilityFields = [...decisionFields, "unknowns"];

/** Describe the common knowledge interface rather than an untyped record. */
export function decisionStateSchema() {
    const authored = Type.Union([Type.String(), Type.Record(Type.String(), Type.Unknown())]);
    const entries = () => Type.Optional(Type.Union([Type.String(), Type.Array(authored)]));
    return Type.Object({
        known_effects: entries(), knowledge_gaps: entries(), counterevidence: entries(),
        next_decision: Type.Optional(Type.Union([authored, Type.Null()])),
    }, { description: "Agent-authored knowledge; omitted fields stay, [] clears a list." });
}

function assignConsistent(target: Row, field: string, value: unknown): void {
    if (Object.hasOwn(target, field) && !isDeepStrictEqual(target[field], value))
        throw new Error(`Conflicting ${field} values; supply it once in decision_state`);
    target[field] = value;
}

/** Compatibility is syntactic only: preserve authored text, never infer claims. */
function normalizeDecisionPatch(value: unknown): Row {
    if (!object(value)) throw new Error("decision_state must be an authored object");
    const patch: Row = {};
    for (const [key, item] of Object.entries(value)) {
        if (!compatibilityFields.includes(key))
            throw new Error(`Unknown decision_state field ${key}; use ${decisionFields.join(", ")}`);
        const field = key === "unknowns" ? "knowledge_gaps" : key;
        assignConsistent(patch, field, listFields.includes(field) && typeof item === "string" ? [item] : item);
    }
    return patch;
}

/** Shared by action metadata and checkpoint writes; one authored state contract. */
export function normalizeDecisionKnowledge(value: unknown, resolveRef: (ref: string) => unknown): Row {
    return validateDecisionState(normalizeDecisionPatch(value), resolveRef);
}

/** Reject dropped arguments before any writer runs; merge into one canonical state. */
export function checkpointDecisionPatch(input: Row, parameterFields: Iterable<string>): Row | undefined {
    const supported = new Set([...parameterFields, ...compatibilityFields]);
    const unknown = Object.keys(input).filter(key => !supported.has(key));
    if (unknown.length) throw new Error(`Unknown task_checkpoint field ${unknown.join(", ")}; knowledge belongs in decision_state (${decisionFields.join(", ")})`);
    const flat = Object.fromEntries(compatibilityFields.filter(key => Object.hasOwn(input, key))
        .map(key => [key, input[key]]));
    if (!Object.hasOwn(input, "decision_state") && !Object.keys(flat).length) return;
    const patch = Object.hasOwn(input, "decision_state") ? normalizeDecisionPatch(input.decision_state) : {};
    for (const [key, value] of Object.entries(normalizeDecisionPatch(flat))) assignConsistent(patch, key, value);
    return patch;
}
export function semanticEntries(value: unknown, field: string): any[] {
    if (!Array.isArray(value) || value.some(v => typeof v !== "string" && !object(v)))
        throw new Error(`${field} must be an array of authored text or objects`);
    return value;
}
export function validateSemanticRefs(value: unknown, resolveRef: (ref: string) => unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
        if (key.endsWith("_refs")) {
            if (!Array.isArray(item) || item.some(ref => typeof ref !== "string" || !ref.includes("@v")))
                throw new Error(`${key} requires exact versioned resource refs`);
            for (const ref of item) resolveRef(ref);
        } else if (key.endsWith("_ref") && item != null) {
            if (typeof item !== "string" || !item.includes("@v")) throw new Error(`${key} requires an exact versioned ref`);
            resolveRef(item);
        } else validateSemanticRefs(item, resolveRef);
    }
}
export function validateDecisionState(value: unknown, resolveRef: (ref: string) => unknown): Row {
    if (!object(value)) throw new Error("decision_state must be an authored object");
    const row = value as Row;
    if (Object.keys(row).some(k => !decisionFields.includes(k)))
        throw new Error(`unknown decision_state field; use ${decisionFields.join(", ")}`);
    for (const key of listFields) if (row[key] !== undefined) semanticEntries(row[key], key);
    if (row.next_decision !== undefined && row.next_decision !== null
        && typeof row.next_decision !== "string" && !object(row.next_decision))
        throw new Error("next_decision must be authored text, object or null");
    validateSemanticRefs(row, resolveRef);
    return row;
}
export function patchDecisionState(previous: unknown, update: unknown, resolveRef: (ref: string) => unknown): Row {
    const patch = validateDecisionState(update, resolveRef);
    return validateDecisionState({ ...(object(previous) ? previous as Row : {}), ...patch }, resolveRef);
}
