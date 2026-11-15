/** PPT facts/tools only. Semantic review stays on the executing SelfRoot. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { SelfRoot, hash, operationContract, providerOperationSchema, normalizeOperation, type SelfContract } from './self_root.ts';

export type SelfRootManifest = {
  experiment_id: string; provider: string; model: string; contract: SelfContract;
  sources: Record<string,string>; units: Array<{ id: string; title: string; required: string[]; citation: string }>;
  checker: { version: string; sha256: string }; settings: any; engineering_commit: string;
  episodes?: Array<{ id: string; sources: Record<string,string>; units: SelfRootManifest['units']; acceptance: any; scope: string; coverage_tags?: string[] }>;
  episodes_sha256?: string;
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
    const citation = page ? new RegExp(`(?:source\\s+page\\s+|(?<![\\w.])p\\.?\\s*|(?<![\\w.])page\\s+)${page}(?![\\w.])`, 'i') : undefined;
    const cited = fragments.map(plain).filter(s => citation ? citation.test(s) : s.toLowerCase().includes(u.citation.toLowerCase()));
    const scoped = cited.flatMap(numbers);
    return { id: u.id,
      literal_matches: u.required.map(text => ({ text, found: visible.toLowerCase().includes(text.toLowerCase()) })),
      citation_literal: { text: u.citation, found: visible.toLowerCase().includes(u.citation.toLowerCase()) },
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
  if (hash(sources) !== hash(m.sources)) throw Error(`protected source snapshot mismatch: ${Object.keys({ ...m.sources, ...sources }).filter(p => sources[p] !== (m.sources as any)[p]).join(', ')}`);
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

/** PPT outcome metrics ({name, value, unit}) for one unit, plus segment counts from the adapter's own facts.
 * Facts only; the core treats the names as opaque and never ranks them. */
export function pptSegmentMetrics(rows: any[]) {
  const renders = rows.filter(r => r.type === 'task_outcome' && r.value?.unit === 'whole_deck' && r.value?.renderer?.receipt).length;
  const failures = rows.filter(r => r.type === 'task_outcome' && r.value?.status === 'render_failed').length;
  const writes = rows.filter(r => r.type === 'artifact_write');
  const n = (mode: string) => writes.filter(r => r.value?.mode === mode).length;
  return [
    { name: 'render.count', value: renders, unit: 'count' }, { name: 'render.failures', value: failures, unit: 'count' },
    { name: 'artifact.whole_file_writes', value: n('create') + n('overwrite'), unit: 'count' }, { name: 'artifact.edit_calls', value: n('edit'), unit: 'count' },
    { name: 'artifact.program_writes', value: n('program'), unit: 'count' },
    { name: 'artifact.write_chars', value: writes.reduce((sum, r) => sum + Number(r.value?.chars ?? 0), 0), unit: 'chars' },
  ].map((metric: any) => ({ ...metric, scope: 'segment' }));
}
export function pptUnitMetrics(result: any, rows: any[]) {
  const units = result.units ?? [];
  const literal = units.flatMap((u: any) => u.literal_matches ?? []);
  const normalized = units.filter((u: any) => u.normalized?.scope !== 'whole_document_unscoped').flatMap((u: any) => u.normalized?.matches ?? []);
  const cited = units.filter((u: any) => u.citation_literal?.found || u.normalized?.citation_found).length;
  return [
    { name: 'acceptance.required_found', value: literal.filter((m: any) => m.found).length, unit: 'count', scope: result.unit === 'whole_deck' ? 'whole_deck' : `unit:${result.unit}`, denominator: literal.length },
    { name: 'acceptance.required_total', value: literal.length, unit: 'count', scope: result.unit === 'whole_deck' ? 'whole_deck' : `unit:${result.unit}`, denominator: literal.length },
    { name: 'acceptance.citations_found', value: cited, unit: 'count', scope: result.unit === 'whole_deck' ? 'whole_deck' : `unit:${result.unit}` },
    { name: 'acceptance.normalized_found', value: normalized.filter((m: any) => m.found === true).length, unit: 'count', denominator: normalized.length },
    { name: 'render.warnings_latest', value: (result.renderer?.receipt?.warnings ?? []).length, unit: 'count' },
    ...pptSegmentMetrics(rows),
  ].map((metric: any) => ({ ...metric, scope: metric.scope ?? 'segment', observation: { artifact_hash: result.artifact?.sha256 ?? null, render_source_hash: result.renderer?.receipt?.source_sha256 ?? null, render_revision: result.renderer?.receipt?.revision ?? null, checker: result.checker?.version ?? null }, observation_id: JSON.stringify({ artifact_hash: result.artifact?.sha256 ?? null, render_source_hash: result.renderer?.receipt?.source_sha256 ?? null, render_revision: result.renderer?.receipt?.revision ?? null, checker: result.checker?.version ?? null }) }));
}
/** Bounded facts from immutable same-root receipts for the existing delivery review. */
export function deliveryReviewEvidence(evo: SelfRoot) {
  const saved = evo.export();
  const ledger = saved.root.ledger as Array<{ref: string; type: string; value: any}>;
  const outcome = ledger.findLast(row => row.type === 'task_outcome' && row.value?.renderer?.receipt);
  const failure = ledger.findLast(row => row.type === 'event' && row.value?.type === 'tool_failed');
  const recovered = failure && ledger.slice(Number(failure.ref.slice(7)) + 1).find(row => row.type === 'event' && row.value?.type === 'tool_succeeded');
  const render = ledger.findLast(row => row.type === 'render_action_receipt');
  const receipt = outcome?.value?.renderer?.receipt;
  const units = outcome?.value?.units ?? [];
  const flags = units.flatMap((unit: any) => [unit.citation_literal?.found, unit.normalized?.citation_found, ...(unit.literal_matches ?? []).map((match: any) => match.found), ...(unit.normalized?.matches ?? []).map((match: any) => match.found)]);
  const refs = [...new Set([outcome?.ref, failure?.ref, recovered?.ref, render?.ref].filter((ref): ref is string => Boolean(ref)))];
  return { evidenceRefs: refs, artifact: receipt ? { revision: receipt.revision, sha256: receipt.source_sha256, current: receipt.source_sha256 === saved.snapshot.latestArtifactHash, slides: receipt.slides, warnings: (receipt.warnings ?? []).slice(0, 8), additional_warnings: Math.max(0, (receipt.warnings ?? []).length - 8) } : null,
    checker: outcome ? { version: outcome.value.checker?.version, unit_count: units.length, slide_count: outcome.value.slide_count, flags: { true: flags.filter((x: any) => x === true).length, false: flags.filter((x: any) => x === false).length, unknown: flags.filter((x: any) => x == null).length } } : null,
    tool_failure: failure ? { ref: failure.ref, tool: failure.value.facts?.tool, subsequent_success_ref: recovered?.ref ?? null, subsequent_success_tool: recovered?.value.facts?.tool ?? null } : null,
    render_action: render ? { ref: render.value.action_ref, ledger_ref: render.ref, transition: render.value.transition?.status, transition_reason: render.value.transition?.reason ?? null } : null,
    self_revision: saved.root.serial, orchestration_revision: saved.snapshot.revision, candidate_validation_window: saved.root.windows.some((window: any) => window.status === 'open' || window.status === 'delivered') };
}

