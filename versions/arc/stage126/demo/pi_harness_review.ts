/** Task-local review records and read-only lifecycle projections. */
type Row = Record<string, any>;
import { loadPrompt } from "./prompt_loader.ts";
import { buildPeriodicResearchHandoff } from "./pi_auto_research_handoff.ts";
import { controlError } from "./pi_harness_control.ts";
export const REVIEW_COMPONENTS = ["memory", "task_prompt", "system_prompt", "skill", "tool", "subagent"] as const;
export const REVIEW_DISPOSITIONS = ["create", "update", "reuse", "defer", "not_applicable"] as const;

function reviewComponent(raw: Row): string {
	const explicit = String(raw?.component ?? "").trim();
	if (explicit) return explicit;
	const candidate = raw?.candidate && typeof raw.candidate === "object" ? raw.candidate : {};
	const alias = String(candidate.semantic_kind ?? candidate.component ?? candidate.kind ?? candidate.type ?? "").trim().toLowerCase();
	if (["fact", "task_state", "memory", "task_memory"].includes(alias)) return "memory";
	if (["plan", "policy", "task_prompt"].includes(alias)) return "task_prompt";
	if (["procedure", "skill", "task_skill"].includes(alias)) return "skill";
	if (["computation", "tool", "task_tool"].includes(alias)) return "tool";
	if (["role", "subagent", "task_subagent"].includes(alias)) return "subagent";
	if (candidate.prompt_channel === "system_prompt") return "system_prompt";
	return "";
}

export function reviewInputContract(window?: Row) {
	return { components: REVIEW_COMPONENTS, dispositions: REVIEW_DISPOSITIONS,
		rules: ["Omit opportunity_id to bind the unique pending opportunity; never invent IDs.",
			"Optional development_intent names one parent-authored operation and purpose independently of component carrier decisions. Carrier reuse or deferral never resolves a different open planning gap; update its status explicitly through capability_review.",
			"Submit only components with an opinion; an omitted component remains a runtime-default unresolved placeholder, not a parent decision.",
			"Each submitted entry requires component, disposition and a nonempty reason.",
			"For skill/tool/subagent create/update, first read its fixed creator; put the returned authoring_method_ref inside each candidate, not at the top level of review. Creator preflight failure leaves the opportunity available for corrected retry.",
			"create/update requires next_use and validation, either on entry or every pattern. Include a complete structured candidate to apply it in this same review call; otherwise runtime records a candidate-body gap without inventing content.",
			"A validation string is a proposed check, not proof of successful validation.",
			"Skill candidates require creator-authored instructions/content and a description of when to use them. Nested method metadata is optional, not an admission prerequisite. If supplied, list fields accept an authored string or an array of strings, not objects. A single-situation untested procedure is valid; examples and task parameters are allowed. A method object alone is not a loadable skill body.",
			"Memory candidates authored through formal change/review require a stable key (or name), atom={subject,predicate,value}, and validity.scope=task|episode|level|state. For ordinary in-progress notes, hypotheses, plans and retrospectives, use task_memory_pool(action=capture): it accepts free-form parent-authored content, binds current scope, and does not require a conversion intent or review. Keep the same key plus exact current target_version when revising; pool membership never implies assembly selection.",
			"Use current-window evidence plus existing historical evidence for comparison; do not invent observations.",
			"Prefer one review entry per component. Compatible pure reuse entries for the same component are merged without changing their refs, reasons or next uses. Mixed dispositions and duplicate create/update bodies remain invalid. To create multiple complete resources of one type, use one task_harness(action=change, changes=[...]) call, then record one review reuse entry containing all exact created resource_refs.",
			"Each pattern must contain pattern, evidence_refs, applicability, counterexamples, candidate, next_use and validation; pattern is the one-sentence reusable rule and candidate is the proposed body."],
		pattern_template: {
			pattern: "<one-sentence reusable rule>", evidence_refs: window?.evidence_refs ?? ["execution-observation-N"],
			applicability: "<where this applies>", counterexamples: "<known limits or none observed>",
			candidate: "<proposed method or resource body>", next_use: "<next use>", validation: "<semantic check>",
		},
		repair_template: {action:"review", review:[], ...(window ? {transition_analysis:{
			observed_changes:"<observed delta/invariants>", predictive_rules:"<hypothesis and limits, or unknown>",
			limiting_uncertainty:"<uncertainty>", next_experiment:"<probe and alternatives, or why none>",
			capability_opportunities:"<method opportunity, or unknown>", evidence_refs:window.evidence_refs,
		}} : {})} };
}

