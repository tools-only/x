/** Reuse a later, published candidate body in provider history after a zero-write failure. */
type Row = Record<string, any>;

function receipt(message: Row): Row | undefined {
	const text = message?.content?.find?.((part: Row) => part?.type === "text")?.text;
	if (typeof text !== "string") return undefined;
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	} catch { return undefined; }
}

function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
		.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
	return JSON.stringify(value) ?? "undefined";
}

function candidateKey(candidate: Row): string | undefined {
	if (!candidate || typeof candidate !== "object" || typeof candidate.semantic_kind !== "string"
		|| candidate.program === undefined || candidate.input_schema === undefined
		|| candidate.output_schema === undefined || typeof candidate.authoring_method_ref !== "string") return undefined;
	return stable([candidate.semantic_kind, candidate.authoring_method_ref,
		candidate.program, candidate.input_schema, candidate.output_schema]);
}

export function supersededFailedCandidateCalls(messages: Row[]): Map<string, { successor_call_id: string; resource_ref: string }> {
	const calls = new Map<string, { index: number; candidate: Row }>();
	const failures: { id: string; index: number; key: string }[] = [];
	const successes: { id: string; index: number; key: string; resource_ref: string }[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message?.role === "assistant") for (const part of Array.isArray(message.content) ? message.content : []) {
			if (part?.name !== "task_harness_create") continue;
			const id = String(part.id ?? part.toolCallId ?? "");
			const args = part.arguments ?? part.input;
			if (id && args?.candidate) calls.set(id, { index, candidate: args.candidate });
		}
		if (message?.role !== "toolResult" || message.toolName !== "task_harness_create") continue;
		const id = String(message.toolCallId ?? "");
		const call = calls.get(id);
		const result = receipt(message);
		const key = call && candidateKey(call.candidate);
		if (!key || !result) continue;
		if (result.status === "failed" && result.no_component_written === true
			&& result.format === "task-harness-preflight-error-v1") failures.push({ id, index, key });
		if (!message.isError && result.status === "applied" && result.format === "task-harness-change-receipt-v1") {
			const applied = result.results?.find?.((row: Row) => row?.status === "applied"
				&& typeof (row.resource?.resource_ref ?? row.resource_ref) === "string");
			if (applied) successes.push({ id, index, key,
				resource_ref: applied.resource?.resource_ref ?? applied.resource_ref });
		}
	}
	const superseded = new Map<string, { successor_call_id: string; resource_ref: string }>();
	for (const failure of failures) {
		const successor = successes.find(success => success.index > failure.index && success.key === failure.key);
		if (successor) superseded.set(failure.id,
			{ successor_call_id: successor.id, resource_ref: successor.resource_ref });
	}
	return superseded;
}

export function compactSupersededCandidate(candidate: Row, successor: { successor_call_id: string; resource_ref: string }): Row {
	const marker = `[identical to later published ${successor.resource_ref}; call ${successor.successor_call_id}]`;
	return { ...candidate, program: marker, input_schema: marker, output_schema: marker };
}
