import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Load a checked-in, human-readable prompt from demo/prompts. */
export function loadPrompt(name: string): string {
	return readFileSync(
		fileURLToPath(new URL(`./prompts/${name}`, import.meta.url)),
		"utf8",
	);
}

/** Replace simple named placeholders in a prompt template; `template` stands in for the file when a caller has changed it. */
export function renderPrompt(name: string, values: Record<string, string>, template?: string): string {
	let prompt = template ?? loadPrompt(name);
	for (const [key, value] of Object.entries(values)) {
		prompt = prompt.replaceAll(`{{${key}}}`, value);
	}
	return prompt;
}
