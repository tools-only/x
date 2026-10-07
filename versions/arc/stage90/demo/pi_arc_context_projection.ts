/** Bounded model-facing ARC projections; canonical bridge evidence is unchanged. */

export type ArcChangedComponent = {
	changed_cells: number;
	bbox: { top: number; left: number; bottom: number; right: number };
	shape_signature: string;
	centroid: { row: number; col: number };
	matching_actions?: string[];
};

export type ArcEffectRecord = {
	state_epoch: number;
	changed_cells: number | null;
	bbox: unknown;
	components: ArcChangedComponent[];
	last_action_index: number;
};

/** Mechanical geometry only: three material, disconnected changed regions. */
export function arcIsDecisionMultiRegion(groups: unknown): groups is Array<{ changed_cells: number; bbox: unknown }> {
	return Array.isArray(groups) && groups.length >= 3 && groups.length <= 8
		&& groups.every(group => Number.isInteger(group?.changed_cells)
			&& group.bbox && typeof group.bbox === "object")
		&& groups.some(group => group.changed_cells >= 20)
		&& groups.filter(group => group.changed_cells >= 4).length >= 3;
}

/** Sparse geometry for a complete, unusual public delta; never a task interpretation. */
export function arcSparseDecisionChangeGroups(
	delta: Record<string, unknown> | undefined,
	components: Array<{ changed_cells: number; bbox: unknown }> | undefined,
	action: string,
	levelChanged: boolean,
): Array<{ changed_cells: number; bbox: unknown }> | undefined {
	if (action === "RESET" || levelChanged || !Array.isArray(delta?.cells)
		|| delta.cells_truncated === true || delta.cells.length !== delta.changed_cells
		|| !arcIsDecisionMultiRegion(components)) return undefined;
	return components.map(({ changed_cells, bbox }) => ({ changed_cells, bbox }));
}

/** Four-connected changed cells, independent of any object or causal interpretation. */
export function arcChangedComponents(delta: Record<string, unknown> | undefined): ArcChangedComponent[] {
	const raw = Array.isArray(delta?.cells) ? delta.cells as Array<Record<string, unknown>> : [];
	// A partial pixel list cannot establish exact pattern recurrence.
	if (delta?.cells_truncated === true
		|| (typeof delta?.changed_cells === "number" && delta.changed_cells !== raw.length)) return [];
	const cells = raw
		.map(cell => ({ row: Number(cell.row), col: Number(cell.col), value: String(cell.value) }))
		.filter(cell => Number.isInteger(cell.row) && Number.isInteger(cell.col))
		.sort((a, b) => a.row - b.row || a.col - b.col);
	const byCoordinate = new Map(cells.map(cell => [`${cell.row}:${cell.col}`, cell]));
	const visited = new Set<string>();
	const components: ArcChangedComponent[] = [];
	for (const seed of cells) {
		const seedKey = `${seed.row}:${seed.col}`;
		if (visited.has(seedKey)) continue;
		const queue = [seed];
		visited.add(seedKey);
		const component: typeof cells = [];
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const current = queue[cursor];
			component.push(current);
			for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
				const key = `${current.row + dr}:${current.col + dc}`;
				const neighbor = byCoordinate.get(key);
				if (neighbor && !visited.has(key)) { visited.add(key); queue.push(neighbor); }
			}
		}
		const top = Math.min(...component.map(cell => cell.row));
		const left = Math.min(...component.map(cell => cell.col));
		const bottom = Math.max(...component.map(cell => cell.row));
		const right = Math.max(...component.map(cell => cell.col));
		components.push({
			changed_cells: component.length,
			bbox: { top, left, bottom, right },
			// Translation-normalized post-values only: not a before/after effect or motion.
			shape_signature: JSON.stringify(component
				.sort((a, b) => a.row - b.row || a.col - b.col)
				.map(cell => [cell.row - top, cell.col - left, cell.value])),
			centroid: {
				row: component.reduce((sum, cell) => sum + cell.row, 0) / component.length,
				col: component.reduce((sum, cell) => sum + cell.col, 0) / component.length,
			},
		});
	}
	return components;
}

export function arcMatchingChangedComponents(
	components: ArcChangedComponent[], action: string, stateEpoch: number,
	actionEffects: Map<string, { attempts: number; distinct_effects: ArcEffectRecord[] }>,
): ArcChangedComponent[] {
	return components.map(component => {
		const matches = new Set([action]);
		for (const [priorAction, record] of actionEffects) {
			if (priorAction !== action && record.distinct_effects.some(effect =>
				effect.state_epoch === stateEpoch && effect.components.some(prior =>
					prior.shape_signature === component.shape_signature))) matches.add(priorAction);
		}
		return { ...component, matching_actions: [...matches].sort() };
	});
}

