/** ARC-AGI-3 task tools plus the shared task-local research resources. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import externalBenchmarkResearch from "./pi_external_benchmark_research.ts";
import { ARC_SYSTEM_PROMPT, renderArcFrame } from "./arc_agi_3_official_adapter.ts";

async function bridge(path: string, body?: Record<string, unknown>) {
	const base = process.env.PI_ARC_BRIDGE_URL;
	if (!base) throw new Error("PI_ARC_BRIDGE_URL is not configured");
	const response = await fetch(`${base}${path}`, body ? {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
	} : undefined);
	const value = await response.json() as Record<string, unknown>;
	if (!response.ok) throw new Error(String(value.error ?? `ARC bridge HTTP ${response.status}`));
	return value;
}

export default function arcAgi3Extension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "arc_state", label: "ARC state",
		description: "Read the current native ARC-AGI-3 frame, state, available actions, and remaining action budget.",
		// The configured OpenAI-compatible gateway rejects an empty object schema
		// (it serializes it as null). Keep one harmless required field, matching
		// the existing project adapters' gateway-compatible tool contracts.
		parameters: Type.Object({ request: Type.String() }),
		async execute() {
			const value = await bridge("/state");
			return { content: [{ type: "text", text: renderArcFrame(value) }], details: value };
		},
	});
	pi.registerTool({
		name: "arc_action", label: "ARC action",
		description: "Submit exactly one currently available native ARC action. Complex actions require x/y coordinates in 0..63.",
		parameters: Type.Object({
			action: Type.String(),
			x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
			reasoning: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			const value = await bridge("/action", params as Record<string, unknown>);
			const delta = value.observation_delta as Record<string, unknown> | undefined;
			const deltaText = delta
				? `Observation delta (deterministic, latest frame): changed_cells=${String(delta.changed_cells ?? 0)}, bbox=${JSON.stringify(delta.bbox ?? null)}`
				: "Observation delta unavailable for this action.";
			return {
				content: [{ type: "text", text: deltaText }, { type: "text", text: JSON.stringify(value) }],
				details: value,
			};
		},
	});
	externalBenchmarkResearch(pi);
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${ARC_SYSTEM_PROMPT}\n\n${event.systemPrompt}\n\n` +
			"During exploration, treat repeated state changes as evidence for a later choice. " +
			"Each arc_action result begins with a deterministic Observation delta; read that " +
			"short line before deciding whether to repeat or change the probe. " +
			"When an observed local pattern, or a more informative next probe, would change " +
			"how you continue this game, you may record one concise task-local finding with " +
			"research_resource citing the exact observation; update it if later evidence changes " +
			"the choice. After several repeated probes with the same apparent outcome, " +
			"pause to consider whether the stable pattern or a discriminating next probe " +
			"deserves one finding before repeating again. A finding may simply preserve a " +
			"local pattern or rule out a probe; it need not imply a harness change. This is optional: direct play and " +
			"no harness change remain valid.",
		}));
}
