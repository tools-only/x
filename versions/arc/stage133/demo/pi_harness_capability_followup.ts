/** Durable parent decisions, independent of research scheduling and review TTL. */
type Row = Record<string, any>;

export function currentDirectDevelopmentIntents(records: Row[]): Row[] {
	const latest = new Map<string, Row>();
	for (const record of records) if (record.operation_id) latest.set(String(record.operation_id), record);
	return [...latest.values()];
}

export function currentDevelopmentIntents(reviews: Row[], decisions: Row[], directRecords: Row[]): Row[] {
	const updates: {intent:Row; at:number; order:number}[] = [];
	let order = 0;
	for (const row of [...reviews, ...decisions]) {
		for (const intent of [...(row.development_intents ?? []), row.development_intent].filter(Boolean))
			if (intent.operation_id) updates.push({intent,
				// A failed review draft is recoverable proposed input, not a committed
				// status update that can reopen a resolved operation.
				at:row.status === "invalid" ? -1 : Date.parse(row.recordedAt ?? "") || 0,
				order:order++});
	}
	updates.sort((a,b) => a.at - b.at || a.order - b.order);
	const latest = new Map<string,Row>();
	for (const update of updates) latest.set(String(update.intent.operation_id), update.intent);
	// New parent intent writes from direct, creator, review and capability_review
	// share this append-only journal. Its physical order wins even within one ms;
	// historical review records without journal entries keep the timestamp fallback.
	for (const intent of directRecords) if (intent.operation_id)
		latest.set(String(intent.operation_id), intent);
	return [...latest.values()].map(({source: _source, previous_status: _previous,
		recordedAt: _recordedAt, task_id: _taskId, task_root_fingerprint: _fingerprint, ...intent}) => intent);
}

export function directDevelopmentFollowups(records: Row[], reviews: Row[] = [], decisions: Row[] = []): Row[] {
	const reviewIds = new Set<string>();
	for (const row of [...reviews, ...decisions])
		for (const intent of [...(row.development_intents ?? []), row.development_intent].filter(Boolean))
			if (intent.operation_id) reviewIds.add(String(intent.operation_id));
	return currentDevelopmentIntents(reviews, decisions, records)
		.filter(intent => !reviewIds.has(String(intent.operation_id)))
		.filter(intent => ["open", "trial_pending", "deferred"].includes(String(intent.status)))
		.map(intent => ({
			opportunity_id: `direct-development:${intent.operation_id}`,
			status: intent.status === "deferred" ? "operation_development_deferred" : "operation_development_pending",
			components: [], development_intents: [intent], carrier_candidates: [], research_required: false,
			next_call: {tool:"task_harness", arguments:{action:"development_intent",
				development_intent:{operation_id:intent.operation_id, purpose:intent.purpose,
					status:"<open|trial_pending|deferred|resolved|dropped>"}}},
			instruction: "Continue this operation through authoring, exact assembly and semantic trial while its remaining task value justifies the cost. Otherwise update the same intent: deferred with reason/reconsider_when, or dropped with a reason. Memory changes do not count as method use. No action gate or carrier quota applies.",
		}));
}

export function carrierPreparation(entries: Row[], creatorCatalog: Row[] = []) {
	const creatorNames: Record<string,string> = {skill:"skill-creator",tool:"tool-creator",subagent:"subagent-creator"};
	return entries.filter(entry => entry.component === "system_prompt" || creatorNames[entry.component]).map(entry => {
		const creator = creatorCatalog.find(item => item.name === creatorNames[entry.component]);
		return {component:entry.component, disposition:entry.disposition,
			...(creator?.read_call ? {creator_read_call:{tool:"task_harness",arguments:creator.read_call}} : {}),
			...(entry.component === "system_prompt" ? {
				change_call:{tool:"task_harness",arguments:{action:"change",changes:[{operation:"create",candidate:{component:"system_prompt",name:"<name>",content:"<parent-authored directive>",scope:"<explicit scope>"}}],decision:{basis_refs:[],reason:"<why this prompt applies>",expected:"<observable effect on a later parent turn>"}}},
				assemble_call:{tool:"task_harness",arguments:{action:"assemble",expected_assembly_revision:"<current revision>",selected_resource_refs:["<retain still-applicable exact refs>","system_prompt:<name>@v1"],prompt_contributions:[],decision:{basis_refs:["system_prompt:<name>@v1"],reason:"<why select this exact version>",expected:"<observable effect on a later parent turn>"}}},
			} : {}),
			inspect_call:{tool:"task_harness",arguments:{action:"inspect"}},
			instruction:entry.component === "system_prompt"
				? "No creator read is required. Parent chooses validity (task, episode, level, or state), authors the directive through change, then selects its exact eligible version through assemble while retaining other still-applicable selections and prompt contributions. This does not reopen or override the parent's carrier decision."
				: "This exposes a callable preparation step only. It does not reopen, override, or require changing the parent's carrier decision.",
		};
	});
}

