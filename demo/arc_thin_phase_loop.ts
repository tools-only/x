import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectPhaseContinuity, type PhaseEventCursor } from './arc_thin_phase_context.ts';

export type AdaptRule = { event: 'prediction_miss' | 'claim_failed' | 'level_change'; count: number; within_actions: number; key?: string };
export type AdaptConfig = { mode: 'on_demand' | 'after_batch' | 'manual'; checkpoint_every_batches: number; rules: AdaptRule[] };
type Phase = 'task' | 'adapt' | 'stop';
type LoopState = {
  version: 1; status: 'settled' | 'running' | 'stopped'; phase: Phase; nextPhase: Phase; turn: number;
  lastTaskAction: number; lastAdaptAction: number; batchesSinceAdapt: number;
  startActionCount: number; actionIds: number[]; trigger?: string; focus?: string; stopReason?: string; requestIds: string[]; config?: AdaptConfig;
  eventCursor?: PhaseEventCursor; pendingEventCursor?: PhaseEventCursor;
};
type Row = Record<string, any>;

const DEFAULT: AdaptConfig = {
  mode: 'on_demand', checkpoint_every_batches: 6,
  rules: [{ event: 'prediction_miss', count: 2, within_actions: 8 }],
};
const TASK_PROMPT = 'Decide the next action. Briefly check this window\'s recent trajectory: what changed and what remains uncertain? ' +
  'If there is no real blocker, contradiction, or tool failure, act on the clearest next test without extended analysis. ' +
  'When a registered saved tool fits the analysis or next move you are about to do, call it by its name with current args now; ' +
  'use its result to choose the next action. If it does not fit, continue directly or revise it.';

function validateConfig(value: any): AdaptConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'checkpoint_every_batches,mode,rules') throw Error('adapt config needs mode, checkpoint_every_batches and rules');
  if (!['on_demand', 'after_batch', 'manual'].includes(value.mode)) throw Error('adapt mode must be on_demand, after_batch or manual');
  if (!Number.isInteger(value.checkpoint_every_batches) || value.checkpoint_every_batches < 0 || value.checkpoint_every_batches > 100)
    throw Error('checkpoint_every_batches must be an integer from 0 to 100');
  if (!Array.isArray(value.rules) || value.rules.length > 12) throw Error('rules must be a list with at most 12 entries');
  for (const rule of value.rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
      !['prediction_miss', 'claim_failed', 'level_change'].includes(rule.event) ||
      !Number.isInteger(rule.count) || rule.count < 1 || rule.count > 100 ||
      !Number.isInteger(rule.within_actions) || rule.within_actions < 1 || rule.within_actions > 100 ||
      Object.keys(rule).some(key => !['event', 'count', 'within_actions', 'key'].includes(key)) ||
      (rule.key !== undefined && (rule.event !== 'claim_failed' || typeof rule.key !== 'string' || !rule.key.length || rule.key.length > 80)))
      throw Error('invalid adapt rule');
  }
  return value as AdaptConfig;
}

function rows(path: string): Row[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).flatMap(line => {
    if (!line.trim()) return [];
    try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : []; }
    catch { return []; }
  });
}

function dueReason(config: AdaptConfig, trajectory: Row[], checks: Row[], lastAdaptAction: number, batches: number): string | undefined {
  if (config.mode === 'after_batch') return 'after_batch';
  if (config.mode === 'manual') return undefined;
  for (const rule of config.rules) {
    const start = Math.max(lastAdaptAction, trajectory.length - rule.within_actions);
    const count = rule.event === 'claim_failed'
      ? checks.filter(row => row.result === false && Number.isInteger(row.n) && row.n > start && (rule.key === undefined || row.key === rule.key)).length
      : trajectory.slice(start).filter(row => rule.event === 'prediction_miss'
        ? Boolean(row.prediction?.misses || row.prediction?.fields?.some((field: Row) => field.hit === false))
        : Boolean(row.level_changed)).length;
    if (count >= rule.count) return `${rule.event}${rule.key ? `:${rule.key}` : ''}:${count}/${rule.count} within ${rule.within_actions} actions`;
  }
  return config.checkpoint_every_batches && batches >= config.checkpoint_every_batches
    ? `checkpoint:${config.checkpoint_every_batches} batches` : undefined;
}

