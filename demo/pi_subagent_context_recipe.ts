/** Explicit bounded context selection. No hidden transcript inheritance. */
export type SubagentContextRecipe = {
    include_checkpoint: boolean;
    recent_observations: number;
    recent_actions: number;
    inherit_harness_refs: string[];
    output_contract: string;
    max_chars: number;
};
export function normalizeContextRecipe(value: unknown): SubagentContextRecipe {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("context_recipe must be an object");
    const input = value as Record<string, unknown>;
    if (input.include_checkpoint !== undefined && typeof input.include_checkpoint !== "boolean") throw new Error("context_recipe.include_checkpoint must be boolean");
    const count = (key: string, fallback: number, max: number) => {
        const n = input[key] ?? fallback;
        if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`context_recipe.${key} must be an integer between 0 and ${max}`);
        return n;
    };
    const refs = input.inherit_harness_refs ?? [];
    if (!Array.isArray(refs) || refs.some(r => typeof r !== "string" || !/^[a-z_]+:[^@]+@v[1-9]\d*$/.test(r))) throw new Error("context_recipe.inherit_harness_refs requires exact resource versions");
    if (input.output_contract !== undefined && typeof input.output_contract !== "string") throw new Error("context_recipe.output_contract must be text");
    return { include_checkpoint: input.include_checkpoint === true,
        recent_observations: count("recent_observations", 0, 100), recent_actions: count("recent_actions", 0, 100),
        inherit_harness_refs: [...new Set(refs)] as string[], output_contract: String(input.output_contract ?? ""),
        max_chars: count("max_chars", 12000, 80000) };
}
