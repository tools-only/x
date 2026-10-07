/** Explicit bounded context selection. No hidden transcript inheritance. */
export type SubagentContextRecipe = {
    include_checkpoint: boolean;
    recent_observations: number;
    recent_actions: number;
    inherit_harness_refs: string[];
    output_contract: string;
    max_chars: number;
};

/** Move the caller's output intent into its existing canonical field, without
 * dropping unknown input or altering a saved role's default context selection. */
export function normalizeDelegateOutputContract(value: unknown, savedRecipe?: SubagentContextRecipe): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || !Object.hasOwn(value, "output_contract")) return value;
    const input = value as Record<string, unknown>;
    if (typeof input.output_contract !== "string") throw new Error("output_contract must be text");
    if (input.context_recipe !== undefined && (!input.context_recipe
        || typeof input.context_recipe !== "object" || Array.isArray(input.context_recipe)))
        throw new Error("context_recipe must be an object");
    const explicit = input.context_recipe as Record<string, unknown> | undefined;
    if (explicit?.output_contract !== undefined && explicit.output_contract !== input.output_contract)
        throw new Error("output_contract conflicts with context_recipe.output_contract");
    const { output_contract, ...rest } = input;
    return { ...rest, context_recipe: { ...(explicit ?? savedRecipe ?? {}), output_contract } };
}

export function normalizeContextRecipe(value: unknown): SubagentContextRecipe {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("context_recipe must be an object");
    const input = value as Record<string, unknown>;
    const supported = new Set(["include_checkpoint", "recent_observations", "recent_actions",
        "inherit_harness_refs", "output_contract", "max_chars"]);
    const unknown = Object.keys(input).find(key => !supported.has(key));
    if (unknown) throw new Error(`context_recipe.${unknown.slice(0, 80)} is unsupported; use ${[...supported].join(", ")}`);
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
