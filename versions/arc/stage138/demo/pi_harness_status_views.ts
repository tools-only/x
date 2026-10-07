/** Small read-only views over the existing complete Harness status. */

type HarnessStatus = Record<string, any>;

const readSectionCall = (section: string) => ({
	tool: "task_harness", arguments: { action: "inspect", section },
});

const fullStatusCall = (action: "inspect" | "status") => ({
	tool: "task_harness", arguments: action === "status" ? { action, section: "all" } : { action },
});

/** Keep mutable working state; disclose static manuals only when requested. */
export function harnessStateView(status: HarnessStatus) {
	const summary = harnessStatusSummary(status, "status");
	const assembly = status.current_assembly;
	return {
		...summary,
		format: "task-harness-state-v1",
		task_solving_context: status.task_solving_context,
		control_policy: status.control_policy,
		authorized_tools: status.authorized_tools ?? [],
		current_assembly: assembly ? { ...summary.current_assembly, revision: assembly.revision,
			selected_resource_refs: assembly.selected_resource_refs ?? [] } : null,
		pending_counts: { ...summary.pending_counts,
			knowledge_requires_review: status.knowledge_requires_review?.length ?? 0,
			conversion_intents: status.conversion_intents?.length ?? 0 },
		baseline_methods: (status.baseline_methods ?? []).map(({ name, method_ref, read_call }: HarnessStatus) => ({ name, method_ref, read_call })),
	};
}

export function harnessStatusSummary(status: HarnessStatus, fullStatusAction: "inspect" | "status" = "inspect") {
	const assembly = status.current_assembly;
	const resources = status.resources ?? {};
	return {
		format: "task-harness-status-summary-v1",
		active_tools: status.active_tools ?? [],
		focused_resource_refs: status.focused_resource_refs ?? null,
		current_assembly: assembly ? {
			assembly_ref: `harness_assembly:${assembly.assembly_id}@v${assembly.revision}`,
			selected_resource_count: assembly.selected_resource_refs?.length ?? 0,
		} : null,
		latest_opportunity: status.latest_opportunity ?? null,
		pending_counts: {
			level_reviews: status.pending_level_reviews?.length ?? 0,
			review_drafts: status.review_drafts?.length ?? 0,
			capability_followups: status.capability_followups?.length ?? 0,
			direct_development_intents: status.direct_development_intents?.length ?? 0,
			assessable_decisions: status.assessable_decisions?.length ?? 0,
			parent_authoring_handoffs: status.parent_authoring_handoffs?.length ?? 0,
			research_handoffs: status.research_handoffs?.length ?? 0,
			pending_research_handoff: Boolean(status.pending_research_handoff),
		},
		resource_counts: Object.fromEntries(Object.entries(resources).map(([kind, entries]) => [
			kind, Array.isArray(entries) ? entries.length : 0,
		])),
		available_sections: Object.keys(status).filter((name) => name !== "format"),
		read_section_call: readSectionCall("<available_sections entry>"),
		full_status_call: fullStatusCall(fullStatusAction),
	};
}

export function harnessStatusSection(status: HarnessStatus, section: string, fullStatusAction: "inspect" | "status" = "inspect") {
	if (section === "all") return status;
	if (!section || !Object.prototype.hasOwnProperty.call(status, section) || section === "format")
		throw new Error(`Unknown Harness status section: ${section}. Read task_harness(action="summary") for available_sections.`);
	return {
		format: "task-harness-status-section-v1", section, value: status[section],
		summary_call: { tool: "task_harness", arguments: { action: "summary" } },
		full_status_call: fullStatusCall(fullStatusAction),
	};
}
