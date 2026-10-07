/** Cheap, causal-neutral signal classification for task execution observations. */

export type ExecutionSignal = {
	signal_id: string;
	observation_id: string;
	layer: "tool_execution" | "environment_state" | "task_progress";
	outcome: string;
	labels: string[];
	classification_method: "event_flag" | "text_heuristic" | "adapter_structured_field";
	causal_interpretation: false;
	pattern_key?: string;
	recordedAt: string;
};

type AdapterSignal = {
	layer: "environment_state" | "task_progress";
	outcome: string;
	labels: string[];
	pattern_key?: string;
};

type ExecutionObservation = {
	observation_id: string;
	is_error?: boolean;
	result_text?: string;
	recordedAt?: string;
};

const ERROR_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
	{ label: "reported_permission_error", pattern: /\b(permission denied|forbidden|unauthori[sz]ed|access denied)\b/i },
	{ label: "reported_timeout", pattern: /\b(timed? out|timeout|deadline exceeded)\b/i },
	{ label: "reported_validation_error", pattern: /\b(validation|invalid argument|schema|missing required|required propert)/i },
	{ label: "reported_not_found", pattern: /\b(not found|no such file|cannot find)\b/i },
	{ label: "reported_transport_error", pattern: /\b(connection refused|connection reset|econnrefused|econnreset|network error|http 5\d\d)\b/i },
	{ label: "reported_unavailable", pattern: /\b(unavailable|not installed|module not found)\b/i },
];

export function classifyExecutionObservation(
	observation: ExecutionObservation,
	signalId: string,
): ExecutionSignal {
	const isError = observation.is_error === true;
	const text = String(observation.result_text ?? "");
	const matched = isError
		? ERROR_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label)
		: [];
	const labels = isError ? (matched.length ? matched : ["reported_unknown_error"]) : ["tool_call_succeeded"];
	return {
		signal_id: signalId,
		observation_id: observation.observation_id,
		layer: "tool_execution",
		outcome: isError ? "error" : "success",
		labels,
		classification_method: isError && matched.length ? "text_heuristic" : "event_flag",
		causal_interpretation: false,
		recordedAt: observation.recordedAt ?? new Date().toISOString(),
	};
}

export function classifyExecutionSignals(
	observation: ExecutionObservation,
	details: unknown,
	allocateSignalId: () => string,
): ExecutionSignal[] {
	const signals = [classifyExecutionObservation(observation, allocateSignalId())];
	if (!details || typeof details !== "object") return signals;
	const declared = (details as { autoresearch_signals?: unknown }).autoresearch_signals;
	if (!Array.isArray(declared)) return signals;
	for (const item of declared) {
		if (!item || typeof item !== "object") continue;
		const value = item as Partial<AdapterSignal>;
		if (!['environment_state', 'task_progress'].includes(String(value.layer))) continue;
		if (!String(value.outcome ?? "").trim() || !Array.isArray(value.labels)) continue;
		const labels = value.labels.map(String).filter(Boolean);
		if (!labels.length) continue;
		signals.push({
			signal_id: allocateSignalId(),
			observation_id: observation.observation_id,
			layer: value.layer as AdapterSignal["layer"],
			outcome: String(value.outcome),
			labels,
			classification_method: "adapter_structured_field",
			causal_interpretation: false,
			...(String(value.pattern_key ?? "").trim() ? { pattern_key: String(value.pattern_key) } : {}),
			recordedAt: observation.recordedAt ?? new Date().toISOString(),
		});
	}
	return signals;
}

export function summarizeExecutionSignals(signals: ExecutionSignal[]): Record<string, unknown> {
	const summary: Record<string, Record<string, number>> = { labels: {} };
	for (const signal of signals) {
		if (!summary[signal.layer]) summary[signal.layer] = {};
		summary[signal.layer][signal.outcome] = (summary[signal.layer][signal.outcome] ?? 0) + 1;
		for (const label of signal.labels) summary.labels[label] = (summary.labels[label] ?? 0) + 1;
	}
	if (!summary.tool_execution) summary.tool_execution = { error: 0, success: 0 };
	else {
		summary.tool_execution.error ??= 0;
		summary.tool_execution.success ??= 0;
	}
	return summary;
}
