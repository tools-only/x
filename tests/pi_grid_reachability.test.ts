import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTaskPureExpression, PureExpressionError } from "../demo/pi_task_pure_expression.ts";

const keys = ["grid", "start", "target", "footprint", "offsets", "passable", "max_nodes"] as const;
const get = (key: string) => ({ op: "get", value: { op: "input" }, key: { op: "literal", value: key } });
const expression = { op: "grid_reachability", ...Object.fromEntries(keys.map(key => [key, get(key)])) };
const program = (limits = {}) => ({ format: "task-pure-expression-v1", limits, expression });
const base = { grid: [[3, 3, 3], [4, 4, 3], [3, 3, 3]], start: [0, 0], target: [0, 2],
	footprint: [1, 1], offsets: [[0, -1], [0, 1], [-1, 0], [1, 0]], passable: [3], max_nodes: 100 };
const run = (input: unknown, limits = {}) => evaluateTaskPureExpression(program(limits), input).value as Record<string, any>;

test("bounded reachability returns shortest offset-index route and unknown on truncation", () => {
	const result = run(base);
	assert.equal(result.target_status, "reachable");
	assert.deepEqual(result.path, [3, 3, 1, 1, 2, 2]);
	assert.deepEqual(result.nearest_anchor, base.target);
	assert.equal(result.reachable_count, 7);
	assert.equal(result.truncated, false);
	const limited = run({ ...base, max_nodes: 2 });
	assert.equal(limited.target_status, "unknown_limit");
	assert.equal(limited.path, null);
	assert.equal(limited.truncated, true);
	assert.equal(limited.reachable_count, 2);
});

test("exhausted graph says unreachable and returns nearest reachable anchor", () => {
	const input = { ...base, grid: [[3, 4, 3], [4, 4, 3], [3, 3, 3]] };
	const result = run(input);
	assert.equal(result.target_status, "unreachable");
	assert.equal(result.path, null);
	assert.deepEqual(result.nearest_anchor, [0, 0]);
	assert.deepEqual(result.nearest_path, []);
	assert.equal(result.reachable_count, 1);
});

test("invalid geometry, program shape, work budget and cancellation fail closed", () => {
	for (const input of [
		{ ...base, grid: [[3, 3], [3]] },
		{ ...base, footprint: [0, 1] },
		{ ...base, offsets: [[0, 0]] },
		{ ...base, max_nodes: 0 },
		{ ...base, passable: [3.5] },
		{ ...base, target: [3, 1] },
	]) assert.throws(() => run(input), (error: unknown) => error instanceof PureExpressionError && error.code === "type_error");
	assert.throws(() => evaluateTaskPureExpression({ ...program(), expression: { ...expression, unknown: get("grid") } }, base),
		(error: unknown) => error instanceof PureExpressionError && error.code === "invalid_program");
	assert.throws(() => run(base, { steps: 20 }),
		(error: unknown) => error instanceof PureExpressionError && error.code === "budget_exhausted");
	assert.throws(() => evaluateTaskPureExpression(program(), base, { is_cancelled: () => true }),
		(error: unknown) => error instanceof PureExpressionError && error.code === "cancelled");
});