function explicitReviewBasisRefs(entry: Row): string[] {
	return [
		...(Array.isArray(entry?.basis_refs) ? entry.basis_refs : []),
		...(Array.isArray(entry?.evidence_refs) ? entry.evidence_refs : []),
		...(Array.isArray(entry?.candidate?.basis_refs) ? entry.candidate.basis_refs : []),
		...(Array.isArray(entry?.patterns)
			? entry.patterns.flatMap((pattern: Row) => Array.isArray(pattern?.evidence_refs) ? pattern.evidence_refs : [])
			: []),
	].filter((ref): ref is string => typeof ref === "string" && Boolean(ref.trim()));
}

/** Error recovery needs current fields, not a repeated static authoring manual. */
export function reviewRepairContract(window?: Row) {
	return {
		required_next_call:{tool:"task_harness",arguments:{action:"inspect",section:"review_contract"}},
		repair_template:reviewInputContract(window).repair_template,
	};
}

/** Preserve complete same-type candidates without making duplicate review entries valid. */
export function duplicateReviewDirectChangeFallback(entries: Row[], additionalBasisRefs: unknown[] = []): Row | undefined {
	if (!Array.isArray(entries)) return undefined;
	const components = entries.map(reviewComponent);
	const counts = new Map<string, number>();
	for (const component of components) if (REVIEW_COMPONENTS.includes(component as any))
		counts.set(component, Number(counts.get(component) ?? 0) + 1);
	const duplicateComponents = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([component]) => component));
	const selected = entries.map((entry, reviewIndex) => ({entry, reviewIndex, component:components[reviewIndex]}))
		.filter(({entry, component}) => duplicateComponents.has(component)
			&& ["create", "update"].includes(String(entry?.disposition))
			&& entry?.candidate && typeof entry.candidate === "object" && !Array.isArray(entry.candidate));
	if (!selected.length) return undefined;
	const basisRefs = [...new Set([
		...additionalBasisRefs.filter((ref): ref is string => typeof ref === "string" && Boolean(ref.trim())),
		...selected.flatMap(({entry}) => explicitReviewBasisRefs(entry)),
	])];
	const sourceFields = ["component", "disposition", "reason", "next_use", "validation", "patterns", "resource_refs", "basis_refs", "target_ref"];
	return {
		action:"change",
		changes:selected.map(({entry}) => ({operation:entry.disposition,candidate:entry.candidate})),
		decision:{
			basis_refs:basisRefs,
			reason:"<main must reconfirm why these independently selectable resources remain useful now>",
			expected:"<main must state the observable result expected at their next uses>",
		},
		source_entries:selected.map(({entry, reviewIndex, component}) => ({
			review_index:reviewIndex,
			...Object.fromEntries(sourceFields.filter(field => entry[field] !== undefined).map(field => [field, entry[field]])),
			component,
		})),
		current_applicability_required:true,
		followup_review:{
			action:"review",
			review:[...duplicateComponents].map(component => ({
				component, disposition:"reuse",
				reason:"<main must state why the exact created resources remain the review decision>",
				resource_refs:["<replace with every exact created resource_ref for this component>"],
			})),
			instruction:"After the direct change succeeds, submit one reuse entry per component containing every exact created resource_ref.",
		},
		instruction:"The duplicate review was rejected and runtime wrote none of these candidates. Reconfirm current applicability, replace the decision placeholders, and submit this complete template through task_harness(action=change). Runtime will not apply it automatically or extend the review window.",
	};
}