/** Shared bookkeeping for every committed native action, including batch members. */
export function arcRecordActionEffect(
	actionEffects: Map<string, { attempts: number; distinct_effects: ArcEffectRecord[] }>,
	input: { action: string; action_index: number; state_epoch: number;
		delta?: Record<string, any>; level_changed?: boolean },
): ArcEffectRecord {
	const epoch = input.state_epoch + (input.action === "RESET" ? 1 : 0) + (input.level_changed ? 1 : 0);
	const effect: ArcEffectRecord = {
		state_epoch: epoch,
		changed_cells: typeof input.delta?.changed_cells === "number" ? input.delta.changed_cells : null,
		bbox: input.delta?.bbox ?? null,
		components: arcMatchingChangedComponents(arcChangedComponents(input.delta), input.action, epoch, actionEffects),
		last_action_index: input.action_index,
	};
	const signature = (item: ArcEffectRecord) => JSON.stringify({ state_epoch: item.state_epoch,
		changed_cells: item.changed_cells, bbox: item.bbox,
		components: item.components.map(component => ({
			changed_cells: component.changed_cells, shape_signature: component.shape_signature, bbox: component.bbox,
		})),
	});
	const prior = actionEffects.get(input.action);
	const effects = [...(prior?.distinct_effects ?? [])];
	const currentSignature = signature(effect);
	const duplicate = effects.findIndex(item => signature(item) === currentSignature);
	if (duplicate >= 0) effects.splice(duplicate, 1);
	effects.push(effect);
	actionEffects.set(input.action, { attempts: (prior?.attempts ?? 0) + 1, distinct_effects: effects });
	return effect;
}

function compactDeltaCells(delta: Record<string, any>): string {
	const cells = Array.isArray(delta.cells) ? delta.cells as Array<Record<string, unknown>> : [];
	if (!cells.length) return "[]";
	const byRow = new Map<number, Array<[number, string]>>();
	for (const cell of cells) {
		const row = Number(cell.row), col = Number(cell.col);
		if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
		const entries = byRow.get(row) ?? [];
		const value = Object.prototype.hasOwnProperty.call(cell, "before")
			? `${String(cell.before)}>${String(cell.value)}` : String(cell.value);
		entries.push([col, value]);
		byRow.set(row, entries);
	}
	return JSON.stringify([...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([row, entries]) => {
		entries.sort((a, b) => a[0] - b[0]);
		const runs: string[] = [];
		let start = entries[0]?.[0], end = start, value = entries[0]?.[1];
		for (const [col, nextValue] of entries.slice(1)) {
			if (col === end! + 1 && nextValue === value) { end = col; continue; }
			runs.push(start === end ? `${start}=${value}` : `${start}-${end}=${value}`);
			start = end = col; value = nextValue;
		}
		if (start !== undefined) runs.push(start === end ? `${start}=${value}` : `${start}-${end}=${value}`);
		return { row, runs };
	}));
}

/** Only these deltas can replace historical final grids without losing pixels. */
export function arcHasExactSmallTransition(delta: Record<string, any>): boolean {
	const cells = Array.isArray(delta.cells) ? delta.cells : [];
	return Number.isInteger(delta.changed_cells) && delta.changed_cells >= 0 && delta.changed_cells <= 128
		&& delta.cells_truncated !== true && cells.length === delta.changed_cells
		&& cells.every((cell: Record<string, any>) => Number.isInteger(cell.row) && Number.isInteger(cell.col)
			&& Number.isInteger(cell.before) && Number.isInteger(cell.value));
}

export function renderArcDecisionDelta(delta: Record<string, any>, levelChanged: boolean): string {
	const prefix = `Observation delta (deterministic): changed_cells=${String(delta.changed_cells ?? 0)}, bbox=${JSON.stringify(delta.bbox ?? null)}`;
	// The next decision cycle receives the complete current frame. Large exact
	// deltas remain in the durable trace, where they can be inspected on demand.
	const cells = Array.isArray(delta.cells) ? delta.cells : [];
	if ((levelChanged && !arcHasExactSmallTransition(delta))
		|| Number(delta.changed_cells ?? 0) > 128 || delta.cells_truncated === true
		|| Number(delta.changed_cells ?? 0) > cells.length) {
		return `${prefix}, complete cells in bridge-events.jsonl; action results in execution-observations.jsonl (current complete frame is supplied next cycle).`;
	}
	const paired = cells.some((cell: Record<string, any>) => Object.prototype.hasOwnProperty.call(cell, "before"));
	return `${prefix}, row_runs=${compactDeltaCells(delta)}${paired ? ", values=before>after (unpaired entries are after-only)" : ""}`;
}

