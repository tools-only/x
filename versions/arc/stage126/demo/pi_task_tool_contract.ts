/** Shared contract for agent-authored declarative task tools. */

export {
	PURE_EXPRESSION_DEFAULT_LIMITS,
	PURE_EXPRESSION_HARD_LIMITS,
	TASK_PURE_EXPRESSION_FORMAT,
	TASK_PURE_EXPRESSION_OPERATORS,
} from "./pi_task_pure_expression.ts";

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
