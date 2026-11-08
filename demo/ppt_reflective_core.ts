import { spawnSync } from 'node:child_process';

export function createProcessCore({ state, binder, workspace, persist, log }: any) {
  const runHook = (hook: string, input: any) => {
    if (!hook.trim()) return undefined;
    const runner = `const vm=require('node:vm');const ts=require('node:module').stripTypeScriptTypes;let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>{try{const x=JSON.parse(raw);const code=ts(x.hook).replace(/export\\s+default\\s+function/, 'globalThis.default = function').replace(/export\\s+default\\s+/, 'globalThis.default = ');const box={};vm.runInNewContext(code,box,{timeout:120,maxStringLength:65536,codeGeneration:{strings:false,wasm:false}});if(typeof box.default!=='function')throw Error('default function export required');const out=box.default(x.input);if(out&&typeof out.then==='function')throw Error('async hooks are not supported');const s=JSON.stringify(out);if(!s||s.length>8192)throw Error('invalid or oversized output');process.stdout.write(s)}catch(e){process.stderr.write(String(e&&e.message||e).slice(0,1000));process.exitCode=1}})`;
    const child = spawnSync(process.execPath, ['--permission', '-e', runner], { input: JSON.stringify({ hook, input }), encoding: 'utf8', timeout: 500, maxBuffer: 16 * 1024, windowsHide: true });
    if (child.error || child.status !== 0) throw Error((child.stderr || String(child.error || 'hook failed')).slice(0, 1000));
    return JSON.parse(child.stdout);
  };
  const activate = () => {
    const pending = state.process.pending;
    if (!pending) return state.process.active;
    const references = ['workflow', 'loop'].flatMap(part => pending.envelope[part].refs ?? []);
    const incompatible = references.filter((ref: any) => !binder.active().some((c: any) => c.name === ref.name && c.kind === ref.kind && c.version === ref.version));
    if (incompatible.length) {
      state.process.pending = null;
      state.process.activationReceipt = { name: pending.name, version: pending.version, error: `references no longer active at exact versions: ${incompatible.map((r: any) => `${r.name}/${r.kind}@${r.version}`).join(', ')}` };
      persist(); log('lifecycle.jsonl', { event: 'process_activation_failed', ...state.process.activationReceipt });
      return state.process.active;
    }
    state.process.lastGood = state.process.active ?? state.process.lastGood ?? null;
    state.process.active = pending; state.process.pending = null; persist(); state.process.activationReceipt = null;
    log('lifecycle.jsonl', { event: 'process_activated', name: pending.name, version: pending.version });
    return pending;
  };
  const validate = (envelope: any) => {
    if (!envelope || Object.keys(envelope).some(k => !['workflow', 'loop'].includes(k)) || !envelope.workflow || !envelope.loop) throw Error('process requires workflow and loop parts');
    const components = binder.active();
    for (const partName of ['workflow', 'loop']) {
      const part = envelope[partName];
      if (Object.keys(part).some(k => !['strategy', 'hook', 'refs'].includes(k))) throw Error(`${partName} has unknown fields`);
      if (typeof part.strategy !== 'string' || part.strategy.length > 12000 || (part.hook !== undefined && (typeof part.hook !== 'string' || part.hook.length > 16000)) || !Array.isArray(part.refs ?? []) || (part.refs?.length ?? 0) > 32) throw Error(`${partName} has invalid shape`);
      for (const ref of part.refs ?? []) {
        if (!ref || Object.keys(ref).some(k => !['name', 'kind', 'version'].includes(k)) || typeof ref.name !== 'string' || typeof ref.kind !== 'string' || !Number.isSafeInteger(ref.version)) throw Error(`${partName} has invalid component reference`);
        if (!components.some((c: any) => c.name === ref.name && c.kind === ref.kind && c.version === ref.version)) throw Error(`unresolved exact reference ${ref.name}/${ref.kind}@${ref.version}`);
      }
      if (part.hook?.trim()) {
        const probe = partName === 'workflow' ? { transition: 'render', allow: true } : { decision: 'continue', guidance: '' };
        const result = runHook(part.hook, probe);
        if (partName === 'workflow' && (!result || typeof result.allow !== 'boolean' || (result.guidance !== undefined && typeof result.guidance !== 'string'))) throw Error('workflow hook export must return {allow:boolean,guidance?:string}');
        if (partName === 'loop' && (!result || !['continue', 'adapt', 'stop'].includes(result.decision) || (result.guidance !== undefined && typeof result.guidance !== 'string'))) throw Error('loop hook export must return {decision:continue|adapt|stop,guidance?:string}');
      }
    }
  };
  const boundary = (name: 'before-action' | 'before-submit/deliver' | 'settle', action: string, active: any, input: any, useHook: boolean) =>
    ({ name, action, active, input, useHook });
  const contextAdditions = () => {
    const additions: any[] = [];
    const active = state.process.active;
    if (active) for (const part of ['workflow', 'loop']) if (active.envelope[part].strategy)
      additions.push({ kind: 'process', name: active.name, version: active.version, text: `${part.toUpperCase()} STRATEGY\n${active.envelope[part].strategy}` });
    if (state.process.activationReceipt) additions.push({ kind: 'process', name: state.process.activationReceipt.name, version: state.process.activationReceipt.version,
      text: `Activation receipt: ${state.process.activationReceipt.error}` });
    return additions;
  };
  const beforeAction = (call: any) => {
    const { action, active, input } = call;
    if (!active || !call.useHook) return;
    if (!active.envelope.workflow.hook?.trim()) {
      log('process_boundaries.jsonl', { part: 'workflow', process_version: active.version, name: active.name, inputs: input, outcome: 'strategy_only', changed_action: false });
      state.process.lastGood = active; persist();
      return;
    }
    try {
      const decision = runHook(active.envelope.workflow.hook, { ...input, process_version: active.version });
      if (!decision || typeof decision.allow !== 'boolean' || (decision.guidance !== undefined && typeof decision.guidance !== 'string')) throw Error('workflow hook must return {allow:boolean,guidance?:string}');
      log('process_boundaries.jsonl', { part: 'workflow', process_version: active.version, name: active.name, inputs: input, outcome: decision });
      if (!decision.allow) throw Error(`process denied ${action}: ${String(decision.guidance ?? '').slice(0, 500)}`);
      state.process.lastGood = active; persist();
    } catch (error) {
      state.process.active = state.process.lastGood ?? null; state.process.failures.push(String(error)); persist();
      log('process_boundaries.jsonl', { part: 'workflow', process_version: active.version, inputs: input, outcome: 'failure', error: String(error).slice(0, 1000), last_good: state.process.active?.version ?? null });
      throw Error(`process hook failed; ${action} was not performed: ${String(error).slice(0, 1000)}`);
    }
  };
  const settle = (active: any, input: any) => {
    const hook = active.envelope.loop.hook;
    if (!hook?.trim()) {
      log('process_boundaries.jsonl', { part: 'loop', name: active.name, process_version: active.version, inputs: input, outcome: 'strategy_only', changed_action: false });
      state.process.lastGood = active; persist();
      return false;
    }
    try {
      const decision = runHook(hook, input);
      if (!decision || !['continue', 'adapt', 'stop'].includes(decision.decision) || (decision.guidance !== undefined && typeof decision.guidance !== 'string')) throw Error('loop hook must return {decision:continue|adapt|stop,guidance?:string}');
      state.process.next = { decision: decision.decision, guidance: (decision.guidance ?? '').slice(0, 1000), version: active.version };
      state.process.lastGood = active;
      const baselineAction = input.stop_reason === 'length' ? 'PPT_RESUME' : 'PPT_NEXT';
      const chosenAction = decision.decision === 'stop' ? 'STOP' : 'PPT_NEXT';
      const changedAction = chosenAction !== baselineAction || Boolean(decision.guidance);
      log('process_boundaries.jsonl', { part: 'loop', name: active.name, process_version: active.version, inputs: input, outcome: state.process.next, baseline_action: baselineAction, chosen_action: chosenAction, changed_action: changedAction });
      persist();
    } catch (error) {
      state.process.active = state.process.lastGood ?? null; state.process.next = { decision: 'error', version: active.version, error: String(error).slice(0, 1000) };
      log('process_boundaries.jsonl', { part: 'loop', name: active.name, process_version: active.version, inputs: input, outcome: 'failure', error: String(error).slice(0, 1000), changed_action: false });
      persist();
    }
    return true;
  };
  return { runHook, activate, validate, boundary, contextAdditions, beforeAction, settle };
}
