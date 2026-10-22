export function consultBudgetError(rounds: number, timeExpired: boolean): string {
  return rounds >= 6 && !timeExpired ? 'consult round budget exhausted (6 rounds)' : 'consult time budget exhausted (120 s)';
}

/** A mechanical failure receipt: it labels partial text and returns only refs the caller already supplied. */
export function consultFailureDelivery(error: string, partial: string, refs: string[]): string {
  return [
    `CONSULT INCOMPLETE: ${error}`,
    `Known: ${partial.trim() ? `last child text (not a final conclusion): ${partial.trim()}` : 'no conclusion was returned'}`,
    'Unknown: a final synthesis was not returned; the runtime did not infer one.',
    `Evidence refs: ${refs.length ? refs.join(', ') : '(none supplied)'}`,
  ].join('\n');
}
