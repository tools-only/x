/**
 * Test-only Pi extension for the meta-harness OfficeBench smoke.
 *
 * The LLM-facing tool is the real primitive. The slash command is only a
 * deterministic driver so the smoke can exercise the same extension state
 * without depending on a remote model.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type EvidencePolicy = "summary_only" | "source_and_date";

export default function metaHarnessDemoExtension(pi: ExtensionAPI) {
	let evidencePolicy: EvidencePolicy = "summary_only";

	const outputRoot = resolve(process.env.META_HARNESS_DEMO_ROOT ?? ".");
	const nativeRoot = join(outputRoot, "pi-native");
	mkdirSync(nativeRoot, { recursive: true });

	const writeSnapshot = (stage: "before" | "after" | "observed", observedBy: string) => {
		const payload = {
			stage,
			primitive: "evidence_policy",
			value: evidencePolicy,
			scope: "pi_extension_process",
			observedBy,
		};
		writeFileSync(join(nativeRoot, `${stage}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		return payload;
	};

	const setEvidencePolicy = (value: EvidencePolicy) => {
		evidencePolicy = value;
		return writeSnapshot("after", "pi_native_mutation_handler");
	};

	pi.registerTool({
		name: "set_evidence_policy",
		label: "Set Evidence Policy",
		description:
			"Change the task-local evidence policy used by later Pi agent starts. " +
			"Use source_and_date when later work must retain source and observation date.",
		parameters: Type.Object({
			value: Type.Union([Type.Literal("summary_only"), Type.Literal("source_and_date")]),
		}),
		async execute(_toolCallId, params) {
			const snapshot = setEvidencePolicy(params.value);
			return {
				content: [{ type: "text", text: JSON.stringify(snapshot) }],
				details: snapshot,
			};
		},
	});

	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\nTask-local evidence policy: ${evidencePolicy}`,
	}));

	pi.registerCommand("meta-harness-demo", {
		description: "Drive the deterministic native mutation smoke: before | mutate | observe",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "before") {
				writeSnapshot("before", "pi_extension_command");
			} else if (action === "mutate") {
				setEvidencePolicy("source_and_date");
			} else if (action === "observe") {
				writeSnapshot("observed", "later_pi_extension_command");
			} else {
				ctx.ui.notify("Usage: /meta-harness-demo before|mutate|observe", "warning");
				return;
			}
			ctx.ui.notify(`meta-harness demo: ${action}`, "info");
		},
	});
}
