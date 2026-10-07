/** Read-only, event-addressed tool/provider cost index for ARC outcome windows. */
import { createHash } from "node:crypto";

type Row = Record<string, any>;

function countCalls(calls: Row[]): { tool_counts: Record<string, number>; arc_actions: number } {
	const tool_counts: Record<string, number> = {};
	for (const call of calls) tool_counts[String(call.tool_name ?? "unknown")] = (tool_counts[String(call.tool_name ?? "unknown")] ?? 0) + 1;
	return { tool_counts, arc_actions: tool_counts.arc_action ?? 0 };
}

function timeValue(value: unknown): number | undefined {
	const time = Date.parse(String(value ?? ""));
	return Number.isFinite(time) ? time : undefined;
}

/** The input event array is in persisted JSONL order; ordinal is the stable address. */
export function buildOutcomeCostIndex(window: Row, allWindows: Row[], events: Row[], observations: Row[]): Row {
	const indexed = events.map((event, index) => ({ ...event, source_event_index: index + 1 }));
	const boundaryObservation = observations.find(row => row.observation_id === window.boundary_ref);
	const boundaryCallId = String(window.boundary_tool_call_id ?? boundaryObservation?.toolCallId ?? "");
	const chooseBoundaryEnd = (item: Row | undefined) => {
		if (!item) return undefined;
		const observation = observations.find(row => row.observation_id === item.boundary_ref);
		const callId = String(item.boundary_tool_call_id ?? observation?.toolCallId ?? "");
		const candidates = indexed.filter(event => event.type === "tool_execution_end" && event.toolName === "arc_action"
			&& String(event.toolCallId ?? "") === callId);
		if (candidates.length <= 1) return candidates[0];
		const observedAt = timeValue(observation?.recordedAt);
		if (observedAt === undefined) return undefined;
		const timed = candidates.map(event => ({ event, at: timeValue(event.recordedAt) })).filter(item => item.at !== undefined) as {event:Row;at:number}[];
		if (timed.length !== candidates.length) return undefined;
		timed.sort((a, b) => Math.abs(a.at - observedAt) - Math.abs(b.at - observedAt));
		if (timed.length > 1 && Math.abs(timed[0].at - observedAt) === Math.abs(timed[1].at - observedAt)) return undefined;
		return timed[0].event;
	};
	const boundaryEnd = chooseBoundaryEnd(window);
	const boundaryIndex = boundaryEnd?.source_event_index as number | undefined;
	const windowPosition = allWindows.findIndex(item => item.window_id === window.window_id);
	const previousBoundary = windowPosition > 0 ? allWindows[windowPosition - 1] : undefined;
	const previousSuccess = allWindows.slice(0, Math.max(0, windowPosition)).reverse()
		.find(item => item.reasons?.includes("level_success"));
	const eventEndFor = (item?: Row): number | undefined => chooseBoundaryEnd(item)?.source_event_index;
	const previousBoundaryIndex = eventEndFor(previousBoundary);
	const levelStartIndex = eventEndFor(previousSuccess);
	const startCutoff = levelStartIndex ?? 0;
	const boundaryOrdinal = boundaryIndex ?? indexed.length;
	const starts = new Map<string, Row[]>();
	const calls: Row[] = [];
	const gaps: string[] = [];
	const windowEvidence = new Set(Array.isArray(window.evidence_refs) ? window.evidence_refs : []);
	for (const event of indexed) {
		if (!String(event.toolCallId ?? "")) continue;
		const id = String(event.toolCallId);
		if (event.type === "tool_execution_start") {
			const list = starts.get(id) ?? [];
			list.push(event);
			starts.set(id, list);
			continue;
		}
		if (event.type !== "tool_execution_end") continue;
		const startList = starts.get(id) ?? [];
		const start = startList.pop();
		starts.set(id, startList);
		const isWhole = event.source_event_index > startCutoff && event.source_event_index <= boundaryOrdinal;
		if (!isWhole) continue;
		if (start && start.source_event_index <= startCutoff) {
			gaps.push(`cross_boundary_call:${start.source_event_index}:${event.source_event_index}:${id}`);
			continue;
		}
		if (!start) gaps.push(`missing_start:${event.source_event_index}:${id}`);
		const matchingObservations = observations.filter(row => windowEvidence.has(row.observation_id)
			&& String(row.toolCallId ?? "") === id);
		const refs = matchingObservations.length === 1 ? [matchingObservations[0].observation_id] : [];
		if (matchingObservations.length > 1) gaps.push(`ambiguous_observation_join:${id}`);
		const startAt = timeValue(start?.recordedAt);
		const endAt = timeValue(event.recordedAt);
		const call = {
			call_ref: `tool_call:${start?.source_event_index ?? event.source_event_index}:${id}`,
			tool_call_id: id,
			source_event_start: start?.source_event_index ?? null,
			source_event_end: event.source_event_index,
			tool_name: event.toolName ?? start?.toolName ?? "unknown",
			actor: "parent",
			observation_refs: refs,
			result: event.isError === true ? "error" : "success",
			...(startAt !== undefined && endAt !== undefined ? { elapsed_ms: Math.max(0, endAt - startAt), measurement_basis: "event_time" }
				: { elapsed_ms: null, measurement_basis: "unknown" }),
		};
		calls.push(call);
	}
	for (const [id, pending] of starts) for (const start of pending) {
		if (start.source_event_index > startCutoff && start.source_event_index <= boundaryOrdinal) {
			calls.push({ call_ref: `tool_call:${start.source_event_index}:${id}`, tool_call_id: id,
				source_event_start: start.source_event_index, source_event_end: null,
				tool_name: start.toolName ?? "unknown", actor: "parent", observation_refs: [], result: "incomplete",
				elapsed_ms: null, measurement_basis: "unknown" });
			gaps.push(`incomplete:${start.source_event_index}:${id}`);
		}
	}
	const incrementalBoundaryUnknown = Boolean(previousBoundary) && previousBoundaryIndex === undefined;
	const sinceCalls = incrementalBoundaryUnknown ? [] : previousBoundaryIndex === undefined ? calls
		: calls.filter(call => Number(call.source_event_end ?? call.source_event_start) > previousBoundaryIndex);
	const scopedProvider = indexed.filter(event => event.type === "message_end"
		&& event.source_event_index > startCutoff && event.source_event_index <= boundaryOrdinal);
	const numeric = (message: Row, ...keys: string[]) => {
		for (const key of keys) if (Number.isFinite(Number(message?.[key]))) return Number(message[key]);
		return undefined;
	};
	const aggregateUsage = (messages: Row[], keyNames: string[][]) => keyNames.map(keys => {
		const found = messages.map(event => numeric(event.message?.usage ?? {}, ...keys)).filter((value): value is number => value !== undefined);
		return found.length ? found.reduce((sum, value) => sum + value, 0) : undefined;
	});
	const [inputTokens, outputTokens, totalTokens] = aggregateUsage(scopedProvider, [
		["input", "input_tokens"], ["output", "output_tokens"], ["totalTokens", "total_tokens"],
	]);
	const anyUsage = inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined;
	const completeUsage = scopedProvider.length > 0 && scopedProvider.every(event => {
		const usage = event.message?.usage;
		return usage && (Number.isFinite(Number(usage.input ?? usage.input_tokens))
			|| Number.isFinite(Number(usage.output ?? usage.output_tokens))
			|| Number.isFinite(Number(usage.totalTokens ?? usage.total_tokens)));
	});
	const sourceTimeUnknown = indexed.some(event => event.source_event_index <= boundaryOrdinal && !event.recordedAt);
	const coverage = boundaryIndex === undefined || gaps.length || sourceTimeUnknown || incrementalBoundaryUnknown ? "partial" : "complete";
	return {
		format: "task-outcome-cost-index-v1", version: 1, window_id: window.window_id,
		boundary_ref: window.boundary_ref, ...(boundaryCallId ? { boundary_tool_call_id: boundaryCallId,
			boundary_call_ref: calls.find(call => call.source_event_end === boundaryIndex)?.call_ref } : {}),
		source_cutoff_event: boundaryOrdinal,
		source_hashes: {
			pi_events: createHash("sha256").update(JSON.stringify(indexed.slice(0, boundaryOrdinal))).digest("hex"),
			observations: createHash("sha256").update(JSON.stringify(observations.filter(row => window.evidence_refs?.includes(row.observation_id)))).digest("hex"),
		},
		coverage,
		gaps: [...new Set([...(boundaryIndex === undefined ? ["boundary_tool_event_unavailable_or_ambiguous"] : []), ...gaps,
			...(incrementalBoundaryUnknown ? ["previous_boundary_tool_event_unavailable_or_ambiguous"] : []),
			...(sourceTimeUnknown ? ["event_time_unavailable"] : [])])],
		calls,
		tool_call_refs: calls.map(call => call.call_ref),
		whole_level: countCalls(calls),
		since_previous_boundary: incrementalBoundaryUnknown ? null : countCalls(sinceCalls),
		provider_cost: {
			request_count: scopedProvider.length || null,
			input_tokens: inputTokens ?? null,
			output_tokens: outputTokens ?? null,
			total_tokens: totalTokens ?? null,
			elapsed_ms: null,
			attribution: scopedProvider.length ? "window_only" : "unknown",
			token_status: !scopedProvider.length ? "unknown" : !anyUsage ? "provider_usage_missing"
				: completeUsage ? "provider_reported" : "provider_reported_partial",
		},
	};
}