export function normalizeHarnessReview(entries: Row[], knownRefs: Set<string>, collectedErrors?: Row[]): Row[] {
	const errors: Row[] = [];
	const byComponent = new Map<string, Row>();
	const pureReuse = (entry: Row) => entry?.disposition === "reuse"
		&& Object.keys(entry).every(key => ["component", "disposition", "reason", "next_use", "resource_refs", "evidence_refs"].includes(key))
		&& (entry.resource_refs === undefined || Array.isArray(entry.resource_refs))
		&& (entry.evidence_refs === undefined || Array.isArray(entry.evidence_refs));
	const joined = (left: unknown, right: unknown) => [left, right].map(value => String(value ?? "")).filter(value => value.trim()).join("\n");
	if (!Array.isArray(entries)) controlError("invalid_review", [{path:"review",message:"Expected an array"}], reviewRepairContract());
	for (const [index, raw] of entries.entries()) {
		const path = `review[${index}]`;
		const entry = {...raw, component:reviewComponent(raw), disposition:raw?.disposition === "keep" ? "reuse" : raw?.disposition};
		if (Array.isArray(entry.patterns)) {
			entry.patterns = entry.patterns.map((pattern: Row) => pattern?.pattern?.trim()
				? pattern
				: pattern?.candidate?.trim()
					? {...pattern, pattern: pattern.candidate}
					: pattern);
		}
		if (!REVIEW_COMPONENTS.includes(entry.component)) errors.push({path:`${path}.component`,message:"Unknown component",allowed:REVIEW_COMPONENTS});
		else if (byComponent.has(entry.component) && !(pureReuse(byComponent.get(entry.component)) && pureReuse(entry)))
			errors.push({path:`${path}.component`,message:"Duplicate component: only compatible pure reuse entries may merge; use direct change for multiple complete resources of one type",allowed:REVIEW_COMPONENTS});
		if (!REVIEW_DISPOSITIONS.includes(entry.disposition)) errors.push({path:`${path}.disposition`,message:"Invalid review disposition",allowed:REVIEW_DISPOSITIONS});
		if (!String(entry.reason ?? "").trim()) errors.push({path:`${path}.reason`,message:"A semantic reason is required"});
		if (entry.candidate && typeof entry.candidate === "object" && !Array.isArray(entry.candidate)) {
			if (raw?.component !== undefined && entry.candidate.component !== undefined
				&& String(raw.component) !== String(entry.candidate.component))
				errors.push({path:`${path}.candidate.component`,message:"Candidate component conflicts with review component; correct the nested candidate or the review entry"});
			for (const field of ["target_version", "prompt_target_version"]) {
				if (raw?.[field] !== undefined && entry.candidate[field] !== undefined
					&& String(raw[field]) !== String(entry.candidate[field]))
					errors.push({path:`${path}.candidate.${field}`,message:`Candidate ${field} conflicts with review ${field}; submit one exact version`});
			}
		}
		for (const ref of entry.resource_refs ?? []) if (!knownRefs.has(ref)) errors.push({path:`${path}.resource_refs`,message:`Unknown resource reference: ${ref}`});
		if (["create","update"].includes(entry.disposition)) for (const field of ["next_use","validation"]) {
			const patterns = entry.patterns ?? [];
			if (!String(entry[field] ?? "").trim() && patterns.length && patterns.every((p:Row) => String(p[field] ?? "").trim()))
				entry[field] = [...new Set(patterns.map((p:Row) => p[field]))].join("\n");
			if (!String(entry[field] ?? "").trim()) errors.push({path:`${path}.${field}`,message:"Candidates require next_use and semantic validation; provide content, not a placeholder"});
		}
		const previous = byComponent.get(entry.component);
		byComponent.set(entry.component, previous && pureReuse(previous) && pureReuse(entry)
			? { ...previous, reason: joined(previous.reason, entry.reason), next_use: joined(previous.next_use, entry.next_use),
				resource_refs: [...new Set([...(previous.resource_refs ?? []), ...(entry.resource_refs ?? [])])],
				...(previous.evidence_refs || entry.evidence_refs ? {
					evidence_refs: [...new Set([...(previous.evidence_refs ?? []), ...(entry.evidence_refs ?? [])])],
				} : {}) }
			: entry);
	}
	if (errors.length) {
		if (collectedErrors) collectedErrors.push(...errors);
		else {
			const directChangeFallback = duplicateReviewDirectChangeFallback(entries);
			controlError("invalid_review", errors, {...reviewRepairContract(), ...(directChangeFallback ? {direct_change_fallback:directChangeFallback} : {})});
		}
	}
	return REVIEW_COMPONENTS.map(component => byComponent.get(component) ?? {component, disposition:"defer",
		reason:"No parent judgment submitted for this component; it remains unresolved.",source:"runtime_default"});
}

