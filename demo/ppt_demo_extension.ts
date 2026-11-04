/** PPT host for the branch's Binder + NativeRuntime named-program implementation. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './arc_thin_workspace.ts';
import { Binder } from './arc_thin_binder.ts';
import { validatePythonComponent } from './arc_thin_components.ts';
import { NativeRuntime } from './arc_thin_native_runtime.ts';

export default function pptDemo(pi: ExtensionAPI) {
  const root = process.env.PPT_DEMO_ROOT!;
  const freshBatch = process.env.PPT_FRESH_BATCH === '1';
  const requestedBatchLimit = Number(process.env.PPT_BATCH_REQUESTS ?? 10);
  const batchLimit = requestedBatchLimit === 0 ? Infinity
    : Number.isSafeInteger(requestedBatchLimit) && requestedBatchLimit > 0 ? requestedBatchLimit : 10;
  const workspace = new Workspace(root);
  const binder = new Binder(workspace, validatePythonComponent);
  mkdirSync(join(root, 'harness'), { recursive: true });
  const statePath = join(root, '.harness', 'ppt-loop.json');
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { batch: 0, batchRequests: 0, phase: 'task', nextPhase: 'task', note: '', noteStale: false, revision: 0, complete: false, events: [] };
  state.batchRequests ??= 0;
  state.phase ??= 'task';
  state.nextPhase ??= 'task';
  state.note ??= '';
  state.noteStale ??= false;
  let resumed = false, initialized = false;
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  const log = (file: string, row: any) => appendFileSync(join(root, 'harness', file), JSON.stringify({ time: new Date().toISOString(), batch: state.batch, ...row })+'\n');
  const text = (value: any, terminate = false): any => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], terminate });
  const registerTool = pi.registerTool.bind(pi);
  (pi as any).registerTool = (tool: any) => registerTool({ ...tool, execute: async (...args: any[]) => {
    const result = await tool.execute(...args);
    if (!freshBatch || result?.terminate || (state.batchRequests ?? 0) < batchLimit) return result;
    state.nextPhase = 'task'; state.noteStale = true; state.batchClosed = true; persist();
    log('lifecycle.jsonl', { event: 'batch_closed', reason: 'request_limit', requests: state.batchRequests, limit: batchLimit });
    return { ...result, terminate: true, content: [...(result?.content ?? []),
      { type: 'text', text: 'Batch closed at its request limit; the next batch starts with a fresh conversation.' }] };
  } });
  const previousRequests = existsSync(join(root, 'harness/provider-requests.jsonl'))
    ? readFileSync(join(root, 'harness/provider-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const previousUsage = existsSync(join(root, 'harness/model-usage.jsonl'))
    ? readFileSync(join(root, 'harness/model-usage.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const lastUsage = previousUsage.at(-1);
  const reserve = Number(process.env.PPT_DEMO_REQUEST_RESERVE_USD ?? 3.52);
  const cap = Number(process.env.PPT_DEMO_BUDGET_USD ?? 12);
  const unknownUsageReserveTokens = 12000;
  const inputRate = Number(process.env.PPT_DEMO_INPUT_USD_PER_MILLION ?? 20);
  const outputRate = Number(process.env.PPT_DEMO_OUTPUT_USD_PER_MILLION ?? 80);
  const cacheReadRate = Number(process.env.PPT_DEMO_CACHE_READ_USD_PER_MILLION ?? inputRate);
  const cacheWriteRate = Number(process.env.PPT_DEMO_CACHE_WRITE_USD_PER_MILLION ?? inputRate);
  let requests = previousRequests.at(-1)?.request ?? 0, reserved = 0;
  let spent = (lastUsage?.conservative_usd ?? 0) + Math.max(0, requests-(lastUsage?.request ?? 0))*reserve;
  const reportedTokens = (usage: any) => Number(usage?.input ?? 0) + Number(usage?.output ?? 0) + Number(usage?.cacheRead ?? 0) + Number(usage?.cacheWrite ?? 0);
  let tokensSpent = previousUsage.reduce((sum, row) => sum + (row.usage ? reportedTokens(row.usage) : unknownUsageReserveTokens), 0);
  const snapshot = () => {
    const deckPath = 'artifacts/deck.json', htmlPath = 'artifacts/presentation.html';
    const deck = existsSync(workspace.path(deckPath)) ? JSON.parse(workspace.read(deckPath)) : null;
    const memory = workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))
      .map(path => ({ path, summary: workspace.read(path).split(/\r?\n/).find((line: string) => line.trim())?.slice(0, 240) ?? '' }));
    const feedback = state.lastFeedback;
    const html = !deck && existsSync(workspace.path(htmlPath)) ? workspace.read(htmlPath) : null;
    return { task: 'PPT production', batch: state.batch, revision: state.revision,
      last_feedback: feedback ? { revision: feedback.revision, slides: feedback.slides,
        native_objects: feedback.native_objects, warnings: feedback.warnings, source_path: feedback.source_path,
        evidence: feedback.evidence } : null,
      rendered_revisions: (state.renderedRevisions ?? []).slice(-8),
      memory,
      ...(deck ? { deck: { path: deckPath, format: 'scene-json', slides: deck.slides.length,
        titles: deck.slides.map((slide: any) => slide.elements.find((el: any) => el.kind === 'text')?.text ?? '') } }
        : html ? { deck: { path: htmlPath, format: 'html', bytes: Buffer.byteLength(html) } } : {}) };
  };
  const runtime = new NativeRuntime({ pi, workspace, binder, state: snapshot, level: () => 0,
    actionCount: () => state.batch, decision: () => state.batch, hookTurn: () => state.phase === 'adapt',
    consultReasoning: (process.env.PPT_DEMO_THINKING ?? 'high') as 'low' | 'medium' | 'high',
    modelResult: async create => {
      if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
        writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, reason: 'consult budget boundary' }));
        process.exit(0);
      }
      spent += reserve;
      log('provider-requests.jsonl', { request: ++requests, kind: 'consult', estimated_usd_so_far: spent });
      const reply = await create().result();
      const u = reply.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && u.input + u.output > 0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserve;
      log('model-usage.jsonl', { request: requests, kind: 'consult', usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent, conservative_usd: spent,
        usage_status: known ? 'reported' : 'unknown_reserved', stopReason: reply.stopReason });
      return reply;
    },
    pythonSession: false, pythonKernel: false, workMemory: false, log, usage: (kind, message) => log('usage.jsonl', { kind, message }),
    wrap: (_name, fn) => async (_id: string, args: any, signal: any, _update: any, ctx: any) => fn(args, signal, ctx),
  });
  const canonicalPath = () => {
    if (existsSync(workspace.path('artifacts/presentation.html'))) return 'artifacts/presentation.html';
    if (existsSync(workspace.path('artifacts/deck.json'))) return 'artifacts/deck.json';
    const htmlSources = workspace.files('artifacts').filter(path => path.toLowerCase().endsWith('.html'));
    return htmlSources.length === 1 ? htmlSources[0] : undefined;
  };
  const fileHash = (path: string) => createHash('sha256').update(readFileSync(workspace.path(path))).digest('hex');
  const mapPath = 'quality/map.json';
  const componentGuide = 'Optional component fit: prompt = a behavior rule that should guide many future turns; memory = task facts, decisions, or contradictions to recover after context shifts, compaction, or a later turn, even within one batch; skill = a repeatable procedure to invoke when needed; tool = a deterministic transformation or check; subagent = an independent semantic judgment. Choose by the work to remove; no component type or component count is required.';
  const mapFormat = `Expected ${mapPath}: {"dimensions":[{"id":"task-defined-id","standard":"task-defined criterion","checks":[{"kind":"program","ref":"tools/<name>.py"}],"methods":[{"ref":"skills/<name>/SKILL.md"}]}],"coverage_review":{"kind":"consult","ref":"agents/<name>.md"}}. A program check uses a tools/<name>.py path; a consult check uses an agents/<name>.md path. A method ref is a task-local path. Create or revise the map when it helps you guide or measure the work; it need not precede prototypes or other useful exploration. If registered, your coverage reviewer runs after the first render, after a gap or map change, and against the final revision before delivery; it sees the brief, source, render receipt, and images, not the map. Omit @version; runtime tracks versions. All criteria and reviewer content are authored in this task.`;
  const readMap = () => {
    if (!existsSync(workspace.path(mapPath))) return { error: 'no Agent-authored quality map exists' } as const;
    const raw = workspace.read(mapPath);
    let map: any;
    try { map = JSON.parse(raw); } catch { return { error: 'quality/map.json is not valid JSON' } as const; }
    if (!map || !Array.isArray(map.dimensions) || map.dimensions.length === 0) return { error: 'map.dimensions must contain at least one Agent-defined quality dimension' } as const;
    const unknownKeys = Object.keys(map).filter(key => !['dimensions', 'coverage_review'].includes(key));
    if (unknownKeys.length) return { error: `Unknown quality map field(s): ${unknownKeys.join(', ')}. Put methods and checks on each dimension; put the blind reviewer under coverage_review.` } as const;
    const ids = new Set<string>();
    for (const dimension of map.dimensions) {
      if (!dimension || typeof dimension.id !== 'string' || !dimension.id.trim() || ids.has(dimension.id) ||
          typeof dimension.standard !== 'string' || !dimension.standard.trim() ||
          dimension.checks !== undefined && !Array.isArray(dimension.checks) ||
          dimension.methods !== undefined && !Array.isArray(dimension.methods))
        return { error: 'Each dimension needs a unique id, a standard, and optional checks/methods arrays' } as const;
      ids.add(dimension.id);
      for (const check of dimension.checks ?? []) {
        if (!check || !['program', 'consult'].includes(check.kind) || typeof check.ref !== 'string' || !check.ref.trim()) return { error: `Invalid check in dimension ${dimension.id}; each check must be {"kind":"program"|"consult","ref":"tools/<name>.py"|"agents/<name>.md"}` } as const;
        try { workspace.path(check.ref); } catch { return { error: `Unsafe check reference in dimension ${dimension.id}` } as const; }
        if (check.kind === 'program' && !check.ref.startsWith('tools/') || check.kind === 'consult' && !check.ref.startsWith('agents/'))
          return { error: `Check in ${dimension.id} has the wrong path: program refs use tools/<name>.py; consult refs use agents/<name>.md` } as const;
      }
      for (const method of dimension.methods ?? []) {
        if (!method || typeof method.ref !== 'string' || !method.ref.trim()) return { error: `Invalid method in dimension ${dimension.id}; each method must be {"ref":"<task-local method path>"}` } as const;
        try { workspace.path(method.ref); } catch { return { error: `Unsafe method reference in dimension ${dimension.id}` } as const; }
      }
    }
    const coverage = map.coverage_review;
    if (coverage !== undefined && (!coverage || coverage.kind !== 'consult' || typeof coverage.ref !== 'string' || !coverage.ref.trim() || !coverage.ref.startsWith('agents/')))
      return { error: 'coverage_review must reference an Agent-authored consult role' } as const;
    if (coverage) try { workspace.path(coverage.ref); } catch { return { error: 'Unsafe coverage reviewer reference' } as const; }
    return { map, hash: createHash('sha256').update(raw).digest('hex') } as const;
  };
  const componentAt = (ref: string) => binder.active().find(component => component.path === ref);
  const qualitySignature = (map: any) => createHash('sha256').update(JSON.stringify(map.dimensions.map((d: any) => [d.id,
    (d.checks ?? []).map((check: any) => [check.kind, check.ref, componentAt(check.ref)?.hash ?? null]),
    (d.methods ?? []).map((method: any) => [method.ref, componentAt(method.ref)?.hash ?? (existsSync(workspace.path(method.ref)) ? fileHash(method.ref) : null)])]))).digest('hex');
  const coverageReviewKey = (revision: number, sourceHash: string, loaded: any) => {
    const reviewer = componentAt(loaded.map.coverage_review?.ref ?? '');
    return reviewer ? createHash('sha256').update(`${revision}:${sourceHash}:${loaded.hash}:${reviewer.hash}`).digest('hex') : undefined;
  };
  const sourceFacts = () => {
    const source = canonicalPath();
    return source ? { source, hash: fileHash(source) } : undefined;
  };
  const statusText = () => {
    const loaded = readMap(), source = sourceFacts();
    const deadline = Number(process.env.PPT_DEMO_DEADLINE);
    const budget = `Observed parent+consult tokens: ${Math.ceil(tokensSpent)} (no token cap); estimated $${spent.toFixed(2)} / $${cap.toFixed(2)}; remaining ${Math.max(0, Math.ceil((deadline - Date.now()) / 60000))} min.`;
    if ('error' in loaded) {
      const unassigned = (state.productChanges ?? []).filter((change: any) => change.exploration === true).length;
      return `QUALITY STATE\nNo Agent-authored quality map is active (${loaded.error}). You can still create and render a prototype or develop a useful method/component; checks and delivery become available after you define a task-specific map. Use this early work to discover audience needs and test materially different expressions where they may improve understanding.\n${mapFormat}\nCanonical source: ${source ? `${source.source} sha256=${source.hash}` : 'not created'}; rendered revision: ${state.lastFeedback?.revision ?? 'none'}; exploratory artifact changes: ${unassigned}.\n${budget}`;
    }
    const latest = state.qualityRun;
    const currentSignature = qualitySignature(loaded.map);
    const renderedPath = state.lastFeedback?.source_path;
    const renderedHash = renderedPath && existsSync(workspace.path(renderedPath)) ? fileHash(renderedPath) : undefined;
    const lines = ['QUALITY STATE', '| Dimension | Agent standard | Status | Change | Distance | Checks / methods | Evidence |', '|---|---|---|---|---|---|---|'];
    const memoryPaths = workspace.files('notes').filter((path: string) => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path));
    for (const dimension of loaded.map.dimensions) {
      const row = latest?.rows?.find((item: any) => item.id === dimension.id);
      const methods = dimension.methods ?? [];
      const checks = dimension.checks ?? [];
      const missingMethods = methods.filter((method: any) => !existsSync(workspace.path(method.ref)) && !componentAt(method.ref));
      let status = row?.status ?? 'unknown';
      if (!checks.length || !methods.length) status = 'unknown';
      else if (row && (row.map_hash !== loaded.hash || row.check_signature !== currentSignature || !renderedHash || row.source_hash !== renderedHash)) status = 'stale';
      else if (row && row.revision !== state.lastFeedback?.revision) status = 'stale';
      const evidence = row?.checks?.map((check: any) => check.evidence ?? check.reason).filter(Boolean).join(' / ') ?? 'not checked';
      const manualCount = (state.productChanges ?? []).filter((change: any) => change.source === 'manual' && change.dimension_ids?.includes(dimension.id)).length;
      const distance = row?.checks?.map((check: any) => check.distance).filter((value: any) => typeof value === 'number').join(' / ') || '—';
      const refs = `checks: ${checks.map((check: any) => `${check.kind}:${check.ref}`).join(', ') || 'none'}; methods: ${methods.map((method: any) => method.ref).join(', ') || 'none'}`;
      const change = row?.comparison ?? 'first measurement';
      lines.push(`| ${dimension.id} | ${String(dimension.standard).replace(/\s+/g, ' ').slice(0, 160)} | ${status} | ${change} | ${distance} | ${refs}${missingMethods.length ? `; missing ${missingMethods.map((x: any) => x.ref).join(', ')}` : ''}${manualCount ? `; ${manualCount} unharnessed manual edits` : ''} | ${evidence.slice(0, 220)} |`);
      if (manualCount >= 3) lines.push(`Optional component opportunity for ${dimension.id}: ${manualCount} direct edits are recorded. If the same behavior should guide future turns, consider a prompt; if the procedure repeats, a skill; if the change/check is deterministic, a tool. Use memory for facts, decisions, or contradictions a later turn may need after context shifts or compaction, even within one batch. Manual work remains valid for one-off changes.`);
    }
    const referenced = new Set([...loaded.map.dimensions.flatMap((d: any) => [ ...(d.methods ?? []).map((m: any) => m.ref), ...(d.checks ?? []).map((c: any) => c.ref) ]), loaded.map.coverage_review?.ref].filter(Boolean));
    const idle = binder.active().filter(component => !referenced.has(component.path)).map(component => `${component.path}@v${component.version}`);
    const exploratoryChanges = (state.productChanges ?? []).filter((change: any) => change.exploration === true).length;
    if (exploratoryChanges) lines.push(`Unassigned exploratory artifact changes: ${exploratoryChanges}. Decide whether they reveal a criterion or reusable method worth adding to the map, or leave them as one-off exploration.`);
    lines.push(`Coverage gaps: ${loaded.map.dimensions.filter((d: any) => !(d.methods?.length) || !(d.checks?.length)).map((d: any) => d.id).join(', ') || 'none'}.`);
    lines.push(`Components not linked from the map: ${idle.join(', ') || 'none'}.`);
    lines.push(`Canonical source: ${source ? `${source.source} sha256=${source.hash}` : 'not created'}; rendered source: ${renderedPath ? `${renderedPath} sha256=${renderedHash ?? 'changed'}` : 'none'}; revision: ${state.lastFeedback?.revision ?? 'none'}.`);
    const reviewKey = source && renderedHash && state.lastFeedback ? coverageReviewKey(state.lastFeedback.revision, renderedHash, loaded) : undefined;
    const currentReview = reviewKey && state.coverageReview?.key === reviewKey ? state.coverageReview : undefined;
    const reviewState = currentReview?.status ?? (currentReview ? (currentReview.verdict?.ok ? 'pass' : 'gap')
      : loaded.map.coverage_review ? (state.coverageReview ? 'stale; needs review for current render' : 'not run') : 'absent');
    const reviewReason = (currentReview?.verdict?.reason ?? (state.coverageReview?.verdict?.reason ? `Previous review: ${state.coverageReview.verdict.reason}` : '')).slice(0, 500);
    const reviewEvidence = currentReview?.verdict?.evidence_refs?.join(', ').slice(0, 300);
    lines.push(`Blind coverage reviewer: ${loaded.map.coverage_review?.ref ?? 'absent; required before delivery'}; status: ${reviewState}${reviewReason ? `; findings: ${reviewReason}` : ''}${reviewEvidence ? `; evidence: ${reviewEvidence}` : ''}.`);
    lines.push(`Task memory is available throughout this task: ${memoryPaths.length ? memoryPaths.join(', ') : 'none saved'}. Create it only for facts, decisions, or contradictions that a later turn may need to recover; batch count does not determine whether it is useful.`);
    lines.push(budget);
    return lines.join('\n');
  };
  const parseVerdict = (result: any) => {
    const raw = (result?.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
    const answer = raw.includes('→\n') ? raw.slice(raw.indexOf('→\n') + 2, raw.lastIndexOf('\nref:')) : raw;
    const json = answer.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = json.indexOf('{'), end = json.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('consult did not return a JSON verdict');
    const verdict = JSON.parse(json.slice(start, end + 1));
    if (typeof verdict.ok !== 'boolean' || typeof verdict.reason !== 'string' || !verdict.reason.trim()) throw Error('consult verdict needs ok and reason');
    return verdict;
  };
  const runCoverageReview = async (revision: number, ctx: any, signal?: AbortSignal) => {
    const loaded = readMap();
    if ('error' in loaded || !loaded.map.coverage_review) return undefined;
    const coverage = loaded.map.coverage_review;
    const reviewer = componentAt(coverage.ref);
    const receiptPath = `results/renders/v${String(revision).padStart(3, '0')}/receipt.json`;
    const receipt = JSON.parse(readFileSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'receipt.json'), 'utf8'));
    const sourceHash = receipt.source_sha256;
    const key = coverageReviewKey(revision, sourceHash, loaded);
    if (key && state.coverageReview?.key === key) {
      const previous = state.coverageReview;
      previous.status ??= previous.verdict?.ok === true ? 'pass' : previous.verdict ? 'gap' : 'unknown';
      if (previous.status !== 'unknown') return previous;
    }
    let verdict: any, status = 'unknown';
    try {
      if (!reviewer || reviewer.kind !== 'subagent') throw Error(`${coverage.ref} is missing, inactive, or not a subagent`);
      const pages = Array.from({ length: receipt.slides }, (_, i) => `results/renders/v${String(revision).padStart(3, '0')}/slide-${String(i + 1).padStart(2, '0')}.png`);
      const answer = await runtime.qualityConsult({ agent: reviewer.name,
        question: 'Independently review the requested deliverable against the brief and source material. Identify any important requirement, intended effect, or information that remains weak or absent even if mechanical checks pass. Consider whether repeated visual treatments obscure meaningful differences or whether another expression could help the audience understand the material; only raise this with concrete evidence, and do not demand variety for its own sake. Include evidence references and say whether revision is needed. Do not request or infer access to the quality map. Return one JSON object: {"ok":boolean,"reason":string,"distance":number|null,"evidence_refs":string[]}.',
        refs: ['data/instructions.md', 'data/material.txt', receiptPath, ...pages] }, signal, ctx);
      verdict = parseVerdict(answer); status = verdict.ok ? 'pass' : 'gap';
    } catch (error) {
      verdict = { ok: false, reason: `Coverage review unavailable: ${String(error).slice(0, 400)}`, evidence_refs: [] };
    }
    const result = { key, revision, map_hash: loaded.hash, reviewer: coverage.ref, reviewer_hash: reviewer?.hash, status, verdict };
    state.coverageReview = result;
    log('quality.jsonl', { event: 'coverage_review', revision, reviewer: coverage.ref, status, verdict }); persist();
    return result;
  };
  const runQualityChecks = async (revision: number, ctx: any, signal?: AbortSignal) => {
    const loaded = readMap();
    if ('error' in loaded) {
      state.qualityRun = undefined; log('quality.jsonl', { event: 'checks_skipped', revision, reason: loaded.error }); persist(); return;
    }
    const receiptPath = `results/renders/v${String(revision).padStart(3, '0')}/receipt.json`;
    const rendered = JSON.parse(readFileSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'receipt.json'), 'utf8'));
    const source = { source: rendered.source_path, hash: rendered.source_sha256 };
    const previousRun = state.qualityRun;
    const signature = qualitySignature(loaded.map);
    const rows: any[] = [];
    for (const dimension of loaded.map.dimensions) {
      const checks: any[] = [];
      for (const check of dimension.checks ?? []) {
        const component = componentAt(check.ref);
        const record: any = { kind: check.kind, ref: check.ref, version: component?.version ?? null, status: 'unknown' };
        try {
          if (check.kind === 'program' && component?.program) {
            const verdict = await runtime.checkProgram(component.name, { revision, receipt: receiptPath, source_path: source.source,
              source_sha256: source.hash, standard: dimension.standard, evidence: `results/renders/v${String(revision).padStart(3, '0')}` }, signal);
            record.status = verdict.ok ? 'pass' : 'gap'; record.reason = verdict.reason; record.distance = verdict.distance;
            record.evidence = verdict.evidence_refs?.join?.(', ') ?? receiptPath;
          } else if (check.kind === 'consult' && component?.kind === 'subagent') {
            const pages = Array.from({ length: state.lastFeedback.slides }, (_, i) => `results/renders/v${String(revision).padStart(3, '0')}/slide-${String(i + 1).padStart(2, '0')}.png`);
            const answer = await runtime.qualityConsult({ agent: component.name, question: `${check.question ?? 'Assess the current render against this Agent-authored standard.'}\nStandard: ${dimension.standard}\nReturn one JSON object: {"ok":boolean,"reason":string,"distance":number|null,"evidence_refs":string[]}.`, refs: ['data/instructions.md', 'data/material.txt', receiptPath, ...pages] }, signal, ctx);
            const verdict = parseVerdict(answer);
            record.status = verdict.ok ? 'pass' : 'gap'; record.reason = verdict.reason; record.distance = verdict.distance;
            record.evidence = (verdict.evidence_refs ?? []).join(', ');
          } else record.reason = 'Referenced checker is missing, inactive, or has the wrong component kind';
        } catch (error) { record.reason = String(error).slice(0, 500); }
        checks.push(record);
      }
      const methods = dimension.methods ?? [];
      const missingMethods = methods.filter((method: any) => !existsSync(workspace.path(method.ref)) && !componentAt(method.ref));
      const status = !checks.length || !methods.length || missingMethods.length || checks.some(check => check.status === 'unknown') ? 'unknown'
        : checks.some(check => check.status === 'gap') ? 'gap' : 'pass';
      const oldRow = previousRun?.rows.find((item: any) => item.id === dimension.id);
      const previousRow = previousRun?.map_hash === loaded.hash && previousRun?.check_signature === signature ? oldRow : undefined;
      const comparison = !oldRow ? 'first measurement' : previousRow ? `${oldRow.status} → ${status}` : 'map or method version changed';
      rows.push({ id: dimension.id, status, comparison, source_hash: source.hash, map_hash: loaded.hash, check_signature: signature,
        revision, checks, methods: methods.map((method: any) => ({ ref: method.ref, exists: !missingMethods.some((missing: any) => missing.ref === method.ref),
          version: componentAt(method.ref)?.version ?? null, hash: componentAt(method.ref)?.hash ?? (existsSync(workspace.path(method.ref)) ? fileHash(method.ref) : null) })) });
    }
    state.qualityRun = { rows, revision, source_hash: source.hash, map_hash: loaded.hash, check_signature: signature };
    log('quality.jsonl', { event: 'checks_completed', revision, source_hash: source.hash, map_hash: loaded.hash, rows });
    persist();
  };
  const requireQualityMap = () => {
    const loaded = readMap();
    if ('error' in loaded) throw Error(`${loaded.error}. ${mapFormat}`);
    return loaded;
  };
  const register = (name: string, description: string, parameters: any, fn: any) => pi.registerTool({ name, label: name,
    description, parameters, execute: async (_id: string, args: any, signal: any, _update: any, ctx: any) => {
      const result = await fn(args, signal, ctx);
      log('tools.jsonl', { name, args: name === 'save_program' ? { ...args, body: '(see versioned source)' } : args,
        result: result?.content?.filter((x: any) => x.type === 'text'), isError: result?.isError ?? false });
      return result;
    } });
  for (const tool of workspace.fileTools()) pi.registerTool({ ...tool,
    description: ['write', 'edit'].includes(tool.name) ? `${tool.description} Create and revise working source under artifacts/; delivery/ is generated by office(op="deliver") and is not a working directory. For artifacts/<file>, include dimension_ids from your quality map when one exists; early prototypes may be unassigned. Create or revise quality/map.json when it helps guide or measure the work using this generic shape: ${mapFormat}` : tool.description,
    parameters: ['write', 'edit'].includes(tool.name) ? { ...tool.parameters, properties: { ...tool.parameters.properties, dimension_ids: Type.Optional(Type.Array(Type.String())) } } : tool.parameters,
    execute: async (id, args: any, signal, update, ctx) => {
    const path = String(args.path ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (['write', 'edit'].includes(tool.name) && /^delivery\//.test(path)) throw Error('delivery/ is generated by office(op="deliver"); create or revise the working source under artifacts/ instead.');
    if (['write', 'edit'].includes(tool.name) && /^(tools|lib)\//.test(path)) throw Error('Use save_program for executable harness changes.');
    const loaded = path !== mapPath && /^(artifacts|tools|lib|skills|agents|prompts|notes)\//.test(path) ? readMap() : undefined;
    if (['write', 'edit'].includes(tool.name) && path !== mapPath && /^(artifacts|tools|lib|skills|agents|prompts|notes)\//.test(path)) {
      if (loaded && !('error' in loaded) && /^artifacts\//.test(path) && (!Array.isArray(args.dimension_ids) || !args.dimension_ids.length))
        throw Error(`Artifact edits after defining ${mapPath} need dimension_ids; valid ids: ${loaded.map.dimensions.map((dimension: any) => dimension.id).join(', ')}.`);
      if (loaded && !('error' in loaded) && /^artifacts\//.test(path) && args.dimension_ids.some((id: string) => !loaded.map.dimensions.some((dimension: any) => dimension.id === id)))
        throw Error(`Unknown dimension_ids. Valid ids: ${loaded.map.dimensions.map((dimension: any) => dimension.id).join(', ')}.`);
    }
    const exploratoryArtifact = /^artifacts\//.test(path) && Boolean(loaded && 'error' in loaded);
    const { dimension_ids, ...toolArgs } = args;
    const result = await tool.execute(id, toolArgs, signal, update, ctx);
    if (!result?.isError && ['write', 'edit'].includes(tool.name) && path === mapPath) {
      const loaded = readMap();
      if ('error' in loaded) return { ...result, isError: true, content: [{ type: 'text', text: `Map was written but is invalid: ${loaded.error}. ${mapFormat}` }] };
    }
    if (!result?.isError && ['write', 'edit'].includes(tool.name) && /^artifacts\//.test(path)) {
      const change = { source: 'manual', path, hash: fileHash(path), dimension_ids, exploration: exploratoryArtifact, revision: state.lastFeedback?.revision ?? null, batch: state.batch };
      (state.productChanges ??= []).push(change); persist(); log('provenance.jsonl', { event: 'product_changed', ...change });
    }
    return result;
  } });
  workspace.onWrite = async path => {
    const result = await binder.save(path, 0, { by: 'agent', decision: state.batch }); binder.boundary();
    if (path === mapPath) { const created = !state.mapCreated; state.lastMapHash = fileHash(path); state.mapCreated = true; persist(); log('quality.jsonl', { event: 'map_changed', hash: state.lastMapHash, created }); }
    return result;
  };
  register('save_program', `Create/revise an Agent-authored tool for a deterministic transformation or check, including artifact generation when a repeatable transformation is useful. ${componentGuide} Same branch API and fresh WASI execution. Complete source; state, args, env injected. Named tools must expose run(args) or run(args, env); a quality-map program check must return an object with boolean ok and a nonempty evidence-based reason. A main() function alone is not an entrypoint. Workspace files are virtual: read them with injected open(path).read() or json(path), not pathlib.Path/read_text or native filesystem access. No host imports. A quality map is optional during exploration.`,
    Type.Object({ name: Type.String(), description: Type.String(), tags: Type.Optional(Type.Array(Type.String())), body: Type.String(), expected_version: Type.Optional(Type.Integer()) }),
    async (a: any) => text(await runtime.saveProgram(a.name, a.body, a.description, a.tags ?? [], a.expected_version)));
  register('run_program', 'Run an Agent-authored method or check against current task evidence. Omit version for active. Workspace files are virtual: use injected open(path).read() or json(path); pathlib.Path/read_text and native filesystem access cannot read task files. Python source may write only confined workspace files.',
    Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())), version: Type.Optional(Type.Integer({ minimum: 1 })), dimension_ids: Type.Optional(Type.Array(Type.String())) }),
    async (a: any, signal: any) => {
      const loaded = readMap();
      if (!('error' in loaded) && loaded.map.dimensions.length && a.dimension_ids?.some((id: string) => !loaded.map.dimensions.some((dimension: any) => dimension.id === id))) throw Error('Unknown dimension_ids in quality map.');
      const before = sourceFacts(); const component = binder.active().find(c => c.program && c.name === a.name && c.path.startsWith('tools/'));
      const mapBefore = existsSync(workspace.path(mapPath)) ? fileHash(mapPath) : undefined;
      const result = await runtime.runProgram(a.name, a.args ?? {}, signal, a.version);
      await binder.scan(0); binder.boundary(); runtime.register();
      const after = sourceFacts();
      const mapAfter = existsSync(workspace.path(mapPath)) ? fileHash(mapPath) : undefined;
      if (mapAfter !== mapBefore) { state.lastMapHash = mapAfter; state.mapCreated = Boolean(mapAfter); persist(); log('quality.jsonl', { event: 'map_changed', hash: mapAfter ?? null, source: 'program' }); }
      if (component && before?.hash !== after?.hash) {
        const inferred = !('error' in loaded) ? loaded.map.dimensions.filter((dimension: any) => [...(dimension.methods ?? []), ...(dimension.checks ?? [])].some((item: any) => item.ref === component.path)).map((dimension: any) => dimension.id) : [];
        const change = { source: 'program', path: component.path, name: component.name, version: a.version ?? component.version,
          dimension_ids: a.dimension_ids ?? inferred, exploration: 'error' in loaded, before: before?.hash ?? null, after: after?.hash ?? null, batch: state.batch };
        (state.productChanges ??= []).push(change); persist(); log('provenance.jsonl', { event: 'product_changed', ...change });
      }
      return result;
    });
  register('edit_program', 'Revise one exact text span in an active program while preserving its version history. Use read_component first.',
    Type.Object({ name: Type.String(), old_text: Type.String(), new_text: Type.String(), expected_version: Type.Integer({ minimum: 1 }) }),
    async (a: any) => {
      requireQualityMap();
      const c = binder.active().find(c => c.program && c.name === a.name);
      if (!c || c.version !== a.expected_version) throw Error('Program version changed; read_component and retry.');
      if (!a.old_text || c.source.split(a.old_text).length !== 2) throw Error('old_text must occur exactly once in the active source.');
      return text(await runtime.saveProgram(a.name, c.source.replace(a.old_text, a.new_text), c.description, c.tags ?? [], c.version));
    });
  register('list_programs', 'Find available executable methods and versions by purpose.', Type.Object({ query: Type.Optional(Type.String()) }),
    (a: any) => text(binder.programCatalog(0, a.query ?? '')));
  register('read_component', 'Inspect a named method source and exact active version.', Type.Object({ name: Type.String() }), (a: any) => {
    const c = binder.active().find(c => c.name === a.name);
    if (!c) throw Error('No active component by this name');
    return text(`${c.name}@v${c.version}\n${c.source}`);
  });
  register('checkpoint', 'Record a short handoff note and optionally enter or leave an engineering turn.',
    Type.Object({ note: Type.Optional(Type.String()), adapt: Type.Optional(Type.Boolean()) }), (a: any) => {
      const chars = Array.from(String(a.note ?? '')), note = chars.slice(0, 400).join('');
      if (a.note !== undefined) { state.note = note; state.noteStale = false; }
      if (a.adapt !== undefined) { state.phase = a.adapt ? 'adapt' : 'task'; state.nextPhase = state.phase; }
      persist(); log('lifecycle.jsonl', { event: 'checkpoint', phase: state.phase, note_chars: note.length });
      return text({ phase: state.phase, note: state.note, ...(chars.length > 400 ? { warning: 'Handoff note was truncated to 400 characters.' } : {}) });
    });
  register('self_component', `Create or revise a task-local prompt, skill, memory entry, or read-only subagent role. ${componentGuide} Saved versions are available from your next request. Use a subagent when an independent semantic judgment is useful.`,
    Type.Object({ kind: Type.Union([Type.Literal('prompt'), Type.Literal('skill'), Type.Literal('memory'), Type.Literal('subagent')]),
      name: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), content: Type.String(),
      description: Type.Optional(Type.String()), tools: Type.Optional(Type.Array(Type.String())) }),
    async (a: any) => {
      requireQualityMap();
      const path = a.kind === 'memory' ? `notes/memory/${a.name}.md` : a.kind === 'skill' ? `skills/${a.name}/SKILL.md`
        : a.kind === 'subagent' ? `agents/${a.name}.md` : `prompts/${a.name}.md`;
      const content = a.kind === 'memory' ? a.content : a.kind === 'prompt' ? `---\nactive: true\n---\n${a.content}`
        : a.kind === 'subagent' ? `---\ndescription: ${JSON.stringify(a.description ?? a.name)}\ntools: ${JSON.stringify(a.tools ?? ['read'])}\n---\n${a.content}`
        : `---\nname: ${a.name}\ndescription: ${JSON.stringify(a.description ?? a.name)}\n---\n${a.content}`;
      workspace.mutate({ op: 'write', path, content });
      const receipt = await binder.save(path, 0, { by: 'agent', decision: state.batch });
      binder.boundary();
      log('quality.jsonl', { event: 'component_changed', path, kind: a.kind, hash: createHash('sha256').update(content).digest('hex') });
      return text(receipt ?? `Saved ${path}; next batch uses it.`);
    });
  register('component_lifecycle', 'Retire or restore an Agent-created harness component. Retired files move to _off/ and can be restored.',
    Type.Object({ op: Type.Union([Type.Literal('retire'), Type.Literal('restore')]), path: Type.String() }), async (a: any) => {
      requireQualityMap();
      const path = a.path.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!/^(tools|lib|skills|agents|prompts|notes)\//.test(path)) throw Error('Only task-local harness component paths can be retired or restored.');
      const offPath = `_off/${path}`;
      if (a.op === 'retire') {
        if (!componentAt(path)) throw Error(`No active component at ${path}`);
        workspace.mutate({ op: 'move', path, destination: offPath });
      } else {
        if (!existsSync(workspace.path(offPath))) throw Error(`No retired component at ${offPath}`);
        if (existsSync(workspace.path(path))) throw Error(`An active component already exists at ${path}`);
        workspace.mutate({ op: 'move', path: offPath, destination: path });
      }
      await binder.scan(0); binder.boundary(); runtime.register();
      const loaded = readMap();
      const dimensionRefs = !('error' in loaded) ? loaded.map.dimensions.filter((dimension: any) =>
        [...(dimension.methods ?? []), ...(dimension.checks ?? [])].some((ref: any) => ref.ref === path)).map((dimension: any) => dimension.id) : [];
      log('quality.jsonl', { event: 'component_lifecycle', op: a.op, path, dimension_refs: dimensionRefs });
      return text({ op: a.op, path, quality_state: statusText() });
    });
  register('office', 'Render the current presentation or prototype, inspect browser previews, or deliver after all Agent-defined dimensions pass and an Agent-authored blind coverage reviewer approves. Rendering is available before a quality map exists; once you create one, checks run on each render. If quality/map.json names a reviewer, the first render runs it and reports findings in the quality state; a gap or map change triggers another review after the next render.',
    Type.Object({ op: Type.Union([Type.Literal('render'), Type.Literal('look'), Type.Literal('deliver')]), source_path: Type.Optional(Type.String()), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 30 }), { maxItems: 4 })), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async (a: any, signal: AbortSignal, ctx: any) => {
      if (a.op === 'render') {
        const sourcePath = a.source_path ?? canonicalPath();
        if (!sourcePath) throw Error('Choose source_path from an existing file under artifacts/, or create artifacts/presentation.html or artifacts/deck.json as the canonical source.');
        if (!sourcePath.startsWith('artifacts/') || !/\.(json|html)$/i.test(sourcePath)) throw Error('Render source must be JSON or HTML under artifacts/.');
        const source = workspace.path(sourcePath);
        if (!existsSync(source)) throw Error(`Render source does not exist: ${sourcePath}`);
        const revision = ++state.revision; persist();
        const helper = fileURLToPath(new URL('../src/autoresearch_pi/ppt_demo_html.py', import.meta.url));
        const child = spawnSync(process.env.PPT_DEMO_PYTHON ?? 'python', [helper, root, source, String(revision)], { encoding: 'utf8', timeout: 180000, maxBuffer: 2*1024*1024, windowsHide: true });
        if (child.error || child.status !== 0) throw Error((child.stderr || String(child.error)).slice(-5000));
        const receipt = JSON.parse(child.stdout);
        state.lastFeedback = { revision, slides: receipt.slides, native_objects: receipt.native_objects,
          warnings: receipt.warnings, renderer: receipt.renderer, source_path: sourcePath };
        state.renderedRevisions = [...(state.renderedRevisions ?? []), state.lastFeedback];
        state.events.push({ batch: state.batch, type: 'render', ...state.lastFeedback }); persist();
        log('renders.jsonl', state.lastFeedback);
        const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
        const evidence = `results/renders/v${String(revision).padStart(3, '0')}`;
        workspace.runtimeWrite(`${evidence}/receipt.json`, readFileSync(join(out, 'receipt.json')));
        workspace.runtimeWrite(`${evidence}/contact-sheet.png`, readFileSync(join(out, 'contact-sheet.png')));
        for (let n = 1; n <= receipt.slides; n++) workspace.runtimeWrite(`${evidence}/slide-${String(n).padStart(2, '0')}.png`, readFileSync(join(out, `slide-${String(n).padStart(2, '0')}.png`)));
        state.lastFeedback.evidence = evidence;
        await runQualityChecks(revision, ctx, signal);
        const coverage = readMap();
        if (!('error' in coverage) && coverage.map.coverage_review) {
          const prior = state.coverageReview;
          const reviewer = componentAt(coverage.map.coverage_review.ref);
          if (!prior || prior.status === 'gap' || prior.status === 'unknown' || prior.map_hash !== coverage.hash || prior.reviewer_hash !== reviewer?.hash)
            await runCoverageReview(revision, ctx, signal);
        }
        persist();
        return { content: [...text({ render: state.lastFeedback, quality: statusText() }).content,
          { type: 'image', data: readFileSync(join(out, 'contact-sheet.png')).toString('base64'), mimeType: 'image/png' },
          ...text(statusText()).content] };
      }
      const revision = a.revision ?? state.lastFeedback?.revision;
      if (!revision || !existsSync(join(root, 'exports', `v${String(revision).padStart(3, '0')}`, 'receipt.json'))) throw Error('No successful rendered revision');
      const out = join(root, 'exports', `v${String(revision).padStart(3, '0')}`);
      if (a.op === 'look') return { content: (a.pages ?? [1]).map((n: number) => ({ type: 'image', data: readFileSync(join(out, `slide-${String(n).padStart(2, '0')}.png`)).toString('base64'), mimeType: 'image/png' })) };
      const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
      const canonical = canonicalPath();
      if (!canonical) throw Error('Delivery needs one canonical source: use artifacts/presentation.html or artifacts/deck.json, or leave a single HTML source under artifacts/, then render it.');
      if (receipt.source_path !== canonical) throw Error(`Rendered source ${receipt.source_path} is not the current canonical source ${canonical}; render ${canonical} before delivery.`);
      const currentSource = workspace.path(receipt.source_path);
      const currentHash = createHash('sha256').update(readFileSync(currentSource)).digest('hex');
      if (currentHash !== receipt.source_sha256) throw Error('Deck changed since render; render current version before delivery.');
      if (revision !== state.lastFeedback?.revision) throw Error('Render the current canonical source before delivery.');
      const loaded = requireQualityMap();
      const signature = qualitySignature(loaded.map);
      const failed = loaded.map.dimensions.filter((dimension: any) => {
        const row = state.qualityRun?.rows?.find((item: any) => item.id === dimension.id);
        const missingMethod = (dimension.methods ?? []).some((method: any) => !existsSync(workspace.path(method.ref)) && !componentAt(method.ref));
        return !(dimension.checks?.length) || !(dimension.methods?.length) || missingMethod || !row || row.status !== 'pass' ||
          row.revision !== revision || row.source_hash !== currentHash || row.map_hash !== loaded.hash || row.check_signature !== signature;
      });
      if (failed.length) throw Error(`Delivery blocked: every current dimension needs at least one valid method and check that passes on this render.\n${statusText()}`);
      const coverage = loaded.map.coverage_review;
      const reviewer = coverage && componentAt(coverage.ref);
      if (!coverage) throw Error(`Delivery blocked: create an Agent-authored read-only subagent, then add coverage_review:{"kind":"consult","ref":"agents/<name>.md"} to ${mapPath}. ${mapFormat}`);
      if (!reviewer || reviewer.kind !== 'subagent') throw Error(`Delivery blocked: ${coverage.ref} must name an active Agent-authored subagent. ${mapFormat}`);
      const coverageResult = await runCoverageReview(revision, ctx, signal);
      const coverageVerdict = coverageResult?.verdict;
      if (!coverageResult || coverageResult.status !== 'pass' || !coverageVerdict?.ok)
        throw Error(`Delivery blocked by blind reviewer ${coverage.ref}: ${coverageVerdict?.reason ?? 'no current review result'}\nEvidence: ${(coverageVerdict?.evidence_refs ?? []).join(', ')}\n${statusText()}`);
      const delivery = join(root, 'delivery'); mkdirSync(delivery, { recursive: true });
      cpSync(join(out, 'presentation.html'), join(delivery, 'presentation.html'));
      mkdirSync(join(delivery, 'harness', 'quality'), { recursive: true });
      cpSync(workspace.path(mapPath), join(delivery, 'harness', mapPath));
      const components = binder.active();
      for (const c of components) { const path = join(delivery, 'harness', c.path); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, c.source); }
      for (const c of components.filter(component => component.kind === 'skill')) {
        const directory = join('skills', c.name);
        cpSync(workspace.path(directory), join(delivery, 'harness', directory), { recursive: true });
      }
      for (const memoryPath of workspace.files('notes').filter(path => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))) {
        const target = join(delivery, 'harness', memoryPath); mkdirSync(join(target, '..'), { recursive: true }); cpSync(workspace.path(memoryPath), target);
      }
      writeFileSync(join(delivery, 'harness.json'), JSON.stringify({ components: components.map(c => ({ name: c.name, kind: c.kind, version: c.version, path: c.path, hash: c.hash })),
        map: { path: 'harness/quality/map.json', sha256: loaded.hash }, quality_run: state.qualityRun, coverage_review: coverageVerdict,
        artifact_sha256: currentHash }, null, 2));
      for (const relative of ['.harness/components.jsonl', 'harness/tools.jsonl', 'harness/lifecycle.jsonl', 'harness/renders.jsonl', 'harness/quality.jsonl', 'harness/provenance.jsonl', 'harness/usage.jsonl',
        'harness/consult_runs.jsonl', 'harness/model-usage.jsonl', 'harness/provider-requests.jsonl', 'session.jsonl']) {
        const source = join(root, relative);
        if (!existsSync(source)) continue;
        const target = join(delivery, 'harness-evidence', relative.replace(/^\.harness\//, ''));
        mkdirSync(join(target, '..'), { recursive: true }); cpSync(source, target);
      }
      state.complete = true; state.deliveredRevision = revision; persist(); log('lifecycle.jsonl', { event: 'delivered', revision });
      cpSync(join(root, 'harness', 'lifecycle.jsonl'), join(delivery, 'harness-evidence', 'harness', 'lifecycle.jsonl'));
      return text({ delivered: revision, directory: 'delivery/' }, true);
    });
  pi.on('before_agent_start', async (event: any) => {
    if (!initialized) { await binder.scan(0); binder.boundary(); runtime.register(); initialized = true; }
    resumed = event.prompt === 'PPT_RESUME';
    if (freshBatch && !resumed && state.batchRequests >= batchLimit && !state.batchClosed) {
      state.nextPhase = 'task'; state.noteStale = true; state.batchClosed = true;
      log('lifecycle.jsonl', { event: 'batch_closed', reason: 'request_limit', requests: state.batchRequests, limit: batchLimit });
    }
    const handoff = state.noteStale ? '(none: the last batch closed at its request limit)' : state.note || '(none)';
    const memory = workspace.files('notes').filter((path: string) => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path))
      .map((path: string) => `## ${path}\n${workspace.read(path)}`).join('\n');
    const memoryBlock = `TASK MEMORY (optional; create and retrieve task facts, decisions, or contradictions when a later turn may need them, even in the same batch)\n${memory || '(none saved)'}`;
    if (!resumed) {
      state.batch++; state.batchRequests = 0; state.batchClosed = false;
      state.phase = state.nextPhase ?? 'task'; state.nextPhase = state.phase;
      if (state.noteStale) { state.note = ''; state.noteStale = false; }
      binder.boundary(); persist();
    }
    const selected = ['read', 'write', 'edit', 'ls', 'grep', 'save_program', 'edit_program', 'run_program', 'list_programs', 'read_component', 'self_component', 'component_lifecycle', 'checkpoint', 'office', 'consult'];
    pi.setActiveTools(selected);
    const activePrompts = binder.active().filter(c => c.kind === 'prompt').map(c => c.body).join('\n');
    const taskGuidancePath = workspace.path('AGENTS.md');
    const taskGuidance = existsSync(taskGuidancePath) ? readFileSync(taskGuidancePath, 'utf8') : '';
    const systemPrompt = [readFileSync(fileURLToPath(new URL('./prompts/ppt_demo_system.md', import.meta.url)), 'utf8'),
      taskGuidance, activePrompts].filter(Boolean).join('\n\n');
    log('lifecycle.jsonl', { event: resumed ? 'resume' : 'batch_started' });
    if (!freshBatch) return { systemPrompt, message: { customType: 'ppt-task-memory', content: memoryBlock, display: false } };
    const deadline = Number(process.env.PPT_DEMO_DEADLINE);
    const handoffMessage = [`FRESH CONTEXT: batch ${state.batch}, phase ${state.phase}. Earlier batches are not in this conversation. Carried over: workspace files; your prompts (in the system prompt); your memory (below, in full); your skills, programs and subagents (listed below; read_component for a body); the handoff note.`,
      `Handoff note: ${handoff}.`, `Time left: ${Math.max(0, Math.ceil((deadline - Date.now()) / 60000))} min; budget left: $${Math.max(0, cap - spent).toFixed(2)}; requests per batch: ${batchLimit}.`,
      memoryBlock, binder.index(0) || 'HARNESS\n(none)', binder.programCatalog(0), `CURRENT STATE\n${statusText()}`].join('\n\n');
    return { systemPrompt, message: { customType: 'ppt-work-state', content: handoffMessage, display: false } };
  });
  pi.on('context', async (event: any) => {
    const messages = event.messages;
    const messageText = (message: any) => typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.map((part: any) => part?.text ?? '').join('') : '';
    const start = freshBatch ? messages.findLastIndex((message: any) => message.role === 'user' && messageText(message) !== 'PPT_RESUME') : -1;
    const kept = start >= 0 ? messages.slice(start) : [...messages];
    const tail: any[] = [{ role: 'user', content: [{ type: 'text', text: statusText() }], timestamp: Date.now() }];
    if (freshBatch && state.batchRequests === batchLimit - 1) tail.push({ role: 'custom', customType: 'ppt-batch-limit', display: false,
      timestamp: Date.now(), content: 'LAST REQUEST IN THIS BATCH. The next batch starts with a fresh conversation; only the workspace, your harness and a checkpoint note (max 400 chars) carry over.' });
    return { messages: [...kept, ...tail] };
  });
  // Guard each actual provider request, including automatic tool continuations and length resumes.
  pi.on('before_provider_request', (event: any) => {
    if (Date.now() > Number(process.env.PPT_DEMO_DEADLINE) || spent + reserve > cap) {
      writeFileSync(join(root, 'budget-stop.json'), JSON.stringify({ spent, requests, tokensSpent, reason: 'authorized budget boundary' }));
      process.exit(0); // Extension event exceptions are fail-open in Pi; stop before the HTTP call.
    }
    spent += reserve; reserved = reserve;
    if (freshBatch) state.batchRequests = (state.batchRequests ?? 0) + 1;
    const payload = event.payload as any;
    log('provider-requests.jsonl', { request: ++requests, batch_request: state.batchRequests, estimated_usd_so_far: spent,
      payload: JSON.stringify(payload, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:') ? '(image)' : value) });
    if (freshBatch) persist();
  });
  pi.on('message_end', (event: any) => {
    const m = event.message;
    if (m.role === 'assistant') {
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input+u.output)>0;
      const usedTokens = known ? reportedTokens(u) : unknownUsageReserveTokens;
      tokensSpent += usedTokens;
      if (known) spent += ((u.input ?? 0)*inputRate+(u.cacheRead ?? 0)*cacheReadRate+(u.cacheWrite ?? 0)*cacheWriteRate+(u.output ?? 0)*outputRate)/1e6-reserved;
      reserved = 0; // Missing usage keeps its full request reserve charged.
      log('model-usage.jsonl', { request: requests, usage: known ? u : null, tokens_used: usedTokens, tokens_total: tokensSpent,
        conservative_usd: spent, usage_status: known ? 'reported' : 'unknown_reserved', stopReason: m.stopReason });
    }
  });
}
