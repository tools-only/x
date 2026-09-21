/** Deterministic control contracts. These helpers never invent model conclusions. */
import { createHash } from "node:crypto";
type Row = Record<string, any>;

export function controlError(code: string, errors: Row[], extra: Row = {}): never {
	throw new Error(JSON.stringify({ format: "task-control-error-v1", code,
		failure_class: "contract_error", applied: false, retryable: true, errors,
		required_next_call: { tool: "task_harness", arguments: { action: "inspect" } }, ...extra }));
}

export function selectControlTarget(rows: Row[], field: string, reference?: unknown): Row {
	const refKinds: Record<string,[string,string]> = {handoff_id:["research_handoff_ref","research_handoff"],session_id:["session_ref","research_session"],plan_id:["plan_ref","research_plan"]};
	const refKind = refKinds[field];
	const candidates = rows.map(row => ({ [field]: row[field], ...(row.version ? {version:row.version} : {}),
		...(refKind ? {[refKind[0]]:`${refKind[1]}:${row[field]}@v${row.version}`} : {}),
		...(row.status ? {status:row.status} : {}) }));
	if (reference !== undefined && reference !== null && reference !== "") {
		const found = rows.find(row => row[field] === reference);
		if (found) return found;
		controlError("unknown_reference", [{path:field, message:"Explicit reference is unknown or not eligible"}], {candidates});
	}
	if (rows.length === 1) return rows[0];
	controlError("required_selection", [{path:field, message:rows.length ? "Select one eligible candidate" : "No eligible candidate exists"}], {candidates});
}

export function latestControlRecords(rows: Row[], field: string): Row[] {
	const latest = new Map<string, Row>();
	for (const row of rows) if (!latest.has(row[field]) || Number(row.version ?? 0) >= Number(latest.get(row[field])?.version ?? 0)) latest.set(row[field], row);
	return [...latest.values()];
}

export function stableControlJSON(value: any): string {
	const canonical = (item: any): any => Array.isArray(item) ? item.map(canonical)
		: item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
	return JSON.stringify(canonical(value));
}

export function controlOperationKey(tool: string, input: Row, task: string): string {
	const fields = ["opportunity_id", "research_handoff_ref", "decision_id", "plan_ref", "node_id", "session_ref", "route_ref",
		"key", "name", "finding_id", "validation_id", "agent_name", "target_version", "research_decision"];
	const target = Object.fromEntries(fields.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
	// Without a bound identity, only an exact retry can resolve this failure.
	if (!Object.keys(target).length) target.unbound_input_hash = createHash("sha256").update(stableControlJSON(input)).digest("hex");
	return stableControlJSON({task, tool, action:input.action ?? (tool === "auto_research" ? "start" : "execute"), target});
}

export function eligibleResearchHandoffStatuses(decision: unknown): string[] {
	if (decision === "reactivate") return ["deferred"];
	if (decision === "skip") return ["proposed", "failed"];
	return ["proposed", "failed"];
}

export function failureClassification(error: string): Row {
	try {
		const parsed = JSON.parse(error);
		if (parsed.format === "task-control-error-v1") {
			const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
			const terminal = parsed.code === "already_reviewed"
				|| parsed.code === "required_selection" && candidates.length === 0;
			return {
				...parsed,
				failure_class: "contract_error",
				retryable: !terminal,
				recovery_hint: terminal ? "The requested target is no longer repairable; inspect current state and submit a new bound operation." : parsed.recovery_hint,
			};
		}
		if (parsed.format === "task-resource-version-conflict-v1" && parsed.applied === false)
			return {failure_class:"version_conflict",applied:false,retryable:true,current_version:parsed.current_version,
				required_next_call:parsed.current?.read ?? {tool:"task_harness",arguments:{action:"inspect"}}};
	} catch { /* native error */ }
	const runtime = /research runtime cannot read|spawn |ECONN|broker.*(?:failed|unavailable)|ENOENT/i.test(error);
	const requiredField = /(?:^|\n|:\s*)([A-Za-z_][A-Za-z0-9_]*) is required/i.test(error);
	const contract = /validation|invalid|required|must |unknown |version conflict|not startable|already decided/i.test(error);
	return {failure_class:runtime ? "runtime_failure" : contract ? "contract_error" : "operation_failure",
		retryable:!runtime && !requiredField, applied:/was not executed|task-resource-version-conflict-v1|research runtime cannot read/.test(error) ? false : "unknown",
		recovery_hint:runtime ? "Research is degraded; inspect current state, then choose the next parent environment action. Do not retry unchanged infrastructure failures." : "Inspect legal targets and correct the reported fields.",
		required_next_call:{tool:"task_harness", arguments:{action:"inspect"}}};
}

/** Capture an omitted control target before execution, so unrelated success cannot clear it. */
export function bindOperationIdentity(tool: string, input: Row, read: (file: string) => Row[]): Row {
	const bound = {...input};
	if (tool === "task_harness" && input.action === "review" && !input.opportunity_id) {
		const reviewed = new Set(read("task-harness-reviews.jsonl").map(row => row.opportunity_id));
		const failed = new Set(read("task-harness-review-events.jsonl").filter(row => row.status === "failed").map(row => row.window_id));
		const rows = read("task-harness-opportunities.jsonl").filter(row => !reviewed.has(row.opportunity_id) && !failed.has(row.window?.window_id));
		if (rows.length === 1) bound.opportunity_id = rows[0].opportunity_id;
	}
	if ((tool === "task_harness" && input.action === "decide_research" || tool === "auto_research" && (!input.action || input.action === "start") && !input.question && !input.plan_ref && !input.session_ref && !input.node_id)
		&& !input.research_handoff_ref) {
		const statuses = eligibleResearchHandoffStatuses(input.research_decision);
		const rows = latestControlRecords(read("auto-research-handoffs.jsonl"), "handoff_id").filter(row => statuses.includes(row.status));
		if (rows.length === 1) bound.research_handoff_ref = `research_handoff:${rows[0].handoff_id}@v${rows[0].version}`;
	}
	if ((tool === "assess_harness_effect" || tool === "task_harness" && input.action === "assess_effect") && !input.decision_id) {
		const assessed = new Set(read("effect-assessments.jsonl").map(row => row.decision_id));
		const rows = read("harness-decisions.jsonl").filter(row => !assessed.has(row.decision_id));
		if (rows.length === 1) bound.decision_id = rows[0].decision_id;
	}
	if (tool === "auto_research" && ["inspect","cancel","resume"].includes(input.action) && !input.session_ref) {
		const rows = latestControlRecords(read("auto-research-sessions.jsonl"),"session_id").filter(row => {
			if (input.action === "inspect") return true;
			return input.action === "resume" ? ["pending","failed"].includes(row.status) : !["completed","cancelled"].includes(row.status);
		});
		if (rows.length === 1) bound.session_ref = `research_session:${rows[0].session_id}@v${rows[0].version}`;
	}
	if (tool === "auto_research" && (["inspect_plan","release","skip"].includes(input.action) || (!input.action || input.action === "start") && input.node_id) && !input.plan_ref) {
		const rows = latestControlRecords(read("auto-research-plans.jsonl"),"plan_id");
		if (rows.length === 1) {
			bound.plan_ref = `research_plan:${rows[0].plan_id}@v${rows[0].version}`;
			if (!input.node_id && input.action !== "inspect_plan") {
				const nodes = rows[0].nodes.filter((node:Row) => input.action === "release" ? node.status === "pending" : !["completed","skipped","active"].includes(node.status));
				if (nodes.length === 1) bound.node_id = nodes[0].node_id;
			}
		}
	}
	return bound;
}
