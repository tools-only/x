/** ScienceWorld `layered` profile: one python tool, text-domain observations, bounded continuation and component-based self-evolution. */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ScienceWorldBridgeClient, ScienceWorldLayeredPython, type ActionBatch, type ScienceWorldLayeredState } from "./scienceworld_layered_python.ts";
import { scienceworldEnvAdapter } from "./scienceworld_env_adapter.ts";
import { LayeredComponents, type Component, type Kind } from "./arc_layered_components.ts";

export const SCIENCEWORLD_STATE_TYPE = "scienceworld-layered-state";

type Options = {
  root: string;
  harnessProfile: boolean;
  outputTokens: number;
  maxActionsPerCall: number;
  idleContinuations: number;
  timeoutMs: number;
  outputChars: number;
};

export function installScienceWorldLayered(
  pi: ExtensionAPI,
  python: ScienceWorldLayeredPython,
  options: Options,
) {
  const store = join(options.root, "harness");
  mkdirSync(store, { recursive: true });
  const write = (file: string, row: Record<string, unknown>) => appendFileSync(join(store, file), JSON.stringify(row) + "\n", "utf8");
  const log = (kind: string, row: Record<string, unknown>) => write("layered.jsonl", { t: new Date().toISOString(), kind, segment, ...row });
  const system = scienceworldEnvAdapter.systemPrompt();
  const components = options.harnessProfile ? new LayeredComponents(join(store, "components")) : undefined;

  let started = false, segment = 0, segmentStart = Date.now(), segmentTokens = 0, segmentActions = 0, idle = 0;
  let actedThisTurn = false, endReason: string | undefined, pending: ActionBatch | null = null;
  let consecutiveLengthStops = 0, lastStop: string | undefined;

  const safeState = (): ScienceWorldLayeredState => {
    try { return python.state(); } catch { return { level: 1, levels_completed: 0, win_levels: 0, state: "NOT_FINISHED",
      step: 0, actions_used: 0, budget_left: 0, level_budget: 0, level_budget_left: 0, valid_actions: [], observation: "",
      look: "", inventory: "", task_description: "", score: 0, stale_steps: 0, unchecked_batches: 0 }; }
  };
  const collectMemoryChecks = () => components
    ? components.list("memory").flatMap(item => Object.entries(item.verify ?? {}).map(([rule, expr]) => ({ id: `${item.name}/${rule}`, expr })))
    : [];

  function content(batch: ActionBatch | null, nudge = false) {
    const state = safeState();
    const lines: string[] = [];
    if (nudge) lines.push("Continue. Inspect current_obs/transitions and act via submit_actions, or make one targeted capability change.");
    if (consecutiveLengthStops > 0) lines.push(`LENGTH RECOVERY (${consecutiveLengthStops}): the previous reply hit the output limit before acting. Output minimal reasoning and call python now.`);
    lines.push(`TASK: ${state.task_description}\nOBS: ${state.observation}\nLOOK: ${state.look}\nINV: ${state.inventory}\nSCORE: ${state.score}`);
    const budget: string[] = [`level ${state.level}/${state.win_levels}`, state.state, `step ${state.step}`, `actions used ${state.actions_used}`];
    if (state.budget_left !== undefined) budget.push(`run budget left ${state.budget_left}`);
    if (state.level_budget_left !== undefined) budget.push(`level budget left ${state.level_budget_left}`);
    lines.push(`STATE: ${budget.join(" | ")} | valid: ${state.valid_actions.length} actions`);
    if (batch) lines.push(`Last batch: executed ${batch.executed}${batch.actions.length ? ` (${batch.actions.join(" | ")})` : ""}${batch.stop_reason ? `, stopped: ${batch.stop_reason}` : ""}`);
    return [{ type: "text" as const, text: lines.join("\n\n") }];
  }

  const pythonTool = {
    name: "python", label: "python", executionMode: "sequential" as const,
    description: "Run Python in the ScienceWorld session. submit_actions([...]) inside the code is the only way to act.",
    parameters: Type.Object({ code: Type.String({ description: "Python code to run" }) }),
    async execute(_id: string, params: { code: string }, signal?: AbortSignal) {
      consecutiveLengthStops = 0;
      if (actedThisTurn) return { details: {}, terminate: true, content: [{ type: "text", text: "Not run: an earlier python call in this reply already acted. Read the new state message first." }] };
      const from = Date.now();
      const outcome = await python.run(params.code, signal);
      const batch = outcome.acted;
      const state = safeState();
      log("python", { ms: Date.now() - from, acted: !!batch, actions: batch?.executed ?? 0, stop_reason: batch?.stop_reason ?? null,
        truncated: outcome.truncated, error: outcome.error ?? null, kernel_restarted: !!outcome.kernelRestarted,
        level: state.level, step: state.step, metrics: outcome.metrics });
      let terminate = false;
      if (batch) {
        actedThisTurn = true;
        idle = 0;
        segmentActions += batch.executed;
        endReason = batch.win ? "win" : (state.budget_left === 0 || state.level_budget_left === 0) ? "budget"
          : batch.level_changed ? "level_change" : batch.game_over ? "game_over" : "action";
        pending = batch;
        terminate = true;
      }
      let resultText = outcome.text;
      if (batch) resultText += `\n[env] executed ${batch.executed}${batch.actions.length ? ` (${batch.actions.join(" | ")})` : ""}` +
        `${batch.stop_reason ? `, stopped: ${batch.stop_reason}` : ""} | level ${state.level}/${state.win_levels} ${state.state}` +
        ` | step ${state.step}, budget left ${state.budget_left}`;
      return { content: [{ type: "text", text: resultText }], details: { acted: batch, error: outcome.error ?? null },
        ...(terminate ? { terminate: true } : {}) };
    } };
  pi.registerTool(pythonTool);

  if (components) {
    const reflectSchema = Type.Object({ op: Type.Union([Type.Literal("define"), Type.Literal("redefine"), Type.Literal("restore")]),
      kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent")]),
      name: Type.String(), body: Type.Optional(Type.String()), summary: Type.Optional(Type.String()), version: Type.Optional(Type.Number()),
      verify: Type.Optional(Type.Record(Type.String(), Type.String())) });
    const readSchema = Type.Object({ kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent")]),
      name: Type.String(), version: Type.Optional(Type.Number()) });
    pi.registerTool({ name: "reflect_component", label: "reflect_component", executionMode: "sequential",
      description: "Define, revise or restore a versioned memory, skill, prompt or subagent role. Memory accepts optional verify: {rule_name: one-line Python expr over t}.",
      parameters: reflectSchema,
      async execute(_id, params) {
        try {
          const item = components.reflect(params.op, params.kind as Kind, params.name, params.body, params.summary, params.version, params.verify);
          const state = safeState();
          components.recordChange(item.kind, item.name, state.level, state.step);
          log("component_change", { op: params.op, component_kind: item.kind, name: item.name, version: item.version,
            level: state.level, step: state.step, verify_rules: item.verify ? Object.keys(item.verify) : [] });
          let reply = `${item.kind}/${item.name} v${item.version} active`;
          if (item.kind === "memory") {
            const stats = await python.syncMemoryChecks(collectMemoryChecks());
            const rules = Object.keys(item.verify ?? {});
            log("memory_verify_sync", { name: item.name, version: item.version, rules, level: state.level, step: state.step,
              stats: Object.fromEntries(rules.map(r => [`${item.name}/${r}`, stats[`${item.name}/${r}`] ?? null])) });
            const parts = rules.map(r => {
              const st = stats[`${item.name}/${r}`];
              if (!st) return `${r}: pending`;
              if (st.error) return `${r}: err(${st.error.slice(0, 60)})`;
              if (st.checked === 0) return `${r}: 0 checked`;
              return `${r}: ${st.support}/${st.checked} held${st.counter ? `, ${st.counter} failed` : ""}`;
            });
            if (parts.length) reply += ` [verify: ${parts.join("; ")}]`;
          }
          return { details: {}, content: [{ type: "text", text: reply }] };
        } catch (error) {
          return { details: {}, isError: true, content: [{ type: "text", text: String(error) }] };
        }
      } });
    pi.registerTool({ name: "read_component", label: "read_component", executionMode: "sequential",
      description: "Read one versioned component body, especially a skill when its index is relevant.",
      parameters: readSchema,
      async execute(_id, params) {
        try {
          const item = params.version ? components.read(params.kind as Kind, params.name, params.version)
            : components.current(params.kind as Kind, params.name);
          if (!item) throw Error("no active component");
          const state = safeState();
          components.recordRead(item.kind, item.name, state.level, state.step);
          log("read_component", { kind: item.kind, name: item.name, version: item.version, level: state.level, step: state.step });
          const verifyBlock = item.verify && Object.keys(item.verify).length ? `\nverify: ${JSON.stringify(item.verify)}` : "";
          return { details: {}, content: [{ type: "text", text: `${item.kind}/${item.name} v${item.version}\n${item.body}${verifyBlock}` }] };
        } catch (error) {
          return { details: {}, isError: true, content: [{ type: "text", text: String(error) }] };
        }
      } });
  }

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!started) await python.init();
    if (components) {
      const checks = collectMemoryChecks();
      if (checks.length) await python.syncMemoryChecks(checks);
    }
    started = true;
    segment += 1; segmentStart = Date.now(); segmentTokens = 0; segmentActions = 0; idle = 0;
    actedThisTurn = false; endReason = lastStop = undefined;
    const batch = pending; pending = null;
    return { systemPrompt: system, message: { customType: SCIENCEWORLD_STATE_TYPE, content: content(batch, false), display: false } };
  });
  pi.on("turn_start", () => { actedThisTurn = false; });
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload as Record<string, any>;
    if (!options.outputTokens) return;
    const key = ctx.model?.api?.includes("responses") ? "max_output_tokens" : "max_completion_tokens" in payload ? "max_completion_tokens" : "max_tokens";
    for (const name of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) delete payload[name];
    payload[key] = options.outputTokens;
    return payload;
  });
  pi.on("message_end", event => {
    const message: any = event.message;
    if (message.role !== "assistant") return;
    lastStop = message.stopReason;
    segmentTokens += (message.usage?.input ?? 0) + (message.usage?.output ?? 0);
    const usage = message.usage ?? {};
    const total = Number.isFinite(usage.totalTokens) && usage.totalTokens > 0 ? usage.totalTokens : (usage.input ?? 0) + (usage.output ?? 0);
    write("usage.jsonl", { t: new Date().toISOString(), kind: "agent", model: message.model ?? null,
      input: usage.input ?? null, output: usage.output ?? null, cache_read: usage.cacheRead ?? null,
      cache_write: usage.cacheWrite ?? null, total: total || null, stop_reason: message.stopReason ?? null });
    if (message.stopReason === "length") consecutiveLengthStops += 1;
    else if (message.stopReason === "stop") consecutiveLengthStops = 0;
  });
  pi.on("agent_before_settle", event => {
    if (event.outcome !== "completed" || endReason || lastStop === "length" || lastStop === "error") return;
    const state = safeState();
    endReason = state.state === "WIN" ? "win" : state.budget_left === 0 || state.level_budget_left === 0 ? "budget" : undefined;
    if (!endReason && idle >= options.idleContinuations) endReason = "idle";
    if (endReason) return;
    idle += 1;
    return { continue: true, entries: [...event.entries, { type: "custom_message", customType: SCIENCEWORLD_STATE_TYPE,
      content: content(null, true), display: false }] };
  });
  pi.on("agent_settled", () => log("segment_end", { reason: endReason ?? lastStop ?? "aborted", actions: segmentActions, tokens: segmentTokens }));
  pi.on("session_shutdown", () => python.close());
}

