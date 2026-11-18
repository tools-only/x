export type PiCompactionEvents = {
  on(event: 'session_before_compact', handler: (event: any) => unknown): void;
  on(event: 'session_compact', handler: (event: any) => unknown): void;
};

export type CompactionPolicy = {
  prepare: (event: any) => unknown | undefined;
  onUnexpected: (event: any) => unknown;
  onRestored: (event: any) => unknown;
};

export function installPiCompactionAdapter(pi: PiCompactionEvents, policy: CompactionPolicy) {
  pi.on('session_before_compact', event => policy.prepare(event) ?? policy.onUnexpected(event));
  pi.on('session_compact', event => policy.onRestored(event));
}
