/** ARC `layered` profile: one python tool, state messages, context eviction/folding/compaction, carried note blocks, bounded continuation. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BridgeClient, COLOR_LEGEND, LayeredPython, type ActionBatch, type LayeredState, type StepFact } from "./arc_layered_python.ts";
import { RequestTrace, usageRecord } from "./arc_request_trace.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";
import { LayeredComponents, type Kind } from "./arc_layered_components.ts";

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
  noImage?: boolean;
  harnessProfile?: boolean;
  consult?: boolean;
  maxLengthRecoveries?: number;
  idleContinuations: number; segmentSeconds: number; segmentTokens: number; maxActionsPerCall: number; outputTokens: number; root: string;
  stuckAfter: number; foldAfter: number; compactMargin: number; notebook: boolean; gradient?: boolean; rollAfter?: number;
  maxObserveCallsPerTurn?: number;
  flags?: { expect?: boolean; graph?: boolean; work?: boolean; model?: boolean; tags?: boolean; claims?: boolean } };
type Python = Pick<LayeredPython, "init" | "run" | "state" | "close" | "takeMiniReview"> & Partial<Pick<LayeredPython, "gradient" | "capabilitySnapshot">>;
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
    try { const text = readFileSync(join(work, relative), "utf8").trim(); if (text) lines.push(`${relative}: ${relative === "WORKING.md" ? text.slice(-1600) : text.slice(0, 2400)}`); } catch {}
  }
  for (const directory of ["claims", "lib"]) {
    try { const names = readdirSync(join(work, directory)).filter(name => name.endsWith(".py")).sort(); if (names.length) lines.push(`${directory}/: ${names.join(", ")}`); } catch {}
  }
  try { const model = readFileSync(join(work, "model.py"), "utf8"); lines.push(`model.py: ${["state_key", "predict", "is_fatal"].filter(name => new RegExp(`def\\s+${name}\\b|${name}\\s*=`).test(model)).join(", ") || "present"}`); } catch {}
  return lines.join("\n");
}

export function compressedTrajectory(steps: StepFact[]): string {
  const lines = steps.map(fact => `s${fact.step} ${fact.action} try${fact.tries}` +
    `${fact.same ? " same" : ""}${fact.death ? " DEATH" : ""}${fact.level_up ? " LEVEL_UP" : ""}` +
    `${fact.changed ? " frame-change" : ""}${fact.new ? " new-interior" : ""}` +
    `${fact.source ? ` via ${fact.source}` : ""}${fact.predict_off !== null ? ` off:${fact.predict_off}` : ""}` +
    `${fact.claims_failed.length ? ` failed:${fact.claims_failed.join("/")}` : ""}` +
    `${fact.claims_held.length ? ` held:${fact.claims_held.join("/")}` : ""}`);
  const firstChange = steps.findIndex(fact => fact.changed || fact.new);
  const keep = new Set<number>(steps.flatMap((fact, i) => fact.death || fact.level_up || i === firstChange || i >= steps.length - 3 ? [i] : []));
  let longest = { start: 0, length: 0 };
  for (let i = 0; i < steps.length;) {
    if (steps[i].new || steps[i].death || steps[i].level_up) { i += 1; continue; }
    let j = i + 1;
    while (j < steps.length && !steps[j].new && !steps[j].death && !steps[j].level_up) j += 1;
    if (j - i > longest.length) longest = { start: i, length: j - i };
    i = j;
  }
  if (longest.length) keep.add(longest.start);
  const output: string[] = [];
  for (let i = 0; i < steps.length;) {
    if (keep.has(i)) { output.push(lines[i]); i += 1; continue; }
    let j = i + 1;
    while (j < steps.length && !keep.has(j)) j += 1;
    output.push(`s${steps[i].step}–s${steps[j - 1].step}: ${j - i} steps without a new state; ${steps.slice(i, j).filter(s => s.same).length} same-result repeats`);
    i = j;
  }
  const header = `steps ${steps.length}; same-result ${steps.filter(s => s.same).length}; no-new-interior-state ${steps.filter(s => !s.new).length}; unchanged-frame ${steps.filter(s => !s.changed).length}`;
  const joined = [header, ...output].join("\n");
  if (joined.length <= 3000) return joined;
  const critical = [...keep].sort((a, b) => a - b).map(i => lines[i]);
  const compact = [header, `Other steps: ${steps.length - keep.size}`, ...critical].join("\n");
  if (compact.length <= 3000) return compact;
  const priority = [...keep].sort((a, b) => a - b).filter(i => steps[i].death || steps[i].level_up || i === firstChange || i >= steps.length - 3);
  const prefix = [header, `Other steps omitted: ${steps.length - priority.length}`];
  const perLine = Math.max(12, Math.floor((3000 - prefix.join("\n").length - priority.length) / Math.max(1, priority.length)));
  return [...prefix, ...priority.map(i => lines[i].slice(0, perLine))].join("\n").slice(0, 3000);
}

function writeLevelReview(root: string, level: number, state: LayeredState, steps: StepFact[], notes: string[]) {
  const trajectory = compressedTrajectory(steps);
  const memory = [
    ...new Set(steps.flatMap(fact => [...fact.claims_failed, ...fact.claims_held].map(name => `claims/${name}`))),
    ...notes.filter(note => note.includes("claims/")).map(note => note.slice(0, 120))];
  const model = steps.filter(fact => fact.predict_off !== null).map(fact => `predict off ${fact.predict_off} at s${fact.step}`);
  const method = [...new Set(steps.filter(fact => fact.source).map(fact => fact.source!))];
  const tool = notes.filter(note => !note.includes("claims/")).map(note => note.slice(0, 120));
  const list = (name: string, values: string[]) => `## ${name}\n${values.length ? values.slice(-4).map(value => `- ${value}`).join("\n") : "- none"}`;
  const directory = join(root, "work", "replay");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `level_${level}.md`);
  const body = [
    `# Level ${level} review`, "",
    `Outcome: ${state.state}; actions used ${state.actions_used}; completed ${state.levels_completed}/${state.win_levels}.`,
    "", "## Compressed trajectory", "",
    trajectory || "- no transition facts", "", list("Memory (claims)", memory), "",
    list("Model", model), "", list("Method (lib)", method), "", list("Tool", tool), "",
    "## Three questions", "",
    "1. Which attribution actually caused the repeated or fatal transitions?",
    "2. What one executable artifact would prevent that failure or encode the successful pattern?",
    "3. What is the next safe probe, and what observation would falsify it?", ""].join("\n");
  writeFileSync(path, body.slice(0, 3000), "utf8");
  return "work/replay/" + `level_${level}.md`;
}

export function estimateTokens(message: any): number {
  const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
  return parts.reduce((sum: number, part: any) => sum + (part.type === "image" ? IMAGE_TOKENS
    : Math.ceil((part.type === "text" ? part.text : part.type === "thinking" ? part.thinking : JSON.stringify(part.arguments ?? "")).length / 4)), 4);
}

/** A block is a user-role message plus the assistant and tool turns after it, so a call never loses its result.
 * Hysteresis keeps the previous cut until the retained estimate passes cap, then drops whole blocks to target. */
