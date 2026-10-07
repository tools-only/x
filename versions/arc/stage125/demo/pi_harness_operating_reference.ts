/** Read-only, on-demand instructions. No scheduling, resource writes or activation. */
import { loadPrompt, renderPrompt } from "./prompt_loader.ts";

export const HARNESS_REFERENCE_TOPICS = {
	charter: { file: "harness_charter_operations.md", description: "Task charter, decision cycles and action limits." },
	components: { file: "harness_components_operations.md", description: "Choose Memory, Skill, Tool, Subagent or System Prompt; admission and trial rules." },
	memory: { file: "harness_memory_operations.md", description: "Capture, scope and revise memory." },
	assembly: { file: "harness_assembly_operations.md", description: "Select exact versions and load or invoke them." },
	review: { file: "harness_review_operations.md", description: "Review outcomes and continue chosen development." },
	opportunity: { file: "harness_opportunity_reference.md", description: "Complete opportunity review, research and development guidance." },
	induction: { file: "state_transition_induction.md", description: "Compare action transitions and develop testable mechanisms." },
	assessment: { file: "harness_assessment_operations.md", description: "Assess actual use and uncertainty." },
	development: { file: "harness_development_operations.md", description: "Chosen development: author, assemble, trial or record an infrastructure blocker." },
	research: { file: "harness_research_operations.md", description: "Prepare grounded research, continue sessions and return later evidence." },
	experiments: { file: "harness_experiments_operations.md", description: "Accept or reject child experiment requests against the current state and action budget." },
	arc_reasoning: { file: "arc_reasoning_reference.md", description: "ARC hypothesis, goal, coordinate and strategy guidance." },
} as const;

export function harnessOperatingReference(topic?: string, values: Record<string, string> = {}, section?: string) {
	const topics = Object.entries(HARNESS_REFERENCE_TOPICS).map(([name, entry]) => ({
		topic: name, description: entry.description,
		read_call: { tool: "task_harness", arguments: { action: "contract", topic: name } },
	}));
	if (topic === undefined) return { format: "task-harness-contract-v1", read_only: true, topics };
	if (!Object.prototype.hasOwnProperty.call(HARNESS_REFERENCE_TOPICS, topic))
		throw new Error(`Unknown Harness contract topic: ${topic}`);
	const entry = HARNESS_REFERENCE_TOPICS[topic as keyof typeof HARNESS_REFERENCE_TOPICS];
	const arcBriefs: Record<string, string> = {
		development: "harness_development_brief.md", components: "harness_components_brief.md",
		assembly: "harness_assembly_brief.md",
	};
	if (arcBriefs[topic] && process.env.PI_ARC_EXECUTION_GATE === "enabled" && section !== "all")
		return { format: "task-harness-contract-v1", read_only: true, topic,
			instructions: renderPrompt(arcBriefs[topic], values) };
	const instructions = renderPrompt(entry.file, { game: process.env.PI_ARC_GAME ?? "the current game", ...values });
	return { format: "task-harness-contract-v1", read_only: true, topic,
		instructions: topic === "development"
			? `${instructions}\n\n${loadPrompt("capability_extraction_process.md")}` : instructions };
}
