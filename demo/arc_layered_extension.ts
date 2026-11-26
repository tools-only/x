/** ARC `layered` profile: one python tool, state messages, context eviction/folding/compaction, carried note blocks, bounded continuation. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BridgeClient, COLOR_LEGEND, LayeredPython, type ActionBatch, type LayeredState, type StepFact } from "./arc_layered_python.ts";
import { RequestTrace, usageRecord } from "./arc_request_trace.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";

export const STATE_TYPE = "arc-layered-state";
export const MEMORY_TYPE = "arc-layered-memory";
export const NOTEBOOK_TYPE = "arc-layered-notebook";
export const TAGS = ["World model", "Goal model", "Action model", "Recent findings", "Open questions", "Plan", "Cross-level notes"];
export const NOTEBOOK_SECTIONS = ["controls", "entities", "rules", "goal_hypotheses", "levels", "open_questions", "dead_ends"];
const IMAGE_TOKENS = 1000;
const PALETTE: Array<[number, number, number, number]> = [
  [0xff, 0xff, 0xff, 0xff], [0xcc, 0xcc, 0xcc, 0xff], [0x99, 0x99, 0x99, 0xff], [0x66, 0x66, 0x66, 0xff],
  [0x33, 0x33, 0x33, 0xff], [0x00, 0x00, 0x00, 0xff], [0xe5, 0x3a, 0xa3, 0xff], [0xff, 0x7b, 0xcc, 0xff],
  [0xf9, 0x3c, 0x31, 0xff], [0x1e, 0x93, 0xff, 0xff], [0x88, 0xd8, 0xf1, 0xff], [0xff, 0xdc, 0x00, 0xff],
  [0xff, 0x85, 0x1b, 0xff], [0x92, 0x12, 0x31, 0xff], [0x4f, 0xcc, 0x30, 0xff], [0xa3, 0x56, 0xd6, 0xff],
];

export type LayeredOptions = { scale: number; gridLines: boolean; reminder: boolean; contextCap: number; contextTarget: number; diffImage: boolean;
  idleContinuations: number; segmentSeconds: number; segmentTokens: number; maxActionsPerCall: number; outputTokens: number; root: string;
  stuckAfter: number; foldAfter: number; compactMargin: number; notebook: boolean; gradient?: boolean; rollAfter?: number;
  maxObserveCallsPerTurn?: number;
  flags?: { expect?: boolean; graph?: boolean; work?: boolean; model?: boolean; tags?: boolean; claims?: boolean } };
type Python = Pick<LayeredPython, "init" | "run" | "state" | "close"> & Partial<Pick<LayeredPython, "gradient">>;
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

function readReviewCallback(root: string) {
  try {
    const text = readFileSync(join(root, "work", "REVIEW.md"), "utf8");
    const matches = [...text.matchAll(/^\s*(?:\*\*)?下一关看(?:\*\*)?\s*[:：]\s*(.+)$/gm)];
    return matches.at(-1)?.[1]?.trim() ?? "";
  } catch { return ""; }
}

function readCapabilityContext(root: string) {
  const work = join(root, "work"), lines: string[] = [];
  for (const relative of ["GUIDE.md", "WORKING.md", "REVIEW.md"]) {
    try { const text = readFileSync(join(work, relative), "utf8").trim(); if (text) lines.push(`${relative}: ${text.slice(-1200)}`); } catch {}
  }
  for (const directory of ["claims", "lib"]) {
    try { const names = readdirSync(join(work, directory)).filter(name => name.endsWith(".py")).sort(); if (names.length) lines.push(`${directory}/: ${names.join(", ")}`); } catch {}
  }
  try { const model = readFileSync(join(work, "model.py"), "utf8"); lines.push(`model.py: ${["state_key", "predict", "is_fatal"].filter(name => new RegExp(`def\\s+${name}\\b|${name}\\s*=`).test(model)).join(", ") || "present"}`); } catch {}
  return lines.join("\n");
}

function writeLevelReview(root: string, level: number, state: LayeredState, steps: StepFact[], notes: string[]) {
  const trajectory = steps.slice(-15).map(fact => `s${fact.step} ${fact.action} try${fact.tries}` +
    `${fact.same ? " same" : ""}${fact.death ? " DEATH" : ""}${fact.level_up ? " LEVEL_UP" : ""}` +
    `${fact.source ? ` via ${fact.source}` : ""}${fact.predict_off !== null ? ` off:${fact.predict_off}` : ""}` +
    `${fact.claims_failed.length ? ` failed:${fact.claims_failed.join("/")}` : ""}` +
    `${fact.claims_held.length ? ` held:${fact.claims_held.join("/")}` : ""}`);
  const memory = [
    ...new Set(steps.flatMap(fact => [...fact.claims_failed, ...fact.claims_held].map(name => `claims/${name}`))),
    ...notes.filter(note => note.includes("claims/")).map(note => note.slice(0, 120))];
  const model = steps.filter(fact => fact.predict_off !== null).map(fact => `predict off ${fact.predict_off} at s${fact.step}`);
  const method = [...new Set(steps.filter(fact => fact.source).map(fact => fact.source!))];
  const tool = notes.filter(note => !note.includes("claims/")).map(note => note.slice(0, 120));
  const list = (name: string, values: string[]) => `## ${name}\n${values.length ? values.slice(-12).map(value => `- ${value}`).join("\n") : "- none"}`;
  const directory = join(root, "work", "replay");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `level_${level}.md`);
  const body = [
    `# Level ${level} review`, "",
    `Outcome: ${state.state}; actions used ${state.actions_used}; completed ${state.levels_completed}/${state.win_levels}.`,
    "", "## Compressed trajectory", "",
    trajectory.length ? trajectory.join("\n") : "- no transition facts", "", list("Memory (claims)", memory), "",
    list("Model", model), "", list("Method (lib)", method), "", list("Tool", tool), "",
    "## Three questions", "",
    "1. Which attribution actually caused the repeated or fatal transitions?",
    "2. What one executable artifact would prevent that failure or encode the successful pattern?",
    "3. What is the next safe probe, and what observation would falsify it?", ""].join("\n");
  writeFileSync(path, body, "utf8");
  return "work/replay/" + `level_${level}.md`;
}

export function estimateTokens(message: any): number {
  const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
  return parts.reduce((sum: number, part: any) => sum + (part.type === "image" ? IMAGE_TOKENS
    : Math.ceil((part.type === "text" ? part.text : part.type === "thinking" ? part.thinking : JSON.stringify(part.arguments ?? "")).length / 4)), 4);
}

/** A block is a user-role message plus the assistant and tool turns after it, so a call never loses its result.
 * Hysteresis: nothing is removed until the estimate passes `cap`; then whole blocks go until `target`, so the
 * remaining prefix stays byte-identical across many requests and provider prefix caching keeps working. */