/** One canonical receipt per environment action, including batches and delegated actions. */
export function successfulArcActions(observations: Row[]): Row[] {
	const seen = new Set<string>();
	return observations.filter(e => {
		if (e.tool_name !== "arc_action" || e.is_error) return false;
		const totalUsed = Number(e.arc_outcome?.action_budget?.total_used);
		const id = Number.isInteger(totalUsed) && totalUsed > 0
			? `native-action-${totalUsed}` : e.observation_id ?? e.toolCallId;
		if (!id || seen.has(id)) return false;
		seen.add(id); return true;
	});
}

/** Successful environment actions only; reads, reviews and failed calls do not tick. */
export function periodicReviewWindows(observations: Row[]) {
	const actions = successfulArcActions(observations);
	const windows: Row[] = [];
	for (let end = 5; end <= actions.length; end += 5) {
		const full = end % 20 === 0;
		const start = end - (full ? 20 : 5);
		const slice = actions.slice(start, end);
		const first = observations.indexOf(slice[0]);
		const last = observations.indexOf(slice.at(-1)!);
		const previousAction = start ? actions[start - 1] : undefined;
		const from = previousAction ? observations.indexOf(previousAction) + 1 : 0;
		windows.push({ window_id: `arc-pattern-${end}`, mode: full ? "consolidation" : "incremental",
			start_step: start + 1, end_step: end,
			action_refs: slice.map(e => e.observation_id),
			baseline_ref: previousAction?.observation_id ?? observations.slice(0, first).findLast(e => e.tool_name === "arc_state")?.observation_id ?? null,
			evidence_refs: observations.slice(from, last + 1).map(e => e.observation_id),
		});
	}
	return windows;
}

/** Latest evidence gets the current slot; old decisions and explicit deferrals stay recoverable. */
export function periodicReviewQueue(observations: Row[], reviews: Row[], events: Row[]) {
	const actionCount = successfulArcActions(observations).length;
	const reviewed = new Set(reviews.map(r => r.window_id));
	const latest = new Map<string, Row>();
	for (const event of events) if (event.window_id) latest.set(event.window_id, event);
	const due: Row[] = [], deferred: Row[] = [];
	for (const window of periodicReviewWindows(observations)) {
		const event = latest.get(window.window_id);
		if (reviewed.has(window.window_id) || event?.status === "failed") continue;
		if (event?.status === "deferred" && (event.resume_condition?.kind === "manual"
			|| actionCount < Number(event.resume_after_action_count))) {
			deferred.push({ ...window, parent_reason: event.parent_reason,
				resume_after_action_count: event.resume_after_action_count });
		} else due.push({ ...window, ...(event?.status === "deferred" ? { resumed_from: event } : {}) });
	}
	return { action_count: actionCount, current: due.at(-1), due, deferred };
}

