/** Consult failures that release only the consult-first review gate. */
const SERVICE_PREFIXES = [
  'consult tool/time budget exhausted',
  'consult round budget exhausted',
  'consult time budget exhausted',
  'consult length continuation exhausted',
  'consult aborted',
  'consult error',
];

export function consultServiceFailure(message: string): boolean {
  const text = message.trim().toLowerCase();
  return SERVICE_PREFIXES.some(prefix => text.startsWith(prefix));
}

export function consultFirstBlocks(state: { consultPoint?: boolean; consulted?: boolean }, tool: string): boolean {
  const path = tool.replaceAll(String.fromCharCode(92), '/');
  return Boolean(state.consultPoint && !state.consulted && !path.startsWith('agents/'));
}

export function consultBudgetError(rounds: number, timeExpired: boolean): string {
  return rounds >= 6 && !timeExpired ? 'consult round budget exhausted (6 rounds)' : 'consult time budget exhausted (120 s)';
}