export function capabilityFollowups(reviews: Row[], decisions: Row[], creatorCatalog: Row[] = [], directRecords: Row[] = []) {
	const globalIntents = new Map(currentDevelopmentIntents(reviews, decisions, directRecords)
		.map(intent => [String(intent.operation_id), intent]));
	return reviews.filter(r => r.transition_analysis || r.research_authoring_handoff || r.development_intent || r.development_intents?.length || decisions.some(d => d.opportunity_id === r.opportunity_id && d.development_intent)).flatMap(review => {
		const decision = decisions.findLast(d => d.opportunity_id === review.opportunity_id);
		const entries = decision?.entries ?? review.entries ?? [];
		const nominatedPrompt = entries.some((entry: Row) => entry.component === "system_prompt" && entry.source !== "runtime_default");
		const carriers = review.research_authoring_handoff
			? [review.research_authoring_handoff.recommended_component_kind]
			: review.candidate_components ?? [...(nominatedPrompt ? ["system_prompt"] : []), "skill", "tool", "subagent"];
		const unresolved = carriers.filter(component => {
			const entry = entries.find((e: Row) => e.component === component);
			return !entry || entry.source === "runtime_default" || ["create", "update"].includes(entry.disposition);
		});
		const intentById = new Map<string, Row>();
		for (const row of [review, ...decisions.filter(d => d.opportunity_id === review.opportunity_id)]) {
			for (const intent of [...(row.development_intents ?? []), row.development_intent].filter(Boolean))
				if (intent.operation_id) intentById.set(String(intent.operation_id), intent);
		}
		const openIntents = [...intentById.values()].map(intent => globalIntents.get(String(intent.operation_id)) ?? intent)
			.filter(intent => ["open", "trial_pending", "deferred"].includes(String(intent.status)));
		const activeIntents = openIntents.filter(intent => intent.status !== "deferred");
		if (!unresolved.length && !openIntents.length) return [];
		const carrierCandidates = carrierPreparation(unresolved.map(component => ({component,disposition:"unresolved"})), creatorCatalog);
		return [{ opportunity_id: review.opportunity_id, review_id: review.review_id,
			status: unresolved.length ? "awaiting_parent_capability_decision" : activeIntents.length ? "operation_development_pending" : "operation_development_deferred", components: unresolved,
			...(review.research_authoring_handoff ? { research_authoring_handoff: review.research_authoring_handoff } : {}),
			...(openIntents.length ? { development_intents: openIntents } : {}),
			carrier_candidates:carrierCandidates,
			opportunity: String(review.transition_analysis?.capability_opportunities ?? "").slice(0, 1600),
			evidence_refs: review.transition_analysis?.evidence_refs ?? [],
			research_required: false,
			next_call: { tool: "task_harness", arguments: { action: "capability_review", opportunity_id: review.opportunity_id } },
			instruction: "Decide one operation-relevant carrier at a time; unmentioned default carriers stay visibly unresolved. An explicit development_intent remains open until the parent updates its own status, independently of carrier reuse or research scheduling. For skill/tool/subagent methods read the matching creator once; a nominated system_prompt needs no creator. Author through change, then assemble exact versions and use them. Resolve carrier selection with reuse plus exact resource_refs after creation, or defer/not_applicable with an operation-specific reason. A single-situation procedure is valid; there is no category quota or action block." }];
	});
}

/** A bounded discovery surface; inspect retains the complete followup records. */
export function projectCapabilityFollowupQueue(queue: Row[]): string {
	const indexLimit = 24;
	const oldestCount = 3;
	const indexed = queue.length <= indexLimit
		? queue
		: [...queue.slice(0, oldestCount), ...queue.slice(-(indexLimit - oldestCount))];
	const index = indexed.map(entry => ({
		opportunity_id: entry.opportunity_id,
		status: entry.status,
		components: entry.components,
		...(entry.development_intents?.length ? {
			open_operation_ids: entry.development_intents.map((intent: Row) => intent.operation_id),
		} : {}),
	}));
	const withOpenIntent = queue.filter(entry => entry.development_intents?.some(
		(intent: Row) => intent.status === "open" || intent.status === "trial_pending"));
	const latestTwo = queue.slice(-2).reverse();
	const latestOpenIntent = withOpenIntent.slice().reverse().find(entry =>
		!latestTwo.some(recent => recent.opportunity_id === entry.opportunity_id));
	const detailed = [...latestTwo, ...(latestOpenIntent ? [latestOpenIntent] : []), ...queue.slice().reverse()]
		.filter((entry, position, candidates) => candidates.findIndex(candidate => candidate.opportunity_id === entry.opportunity_id) === position)
		.slice(0, 3);
	// Only intern byte-identical repeated values. Every distinct decision, ref,
	// status and template remains in this same provider message.
	const counts = new Map<string, number>();
	for (const entry of detailed) for (const value of [entry.instruction, ...(entry.carrier_candidates ?? [])]) {
		if (value === undefined) continue;
		const key = JSON.stringify(value);
		if (key.length > 160) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const shared: Row = {};
	const refs = new Map<string, string>();
	const intern = (value: any) => {
		const key = JSON.stringify(value);
		if ((counts.get(key) ?? 0) < 2) return value;
		let ref = refs.get(key);
		if (!ref) { ref = `shared_${refs.size + 1}`; refs.set(key, ref); shared[ref] = value; }
		return { shared_ref: ref };
	};
	const details = detailed.map(entry => ({ ...entry,
		...(entry.instruction !== undefined ? { instruction: intern(entry.instruction) } : {}),
		...(entry.carrier_candidates ? { carrier_candidates: entry.carrier_candidates.map(intern) } : {}),
	}));
	return `Pending parent capability decisions (${queue.length}; bounded index and recent details): ${JSON.stringify({
		index,
		omitted_index_count: queue.length - index.length,
		details,
		...(refs.size ? { shared, shared_ref_semantics: "Resolve shared_ref from shared in this message; no tool call needed." } : {}),
		full_directory_call: {tool:"task_harness", arguments:{action:"inspect"}, result_field:"capability_followups"},
	})}`;
}
