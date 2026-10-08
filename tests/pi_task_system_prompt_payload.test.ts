import assert from "node:assert/strict";
import test from "node:test";
import { replaceTaskSystemOverlay, taskSystemOverlaySection } from "../demo/pi_task_system_prompt_payload.ts";

const old = taskSystemOverlaySection("OLD_POLICY");
const next = taskSystemOverlaySection("NEW_POLICY");
const samples = [
	["openai-completions", { systemPrompt: "HOST" + old, messages: [{ role: "user", content: [{ type: "text", text: "QUESTION" }] }] }],
	["openai-completions", { messages: [{ role: "system", content: "HOST" + old }, { role: "user", content: "QUESTION" }], tools: [{ name: "t" }] }],
	["openai-completions", { messages: [{ role: "developer", content: [{ type: "text", text: "HOST" + old, cache_control: { type: "ephemeral" } }] }] }],
	["openai-responses", { instructions: "HOST" + old, input: [{ role: "user", content: "QUESTION" }] }],
	["anthropic-messages", { system: [{ type: "text", text: "HOST" + old, cache_control: { type: "ephemeral" } }], messages: [] }],
	["google-generative-ai", { config: { systemInstruction: { parts: [{ text: "HOST" + old }], role: "system" } }, contents: [] }],
	["google-vertex", { systemInstruction: { parts: [{ text: "HOST" + old }] }, contents: [] }],
	["google-generative-ai", { config: { temperature: 0 }, systemInstruction: { parts: [{ text: "HOST" + old }] }, contents: [] }],
	["google-generative-ai", { config: { systemInstruction: ["HOST" + old] }, contents: [] }],
	["google-generative-ai", { config: { systemInstruction: { text: "HOST" + old } }, contents: [] }],
] as const;
for (const [api, input] of samples) test(`${api}: replace, remove, preserve and repeat`, () => {
	const original = JSON.stringify(input);
	const updated = replaceTaskSystemOverlay(input, [old], "NEW_POLICY", api);
	assert.equal(JSON.stringify(input), original);
	assert(!JSON.stringify(updated).includes("OLD_POLICY"));
	assert.equal(JSON.stringify(updated).split("NEW_POLICY").length, 2);
	assert(JSON.stringify(updated).includes("HOST"));
	const repeated = replaceTaskSystemOverlay(updated, [old, next], "NEW_POLICY", api);
	assert.deepEqual(repeated, updated);
	const removed = replaceTaskSystemOverlay(updated, [old, next], "", api);
	assert(!JSON.stringify(removed).includes("POLICY"));
	if (original.includes("ephemeral")) assert(JSON.stringify(removed).includes("ephemeral"));
});
test("unsupported shapes fail without modifying input", () => {
	assert.throws(() => replaceTaskSystemOverlay({ unknown: "HOST" }, [], "POLICY"), /Unsupported/);
	assert.throws(() => replaceTaskSystemOverlay({ config: { systemInstruction: { unknown: "HOST" } } }, [], "POLICY", "google"), /Unsupported/);
});
test("missing system fields and non-text blocks are preserved", () => {
	assert.deepEqual(replaceTaskSystemOverlay({ messages: [{ role: "user", content: "Q" }] }, [], "NEW_POLICY").messages[0],
		{ role: "system", content: next });
	const input = { system: [{ type: "other", value: "KEEP" }], messages: [] };
	assert.deepEqual(replaceTaskSystemOverlay(input, [], "NEW_POLICY", "anthropic-messages").system[0], input.system[0]);
});