export function evict(input: any[], cap: number, target: number, extraBlocks: number) {
  const lastState = input.findLastIndex(message => message.role === "custom" && message.customType === STATE_TYPE);
  const messages = input.map((message, index) => index === lastState || message.role !== "custom" || message.customType !== STATE_TYPE ? message
    : { ...message, content: message.content.filter((part: any) => part.type !== "image") });
  const starts = messages.flatMap((message, index) => message.role === "user" || message.role === "custom" ? [index] : []);
  const sizes = messages.map(estimateTokens), before = sizes.reduce((sum, size) => sum + size, 0);
  let cut = 0, removed = 0, blocks = 0;
  if (before > cap || extraBlocks > 0)
    for (const next of starts.filter(start => start > 0 && start <= lastState)) {
      if (before - removed <= target && blocks >= extraBlocks) break;
      removed = sizes.slice(0, next).reduce((sum, size) => sum + size, 0);
      cut = next;
      blocks += 1;
    }
  return { messages: messages.slice(cut), blocks, removed, before };
}

/** Folding (context level 2): old tool results collapse to their `[env]` line; images are stripped. Pairing stays intact. */
export function fold(input: any[], keepBlocks: number) {
  const starts = input.flatMap((message, index) => message.role === "user" || message.role === "custom" ? [index] : []);
  const cutoff = keepBlocks > 0 && starts.length > keepBlocks ? starts[starts.length - keepBlocks] : 0;
  let folded = 0;
  if (!cutoff) return { messages: input, folded };
  const messages = input.map((message, index) => {
    if (index >= cutoff || message.role !== "toolResult" || !Array.isArray(message.content)) return message;
    const content = message.content.flatMap((part: any) => {
      if (part.type === "image") { folded += 1; return []; }
      if (part.type !== "text") return [part];
      const lines = part.text.split("\n");
      const kept = lines.find((line: string) => line.startsWith("[env]")) ?? lines[0] ?? "";
      if (kept === part.text) return [part];
      folded += 1;
      return [{ type: "text", text: `${kept}\n[folded ${part.text.length} chars]` }];
    });
    return { ...message, content };
  });
  return { messages, folded };
}

