/** Lossless decision-bearing view of existing canonical state; no new truth store. */
import { arcProbeCoverage } from "./pi_arc_decision_feedback.ts";
import { arcActionReceiptView } from "./pi_arc_action_input.ts";
import { researchActionContinuation } from "./pi_auto_research_output.ts";
import { pendingFailureProjection } from "./pi_harness_control.ts";
type Row = Record<string, any>;
export function decisionCardV2(checkpoint: Row, state: Row, checkpointRef: string, gaps: Row[] = [], publicProgress?: Row, researchReport?: Row, observations: Row[] = [], parentCompetition?: Row): Row {
    const stale = new Set(checkpoint.reasoning_state?.stale_fields ?? []);
    const authored = Object.fromEntries(["task_goal", "success_conditions", "task_constraints", "current_subgoal",
        "planning_gap", "current_strategy", "hypothesis", "next_step", "working_summary", "strategy_alternatives",
        "summary_basis_refs", "decision_refs"].filter(key => !stale.has(key)).map(key => [key, checkpoint[key]]));
    const decision = Object.fromEntries(Object.entries(checkpoint.decision_state ?? {})
        .filter(([key]) => !stale.has(`decision_state.${key}`)));
    // Knowledge already appears in the canonical fields below. Keep the exact
    // capsule in durable history, without a second active knowledge expansion.
    const { knowledge: _knowledge, ...capsule } = checkpoint.decision_capsule ?? {};
    const all = (state.candidates ?? []).filter((c: Row) => c.status !== "rejected");
    const critical = all.filter((c: Row) => c.id === state.selected_candidate_id || c.id === state.plan?.candidate_id
        || c.status === "challenged" || (c.counterevidence ?? []).length);
    const candidates = [...new Map([...all.slice(-3), ...critical].map((c: Row) => [c.id, c])).values()];
    // A rejected explanation is inactive; its authored counterexample still
    // constrains the next decision after the original exchange is archived.
    const rejectedWithCounterevidence = (state.candidates ?? []).filter((c: Row) =>
        c.status === "rejected" && (c.counterevidence ?? []).length);
    const omitted = [...all.filter((c: Row) => !candidates.includes(c)), ...rejectedWithCounterevidence];
    const projected = parentCompetition?.audience === "parent" && parentCompetition.view_ref
        ? new Map((parentCompetition.candidates ?? []).map((c: Row) => [`${c.id}@v${c.version ?? 1}`, c]))
        : new Map<string, Row>();
    const shared = candidates.filter((c: Row) => projected.has(`${c.id}@v${c.version ?? 1}`));
    return { format: "task-decision-card-v2", revision: checkpoint.revision, checkpoint_ref: checkpointRef,
        latest_environment: checkpoint.latest_environment, last_action: checkpoint.recent_actions?.length
            ? arcActionReceiptView(checkpoint.recent_actions.at(-1)) : null,
		...(checkpoint.recent_actions?.length ? { probe_coverage: arcProbeCoverage(checkpoint.recent_actions) } : {}),
        environment_revision: checkpoint.latest_observation?.observation_id ?? null,
        public_progress: publicProgress ?? null,
        ...authored, interpretation_status: "agent_authored_not_runtime_fact",
        reasoning_state_update: checkpoint.reasoning_state,
        active_claims: candidates.map((candidate: Row) => {
            const ref = `strategy_candidate:${candidate.id}@v${candidate.version ?? 1}`;
            const shown = projected.get(`${candidate.id}@v${candidate.version ?? 1}`);
            const residual = shown ? Object.fromEntries(Object.entries(candidate).filter(([key, value]) =>
                !(Object.hasOwn(shown, key) && JSON.stringify(value) === JSON.stringify(shown[key])))) : candidate;
            return { ...residual, ...(shown ? { ref } : {}),
                knowledge_kind: candidate.knowledge_kind ?? "unknown", epistemic_status: "agent_assessment" };
        }),
        ...(shared.length ? { competition_view_ref: parentCompetition!.view_ref } : {}),
        omitted_claim_count: omitted.length,
        omitted_claim_refs: omitted.map((c: Row) => `strategy_candidate:${c.id}@v${c.version ?? 1}`),
        ...(decision.known_effects !== undefined ? { known_effects: decision.known_effects } : {}),
        knowledge_gaps: decision.knowledge_gaps ?? (authored.planning_gap ? [{ kind: "unknown",
            question: authored.planning_gap, status: "unresolved" }] : []),
        counterevidence: [...(decision.counterevidence ?? []), ...candidates.flatMap((c: Row) => c.counterevidence ?? []),
            ...rejectedWithCounterevidence.flatMap((c: Row) => c.counterevidence.map((entry: unknown) => ({
                ...(typeof entry === "string" ? { fact: entry } : entry as Row),
                candidate_ref: `strategy_candidate:${c.id}@v${c.version ?? 1}`,
            })))],
        next_decision: decision.next_decision ?? null,
        plan: state.plan ?? null, selected_candidate_id: state.selected_candidate_id ?? null,
        pending_operations: (checkpoint.pending_operations ?? []).map(pendingFailureProjection), evidence_gaps: gaps,
        decision_capsule: checkpoint.decision_capsule && !stale.has("decision_capsule") ? {
            ...capsule, ...(checkpoint.decision_capsule_observation_ref
                ? { observation_ref: checkpoint.decision_capsule_observation_ref } : {}),
        } : undefined,
        research: { run_ref: checkpoint.latest_research_run_ref, session_ref: checkpoint.research_session_ref,
            status: checkpoint.research_status, question: checkpoint.research_question,
			...(researchReport?.report ? { continuation: researchActionContinuation(researchReport.report,
				`research_report:${researchReport.run_id}@v${researchReport.version ?? 1}`, observations, researchReport.recordedAt) } : {}),
            report_summary: checkpoint.research_report_summary, epistemic_status: "child_report_not_automatically_adopted" },
    };
}
