/** A parent-selected stop condition for an already authorized ARC batch. */
export function arcBatchDeltaStopReason(
	delta: unknown, threshold: number | undefined, index: number,
): string | null {
	if (threshold === undefined) return null;
	if (!Number.isInteger(threshold) || threshold < 0 || threshold > 4096)
		throw new Error("stop_if_changed_cells_lte must be an integer in 0..4096");
	const changed = delta && typeof delta === "object"
		? (delta as Record<string, unknown>).changed_cells : undefined;
	if (typeof changed !== "number" || !Number.isInteger(changed) || changed < 0 || changed > 4096)
		return `changed_cells_unavailable:action_${index}`;
	return changed <= threshold
		? `changed_cells_lte_${threshold}:action_${index}:observed_${changed}` : null;
}