export default function scienceworldLayeredExtension(pi: ExtensionAPI) {
  const env = process.env;
  const root = env.SCIENCEWORLD_RUN_ROOT ?? process.cwd();
  const harnessProfile = env.SCIENCEWORLD_PROFILE === "harness";
  const maxActionsPerCall = Number(env.SCIENCEWORLD_MAX_ACTIONS_PER_CALL ?? 16);
  const python = new ScienceWorldLayeredPython(
    new ScienceWorldBridgeClient(env.SCIENCEWORLD_BRIDGE_URL!, env.SCIENCEWORLD_ACTION_TOKEN!),
    { timeoutMs: Number(env.SCIENCEWORLD_TIMEOUT_MS ?? 30000), outputChars: Number(env.SCIENCEWORLD_OUTPUT_CHARS ?? 8192),
      maxActionsPerCall, workDir: join(root, "work") });
  installScienceWorldLayered(pi, python, {
    root, harnessProfile, maxActionsPerCall,
    outputTokens: Number(env.SCIENCEWORLD_OUTPUT_TOKENS ?? 4096),
    idleContinuations: Number(env.SCIENCEWORLD_IDLE_CONTINUATIONS ?? 3),
    timeoutMs: Number(env.SCIENCEWORLD_TIMEOUT_MS ?? 30000),
    outputChars: Number(env.SCIENCEWORLD_OUTPUT_CHARS ?? 8192),
  });
}