/** Collapse pure-observation toolResults (no `[env]` line) once a later acting toolResult exists. */
export function foldPreActionObservations(input: any[]) {
  let lastActed = -1;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const m = input[i];
    if (m.role === "toolResult" && Array.isArray(m.content)
        && m.content.some((p: any) => p.type === "text" && /(?:^|\n)\[env\]/.test(p.text))) {
      lastActed = i;
      break;
    }
  }
  if (lastActed <= 0) return { messages: input, folded: 0 };
  let folded = 0;
  const messages = input.map((message, index) => {
    if (index >= lastActed || message.role !== "toolResult" || !Array.isArray(message.content)) return message;
    const texts = message.content.filter((p: any) => p.type === "text").map((p: any) => p.text);
    const joined = texts.join("\n");
    if (!joined || /(?:^|\n)\[env\]/.test(joined) || joined.includes("[folded ")) return message;
    folded += 1;
    return { ...message, content: [{ type: "text", text: `[folded pre-action observe: ${joined.length} chars]` }] };
  });
  return { messages, folded };
}

/** Compaction (context level 3): everything before the last block becomes one deterministic summary message. */
export function compactHistory(input: any[], summary: string) {
  const starts = input.flatMap((message, index) => message.role === "user" || message.role === "custom" ? [index] : []);
  const last = starts.at(-1) ?? 0;
  if (last <= 0) return null;
  return [{ role: "user", content: [{ type: "text", text: summary }] }, ...input.slice(last)];
}

