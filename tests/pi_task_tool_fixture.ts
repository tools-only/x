import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTaskLocalTools, type TaskToolAdapter } from "../demo/pi_task_local_tools.ts";

export default function taskToolFixture(pi: ExtensionAPI) {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	let decisionCounter = 0;
	const decisions = join(root, "harness-decisions.jsonl");
	if (existsSync(decisions)) {
		for (const line of readFileSync(decisions, "utf8").split(/\r?\n/).filter(Boolean)) {
			try {
				const match = String(JSON.parse(line)?.decision_id ?? "").match(/(\d+)$/);
				if (match) decisionCounter = Math.max(decisionCounter, Number(match[1]));
			} catch {}
		}
	}
	const adapter: TaskToolAdapter = {
		adapterId: "fixture",
		permission: "fixture_echo_only",
		allowedImplementations: ["fixture.echo"],
		execute: async (implementationRef, input) => {
			if (implementationRef !== "fixture.echo") throw new Error("unsupported fixture implementation");
			return {
				content: [{ type: "text", text: `echo:${String(input.message ?? "")}` }],
				details: { implementation_ref: implementationRef, message: input.message ?? "" },
			};
		},
	};
	installTaskLocalTools(pi, {
		root,
		append: (name, value) => appendFileSync(join(root, name), JSON.stringify(value) + "\n", "utf8"),
		allocateDecisionId: () => `decision-${++decisionCounter}`,
		resolveBasisRefs: (references) => references,
	}, adapter);
}
