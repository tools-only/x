/** Public ARC input semantics; this does not infer game rules or execute actions. */
type Row = Record<string, any>;
import {isDeepStrictEqual} from "node:util";

const ACTION_FIELDS = new Set(["action", "x", "y", "reasoning", "decision", "subgoal", "next_step"]);

/** Agent decision text belongs in the decision capsule, never in the native action. */
export function normalizeArcActionArguments(value: Row): Row {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arc_action arguments must be an object");
	const unsupported = Object.keys(value).filter(key => !ACTION_FIELDS.has(key));
	if (unsupported.length) throw new Error(`unsupported arc_action fields: ${unsupported.join(", ")}`);
	const decision = value.decision === undefined ? {} : value.decision;
	if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("arc_action.decision must be an object");
	const merged = { ...decision };
	if (merged.knowledge && typeof merged.knowledge === "object" && !Array.isArray(merged.knowledge)
		&& Object.hasOwn(merged.knowledge, "next_step")) {
		const {next_step, ...knowledge} = merged.knowledge;
		if (Object.hasOwn(knowledge, "next_decision") && !isDeepStrictEqual(knowledge.next_decision, next_step))
			throw new Error("arc_action decision conflict for next_decision");
		knowledge.next_decision = next_step;
		merged.knowledge = knowledge;
	}
	if (Object.hasOwn(merged, "next_decision")) {
		if (merged.knowledge !== undefined && (!merged.knowledge || typeof merged.knowledge !== "object" || Array.isArray(merged.knowledge)))
			throw new Error("arc_action decision.knowledge must be an object");
		const knowledge = { ...merged.knowledge };
		if (Object.hasOwn(knowledge, "next_decision") && !isDeepStrictEqual(knowledge.next_decision, merged.next_decision))
			throw new Error("arc_action decision conflict for next_decision");
		knowledge.next_decision = merged.next_decision;
		merged.knowledge = knowledge;
		delete merged.next_decision;
	}
	for (const key of ["subgoal", "next_step"] as const) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
		if (typeof value[key] !== "string") throw new Error(`arc_action ${key} must be a string`);
		if (Object.prototype.hasOwnProperty.call(merged, key) && merged[key] !== value[key])
			throw new Error(`arc_action decision conflict for ${key}`);
		merged[key] = value[key];
	}
	const { subgoal, next_step, ...nativeAndDecision } = value;
	for (const key of value.action === "ACTION6" ? ["x", "y", "reasoning"] : ["reasoning"]) {
		if (!Object.hasOwn(merged, key)) continue;
		if (Object.hasOwn(nativeAndDecision, key) && !isDeepStrictEqual(nativeAndDecision[key], merged[key]))
			throw new Error(`arc_action conflict for ${key}`);
		if (key === "reasoning" && typeof merged[key] !== "string")
			throw new Error("arc_action reasoning must be a string");
		nativeAndDecision[key] = merged[key];
		delete merged[key];
	}
	validateArcActionCoordinates(nativeAndDecision);
	return Object.keys(merged).length || value.decision !== undefined
		? { ...nativeAndDecision, decision: merged }
		: nativeAndDecision;
}

/** ACTION6's conditional requirement is not expressed by optional schema fields. */
export function validateArcActionCoordinates(value: Row): void {
	if (value.action !== "ACTION6") return;
	if ([value.x, value.y].some(coordinate => !Number.isInteger(coordinate) || coordinate < 0 || coordinate > 63))
		throw new Error("ACTION6 requires integer x and y in 0..63 at the top level");
}

/** Explicit native allowlist prevents task metadata from reaching the ARC bridge. */
export function nativeArcActionPayload(value: Row): Row {
	return {
		action: value.action,
		...(value.x !== undefined ? { x: value.x } : {}),
		...(value.y !== undefined ? { y: value.y } : {}),
		...(value.reasoning !== undefined ? { reasoning: value.reasoning } : {}),
	};
}

export function arcActionCoordinates(input: Row | undefined): { x: number; y: number } | undefined {
	if (input?.action !== "ACTION6" || !Number.isInteger(input.x) || !Number.isInteger(input.y)) return;
	return {x:input.x, y:input.y};
}

/** Old raw requests remain auditable, but ignored fields are not executed targets. */
export function arcActionReceiptView(input: Row): Row {
	if (!/^(?:RESET|ACTION[1-57])$/.test(String(input.action ?? ""))) return input;
	const {x, y, target_cell, action_target_cell, ...executed} = input;
	return executed;
}

export function arcActionCoordinateText(input: Row, targetCell?: unknown): string {
	const name = String(input.action ?? "UNKNOWN"), coordinates = arcActionCoordinates(input);
	if (coordinates) return ` Action input: ${name} x=${coordinates.x} (column), y=${coordinates.y} (row); target=frame[${coordinates.y}][${coordinates.x}], before/after=${JSON.stringify(targetCell ?? null)}.`;
	const ignored = name !== "ACTION6" && (input.x !== undefined || input.y !== undefined);
	return ` Action input: ${name} (no coordinate target${ignored ? "; supplied x/y were ignored by the native simple action" : ""}).`;
}
