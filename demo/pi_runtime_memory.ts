import { RuntimeMemoryStore, type RuntimeMemoryRecord } from './runtime_memory_store.ts';

const ENTRY_TYPE = 'runtime-memory';

type MemoryEntry = {
  type: 'custom';
  customType: string;
  data: { operation: 'write'; record: RuntimeMemoryRecord } | { operation: 'retire'; id: string; expectedVersion: number };
};

export type PiRuntimeMemory = {
  read: (id: string, version?: number) => RuntimeMemoryRecord | undefined;
  search: (query: string, options?: { scope?: string; includeRetired?: boolean; limit?: number }) => ReturnType<RuntimeMemoryStore['search']>;
  write: (input: { id: string; source: string; scope?: string; provenance?: string[]; expectedVersion?: number }) => RuntimeMemoryRecord;
  retire: (id: string, expectedVersion: number) => RuntimeMemoryRecord;
};

export function createPiRuntimeMemory(pi: any, ctx: any): PiRuntimeMemory {
  const entries = (): MemoryEntry[] => ctx.sessionManager.getEntries()
    .filter((entry: any): entry is MemoryEntry => entry.type === 'custom' && entry.customType === ENTRY_TYPE);
  const load = () => {
    const store = new RuntimeMemoryStore();
    for (const entry of entries()) {
      if (entry.data.operation === 'write') {
        const record = entry.data.record;
        store.write({ id: record.id, source: record.source, scope: record.scope, provenance: record.provenance,
          expectedVersion: store.read(record.id)?.version ?? 0 });
      } else {
        store.retire(entry.data.id, entry.data.expectedVersion);
      }
    }
    return store;
  };
  return {
    read: (id, version) => load().read(id, version),
    search: (query, options) => load().search(query, options),
    write: input => {
      const store = load();
      const record = store.write(input);
      pi.appendEntry(ENTRY_TYPE, { operation: 'write', record });
      return record;
    },
    retire: (id, expectedVersion) => {
      const store = load();
      const record = store.retire(id, expectedVersion);
      pi.appendEntry(ENTRY_TYPE, { operation: 'retire', id, expectedVersion });
      return record;
    },
  };
}