export function renderArcEffectLedger(actionEffects: Map<string, Record<string, any>>): string {
	const epoch = Math.max(0, ...[...actionEffects.values()].flatMap(record =>
		(record.distinct_effects ?? []).map((effect: ArcEffectRecord) => effect.state_epoch)));
	const projected = Object.fromEntries([...actionEffects].map(([action, record]) => {
		const effects = (Array.isArray(record.distinct_effects) ? record.distinct_effects : [])
			.filter((effect: ArcEffectRecord) => effect.state_epoch === epoch);
		const latest = effects.at(-1);
		return [action, {
			attempts: record.attempts,
			state_epoch: epoch,
			changed_cell_counts: [...new Set(effects.map((effect: ArcEffectRecord) => effect.changed_cells))].slice(-3),
			latest: latest ? { changed_cells: latest.changed_cells, bbox: latest.bbox,
				group_sizes: latest.components.map((c: ArcChangedComponent) => c.changed_cells).slice(0, 8),
				last_action_index: latest.last_action_index } : null,
		}];
	}));
	return `Compact action-effect ledger: ${JSON.stringify(projected)}. Counts are observations, not action meanings. Complete effects remain in the ARC trace.`;
}

function isRenderedArcFrame(message: Record<string, any>): boolean {
	return message.role === "toolResult" && Array.isArray(message.content)
		&& message.content.some((item: any) => item?.type === "text"
			&& /Lossless coordinate runs|ARC_OBSERVATION_VIEW/.test(String(item.text ?? "")));
}

function isArcActionResult(message: Record<string, any>): boolean {
	return message.role === "toolResult" && ["arc_action", "arc_actions"].includes(message.toolName)
		&& Array.isArray(message.content)
		&& message.content.some((item: any) => item?.type === "text"
			&& (message.toolName === "arc_action" ? String(item.text ?? "").includes("Current transition:")
				: String(item.text ?? "").startsWith("ARC batch completed ")));
}

export function compactHistoricalArcFrames(messages: any[]): any[] {
	// Repeated runner follow-ups carry identical procedure, never new evidence.
	// Fold only this exact instruction body; recovery and arbitrary user turns stay.
	const instructionKey = (message: any): string | undefined => message?.role === "user"
		&& message.content?.length === 1 && message.content[0]?.type === "text"
		&& String(message.content[0].text).startsWith("ARC decision-cycle contract:")
		? message.content[0].text : undefined;
	const latestInstruction = new Map<string, number>();
	messages.forEach((message, index) => {
		const key = instructionKey(message);
		if (key !== undefined) latestInstruction.set(key, index);
	});
	messages = messages.filter((message, index) => {
		const key = instructionKey(message);
		return key === undefined || latestInstruction.get(key) === index;
	});
	let latestFrameIndex = -1, latestActionIndex = -1;
	const consumedFrame = new Set<number>();
	let laterAssistant = false;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isRenderedArcFrame(messages[index])) {
			if (latestFrameIndex < 0) latestFrameIndex = index;
			if (laterAssistant) consumedFrame.add(index);
		}
		if (latestActionIndex < 0 && isArcActionResult(messages[index])) latestActionIndex = index;
		if (messages[index]?.role === "assistant") laterAssistant = true;
	}
	return messages.map((message, index) => {
		// Pi retains completed assistant thinking in its transcript. On real ARC
		// turns this can exceed the frame itself. Keep the tail (where the latest
		// conclusion normally sits), all tool calls, and the live continuation;
		// never rewrite a still-open assistant message at the end of context.
		if (process.env.PI_CONTEXT_REASONING_HISTORY === "discard_unsigned_thinking"
			&& !["length", "error", "aborted"].includes(message.stopReason)
			&& message.role === "assistant" && index < messages.length - 1
			&& Array.isArray(message.content)) {
			let changed = false;
			const content = message.content.map((part: any) => {
				if (part?.type !== "thinking" || part.thinkingSignature || part.signature || part.encrypted_content) return part;
				const body = String(part.thinking ?? part.text ?? "");
				if (body.length <= 1800) return part;
				changed = true;
				return { type: "text", text: `[Completed ARC reasoning abbreviated in model context; last 1200 characters follow. Current checkpoint and exact tool/observation evidence remain available.]\n${body.slice(-1200)}` };
			});
			if (changed) return { ...message, content };
		}
		if (isArcActionResult(message) && index !== latestActionIndex) {
			return { ...message, content: [{ type: "text", text: "[Historical ARC action result omitted; exact transition and delta remain in bridge-events.jsonl and execution-observations.jsonl. Current public frame is supplied at the next decision cycle.]" }] };
		}
		if (isRenderedArcFrame(message) && (index !== latestFrameIndex || latestActionIndex > index || consumedFrame.has(index))) {
			return { ...message, content: [{ type: "text", text: "[Historical ARC frame view omitted from model context; canonical public state remains in observation snapshots and bridge events. The complete current frame is automatically supplied in the current observation.]" }] };
		}
		return message;
	});
}
