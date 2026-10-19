// What the agent used of its harness, per run (self-evolve loop, docs/plans/2026-10-18-self-evolve-loop.md, iteration 3):
// its tool calls by name; components saved (tools, views, libraries) and by whom; calls of saved tools; memory writes
// (facts, hypotheses, hypotheses with a check) by author and memory reads; prompts written by the agent; refine and
// consult calls; refinement edits by target. Works on a running run. A component counts as used only when the agent
// called it; being in the context is not use.
// Usage: node tools/arc_adoption.mjs <runs dir> <label> [<label> ...]    (a run is <runs dir>/<label>/arc-run)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, ...labels] = process.argv.slice(2);
const read = (path) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const count = (items) => items.reduce((acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }), {});
const BUILT_IN = new Set(['arc_action', 'python', 'memory', 'read', 'write', 'edit', 'consult', 'refine', 'skill', 'run_skill', 'prompt', 'ask_analyst']);

const out = [];
for (const label of labels) {
  const root = join(base, label, 'arc-run');
  const harness = join(root, 'harness');
  const calls = read(join(root, 'session.jsonl')).filter((entry) => entry?.message?.role === 'assistant')
    .flatMap((entry) => (entry.message.content ?? []).filter((block) => block?.type === 'toolCall'));
  const byName = count(calls.map((call) => call.name));
  const pathsOf = (name) => calls.filter((call) => call.name === name).map((call) => String(call.arguments?.path ?? '?'));
  const kindOfPath = (path) => path.replace(/^(tools|observers|lib|skills|prompts|data)\/.*$/, '$1/') || path;
  const runs = read(join(harness, 'component_runs.jsonl'));
  const refiner = read(join(harness, 'refiner.jsonl'));
  const refinedPaths = new Set(refiner.filter((row) => row.kind === 'edit' && typeof row.path === 'string').map((row) => row.path));
  const saves = runs.filter((row) => row.kind === 'save');
  const memory = read(join(harness, 'memory.jsonl')).filter((row) => typeof row.key === 'string');
  const author = (row) => row.by ?? 'agent';
  const python = calls.filter((call) => call.name === 'python').map((call) => String(call.arguments?.code ?? ''));
  const rows = read(join(harness, 'trajectory.jsonl'));
  out.push({
    label, actions: rows.length, levels: rows.at(-1)?.levels_completed ?? 0, decisions: new Set(rows.map((row) => row.decision)).size,
    agent_calls: byName,
    saved_tool_calls: count(Object.keys(byName).filter((name) => !BUILT_IN.has(name)).flatMap((name) => Array(byName[name]).fill(name))),
    components_saved: count(saves.map((row) => `${row.path} by ${refinedPaths.has(row.path) ? 'refinement' : 'agent'}${row.ok ? '' : ' (not loaded)'}`)),
    component_calls: count(runs.filter((row) => row.kind === 'tool').map((row) => row.path)),
    acting_code_actions: count(rows.filter((row) => row.via).map((row) => row.via)),
    python_cells: python.length, python_saves: python.filter((code) => /\bsave\s*=/.test(code)).length,
    agent_writes: count([...pathsOf('write'), ...pathsOf('edit')].map(kindOfPath)),
    agent_reads: count(pathsOf('read').map((path) => path.startsWith('data/observations/') ? 'data/observations/' : path)),
    memory_ops: count(calls.filter((call) => call.name === 'memory').map((call) => String(call.arguments?.op ?? 'set'))),
    memory_writes: count(memory.filter((row) => !row.deleted).map((row) => `${author(row)} ${row.hyp ? (row.hyp.check ? 'hypothesis+check' : 'hypothesis') : 'fact'}`)),
    refine_calls: byName.refine ?? 0, consult_calls: byName.consult ?? 0,
    refinement_edits: count(refiner.filter((row) => row.kind === 'edit').map((row) => String(row.path ?? '?').replace(/^memory:hyp\..*/, 'memory:hyp.*').replace(/^memory:(?!hyp).*/, 'memory:fact').replace(/^tools\/.*/, 'tools/'))),
  });
}
console.log(JSON.stringify(out, null, 1));
