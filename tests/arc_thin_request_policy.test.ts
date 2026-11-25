import assert from "node:assert/strict";
import test from "node:test";
import { applyParentOutputLimit } from "../demo/arc_thin_request_policy.ts";

test("Codex Responses uses max_output_tokens and removes incompatible fields", () => {
	const payload: Record<string, any> = { max_tokens: 1000, max_completion_tokens: 2000 };
	applyParentOutputLimit(payload, "openai-codex-responses", 12000);
	assert.deepEqual(payload, { max_output_tokens: 12000 });
});

test("OpenAI Responses uses max_output_tokens", () => {
	const payload: Record<string, any> = { max_tokens: 1000 };
	applyParentOutputLimit(payload, "openai-responses", 12000);
	assert.deepEqual(payload, { max_output_tokens: 12000 });
});

test("completion APIs preserve their configured token field", () => {
	const payload: Record<string, any> = { max_completion_tokens: 4000 };
	applyParentOutputLimit(payload, "openai-completions", 12000);
	assert.deepEqual(payload, { max_completion_tokens: 12000 });

	const legacyPayload: Record<string, any> = {};
	applyParentOutputLimit(legacyPayload, "openai-completions", 12000);
	assert.deepEqual(legacyPayload, { max_tokens: 12000 });
});

test("zero removes all output token fields", () => {
	const payload: Record<string, any> = {
		max_tokens: 1000,
		max_completion_tokens: 2000,
		max_output_tokens: 3000,
	};
	applyParentOutputLimit(payload, "openai-codex-responses", 0);
	assert.deepEqual(payload, {});
});
