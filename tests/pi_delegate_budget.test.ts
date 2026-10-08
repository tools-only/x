import assert from "node:assert/strict";
import test from "node:test";
import { createDelegateBudget, delegateBudgetRemaining, resolveDelegateBudget } from "../demo/pi_delegate_budget.ts";

test("one invocation retains spent time, tools and tokens across resumes", () => {
	const budget = createDelegateBudget(resolveDelegateBudget({ max_runtime_ms: 100, max_tool_calls: 3, max_reported_tokens: 40 }, {}), 1000);
	budget.tool_calls = 2; budget.reported_tokens = 32;
	assert.deepEqual(delegateBudgetRemaining(budget, 1070), { runtime_ms: 30, tool_calls: 1, reported_tokens: 8 });
	assert.deepEqual(delegateBudgetRemaining(budget, 1101), { runtime_ms: 0, tool_calls: 1, reported_tokens: 8 });
});
test("call allowances can tighten but cannot enlarge operator limits", () => {
	assert.deepEqual(resolveDelegateBudget({ max_runtime_ms: 600000, max_tool_calls: 100, max_reported_tokens: 999 }, {
		PI_AUTORESEARCH_DELEGATE_MAX_RUNTIME_MS: "20", PI_AUTORESEARCH_DELEGATE_MAX_TOOL_CALLS: "2",
		PI_AUTORESEARCH_DELEGATE_MAX_REPORTED_TOKENS: "100" }), {
		max_runtime_ms: 20, max_tool_calls: 2, max_continuations: 2, max_reported_tokens: 100 });
});
