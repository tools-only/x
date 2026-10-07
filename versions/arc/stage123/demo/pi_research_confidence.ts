/** Verify provenance, not a child's semantic confidence. Preserve useful reports on failure. */
import { resolveTaskResource, taskRecords } from "./pi_task_resource_store.ts";
type Row = Record<string, any>;
export function auditResearchConfidence(root: string, report: Row): Row {
	const update = report.confidence_update;
	if (!update || update.disposition !== "increase") return report;
	try {
		if (!update.target_ref) throw new Error("confidence increase needs an exact target_ref and its previous evidence cutoff");
		const target = resolveTaskResource(root, update.target_ref);
		const observations = taskRecords(root, "observation");
		const observationRefs = observations.map(r => `observation:${r.observation_id}@v${r.version ?? 1}`);
		const cited = update.evidence_refs.map((ref: string) => ({ ref, record: resolveTaskResource(root, ref) }));
		if (update.basis === "new_environment_evidence") {
			const cutoff = target.assessment_evidence_cutoff ?? target.experiment?.contract.evidence_cutoff;
			const cutoffIndex = observationRefs.indexOf(cutoff);
			if (!cutoff || cutoffIndex < 0) throw new Error("previous environmental evidence cutoff is unavailable; novelty is unknown");
			if (!cited.some(({ ref, record }: Row) => observationRefs.indexOf(ref) > cutoffIndex
				&& record.tool_name === "arc_action" && !record.is_error && record.arc_outcome))
				throw new Error("no newer canonical ARC action evidence; memory/report retellings do not create environmental samples");
		} else if (update.basis === "completed_discriminating_experiment") {
			const r = cited.find(({ ref }: Row) => ref === update.experiment_ref)?.record;
			const e = r?.experiment, predictions = e?.contract.candidate_predictions ?? [];
			if (!e || e.status !== "completed" || !["met", "not_met"].includes(e.outcome)) throw new Error("experiment result must be completed and observable");
			if (predictions.length < 2 || new Set(predictions.map((p: Row) => JSON.stringify(p.predicate ?? p.prediction))).size < 2)
				throw new Error("experiment has no distinct preregistered candidate predictions");
			if (e.contract.candidate_id !== (target.candidate_id ?? target.source_hypothesis_id)
				|| e.contract.candidate_version !== (target.source_hypothesis_version ?? target.version)) throw new Error("experiment target/version differs from the confidence target");
		} else if (update.basis === "resolved_counterexample") {
			if (!update.reason || !(target.counter_refs ?? []).some((ref: string) => update.evidence_refs.includes(ref)))
				throw new Error("reinterpretation must identify an existing counterexample and explain its resolution");
		}
		return { ...report, confidence_update: { ...update, provenance_status: "checked", semantic_status: "needs_parent_assessment" } };
	} catch (error) {
		const { confidence_update: _update, ...retained } = report;
		return { ...retained, confidence_update_unparsed: { raw: update, warning: String(error) },
			warnings: [...(report.warnings ?? []), { code: "confidence_update_not_applied", message: String(error) }] };
	}
}
