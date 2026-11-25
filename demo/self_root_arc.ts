/** ARC facts and provider schemas for the shared, task-neutral SelfRoot. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { FLOOR, hash, normalizeOperation, operationContract, providerOperationSchema, type SelfContract, type SelfRoot } from './self_root.ts';

export const ARC_SELF_ROOT_OPTIONS = {
  metaFallback: { unit: 'action' as const, interval: 50 },
  metaRouting: 'selective' as const,
  reviewTools: ['arc_action', 'python', 'read', 'memory', 'skill', 'run_skill'],
  evolutionTools: ['read', 'write', 'edit', 'memory', 'skill', 'run_skill', 'reflect_component', 'reflect_orchestration'],
  reservedToolNames: ['arc_action', 'python'],
  actionOf: (name: string, args: any) => name === 'python' && args?.code ? 'python' : name,
  validationWindows: 'explicit_predicate' as const,
  processFactTypes: ['arc_action', 'python.env_act', 'tool_failed'],
  boundaryTools: ['arc_action'],
  actionReceiptTypes: ['arc_action', 'python.env_act'],
  workCheckpointTypes: ['arc_action', 'python.env_act'],
  contextSections: ['arc_observation', 'arc_history'],
};

export function arcSelfRootPaths(root: string) {
  const dir = join(root, 'self_root');
  return { dir, contract: join(dir, 'contract.json'), state: join(dir, 'state.json') };
}

export function loadOrCreateArcContract(root: string, capabilities: string[]): SelfContract {
  const paths = arcSelfRootPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  const proposed: Omit<SelfContract, 'content_hash'> = {
    source: 'user_contract', authority: 'ARC run contract',
    decisions: 'The Agent chooses task actions, component changes, orchestration, context use, and whether to validate a declared effect.',
    readonly_reason: 'Environment observations and action results are recorded facts; the runner owns bridge execution and budgets.',
    boundaries: [...FLOOR], capabilities: [...new Set(capabilities)],
    writable: ['components.prompt', 'components.skill', 'components.tool', 'components.subagent', 'components.memory', 'policy', 'orchestration'],
    acceptance: { terminal_states: ['WIN', 'GAME_OVER', 'FINISHED'], task_metrics: 'recorded ARC task and environment facts only' },
    inherit_defaults: false,
  };
  const contract = { ...proposed, content_hash: hash(proposed) } as SelfContract;
  if (existsSync(paths.contract)) {
    const saved = JSON.parse(readFileSync(paths.contract, 'utf8')) as SelfContract;
    const savedBody = Object.fromEntries(Object.entries(saved).filter(([key]) => key !== 'content_hash'));
    if (saved.content_hash !== hash(savedBody)) throw Error(`ARC SelfRoot contract hash mismatch: ${paths.contract}`);
    if (saved.content_hash === contract.content_hash) return saved;
    const legacyBody = { ...savedBody } as Record<string, unknown>;
    delete legacyBody.budget;
    const previous = { ...proposed, writable: proposed.writable.filter(address => address !== 'components.subagent') };
    const previousWithoutTools = { ...previous, writable: previous.writable.filter(address => address !== 'components.tool') };
    if (hash(legacyBody) !== contract.content_hash && hash(legacyBody) !== hash(previous) && hash(legacyBody) !== hash(previousWithoutTools))
      throw Error(`ARC SelfRoot contract differs from current capabilities: ${paths.contract}`);
    migrateArcContractHash(paths.state, saved.content_hash, contract.content_hash);
    writeFileSync(paths.contract + '.next', JSON.stringify(contract, null, 2));
    renameSync(paths.contract + '.next', paths.contract);
    return contract;
  }
  writeFileSync(paths.contract + '.next', JSON.stringify(contract, null, 2));
  renameSync(paths.contract + '.next', paths.contract);
  return contract;
}

function migrateArcContractHash(statePath: string, previousHash: string, nextHash: string) {
  if (!existsSync(statePath)) return;
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  if (saved?.root?.contract_hash !== previousHash) return;
  saved.root.contract_hash = nextHash;
  writeFileSync(statePath + '.next', JSON.stringify(saved, null, 2));
  renameSync(statePath + '.next', statePath);
}

export function arcRunPosition(observation: any, trajectoryLength: number, decision: number) {
  return { state: observation?.state ?? null, levels_completed: Number(observation?.levels_completed ?? 0),
    actions: trajectoryLength, decision, action_budget: observation?.action_budget ?? null };
}

export function arcMetrics(trajectory: any[], observation: any) {
  return [
    { name: 'arc.actions', value: trajectory.length, unit: 'count' },
    { name: 'arc.levels_completed', value: Number(observation?.levels_completed ?? 0), unit: 'count' },
    { name: 'arc.resets', value: trajectory.filter(row => row.action === 'RESET').length, unit: 'count' },
    { name: 'arc.invalid_actions', value: trajectory.filter(row => row.invalid === true).length, unit: 'count' },
  ];
}

export function arcHistoryPage(trajectory: any[], offset = 0, count = 8) {
  const start = Math.max(0, trajectory.length - offset - Math.min(count, 10));
  const end = Math.max(0, trajectory.length - offset);
  const actions = trajectory.slice(start, end).map((row, index) => ({ row, n: start + index + 1 })).reverse().map(({ row, n }) => ({
    n, action: row.action, x: row.x, y: row.y, changed_cells: row.changed_cells,
    level_changed: row.level_changed, levels_completed: row.levels_completed, state: row.state,
    note: row.note, transition: `transition:${n}`,
  }));
  return { actions, total: trajectory.length, next_offset: start > 0 ? offset + actions.length : null };
}

/** Opaque ARC run facts stored inside SelfRoot's single live runtime-view object. */
export function arcRuntimeView(observation: any, trajectory: any[], decision: number, context: Record<string, unknown> = {}) {
  const grid = observation?.grid ?? observation?.frame?.grid ?? observation?.frames?.at?.(-1) ?? null;
  return {
    position: { decision, actions: trajectory.length, state: observation?.state ?? null,
      levels_completed: Number(observation?.levels_completed ?? 0), action_budget: observation?.action_budget ?? null },
    observation: { state: observation?.state ?? null, levels_completed: Number(observation?.levels_completed ?? 0),
      available_actions: observation?.available_actions ?? [], grid },
    history: { total_actions: trajectory.length, full: 'read_self(section="arc_history", offset, count)' },
    context,
  };
}