/** Adapter-side, task-specific wiring passed to the task-neutral core (constitution art. 10-1). */
export const PPT_SELF_ROOT_OPTIONS = {
  reviewTools: ['read', 'ls', 'grep', 'office.look', 'office.render', 'office.preview', 'acceptance'],
  evolutionTools: ['read', 'ls', 'grep', 'office.look', 'office.render', 'office.preview'],
  reservedToolNames: ['office'],
  actionOf: (name: string, args: any) => name === 'office' ? `office.${args?.op}` : name,
  boundaryTools: ['submit_unit', 'office.deliver'],
  processFactTypes: ['render_action_receipt','artifact_write'],
  workCheckpointTypes: ['render_action_receipt'],
  finalDeliveryTools: ['office.deliver'],
  contextSections: ['task_brief', 'task_status'],
  probeKinds: ['renderer-preflight'],
  acceptanceUnits: [],
};

/** Provider-visible schema for one registered tool name, generated from the core descriptor.
 * Returns undefined when the tool is not advertised in the current state. */
export function selfRootToolSchema(evo: SelfRoot, name: string): any {
  if (name === 'reflect_component') return providerOperationSchema('component', undefined, undefined, { layer: evo.mech.l4 });
  if (name === 'reflect_orchestration') return providerOperationSchema('orchestration', undefined, evo.current.orchestration, { layer: evo.mech.l4 });
  if (name === 'decide_exit') return evo.exitOperationSchema;
  if (name === 'decide_validation') return evo.dueWindows.length ? providerOperationSchema('validation') : undefined;
  if (name === 'decide') return DECIDE_SCHEMA;
  return null;
}
const DECIDE_SCHEMA = { type: 'object', properties: {
  op: { type: 'string', enum: ['enter_mode', 'capsule', 'inherit', 'reset'], description: 'Omit for an ordinary task decision (decisionId, result).' },
  decisionId: { type: 'string' }, result: {}, mode: { type: 'string' }, value: { type: 'object' },
  summary: { type: 'string', description: 'Optional reset note; the host continuity pack is built from the ledger.' } }, required: [] as string[], additionalProperties: false };
