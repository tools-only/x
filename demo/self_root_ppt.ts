/** PPT facts/tools only. Semantic review stays on the executing SelfRoot. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { SelfRoot, hash, type SelfContract } from './self_root.ts';

export type SelfRootManifest = {
  experiment_id: string; provider: string; model: string; contract: SelfContract;
  sources: Record<string,string>; units: Array<{ id: string; title: string; required: string[]; citation: string }>;
  checker: { version: string; sha256: string }; settings: any; engineering_commit: string;
};
export function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return readdirSync(path, { withFileTypes: true }).reduce((sum,e) => {
      if (e.isSymbolicLink() || e.name === 'browser-profile' || e.name.endsWith('.tmp')) return sum;
      const child = join(path, e.name);
      try { return sum + (e.isDirectory() ? directoryBytes(child) : statSync(child).size); }
      catch { return sum; }
    }, 0);
  } catch { return 0; }
}
const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export function coverageFacts(source: string, definitions: SelfRootManifest['units']) {
  const plain = (s: string) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/[−–]/g,'-').replace(/\s+/g,' ');
  const visible = plain(source);
  const slides: string[] = [];
  let active: { tag: string; start: number; depth: number } | undefined;
  for (const tag of source.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
    const closing = tag[0].startsWith('</'), name = tag[1].toLowerCase();
    if (active) {
      if (name === active.tag) active.depth += closing ? -1 : 1;
      if (!active.depth) { slides.push(source.slice(active.start,tag.index!+tag[0].length)); active = undefined; }
    } else if (!closing && /class\s*=\s*["'][^"']*\bslide\b[^"']*["']/i.test(tag[0])) active = { tag: name, start: tag.index!, depth: 1 };
  }
  const sections = source.match(/<section\b[^>]*>[\s\S]*?<\/section>/gi);
  const fragments = slides.length ? slides : sections ?? [source];
  const scope = slides.length ? 'slide_elements' : sections ? 'section_elements' : 'whole_document_unscoped';
  const numbers = (s: string) => [...s.matchAll(/(?<![\w.])(?:\(\s*)?[-+]?\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*%?\s*\)?(?![\w.])/g)]
    .map(m => { const value = m[0].trim(); return `${value.includes('(') || value.startsWith('-') ? '-' : ''}${value.replace(/[^\d.%]/g,'')}`; });
  return definitions.map(u => {
    const page = u.citation.match(/^Source page (\d+)$/i)?.[1];
    const citation = page ? new RegExp(`(?:source\\s+page\\s+|\\bp\\.\\s*|\\bpage\\s+)${page}(?!\\d)`, 'i') : undefined;
    const cited = fragments.map(plain).filter(s => citation ? citation.test(s) : s.toLowerCase().includes(u.citation.toLowerCase()));
    const scoped = cited.flatMap(numbers);
    return { id: u.id,
      literal_matches: u.required.map(text => ({ text, found: visible.toLowerCase().includes(text.toLowerCase()) })),
      citation_literal: { text: u.citation, found: visible.includes(u.citation) },
      normalized: { citation_found: cited.length > 0, cited_fragments: cited.length, scope,
        matches: u.required.map(text => ({ text, token: numbers(text)[0], found: scope === 'whole_document_unscoped' ? null : scoped.includes(numbers(text)[0]) })) } };
  });
}
export function collectAcceptance(m: SelfRootManifest, root: string, workspace: any, sourcePath: string, receipt: any, exit: number | null, unit?: string) {
  const acceptance = m.contract.acceptance as any;
  if (acceptance.units_sha256 && acceptance.units_sha256 !== hash(m.units)) throw Error('protected acceptance unit definition mismatch');
  const checkerPath = new URL('./self_root_ppt.ts', import.meta.url);
  if (fileHash(checkerPath as any) !== m.checker.sha256) throw Error('protected checker version mismatch');
  const sources = Object.fromEntries(Object.keys(m.sources).map(p => [p,fileHash(workspace.path(p))]));
  if (hash(sources) !== hash(m.sources)) throw Error('protected source snapshot mismatch');
  const source = workspace.read(sourcePath);
  const units = coverageFacts(source,m.units.filter(u => !unit || u.id === unit));
  const artifacts = join(root,'exports',`v${String(receipt.revision).padStart(3,'0')}`);
  return { source: 'protected_acceptance', checker: m.checker, source_hashes: sources,
    artifact: { path: sourcePath, sha256: fileHash(workspace.path(sourcePath)), bytes: Buffer.byteLength(source) },
    slide_count: { expected: acceptance.expected_slides ?? null, observed: receipt.slides, matches: acceptance.expected_slides === undefined ? null : acceptance.expected_slides === receipt.slides },
    rendered_source_matches_current: fileHash(workspace.path(sourcePath)) === receipt.source_sha256,
    unit: unit ?? 'whole_deck', units, renderer: { exit, receipt, original_ref: artifacts, images: existsSync(artifacts) ? readdirSync(artifacts).filter(p => /^slide-\d+\.png$/.test(p)) : [] },
    limitations: ['literal/normalized matching does not prove semantic completeness, currency units or numeric attribution; normalized numbers are scoped to cited section fragments and retain polarity, without magnitude conversion', 'narrative, aesthetics and persuasion unmeasured', 'geometry limited to renderer warnings', 'HTML delivery; not a native editable pptx'] };
}

/** Bounded facts from immutable same-root receipts for the existing delivery review. */
export function deliveryReviewEvidence(evo: SelfRoot) {
  const saved = evo.export();
  const ledger = saved.root.ledger as Array<{ref: string; type: string; value: any}>;
  const outcome = ledger.findLast(row => row.type === 'task_outcome' && row.value?.renderer?.receipt);
  const failure = ledger.findLast(row => row.type === 'event' && row.value?.type === 'tool_failed');
  const recovered = failure && ledger.slice(Number(failure.ref.slice(7)) + 1)
    .find(row => row.type === 'event' && row.value?.type === 'tool_succeeded');
  const render = ledger.findLast(row => row.type === 'render_action_receipt');
  const receipt = outcome?.value?.renderer?.receipt;
  const current = receipt ? receipt.source_sha256 === saved.snapshot.latestArtifactHash : null;
  const units = outcome?.value?.units ?? [];
  const flags = units.flatMap((unit: any) => [unit.citation_literal?.found, unit.normalized?.citation_found,
    ...(unit.literal_matches ?? []).map((match: any) => match.found),
    ...(unit.normalized?.matches ?? []).map((match: any) => match.found)]);
  const refs = [...new Set([outcome?.ref, failure?.ref, recovered?.ref, render?.ref].filter((ref): ref is string => Boolean(ref)))];
  return { evidenceRefs: refs, artifact: receipt ? { revision: receipt.revision, sha256: receipt.source_sha256, current,
    slides: receipt.slides, warnings: (receipt.warnings ?? []).slice(0, 8), additional_warnings: Math.max(0, (receipt.warnings ?? []).length - 8) } : null,
    checker: outcome ? { version: outcome.value.checker?.version, unit_count: units.length,
      slide_count: outcome.value.slide_count,
      flags: { true: flags.filter(x => x === true).length, false: flags.filter(x => x === false).length,
        unknown: flags.filter(x => x == null).length } } : null,
    tool_failure: failure ? { ref: failure.ref, tool: failure.value.facts?.tool,
      subsequent_success_ref: recovered?.ref ?? null, subsequent_success_tool: recovered?.value.facts?.tool ?? null } : null,
    render_action: render ? { ref: render.value.action_ref, ledger_ref: render.ref,
      transition: render.value.transition?.status, transition_reason: render.value.transition?.reason ?? null } : null,
    self_revision: saved.root.serial, orchestration_revision: saved.snapshot.revision,
    candidate_validation_window: saved.root.windows.some((window: any) => window.status === 'open' || window.status === 'delivered') };
}

