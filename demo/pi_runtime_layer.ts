import { installPiCompactionAdapter, type CompactionPolicy } from './pi_compaction_adapter.ts';
import { createPiRuntimeMemory, type PiRuntimeMemory } from './pi_runtime_memory.ts';
import { installPiRuntimeContinuation, type RuntimeContinuationPolicy } from './pi_runtime_continuation.ts';

export type PiRuntimeLayerPolicy = {
  compaction: CompactionPolicy;
  continuation: RuntimeContinuationPolicy;
};

export function installPiRuntimeLayer(pi: any, policy: PiRuntimeLayerPolicy) {
  installPiCompactionAdapter(pi, policy.compaction);
  const continuation = installPiRuntimeContinuation(pi, policy.continuation);
  return {
    memory: (ctx: any): PiRuntimeMemory => createPiRuntimeMemory(pi, ctx),
    continuation,
  };
}
