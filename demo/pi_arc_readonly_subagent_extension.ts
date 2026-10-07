/** Read-only ARC capability surface for a task-local Pi subagent. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ARC_SYSTEM_PROMPT, renderArcFrame, renderArcLatestFrameRuns } from "./arc_agi_3_official_adapter.ts";
import { renderArcFrameImage } from "./pi_arc_frame_image.ts";
import { renderArcObservationView } from "./pi_arc_observation_view.ts";
import { installArcTrajectoryResource } from "./pi_arc_trajectory_resource.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";
import { renderPrompt } from "./prompt_loader.ts";
import { bridge } from "./pi_arc_bridge_client.ts";
import { renderArcObservationWindow } from "./pi_arc_observation_window.ts";

async function bridgeState() {
	if (process.env.PI_ARC_ACTION_TOKEN && process.env.PI_ARC_BRIDGE_URL) return bridge("/state");
	const snapshot = String(process.env.PI_TASK_CHILD_STATE_SNAPSHOT ?? "").trim();
	if (snapshot) {
		try { return JSON.parse(snapshot) as Record<string, unknown>; }
		catch { throw new Error("invalid parent-published ARC state snapshot"); }
	}
	const base = process.env.PI_ARC_BRIDGE_URL;
	if (!base) throw new Error("parent-published ARC state snapshot is not available");
	const response = await fetch(`${base}/state`);
	const value = await response.json() as Record<string, unknown>;
	if (!response.ok) throw new Error(String(value.error ?? `ARC bridge HTTP ${response.status}`));
	return value;
}

export default function arcReadonlySubagent(pi: ExtensionAPI) {
	const usesSharedLifecycle = process.env.PI_TASK_SUBAGENT_TOOLS !== undefined;
	if (!usesSharedLifecycle) installReportedTokenBudget(pi, process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	const imageInput = String(process.env.PI_ARC_INPUT_MODALITIES ?? "text").split(",").map((item) => item.trim()).includes("image");
	if (!usesSharedLifecycle) installProviderTelemetry(pi, {
		fileName: "subagent-provider-telemetry.jsonl",
		contextTokenFileName: "subagent-context-token-debug.jsonl",
		scope: "arc-readonly-subagent",
	});
	// The shared child launcher installs pi_task_validation_child.ts after this
	// ARC adapter. That extension owns the restricted task_resource registration;
	// registering it here as well would make Pi reject the child with a duplicate
	// tool name. The parent still passes exact grants through the child env.
	let configured: unknown = ["arc_state", "inspect_arc_trajectory"];
	try {
		configured = JSON.parse(
			process.env.PI_TASK_SUBAGENT_TOOLS ?? process.env.PI_ARC_SUBAGENT_TOOLS ?? "[]",
		);
	} catch {}
	const allowed = new Set(Array.isArray(configured) ? configured.map(String) : []);
	const selectedSnapshotRef = String(process.env.PI_TASK_CHILD_STATE_SNAPSHOT_REF ?? "").trim();
	// Optional zero-read delivery of the already-authorized immutable boundary.
	// Install after all transcript projections, so pixels never enter history or
	// expire as an ordinary read. An action delegate continues to use live reads.
	if ((selectedSnapshotRef || (process.env.PI_ARC_CHILD_OBSERVATION === "published" && allowed.has("arc_state")))
		&& !process.env.PI_ARC_ACTION_TOKEN
		&& process.env.PI_TASK_CHILD_STATE_SNAPSHOT) {
		const state = JSON.parse(process.env.PI_TASK_CHILD_STATE_SNAPSHOT) as Record<string, unknown>;
		const view = renderArcObservationWindow([], state, { includeImages: imageInput });
		let installed = false;
		pi.on("session_start", () => {
			if (installed) return;
			installed = true;
			pi.on("context", (event) => ({ messages: [...event.messages, {
				role: "user" as const, timestamp: Date.now(), content: [
					{ type: "text" as const, text: (selectedSnapshotRef
						? `PARENT-SELECTED ARC OBSERVATION ${selectedSnapshotRef} (complete immutable evidence; may be historical):\n`
						: "PARENT-PUBLISHED ARC OBSERVATION (complete, fixed at delegation; not the live environment):\n")
						+ `State=${String(state.state ?? "UNKNOWN")}; levels_completed=${String(state.levels_completed ?? 0)}; action_budget=${JSON.stringify(state.action_budget ?? {})}.\n`
						+ view.text },
					...view.images.flatMap((image) => [{ type: "text" as const, text: image.label }, image.content]),
				],
			}] }));
		});
	}
	if (allowed.has("arc_action") && process.env.PI_ARC_ACTION_TOKEN && process.env.PI_ARC_BRIDGE_URL) {
		pi.registerTool({
			name: "arc_action", label: "Delegated ARC action",
			description: "Execute one ARC action under this invocation's explicit, limited action lease. The lease expires when the parent call ends. Failed or unknown actions are never retried automatically.",
			parameters: Type.Object({ action: Type.String(),
				x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
				y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
				reasoning: Type.Optional(Type.String()) }),
			executionMode: "sequential",
			async execute(_toolCallId, params) {
				const cursor = Number((await bridge("/events?after=0")).next);
				const result = await bridge("/action", params as Record<string, unknown>);
				const events = await bridge(`/events?after=${cursor}`);
				const window = renderArcObservationWindow(
					Array.isArray(events.events) ? events.events as Record<string, any>[] : [], result,
					{ includeImages: imageInput });
				return { content: [{ type: "text" as const, text: window.text },
					...window.images.flatMap((image) => [{ type: "text" as const, text: image.label }, image.content])],
					details: { state: result.state, levels_completed: result.levels_completed,
						observation_delta: result.observation_delta, public_transition: result.public_transition,
						action_budget: result.action_budget } };
			},
		});
	}
	if (allowed.has("arc_state")) {
		pi.registerTool({
			name: "arc_state",
			label: "ARC state (read only)",
			description: "Read the complete parent-published public ARC frame without acting. request='current' or 'image' provides the full PNG and matching hex grid for image-capable models; 'map' and 'full' provide complete exact text views.",
			parameters: Type.Object({ request: Type.Union([Type.Literal("current"), Type.Literal("image"), Type.Literal("map"), Type.Literal("full")]) }),
			async execute(_toolCallId, params) {
				const value = await bridgeState();
				const request = String(params.request ?? "current");
				const frames = Array.isArray(value.frames) ? value.frames : [];
				const hasCurrentFrame = Array.isArray(frames.at(-1)) && frames.at(-1).length > 0;
				if (!hasCurrentFrame) return { content: [{ type: "text" as const, text: renderArcFrame(value) }],
					details: { state: value.state, levels_completed: value.levels_completed,
						representation: "bridge_status_without_current_frame" } };
				if (imageInput && (request === "current" || request === "image")) {
					const view = renderArcFrameImage(value);
					return { content: [{ type: "text" as const, text: view.label + "\n" + renderArcObservationWindow([], value).text }, view.content],
						details: { ...view.metadata, representation: "current_frame_png" } };
				}
				if (!usesSharedLifecycle && request === "current") {
					return { content: [{ type: "text", text: renderArcFrame(value) }], details: value };
				}
				const frameCount = frames.length;
				const mode = request === "full" ? "full" : "map";
				const view = renderArcObservationView(value, {
					mode,
					...(mode === "full" ? { exactText: renderArcLatestFrameRuns(value, { derived: false }) } : {}),
				});
				return {
					content: [{ type: "text", text: view.text }],
					details: {
						state: value.state,
						levels_completed: value.levels_completed,
						frame_count: frameCount,
						current_frame_index: frameCount ? frameCount - 1 : null,
						representation: view.metadata,
					},
				};
			},
		});
	}
	installArcTrajectoryResource(pi, allowed.has("inspect_arc_trajectory"));
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${ARC_SYSTEM_PROMPT}\n\n${event.systemPrompt}\n\n` + renderPrompt("arc_readonly_subagent.md", {
			frame_context: process.env.PI_ARC_ACTION_TOKEN
				? "This ordinary delegation has an explicit bounded ARC action lease. arc_state reads the live public state; arc_action executes native actions until the lease is exhausted or revoked. "
				: selectedSnapshotRef
				? `Selected immutable evidence ${selectedSnapshotRef} is provided complete on every turn; it may be historical and does not grant live environment tools. `
				: usesSharedLifecycle
				&& allowed.has("arc_state")
				? imageInput
					? "The last rendered frame is current; arc_state(request='current') returns its complete image and exact numeric grid. "
					: "The last rendered frame is current; earlier rendered frames are animation context. arc_state returns a lossless text view of only that current frame. "
				: "",
			allowed_tools: JSON.stringify([...allowed]),
			action_policy: process.env.PI_ARC_ACTION_TOKEN
				? "This ordinary delegate_task has explicit action authority for this invocation only. Execute only the bounded actions needed for the assigned task; report each action and its observed result. "
				: "This invocation is read-only. Do not claim to have executed an ARC action; arc_action is unavailable. ",
		}),
	}));
}
