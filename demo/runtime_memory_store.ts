export type RuntimeMemoryStatus = 'active' | 'retired';

export type RuntimeMemoryRecord = {
  id: string;
  version: number;
  source: string;
  scope?: string;
  provenance: string[];
  status: RuntimeMemoryStatus;
};

export type RuntimeMemorySearchResult = {
  id: string;
  version: number;
  scope?: string;
  preview: string;
};

export type RuntimeMemorySnapshot = {
  records: RuntimeMemoryRecord[];
};

export type RuntimeMemoryStoreSnapshot = RuntimeMemorySnapshot;

export class RuntimeMemoryStore {
  private records = new Map<string, RuntimeMemoryRecord[]>();

  static fromSnapshot(snapshot: RuntimeMemorySnapshot) {
    if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('invalid memory snapshot');
    const store = new RuntimeMemoryStore();
    for (const record of snapshot.records) {
      if (!record || typeof record.id !== 'string' || !record.id || !Number.isSafeInteger(record.version) || record.version < 1 ||
          typeof record.source !== 'string' || (record.scope !== undefined && typeof record.scope !== 'string') ||
          !Array.isArray(record.provenance) || record.provenance.some(item => typeof item !== 'string') ||
          !['active', 'retired'].includes(record.status)) throw new Error('invalid memory snapshot');
      const versions = store.records.get(record.id) ?? [];
      if (versions.length && (record.version !== versions.at(-1)!.version + 1 || record.status === 'retired' && versions.at(-1)!.status === 'retired'))
        throw new Error('invalid memory snapshot version history');
      if (!versions.length && record.version !== 1) throw new Error('invalid memory snapshot version history');
      versions.push({ ...record, provenance: [...record.provenance] });
      store.records.set(record.id, versions);
    }
    return store;
  }

  static fromSerialized(serialized: string): RuntimeMemoryStore {
    const snapshot = JSON.parse(serialized) as RuntimeMemorySnapshot;
    return RuntimeMemoryStore.fromSnapshot(snapshot);
  }

  write(input: { id: string; source: string; scope?: string; provenance?: string[]; expectedVersion?: number }): RuntimeMemoryRecord {
    if (typeof input.id !== 'string' || !input.id || typeof input.source !== 'string' ||
        (input.scope !== undefined && typeof input.scope !== 'string') ||
        (input.provenance !== undefined && (!Array.isArray(input.provenance) || input.provenance.some(item => typeof item !== 'string'))))
      throw new Error('invalid memory record');
    const versions = this.records.get(input.id) ?? [];
    const current = versions.at(-1);
    if (input.expectedVersion !== undefined && input.expectedVersion !== (current?.version ?? 0)) {
      throw new Error(`memory version conflict for ${input.id}`);
    }
    const record: RuntimeMemoryRecord = {
      id: input.id,
      version: (current?.version ?? 0) + 1,
      source: input.source,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      provenance: [...(input.provenance ?? [])],
      status: 'active',
    };
    versions.push(record);
    this.records.set(input.id, versions);
    return { ...record, provenance: [...record.provenance] };
  }

  read(id: string, version?: number): RuntimeMemoryRecord | undefined {
    const records = this.records.get(id);
    const record = version === undefined ? records?.at(-1) : records?.find(item => item.version === version);
    return record && { ...record, provenance: [...record.provenance] };
  }

  search(query: string, options: { scope?: string; includeRetired?: boolean; limit?: number } = {}): RuntimeMemorySearchResult[] {
    if (typeof query !== 'string') throw new Error('memory query must be text');
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0)) throw new Error('memory search limit must be a non-negative integer');
    const needle = query.toLocaleLowerCase();
    const matches = [...this.records.values()].flatMap(versions => {
      const record = versions.at(-1)!;
      if ((!options.includeRetired && record.status === 'retired') ||
          (options.scope !== undefined && record.scope !== options.scope) ||
          !record.source.toLocaleLowerCase().includes(needle)) return [];
      return [{ id: record.id, version: record.version, ...(record.scope === undefined ? {} : { scope: record.scope }), preview: record.source.slice(0, 160) }];
    });
    return matches.slice(0, options.limit ?? matches.length);
  }

  retire(id: string, expectedVersion: number): RuntimeMemoryRecord {
    const current = this.read(id);
    if (!current || current.version !== expectedVersion) throw new Error(`memory version conflict for ${id}`);
    if (current.status === 'retired') throw new Error(`memory ${id} is already retired`);
    const retired = { ...current, status: 'retired' as const };
    this.records.get(id)![this.records.get(id)!.length - 1] = retired;
    return { ...retired, provenance: [...retired.provenance] };
  }

  snapshot(): RuntimeMemorySnapshot {
    return { records: [...this.records.values()].flatMap(versions => versions.map(record => ({ ...record, provenance: [...record.provenance] }))) };
  }

  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  entries(): RuntimeMemorySearchResult[] {
    return this.search('');
  }
}
