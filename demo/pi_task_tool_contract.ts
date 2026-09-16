/** Shared contract for agent-authored declarative task tools. */

export const TASK_TOOL_PROGRAM_STEP_KINDS = [
	"adapter_call",
	"select",
	"count",
	"pick",
	"filter",
	"map",
	"group_by",
	"diff",
	"summarize",
	"assert",
	"emit_observation",
] as const;

export type TaskToolProgramStepKind = typeof TASK_TOOL_PROGRAM_STEP_KINDS[number];

