/** Thin pi-jev adapter for selecting exact Self-Harness component versions. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_ROUTING_ENV = "PI_AUTORESEARCH_JEV_ROUTING";
export const JEV_COMPONENT_THRESHOLD = 0.65;

export type JevRoutingMode = "disabled" | "shadow" | "active";

export type JevHarnessCandidate = {
	resource_ref: string;
	kind: "memory" | "system_prompt" | "skill" | "tool" | "subagent";
	name: string;
	description: string;
	metadata?: Record<string, unknown>;
};

export type JevHarnessRoutingReceipt = {
	format: "jev-harness-routing-v1";
	mode: JevRoutingMode;
	status: "disabled" | "empty" | "selected" | "error";
	candidate_refs: string[];
	selected_resource_refs: string[];
	probabilities: Record<string, number>;
	threshold: number;
	model?: string;
	elapsed_ms: number;
	error?: string;
};

type EvaluationRequest = {
	state: Record<string, unknown> | string;
	questions: Record<string, { type: "noul"; instructions: string }>;
};

type EvaluationResponse = {
	answers: Record<string, { value: unknown }>;
	model?: string;
	elapsedMs?: number;
};

export type JevEvaluate = (
	request: EvaluationRequest,
	signal?: AbortSignal,
) => Promise<EvaluationResponse>;

function resolveApiKey(): string | undefined {
	const environmentKey = process.env.TYPESAFE_API_KEY?.trim();
	if (environmentKey) return environmentKey;
	const secret = join(homedir(), ".pi", "agent", "secrets", "typesafe_api_key");
	if (!existsSync(secret)) return undefined;
	try { return readFileSync(secret, "utf8").trim() || undefined; }
	catch { return undefined; }
}

async function evaluateWithPiJev(request: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationResponse> {
	const key = resolveApiKey();
	if (!key) throw new Error("TypeSafe Jev is unconfigured; set TYPESAFE_API_KEY");
	const questions = Object.fromEntries(Object.entries(request.questions)
		.map(([id, question]) => [id, { type: "noul", instructions: question.instructions }]));
	const started = Date.now();
	const baseUrl = String(process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
	const http = await fetch(`${baseUrl}/v1/systemone`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ state: request.state, questions, model: "jev-latest" }),
		signal,
	});
	if (!http.ok) throw new Error(`TypeSafe Jev request failed with HTTP ${http.status}`);
	const response: any = await http.json();
	return {
		answers: Object.fromEntries(Object.entries(response.answers ?? {}).map(([id, answer]: [string, any]) => [
			id, { value: answer?.noul ?? answer?.probability ?? answer?.value ?? 0 },
		])),
		model: response.model ?? "jev-latest",
		elapsedMs: Date.now() - started,
	};
}

export function jevRoutingMode(environment: NodeJS.ProcessEnv = process.env): JevRoutingMode {
	const raw = String(environment[JEV_ROUTING_ENV] ?? "disabled").trim().toLowerCase();
	if (raw === "disabled" || raw === "shadow" || raw === "active") return raw;
	throw new Error(`${JEV_ROUTING_ENV} must be disabled, shadow, or active; got ${JSON.stringify(raw)}`);
}

function compactError(error: unknown): string {
	const value = error instanceof Error ? error.message : String(error);
	return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function routingStateFromMessages(messages: readonly any[], limit = 12_000): string {
	const rows = messages.slice(-16).map(message => {
		const content = Array.isArray(message?.content)
			? message.content.map((part: any) => part?.text ?? part?.content ?? "").join(" ")
			: String(message?.content ?? "");
		return `${String(message?.role ?? "unknown")}: ${content}`.trim();
	});
	return rows.join("\n").slice(-limit);
}

export async function routeHarnessComponents(options: {
	mode: JevRoutingMode;
	state: Record<string, unknown> | string;
	candidates: JevHarnessCandidate[];
	signal?: AbortSignal;
	evaluate?: JevEvaluate;
}): Promise<JevHarnessRoutingReceipt> {
	const started = Date.now();
	const candidateRefs = options.candidates.map(candidate => candidate.resource_ref);
	const base = {
		format: "jev-harness-routing-v1" as const,
		mode: options.mode,
		candidate_refs: candidateRefs,
		selected_resource_refs: [] as string[],
		probabilities: {} as Record<string, number>,
		threshold: JEV_COMPONENT_THRESHOLD,
	};
	if (options.mode === "disabled") {
		return { ...base, status: "disabled", elapsed_ms: Date.now() - started };
	}
	if (!options.candidates.length) {
		return { ...base, status: "empty", elapsed_ms: Date.now() - started };
	}
	const questions = Object.fromEntries(options.candidates.map((candidate, index) => [
		`component_${index}`,
		{
			type: "noul" as const,
			instructions: `Should exact Harness component ${candidate.resource_ref} be active for the current agent decision? Select it only when its declared capability or knowledge directly helps now. Kind=${candidate.kind}; name=${candidate.name}; description=${candidate.description}`,
		},
	]));
	try {
		const response = await (options.evaluate ?? evaluateWithPiJev)({
			state: {
				current_agent_state: options.state,
				components: options.candidates,
				selection_rule: "Evaluate every candidate independently. Multiple components or no components may be selected.",
			},
			questions,
		}, options.signal);
		const probabilities: Record<string, number> = {};
		const selected: string[] = [];
		for (const [index, candidate] of options.candidates.entries()) {
			const raw = response.answers[`component_${index}`]?.value;
			const probability = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
			probabilities[candidate.resource_ref] = probability;
			if (probability >= JEV_COMPONENT_THRESHOLD) selected.push(candidate.resource_ref);
		}
		return {
			...base,
			status: "selected",
			selected_resource_refs: selected,
			probabilities,
			...(response.model ? { model: response.model } : {}),
			elapsed_ms: Number(response.elapsedMs ?? Date.now() - started),
		};
	} catch (error) {
		return { ...base, status: "error", elapsed_ms: Date.now() - started, error: compactError(error) };
	}
}
