/** Arguments with their keys sorted, so a call compares equal however its keys were ordered. */
export const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;

/** Bound identical no-progress observations/errors, not legitimate investigation length. */
export class NativeLoopGuard {
  private last = '';
  private count = 0;
  reset() { this.last = ''; this.count = 0; }
  record(name: string, args: unknown, epoch: string, failed: boolean): boolean {
    if (!failed && !['read', 'ls', 'grep'].includes(name)) { this.reset(); return false; }
    const signature = JSON.stringify([name, canonical(args), epoch, failed]);
    this.count = signature === this.last ? this.count + 1 : 1; this.last = signature;
    return this.count >= 3;
  }
}
