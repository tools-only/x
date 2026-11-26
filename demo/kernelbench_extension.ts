/** Minimal Pi host for KernelBench. The Agent edits a confined workspace and requests evaluations. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';

export default function kernelbench(pi: ExtensionAPI) {
  const root = process.env.KERNELBENCH_RUN_ROOT!;
  const workspace = new Workspace(root, { dirs: ['work', 'attempts', 'results'] });
  for (const name of ['task.triton', 'reference.py', 'task.json']) {
    workspace.runtimeWrite(name, readFileSync(join(root, name)));
  }
  for (const tool of workspace.fileTools()) pi.registerTool(tool);
  pi.registerTool({
    name: 'kernel_eval', label: 'kernel_eval', executionMode: 'sequential',
    description: 'Evaluate work/candidate.py against the fixed KernelBench task. check tests correctness without performance timing. benchmark runs the full correctness and latency protocol.',
    parameters: Type.Object({ mode: Type.Union([Type.Literal('check'), Type.Literal('benchmark')]) }),
    execute: async (_id, args, signal, update) => {
      const source = workspace.read('work/candidate.py');
      const candidateHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
      const digest = [...new Uint8Array(candidateHash)].map(value => value.toString(16).padStart(2, '0')).join('');
      const snapshot = `attempts/${digest}.py`;
      workspace.runtimeWrite(snapshot, source);
      const request = {
        program_src: source, task: JSON.parse(workspace.read('task.json')).task,
        eval_mode: 'kernelbench_official', program_format: 'auto',
        backend: process.env.KERNELBENCH_BACKEND ?? 'cuda', precision: 'fp32', timing_method: 'cuda_event',
        num_correct_trials: args.mode === 'check' ? 1 : 5,
        num_perf_trials: args.mode === 'check' ? 1 : 100,
        measure_performance: args.mode === 'benchmark',
        seed_num: 42, gpu_id: 0, verbose: false,
        include_reference_timing: args.mode === 'benchmark' && process.env.KERNELBENCH_REFERENCE_TIMING === '1',
        ref_num_trials: 100,
      };
      const started = Date.now();
      update({ content: [{ type: 'text', text: `KernelBench ${args.mode} started for ${request.task}.` }] });
      try {
        const response = await fetch(`${process.env.KERNELBENCH_SERVER_URL}/evaluate`, {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (!response.ok) throw Error(`evaluator HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`);
        const payload = await response.json();
        const result = payload?.result;
        if (!result || typeof result !== 'object' || !('compiled' in result) || !('correctness' in result))
          throw Error('evaluator response is missing compiled/correctness fields');
        const summary = { task: request.task, mode: args.mode, candidate_sha256: digest,
          candidate_snapshot: snapshot, backend: request.backend, elapsed_seconds: (Date.now() - started) / 1000,
          evaluation_status: 'completed', benchmark_evaluation: result };
        workspace.runtimeWrite('evaluations.jsonl', (workspace.files().includes('evaluations.jsonl') ? workspace.read('evaluations.jsonl') : '') + JSON.stringify(summary) + '\n');
        workspace.runtimeWrite('evaluation.json', JSON.stringify(summary, null, 2) + '\n');
        return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
      } catch (error) {
        const summary = { task: request.task, mode: args.mode, candidate_sha256: digest,
          candidate_snapshot: snapshot, backend: request.backend, elapsed_seconds: (Date.now() - started) / 1000,
          evaluation_status: 'infrastructure_error', error: String(error) };
        workspace.runtimeWrite('evaluations.jsonl', (workspace.files().includes('evaluations.jsonl') ? workspace.read('evaluations.jsonl') : '') + JSON.stringify(summary) + '\n');
        workspace.runtimeWrite('evaluation.json', JSON.stringify(summary, null, 2) + '\n');
        return { content: [{ type: 'text', text: JSON.stringify(summary) }], isError: true };
      }
    },
  });
  pi.on('before_agent_start', async () => ({ systemPrompt: `You are optimizing one KernelBench GPU kernel. Read task.triton and reference.py. Write a complete candidate to work/candidate.py, run kernel_eval(mode="check") for correctness feedback, then use benchmark for full latency measurement. Preserve the reference semantics. Use the evaluator feedback to decide each next edit. The task work directory is confined to this run.` }));
}