export function installSelfRootTools({ pi, evo, manifest, root, workspace, text, persist }: any) {
  const tool = (name: string, description: string, parameters: any, fn: any) => pi.registerTool({ name, label: name, description, parameters,
    execute: async (_id: string, a: any, _signal: any, _update: any, ctx: any) => { const result = await fn(a,ctx); persist(); return text(result,Boolean(result?.context_reset_requested)); } });
  tool('read_self', 'Expand the same root: policy, contract, ledger pages (offset/count), definition (offset=revision), windows, lineage or continuity. op=replay runs only a pure capsule method in isolated WASI; no world replay.',
    Type.Object({ section: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
      op: Type.Optional(Type.Literal('replay')), ref: Type.Optional(Type.String()), source: Type.Optional(Type.String()) }),
    async (a: any) => a.op === 'replay' ? evo.replay(a.ref,a.source) : evo.detail(a.section ?? 'policy',a.offset ?? 0,a.count ?? 20));
  tool('reflect_orchestration', 'Queue one atomic same-response transaction on this root. Replace orchestration and/or policy and/or components together, with carry/stepMap. restore copies a same-root snapshot as a NEW revision. Use pendingRevision for a subsequent reflection in the same response. Activation before next provider request. Optional validation defines baseline ledger refs, metric_refs, scope, absolute due request/units/boundary, prediction and pure measure.',
    Type.Object({ baseRevision: Type.Integer({ minimum: 1 }), orchestration: Type.Optional(Type.Any()), components: Type.Optional(Type.Array(Type.Any())),
      policy: Type.Optional(Type.Any()), carry: Type.Optional(Type.Any()), stepMap: Type.Optional(Type.Any()), restore: Type.Optional(Type.Integer({minimum:1})), validation: Type.Optional(Type.Any()) }),
    (a: any) => evo.transaction(a));
  tool('decide', 'Decide on this same serial agent: enter_mode(execute/reflect/consolidate), exit(changed/unrelated/deferred, object result matching mode exitSchema, evidenceRefs; keep uses deferred/keep), validation(window, decision adopt/restore/defer, result={reason,baseline_refs,outcome_refs,comparison} for adoption, restore revision), capsule(value), inherit(value), reset, or ordinary orchestration decision in execute. Pending reflection is not a completed change. No required modification.',
    Type.Object({ op: Type.Optional(Type.String()), mode: Type.Optional(Type.String()), status: Type.Optional(Type.String()), subtype: Type.Optional(Type.String()), terminal: Type.Optional(Type.Boolean()),
      result: Type.Optional(Type.Any()), evidenceRefs: Type.Optional(Type.Array(Type.String())), window: Type.Optional(Type.String()), decision: Type.Optional(Type.String()),
      restore: Type.Optional(Type.Integer()), value: Type.Optional(Type.Any()), decisionId: Type.Optional(Type.String()) }), async (a: any, ctx: any) => {
      if (a.op === 'enter_mode') return evo.enterMode(a.mode);
      if (a.op === 'exit') return evo.exit({ ...a, evidenceRefs: a.evidenceRefs ?? [] });
      if (a.op === 'capsule') return evo.capsule(a.value);
      if (a.op === 'inherit') return evo.inherit(a.value);
      if (a.op === 'validation') {
        return evo.interpret(a.window,a.decision,a.result,a.restore);
      }
      if (a.op === 'reset') {
        if (!a.result?.summary || typeof a.result.summary !== 'string') throw Error('active reset requires the same Agent continuity summary in result.summary');
        const reset = await evo.requestReset();
        evo.claim('continuity_summary',{ reset:reset.id, summary:a.result.summary });
        if (reset.ready) {
          persist(); ctx.compact({ customInstructions: 'SELFROOT_SUMMARY\n'+a.result.summary,
            onComplete: () => { evo.finishReset(reset.id); persist(); },
            onError: (error: Error) => { evo.finishReset(reset.id,String(error)); persist(); } });
        }
        return { ...reset, review_queued: !reset.ready, context_reset_requested: reset.ready };
      }
      if (a.op) throw Error('unknown decide operation');
      if (evo.reviewExitSchema) throw Error('work decision suspended during mode transaction; use decide op for this mode');
      const decision = evo.decide({ decisionId: a.decisionId, actor: 'agent', evidenceRefs: a.evidenceRefs ?? [], result: a.result });
      return { decision, transition: evo.advance() };
    });
  tool('acceptance', 'Observe the fixed acceptance checker on the latest rendered source. Returns literal coverage, source/renderer/checker hashes and unknowns; does not decide quality or adopt a self revision.',
    Type.Object({ unit: Type.Optional(Type.String()) }), (a: any) => {
      const dirs = readdirSync(join(root,'exports')).filter(p => /^v\d+$/.test(p)).sort();
      const receiptPath = join(root,'exports',dirs.at(-1) ?? 'missing','receipt.json');
      const receipt = JSON.parse(readFileSync(receiptPath,'utf8'));
    const result = collectAcceptance(manifest,root,workspace,receipt.source_path,receipt,0,a.unit);
      return evo.outcome(result);
    });
  const submitted = new Set<string>(evo.export().root.ledger.filter((r: any) => r.type === 'unit_delivered').map((r: any) => r.value.unit));
  tool('submit_unit', 'Deliver one frozen content unit after rendering the current deck. First invocation queues its before-delivery review. Repeat after exit to record protected acceptance. A content unit may span several slides. No quality verdict is fabricated.',
    Type.Object({ unit: Type.String() }), async (a: any) => {
      if (!manifest.units.some((u: any) => u.id === a.unit)) throw Error('unknown frozen unit');
      if (submitted.has(a.unit)) return { unit: a.unit, already_delivered: true };
      const dirs = readdirSync(join(root,'exports')).filter(p => /^v\d+$/.test(p)).sort();
      const receipt = JSON.parse(readFileSync(join(root,'exports',dirs.at(-1) ?? 'missing','receipt.json'),'utf8'));
      if (fileHash(workspace.path(receipt.source_path)) !== receipt.source_sha256) throw Error('unit needs a current rendered artifact');
      const routed = await evo.event('before_delivery',`unit:${a.unit}:${receipt.source_sha256}`);
      if (!(routed as any).duplicate || evo.hasReview) return { unit: a.unit, review_pending: true };
      const result = collectAcceptance(manifest,root,workspace,receipt.source_path,receipt,0,a.unit);
      evo.outcome(result,true); evo.fact('unit_delivered',{ unit: a.unit }); submitted.add(a.unit);
      await evo.event('unit_completed',`unit:${a.unit}`);
      return result;
    });
}
