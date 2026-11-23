/** ARC `layered` profile: one python tool, state messages, context eviction, carried note blocks, bounded continuation. */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BridgeClient, COLOR_LEGEND, LayeredPython, type ActionBatch, type LayeredState } from "./arc_layered_python.ts";
import { PALETTE } from "./arc_thin_ch_view.ts";
import { RequestTrace, usageRecord } from "./arc_thin_requests.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";

export const STATE_TYPE = "arc-layered-state";
export const MEMORY_TYPE = "arc-layered-memory";
export const TAGS = ["World model", "Goal model", "Action model", "Recent findings", "Open questions", "Plan", "Cross-level notes"];
const IMAGE_TOKENS = 1000;

export type LayeredOptions = { scale: number; gridLines: boolean; reminder: boolean; contextTarget: number;
  idleContinuations: number; segmentSeconds: number; segmentTokens: number; maxActionsPerCall: number; outputTokens: number; root: string };
type Python = Pick<LayeredPython, "init" | "run" | "state" | "close">;
type Content = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;

const prompt = (name: string) => readFileSync(new URL(`./prompts/${name}`, import.meta.url), "utf8");

function pngChunk(name: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(name, "ascii"), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

export function framePng(grid: number[][], scale: number, gridLines: boolean) {
  const dot = gridLines ? 2 : 0, left = dot * 8, top = dot * 6;
  const width = left + grid[0].length * scale, height = top + grid.length * scale, stride = 1 + width * 3, raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * stride] = 0;
  const put = (x: number, y: number, color: number[]) => { for (let channel = 0; channel < 3; channel += 1) raw[y * stride + 1 + x * 3 + channel] = color[channel]; };
  for (let y = 0; y < grid.length * scale; y += 1) for (let x = 0; x < grid[0].length * scale; x += 1) {
    const color = PALETTE[grid[Math.floor(y / scale)][Math.floor(x / scale)]];
    const line = gridLines && (x % (scale * 8) === 0 || y % (scale * 8) === 0);
    put(left + x, top + y, line ? color.map(value => Math.round((value + 128) / 2)) : color);
  }
  const label = (text: string, x0: number, y0: number) => [...text].forEach((digit, index) => {
    for (let bit = 0; bit < 15; bit += 1) if (DIGITS[Number(digit)][bit] === "1")
      for (let dy = 0; dy < dot; dy += 1) for (let dx = 0; dx < dot; dx += 1)
        put(x0 + index * dot * 4 + (bit % 3) * dot + dx, y0 + Math.floor(bit / 3) * dot + dy, [0, 0, 0]);
  });
  if (dot) for (let cell = 0; cell < Math.max(grid.length, grid[0].length); cell += 8) {
    if (cell < grid[0].length) label(String(cell), left + cell * scale + 1, 1);
    if (cell < grid.length) label(String(cell), 1, top + cell * scale + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

export function extractTags(text: string): Record<string, string> {
  const heading = new RegExp(`^\\s*(?:#{1,6}\\s*|[-*]\\s+)?\\**(${TAGS.join("|")})\\**\\s*(?::\\**|$)\\s*(.*)$`, "i");
  const blocks: Record<string, string> = {};
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = heading.exec(line);
    if (match) {
      current = TAGS.find(tag => tag.toLowerCase() === match[1].toLowerCase())!;
      blocks[current] = match[2];
    } else if (current) blocks[current] += `\n${line}`;
  }
  return Object.fromEntries(Object.entries(blocks).map(([tag, body]) => [tag, body.trim()]).filter(([, body]) => body));
}

export function estimateTokens(message: any): number {
  const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
  return parts.reduce((sum: number, part: any) => sum + (part.type === "image" ? IMAGE_TOKENS
    : Math.ceil((part.type === "text" ? part.text : part.type === "thinking" ? part.thinking : JSON.stringify(part.arguments ?? "")).length / 4)), 4);
}

/** A block is a user-role message plus the assistant and tool turns after it, so a call never loses its result. */
export function evict(input: any[], target: number, extraBlocks: number) {
  const lastState = input.findLastIndex(message => message.role === "custom" && message.customType === STATE_TYPE);
  const messages = input.map((message, index) => index === lastState || message.role !== "custom" || message.customType !== STATE_TYPE ? message
    : { ...message, content: message.content.filter((part: any) => part.type !== "image") });
  const starts = messages.flatMap((message, index) => message.role === "user" || message.role === "custom" ? [index] : []);
  const sizes = messages.map(estimateTokens), before = sizes.reduce((sum, size) => sum + size, 0);
  let cut = 0, removed = 0, blocks = 0;
  for (const next of starts.filter(start => start > 0 && start <= lastState)) {
    if (before - removed <= target && blocks >= extraBlocks) break;
    removed = sizes.slice(0, next).reduce((sum, size) => sum + size, 0);
    cut = next;
    blocks += 1;
  }
  return { messages: messages.slice(cut), blocks, removed, before };
}

export function installLayered(pi: ExtensionAPI, python: Python, options: LayeredOptions) {
  const store = join(options.root, "harness");
  mkdirSync(store, { recursive: true });
  const write = (file: string, row: Record<string, unknown>) => appendFileSync(join(store, file), JSON.stringify(row) + "\n", "utf8");
  const log = (kind: string, row: Record<string, unknown>) => write("layered.jsonl", { t: new Date().toISOString(), kind, segment, ...row });
  const [, ...parts] = prompt("arc_layered_state.md").split(/^## (\w+)\s*$/m);
  const template = Object.fromEntries(parts.flatMap((name, index) => index % 2 ? [] : [[name, parts[index + 1].trim()]])) as
    Record<"state" | "reminder" | "nudge", string>;
  const system = prompt("arc_layered_system.md").replaceAll("{{color_legend}}", COLOR_LEGEND)
    .replaceAll("{{max_actions_per_call}}", String(options.maxActionsPerCall));
  let memory: Record<string, string> = {};
  let started = false, segment = 0, segmentStart = 0, segmentTokens = 0, segmentActions = 0, idle = 0, decision = 0, extraBlocks = 0;
  let actedThisTurn = false, endReason: string | undefined, lastStop: string | undefined, pending: ActionBatch | null = null;
  const requests = new RequestTrace(row => write("request-events.jsonl", row), () => python.state().actions_used);
  let request: string | undefined;

  const softLimit = () => Date.now() - segmentStart >= options.segmentSeconds * 1000 ? "soft_time"
    : segmentTokens >= options.segmentTokens ? "soft_tokens" : undefined;

  function content(batch: ActionBatch | null, nudge = false): Content {
    const state = python.state(), events: string[] = [];
    if (batch?.level_changed) events.push(`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done. ` +
      "Write 2-3 lines of notes about what carries over.");
    if (state.state === "GAME_OVER") events.push("GAME_OVER: only RESET is possible now.");
    if (state.state === "WIN") events.push("WIN: the game is finished.");
    if (state.budget_left !== undefined && state.budget_left <= Math.max(5, 0.1 * (state.actions_used + state.budget_left)))
      events.push(`BUDGET: ${state.budget_left} actions left.`);
    const shown = batch?.actions.slice(0, 10).join(" ");
    const values: Record<string, string> = { events: events.join("\n"),
      batch: batch ? `Last batch: ${batch.executed} executed: ${shown}${batch.executed > 10 ? ` (+${batch.executed - 10} more)` : ""}` +
        `${batch.stop_reason ? `; stopped: ${batch.stop_reason}` : ""}` : "",
      level: String(state.level), win_levels: String(state.win_levels), state: state.state, step: String(state.step),
      actions_used: String(state.actions_used), budget: state.budget_left === undefined ? "" : ` | budget left ${state.budget_left}`,
      valid: state.valid_actions.join(" "), memory: TAGS.filter(tag => memory[tag]).map(tag => `${tag}: ${memory[tag]}`).join("\n") };
    const text = [nudge ? template.nudge : "", template.state.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]),
      options.reminder ? template.reminder : ""].join("\n").replace(/\n{2,}/g, "\n").trim();
    return [{ type: "text", text }, { type: "image", mimeType: "image/png",
      data: framePng(state.frame, options.scale, options.gridLines).toString("base64") }];
  }

  pi.registerTool({ name: "python", label: "python", executionMode: "sequential",
    description: "Run Python in the game kernel. submit_actions([...]) inside the code is the only way to act.",
    parameters: Type.Object({ code: Type.String({ description: "Python code to run" }) }),
    async execute(_id, params, signal) {
      if (actedThisTurn) return { details: {}, ...(endReason ? { terminate: true } : {}), content: [{ type: "text", text:
        "Not run: an earlier python call in this reply already acted. Read the new state message first." }] };
      const from = Date.now(), outcome = await python.run(params.code, signal), batch = outcome.acted, state = python.state();
      log("python", { ms: Date.now() - from, acted: !!batch, actions: batch?.executed ?? 0, stop_reason: batch?.stop_reason ?? null,
        truncated: outcome.truncated, error: outcome.error ?? null, kernel_restarted: !!outcome.kernelRestarted,
        level: state.level, step: state.step, metrics: outcome.metrics });
      if (batch) {
        actedThisTurn = true;
        idle = 0;
        segmentActions += batch.executed;
        endReason = batch.win ? "win" : state.budget_left === 0 ? "budget" : batch.level_changed ? "level_change" : softLimit();
        if (endReason) pending = batch;
        else pi.sendMessage({ customType: STATE_TYPE, content: content(batch), display: false }, { deliverAs: "steer" });
      }
      return { content: [{ type: "text", text: outcome.text }], details: { acted: batch }, ...(endReason ? { terminate: true } : {}) };
    } });

  pi.on("before_agent_start", async () => {
    if (!started) await python.init();
    started = true;
    segment += 1; segmentStart = Date.now(); segmentTokens = 0; segmentActions = 0; idle = 0;
    endReason = lastStop = undefined;
    const batch = pending;
    pending = null;
    return { systemPrompt: system, message: { customType: STATE_TYPE, content: content(batch), display: false } };
  });
  pi.on("turn_start", () => { actedThisTurn = false; });
  pi.on("session_before_compact", () => ({ cancel: true }));

  pi.on("context", (event, ctx) => {
    const target = options.contextTarget || (ctx.model?.contextWindow ?? 128000) - 32000;
    const result = evict(event.messages, target, extraBlocks);
    if (result.blocks) log("evict", { blocks: result.blocks, messages: event.messages.length - result.messages.length,
      tokens_removed: result.removed, estimate_before: result.before, target });
    return { messages: result.messages };
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (request) requests.finish(request);
    request = requests.start("parent", decision += 1);
    const payload = event.payload as Record<string, any>;
    if (!options.outputTokens) return;
    const key = ctx.model?.api?.includes("responses") ? "max_output_tokens" : "max_completion_tokens" in payload ? "max_completion_tokens" : "max_tokens";
    for (const name of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) delete payload[name];
    payload[key] = options.outputTokens;
    return payload;
  });
  pi.on("after_provider_response", event => { if (request) requests.headers(request, event.status); });

  pi.on("message_end", event => {
    const message: any = event.message;
    if (message.role !== "assistant") return;
    if (request) requests.finish(request, message);
    request = undefined;
    lastStop = message.stopReason;
    segmentTokens += (message.usage?.input ?? 0) + (message.usage?.output ?? 0);
    write("usage.jsonl", { decision, kind: "agent", ...usageRecord(message), model: message.model, request_id: requests.idFor(message) ?? null });
    if (message.stopReason === "error" && /context (window|length)|maximum context|too long|too many tokens/i.test(message.errorMessage ?? "")) {
      extraBlocks += 1;
      lastStop = "context_overflow";
      log("context_overflow", { error: message.errorMessage, extra_blocks: extraBlocks });
    }
    const found = extractTags(message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n"));
    if (Object.keys(found).length) pi.appendEntry(MEMORY_TYPE, memory = { ...memory, ...found });
  });

  pi.on("agent_before_settle", event => {
    if (event.outcome !== "completed" || endReason || lastStop === "length" || lastStop === "error") return;
    const state: LayeredState = python.state();
    endReason = state.state === "WIN" ? "win" : state.budget_left === 0 ? "budget" : softLimit();
    if (!endReason && idle >= options.idleContinuations) endReason = "idle";
    if (endReason) return;
    idle += 1;
    return { continue: true, entries: [...event.entries, { type: "custom_message", customType: STATE_TYPE,
      content: content(null, true), display: false }] };
  });
  pi.on("agent_settled", () => log("segment_end", { reason: endReason ?? lastStop ?? "aborted", actions: segmentActions, tokens: segmentTokens }));
  pi.on("session_shutdown", () => python.close());
}

export default function arcLayeredExtension(pi: ExtensionAPI) {
  const env = process.env, root = env.ARC_RUN_ROOT ?? process.cwd(), local = env.ARC_LAYERED_CONFIG === "kaggle-local";
  const maxActionsPerCall = 16;
  if (env.PI_PROVIDER_MAX_REPORTED_TOKENS) {
    const store = join(root, "harness");
    mkdirSync(store, { recursive: true });
    installReportedTokenBudget(pi, store, { countCache: env.ARC_LAYERED_COUNT_CACHE === "1" });
    installProviderTelemetry(pi, { root: store, scope: "arc-layered" });
  }
  const python = new LayeredPython(new BridgeClient(env.PI_ARC_BRIDGE_URL!, env.PI_ARC_ACTION_TOKEN!), {
    numericGrid: env.ARC_LAYERED_NUMERIC_GRID !== "0", namespaceResetPerCall: env.ARC_LAYERED_NAMESPACE_RESET === "1",
    undo: env.ARC_LAYERED_UNDO === "1", timeoutMs: 30000, outputChars: 4096, maxActionsPerCall, workDir: join(root, "work"),
    competition: env.ARC_LAYERED_COMPETITION === "1" });
  installLayered(pi, python, { scale: local ? 4 : 8, gridLines: !local, reminder: local, root, maxActionsPerCall,
    outputTokens: Number(env.ARC_LAYERED_OUTPUT_TOKENS ?? 12000),
    contextTarget: Number(env.ARC_LAYERED_CONTEXT_TARGET ?? (local ? 32000 : 0)),
    idleContinuations: Number(env.ARC_LAYERED_IDLE_CONTINUATIONS ?? 3),
    segmentSeconds: Number(env.ARC_LAYERED_SEGMENT_SECONDS ?? 1200), segmentTokens: Number(env.ARC_LAYERED_SEGMENT_TOKENS ?? 200000) });
}