/** Identity-preserving index; queuing is never analysis or semantic consolidation. */
export function periodicReviewBatch(queue: ReturnType<typeof periodicReviewQueue>) {
	return { analyzed: false, action_count: queue.action_count,
		windows: queue.due.map(window => ({ window_id: window.window_id,
			start_step: window.start_step, end_step: window.end_step, mode: window.mode,
			evidence_count: window.evidence_refs.length })),
		evidence_count: new Set(queue.due.flatMap(window => window.evidence_refs)).size,
		deferred_count: queue.deferred.length };
}

export function reviewProgress(signals: Row[]) {
	const progress = signals.filter(e => e.layer === "task_progress");
	const lastAdvance = progress.findLastIndex(e => e.outcome === "advanced");
	const unchanged = progress.slice(lastAdvance + 1).filter(e => e.outcome === "not_advanced").length;
	return {
		last_advance: lastAdvance < 0 ? null : progress[lastAdvance].signal_id,
		// A review cue, not evidence that exploration failed. Exponential buckets
		// bound reminder cost during long stretches without public progress.
		no_progress_bucket: unchanged < 8 ? 0 : Math.floor(Math.log2(unchanged)) - 2,
	};
}

export function validateHarnessReview(entries: Row[], knownRefs: Set<string>) {
	if (entries.length !== REVIEW_COMPONENTS.length) throw new Error("Review every component once; defer is valid when evidence is missing");
	const seen = new Set<string>();
	for (const entry of entries) {
		if (!REVIEW_COMPONENTS.includes(entry.component) || seen.has(entry.component)) throw new Error("Unknown or duplicate review component");
		seen.add(entry.component);
		if (!["create", "update", "reuse", "defer", "not_applicable"].includes(entry.disposition)) throw new Error("Invalid review disposition");
		if (!entry.reason?.trim()) throw new Error("Review reason is required");
		for (const ref of entry.resource_refs ?? []) if (!knownRefs.has(ref)) throw new Error(`Unknown resource reference: ${ref}`);
		if (["create", "update"].includes(entry.disposition) && (!entry.next_use?.trim() || !entry.validation?.trim())) throw new Error("Candidates require next_use and semantic validation");
	}
	return entries;
}

export function methodResearchContract(entries: Row[], researchHandoff?: Row) {
	return {
		induction_guidance: loadPrompt("state_transition_induction.md"),
		goal: "Investigate a grounded solving bottleneck with an attainable intermediate objective and local evaluation. Use accessible cross-phase evidence and relevant prior knowledge to construct and test methods, distinguishing facts, conditional guidance, judgment procedures, executable computations and continuing roles.",
		candidates: entries.filter(e => ["create", "update"].includes(e.disposition)),
		completion_contract: "Assess one bounded objective against its local stage/input and observable success/failure criterion; report expected versus actual output or the missing test. Return a supported method/delivery with next use and reconsideration conditions, or an explicit evidence/capability gap. Respect the cost/stop bound; never approve untested claims as validated or equate a local check with task-level benefit.",
		required_material: ["concrete starting conditions and task/artifact/trajectory references", "relevant cross-phase contrasts and counterexamples when available", "existing exact resource versions when relevant", "authorized evidence/computation access and feasible parent probes", "attainable intermediate objective and next use", "reachable local stage/input, expected observable output, success/failure criterion, executor and cost/stop bound"],
		starts_research: false,
		requires_parent_research_disposition: Boolean(researchHandoff),
		...(researchHandoff ? {
			research_handoff_ref: researchHandoff.ready_call.research_handoff_ref,
			interaction_mode_policy: researchHandoff.interaction_mode_policy,
			ready_auto_research_calls: researchHandoff.ready_calls,
		} : {}),
	};
}

export { buildPeriodicResearchHandoff };

