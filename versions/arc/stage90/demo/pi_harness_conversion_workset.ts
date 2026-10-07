/** Current mechanical reachability derived from immutable writes and selection. */
export function conversionWorkset(records: Record<string, any>[], selectedRefs: string[], options: {
    eligibleRefs?: string[];
    trials?: { observation_ref: string; resource_refs: string[] }[];
} = {}) {
    const latest = new Map<string, Record<string, any>>();
    for (const record of records) {
        const id = record.intent_id ?? record.operation_id;
        if (id) latest.set(String(id), record);
    }
    const selected = new Set(selectedRefs);
    const eligible = new Set(options.eligibleRefs ?? selectedRefs);
    return [...latest.values()].map(record => {
        const refs = Array.isArray(record.resource_refs) ? record.resource_refs : [];
        if (record.status !== "applied_pending_assembly" || !refs.length
            || !refs.every((ref: unknown) => typeof ref === "string"))
            return { ...record, recorded_status: record.status };
        const trials = (options.trials ?? []).filter(trial => trial.resource_refs.some(ref => refs.includes(ref)));
        const used = new Set(trials.flatMap(trial => trial.resource_refs));
        const pending = refs.filter((ref: string) => !used.has(ref));
        if (!pending.length) return {
            ...record, recorded_status: record.status, status: "trial_observed", phase: "trial",
            retry: null, trial_evidence_refs: [...new Set(trials.map(trial => trial.observation_ref))],
            recovery: "Trial evidence exists for these exact versions. Inspect task feedback and decide whether to retain, revise or stop. Do not repeat authoring, assembly or a trial solely to complete this queue. A trial does not establish task benefit.",
        };
        if (!refs.every((ref: string) => selected.has(ref) && eligible.has(ref)))
            return { ...record, recorded_status: record.status, pending_trial_refs: pending };
        return {
            ...record,
            recorded_status: record.status,
            status: "assembled_pending_trial",
            phase: "assembled",
            retry: null,
            pending_trial_refs: pending,
            recovery: "These exact versions are already written and selected. Follow their use entries, apply the semantic result to the task, and inspect feedback. Do not recreate or reassemble unchanged versions. Use is not evidence of benefit.",
        };
    });
}
