/**
 * Stage 3 of docs/plans/2026-11-16-arc-selfloop-migration.md: the typed slot surface. A slots/*.json save is one JSON
 * object validated whole against SLOT_SPECS (a bad key refuses the save and names the legal form), the parsed values
 * ride on the component spec, later files win, only values that differ from the host's defaults are reported, and the
 * inventory names every key with its current value, default and legal form.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_SPECS, changedSlots, slotComponent, slotInventory, slotValues } from '../demo/arc_thin_selfslots.ts';

test('a valid slot file binds with its values on the spec and a description naming what is set', () => {
	const spec = slotComponent('slots/self.json', '{"refine.every": 5, "review.consult": false}');
	assert.equal(spec.kind, 'slot');
	assert.equal(spec.name, 'self');
	assert.equal(spec.enabled, true);
	assert.equal(spec.description, 'refine.every=5, review.consult=false');
	assert.deepEqual(spec.parameters.slots, { 'refine.every': 5, 'review.consult': false });
	assert.equal(slotComponent('slots/self.json', '{}').description, 'no key set (every value stays what the host has)');
});

test('a bad save is refused whole, naming the key at fault and the legal form', () => {
	assert.throws(() => slotComponent('slots/self.json', 'nope'), /not JSON/);
	assert.throws(() => slotComponent('slots/self.json', '[1]'), /one JSON object/);
	assert.throws(() => slotComponent('slots/self.json', '{"refine.cadence": 5}'),
		/unknown slot "refine\.cadence"; settable: history\.result_chars, history\.full_results, refine\.every, review\.consult, stall\.after/);
	assert.throws(() => slotComponent('slots/self.json', '{"refine.every": 0}'), /refine\.every must be an integer 1-200 \(got 0\)/);
	assert.throws(() => slotComponent('slots/self.json', '{"refine.every": 2.5}'), /must be an integer 1-200 \(got 2\.5\)/);
	assert.throws(() => slotComponent('slots/self.json', '{"refine.every": true}'), /must be an integer 1-200 \(got true\)/);
	assert.throws(() => slotComponent('slots/self.json', '{"review.consult": 1}'), /review\.consult must be true or false \(got 1\)/);
	assert.throws(() => slotComponent('slots/self.json', '{"refine.every": 5, "stall.after": 501}'), /stall\.after must be an integer 0-500/);
});

test('bound values merge with the later file winning, and only differences from the defaults are reported', () => {
	const components = [
		{ kind: 'slot', parameters: { slots: { 'refine.every': 5, 'stall.after': 60 } } },
		{ kind: 'tool', parameters: {} },
		{ kind: 'slot', parameters: { slots: { 'refine.every': 9 } } },
	];
	assert.deepEqual(slotValues(components), { 'refine.every': 9, 'stall.after': 60 });
	const defaults = { 'refine.every': 9, 'stall.after': 40, 'review.consult': true };
	assert.deepEqual(changedSlots(slotValues(components), defaults), [['stall.after', 60]]);
	assert.deepEqual(changedSlots({}, defaults), []);
});

test('the inventory lists every settable key with current, default and legal form, and says how to write', () => {
	const defaults = { 'history.result_chars': 5000, 'history.full_results': 2, 'refine.every': 15, 'review.consult': true, 'stall.after': 40 };
	const inventory = JSON.parse(slotInventory({ 'refine.every': 5, 'review.consult': false }, defaults));
	assert.equal(inventory.write, 'slots/self.json: one JSON object; a key you omit keeps its value; a saved value applies from your next decision');
	assert.deepEqual(Object.keys(inventory), ['write', ...Object.keys(SLOT_SPECS)]);
	assert.deepEqual(inventory['refine.every'], { current: 5, default: 15, legal: 'an integer 1-200' });
	assert.deepEqual(inventory['review.consult'], { current: false, default: true, legal: 'true or false' });
	assert.deepEqual(inventory['stall.after'], { current: 40, default: 40, legal: 'an integer 0-500' });
});