export function validateTransitionAnalysis(value: Row | undefined, allowedRefs: Set<string>, historicalRefs?: Set<string>) {
	const errors: Row[] = [];
	if (!value) controlError("invalid_review",[{path:"transition_analysis",message:"Periodic extraction requires transition_analysis; explicit unknowns are valid"}],reviewRepairContract({evidence_refs:[...allowedRefs]}));
	for (const key of ["observed_changes", "predictive_rules", "limiting_uncertainty", "next_experiment", "capability_opportunities"]) {
		if (typeof value[key] !== "string" || !value[key].trim()) errors.push({path:`transition_analysis.${key}`,message:"Required nonempty semantic content; explicit unknown is valid"});
	}
	if (value.research_kind !== undefined && !["mechanism", "representation", "capability", "composition", "exploration", "planning", "solution", "recovery"].includes(String(value.research_kind))) {
		errors.push({path:"transition_analysis.research_kind",message:"research_kind must identify a supported task-level research object"});
	}
	const refs = [...new Set([...(value.evidence_refs ?? []), ...(value.window_evidence_refs ?? []), ...(value.historical_evidence_refs ?? [])])];
	// Models may repeat a current-window ref in historical_evidence_refs when
	// they provide both views. Treat the current window as authoritative and
	// normalize the overlap away; reject only refs that are neither current nor
	// known historical evidence.
	if (!refs.length || !refs.some(ref => allowedRefs.has(ref)) || refs.some(ref => !allowedRefs.has(ref) && !historicalRefs?.has(ref))
		|| (value.window_evidence_refs ?? []).some((ref:string) => !allowedRefs.has(ref))
		|| (value.historical_evidence_refs ?? []).some((ref:string) => !historicalRefs?.has(ref) && !allowedRefs.has(ref))) {
		errors.push({path:"transition_analysis.evidence_refs",message:"transition_analysis requires actual window evidence references; all other references must be existing historical observations",allowed_window_refs:[...allowedRefs]});
	}
	if (errors.length) controlError("invalid_review",errors,reviewRepairContract({evidence_refs:[...allowedRefs]}));
	return historicalRefs ? {...value, evidence_refs:refs, window_evidence_refs:refs.filter(ref => allowedRefs.has(ref)),
		historical_evidence_refs:refs.filter(ref => !allowedRefs.has(ref))} : value;
}

export function harnessLifecycle(read: (file: string) => Row[]) {
	const observations = read("harness-observations.jsonl");
	const assessments = read("effect-assessments.jsonl");
	const tools = read("task-tool-events.jsonl").filter(e => e.event === "invoked");
	const agents = read("subagent-invocations.jsonl");
	const skills = read("task-skill-events.jsonl");
	return [
		["memory", "task-memory.jsonl", "memory_id"],
		["system_prompt", "task-system-prompt.jsonl", "segment_id"],
		["skill", "task-skills.jsonl", "skill_id"],
		["tool", "task-tools.jsonl", "tool_id"],
		["subagent", "task-subagents.jsonl", "agent_id"],
	].flatMap(([component, file, id]) => read(file).map(resource => {
		const exposures = observations.filter(e => resource.decision_id && e.decision_id === resource.decision_id);
		const uses = component === "tool" ? tools.filter(e => e.tool_id === resource[id] && e.version === resource.version)
			: component === "subagent" ? agents.filter(e => e.agent_id === resource[id] && e.agent_version === resource.version)
			: component === "skill" ? skills.filter(e => e.skill_id === resource[id] && e.version === resource.version && e.event === "read_by_agent") : [];
		return {
			component, resource_ref: `${component}:${resource[id]}@v${resource.version}`, status: resource.status,
			decision_id: resource.decision_id, routing_id: resource.routing_id,
			source_approval_ref: resource.source_approval_ref,
			projection_requested: resource.projection?.channel ?? null,
			task_prompt_exposed: exposures.some(e => e.observation_kind === "pi_task_prompt_projection"),
			exposure_refs: exposures.map(e => e.observation_id),
			uses: uses.map(e => ({ invocation_id: e.invocation_id, status: e.status, event: e.event,
				semantic_verification: e.semantic_verification ?? null,
				output_excerpt: e.output_excerpt ?? null,
			})),
			semantic_success: "not_inferred_from_completion",
			agent_effect_assessments: assessments.filter(e => resource.decision_id && e.decision_id === resource.decision_id),
		};
	}));
}