/** TypeScript owns phase selection. Python repeats a fixed transport and keeps only process and hard-budget duties. */
export class SelfHarnessPhaseLoop {
  private readonly statePath: string;
  private readonly harnessPath: string;
  private readonly userConfigPath: string;
  private readonly agentConfigPath: string;
  private state: LoopState;
  constructor(runRoot: string, private writeAgentConfig?: (body: string) => void) {
    const harness = join(runRoot, 'harness');
    const internal = join(runRoot, '.harness');
    mkdirSync(harness, { recursive: true }); mkdirSync(internal, { recursive: true });
    this.harnessPath = harness;
    this.statePath = join(internal, 'self-harness-loop.json');
    this.userConfigPath = join(runRoot, 'adapt-config.json');
    this.agentConfigPath = join(runRoot, 'workspace', 'config', 'adapt-config.json');
    if (existsSync(this.statePath)) {
      const loaded = JSON.parse(readFileSync(this.statePath, 'utf8')) as LoopState;
      if (!loaded || loaded.version !== 1 || !['settled', 'running', 'stopped'].includes(loaded.status) ||
        !['task', 'adapt', 'stop'].includes(loaded.phase) || !['task', 'adapt', 'stop'].includes(loaded.nextPhase) ||
        !Number.isInteger(loaded.turn) || !Number.isInteger(loaded.lastTaskAction) || !Number.isInteger(loaded.lastAdaptAction) ||
        !Number.isInteger(loaded.startActionCount) || !Array.isArray(loaded.actionIds) || !Array.isArray(loaded.requestIds) ||
        !loaded.actionIds.every(id => Number.isInteger(id) && id > 0) || !loaded.requestIds.every(id => typeof id === 'string') ||
        !loaded.eventCursor || typeof loaded.eventCursor !== 'object' || Array.isArray(loaded.eventCursor) ||
        !Object.values(loaded.eventCursor).every(line => Number.isInteger(line) && line >= 0))
        throw Error('invalid TypeScript phase state; refusing to infer a phase or replay work');
      this.state = loaded;
    } else this.state = this.initial();
  }
  private initial(): LoopState {
    return { version: 1, status: 'settled', phase: 'task', nextPhase: 'task', turn: 0,
      lastTaskAction: rows(join(this.harnessPath, 'trajectory.jsonl')).length,
      lastAdaptAction: rows(join(this.harnessPath, 'trajectory.jsonl')).length,
      batchesSinceAdapt: 0, startActionCount: 0, actionIds: [], requestIds: [], eventCursor: {} };
  }
  private persist() {
    const temp = `${this.statePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state) + '\n', 'utf8');
    renameSync(temp, this.statePath);
  }
  private record(row: Row) { appendFileSync(join(this.harnessPath, 'adapt_schedule.jsonl'), JSON.stringify({ at: new Date().toISOString(), owner: 'typescript', ...row }) + '\n', 'utf8'); }
  /** Called before each fixed NEXT transport. An in-flight phase is resumed unchanged. */
  begin(transport: 'next' | 'resume', actionCount: number): { phase: Phase; turn: number; trigger?: string; focus?: string; prompt: string; evidence: string } {
    if (this.state.phase === 'stop' || this.state.status === 'stopped')
      return { phase: 'stop', turn: this.state.turn, prompt: 'Stop: the phase owner has settled the run boundary.', evidence: '' };
    // A lost agent_end after a confirmed native action is reconciled from the authoritative trajectory before a new
    // NEXT turn. A RESUME transport always keeps the phase, including provider length and interrupted turns.
    if (this.state.status === 'running' && transport === 'next' && this.state.phase === 'task' && actionCount > this.state.startActionCount)
      this.settle('reconciled_action', actionCount);
    if (this.state.status === 'settled') {
      this.state.phase = this.state.nextPhase;
      this.state.turn += 1;
      if (this.state.phase === 'task') { this.state.trigger = undefined; this.state.focus = undefined; this.state.requestIds = []; this.state.actionIds = []; }
      this.state.startActionCount = actionCount;
      this.state.status = 'running';
      this.persist();
      this.record({ event: 'turn_start', phase: this.state.phase, turn: this.state.turn, trigger: this.state.trigger });
    }
    let visibleConfig = this.state.config ?? DEFAULT;
    try { visibleConfig = this.currentConfig(); }
    catch (error) { this.record({ event: 'invalid_config', error: String(error).slice(0, 300), using: this.state.config ? 'previous_valid' : 'default' }); }
    const prompt = this.state.phase === 'adapt'
      ? `ADAPT TURN ${this.state.turn}. Trigger: ${this.state.trigger ?? 'agent_request'}. Settled action IDs: ${this.state.actionIds.join(', ') || 'none'}.${this.state.focus ? ` Focus: ${this.state.focus}` : ''} Review the current task state and make any useful harness changes, or leave it unchanged; do not act in the environment. Use list_programs(query) to find an executable capability, read_component(name) for its source, then run_program(name, args) on the current state (read-only). Use save_program(name, description, tags?, body) only when evidence supports a revision. A saved revision is used by the next TASK. To change future scheduling, call adapt_policy(config_json) with mode (on_demand, after_batch, manual), checkpoint_every_batches (0-100), and rules (prediction_miss, claim_failed, level_change with count and within_actions). Current policy: ${JSON.stringify(visibleConfig)}.`
      : TASK_PROMPT;
    let evidence = '';
    if (this.state.phase === 'adapt') {
      const events = this.phaseEvents();
      const projected = projectPhaseContinuity(this.state.eventCursor ?? {}, events, { maxChars: 24_000, maxEvents: 40 });
      evidence = projected.text;
      this.state.pendingEventCursor = projected.nextCursor;
      this.persist();
    }
    return { phase: this.state.phase, turn: this.state.turn, trigger: this.state.trigger, focus: this.state.focus, prompt, evidence };
  }
  private phaseEvents() {
    const fields: Record<string, string[]> = {
      'trajectory.jsonl': ['n', 'action', 'via', 'x', 'y', 'note', 'state', 'levels_completed', 'level_changed', 'prediction'],
      'component_runs.jsonl': ['kind', 'name', 'path', 'version', 'decision', 'n', 'ok', 'ms', 'error', 'fingerprint', 'output_excerpt', 'acted', 'saved_as'],
      'memory.jsonl': ['key', 'hyp', 'at', 'by', 'op'],
      'adapt_requests.jsonl': ['event', 'id', 'focus', 'decision', 'action_at', 'outcome'],
      'self_harness_task_facts.jsonl': ['kind', 'decision', 'n', 'tool', 'input', 'output', 'is_error', 'text', 'tool_calls'],
    };
    const sources: Array<Array<{ source: string; line: number; receipt: string }>> = [];
    for (const [file, keys] of Object.entries(fields)) {
      const path = join(this.harnessPath, file);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      const events: Array<{ source: string; line: number; receipt: string }> = [];
      lines.forEach((line, index) => {
        if (!line.trim()) return;
        let parsed: any;
        try { parsed = JSON.parse(line); } catch { parsed = { parse: 'invalid_jsonl_row' }; }
        const row: Row = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
        const facts = Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => {
          const value = row[key];
          if (typeof value === 'string') return [key, value.length > 120 ? `${value.slice(0, 120)}…` : value];
          if (value && typeof value === 'object') {
            const encoded = JSON.stringify(value);
            return [key, encoded.length > 120 ? `${encoded.slice(0, 120)}…` : value];
          }
          return [key, value];
        }));
        events.push({ source: `harness/${file}`, line: index + 1, receipt: JSON.stringify(facts) });
      });
      sources.push(events);
    }
    const ordered: Array<{ source: string; line: number; receipt: string }> = [];
    for (let offset = 0; sources.some(source => offset < source.length); offset++)
      for (const source of sources) if (source[offset]) ordered.push(source[offset]);
    return ordered;
  }
  private currentConfig(): AdaptConfig {
    const path = existsSync(this.agentConfigPath) ? this.agentConfigPath : this.userConfigPath;
    return validateConfig(JSON.parse(readFileSync(path, 'utf8')));
  }
  updateConfig(json: string): string {
    let config: AdaptConfig;
    try { config = validateConfig(JSON.parse(json)); }
    catch (error) { throw new Error(`adapt policy rejected: ${String(error).slice(0, 240)}`); }
    const body = JSON.stringify(config, null, 2) + '\n';
    if (this.writeAgentConfig) this.writeAgentConfig(body);
    else { mkdirSync(join(this.agentConfigPath, '..'), { recursive: true }); writeFileSync(this.agentConfigPath, body, 'utf8'); }
    this.state.config = config;
    this.persist();
    this.record({ event: 'policy_updated', source: 'agent', config });
    return `Adapt policy saved for the next settled Task boundary: ${JSON.stringify(config)}`;
  }
  /** Settles only completed provider turns; length leaves the same phase to be resumed. */
  settle(reason: string, actionCount: number, terminal = false, budgetStop?: string) {
    if (reason !== 'complete' && reason !== 'reconciled_action') return;
    if (this.state.status !== 'running') return;
    if (this.state.phase === 'task') {
      const trajectory = rows(join(this.harnessPath, 'trajectory.jsonl'));
      const requests = rows(join(this.harnessPath, 'adapt_requests.jsonl'));
      const handled = new Set(requests.filter(row => row.event === 'handled').map(row => String(row.id)));
      const pending = requests.filter(row => row.event === 'requested' && !handled.has(String(row.id)));
      const newActions = Math.max(0, actionCount - this.state.lastTaskAction);
      this.state.actionIds = trajectory.slice(this.state.lastTaskAction).map(row => Number(row.n)).filter(Number.isFinite);
      const batches = this.state.batchesSinceAdapt + (newActions ? 1 : 0);
      let config = this.state.config ?? DEFAULT;
      try { config = this.currentConfig(); }
      catch (error) { this.record({ event: 'invalid_config', error: String(error).slice(0, 300), using: this.state.config ? 'previous_valid' : 'default' }); }
      this.state.config = config;
      const reasonDue = pending.length ? 'agent_request' : newActions ? dueReason(config, trajectory, rows(join(this.harnessPath, 'claim_checks.jsonl')),
        this.state.lastAdaptAction, batches) : undefined;
      this.state.requestIds = pending.map(row => String(row.id));
      this.state.focus = pending.map(row => String(row.focus ?? '')).filter(Boolean).join('; ').slice(0, 1000) || undefined;
      this.state.trigger = reasonDue;
      this.state.lastTaskAction = actionCount;
      this.state.batchesSinceAdapt = batches;
      if (terminal || budgetStop) {
        this.state.phase = 'stop'; this.state.nextPhase = 'stop'; this.state.status = 'stopped';
        this.state.stopReason = terminal ? 'terminal' : budgetStop;
        this.state.requestIds = pending.map(row => String(row.id));
        this.markRequests(this.state.stopReason!);
      } else this.state.nextPhase = reasonDue ? 'adapt' : 'task';
      this.record({ event: 'turn_settled', phase: 'task', turn: this.state.turn, actions: actionCount, new_actions: newActions,
        action_ids: this.state.actionIds, requests: this.state.requestIds, trigger: reasonDue, next_phase: this.state.nextPhase,
        stop_reason: this.state.stopReason });
    } else {
      if (this.state.requestIds.length) this.markRequests('settled_by_typescript_loop');
      this.state.lastAdaptAction = actionCount;
      this.state.eventCursor = this.state.pendingEventCursor ?? this.state.eventCursor ?? {};
      this.state.pendingEventCursor = undefined;
      this.state.batchesSinceAdapt = 0;
      this.state.nextPhase = terminal || budgetStop ? 'stop' : 'task';
      if (terminal || budgetStop) { this.state.phase = 'stop'; this.state.status = 'stopped'; this.state.stopReason = terminal ? 'terminal' : budgetStop; }
      this.state.requestIds = [];
      this.state.trigger = undefined;
      this.state.focus = undefined;
      this.record({ event: 'turn_settled', phase: 'adapt', turn: this.state.turn, actions: actionCount, next_phase: this.state.nextPhase,
        stop_reason: this.state.stopReason });
    }
    if (this.state.status !== 'stopped') this.state.status = 'settled';
    this.persist();
  }
  stop(reason: string, actionCount: number) {
    this.state.phase = 'stop'; this.state.nextPhase = 'stop'; this.state.status = 'stopped'; this.state.stopReason = reason;
    this.markRequests(reason); this.record({ event: 'run_stopped', reason, turn: this.state.turn, actions: actionCount }); this.persist();
  }
  get stopReason() { return this.state.stopReason; }
  private markRequests(outcome: string) {
    const requests = rows(join(this.harnessPath, 'adapt_requests.jsonl'));
    const handled = new Set(requests.filter(row => row.event === 'handled').map(row => String(row.id)));
    for (const row of requests.filter(item => item.event === 'requested' && !handled.has(String(item.id))))
      appendFileSync(join(this.harnessPath, 'adapt_requests.jsonl'), JSON.stringify({ event: 'handled', id: row.id, outcome, turn: this.state.turn }) + '\n', 'utf8');
  }
}
