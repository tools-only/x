/** Deterministic, network-free provider fixture. Not an autonomous researcher. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function offlineProvider(pi: ExtensionAPI) {
	let request = 0;
	let toolCall = 0;
	const researchArguments = (recurrence: "low" | "high", remainingUses: number) => ({
		action: "record",
		question: "Which action is reliable?",
		uncertainty: "Whether the observed constraint will recur.",
		evidence: "A task-local observation identified the execution constraint.",
		decision: recurrence === "high" ? "Use the focused calendar surface." : "Continue without changing the surface.",
		evidence_refs: ["fixture-1"],
		evidence_plan: [],
		assessment_refs: [],
		expected_recurrence: recurrence,
		remaining_uses: remainingUses,
	});
	const scenario = process.env.PI_TEST_SCENARIO;
	const steps = scenario === "baseline" ? [] : scenario === "workspace_boundary" ? [
		{ name: "workspace_file_action", arguments: { action: "list_files", path: "data", recursive: false } },
		{ name: "workspace_file_action", arguments: { action: "read_text", path: "../sibling/summary.json" } },
	] : scenario === "surface" ? [
		{ name: "officebench_action", arguments: { app: "calendar", action: "calendar_action", args: {} } },
		{ name: "research_resource", arguments: researchArguments("high", 8) },
		{ name: "decide_execution_surface", arguments: { choice: "apply", mode: "calendar_focused", basis_resource_ids: ["finding-1"], expected_effect: "later requests use only the focused calendar action for calendar work", effect_metric: "focused_tool_use_rate", observation_horizon: 2, reconsider_when: "calendar work is complete" } },
		{ name: "calendar_action", arguments: { action: "create_event", args: { user: "Fixture-A", summary: "effect-window", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" } } },
		{ name: "calendar_action", arguments: { action: "create_event", args: { user: "Fixture-B", summary: "effect-window", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" } } },
	] : scenario === "batch_surface" ? [
		{ name: "calendar_action", arguments: { action: "list_events", args: { username: "Fixture-A" } } },
		{ name: "research_resource", arguments: {
			action: "record",
			question: "Can repeated calendar writes use fewer Pi tool calls?",
			uncertainty: "Whether the direct calendar path works and enough writes remain to amortize a surface decision.",
			evidence: "The direct calendar action reached the real backend successfully; three similar creates remain.",
			decision: "Enable the task-local calendar batch capability for the remaining repeated writes.",
			evidence_refs: ["fixture-1"], evidence_plan: [], assessment_refs: [],
			expected_recurrence: "high", remaining_uses: 3,
			continue_with: { choice: "apply", mode: "calendar_batch",
				expected_effect: "complete three calendar writes through one Pi tool call and one bridge process",
				effect_metric: "calendar_batch_utilization", observation_horizon: 1,
				reconsider_when: "the batch action partially fails or non-calendar work is needed" },
		} },
		{ name: "calendar_batch_action", arguments: { events: [
			{ user: "Fixture-A", summary: "batch-effect-window", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" },
			{ user: "Fixture-B", summary: "batch-effect-window", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" },
			{ user: "Fixture-C", summary: "batch-effect-window", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" },
		] } },
	] : scenario === "email_batch_surface" ? [
		{ name: "officebench_action", arguments: { app: "excel", action: "read_file", args: { file_path: "data/team.xlsx" } } },
		{ name: "research_resource", arguments: {
			action: "record",
			question: "Can repeated personalized emails use fewer Pi tool calls?",
			uncertainty: "Whether the structured source is readable and enough similar sends remain.",
			evidence: "The Excel source was read successfully and three personalized sends remain.",
			decision: "Enable the task-local email batch capability for the repeated sends.",
			evidence_refs: ["fixture-1"], evidence_plan: [], assessment_refs: [],
			expected_recurrence: "high", remaining_uses: 3,
			continue_with: { choice: "apply", mode: "email_batch",
				expected_effect: "complete three email sends through one Pi tool call and one bridge process",
				effect_metric: "email_batch_utilization", observation_horizon: 1,
				reconsider_when: "the batch partially fails or the remaining sends are not similar" },
		} },
		{ name: "calendar_action", arguments: { action: "list_events", args: { username: "Fixture-A" } } },
		{ name: "email_batch_action", arguments: {
			sender: "Alice", subject: "training",
			content_template: "Hi {{name}}, your {{activity}} is {{time}}.",
			recipients: [
				{ recipient: "Bob", variables: { name: "Bob", activity: "training", time: "09:00" } },
				{ recipient: "Carol", variables: { name: "Carol", activity: "training", time: "11:00" } },
				{ recipient: "Alice", variables: { name: "Alice", activity: "training", time: "14:00" } },
			],
		} },
	] : scenario === "research_lifecycle" ? [
		{ name: "research_resource", arguments: {
			action: "open",
			question: "Will three repeated calendar writes benefit from the batch surface?",
			scope: "Only the three remaining calendar creates in this task",
			uncertainty: "The direct calendar path has not yet been observed in this task.",
			evidence_plan: ["Run one bounded direct calendar read and inspect its execution observation."],
			evidence_refs: [], assessment_refs: [],
			expected_recurrence: "high", remaining_uses: 3,
		} },
		{ name: "calendar_action", arguments: { action: "list_events", args: { username: "Fixture-A" } } },
		{ name: "research_resource", arguments: {
			action: "update", finding_id: "finding-1", target_version: 1,
			uncertainty: "Low: the direct path reached the backend and three homogeneous writes remain.",
			evidence: "The bounded direct calendar observation succeeded; three similar creates remain.",
			decision: "Enable calendar_batch for the three remaining creates.",
			evidence_refs: ["fixture-2"], evidence_plan: [], assessment_refs: [],
			expected_recurrence: "high", remaining_uses: 3,
			continue_with: { choice: "apply", mode: "calendar_batch",
				expected_effect: "complete three calendar writes through one Pi tool call and one bridge process",
				effect_metric: "calendar_batch_utilization", observation_horizon: 1,
				reconsider_when: "after the batch effect assessment is available" },
		} },
		{ name: "calendar_batch_action", arguments: { events: [
			{ user: "Fixture-A", summary: "lifecycle", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" },
			{ user: "Fixture-B", summary: "lifecycle", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" },
			{ user: "Fixture-C", summary: "lifecycle", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" },
		] } },
		{ name: "research_resource", arguments: {
			action: "resolve", finding_id: "finding-1", target_version: 2,
			uncertainty: "Resolved for this bounded task window.",
			evidence: "The batch effect assessment completed all three work units in one call.",
			decision: "Accept the task-local batch effect; no repeated calendar writes remain.",
			evidence_plan: [], evidence_refs: [], assessment_refs: ["effect-assessment-1"],
			expected_recurrence: "low", remaining_uses: 0,
			resolution: "supported",
		} },
	] : scenario === "decision_support_once" ? [
		{ name: "email_action", arguments: { action: "send_email", args: {
			sender: "Alice", recipient: "Bob", subject: "one", content: "one",
		} } },
		{ name: "email_action", arguments: { action: "send_email", args: {
			sender: "Alice", recipient: "Carol", subject: "two", content: "two",
		} } },
	] : scenario === "exposure_gate" ? [
		{ name: "calendar_action", arguments: { action: "list_events", args: { username: "Fixture-A" } } },
		{ name: "research_resource", arguments: researchArguments("high", 2) },
		[
			{ name: "decide_execution_surface", arguments: { choice: "apply", mode: "calendar_focused", basis_resource_ids: ["finding-1"], expected_effect: "only post-exposure calendar actions count toward focused use", effect_metric: "focused_tool_use_rate", observation_horizon: 1, reconsider_when: "one post-exposure calendar action completes" } },
			{ name: "calendar_action", arguments: { action: "create_event", args: { user: "Fixture-Before", summary: "before-exposure", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" } } },
		],
		{ name: "calendar_action", arguments: { action: "create_event", args: { user: "Fixture-After", summary: "after-exposure", time_start: "2024-05-01 09:00:00", time_end: "2024-05-01 10:00:00" } } },
	] : scenario === "transient" ? [
		{ name: "task_notes", arguments: { text: "Observed one transient action error." } },
		{ name: "research_resource", arguments: researchArguments("low", 1) },
		{ name: "decide_execution_surface", arguments: { choice: "keep", mode: "general", basis_resource_ids: ["finding-1"], expected_effect: "avoid adjustment overhead for one remaining use", effect_metric: "semantic_error_rate", observation_horizon: 1, reconsider_when: "the error recurs" } },
	] : scenario === "invalid_surface" ? [
		{ name: "decide_execution_surface", arguments: { choice: "apply", mode: "calendar_focused", basis_resource_ids: ["missing-finding"], expected_effect: "narrow tools", effect_metric: "semantic_error_rate", observation_horizon: 1, reconsider_when: "task ends" } },
	] : [
		{ name: "task_notes", arguments: { text: "Fixture question: dated records may be ambiguous. Expected effect: retain provenance. This is scripted test evidence, not a real research finding." } },
		{ name: "set_evidence_policy", arguments: { value: "source_and_date" } },
		{ name: "task_notes", arguments: { text: "Fixture follow-up: inspect subsequent model context; improvement remains unestablished." } },
		{ name: "set_evidence_policy", arguments: { value: "summary_only" } },
		{ name: "task_notes", arguments: { text: "" } },
	];
	pi.registerProvider("offline-context-test", {
		api: "openai-completions",
		apiKey: "offline-not-a-secret",
		baseUrl: "http://unused.invalid",
		models: [{ id: "scripted", name: "Offline scripted fixture", reasoning: false,
			input: ["text"], contextWindow: 128000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple(model, context) {
			appendFileSync(join(process.env.PI_OFFICEBENCH_E2E_ROOT!, "provider-contexts.jsonl"),
				JSON.stringify({ request, pid: process.pid, context }) + "\n", "utf8");
			const step = steps[request++];
			const toolSteps = Array.isArray(step) ? step : step ? [step] : [];
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], stopReason: step ? "toolUse" : "stop", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			stream.push({ type: "start", partial: output });
			if (toolSteps.length) {
				for (const toolStep of toolSteps) {
					const contentIndex = output.content.length;
					const block = { type: "toolCall" as const, id: `fixture-${++toolCall}`, name: toolStep.name, arguments: toolStep.arguments };
					output.content.push(block);
					stream.push({ type: "toolcall_start", contentIndex, partial: output });
					stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(toolStep.arguments), partial: output });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				}
			} else {
				output.content.push({ type: "text", text: "" });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				output.content[0] = { type: "text", text: "Offline fixture complete." };
				stream.push({ type: "text_delta", contentIndex: 0, delta: "Offline fixture complete.", partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: "Offline fixture complete.", partial: output });
			}
			stream.push({ type: "done", reason: toolSteps.length ? "toolUse" : "stop", message: output });
			stream.end();
			return stream;
		},
	});
}