const DECIDE_FIELDS = Object.keys(DECIDE_SCHEMA.properties);

export function installSelfRootTools({ pi, evo, manifest, root, workspace, text, persist, episode = () => 1 }: any) {
  const active = () => typeof manifest === 'function' ? manifest() : manifest;
  const tool = (name: string, description: string, parameters: any, fn: any) => pi.registerTool({ name, label: name, description, parameters,
    execute: async (_id: string, a: any, _signal: any, _update: any, ctx: any) => {
      try { const result = await fn(a,ctx); persist(); return text(result,Boolean(result?.context_reset_requested)); }
      catch (error: any) {
        persist();
        if (['reflect_component', 'reflect_orchestration', 'decide', 'decide_exit', 'decide_validation'].includes(name)) {
          return text({ is_error: true, error: String(error?.message ?? error), same_turn_correction: 'This operation was rejected without ending the turn. Read the returned correction surface, repair the operation and retry; the review remains open.', terminate: false, reason: { code: error?.code ?? 'operation_rejected', surface: error?.surface ?? { received: a, correction: 'Use the visible operation fields and read_self(section="pin") for current values.' } } });
        }
        return text({ is_error: true, error: String(error?.message ?? error), reason: { code: error?.code ?? 'operation_rejected', surface: error?.surface ?? { received: a, correction: 'Use the visible operation fields and read_self(section="pin") for current values.' } } }, true);
      }
    } });
  // Registered TypeBox shapes are permissive envelopes; the provider receives the descriptor schema
  // (ppt_demo_extension context_with_system) and dispatch re-checks it with normalizeOperation.
  const open = (keys: string[]) => Type.Object(Object.fromEntries(keys.map(k => [k, Type.Optional(Type.Any())])));
  tool('read_self', 'Expand the same root: self (full mirror plus S_n/C_n), policy, contract, ledger pages (offset/count), definition (offset=revision), windows, conditions, lineage, continuity, segments (per-unit summaries), requests (per-request records), observation (recorded operating facts: repeats, costs, losses, rejections, trajectory, outcome paths) or context_item (ref: the full content of an item the context policy omitted; read-only). The packed evidence is a floor; full self and ledger remain accessible. op=replay runs only a pure capsule method in isolated WASI; no world replay.',
    Type.Object({ section: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
      op: Type.Optional(Type.Literal('replay')), ref: Type.Optional(Type.String()), source: Type.Optional(Type.String()) }),
    async (a: any) => a.op === 'replay' ? evo.replay(a.ref,a.source) : a.section === 'context_item' && a.ref ? evo.contextItem(a.ref) : evo.detail(a.section ?? 'policy',a.offset ?? 0,a.count ?? 20));
  const orchestration = operationContract('orchestration');
  tool(orchestration.name, orchestration.description, open([...Object.keys(orchestration.properties), 'evolution_layer']),
    (a: any) => evo.transaction(normalizeOperation('orchestration', a, undefined, { layer: evo.mech.l4 })));
  const exitContract = operationContract('review');
  tool(exitContract.name, exitContract.description, open([...Object.keys(exitContract.properties), 'result']), async (a: any) => {
    if (!evo.exitOperationKind) throw Error('no active review to close');
    // The response continues; the next request is assembled in the restored mode (no forced turn end).
    return evo.exit(normalizeOperation('review', a, evo.reviewExitSchema));
  });
  const validation = operationContract('validation');
  tool(validation.name, validation.description, open(Object.keys(validation.properties)), async (a: any) => {
    const v = normalizeOperation('validation', a);
    return evo.interpret(v.window);
  });
  tool('decide', 'Task decision (decisionId, result) or a self operation: enter_mode(mode), capsule(value), inherit(value: applicability, optional counterexamples), reset(optional summary). Host supplies receipts, versions and evidence refs.',
    open(DECIDE_FIELDS), async (a: any, ctx: any) => {
      const unknown = Object.keys(a ?? {}).filter(k => a[k] !== undefined && !DECIDE_FIELDS.includes(k));
      if (unknown.length) throw Error(`decide: unknown field(s) ${unknown.join(', ')}; visible fields: ${DECIDE_FIELDS.join(', ')}`);
      if (a.op === 'enter_mode') return evo.enterMode(a.mode);
      if (a.op === 'capsule') return evo.capsule(a.value);
      if (a.op === 'inherit') return evo.inherit(a.value ?? {});
      if (a.op === 'reset') {
        const reset = await evo.requestReset();
        // Host continuity pack from the persisted ledger; the Agent note is optional semantic text.
        const pack = { root: evo.root_id, revision: evo.revision, mode: evo.mode, ledger_total: evo.detail('ledger', 0, 1).total,
          open_windows: evo.detail('windows').filter((w: any) => w.status === 'open').map((w: any) => w.id), recover: 'read_self(section="ledger"|"continuity")' };
        const summary = [typeof a.summary === 'string' ? a.summary : '', `HOST CONTINUITY ${JSON.stringify(pack)}`].filter(Boolean).join('\n');
        evo.fact('continuity_pack', { reset: reset.id, pack, agent_note: a.summary ?? null });
        if (reset.ready) {
          persist(); ctx.compact({ customInstructions: 'SELFROOT_SUMMARY\n'+summary,
            onComplete: () => { evo.finishReset(reset.id); persist(); },
            onError: (error: Error) => { evo.finishReset(reset.id,String(error)); persist(); } });
        }
        return { ...reset, review_queued: !reset.ready, context_reset_requested: reset.ready };
      }
      if (a.op) throw Error('unknown decide operation');
      if (evo.reviewExitSchema) throw Error('task decisions resume after this review; close it with decide_exit');
      const decision = evo.decide({ decisionId: a.decisionId, actor: 'agent', evidenceRefs: [], result: a.result });
      return { decision, transition: evo.advance() };
    });
  tool('acceptance', 'Observe the fixed acceptance checker on the latest rendered source. Returns literal coverage, source/renderer/checker hashes and unknowns; it does not decide quality or retain a self revision.',
    Type.Object({ unit: Type.Optional(Type.String()) }), (a: any) => {
      const dirs = readdirSync(join(root,'exports')).filter(p => /^v\d+$/.test(p)).sort();
      const receiptPath = join(root,'exports',dirs.at(-1) ?? 'missing','receipt.json');
      const receipt = JSON.parse(readFileSync(receiptPath,'utf8'));
    const result = collectAcceptance(active(),root,workspace,receipt.source_path,receipt,0,a.unit);
      return evo.outcome({ ...result, episode:episode() });
    });
  const submitted = new Map<string, string>();
  for (const row of evo.export().root.ledger.filter((r: any) => r.type === 'unit_delivered')) submitted.set(`${row.value.episode ?? 1}:${row.value.unit}`, row.value.artifact_hash ?? '');
  tool('submit_unit', 'Deliver one frozen content unit from the current rendered artifact. Records its acceptance facts and settles the unit; counted boundaries follow recorded task work. A content unit may span several slides. No quality verdict is fabricated.',
    Type.Object({ unit: Type.String() }), async (a: any) => {
      if (!active().units.some((u: any) => u.id === a.unit)) throw Error('unknown frozen unit');
      const key = `${episode()}:${a.unit}`;
      const dirs = readdirSync(join(root,'exports')).filter(p => /^v\d+$/.test(p)).sort();
      const receipt = JSON.parse(readFileSync(join(root,'exports',dirs.at(-1) ?? 'missing','receipt.json'),'utf8'));
      if (fileHash(workspace.path(receipt.source_path)) !== receipt.source_sha256) throw Error('unit needs a current rendered artifact');
      const previousHash = submitted.get(key);
      if (previousHash === receipt.source_sha256) return { unit: a.unit, already_delivered: true, artifact_hash: previousHash };
      const superseding = previousHash !== undefined;
      // One call: acceptance facts, unit delivery and the unit boundary (D1/D2; no per-unit delivery review).
      if (a.unit && !['whole_deck', ...active().units.map((u: any) => u.id)].includes(a.unit)) throw Error(`unknown frozen unit ${a.unit}; valid units: whole_deck, ${active().units.map((u: any) => u.id).join(', ')}`);
      const result = collectAcceptance(active(),root,workspace,receipt.source_path,receipt,0,a.unit);
      evo.outcome({ ...result, episode:episode(), superseding_observation: superseding, metrics: pptUnitMetrics(result, evo.segmentRows()) },true); evo.fact('unit_delivered',{ unit: a.unit, episode:episode(), artifact_hash: receipt.source_sha256, superseding_observation: superseding }); submitted.set(key, receipt.source_sha256);
      const outcomeRefs = evo.export().root.ledger.filter((r: any) => r.type === 'task_outcome' && r.value?.unit === a.unit).map((r: any) => r.ref);
      const routed: any = await evo.event('unit_completed',`unit:${a.unit}`,{ event_classes:['task_outcome'], coverage_tags:[], unit: a.unit, evidenceRefs: outcomeRefs.slice(-4) });
      return { ...result, unit_boundary: routed.coalesced ? { counted: false, rule: 'no task action since the previous counted unit boundary' } : { counted: true, segment_summary: routed.segment_summary ?? null },
        review: evo.hasReview ? 'opens at the next request' : null };
    });
}
