/** Thin diagnostic bootstrap: install existing native task/resource surfaces only. */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	installTaskLocalSelfHarness,
} from "../demo/pi_task_local_self_harness.ts";
import { installTaskResourceReader } from "../demo/pi_task_resource_store.ts";
import type { TaskToolAdapter } from "../demo/pi_task_local_tools.ts";

type SelfHarnessDependencies = Parameters<typeof installTaskLocalSelfHarness>[1];

function readJsonl(root: string, name: string): Record<string, any>[] {
	const path = join(root, name);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
		} catch {
			return [];
		}
	});
}

export default function restrictedExpressionDiagnosticBootstrap(pi: ExtensionAPI): void {
	const root = resolve(process.env.PI_AUTORESEARCH_E2E_ROOT ?? ".");
	let decisionCounter = 0;
	for (const row of readJsonl(root, "harness-decisions.jsonl")) {
		const match = String(row.decision_id ?? "").match(/(\d+)$/);
		if (match) decisionCounter = Math.max(decisionCounter, Number(match[1]));
	}
	const append = (name: string, value: unknown) => {
		appendFileSync(join(root, name), JSON.stringify(value) + "\n", "utf8");
	};
	// These are Pi-native provider/turn boundaries. Python retains an abort
	// watchdog only as a compatibility fallback for older Pi versions; the
	// current API lets us stop before the next request and cap remaining output
	// tokens in the outgoing provider payload.
	if (process.env.PI_AUTORESEARCH_VARIANT === "restricted-expression-diagnostic") {
		const maxTurns = Math.max(1, Number(process.env.PI_DIAGNOSTIC_MAX_TURNS ?? "0") || 1);
		const maxOutputTokens = Math.max(1, Number(process.env.PI_DIAGNOSTIC_MAX_OUTPUT_TOKENS ?? "0") || 1);
		const deadlineMs = Number(process.env.PI_DIAGNOSTIC_DEADLINE_MS ?? "0") || 0;
		let turns = 0;
		let outputTokens = 0;
		const budgetEvent = (reason?: string) => append("diagnostic-native-budget.jsonl", {
			format: "restricted-expression-native-budget-v1", turns, output_tokens: outputTokens,
			max_turns: maxTurns, max_output_tokens: maxOutputTokens,
			...(reason ? { stop_reason: reason } : {}), recordedAt: new Date().toISOString(),
		});
		const stopIfNeeded = (ctx: { abort: () => void }) => {
			if (deadlineMs > 0 && Date.now() >= deadlineMs) {
				budgetEvent("total_wall_deadline_exceeded");
				ctx.abort();
				return true;
			}
			if (turns >= maxTurns) {
				budgetEvent("max_turns_exceeded");
				ctx.abort();
				return true;
			}
			if (outputTokens >= maxOutputTokens) {
				budgetEvent("max_output_tokens_exceeded");
				ctx.abort();
				return true;
			}
			return false;
		};
		pi.on("before_provider_request", (event, ctx) => {
			if (stopIfNeeded(ctx)) return event.payload;
			const remaining = Math.max(1, maxOutputTokens - outputTokens);
			const payload = { ...(event.payload as Record<string, unknown>) };
			if (typeof payload.max_tokens === "number") payload.max_tokens = Math.min(payload.max_tokens, remaining);
			else if (typeof payload.max_completion_tokens === "number") payload.max_completion_tokens = Math.min(payload.max_completion_tokens, remaining);
			else payload.max_tokens = remaining;
			append("diagnostic-provider-payloads.jsonl", {
				format: "restricted-expression-provider-payload-v1", remaining,
				max_tokens: payload.max_tokens, max_completion_tokens: payload.max_completion_tokens,
				recordedAt: new Date().toISOString(),
			});
			return payload;
		});
		pi.on("turn_end", (event, ctx) => {
			turns += 1;
			const message = event.message as { role?: string; usage?: { output?: number; output_tokens?: number } } | undefined;
			if (message?.role === "assistant") {
				const usage = message.usage;
				const value = usage?.output ?? usage?.output_tokens;
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) outputTokens += value;
			}
			budgetEvent();
			stopIfNeeded(ctx);
		});
	}
	const deniedAdapter: TaskToolAdapter = {
		adapterId: "restricted-expression-diagnostic-no-adapter",
		permission: "no_adapter_implementations",
		allowedImplementations: [],
		execute: async () => {
			throw new Error("diagnostic bootstrap has no adapter implementations");
		},
	};

	// The resource reader and self-harness are the existing native boundaries.
	// This bootstrap adds no Tool, AST, parser, resolver, or alternate executor.
	installTaskResourceReader(pi, root);
	const dependencies: SelfHarnessDependencies = {
		root,
		append,
		readJsonl: (name) => readJsonl(root, name),
		allocateDecisionId: () => `decision-${++decisionCounter}`,
		getObservation: (id) => readJsonl(root, "execution-observations.jsonl")
			.find((row) => String(row.observation_id ?? "") === id),
		pendingAssessments: new Map(),
		resolveBasisRefs: (references) => references,
		taskToolAdapter: deniedAdapter,
	};
	installTaskLocalSelfHarness(pi, dependencies);
}
