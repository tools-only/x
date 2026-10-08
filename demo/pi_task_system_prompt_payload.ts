/** Replace only the task overlay we emitted; preserve fixed provider/host fields. */
export function taskSystemOverlaySection(overlay: string): string {
	return overlay ? `\n\n# Task-local system-prompt overlay\n${overlay}` : "";
}

export function replaceTaskSystemOverlay(
	payload: unknown, previousSections: string[], overlay: string, api = "",
): Record<string, any> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Unsupported provider payload for task system prompt");
	const input = payload as Record<string, any>;
	const sections = [...new Set(previousSections.filter(Boolean))].sort((a, b) => b.length - a.length);
	const section = taskSystemOverlaySection(overlay);
	const clean = (text: string) => sections.reduce((value, old) => value.split(old).join(""), text);
	const content = (value: unknown, append: boolean): unknown => {
		if (value === undefined || typeof value === "string") return clean(String(value ?? "")) + (append ? section : "");
		if (!Array.isArray(value)) throw new Error("Unsupported system content for task system prompt");
		const blocks = value.flatMap(block => {
			if (typeof block?.text !== "string") return [block];
			const text = clean(block.text);
			return text ? [{ ...block, text }] : [];
		});
		if (append && section) blocks.push({ type: "text", text: section });
		return blocks;
	};
	// Custom transports may expose Pi's native context as their payload. Keep
	// its typed messages intact rather than inserting an HTTP system message.
	if (typeof input.systemPrompt === "string") {
		return { ...input, systemPrompt: clean(input.systemPrompt) + section };
	}
	if (api.includes("responses") || typeof input.instructions === "string" || Array.isArray(input.input)) {
		return { ...input, instructions: content(input.instructions, true) };
	}
	if (api.includes("anthropic") || Object.hasOwn(input, "system")) {
		return { ...input, system: content(input.system, true) };
	}
	if (api.includes("google") || input.systemInstruction !== undefined || input.config?.systemInstruction !== undefined) {
		const inConfig = input.config?.systemInstruction !== undefined
			|| (input.systemInstruction === undefined && input.config !== undefined);
		const instruction = inConfig ? input.config.systemInstruction : input.systemInstruction;
		const originalParts = instruction === undefined ? [] : typeof instruction === "string" ? [{ text: instruction }]
			: Array.isArray(instruction) ? instruction : instruction?.parts
				?? (typeof instruction?.text === "string" ? [instruction] : undefined);
		if (!Array.isArray(originalParts)) throw new Error("Unsupported Google system instruction for task system prompt");
		const parts = originalParts.flatMap((raw: any) => {
			const part = typeof raw === "string" ? { text: raw } : raw;
			return typeof part?.text === "string" ? (clean(part.text) ? [{ ...part, text: clean(part.text) }] : []) : [part];
		});
		if (section) parts.push({ text: section });
		const systemInstruction = { ...(instruction?.parts ? instruction : {}), parts };
		return inConfig ? { ...input, config: { ...input.config, systemInstruction } } : { ...input, systemInstruction };
	}
	if (Array.isArray(input.messages)) {
		const messages = input.messages.map((message: any) => ["system", "developer"].includes(message.role)
			? { ...message, content: content(message.content, false) } : message);
		const index = messages.findLastIndex((message: any) => ["system", "developer"].includes(message.role));
		if (index >= 0) messages[index] = { ...messages[index], content: content(messages[index].content, true) };
		else if (section) messages.unshift({ role: "system", content: section });
		return { ...input, messages };
	}
	throw new Error("Unsupported provider payload for task system prompt; no replacement was applied");
}