export function installLayered(pi: ExtensionAPI, python: Python, options: LayeredOptions) {
  const store = join(options.root, "harness");
  mkdirSync(store, { recursive: true });
  const write = (file: string, row: Record<string, unknown>) => appendFileSync(join(store, file), JSON.stringify(row) + "\n", "utf8");
  const log = (kind: string, row: Record<string, unknown>) => write("layered.jsonl", { t: new Date().toISOString(), kind, segment, ...row });
  const [, ...parts] = prompt("arc_layered_state.md").split(/^## (\w+)\s*$/m);
  const template = Object.fromEntries(parts.flatMap((name, index) => index % 2 ? [] : [[name, parts[index + 1].trim()]])) as
    Record<"state" | "reminder" | "nudge", string>;
  const flags: Record<string, boolean> = { expect: false, graph: false, work: false, model: false, tags: false,
    claims: false, ...options.flags };
  flags.no_model = !flags.model;
  const system = prompt("arc_layered_system.md")
    .replace(/\{\{\?(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, name, body) => flags[name] ? body : "")
    .replaceAll("{{color_legend}}", COLOR_LEGEND)
    .replaceAll("{{max_actions_per_call}}", String(options.maxActionsPerCall));
  let memory: Record<string, string> = {};
  let notebook: Record<string, string> = {};
  let trail: string[] = [];
  let lastReviewCallback = "";
  let lastReviewPath = "";
  let capabilityContext = readCapabilityContext(options.root);
  try { memory = JSON.parse(readFileSync(join(store, "memory.json"), "utf8")); } catch {}
  try { notebook = JSON.parse(readFileSync(join(store, "notebook.json"), "utf8")); } catch {}
  lastReviewCallback = readReviewCallback(options.root);
  const levelSteps: StepFact[] = [];
  let started = false, segment = 0, segmentStart = 0, segmentTokens = 0, segmentActions = 0, idle = 0, decision = 0, extraBlocks = 0;
  let rawEstimate = 0, rollThreshold = 0;
  let actedThisTurn = false, observeCallsThisTurn = 0, observeLimitHitThisTurn = false, consecutiveObserveTurns = 0;
  let endReason: string | undefined, lastStop: string | undefined, pending: ActionBatch | null = null;
  let shownFrame: number[][] | null = null, shownLevel = 0;
  const requests = new RequestTrace(row => write("request-events.jsonl", row), () => python.state().actions_used);
  let request: string | undefined;

  const softLimit = () => Date.now() - segmentStart >= options.segmentSeconds * 1000 ? "soft_time"
    : segmentTokens >= options.segmentTokens ? "soft_tokens" : undefined;

  function content(batch: ActionBatch | null, nudge = false): Content {
    const state = python.state(), events: string[] = [];
    if (nudge && consecutiveObserveTurns > 0)
      events.push(`OBSERVE LIMIT: static inspection already ran ${consecutiveObserveTurns} turn(s) on this unchanged board without acting. Take a 1-step probe or plan now.`);
    if (batch?.level_changed) events.push(`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done. ` +
      "Write 2-3 lines of notes about what carries over. The latest frame is the starting board of the next level: carry the " +
      "mechanics you established forward as hypotheses, inspect unfamiliar elements (new elements often introduce the mechanic " +
      "this level needs), and reassess whether the goal is still the same.");
    if (state.state === "GAME_OVER") events.push("GAME_OVER: this attempt FAILED (a fatal action or a depleted budget); completed " +
      "levels are kept and only RESET is possible now. Before resetting, diagnose the cause: the latest frame is the death frame, " +
      "`history[-1].action` was the fatal action and `history[-2].frame` was the board just before it. The game is deterministic: " +
      "replaying the sequence that just failed will fail again, so change the plan before the fatal point and record the cause.");
    if (state.state === "WIN") events.push("WIN: the game is finished.");
    if (state.budget_left !== undefined && state.budget_left <= Math.max(5, 0.1 * (state.actions_used + state.budget_left)))
      events.push(`BUDGET: ${state.budget_left} actions left.`);
    if (state.level_budget_left !== undefined && state.level_budget !== undefined
        && state.level_budget_left <= Math.max(3, 0.25 * state.level_budget))
      events.push(`LEVEL BUDGET: ${state.level_budget_left} of ${state.level_budget} actions left on this level, and the run ` +
        "ends when they are gone. If the level looks lost, stop re-trying routes: spend the rest on deliberate probes and bank " +
        "what you learned as work/claims/ files - knowledge survives this level, unspent actions do not.");
    if (options.stuckAfter > 0 && state.stale_steps >= options.stuckAfter) {
      const rounds = Math.floor(state.stale_steps / options.stuckAfter);
      events.push(rounds >= 4 ? `STUCK: ${state.stale_steps} steps without a new state. Stop and review in full: name the ` +
        "failing layer (action choice, rule hypothesis, goal reading or object representation), the evidence for it, the change " +
        "that follows, and a test that tells the new reading from the old. Move up (re-read the goal and overall structure) or " +
        "down (inspect transitions and intermediate frames) before acting again."
        : rounds >= 2 ? `STUCK: ${state.stale_steps} steps without a new state. Enumerate 2-3 alternative framings of the game, ` +
          "rule out the ones your recorded transitions already contradict, then act within the survivor."
        : `STUCK: ${state.stale_steps} steps without a new state. Before acting: which layer is failing — action choice, ` +
          "rule hypothesis, goal reading, or object representation? `harness_state` has the evidence.");
    }
    if (flags.expect && (state.unchecked_batches ?? 0) >= 3) {
      events.push(`Unchecked: your last ${state.unchecked_batches} action batches carried no expect; without a prediction a ` +
        "wrong belief costs actions instead of becoming a signal.");
    }
    if (state.mini_review) events.push(`MINI REVIEW: ${state.mini_review}. Name the failing attribution (memory/model/method/tool), ` +
      "write the smallest executable fix or one-line decision rule into work/, then continue. Nothing is frozen.");
    if (batch?.steps?.some(fact => fact.claims_failed.length)) events.push(`Claims failed: ` +
      batch.steps.flatMap(fact => fact.claims_failed).join(", ") + ". Treat the next applicable transition as evidence, not as a reason to stop.");
    if (batch?.steps?.some(fact => fact.claims_held.length)) events.push(`Claims held: ` +
      batch.steps.flatMap(fact => fact.claims_held).join(", ") + ".");
    if (batch?.level_changed && lastReviewPath) events.push(`LEVEL REVIEW: ${lastReviewPath}` +
      (lastReviewCallback ? `\nCarry forward: ${lastReviewCallback}` : "") +
      "\nBefore acting on the new level: which attribution failed, what artifact fixes it, and what probe proves that?");
    if (batch?.game_over && !batch.level_changed && lastReviewPath) events.push(`DEATH REVIEW: ${lastReviewPath}` +
      "\nBefore RESET: was this memory, model, method or tool failure? Write the one artifact that prevents a repeat.");
    if (batch?.surprise) events.push("SURPRISE: the last action did not match expect. Revisit the model before acting again.");
    if (batch?.expect_hits) events.push(`Expectations: ${batch.expect_hits} recent predictions held.`);
    if (batch?.notes?.length) events.push(...batch.notes);
    capabilityContext = readCapabilityContext(options.root);
    if (capabilityContext) events.push(`CAPABILITIES (loaded from work/, not enforced):\n${capabilityContext}`);
    if (batch?.steps?.length) {
      const echoes = batch.steps.map(fact => `step ${fact.step}: ${fact.action}` +
        (fact.tries ? ` (repeat ${fact.tries})` : "") + (fact.predict_off ? ` (predict off ${fact.predict_off})` : "") +
        (fact.claims_failed.length ? ` (claims failed: ${fact.claims_failed.join(", ")})` : "") +
        (fact.claims_held.length ? ` (claims held: ${fact.claims_held.join(", ")})` : ""));
      events.push("Trajectory evidence:\n" + echoes.slice(-6).join("\n"));
    }
    if (options.gradient && python.gradient) {
      const g = python.gradient();
      events.push(`Gradient: ${g.actions_this_level} actions this level${g.level_budget_left !== undefined
          ? ` (level budget left ${g.level_budget_left} of ${g.level_budget})`
          : g.budget_left === undefined ? "" : ` (budget left ${g.budget_left})`}` +
        ` · surprises ${g.surprises} · unchecked batches ${g.unchecked_batches} · repeated routes ${g.repeated_sequences}` +
        `${g.expect_hits ? ` · expect hits ${g.expect_hits}` : ""}${g.model ? ` · model backtest ${g.model}` : ""}`);
    }
    const shown = batch?.actions.slice(0, 10).join(" ");
    const values: Record<string, string> = { events: events.join("\n"),
      batch: batch ? `Last batch: ${batch.executed} executed: ${shown}${batch.executed > 10 ? ` (+${batch.executed - 10} more)` : ""}` +
        `${batch.stop_reason ? `; stopped: ${batch.stop_reason}` : ""}` : "",
      level: String(state.level), win_levels: String(state.win_levels), state: state.state, step: String(state.step),
      actions_used: String(state.actions_used),
      budget: (state.level_budget_left === undefined ? "" : ` | level budget left ${state.level_budget_left} of ${state.level_budget}`)
        + (state.budget_left === undefined ? "" : ` | run budget left ${state.budget_left}`),
      valid: state.valid_actions.join(" "), memory: TAGS.filter(tag => memory[tag]).map(tag => `${tag}: ${memory[tag]}`).join("\n"),
      notebook: options.notebook ? NOTEBOOK_SECTIONS.filter(name => notebook[name]).map(name => `${name}: ${notebook[name]}`).join("\n") : "",
      revision: "",
      tags_hint: flags.tags ? " Start your reply with updated `World model:`, `Goal model:`, `Action model:` and `Plan:` blocks." : "" };
    const parts: Content = [];
    let diffNote = "";
    if (options.diffImage && shownFrame && shownLevel === state.level && state.frame !== shownFrame) {
      const mask = state.frame.map((row, r) => row.map((cell, c) => shownFrame![r]?.[c] === cell ? 0 : cell));
      if (mask.some(row => row.some(cell => cell !== 0))) {
        diffNote = "\nThe second image shows only the cells that changed since the previous state message (unchanged cells are white).";
        parts.push({ type: "image", mimeType: "image/png", data: framePng(mask, options.scale, options.gridLines).toString("base64") });
      }
    }
    shownFrame = state.frame;
    shownLevel = state.level;
    const text = [nudge ? template.nudge : "", template.state.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]) + diffNote,
      options.reminder ? template.reminder : ""].join("\n").replace(/\n{2,}/g, "\n").trim();
    return [{ type: "text", text: text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "") }, { type: "image", mimeType: "image/png",
      data: framePng(state.frame, options.scale, options.gridLines).toString("base64") }, ...parts];
  }

  pi.registerTool({ name: "python", label: "python", executionMode: "sequential",
    description: "Run Python in the game kernel. submit_actions([...]) inside the code is the only way to act.",
    parameters: Type.Object({ code: Type.String({ description: "Python code to run" }) }),
    async execute(_id, params, signal) {
      if (actedThisTurn) return { details: {}, ...(endReason ? { terminate: true } : {}), content: [{ type: "text", text:
        "Not run: an earlier python call in this reply already acted. Read the new state message first." }] };
      if (observeLimitHitThisTurn) return { details: {}, terminate: true, content: [{ type: "text", text:
        "Not run: observation limit reached for this turn. Act on the next turn." }] };
      const from = Date.now(), outcome = await python.run(params.code, signal), batch = outcome.acted, state = python.state();
      log("python", { ms: Date.now() - from, acted: !!batch, actions: batch?.executed ?? 0, stop_reason: batch?.stop_reason ?? null,
        truncated: outcome.truncated, error: outcome.error ?? null, kernel_restarted: !!outcome.kernelRestarted,
        level: state.level, step: state.step, images: outcome.images.length, metrics: outcome.metrics });
      let terminate = false;
      if (batch) {
        actedThisTurn = true;
        consecutiveObserveTurns = 0;
        idle = 0;
        segmentActions += batch.executed;
        trail.push(...batch.lines.slice(-3));
        trail = trail.slice(-12);
        endReason = batch.win ? "win" : state.budget_left === 0 || state.level_budget_left === 0 ? "budget"
          : batch.level_changed ? "level_change" : batch.game_over ? "game_over" : "action";
        pending = batch;
        terminate = true;
      } else {
        observeCallsThisTurn += 1;
      }
      for (const fact of outcome.steps ?? []) {
        write("decisions.jsonl", { t: new Date().toISOString(), ...fact, notes: outcome.notes ?? [], error: outcome.error ?? null });
        levelSteps.push(fact);
      }
      if (batch && (batch.level_changed || batch.game_over) && levelSteps.length) {
        lastReviewPath = writeLevelReview(options.root, state.level, state, levelSteps, outcome.notes ?? []);
        levelSteps.length = 0;
        lastReviewCallback = readReviewCallback(options.root);
        capabilityContext = readCapabilityContext(options.root);
      }
      let resultText = outcome.text;
      const observeLimit = options.maxObserveCallsPerTurn ?? 2;
      if (!batch && observeLimit > 0) {
        if (observeCallsThisTurn < observeLimit) {
          resultText += `\n[observe ${observeCallsThisTurn}/${observeLimit}: no action taken; bundle remaining checks into ONE script and act next]`;
        } else {
          observeLimitHitThisTurn = true;
          consecutiveObserveTurns += 1;
          terminate = true;
          resultText += `\n[observe ${observeCallsThisTurn}/${observeLimit}: observation limit reached for this turn. Static inspection cannot reveal new causality; act or run a 1-step probe on the next turn.]`;
          log("observe_limit", { observe_calls: observeCallsThisTurn, consecutive_observe_turns: consecutiveObserveTurns,
            level: state.level, step: state.step });
        }
      }
      const parts: Content = [{ type: "text", text: resultText }];
      for (const image of outcome.images) parts.push({ type: "image", mimeType: "image/png",
        data: framePng(image.grid, image.scale ?? options.scale, options.gridLines).toString("base64") });
      return { content: parts, details: { acted: batch, ...(observeLimitHitThisTurn ? { observe_limit: true } : {}) },
        ...(terminate ? { terminate: true } : {}) };
    } });

  if (options.notebook) pi.registerTool({ name: "notebook", label: "notebook", executionMode: "sequential",
    description: `Durable game notes, injected into every state message. Sections: ${NOTEBOOK_SECTIONS.join(", ")}.`,
    parameters: Type.Object({ op: Type.Union([Type.Literal("replace"), Type.Literal("append"), Type.Literal("delete")]),
      section: Type.String(), text: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      if (!NOTEBOOK_SECTIONS.includes(params.section))
        return { details: {}, content: [{ type: "text", text: `Unknown section. Use one of: ${NOTEBOOK_SECTIONS.join(", ")}` }] };
      if (params.op === "delete") delete notebook[params.section];
      else notebook[params.section] = params.op === "append" && notebook[params.section]
        ? `${notebook[params.section]}\n${params.text ?? ""}` : params.text ?? "";
      pi.appendEntry(NOTEBOOK_TYPE, { ...notebook });
      writeFileSync(join(store, "notebook.json"), JSON.stringify(notebook, null, 1), "utf8");
      return { details: {}, content: [{ type: "text", text: `notebook ${params.section} ${params.op} ok` }] };
    } });

  pi.on("before_agent_start", async () => {
    if (!started) await python.init();
    started = true;
    segment += 1; segmentStart = Date.now(); segmentTokens = 0; segmentActions = 0; idle = 0;
    actedThisTurn = false; observeCallsThisTurn = 0; observeLimitHitThisTurn = false;
    endReason = lastStop = undefined;
    const batch = pending;
    pending = null;
    return { systemPrompt: system, message: { customType: STATE_TYPE, content: content(batch), display: false } };
  });
  pi.on("turn_start", () => { actedThisTurn = false; observeCallsThisTurn = 0; observeLimitHitThisTurn = false; });
  pi.on("session_before_compact", () => ({ cancel: true }));

  pi.on("context", (event, ctx) => {
    const window = (ctx.model?.contextWindow ?? 128000);
    const cap = Math.min(options.contextCap || window - 32000, window - options.outputTokens - 8192);
    const target = Math.min(options.contextTarget || Math.floor(cap / 2), cap);
    const result = evict(event.messages, cap, target, extraBlocks);
    rawEstimate = result.before;
    rollThreshold = (options.rollAfter ?? 0) > 0 ? (options.rollAfter ?? 0) * cap : 0;
    if (result.blocks) log("evict", { blocks: result.blocks, messages: event.messages.length - result.messages.length,
      tokens_removed: result.removed, estimate_before: result.before, cap, target });
    const folding = fold(result.messages, options.foldAfter);
    const preObs = foldPreActionObservations(folding.messages);
    if (folding.folded || preObs.folded) log("fold", { parts: folding.folded, pre_action_observe: preObs.folded, keep_blocks: options.foldAfter });
    let messages = preObs.messages;
    const estimate = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    const hardTarget = (ctx.model?.contextWindow ?? 128000) - options.compactMargin;
    if (options.compactMargin > 0 && estimate > hardTarget) {
      const state = python.state();
      const summary = ["Earlier history was compacted away. What you know so far:",
        TAGS.filter(tag => memory[tag]).map(tag => `${tag}: ${memory[tag]}`).join("\n"),
        options.notebook ? NOTEBOOK_SECTIONS.filter(name => notebook[name]).map(name => `${name}: ${notebook[name]}`).join("\n") : "",
        lastReviewCallback ? `Last review callback: ${lastReviewCallback}` : "",
        capabilityContext ? `Capabilities restored after eviction:\n${capabilityContext}` : "",
        `Progress: level ${state.level} of ${state.win_levels}, ${state.state}, ${state.actions_used} actions used` +
          `${state.budget_left === undefined ? "" : `, ${state.budget_left} budget left`}.`,
        trail.length ? `Recent action results:\n${trail.join("\n")}` : ""].filter(Boolean).join("\n\n");
      const compacted = compactHistory(messages, summary);
      if (compacted) {
        log("compact", { messages_before: messages.length, messages_after: compacted.length, estimate_before: estimate, target: hardTarget });
        messages = compacted;
      }
    }
    write("context.jsonl", { t: new Date().toISOString(), segment, decision: decision + 1,
      total_estimate: messages.reduce((sum, message) => sum + estimateTokens(message), 0),
      messages: messages.map(message => ({ role: message.role, type: message.customType,
        tokens: estimateTokens(message), image: Array.isArray(message.content) && message.content.some((part: any) => part.type === "image") })) });
    return { messages };
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
    if (Object.keys(found).length) {
      pi.appendEntry(MEMORY_TYPE, memory = { ...memory, ...found });
      writeFileSync(join(store, "memory.json"), JSON.stringify(memory, null, 1), "utf8");
    }
  });

  pi.on("agent_before_settle", event => {
    if (event.outcome !== "completed" || endReason || lastStop === "length" || lastStop === "error") return;
    const state: LayeredState = python.state();
    endReason = state.state === "WIN" ? "win" : state.budget_left === 0 || state.level_budget_left === 0 ? "budget" : softLimit();
    if (!endReason && idle >= options.idleContinuations) endReason = "idle";
    if (endReason) return;
    idle += 1;
    return { continue: true, entries: [...event.entries, { type: "custom_message", customType: STATE_TYPE,
      content: content(null, true), display: false }] };
  });
  pi.on("agent_settled", () => log("segment_end", { reason: endReason ?? lastStop ?? "aborted", actions: segmentActions, tokens: segmentTokens,
    raw_estimate: rawEstimate, ...(rollThreshold > 0 ? { roll_threshold: rollThreshold, session_oversized: rawEstimate > rollThreshold } : {}) }));
  pi.on("session_shutdown", () => python.close());
}

export default function arcLayeredExtension(pi: ExtensionAPI) {
  const env = process.env, root = env.ARC_RUN_ROOT ?? process.cwd(), local = env.ARC_LAYERED_CONFIG === "kaggle-local";
  const maxActionsPerCall = 16;
  const stuckAfter = Number(env.ARC_LAYERED_STUCK_AFTER ?? 8);
  if (env.PI_PROVIDER_MAX_REPORTED_TOKENS) {
    const store = join(root, "harness");
    mkdirSync(store, { recursive: true });
    installReportedTokenBudget(pi, store, { countCache: env.ARC_LAYERED_COUNT_CACHE === "1" });
    installProviderTelemetry(pi, { root: store, scope: "arc-layered" });
  }
  const python = new LayeredPython(new BridgeClient(env.PI_ARC_BRIDGE_URL!, env.PI_ARC_ACTION_TOKEN!), {
    numericGrid: env.ARC_LAYERED_NUMERIC_GRID !== "0",
    undo: env.ARC_LAYERED_UNDO !== "0", timeoutMs: 30000, outputChars: 4096, maxActionsPerCall, workDir: join(root, "work"),
    competition: env.ARC_LAYERED_COMPETITION === "1", skipNoops: env.ARC_LAYERED_SKIP_NOOPS === "1",
    expect: env.ARC_LAYERED_EXPECT !== "0", graph: env.ARC_LAYERED_GRAPH === "1",
    miniReview: { maxPerLevel: Number(env.ARC_LAYERED_MINI_REVIEWS_PER_LEVEL ?? 2) } });
  installLayered(pi, python, { scale: Number(env.ARC_LAYERED_SCALE ?? 10), gridLines: !local, reminder: env.ARC_LAYERED_REMINDER !== "0", root, maxActionsPerCall,
    outputTokens: Number(env.ARC_LAYERED_OUTPUT_TOKENS ?? 12000),
    contextCap: Number(env.ARC_LAYERED_CONTEXT_CAP ?? 131072), contextTarget: Number(env.ARC_LAYERED_CONTEXT_TARGET ?? 57344),
    diffImage: env.ARC_LAYERED_DIFF_IMAGE !== "0",
    idleContinuations: Number(env.ARC_LAYERED_IDLE_CONTINUATIONS ?? 3),
    segmentSeconds: Number(env.ARC_LAYERED_SEGMENT_SECONDS ?? 1_000_000), segmentTokens: Number(env.ARC_LAYERED_SEGMENT_TOKENS ?? 100_000_000),
    stuckAfter, foldAfter: Number(env.ARC_LAYERED_FOLD_AFTER ?? 0),
    compactMargin: Number(env.ARC_LAYERED_COMPACT_MARGIN ?? 0), notebook: env.ARC_LAYERED_NOTEBOOK === "1" && !local,
    gradient: env.ARC_LAYERED_GRADIENT === "1", rollAfter: Number(env.ARC_LAYERED_ROLL_AFTER ?? 0),
    maxObserveCallsPerTurn: Number(env.ARC_LAYERED_MAX_OBSERVE_CALLS ?? 2),
    flags: { expect: env.ARC_LAYERED_EXPECT !== "0", graph: env.ARC_LAYERED_GRAPH === "1",
      work: env.ARC_LAYERED_WORK !== "0", model: env.ARC_LAYERED_MODEL !== "0", tags: env.ARC_LAYERED_TAGS === "1",
      claims: env.ARC_LAYERED_CLAIMS !== "0" } });
}
