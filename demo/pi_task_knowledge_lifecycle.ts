/** Version validity and coherent views. No inference from free-form evidence text. */
import { createHash } from "node:crypto";
import { memoryValidityReasons, type MemoryValidityContext } from "./pi_memory_validity.ts";

export type KnowledgeLinks = { depends_on_refs?: string[]; supersedes_refs?: string[] };
export type KnowledgeAvailability = "loaded" | "unloaded" | "suspended" | "retired";
export type KnowledgeEvidenceStatus = "untested" | "supported" | "contested" | "refuted";
type RecordValue = Record<string, any>;
export type KnowledgeEntry = { kind: string; record: RecordValue };
const identities: Record<string, string> = { memory: "key", skill: "name", system_prompt: "name" };
const ids: Record<string, string> = { memory: "memory_id", skill: "skill_id", system_prompt: "segment_id" };
export function knowledgeRef(kind: string, record: RecordValue): string {
    return `${kind}:${record[identities[kind]]}@v${record.version}`;
}

export type KnowledgeControlInput = {
	operation_id: string;
	source: "parent_direct" | "parent_review" | "research";
	operation: "load" | "unload" | "suspend" | "retire" | "assess";
	target_ref: string;
	expected_control_revision?: number;
	reason: string;
	evidence_refs?: string[];
	evidence_status?: KnowledgeEvidenceStatus;
	scope?: string;
};

export function knowledgeAvailability(record: RecordValue): KnowledgeAvailability {
	if (record.availability) return String(record.availability) as KnowledgeAvailability;
	return record.status === "retired" ? "retired" : "loaded";
}

export function knowledgeEvidenceStatus(record: RecordValue): KnowledgeEvidenceStatus {
	const value = String(record.evidence_status ?? "untested");
	return ["untested", "supported", "contested", "refuted"].includes(value)
		? value as KnowledgeEvidenceStatus : "untested";
}

export function applyKnowledgeControl(record: RecordValue, input: KnowledgeControlInput): RecordValue {
	if (!input.operation_id.trim() || !input.reason.trim() || !input.target_ref.trim()) {
		throw new Error("control operation_id, target_ref and reason are required");
	}
	const currentRevision = Number(record.control_revision ?? 0);
	if (input.expected_control_revision !== undefined && input.expected_control_revision !== currentRevision) {
		throw new Error(`control revision conflict: expected ${input.expected_control_revision}, current ${currentRevision}`);
	}
	const current = knowledgeAvailability(record);
	if (input.operation === "load" && current === "retired") throw new Error("retired knowledge requires a new version before loading");
	if (input.operation === "load" && current === "suspended") throw new Error("suspended knowledge requires explicit revalidation before loading");
	if (input.operation === "suspend" && current === "retired") throw new Error("retired knowledge cannot be suspended");
	if (input.operation === "unload" && current === "retired") throw new Error("retired knowledge is already unavailable");
	const nextAvailability = input.operation === "load" ? "loaded"
		: input.operation === "unload" ? "unloaded"
		: input.operation === "suspend" ? "suspended" : input.operation === "retire" ? "retired" : current;
	const nextEvidence = input.evidence_status ?? knowledgeEvidenceStatus(record);
	if (input.operation === "assess" && !input.evidence_status) throw new Error("assess requires evidence_status");
	return {
		...record,
		availability: nextAvailability,
		status: nextAvailability === "retired" ? "retired" : record.status === "retired" ? "active" : record.status,
		evidence_status: nextEvidence,
		...(input.scope ? { evidence_scope: input.scope } : {}),
		...(input.evidence_refs ? { evidence_refs: [...new Set(input.evidence_refs)] } : {}),
		control_revision: currentRevision + 1,
		last_control: { operation_id: input.operation_id, source: input.source, operation: input.operation,
			reason: input.reason, target_ref: input.target_ref },
	};
}

export function knowledgeControlReceipt(record: RecordValue, input: KnowledgeControlInput): RecordValue {
	const next = applyKnowledgeControl(record, input);
	return { format: "task-knowledge-control-receipt-v1", operation_id: input.operation_id,
		target_ref: input.target_ref, applied: true, previous_control_revision: Number(record.control_revision ?? 0),
		control_revision: next.control_revision, availability: knowledgeAvailability(next),
		evidence_status: knowledgeEvidenceStatus(next), evidence_refs: next.evidence_refs ?? [] };
}

