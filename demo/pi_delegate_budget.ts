/** One ordinary delegation owns one budget, including native length resumes. */
export type DelegateBudgetLimits = {
	max_runtime_ms: number;
	max_tool_calls: number;
	max_continuations: number;
	max_reported_tokens?: number;
};
export type DelegateBudget = {
	limits: DelegateBudgetLimits;
	deadline_ms: number;
	tool_calls: number;
	reported_tokens: number;
};
export function resolveDelegateBudget(value?: unknown, environment = process.env): DelegateBudgetLimits {
	if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("budget must be an object");
	const input = (value ?? {}) as Record<string, unknown>;
	const defaults: DelegateBudgetLimits = { max_runtime_ms: 120_000, max_tool_calls: 24, max_continuations: 2 };
	const vars = { max_runtime_ms: "PI_AUTORESEARCH_DELEGATE_MAX_RUNTIME_MS", max_tool_calls: "PI_AUTORESEARCH_DELEGATE_MAX_TOOL_CALLS",
		max_continuations: "PI_AUTORESEARCH_DELEGATE_MAX_CONTINUATIONS", max_reported_tokens: "PI_AUTORESEARCH_DELEGATE_MAX_REPORTED_TOKENS" };
	const unknown = Object.keys(input).find(key => !Object.hasOwn(vars, key));
	if (unknown) throw new Error(`budget.${unknown} is unsupported`);
	const limits = { ...defaults };
	for (const [key, envName] of Object.entries(vars)) {
		const requested = input[key];
		if (requested !== undefined && (typeof requested !== "number" || !Number.isSafeInteger(requested) || requested < 1))
			throw new Error(`budget.${key} must be a positive safe integer`);
		const configured = Number(environment[envName]);
		const cap = Number.isSafeInteger(configured) && configured > 0 ? configured : defaults[key as keyof DelegateBudgetLimits];
		const limit = requested === undefined ? cap : cap === undefined ? requested : Math.min(requested as number, cap);
		if (limit !== undefined) limits[key as keyof DelegateBudgetLimits] = limit as number;
	}
	return limits;
}
export function createDelegateBudget(limits: DelegateBudgetLimits, now = Date.now()): DelegateBudget {
	return { limits, deadline_ms: now + limits.max_runtime_ms, tool_calls: 0, reported_tokens: 0 };
}
export function delegateBudgetRemaining(budget: DelegateBudget, now = Date.now()) {
	return { runtime_ms: Math.max(0, budget.deadline_ms - now),
		tool_calls: Math.max(0, budget.limits.max_tool_calls - budget.tool_calls),
		...(budget.limits.max_reported_tokens !== undefined
			? { reported_tokens: Math.max(0, budget.limits.max_reported_tokens - budget.reported_tokens) } : {}) };
}