export function evict(input: any[], cap: number, target: number, extraBlocks: number, anchor = 0) {
  const lastState = input.findLastIndex(message => message.role === "custom" && message.customType === STATE_TYPE);
  const messages = input.map((message, index) => index === lastState || message.role !== "custom" || message.customType !== STATE_TYPE ? message
    : { ...message, content: message.content.filter((part: any) => part.type !== "image") });
  const starts = messages.flatMap((message, index) => message.role === "user" || message.role === "custom" ? [index] : []);
  const sizes = messages.map(estimateTokens), before = sizes.reduce((sum, size) => sum + size, 0);
  let cut = Math.min(anchor, Math.max(0, messages.length - 1));
  let removed = sizes.slice(0, cut).reduce((sum, size) => sum + size, 0), blocks = 0;
  if (before - removed > cap || extraBlocks > 0)
    for (const next of starts.filter(start => start > cut && start <= lastState)) {
      if (before - removed <= target && blocks >= extraBlocks) break;
      removed = sizes.slice(0, next).reduce((sum, size) => sum + size, 0);
      cut = next;
      blocks += 1;
    }
  return { messages: messages.slice(cut), blocks, removed, before, cut };
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
  const system = prompt(options.harnessProfile ? "arc_layered_system_harness.md" : "arc_layered_system.md")
    .replace(/\{\{\?(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, name, body) => flags[name] ? body : "")
    .replaceAll("{{color_legend}}", COLOR_LEGEND)
    .replaceAll("{{max_actions_per_call}}", String(options.maxActionsPerCall));
  let memory: Record<string, string> = {};
  const components = options.harnessProfile ? new LayeredComponents(join(store, "components")) : undefined;
  let notebook: Record<string, string> = {};
  let trail: string[] = [];
  let lastReviewCallback = "";
  let lastReviewPath = "";
  let capabilityContext = readCapabilityContext(options.root);
  let shownCapabilities = "", recoveryText = "", contextWarning = false, warningAnchor = -1, capabilitiesDirty = false;
  try { memory = JSON.parse(readFileSync(join(store, "memory.json"), "utf8")); } catch {}
  try { notebook = JSON.parse(readFileSync(join(store, "notebook.json"), "utf8")); } catch {}
  lastReviewCallback = readReviewCallback(options.root);
  const levelSteps: StepFact[] = [];
  const WINDOW_SIZE = 12;
  const recentSteps: StepFact[] = [];
  const recentCalls: Array<{ errors: number; truncated: number; tools: number }> = [];
  let finishedLevelDigest = "", finishedDeathDigest = "";
  const staleNoticed = new Set<string>();
  let started = false, segment = 0, segmentStart = 0, segmentTokens = 0, segmentActions = 0, idle = 0, decision = 0, extraBlocks = 0;
  let rawEstimate = 0, rollThreshold = 0, evictAnchorIndex = 0;
  let actedThisTurn = false, observeCallsThisTurn = 0, observeLimitHitThisTurn = false, consecutiveObserveTurns = 0;
  let consecutiveLengthStops = 0, currentRequestOutputTokens = options.outputTokens;
  const maxLengthRecoveries = options.maxLengthRecoveries ?? Number(env.ARC_LAYERED_MAX_LENGTH_RECOVERIES ?? 2);
  let endReason: string | undefined, lastStop: string | undefined, pending: ActionBatch | null = null;
  let shownFrame: number[][] | null = null, shownLevel = 0;
  let lastSkillIndex = "";
  const consultsByLevel = new Map<number, number>();
  try {
    for (const line of readFileSync(join(store, "layered.jsonl"), "utf8").split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (row.kind === "consult" && row.attempted === true) consultsByLevel.set(row.level, (consultsByLevel.get(row.level) ?? 0) + 1);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const safeState = (): LayeredState => {
    try { return python.state(); }
    catch { return { level: 1, levels_completed: 0, win_levels: 0, state: "NOT_FINISHED", step: 0, actions_used: 0, valid_actions: [], frame: [], stale_steps: 0, unchecked_batches: 0, mini_review: null }; }
  };
  const registeredTools = new Set<string>();
  const lastPublishError = new Map<string, string>();
  let pythonBin: string | undefined;
  function checkPythonSyntax(source: string): string | null {
    for (const bin of pythonBin ? [pythonBin] : ["python3", "python"]) {
      const res = spawnSync(bin, ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: source, encoding: "utf8" });
      if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") continue;
      pythonBin = bin;
      return res.status === 0 ? null : (res.stderr?.trim().slice(0, 300) || `exit ${res.status}`);
    }
    return null;
  }
  function publishTools(): { published: Array<{ name: string; version: number }>; failed: Array<{ name: string; error: string }> } {
    const published: Array<{ name: string; version: number }> = [];
    const failed: Array<{ name: string; error: string }> = [];
    if (!components) return { published, failed };
    const dir = join(options.root, "work", "lib");
    if (!existsSync(dir)) return { published, failed };
    const st = safeState();
    for (const file of readdirSync(dir).filter(name => /^[a-z][a-z0-9_]*\.py$/.test(name))) {
      const name = file.slice(0, -3), source = readFileSync(join(dir, file), "utf8");
      const match = new RegExp(`^def\\s+(${name}|run)\\s*\\(\\s*([^)\\n]*)\\)\\s*(?:->[^:\\n]+)?\\s*:`, "m").exec(source);
      if (!match) continue;
      const [, fn, rawArgs] = match;
      const trimmedArgs = rawArgs.trim();
      const zeroArg = trimmedArgs === "";
      const singleArg = /^[a-zA-Z_]\w*(?:\s*:[^=]+)?(?:\s*=.*)?$/.test(trimmedArgs);
      if (!zeroArg && !singleArg) continue;
      const syntaxErr = checkPythonSyntax(source);
      if (syntaxErr) {
        if (lastPublishError.get(name) !== `${source.length}:${syntaxErr}`) {
          lastPublishError.set(name, `${source.length}:${syntaxErr}`);
          components.recordPublishFailure(name, st.level, st.step, syntaxErr);
          log("tool_publish_failed", { name, error: syntaxErr });
          failed.push({ name, error: syntaxErr });
        }
        continue;
      }
      lastPublishError.delete(name);
      const entrySummary = zeroArg ? `${fn}()` : fn;
      const active = components.current("tool", name);
      if (!active || active.body !== source || active.summary !== entrySummary) {
        const saved = components.reflect(active ? "redefine" : "define", "tool", name, source, entrySummary);
        components.recordChange("tool", name, st.level, st.step);
        log("tool_published", { name, version: saved.version, hash: saved.hash });
        published.push({ name, version: saved.version });
      }
      if (registeredTools.has(name)) continue;
      registeredTools.add(name);
      pi.registerTool({ name, label: name, executionMode: "sequential",
        description: zeroArg
          ? `Agent-authored Python function work/lib/${file} (${fn}()); pass {} or omit args.`
          : `Agent-authored Python function work/lib/${file} (${fn}(args)); pass one args object.`,
        parameters: Type.Object({ args: Type.Optional(Type.Object({})) }),
        async execute(_id, params, signal) {
          consecutiveLengthStops = 0;
          const current = components.current("tool", name)!;
          const latest = readFileSync(join(dir, file), "utf8");
          if (createHash("sha256").update(latest).digest("hex") !== current.hash)
            return { details: {}, isError: true, content: [{ type: "text", text: "tool source changed; wait for the next publication boundary" }] };
          const isZeroArg = current.summary.endsWith("()");
          const fnName = isZeroArg ? current.summary.slice(0, -2) : current.summary;
          const encoded = Buffer.from(JSON.stringify(params.args ?? {})).toString("base64");
          const callExpr = isZeroArg
            ? `${name}.${fnName}()`
            : `${name}.${fnName}(__import__('json').loads(__import__('base64').b64decode('${encoded}').decode()))`;
          const result = await pythonTool.execute(_id, { code: `print(repr(${callExpr}))` }, signal);
          const acted = Boolean((result as any).details?.acted);
          const ok = !(result as any).isError && !(result as any).details?.error &&
            (!(result as any).terminate || acted);
          const callState = safeState();
          const firstLine = ((result as any).content?.find((p: any) => p.type === "text")?.text ?? "").split("\n")[0]?.slice(0, 120) || "error";
          const witness = ok ? undefined : `L${callState.level} s${callState.step} ${name}: ${firstLine}`;
          const stats = components.recordInvocation("tool", name, callState.level, callState.step, { ok, action_producing: acted, witness });
          recentCalls.push({ errors: ok ? 0 : 1, truncated: 0, tools: 1 });
          if (recentCalls.length > WINDOW_SIZE) recentCalls.shift();
          log("bound_invocation", { name, version: current.version, ok, action_producing: acted, level: callState.level, step: callState.step });
          if (ok) return result;
          const note = `\n[L${callState.level} s${callState.step} tool/${name} failed${stats.consecutive_failures >= 3 ? ` (${stats.consecutive_failures}x consecutive — fix or retire)` : ""}: ${firstLine}]`;
          const parts = Array.isArray((result as any).content) ? (result as any).content : [{ type: "text", text: firstLine }];
          return { ...result, isError: true, content: parts.map((p: any, idx: number) => idx === 0 && p.type === "text" ? { ...p, text: p.text + note } : p) };
        } });
    }
    return { published, failed };
  }
  const requests = new RequestTrace(row => write("request-events.jsonl", row), () => python.state().actions_used);
  let request: string | undefined;

  const softLimit = () => Date.now() - segmentStart >= options.segmentSeconds * 1000 ? "soft_time"
    : segmentTokens >= options.segmentTokens ? "soft_tokens" : undefined;

  function effortProgressSummary(): string {
    const winSteps = recentSteps.slice(-WINDOW_SIZE);
    const winCalls = recentCalls.slice(-WINDOW_SIZE);
    if (!winSteps.length && !winCalls.length) return "";
    const newStates = winSteps.filter(f => f.new).length;
    const repeats = winSteps.filter(f => f.same).length;
    const mouseRegions = winSteps.filter(f => (f.region_tries ?? 0) >= 2).length;
    const tools = winCalls.reduce((s, c) => s + c.tools, 0);
    const errors = winCalls.reduce((s, c) => s + c.errors, 0);
    const truncated = winCalls.reduce((s, c) => s + c.truncated, 0);
    return `EFFORT/PROGRESS (last ${winSteps.length} actions): new_states=${newStates}, same_repeats=${repeats}, repeat_mouse_regions=${mouseRegions}, tool_uses=${tools}, py_errors=${errors}, truncated=${truncated}.`;
  }

  function formatLevelComponentSummary(finishedLevel: number): string {
    if (!components) return "";
    const lines: string[] = [];
    for (const item of components.list()) {
      if (item.kind !== "tool" && item.kind !== "skill" && item.kind !== "subagent") continue;
      const st = components.stats(item.kind, item.name);
      if (!st) continue;
      const cur = st.by_level[String(finishedLevel)] ?? { invocations: 0, ok: 0, action_producing: 0, reads: 0, failures: 0 };
      if (item.kind === "skill") lines.push(`skill/${item.name}: L${finishedLevel} reads=${cur.reads}, total=${st.total.reads}`);
      else lines.push(`${item.kind}/${item.name}: L${finishedLevel} ${cur.ok}/${cur.invocations} ok, total ${st.total.ok}/${st.total.invocations} ok`);
    }
    return lines.length ? `Component stats: ${lines.join("; ")}` : "";
  }

  function content(batch: ActionBatch | null, nudge = false): Content {
    const state = python.state(), events: string[] = [];
    if (consecutiveLengthStops > 0) {
      events.push(`LENGTH RECOVERY (${consecutiveLengthStops}/${maxLengthRecoveries}): the previous reply hit the output token limit before calling a tool. Output minimal reasoning and call python or reflect_component now.`);
    }
    if (components) {
      for (const kind of ["memory", "prompt"] as const) for (const item of components.list(kind)) {
        events.push(`${kind.toUpperCase()} ${item.name} v${item.version}: ${item.body}`);
      }
      const skills = components.list("skill");
      const index = skills.map(item => `${item.name} — ${item.summary} (v${item.version})`).join("; ");
      if (index && (index !== lastSkillIndex || batch?.level_changed)) events.push("SKILLS: " + index);
      lastSkillIndex = index;
      const regionStall = batch?.steps?.some(fact => (fact.region_tries ?? 0) >= 4 || (fact.same_death !== null && fact.same_death !== undefined && fact.same_death !== false));
      const stalled = options.consult !== false && (state.stale_steps >= 12 || regionStall);
      if (stalled) {
        const ep = effortProgressSummary();
        if (ep) events.push(ep);
        if (state.action_invariant) events.push(`INVARIANT: ${state.action_invariant} — do not mistake this drift for action-specific progress.`);
        events.push(`STALL: ${state.stale_steps} steps without a new state${regionStall ? " or repeated failure/clicks" : ""}; consult("reframer", ...) is available.`);
      }
      if (batch?.level_changed) {
        const carried: string[] = [];
        for (const item of components.list()) {
          const st = components.stats(item.kind, item.name);
          const cur = st?.by_level[String(state.level)];
          const curUsed = (cur?.invocations ?? 0) + (cur?.reads ?? 0);
          if (st && st.updated_level < state.level && curUsed === 0) {
            const past = item.kind === "skill" ? `${st.total.reads} past reads` : `${st.total.ok}/${st.total.invocations} past ok`;
            carried.push(`${item.kind}/${item.name} (${past})`);
          }
        }
        if (carried.length) events.push(`Carried from earlier levels (unverified on L${state.level}): ${carried.slice(0, 8).join(", ")}.`);
      }
      const notices: string[] = [];
      for (const item of components.list()) {
        const st = components.stats(item.kind, item.name);
        if (!st) continue;
        if (st.consecutive_failures >= 3) {
          notices.push(`COMPONENT NOTICE: ${item.kind}/${item.name} v${item.version} failed ${st.consecutive_failures} consecutive times (${st.last_failure_witness ?? "see logs"}). Revise, restore, or retire.`);
        } else if ((item.kind === "tool" || item.kind === "skill") && st.updated_level === state.level) {
          const cur = st.by_level[String(state.level)];
          const curCount = item.kind === "skill" ? (cur?.reads ?? 0) : (cur?.invocations ?? 0);
          const since = state.actions_used - (st.last_used_step ?? st.updated_step);
          const noticeKey = `${item.kind}/${item.name}@v${item.version}:L${state.level}`;
          if (curCount === 0 && since >= 12 && !staleNoticed.has(noticeKey)) {
            staleNoticed.add(noticeKey);
            notices.push(`COMPONENT NOTICE: ${item.kind}/${item.name} v${item.version} has 0 ${item.kind === "skill" ? "reads" : "uses"} across ${since} actions — keep if deliberate, or revise/retire.`);
          }
        }
      }
      for (const [key, st] of Object.entries(components.allStats())) {
        if (st.consecutive_publish_failures >= 3 && key.startsWith("tool/")) {
          const tName = key.slice(5);
          notices.push(`COMPONENT NOTICE: work/lib/${tName}.py failed syntax/publish ${st.consecutive_publish_failures}x (${st.last_publish_error ?? "syntax error"}).`);
        }
      }
      if (notices.length) events.push(...notices.slice(0, 2));
    }
    if (contextWarning) {
      events.push(options.harnessProfile
        ? "Context is near the configured limit. Save current findings in Memory via reflect_component."
        : "Context is near the configured limit. Save current findings in work/WORKING.md.");
      contextWarning = false;
    }
    if (nudge && consecutiveObserveTurns > 0)
      events.push(`OBSERVE LIMIT: static inspection already ran ${consecutiveObserveTurns} turn(s) on this unchanged board without acting. Take a 1-step probe or plan now.`);
    if (batch?.level_changed) {
      if (options.harnessProfile) {
        events.push((`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done.\n` +
          (finishedLevelDigest ? finishedLevelDigest + "\n" : "") +
          `Consolidate reusable patterns into Skill (reflect_component kind="skill") or Tool (work/lib/<name>.py), and refresh Memory hypotheses for L${state.level}.`).slice(0, 2400));
        finishedLevelDigest = "";
      } else {
        events.push(`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done. ` +
          "Write 2-3 lines of notes about what carries over. The latest frame is the starting board of the next level: carry the " +
          "mechanics you established forward as hypotheses, inspect unfamiliar elements (new elements often introduce the mechanic " +
          "this level needs), and reassess whether the goal is still the same.");
      }
    }
    if (state.state === "GAME_OVER") {
      if (options.harnessProfile && finishedDeathDigest) {
        events.push((`GAME_OVER: this attempt FAILED (only RESET is valid now).\n${finishedDeathDigest}\n` +
          "Record the falsified rule/cause in Memory's Falsified section via reflect_component before or after RESET.").slice(0, 1200));
        finishedDeathDigest = "";
      } else {
        events.push("GAME_OVER: this attempt FAILED (a fatal action or a depleted budget); completed " +
          "levels are kept and only RESET is possible now. Before resetting, diagnose the cause: the latest frame is the death frame, " +
          "`history[-1].action` was the fatal action and `history[-2].frame` was the board just before it. The game is deterministic: " +
          "replaying the sequence that just failed will fail again, so change the plan before the fatal point and record the cause.");
      }
    }
    if (state.state === "WIN") events.push("WIN: the game is finished.");
    if (state.budget_left !== undefined && state.budget_left <= Math.max(5, 0.1 * (state.actions_used + state.budget_left)))
      events.push(`BUDGET: ${state.budget_left} actions left.`);
    if (state.level_budget_left !== undefined && state.level_budget !== undefined
        && state.level_budget_left <= Math.max(3, 0.25 * state.level_budget))
      events.push(options.harnessProfile
        ? `LEVEL BUDGET: ${state.level_budget_left} of ${state.level_budget} actions left on this level. Stop repeating unverified routes: run discriminating probes with expect= and bank confirmed/falsified rules in Memory via reflect_component.`
        : `LEVEL BUDGET: ${state.level_budget_left} of ${state.level_budget} actions left on this level, and the run ` +
          "ends when they are gone. If the level looks lost, stop re-trying routes: spend the rest on deliberate probes and bank " +
          "what you learned as work/claims/ files - knowledge survives this level, unspent actions do not.");
    if (options.stuckAfter > 0 && state.stale_steps >= options.stuckAfter) {
      if (options.harnessProfile) {
        const ep = effortProgressSummary();
        if (ep && !events.includes(ep)) events.push(ep);
        if (state.action_invariant && !events.some(e => e.startsWith("INVARIANT:")))
          events.push(`INVARIANT: ${state.action_invariant} — do not mistake this drift for action-specific progress.`);
        events.push(`STUCK: ${state.stale_steps} steps without a new state. Test 2 competing hypotheses in Memory (H1 vs H2) with expect= or use consult("reframer", ...) if blocked.`);
      } else {
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
    }
    if (flags.expect && (state.unchecked_batches ?? 0) >= 3) {
      events.push(`Unchecked: your last ${state.unchecked_batches} action batches carried no expect; without a prediction a ` +
        "wrong belief costs actions instead of becoming a signal.");
    }
    const miniReview = python.takeMiniReview();
    if (miniReview) events.push(options.harnessProfile
      ? `MINI REVIEW: ${miniReview}. Update Memory (Confirmed / H1 vs H2 / Falsified / Next Probe) via reflect_component or add a helper in work/lib/, and test with expect=.`
      : `MINI REVIEW: ${miniReview}. Name the failing attribution (memory/model/method/tool), ` +
        "write the smallest executable fix or one-line decision rule into work/, then continue. Nothing is frozen.");
    if (batch?.steps?.some(fact => fact.claims_failed.length)) events.push(`Claims failed: ` +
      batch.steps.flatMap(fact => fact.claims_failed.map(name => {
        const stats = python.capabilitySnapshot?.().claims[name];
        const prior = Object.entries(stats?.by_level ?? {}).some(([level, row]) => Number(level) < fact.level && row.support > 0);
        return `${name} on L${fact.level}${prior ? " (held on an earlier level)" : ""}${stats?.witness ? `: ${stats.witness}` : ""}`;
      })).join(", ") + ".");
    if (batch?.steps?.some(fact => fact.claims_held.length)) events.push(`Claims held: ` +
      batch.steps.flatMap(fact => fact.claims_held).join(", ") + ".");
    if (!options.harnessProfile && batch?.level_changed && lastReviewPath) events.push(`LEVEL REVIEW: ${lastReviewPath}` +
      (lastReviewCallback ? `\nCarry forward: ${lastReviewCallback}` : "") +
      "\nBefore acting on the new level: which attribution failed, what artifact fixes it, and what probe proves that?");
    if (!options.harnessProfile && batch?.game_over && !batch.level_changed && lastReviewPath) events.push(`DEATH REVIEW: ${lastReviewPath}` +
      "\nBefore RESET: was this memory, model, method or tool failure? Write the one artifact that prevents a repeat.");
    if (batch?.surprise) events.push("SURPRISE: the last action did not match expect. Revisit the model before acting again.");
    if (batch?.expect_hits) events.push(`Expectations: ${batch.expect_hits} recent predictions held.`);
    if (batch?.notes?.length) events.push(...batch.notes);
    const evidence = python.capabilitySnapshot?.();
    if (batch?.level_changed && evidence) {
      const carried = Object.entries(evidence.claims).filter(([, claim]) => claim.checked > 0)
        .map(([name]) => `claims/${name} (0 checked on L${state.level})`);
      if (evidence.model?.tested) carried.push(`model.py (0 checked on L${state.level})`);
      if (carried.length) events.push(`Carried from earlier levels: ${carried.join(", ")}`);
    }
    capabilityContext = options.harnessProfile ? "" : readCapabilityContext(options.root);
    if (capabilityContext && (capabilityContext !== shownCapabilities || batch?.level_changed || capabilitiesDirty))
      events.push(`CAPABILITIES (loaded from work/, not enforced):\n${capabilityContext}`);
    shownCapabilities = capabilityContext;
    capabilitiesDirty = false;
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
      valid: state.valid_actions.join(" "), memory: options.harnessProfile ? "" : TAGS.filter(tag => memory[tag]).map(tag => `${tag}: ${memory[tag]}`).join("\n"),
      notebook: options.notebook ? NOTEBOOK_SECTIONS.filter(name => notebook[name]).map(name => `${name}: ${notebook[name]}`).join("\n") : "",
      revision: "",
      tags_hint: flags.tags ? " Start your reply with updated `World model:`, `Goal model:`, `Action model:` and `Plan:` blocks." : "" };
    const parts: Content = [];
    let diffNote = "";
    if (options.diffImage && !options.noImage && shownFrame && shownLevel === state.level && state.frame !== shownFrame) {
      const mask = state.frame.map((row, r) => row.map((cell, c) => shownFrame![r]?.[c] === cell ? 0 : cell));
      if (mask.some(row => row.some(cell => cell !== 0))) {
        diffNote = "\nThe second image shows only the cells that changed since the previous state message (unchanged cells are white).";
        parts.push({ type: "image", mimeType: "image/png", data: framePng(mask, options.scale, options.gridLines).toString("base64") });
      }
    }
    if (options.noImage && shownFrame && shownLevel === state.level && !batch?.reset) {
      const changed: string[] = [];
      const seeds: Array<[number, number]> = [];
      for (let y = 0; y < state.frame.length; y += 1) for (let x = 0; x < state.frame[y].length; x += 1)
        if (state.frame[y][x] !== shownFrame[y]?.[x]) { changed.push(`${x},${y}:${shownFrame[y]?.[x]}→${state.frame[y][x]}`); seeds.push([x, y]); }
      const visited = new Set<string>(), objects: string[] = [];
      for (const [x, y] of seeds) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        const color = state.frame[y][x], todo: Array<[number, number]> = [[x, y]];
        visited.add(key);
        let count = 0, left = x, right = x, top = y, bottom = y;
        while (todo.length) {
          const [cx, cy] = todo.pop()!;
          count += 1; left = Math.min(left, cx); right = Math.max(right, cx); top = Math.min(top, cy); bottom = Math.max(bottom, cy);
          for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
            const next = `${nx},${ny}`;
            if (state.frame[ny]?.[nx] !== color || visited.has(next)) continue;
            visited.add(next); todo.push([nx, ny]);
          }
        }
        objects.push(`${color.toString(16)}:${count}@(${left},${top})–(${right},${bottom})`);
      }
      diffNote = `\nChanged cells (${changed.length}): ${changed.slice(0, 96).join(" ")}${changed.length > 96 ? " …" : ""}` +
        `\nTouched components (${objects.length}): ${objects.slice(0, 12).join(" ")}${objects.length > 12 ? " …" : ""}` +
        "\nFull board is available in python via current_frame.grid / .ascii.";
    }
    const sendFullTextFrame = Boolean(options.noImage && (!shownFrame || shownLevel !== state.level || batch?.reset));
    shownFrame = state.frame;
    shownLevel = state.level;
    const text = [nudge ? template.nudge : "", template.state.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]) + diffNote,
      sendFullTextFrame ? `Frame ${state.frame[0]?.length ?? 0}x${state.frame.length}:\n${state.frame.map(row => row.map(cell => cell.toString(16)).join("")).join("\n")}` : "",
      options.reminder ? template.reminder : ""].join("\n").replace(/\n{2,}/g, "\n").trim();
    const message = { type: "text" as const, text: text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "")
      .replace(options.noImage ? "The image shows the latest frame." : "\0",
        sendFullTextFrame ? "The text frame below shows the latest frame." : "The delta above summarizes the latest frame.") };
    return options.noImage ? [message] : [message, { type: "image", mimeType: "image/png",
      data: framePng(state.frame, options.scale, options.gridLines).toString("base64") }, ...parts];
  }

  const pythonTool = { name: "python", label: "python", executionMode: "sequential" as const,
    description: "Run Python in the game kernel. submit_actions([...]) inside the code is the only way to act.",
    parameters: Type.Object({ code: Type.String({ description: "Python code to run" }) }),
    async execute(_id: string, params: { code: string }, signal?: AbortSignal) {
      consecutiveLengthStops = 0;
      if (actedThisTurn) return { details: {}, ...(endReason ? { terminate: true } : {}), content: [{ type: "text", text:
        "Not run: an earlier python call in this reply already acted. Read the new state message first." }] };
      if (observeLimitHitThisTurn) return { details: {}, terminate: true, content: [{ type: "text", text:
        "Not run: observation limit reached for this turn. Act on the next turn." }] };
      const from = Date.now(), outcome = await python.run(params.code, signal), batch = outcome.acted, state = python.state();
      const pub = publishTools();
      capabilitiesDirty ||= !!outcome.notes?.some(note => /^(?:loaded |claims\/|lib\/|model\.py)/.test(note));
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
      let libCallsInRun = 0;
      for (const fact of outcome.steps ?? []) {
        write("decisions.jsonl", { t: new Date().toISOString(), ...fact, notes: outcome.notes ?? [], error: outcome.error ?? null });
        levelSteps.push(fact);
        recentSteps.push(fact);
        if (recentSteps.length > WINDOW_SIZE) recentSteps.shift();
        const m = fact.source && /^(?:direct_lib|assisted_lib)\/([a-z][a-z0-9_]*)$/.exec(fact.source);
        if (m) {
          libCallsInRun += 1;
          components?.recordInvocation("tool", m[1], fact.level, fact.step, { ok: !outcome.error, action_producing: true });
        }
      }
      recentCalls.push({ errors: outcome.error ? 1 : 0, truncated: outcome.truncated ? 1 : 0, tools: libCallsInRun });
      if (recentCalls.length > WINDOW_SIZE) recentCalls.shift();
      if (batch && (batch.level_changed || batch.game_over) && levelSteps.length) {
        if (batch.level_changed) {
          const traj = compressedTrajectory(levelSteps).slice(0, 1400);
          const compSummary = formatLevelComponentSummary(levelSteps[0].level);
          finishedLevelDigest = [traj, compSummary].filter(Boolean).join("\n");
        }
        if (batch.game_over && !batch.level_changed) {
          const dead = [...levelSteps].reverse().find(f => f.death) ?? levelSteps.at(-1)!;
          const tail = levelSteps.slice(-3).map(f => `s${f.step} ${f.action}${f.death ? " DEATH" : ""}`).join(" -> ");
          const repeatNote = typeof dead.same_death === "number" ? ` (REPEATS death at step ${dead.same_death})`
            : dead.same_death ? " (REPEATS earlier death)" : "";
          finishedDeathDigest = `Fatal transition: step ${dead.step}, action ${dead.action}${repeatNote}; trail: ${tail}.`;
        }
        lastReviewPath = writeLevelReview(options.root, levelSteps[0].level, state, levelSteps, outcome.notes ?? []);
        levelSteps.length = 0;
        lastReviewCallback = readReviewCallback(options.root);
        capabilityContext = readCapabilityContext(options.root);
      }
      let resultText = outcome.text;
      for (const p of pub.published)
        resultText += `\n[tool mounted: ${p.name} v${p.version} — callable directly or via import ${p.name}]`;
      for (const f of pub.failed)
        resultText += `\n[tool publish failed: work/lib/${f.name}.py — ${f.error}]`;
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
      for (const image of options.noImage ? [] : outcome.images) parts.push({ type: "image", mimeType: "image/png",
        data: framePng(image.grid, image.scale ?? options.scale, options.gridLines).toString("base64") });
      return { content: parts, details: { acted: batch, error: outcome.error ?? null, ...(observeLimitHitThisTurn ? { observe_limit: true } : {}) },
        ...(terminate ? { terminate: true } : {}) };
    } };
  pi.registerTool(pythonTool);

  if (components && options.consult !== false) {
    pi.registerTool({ name: "consult", label: "consult", executionMode: "sequential",
      description: "Ask a same-model, single-turn, non-acting agent for a clean-context explanation when stalled.",
      parameters: Type.Object({ name: Type.String(), question: Type.String(), include_trajectory: Type.Optional(Type.Boolean()) }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        consecutiveLengthStops = 0;
        const state = python.state(), used = consultsByLevel.get(state.level) ?? 0;
        if (used >= 2) return { details: {}, isError: true, content: [{ type: "text", text: "consult limit: two per level" }] };
        const role = params.name === "reframer" ? "Give two mutually exclusive explanations and one discriminating next probe. Cite observed facts."
          : components.current("subagent", params.name)?.body;
        if (!role || !ctx.model) return { details: {}, isError: true, content: [{ type: "text", text: "unknown subagent or no model selected" }] };
        consultsByLevel.set(state.level, used + 1);
        log("consult", { name: params.name, level: state.level, step: state.step, attempted: true });
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
        const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
        const started = Date.now();
        let usageRecorded = false;
        const consultMaxTokens = Number(process.env.ARC_LAYERED_CONSULT_OUTPUT_TOKENS ?? 1500);
        try {
          const frame = state.frame.map(row => row.map(cell => cell.toString(16)).join("")).join("\n");
          const memories = components.list("memory");
          const falsifiedParts = memories.flatMap(item => {
            const match = /(?:^|\n)(?:#+\s*)?Falsified[^\n]*(?:\n(?!(?:#+\s*)?(?:Confirmed|Competing|Next)\b)[^\n]*)*/i.exec(item.body);
            return match ? [`[${item.name}] ${match[0].trim()}`] : [];
          });
          const falsified = (falsifiedParts.join("\n") || memories.map(item => `[${item.name}] ${item.body}`).join("\n")).slice(0, 800);
          const trajectory = params.include_trajectory === false ? "" : compressedTrajectory(levelSteps).slice(-900);
          const causal = state.causal_briefing ? `Causal evidence:\n${state.causal_briefing}\n` : "";
          const briefing = `Question: ${params.question.slice(0, 500)}\nFalsified: ${falsified}\n${causal}Trajectory: ${trajectory}\nFrame:\n${frame}`.slice(0, 9000);
          const reply: any = await ctx.modelRegistry.streamSimple(ctx.model, {
            systemPrompt: role, messages: [{ role: "user", content: [{ type: "text", text: briefing }], timestamp: Date.now() }], tools: [] } as any,
            { signal: controller.signal, maxTokens: consultMaxTokens } as any).result();
          const answer = (reply.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
          const ok = reply.stopReason !== "error" && reply.stopReason !== "aborted" && Boolean(answer);
          write("usage.jsonl", { decision, kind: "subagent", name: params.name, model: ctx.model.id,
            ...usageRecord(reply), ms: Date.now() - started, stop_reason: reply.stopReason });
          usageRecorded = true;
          components.recordInvocation("subagent", params.name, state.level, state.step,
            { ok, witness: ok ? undefined : `L${state.level} s${state.step} consult(${params.name}): ${reply.errorMessage ?? (answer ? reply.stopReason : `empty output (${reply.stopReason})`)}` });
          log("consult", { name: params.name, level: state.level, step: state.step, ok, ms: Date.now() - started, stop_reason: reply.stopReason });
          if (!ok) throw Error(reply.errorMessage ?? (answer ? String(reply.stopReason) : `empty output at stopReason=${reply.stopReason}`));
          const finalAnswer = reply.stopReason === "length" ? `${answer}\n[truncated at ${consultMaxTokens} tokens]` : answer;
          return { details: {}, content: [{ type: "text", text: finalAnswer.slice(0, 6000) }] };
        } catch (error) {
          if (!usageRecorded) {
            write("usage.jsonl", { decision, kind: "subagent", name: params.name, model: ctx.model?.id ?? null,
              ms: Date.now() - started, status: controller.signal.aborted ? "timeout_or_abort" : "error", reported_usage: null });
            components.recordInvocation("subagent", params.name, state.level, state.step,
              { ok: false, witness: `L${state.level} s${state.step} consult(${params.name}): ${String(error).slice(0, 100)}` });
          }
          log("consult", { name: params.name, level: state.level, step: state.step, ok: false, error: String(error) });
          return { details: {}, isError: true, content: [{ type: "text", text: `consult unavailable: ${String(error)}` }] };
        } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
      } });
  }
  if (components) {
    pi.registerTool({ name: "reflect_component", label: "reflect_component", executionMode: "sequential",
      description: "Define, revise or restore a versioned memory, skill, prompt or subagent role.",
      parameters: Type.Object({ op: Type.Union([Type.Literal("define"), Type.Literal("redefine"), Type.Literal("restore")]),
        kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent")]),
        name: Type.String(), body: Type.Optional(Type.String()), summary: Type.Optional(Type.String()), version: Type.Optional(Type.Number()) }),
      async execute(_id, params) {
        consecutiveLengthStops = 0;
        try {
          const item = components.reflect(params.op, params.kind as Kind, params.name, params.body, params.summary, params.version);
          const st = safeState();
          components.recordChange(item.kind, item.name, st.level, st.step);
          log("component_change", { op: params.op, kind: item.kind, name: item.name, version: item.version, level: st.level, step: st.step });
          return { details: {}, content: [{ type: "text", text: `${item.kind}/${item.name} v${item.version} active` }] };
        } catch (error) { return { details: {}, isError: true, content: [{ type: "text", text: String(error) }] }; }
      } });
    pi.registerTool({ name: "read_component", label: "read_component", executionMode: "sequential",
      description: "Read one versioned component body, especially a skill when its index is relevant.",
      parameters: Type.Object({ kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent")]),
        name: Type.String(), version: Type.Optional(Type.Number()) }),
      async execute(_id, params) {
        consecutiveLengthStops = 0;
        try {
          const item = params.version ? components.read(params.kind as Kind, params.name, params.version)
            : components.current(params.kind as Kind, params.name);
          if (!item) throw Error("no active component");
          const st = safeState();
          components.recordRead(item.kind, item.name, st.level, st.step);
          log("read_component", { kind: item.kind, name: item.name, version: item.version, level: st.level, step: st.step });
          return { details: {}, content: [{ type: "text", text: `${item.kind}/${item.name} v${item.version}\n${item.body}` }] };
        } catch (error) { return { details: {}, isError: true, content: [{ type: "text", text: String(error) }] }; }
      } });
  }

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
    publishTools();
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
    const recoveryReserve = recoveryText ? estimateTokens({ role: "user", content: [{ type: "text", text: recoveryText }] }) : 0;
    const effectiveCap = Math.max(2048, cap - recoveryReserve);
    const result = evict(event.messages, effectiveCap, Math.min(target, effectiveCap), extraBlocks, evictAnchorIndex);
    evictAnchorIndex = result.cut;
    extraBlocks = Math.max(0, extraBlocks - result.blocks);
    if (result.cut > 0) {
      const state = python.state();
      const carry = options.harnessProfile && components
        ? components.list("tool").map(item => `tool/${item.name} v${item.version}`).join(", ")
        : readCapabilityContext(options.root);
      recoveryText = ["Earlier context was trimmed. Current work files and recent action results:",
        carry, `Level ${state.level}, step ${state.step}, ${state.state}.`, ...trail.slice(-6)].filter(Boolean).join("\n");
      if (result.blocks) warningAnchor = -1;
    } else if (result.before - result.removed >= effectiveCap * 0.85 && warningAnchor !== evictAnchorIndex) {
      contextWarning = true;
      warningAnchor = evictAnchorIndex;
    }
    rawEstimate = result.before;
    rollThreshold = (options.rollAfter ?? 0) > 0 ? (options.rollAfter ?? 0) * cap : 0;
    if (result.blocks) log("evict", { blocks: result.blocks, messages: event.messages.length - result.messages.length,
      tokens_removed: result.removed, estimate_before: result.before, cap: effectiveCap, target });
    const effectiveFoldAfter = options.harnessProfile && components && components.list("memory").length === 0 && options.foldAfter > 0
      ? Math.max(options.foldAfter, 10)
      : options.foldAfter;
    const folding = fold(result.messages, effectiveFoldAfter);
    const preObs = foldPreActionObservations(folding.messages);
    if (folding.folded || preObs.folded) log("fold", { parts: folding.folded, pre_action_observe: preObs.folded, keep_blocks: effectiveFoldAfter });
    let messages = recoveryText ? [{ role: "user", content: [{ type: "text", text: recoveryText }] }, ...preObs.messages] : preObs.messages;
    const estimate = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    const hardTarget = (ctx.model?.contextWindow ?? 128000) - options.compactMargin;
    if (options.compactMargin > 0 && estimate > hardTarget) {
      const state = python.state();
      const summary = ["Earlier history was compacted away. What you know so far:",
        options.harnessProfile ? components?.list("memory").map(item => `${item.name}: ${item.body}`).join("\n") : TAGS.filter(tag => memory[tag]).map(tag => `${tag}: ${memory[tag]}`).join("\n"),
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
    if (components) {
      const lastIndex = messages.findLastIndex(message => message.customType === STATE_TYPE && Array.isArray(message.content));
      const stateMessage = lastIndex < 0 ? undefined : messages[lastIndex];
      if (stateMessage) {
        const current = stateMessage.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        const missing = components.list().filter(item => item.kind === "memory" || item.kind === "prompt")
          .map(item => `${item.kind.toUpperCase()} ${item.name} v${item.version}: ${item.body}`)
          .filter(line => !current.includes(line));
        const skills = components.list("skill").map(item => `${item.name} — ${item.summary} (v${item.version})`).join("; ");
        if (skills && !current.includes(`SKILLS: ${skills}`)) missing.push(`SKILLS: ${skills}`);
        if (missing.length) messages = messages.map((message, i) => i === lastIndex ? { ...message,
          content: [{ type: "text", text: `${stateMessage.content[0].text}\n${missing.join("\n")}` }, ...stateMessage.content.slice(1)] } : message);
      }
    }
    if (components) {
      const active = components.list().filter(item => item.kind === "memory" || item.kind === "prompt");
      const visible = messages.map(message => Array.isArray(message.content)
        ? message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") : "").join("\n");
      for (const item of active) if (visible.includes(`${item.kind.toUpperCase()} ${item.name} v${item.version}: ${item.body}`))
        log("live_injected", { component_kind: item.kind, name: item.name, version: item.version, decision: decision + 1 });
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
    let limit = options.outputTokens;
    if (consecutiveLengthStops >= 1) {
      if ("enable_thinking" in payload) payload.enable_thinking = false;
      if ("reasoning_effort" in payload) payload.reasoning_effort = "none";
      const bumped = Math.min(8192, Math.max(options.outputTokens, options.outputTokens * 2));
      limit = Math.min(bumped, ctx.model?.maxTokens ?? bumped);
      log("length_recovery", { attempt: consecutiveLengthStops, output_tokens: limit });
    }
    currentRequestOutputTokens = limit;
    payload[key] = limit;
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
    if (message.stopReason === "length") {
      consecutiveLengthStops += 1;
      log("length_truncation", { consecutive: consecutiveLengthStops, output_tokens: currentRequestOutputTokens, max_recoveries: maxLengthRecoveries });
    } else if (message.stopReason === "stop") {
      consecutiveLengthStops = 0;
    }
    if (message.stopReason === "error" && /context (window|length)|maximum context|too long|too many tokens/i.test(message.errorMessage ?? "")) {
      extraBlocks += 1;
      lastStop = "context_overflow";
      log("context_overflow", { error: message.errorMessage, extra_blocks: extraBlocks });
    }
    const found = options.harnessProfile ? {} : extractTags(message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n"));
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
  pi.on("agent_settled", () => log("segment_end", {
    reason: endReason ?? (lastStop === "length" && consecutiveLengthStops >= maxLengthRecoveries ? "length_exhausted" : lastStop ?? "aborted"),
    actions: segmentActions, tokens: segmentTokens,
    raw_estimate: rawEstimate, ...(rollThreshold > 0 ? { roll_threshold: rollThreshold, session_oversized: rawEstimate > rollThreshold } : {}) }));
  pi.on("session_shutdown", () => python.close());
}

export default function arcLayeredExtension(pi: ExtensionAPI) {
  const env = process.env, root = env.ARC_RUN_ROOT ?? process.cwd(), local = env.ARC_LAYERED_CONFIG === "kaggle-local";
  const qwen27b = env.ARC_LAYERED_PROFILE === "qwen27b" || env.ARC_LAYERED_PROFILE === "qwen27b-harness";
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
    outputTokens: Number(env.ARC_LAYERED_OUTPUT_TOKENS ?? (qwen27b ? 4096 : 12000)),
    contextCap: Number(env.ARC_LAYERED_CONTEXT_CAP ?? (qwen27b ? 40960 : 131072)), contextTarget: Number(env.ARC_LAYERED_CONTEXT_TARGET ?? (qwen27b ? 20480 : 57344)),
    diffImage: env.ARC_LAYERED_DIFF_IMAGE === "1" || (!qwen27b && env.ARC_LAYERED_DIFF_IMAGE !== "0"),
    noImage: env.ARC_LAYERED_NO_IMAGE === "1",
    harnessProfile: env.ARC_LAYERED_PROFILE === "qwen27b-harness", consult: env.ARC_LAYERED_CONSULT !== "0",
    idleContinuations: Number(env.ARC_LAYERED_IDLE_CONTINUATIONS ?? 3),
    segmentSeconds: Number(env.ARC_LAYERED_SEGMENT_SECONDS ?? 1_000_000), segmentTokens: Number(env.ARC_LAYERED_SEGMENT_TOKENS ?? 100_000_000),
    stuckAfter, foldAfter: Number(env.ARC_LAYERED_FOLD_AFTER ?? (qwen27b ? 4 : 0)),
    compactMargin: Number(env.ARC_LAYERED_COMPACT_MARGIN ?? 0), notebook: env.ARC_LAYERED_NOTEBOOK === "1" && !local,
    gradient: env.ARC_LAYERED_GRADIENT === "1", rollAfter: Number(env.ARC_LAYERED_ROLL_AFTER ?? 0),
    maxObserveCallsPerTurn: Number(env.ARC_LAYERED_MAX_OBSERVE_CALLS ?? 2),
    flags: { expect: env.ARC_LAYERED_EXPECT !== "0", graph: env.ARC_LAYERED_GRAPH === "1",
      work: env.ARC_LAYERED_WORK !== "0", model: env.ARC_LAYERED_MODEL !== "0", tags: env.ARC_LAYERED_TAGS === "1",
      claims: env.ARC_LAYERED_CLAIMS !== "0" } });
}