export function knowledgeState(entries: KnowledgeEntry[], context?: MemoryValidityContext) {
    const latest = new Map<string, KnowledgeEntry>();
    const versions = new Map<string, KnowledgeEntry>();
    for (const entry of entries) {
        const { kind, record } = entry;
        const key = `${kind}:${record[identities[kind]]}`;
        if (!latest.has(key) || latest.get(key)!.record.version <= record.version) latest.set(key, entry);
        versions.set(knowledgeRef(kind, record), entry);
        if (record[ids[kind]]) versions.set(`${kind}:${record[ids[kind]]}@v${record.version}`, entry);
    }
    // Replacement declarations are durable history, even when their author retires.
    const replaced = new Map<string, string>();
    for (const { kind, record } of entries) for (const ref of record.supersedes_refs ?? []) {
        const target = versions.get(ref);
        if (target) replaced.set(knowledgeRef(target.kind, target.record), knowledgeRef(kind, record));
    }
    const cache = new Map<string, string[]>();
    function reasons(entry: KnowledgeEntry, visiting = new Set<string>()): string[] {
        const { kind, record } = entry;
        const ref = knowledgeRef(kind, record);
        if (cache.has(ref)) return cache.get(ref)!;
        if (visiting.has(ref)) return [`dependency_cycle:${ref}`];
        const why: string[] = [];
        if (record.status !== "active") why.push(`status:${record.status}`);
        if (record.availability && record.availability !== "loaded") why.push(`availability:${record.availability}`);
        if (knowledgeEvidenceStatus(record) === "refuted") why.push("evidence:refuted");
        if (kind === "memory") why.push(...memoryValidityReasons(record.validity, context));
        if (latest.get(`${kind}:${record[identities[kind]]}`)?.record.version !== record.version) why.push("version_replaced");
        if (replaced.has(ref)) why.push(`superseded_by:${replaced.get(ref)}`);
        const path = new Set([...visiting, ref]);
        for (const dependency of record.depends_on_refs ?? []) {
            const target = versions.get(dependency);
            if (!target || reasons(target, path).length) why.push(`dependency_requires_review:${dependency}`);
        }
        cache.set(ref, why);
        return why;
    }
    const eligible = (kind: string, record: RecordValue) => reasons({ kind, record }).length === 0;
    return {
        eligible,
        reasons: (kind: string, record: RecordValue) => reasons({ kind, record }),
        notices: [...latest.values()].filter(e => e.record.status === "active" && !eligible(e.kind, e.record))
            .map(e => ({ resource_ref: knowledgeRef(e.kind, e.record), reasons: reasons(e),
                recovery: "Inspect exact evidence; revise/revalidate this resource against current dependencies or retire it. Historical content is not current guidance." })),
        resolve: (ref: string) => versions.get(ref),
    };
}

export function normalizeKnowledgeLinks(input: RecordValue, previous: RecordValue | undefined,
    entries: KnowledgeEntry[], kind: string, name: string, context?: MemoryValidityContext): KnowledgeLinks {
    const state = knowledgeState(entries, context);
    const result: KnowledgeLinks = {};
    for (const field of ["depends_on_refs", "supersedes_refs"] as const) {
        if (input[field] === undefined) {
            if (previous?.[field]) result[field] = previous[field];
            continue;
        }
        if (!Array.isArray(input[field]) || input[field].some((ref: unknown) => typeof ref !== "string")) {
            throw new Error(`${field} must be an array of exact memory/skill/system_prompt references`);
        }
        result[field] = [...new Set(input[field] as string[])].map(ref => {
            const target = state.resolve(ref);
            if (!target || !state.eligible(target.kind, target.record)) {
                throw new Error(`${field}: reference must identify a current eligible resource: ${ref}`);
            }
            if (target.kind === kind && target.record[identities[kind]] === name) {
                throw new Error(`${field}: self-reference is invalid; update the current version instead`);
            }
            return knowledgeRef(target.kind, target.record);
        });
    }
    if ((result.depends_on_refs ?? []).some(ref => result.supersedes_refs?.includes(ref))) {
        throw new Error("a resource cannot depend on a version it supersedes");
    }
    // Evaluate the proposed graph to reject indirect cycles or self-invalidating replacement.
    const candidate = { ...previous, ...result, [identities[kind]]: name,
        version: (previous?.version ?? 0) + 1, status: "active" };
    const trial = knowledgeState([...entries, { kind, record: candidate }], context);
    if ((input.depends_on_refs !== undefined || input.supersedes_refs !== undefined) && !trial.eligible(kind, candidate)) {
        throw new Error("depends_on_refs creates an invalid dependency chain; inspect and revalidate prerequisites first");
    }
    return result;
}

/** An explicit body write acknowledges the canonical version being authored. */
export function coherentMemory(input: RecordValue, previous?: RecordValue) {
    const bodyWrite = input.content !== undefined || input.append_content !== undefined;
    const changedView = (input.summary !== undefined && input.summary !== previous?.summary)
        || (input.projection?.prompt_text !== undefined && input.projection.prompt_text !== previous?.projection?.prompt_text);
    if (previous && input.action !== "retire" && changedView && !bodyWrite) {
        throw new Error("memory views require a canonical content or append_content write in the same update; summary/prompt_text alone would preserve stale content");
    }
    let projection = input.projection === null ? undefined : input.projection ?? previous?.projection;
    if (projection) {
        projection = { ...projection };
        if (bodyWrite && input.projection?.prompt_text === undefined) delete projection.prompt_text;
    }
    return { summary: input.summary ?? (bodyWrite ? undefined : previous?.summary), projection };
}

export function promptReceipt(layer: string, ref: string, content: string) {
    return { layer, resource_ref: ref, chars: content.length,
        sha256: createHash("sha256").update(content).digest("hex") };
}
