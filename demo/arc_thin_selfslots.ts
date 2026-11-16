/**
 * Stage 3 of docs/plans/2026-11-16-arc-selfloop-migration.md: the host's typed settings ("slots") the agent may change.
 *
 * The slot file is an ordinary workspace file (slots/self.json) saved through the binder like any component, so it
 * gets a version, a receipt, an optional EXPECT trailer, a row in harness_changes.jsonl and the capability index for
 * free. This module owns the schema: which keys exist, what type and range each takes, and how a saved object is read
 * back at the next decision. A save is validated as a whole: one bad key keeps the previous version running and the
 * receipt names the key at fault and the legal form (evo's rejected-write contract, self_root_meta_fields.md).
 *
 * What is outside the surface is the boundary the brief fixes: the view renderer, fact collection, acceptance, budget,
 * permission and environment signals are never slots, and every default here is the value the harness already used.
 */

import type { ComponentSpec } from './arc_thin_binder.ts';

export type SlotSpec = { type: 'integer' | 'boolean'; min?: number; max?: number };

/** The host's settable keys: today's hardcoded values become the defaults, these are the ranges they may move in. */
export const SLOT_SPECS: Record<string, SlotSpec> = {
	'history.result_chars': { type: 'integer', min: 200, max: 20000 },
	'history.full_results': { type: 'integer', min: 0, max: 10 },
	'refine.every': { type: 'integer', min: 1, max: 200 },
	'review.consult': { type: 'boolean' },
	'stall.after': { type: 'integer', min: 0, max: 500 },
};

export type SlotValues = Record<string, number | boolean>;

const legal = (spec: SlotSpec) => spec.type === 'boolean' ? 'true or false' : `an integer ${spec.min}-${spec.max}`;

/**
 * The binder's spec for a slots/*.json save. Throws on a malformed file, an unknown key, a wrong type or a value out
 * of range; the binder then refuses the save and the previous version keeps running. The parsed values ride on
 * `parameters.slots`, so a reader never re-parses or re-validates.
 */
export function slotComponent(path: string, source: string): ComponentSpec {
	let body: any;
	try { body = JSON.parse(source); } catch (error) { throw Error(`not JSON: ${(error as Error).message}`); }
	if (!body || typeof body !== 'object' || Array.isArray(body))
		throw Error('the file must be one JSON object, e.g. {"refine.every": 20}');
	const values: SlotValues = {};
	for (const [key, value] of Object.entries(body)) {
		const spec = SLOT_SPECS[key];
		if (!spec) throw Error(`unknown slot "${key}"; settable: ${Object.keys(SLOT_SPECS).join(', ')}`);
		if (spec.type === 'boolean') {
			if (typeof value !== 'boolean') throw Error(`${key} must be ${legal(spec)} (got ${JSON.stringify(value)})`);
		} else if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min! || value > spec.max!) {
			throw Error(`${key} must be ${legal(spec)} (got ${JSON.stringify(value)})`);
		}
		values[key] = value as number | boolean;
	}
	const set = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	return { kind: 'slot', name: path.split('/').at(-1)!.replace(/\.json$/, ''),
		description: set.length ? set.join(', ') : 'no key set (every value stays what the host has)',
		enabled: true, body: source, parameters: { slots: values } };
}

/** The values of every bound slot component, in binding order; if two files set the same key the later one wins. */
export function slotValues(components: Array<{ kind?: string; parameters?: any }>): SlotValues {
	const values: SlotValues = {};
	for (const component of components)
		if (component.kind === 'slot' && component.parameters?.slots) Object.assign(values, component.parameters.slots);
	return values;
}

/** The keys whose value differs from the host's current default: what the digest shows, so unchanged runs stay silent. */
export function changedSlots(values: SlotValues, defaults: SlotValues): Array<[string, number | boolean]> {
	return Object.entries(values).filter(([key, value]) => defaults[key] !== value);
}

/**
 * data/self/slots.json: what may be set, its current and default value and the legal form (the A4 inventory). Read-only
 * to the agent; written by the runtime from the values bound at this decision's boundary.
 */
export function slotInventory(values: SlotValues, defaults: SlotValues): string {
	const inventory: Record<string, any> = {
		write: 'slots/self.json: one JSON object; a key you omit keeps its value; a saved value applies from your next decision',
	};
	for (const [key, spec] of Object.entries(SLOT_SPECS))
		inventory[key] = { current: values[key] ?? defaults[key], default: defaults[key], legal: legal(spec) };
	return JSON.stringify(inventory, null, 1) + '\n';
}
