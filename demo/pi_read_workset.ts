/** Read history, final input coverage and Agent declarations are separate facts. */
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { ensureTaskScope, stampTaskRecord, assertTaskRecordScope } from "./pi_task_scope.ts";

type Row = Record<string, any>;
const registries = new WeakMap<object, ReturnType<typeof createWorkset>>();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function payloadPages(value: any, result: Row[] = [], depth = 0): Row[] {
    if (depth > 24 || value == null) return result;
    if (typeof value === "string") {
        if (value.startsWith("{") || value.startsWith("[")) {
            try { payloadPages(JSON.parse(value), result, depth + 1); } catch { /* ordinary text */ }
        }
    } else if (typeof value === "object") {
        if (typeof value.ref === "string" && typeof value.text === "string"
            && Number.isInteger(value.offset) && Number.isInteger(value.page_end)) {
            result.push({ ref: value.ref, offset: value.offset, end: value.page_end,
                sha256: hash(value.text) });
        } else for (const item of Object.values(value)) payloadPages(item, result, depth + 1);
    }
    return result;
}
function createWorkset(rootInput: string) {
    const scope = ensureTaskScope(resolve(rootInput)), path = join(scope.root, "task-read-workset-events.jsonl");
    const reader = process.env.PI_TASK_CHILD_CONTEXT_ID ?? (process.env.PI_TASK_CHILD === "1" ? `child-${process.pid}` : "parent");
    const pages = new Map<string, Row>();
    // The parent plan belongs to the parent. In a research child an explicit
    // distillation releases residency, not evidence availability or provenance.
    // Unacknowledged pages still survive; parent/ordinary delegate rules stay intact.
    const researchChild = process.env.PI_TASK_CHILD_RESEARCH_PROTOCOL === "1";
    let epoch = 0;
    let dependencyStamp = "", cachedDependencies = new Set<string>();
    const append = (row: Row) => appendFileSync(path, JSON.stringify(stampTaskRecord(scope, {
        reader, ...row, recordedAt: new Date().toISOString(),
    })) + "\n");
    if (existsSync(path)) for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
        const row = JSON.parse(line); assertTaskRecordScope(scope, row, path);
        if (row.reader !== reader) continue;
        if (row.event === "read") pages.set(row.result_id, { ...row.page, result_id: row.result_id, included_in_payload: null });
        if (row.event === "agent_release") for (const id of row.result_ids) {
            const page = pages.get(id); if (page) Object.assign(page, { agent_acknowledged: true,
                covered_by: row.covered_by, release_reason: row.release_reason, superseded_by: row.superseded_by });
        }
        if (row.event === "diagnostic_release") {
            const page = pages.get(row.result_id); if (page) page.diagnostic_expired = true;
        }
        if (row.event === "page_superseded") for (const id of row.result_ids) {
            const page = pages.get(id); if (page) page.superseded_by = row.superseded_by;
        }
        // Prior-session coverage is deliberately never inherited.
    }
    function dependencies(): Set<string> {
        const refs = new Set<string>();
        if (researchChild) return refs;
        const strategyPath = join(scope.root, "task-strategy-state.json");
        if (!existsSync(strategyPath)) return refs;
        const stat = statSync(strategyPath), stamp = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
        if (stamp === dependencyStamp) return cachedDependencies;
        let state: Row;
        try { state = JSON.parse(readFileSync(strategyPath, "utf8")); } catch { return refs; }
        if (state.plan?.status !== "active") return refs;
        const walk = (v: any) => {
            if (!v || typeof v !== "object") return;
            for (const [key, item] of Object.entries(v)) {
                if (["evidence_refs", "depends_on_refs", "basis_refs", "counter_refs"].includes(key)
                    && Array.isArray(item)) for (const ref of item) refs.add(String(ref));
                else if (typeof item === "object") walk(item);
            }
        };
        walk(state.plan); walk(state.candidates?.find((c: Row) => c.id === state.plan.candidate_id));
        dependencyStamp = stamp; cachedDependencies = refs;
        return refs;
    }
    return {
        root: scope.root,
        read(id: string, page: Row) {
            const descriptor = { ref: page.ref, source_version: page.provenance?.source_version,
                offset: page.offset, end: page.page_end, sha256: page.page_sha256,
                agent_acknowledged: false, included_in_payload: null };
			const superseded = [...pages].filter(([, prior]) => prior.ref === descriptor.ref
				&& prior.offset === descriptor.offset && prior.end === descriptor.end && prior.sha256 === descriptor.sha256).map(([key]) => key);
			for (const key of superseded) Object.assign(pages.get(key)!, { superseded_by: id });
			if (superseded.length) append({ event: "page_superseded", result_ids: superseded,
				covered_by: `tool_result:${id}@v1`, release_reason: "exact_duplicate_page_replaced", superseded_by: id,
                agent_acknowledged: false });
            pages.set(id, { ...descriptor, result_id: id });
            append({ event: "read", result_id: id, page: descriptor });
        },
        required(id: string) {
            const page = pages.get(id);
            return Boolean(page && !page.superseded_by
                && ((!page.agent_acknowledged && !page.diagnostic_expired) || dependencies().has(page.ref)));
        },
        expireDiagnostic(id: string) {
            const page = pages.get(id);
            if (!page || page.diagnostic_expired || !String(page.ref).startsWith("failure:")
                || dependencies().has(page.ref)) return;
            page.diagnostic_expired = true;
            append({ event: "diagnostic_release", result_id: id,
                release_reason: "completed_response_or_action_after_diagnostic_read",
                epistemic_status: "mechanical_expiry_not_verified_understanding" });
        },
        superseded(id: string) { return Boolean(pages.get(id)?.superseded_by); },
        validateRelease(ids: string[]) {
            if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !pages.has(id)))
                throw new Error("read consumption requires exact known reader-local result IDs");
        },
        release(ids: string[], declaration: { covered_by?: string; release_reason?: string }) {
            this.validateRelease(ids);
            if (!declaration.covered_by && !String(declaration.release_reason ?? "").trim())
                throw new Error("read release requires a covering resource or Agent reason");
            for (const id of ids) Object.assign(pages.get(id)!, { agent_acknowledged: true, ...declaration });
            if (ids.length) append({ event: "agent_release", result_ids: ids, ...declaration,
                epistemic_status: "agent_declaration_not_verified_understanding" });
        },
        releaseEvidence(refs: string[], declaration: { covered_by?: string; release_reason?: string }) {
            this.release([...pages].filter(([, page]) => refs.includes(page.ref)).map(([id]) => id), declaration);
        },
        restore(messages: Row[], sources: Iterable<{ id: string; result: any }>) {
            // Rehydrate already-authorized exact outputs as evidence, never invent tool calls.
            // Native compaction may have removed the original call/result transaction.
            const present = payloadPages(messages);
            const recovered: Row[] = [];
            for (const { id, result } of sources) {
                if (!this.required(id)) continue;
                const page = pages.get(id)!;
                if (present.some(p => p.ref === page.ref && p.offset === page.offset
                    && p.end === page.end && p.sha256 === page.sha256)) continue;
                const exact = payloadPages(result).some(p => p.ref === page.ref && p.offset === page.offset
                    && p.end === page.end && p.sha256 === page.sha256);
                if (!exact) continue;
                recovered.push({ role: "user", timestamp: Date.now(), read_workset_required: true,
                    read_workset_result_id: id, content: [{ type: "text",
                        text: `Previously authorized evidence restored after context projection; result ${id}, exact range ${page.offset}:${page.end}.` },
                        ...result.content] });
            }
            return [...messages, ...recovered];
        },
        payload(payload: unknown, requestId: string, available = true) {
            const actual = available ? payloadPages(payload) : [];
            const exposureEpoch = `${reader}:${process.pid}:${++epoch}:${requestId}`;
            const dependencyRefs = dependencies();
            const current = [...pages.values()].filter(page => !page.superseded_by &&
                ((!page.agent_acknowledged && !page.diagnostic_expired) || dependencyRefs.has(page.ref) || actual.some(p => p.ref === page.ref
                    && p.offset === page.offset && p.end === page.end && p.sha256 === page.sha256))).map(page => {
                const included = available ? actual.some(p => p.ref === page.ref && p.offset === page.offset
                    && p.end === page.end && p.sha256 === page.sha256) : null;
                Object.assign(page, { included_in_payload: included, exposure_epoch: exposureEpoch });
                return { ...page, state: included === true ? "resident" : page.agent_acknowledged ? "distilled" : "cold",
                    verified: false };
            });
            append({ event: "payload_coverage", exposure_epoch: exposureEpoch,
                request_id: requestId, measurement_basis: available ? "provider_payload" : "coverage_unknown", pages: current });
            return { exposure_epoch: exposureEpoch, coverage_known: available,
                included_page_count: current.filter(p => p.included_in_payload === true).length,
                missing_unacknowledged: current.filter(p => p.included_in_payload === false && ((!p.agent_acknowledged && !p.diagnostic_expired) || dependencyRefs.has(p.ref)))
                    .map(p => ({ ref: p.ref, range: [p.offset, p.end], sha256: p.sha256 })) };
        },
        gaps() { const refs = dependencies(); return [...pages.values()].filter(p => !p.superseded_by && p.included_in_payload === false && ((!p.agent_acknowledged && !p.diagnostic_expired) || refs.has(p.ref)))
            .map(p => ({ ref: p.ref, range: [p.offset, p.end], reason: "body_absent_from_latest_payload", sha256: p.sha256 })); },
    };
}
export function readWorkset(pi: object, root: string) {
    let registry = registries.get(pi);
    if (registry && registry.root !== resolve(root)) throw new Error("read workset cannot cross task roots");
    if (!registry) { registry = createWorkset(root); registries.set(pi, registry); }
    return registry;
}
