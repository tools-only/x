/** Mechanical scope binding from public execution boundaries, never prose. */
export type MemoryValidityContext = { task: string; episode: string; level: string; state: string };
export type MemoryValidity = { scope: "task" | "episode" | "level" | "state"; task_ref: string; instance_ref: string };

export function memoryValidityContext(task: string, observations: Record<string, any>[]): MemoryValidityContext {
    let episode = `${task}:initial`, level = `${episode}:level-initial`, state = `${task}:initial`;
    const seen = new Set<string>();
    for (const row of observations) {
        if (!row.observation_id || seen.has(row.observation_id) || row.is_error) continue;
        seen.add(row.observation_id);
        state = row.observation_id;
        const outcome = row.arc_outcome ?? {};
        const transition = outcome.public_transition ?? {};
        if (row.tool_name === "arc_action" && (row.input?.action === "RESET" || transition.reset === true)) {
            episode = `${task}:reset:${state}`;
            level = `${episode}:level-initial`;
        } else if (transition.level_changed === true) {
            level = `${episode}:level:${state}`;
        }
    }
    return { task, episode, level, state };
}

export function normalizeMemoryValidity(value: unknown, context?: MemoryValidityContext): MemoryValidity {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("validity must be {scope, task_ref, instance_ref}; inspect memory_validity_context");
    const input = value as Record<string, unknown>;
    if (!["task", "episode", "level", "state"].includes(String(input.scope))) throw new Error("validity.scope must be task, episode, level or state");
    const scope = input.scope as MemoryValidity["scope"];
    const task_ref = input.task_ref ?? context?.task;
    const instance_ref = input.instance_ref ?? context?.[scope];
    if (typeof task_ref !== "string" || !task_ref.trim() || typeof instance_ref !== "string" || !instance_ref.trim())
        throw new Error("validity requires exact task_ref and instance_ref outside the main runtime");
    return { scope, task_ref, instance_ref };
}

export function memoryValidityReasons(value: unknown, context?: MemoryValidityContext): string[] {
    if (value === undefined) return []; // Historical compatibility; never infer a scope from prose.
    let validity: MemoryValidity;
    try { validity = normalizeMemoryValidity(value); } catch { return ["validity:invalid_requires_review"]; }
    if (!context) return ["validity:context_unavailable"];
    if (validity.task_ref !== context.task) return ["validity:task_mismatch"];
    return context[validity.scope] === validity.instance_ref ? [] : [`scope_expired:${validity.scope}:${validity.instance_ref}`];
}
