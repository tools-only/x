/** Arguments with their keys sorted, so a call compares equal however its keys were ordered. */
export const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;

/**
 * Bound identical no-progress observations/errors, not legitimate investigation length. Failed calls and reads repeat
 * by their arguments; any other call that succeeded repeats only with the same result too, since a python call can
 * carry state the epoch does not show. Without results (`{ results: false }`, the earlier rule) a call that succeeded
 * never counted, and su15-r1-B2 (2026-10-16) ran one python call 20 times in a row with the same output until the
 * provider refused the conversation.
 */
export class NativeLoopGuard {
  private last = '';
  private count = 0;
  private epoch = '';
  private readonly counts = new Map<string, number>();
  private readonly results: boolean;
  constructor(options: { results?: boolean } = {}) { this.results = options.results !== false; }
  reset() { this.last = ''; this.count = 0; this.epoch = ''; this.counts.clear(); }
  record(name: string, args: unknown, epoch: string, failed: boolean, result = ''): boolean {
    const readOnly = ['read', 'ls', 'grep'].includes(name);
    if (this.epoch !== epoch) { this.last = ''; this.count = 0; this.counts.clear(); this.epoch = epoch; }
    if (!failed && !readOnly && !this.results) { this.last = ''; this.count = 0; return false; }
    const signature = JSON.stringify([name, canonical(args), failed, failed || readOnly ? '' : result]);
    this.count = signature === this.last ? this.count + 1 : 1; this.last = signature;
    const count = (this.counts.get(signature) ?? 0) + 1; this.counts.set(signature, count);
    return count >= 3;
  }
}

/** A procedure gate may refuse at most `cap` times in one decision, then releases the call. */
export function releaseAfterRefusals(refusals: number, cap = 2): boolean {
  return refusals > Math.max(1, Math.floor(cap));
}
