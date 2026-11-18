export type RuntimeContinuationRecord = {
  runId: string;
  version: number;
  state: unknown;
  evidenceRefs: string[];
};

export type RuntimeContinuationSnapshot = { records: RuntimeContinuationRecord[] };

export type RuntimeContinuationPrompt = {
  runId: string;
  version: number;
  state: unknown;
  evidence: Array<{ ref: string; available: boolean; value?: unknown }>;
};

function cloneJson<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('continuation state must be a JSON value');
  return JSON.parse(encoded);
}

export class RuntimeContinuationStore {
  private records = new Map<string, RuntimeContinuationRecord[]>();

  static fromSnapshot(snapshot: RuntimeContinuationSnapshot) {
    if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('invalid continuation snapshot');
    const store = new RuntimeContinuationStore();
    for (const record of snapshot.records) {
      if (!record || typeof record.runId !== 'string' || !record.runId || !Number.isSafeInteger(record.version) || record.version < 1 ||
          !Array.isArray(record.evidenceRefs) || record.evidenceRefs.some(ref => typeof ref !== 'string')) throw new Error('invalid continuation snapshot');
      const versions = store.records.get(record.runId) ?? [];
      if (record.version !== versions.length + 1) throw new Error('invalid continuation snapshot version history');
      const state = cloneJson(record.state);
      versions.push({ runId: record.runId, version: record.version, state, evidenceRefs: [...record.evidenceRefs] });
      store.records.set(record.runId, versions);
    }
    return store;
  }

  save(input: { runId: string; state: unknown; evidenceRefs: string[]; expectedVersion: number }): RuntimeContinuationRecord {
    if (typeof input.runId !== 'string' || !input.runId || !Array.isArray(input.evidenceRefs) || input.evidenceRefs.some(ref => typeof ref !== 'string'))
      throw new Error('invalid continuation record');
    const versions = this.records.get(input.runId) ?? [];
    const currentVersion = versions.at(-1)?.version ?? 0;
    if (input.expectedVersion !== currentVersion) throw new Error(`continuation version conflict for ${input.runId}`);
    const record = { runId: input.runId, version: currentVersion + 1, state: cloneJson(input.state), evidenceRefs: [...input.evidenceRefs] };
    versions.push(record);
    this.records.set(input.runId, versions);
    return cloneJson(record);
  }

  load(runId: string, version?: number): RuntimeContinuationRecord | undefined {
    const records = this.records.get(runId);
    const record = version === undefined ? records?.at(-1) : records?.find(item => item.version === version);
    return record && cloneJson(record);
  }

  preparePrompt(runId: string, resolveEvidence: (ref: string) => unknown, version?: number): RuntimeContinuationPrompt | undefined {
    const record = this.load(runId, version);
    if (!record) return undefined;
    const evidence = record.evidenceRefs.map(ref => {
      const value = resolveEvidence(ref);
      return value === undefined ? { ref, available: false } : { ref, available: true, value: cloneJson(value) };
    });
    return { runId: record.runId, version: record.version, state: record.state, evidence };
  }

  snapshot(): RuntimeContinuationSnapshot {
    return { records: [...this.records.values()].flatMap(records => records.map(cloneJson)) };
  }
}
