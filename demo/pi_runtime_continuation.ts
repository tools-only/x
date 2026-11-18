import { RuntimeContinuationStore } from './runtime_continuation_store.ts';

const ENTRY_TYPE = 'runtime-continuation';

type ContinuationEntry = {
  type: 'custom';
  customType: string;
  data: { runId: string; version: number; state: unknown; evidenceRefs: string[] };
};

export type RuntimeContinuationPolicy = {
  resolveEvidence: (ref: string, ctx: any) => unknown;
  selectRun?: (entries: readonly ContinuationEntry[], event: any, ctx: any) => string | undefined;
};

export function installPiRuntimeContinuation(pi: any, policy: RuntimeContinuationPolicy) {
  const entriesOf = (ctx: any) => ctx.sessionManager.getEntries()
    .filter((entry: any): entry is ContinuationEntry => entry.type === 'custom' && entry.customType === ENTRY_TYPE);

  const save = (event: any, ctx: any) => {
    const entries = entriesOf(ctx);
    const runRecords = entries.filter(entry => entry.data.runId === event.runId);
    const store = RuntimeContinuationStore.fromSnapshot({ records: runRecords.map(entry => entry.data) });
    const current = store.load(event.runId);
    const record = store.save({
      runId: event.runId,
      state: event.state,
      evidenceRefs: event.evidenceRefs ?? [],
      expectedVersion: current?.version ?? 0,
    });
    pi.appendEntry(ENTRY_TYPE, record);
    return record;
  };
  pi.on('runtime_continuation_save', save);

  pi.on('before_agent_start', (event: any, ctx: any) => {
    const entries = entriesOf(ctx);
    if (!entries.length) return;
    const runId = policy.selectRun?.(entries, event, ctx) ?? entries.at(-1)?.data.runId;
    if (!runId) return;
    const records = entries.filter(entry => entry.data.runId === runId).map(entry => entry.data);
    const store = RuntimeContinuationStore.fromSnapshot({ records });
    const continuation = store.preparePrompt(runId, ref => policy.resolveEvidence(ref, ctx));
    if (!continuation) return;
    return { systemPrompt: `${event.systemPrompt ?? ''}\n\nRuntime continuation (authoritative saved state):\n${JSON.stringify(continuation)}` };
  });

  return { save: (ctx: any, input: { runId: string; state: unknown; evidenceRefs?: string[] }) => save(input, ctx) };
}