export function selfRootToolSchema(evo: SelfRoot, name: string): any {
  if (name === 'reflect_component') return providerOperationSchema('component', undefined, undefined, { layer: evo.mech.l4 });
  if (name === 'reflect_orchestration') return providerOperationSchema('orchestration', undefined, evo.current.orchestration, { layer: evo.mech.l4 });
  if (name === 'decide_exit') return evo.exitOperationSchema;
  if (name === 'decide_validation') return evo.dueWindows.length ? providerOperationSchema('validation') : undefined;
  if (name === 'decide') return { type: 'object', properties: {
    op: { type: 'string', enum: ['enter_mode', 'capsule', 'inherit'] }, decisionId: { type: 'string' }, result: {},
    mode: { type: 'string' }, value: { type: 'object' }, summary: { type: 'string' },
  }, required: [], additionalProperties: false };
  return null;
}

export const selfRootToolParameters = Type.Object({
  section: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })), ref: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()), name: Type.Optional(Type.String()), version: Type.Optional(Type.Integer({ minimum: 1 })),
  op: Type.Optional(Type.String()),
}, { additionalProperties: true });

export function arcOperationContract(kind: 'component' | 'orchestration' | 'review' | 'validation') {
  return operationContract(kind);
}

/** ARC-only protocol wiring. The core remains task-neutral; this adapter owns facts and tool dispatch. */
export function installArcSelfRootTools({ pi, evo, resolveSessionToolOperation, text, persist, contextItem, readEvidence, runPosition, trajectory = () => [],
  pythonSession = true }: any) {
  const readResults = new Map<string, unknown>();
  const open = (keys: string[]) => Type.Object(Object.fromEntries(keys.map(k => [k, Type.Optional(Type.Any())])), { additionalProperties: true });
  const register = (name: string, description: string, parameters: any, execute: (a: any, ctx: any, signal?: any) => any) => pi.registerTool({
    name, label: name, description, parameters,
      execute: async (_id: string, args: any, signal: any, _update: any, ctx: any) => {
      try {
        const result = await execute(args ?? {}, ctx, signal);
        persist();
        const selfIndex = name === 'read_self' && (args?.section ?? 'policy') === 'self' && result?.entries;
        const history = name === 'read_self' && args?.section === 'arc_history' && result?.actions;
        const output = typeof result === 'string' ? result : history
          ? `ARC history: ${result.actions.length}/${result.total} actions, newest first; cells=changed cells, level=level changed (0/1).\n` +
            result.actions.map((row: any, index: number) =>
              `#${row.n} ${row.action}${Number.isInteger(row.x) && Number.isInteger(row.y) ? `(${row.x},${row.y})` : ''}` +
              ` cells=${row.changed_cells ?? '?'} level=${Number(Boolean(row.level_changed))} ${row.transition}` +
              (index === 0 && row.note ? ` note=${JSON.stringify(String(row.note).replace(/\s+/g, ' ').slice(0, 64))}` : '')).join('\n') +
            `\nnext_offset=${result.next_offset ?? 'none'}; detail: read_self(section="evidence",ref="transition:N",offset=1)`
          : selfIndex
          ? `SelfRoot r${result.revision}; entries ${result.entries.offset + 1}-${result.entries.offset + result.entries.count}/${result.entries.total}: ` +
            `${result.entries.rows.map((row: any) => {
              const current = row.current ?? {};
              const state = current.active === false ? 'candidate' : current.version ? `v${current.version}`
                : row.kind === 'orchestration' ? `r${current.revision ?? 1}` : 'configured';
              return `${row.kind}/${row.name} ${state} E${Number(row.use.exposed)}R${Number(row.use.body_read)}X${Number(row.use.executed)}` +
                `${row.use.changed ? '+' : ''}${row.use.outcomes.length ? `@${row.use.outcomes.slice(-1)[0]}` : ''}`;
            }).join(' | ')}; E=exposed, R=body read, X=executed, +=changed; semantic use is not inferred. ` +
            `${result.entries.next === null ? 'No next page.' : `Next offset ${result.entries.next}: read_self(section="self", offset=${result.entries.next}, count=8).`} ` +
            `Expand source/definitions with read_self_component or read_self(section=policy|definition|ledger).`
          : JSON.stringify(result, null, name === 'read_self' ? 2 : undefined);
        return text(output, undefined, Boolean(result?.context_reset_requested));
      }
      catch (error: any) {
        evo.fact('tool_failed', { tool: name, error: String(error?.message ?? error) });
        persist();
        return text(JSON.stringify({ is_error: true, error: String(error?.message ?? error), terminate: false, same_turn_correction: 'Repair the operation using the visible fields and retry.' }));
      }
    },
  });
  register('read_self', 'On-demand lookup when the working view lacks a needed fact. Current observation, recent action results and task memory are already provided. Use section="arc_history" for older actions (up to 10 per page), section="evidence" for a specific transition, or section="self"/"policy"/"ledger" to inspect SelfRoot.', selfRootToolParameters, (a) => {
    // SelfRoot policy, component and ledger reads can change during this decision after a reflection.
    const cacheable = a.section === 'arc_history' || a.section === 'evidence';
    const actions = trajectory();
    const key = `${runPosition?.()?.decision ?? 0}:${actions.length}:${JSON.stringify(a)}`;
    if (cacheable && readResults.has(key)) return readResults.get(key);
    const result = a.section === 'evidence' ? readEvidence?.(a.ref, a.offset ?? 0) ?? { ref: a.ref, state: 'missing' }
      : a.section === 'context_item' && a.ref ? contextItem?.(a.ref) ?? { ref: a.ref, state: 'missing' }
        : a.section === 'arc_history' ? arcHistoryPage(actions, a.offset ?? 0, a.count ?? 8)
          : evo.detail(a.section ?? 'policy', a.offset ?? 0, a.count ?? 20);
    if (cacheable) readResults.set(key, result);
    return result;
  });
  register('read_self_component', 'Read one active or retained ARC SelfRoot component.', selfRootToolParameters, (a) => {
    const rows = evo.allComponents?.() ?? evo.active?.() ?? [];
    const found = rows.filter((x: any) => (!a.kind || x.kind === a.kind) && (!a.name || x.name === a.name) && (a.version === undefined || x.version === a.version));
    return found.length ? found : { state: 'missing', kind: a.kind ?? null, name: a.name ?? null, version: a.version ?? null };
  });
  const component = operationContract('component');
  const componentKeys = Object.keys(component.properties).filter(key => pythonSession || key !== 'session_ref');
  const componentDescription = pythonSession ? component.description
    : component.description.replace('Python session functions can be exported with session_ref and description.',
      'Provide complete source; Python scratch definitions do not persist.');
  register('reflect_component', componentDescription, open(componentKeys), async (a, _ctx, signal) => {
    if (!pythonSession && a.session_ref !== undefined) throw Error('Python session publishing is disabled; provide complete source.');
    const operation = normalizeOperation('component', a, undefined, { layer: evo.mech.l4 });
    return evo.reflectComponent(await resolveSessionToolOperation(operation, signal));
  });
  const orchestration = operationContract('orchestration');
  register('reflect_orchestration', orchestration.description, open(Object.keys(orchestration.properties)), (a) => evo.transaction(normalizeOperation('orchestration', a, undefined, { layer: evo.mech.l4 })));
  register('decide', 'Submit an ARC task decision or enter a SelfRoot mode.', selfRootToolParameters, (a) => {
    if (a.op === 'enter_mode') return evo.enterMode(a.mode);
    if (a.op === 'capsule') return evo.capsule(a.value);
    if (a.op === 'inherit') return evo.inherit(a.value ?? {});
    if (evo.reviewExitSchema) throw Error('close the active review with decide_exit first');
    return { decision: evo.decide({ decisionId: a.decisionId, actor: 'agent', evidenceRefs: [], result: a.result }), transition: evo.advance() };
  });
  register('decide_exit', 'Close the active ARC SelfRoot review.', open(Object.keys(operationContract('review').properties)), (a) => evo.exit(normalizeOperation('review', a, evo.reviewExitSchema)));
  register('decide_validation', 'Interpret a due ARC validation window.', open(Object.keys(operationContract('validation').properties)), (a) => evo.interpret(normalizeOperation('validation', a).window));
  return { names: ['read_self', 'read_self_component', 'reflect_component', 'reflect_orchestration', 'decide', 'decide_exit', 'decide_validation'] };
}
