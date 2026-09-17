/** Research focus selects instructions, never permissions or harness routes. */
import { createHash } from "node:crypto";
import { loadPrompt } from "./prompt_loader.ts";

export const RESEARCH_PROFILE_FILES: Record<string, string> = {
	harness_component: "research_profiles/component.md",
	composition: "research_profiles/composition.md",
	task_decomposition: "research_profiles/task_decomposition.md",
	solution_path: "research_profiles/solution_path.md",
	strategy: "research_profiles/strategy.md",
	research_method: "research_profiles/research_method.md",
};

export function loadResearchProfile(scope = "unspecified") {
	const file = Object.hasOwn(RESEARCH_PROFILE_FILES, scope) ? RESEARCH_PROFILE_FILES[scope] : null;
	if (!file && !["unspecified", "hypothesis"].includes(scope)) throw new Error(`Unknown research scope: ${scope}`);
	const instructions = file ? loadPrompt(file) : "";
	return { scope, file, instructions,
		sha256: file ? createHash("sha256").update(instructions).digest("hex") : null };
}
