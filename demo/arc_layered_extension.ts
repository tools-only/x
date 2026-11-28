/** ARC `layered` profile: one python tool, state messages, context eviction/folding/compaction, carried note blocks, bounded continuation. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BridgeClient, COLOR_LEGEND, LayeredPython, type ActionBatch, type LayeredState, type MemoryCheckStats, type StepFact } from "./arc_layered_python.ts";
import { arcEnvAdapter } from './arc_env_adapter.ts';
import type { LayeredEnvAdapter } from './layered_env_adapter.ts';
import { RequestTrace, usageRecord } from "./arc_request_trace.ts";
import { installProviderTelemetry } from "./pi_provider_telemetry.ts";
import { installReportedTokenBudget } from "./pi_reported_token_budget.ts";
import { LayeredComponents, normalizeVerifyExpr, type Component, type Kind, type ReflectOp, type VerifyRuleInput } from "./arc_layered_components.ts";
import { boardInventory, recordFrameColorChanges } from "./arc_layered_inventory.ts";

import { LayeredArchive, foldRecoverably } from "./arc_layered_archive.ts";

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
  recoverableFold?: boolean;
  noImage?: boolean;
  harnessProfile?: boolean;
  minimalBasePrompt?: boolean;
  consult?: boolean;
  evolution?: boolean;
  boardInventory?: boolean;
  maxLengthRecoveries?: number;
  idleContinuations: number; segmentSeconds: number; segmentTokens: number; maxActionsPerCall: number; outputTokens: number; root: string;
  stuckAfter: number; foldAfter: number; compactMargin: number; notebook: boolean; gradient?: boolean; rollAfter?: number;
  maxObserveCallsPerTurn?: number;
  flags?: { expect?: boolean; graph?: boolean; work?: boolean; model?: boolean; tags?: boolean; claims?: boolean } };
type Python = Pick<LayeredPython, "init" | "run" | "state" | "close" | "takeMiniReview">
  & Partial<Pick<LayeredPython, "gradient" | "capabilitySnapshot" | "syncMemoryChecks" | "validateMemoryChecks" | "memoryCheckStats">>;
type Content = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
type AttemptMetrics = { py_calls: number; py_errors: number; truncated: number; observe_limits: number; errors: string[] };
const EDITABLE_SPACE = "Editable capability space: memory (with optional verify), prompt, skills (reusable workflows/methods), tools (@tool or work/lib/), subagents (consult).";
type DecisionTraceBlock = {
  decision: number;
  level: number;
  stepStart: number;
  stepEnd: number;
  reasoningTail: string;
  pythonCalls: Array<{ code: string; result: string; error?: string; acted: boolean }>;
  actions: string[];
  consults: Array<{ name: string; question: string; answer: string }>;
};

export function structuralSnapshot(state: Pick<LayeredState, "frame" | "valid_actions">) {
  const counts = new Map<number, number>();
  for (const row of state.frame) for (const symbol of row) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  const background = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const seen = new Set<string>();
  let regions = 0;
  for (let y = 0; y < state.frame.length; y++) for (let x = 0; x < state.frame[y].length; x++) {
    const symbol = state.frame[y][x], key = `${x},${y}`;
    if (symbol === background || seen.has(key)) continue;
    regions++;
    const pending = [[x, y]]; seen.add(key);
    while (pending.length) {
      const [cx, cy] = pending.pop()!;
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        const next = `${nx},${ny}`;
        if (state.frame[ny]?.[nx] === symbol && !seen.has(next)) { seen.add(next); pending.push([nx, ny]); }
      }
    }
  }
  return { actions: [...state.valid_actions].sort(), rows: state.frame.length, columns: state.frame[0]?.length ?? 0,
    symbols: [...counts.keys()].sort((a, b) => a - b), nonModalSymbolRegions: regions };
}

export function renderDecisionWindow(blocks: DecisionTraceBlock[], maxChars: number): string {
  if (!blocks.length || maxChars <= 0) return "";
  const formatted = blocks.map(b => {
    const parts: string[] = [`[d${b.decision} L${b.level} s${b.stepStart}..${b.stepEnd}]`];
    if (b.reasoningTail) parts.push(`Reasoning: ${b.reasoningTail}`);
    for (const p of b.pythonCalls) {
      parts.push(`Python (${p.acted ? "acted" : "observe"}):\n${p.code}`);
      if (p.error) parts.push(`PyError: ${p.error}`);
      else if (p.result) parts.push(`PyOut: ${p.result}`);
    }
    if (b.actions.length) parts.push(`Actions: ${b.actions.join(" | ")}`);
    for (const c of b.consults) {
      parts.push(`Consult(${c.name}) Q: ${c.question}\nA: ${c.answer}`);
    }
    return parts.join("\n");
  });
  const kept: string[] = [];
  let used = 0;
  for (let i = formatted.length - 1; i >= 0; i -= 1) {
    const chunk = formatted[i];
    const add = (kept.length ? 2 : 0) + chunk.length;
    if (kept.length > 0 && used + add > maxChars) {
      const omitted = i + 1;
      const omittedChars = formatted.slice(0, omitted).reduce((s, x) => s + x.length, 0);
      return `[${omitted} earlier decision(s) (~${omittedChars} chars) omitted]\n\n${kept.reverse().join("\n\n")}`.slice(0, maxChars);
    }
    kept.push(kept.length === 0 && chunk.length > maxChars ? chunk.slice(-maxChars) : chunk);
    used += add;
  }
  return kept.reverse().join("\n\n");
}

const EVOLUTION_SYSTEM_PROMPT = [
  "You are running an isolated, clean-context meta-evolution audit between task turns. You cannot take environment actions (submit_actions is disabled).",
  "Your job is NOT merely to patch a single stuck step — it is to diagnose flaws in the solver's problem-solving method, strategy, and thinking process, and materialize the missing capability in the harness so future decisions are systematically more scientific.",
  "Start by reading the full dossier: Layer 1 (trajectory, recent decision window with Python code/outputs, board inventory), Layer 2 (active components, Process profile, Component use, Last evolution feedback, prior reviews), and the current frame.",
  "Meta-evolution loop (anchor to ONE concrete decision point k or cross-level delta):",
  "1. Critique the solver's method, strategy, and thinking at step k — identify the deepest root flaw:",
  "   - Observation & modeling method (L1/L3): acting before reading key local changes/structure, repeating ad-hoc inspection scripts, or failing to maintain an explicit falsifiable cause-and-effect model.",
  "   - Hypothesis & probing method (L3/L4): sending unchecked/vacuous-expect or oversized unverified batches instead of small discriminating probes that separate competing explanations, or ignoring SURPRISE / verify contradictions instead of revising beliefs.",
  "   - Search & non-replay strategy (L2/L4): replaying known dead ends or post-RESET failures instead of tracking tried vs untried branches from transitions.",
  "   - Planning & execution orchestration (L4/L5): stepping blindly when mechanics are already established, staying trapped in one framing, or failing to use mounted tools/skills.",
  "2. Carry the evolved method in the lightest effective harness component (0 or 1 targeted change; NEVER write vague pep-talks like 'be careful' or 'try harder'):",
  "   - Executable analysis/strategy (`@tool` via python_inspect): read-only computation helper (observation/diff/progress metric, branch frontier checker, candidate scorer/planner). Include `# when:` and `# out/branch:` (and `branch_action` in the result dict when returning a discrete next action). Define `@tool def fn(): ...` and run `trial_at(k, fn)` in the SAME `python_inspect` script so tool authoring + no-lookahead verification finishes in 1 round.",
  "   - Falsifiable causal model & probe (`memory` via reflect_component(op=add/revise/retire/merge/promote/demote, kind='memory', layer='L3', scope='level'|'game', name, body, verify?)): crisp Goal metric, Confirmed conditions, Eliminated branches, ONE Next controlled probe, and prefer structured `verify={'rule': {'when': '...', 'assert': '...'}}` whenever single-step testable so future contradictions trigger automatically.",
  "   - Reusable problem-solving method / workflow (`skill` via reflect_component(op=add/revise/retire/merge/promote/demote, kind='skill', layer='L4', scope='game'|'level', name, summary, body)): concrete multi-step procedure for modeling, controlled probing, branch search, or verification (read on demand via read_component).",
  "   - Execution discipline / thinking rule (`prompt` via reflect_component(op=add/revise/retire/promote/demote, kind='prompt', layer='L5', scope='game'|'level', name, body), <= 600 chars): enforceable operating rule fixing recurring Process profile failures (e.g., prediction coverage, probe size before batching, checking mounted helpers).",
  "   - Clean-context reframing (`subagent` via reflect_component(op=add/revise/retire, kind='subagent', layer='L5', scope='game'|'level', name, summary, body)): specialist role invoked via consult when stuck in a local framing.",
  "3. Verify & curate: check Process profile and Last evolution feedback to see whether prior evolved methods actually changed behavior (unchecked_batches, large_batches, repeats, action_aligned); revise, merge, or retire ineffective ones. Choose decision='no_change' only when active capabilities already cover step k with an unfalsified probe or branch.",
  "Kernel API (read-only + @tool publishing): `current_frame`, `previous_frame` (.grid, .ascii(region=(r0,c0,r1,c1)), .segmentation, .level, .step, .state, .shape); `transitions` (items `t` have .action, .before_frame, .after_frame); `history`, `valid_actions`; helpers `diff(a,b)`, `frame_diff(a,b)`, `anim_summary(step=-1)`.",
  "Scope & trigger rules (strict):",
  "- scope='level' vs scope='game': use scope='level' ONLY for current-level layout, coordinates, eliminated branches, or next local probes (auto-archived on level change). Use scope='game' for coordinate-free solving methods/discipline (Prompt/Skill), cross-level @tools, and level_complete-promoted causal Memory.",
  "- Executable-first offloading (CRITICAL): when the solver repeats failed routes/edges, replays post-RESET deaths, or lacks state/goal/frontier visibility, ALWAYS prefer authoring a read-only `@tool` via `python_inspect` (offloading computation out of the solver) or a concrete `Memory + verify` rule over writing prose instructions. Do NOT write a Prompt telling the solver to manually track edges/frontiers in prose when a `@tool` can compute it directly from `transitions`/`current_frame`.",
  "- Prompt & Skill anti-divergence circuit-breaker: maintain at most 1 core L5 Prompt (<= 600 chars) and 1-2 L4 Skills total, with ZERO level-specific coordinates. A Prompt may be revised AT MOST 2 times per level — if repeats or deaths persist after revising a Prompt, STOP rewriting Prompt prose and build an executable `@tool`, a falsifiable `Memory + verify`, or choose `no_change`. Avoid creating Skills when existing Skills have `reads=0` (prefer directly callable `@tool` or inline `Memory`).",
  "Contracts: set scope=level or game, layer=L1..L5, and when: on every component. merge requires sources plus a replacement body; promote marks a tested prior provisional. On cross-level failure choose refine preconditions versus demote/retire. A shown component is not evidence of use. On level_complete, use at most 1 python_inspect call before updating components and calling finish_evolution.",
  "Round budget: shown in tool results. You may batch reflect_component (or python_inspect to publish @tool) together with finish_evolution once verified. Ground claims strictly in observed facts and end with finish_evolution(decision='evolved'|'no_change', note='one concise line').",
].join("\n");

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

function formatVerifySummary(memName: string, verify?: Record<string, string>, stats?: MemoryCheckStats): string {
  if (!verify || !Object.keys(verify).length) return "";
  const parts = Object.entries(verify).map(([rule]) => {
    const id = `${memName}/${rule}`;
    const st = stats?.[id];
    if (!st) return `${rule}: pending`;
    if (st.error) return `${rule}: err(${st.error.slice(0, 60)})`;
    if (st.unscoped) return `${rule}: unscoped (ignored)`;
    if (st.checked === 0) return `${rule}: 0 checked`;
    return `${rule}: ${st.support}/${st.checked} held${st.counter ? `, ${st.counter} failed${st.witness ? ` (${st.witness})` : ""}` : ""}`;
  });
  return ` [verify: ${parts.join("; ")}]`;
}

function writeLevelReview(
  root: string, level: number, state: LayeredState, steps: StepFact[], notes: string[],
  extra?: {
    components?: LayeredComponents;
    verifyStats?: MemoryCheckStats;
    consults?: number;
    attemptMetrics?: AttemptMetrics;
    unchangedSymbols?: string[];
  },
) {
  const trajectory = compressedTrajectory(steps);
  const directory = join(root, "work", "replay");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `level_${level}.md`);
  if (extra?.components) {
    const comps = extra.components;
    const compLines: string[] = [];
    for (const kind of ["memory", "prompt", "skill", "tool", "subagent"] as const) {
      const items = comps.list(kind);
      if (!items.length) {
        compLines.push(`- ${kind}: none`);
        continue;
      }
      for (const item of items) {
        const st = comps.stats(kind, item.name);
        const cur = st?.by_level[String(level)];
        if (kind === "memory") {
          const v = formatVerifySummary(item.name, item.verify, extra.verifyStats);
          compLines.push(`- memory/${item.name} v${item.version}${v}`);
        } else if (kind === "skill") {
          compLines.push(`- skill/${item.name} v${item.version}: L${level} reads=${cur?.reads ?? 0}, total=${st?.total.reads ?? 0} (${item.summary})`);
        } else if (kind === "tool" || kind === "subagent") {
          compLines.push(`- ${kind}/${item.name} v${item.version}: L${level} ${cur?.ok ?? 0}/${cur?.invocations ?? 0} ok, total ${st?.total.ok ?? 0}/${st?.total.invocations ?? 0} ok`);
        } else {
          compLines.push(`- prompt/${item.name} v${item.version}`);
        }
      }
    }
    const m = extra.attemptMetrics;
    const execLine = m
      ? `- python: calls=${m.py_calls}, errors=${m.py_errors}, truncated=${m.truncated}, observe_limits=${m.observe_limits}` +
        (m.errors.length ? `; recent errors: ${m.errors.slice(-2).join(" | ")}` : "")
      : "- python: n/a";
    const body = [
      `# Level ${level} review`, "",
      `Outcome: ${state.state}; actions used ${state.actions_used}; completed ${state.levels_completed}/${state.win_levels}.`,
      "", "## Layer 1: Task facts", "",
      trajectory || "- no transition facts",
      ...(extra.unchangedSymbols?.length ? ["", `Unchanged symbols: ${extra.unchangedSymbols.join(", ")}`] : []),
      "", "## Layer 2: Active capabilities & execution", "",
      ...compLines,
      `- consults on L${level}: ${extra.consults ?? 0}`,
      execLine,
      "", "## Editable capability space", "",
      EDITABLE_SPACE, "",
    ].join("\n");
    writeFileSync(path, body.slice(0, 4000), "utf8");
    return "work/replay/" + `level_${level}.md`;
  }
  const memory = [
    ...new Set(steps.flatMap(fact => [...fact.claims_failed, ...fact.claims_held].map(name => `claims/${name}`))),
    ...notes.filter(note => note.includes("claims/")).map(note => note.slice(0, 120))];
  const model = steps.filter(fact => fact.predict_off !== null).map(fact => `predict off ${fact.predict_off} at s${fact.step}`);
  const method = [...new Set(steps.filter(fact => fact.source).map(fact => fact.source!))];
  const tool = notes.filter(note => !note.includes("claims/")).map(note => note.slice(0, 120));
  const list = (name: string, values: string[]) => `## ${name}\n${values.length ? values.slice(-4).map(value => `- ${value}`).join("\n") : "- none"}`;
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

/** Collapse pure-observation python toolResults (no `[env]` line) once a later acting toolResult exists.
 * Never folds consult, read_component, reflect_component, or other non-python tool results. */
export function foldPreActionObservations(input: any[]) {
  const toolNames = new Map<string, string>();
  for (const m of input) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p?.type === "toolCall" && typeof p.id === "string" && typeof p.name === "string")
          toolNames.set(p.id, p.name);
      }
    }
  }
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
    const toolName = message.toolName ?? (typeof message.toolCallId === "string" ? toolNames.get(message.toolCallId) : undefined);
    if (toolName !== undefined && toolName !== "python") return message;
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

export function installLayered(pi: ExtensionAPI, python: Python, options: LayeredOptions, adapter: LayeredEnvAdapter = arcEnvAdapter) {
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
  const system = options.harnessProfile && options.minimalBasePrompt
    ? readFileSync(new URL("./prompts/arc_layered_system_minimal.md", import.meta.url), "utf8")
        .replace(/\{\{\?(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, flag, body) => flags[flag] ? body : "")
        .replaceAll("{{color_legend}}", COLOR_LEGEND)
        .replaceAll("{{max_actions_per_call}}", String(options.maxActionsPerCall))
    : adapter.systemPrompt(flags, options.maxActionsPerCall, Boolean(options.harnessProfile));
  let memory: Record<string, string> = {};
  const components = options.harnessProfile ? new LayeredComponents(join(store, "components")) : undefined;
  const publicationJournal = join(store, "tool-publication-pending.json");
  function recoverToolPublication() {
    if (!components || !existsSync(publicationJournal)) return;
    const pending = JSON.parse(readFileSync(publicationJournal, "utf8")) as { files: Record<string, string>; heads: Record<string, number> };
    const dir = join(options.root, "work", "lib");
    mkdirSync(dir, { recursive: true });
    const names = new Set([...Object.keys(pending.files), ...readdirSync(dir).filter(name => /^[a-z][a-z0-9_]*\.py$/.test(name))]);
    for (const name of names) {
      if (!/^[a-z][a-z0-9_]*\.py$/.test(name)) continue;
      const path = join(dir, name), id = name.slice(0, -3), head = components.current("tool", id);
      const source = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      const committed = head && head.version !== pending.heads[id] && head.body === source;
      if (committed) continue;
      const previous = pending.files[name];
      if (previous !== undefined) writeFileSync(path, previous, "utf8");
      else if (existsSync(path)) unlinkSync(path);
    }
    unlinkSync(publicationJournal);
  }
  recoverToolPublication();
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
  const attemptSteps: StepFact[] = [];
  let lastFailedAttemptSteps: StepFact[] = [];
  const freshAttemptMetrics = (): AttemptMetrics => ({ py_calls: 0, py_errors: 0, truncated: 0, observe_limits: 0, errors: [] });
  let attemptMetrics: AttemptMetrics = freshAttemptMetrics();
  type EvolutionRecord = { kind: Kind | "consult"; name: string; version?: number; level: number; step: number;
    actionsSince: number; newStatesSince: number; deathsSince: number;
    baseline?: { unchecked: number; repeats: number; actions: number } };
  let lastEvolution: EvolutionRecord | null = null;
  let finishedLevelEvolution: EvolutionRecord | null = null;
  const WINDOW_SIZE = 12;
  const recentSteps: StepFact[] = [];
  const recentCalls: Array<{ errors: number; truncated: number; tools: number }> = [];
  let finishedLevelSteps: StepFact[] = [], finishedLevelNumber = 0;
  let finishedLevelMetrics: AttemptMetrics | null = null;
  const staleNoticed = new Set<string>();
  let lastStuckAuditStep = -1, stuckAuditsThisLevel = 0, lastDeathAuditStep = -1, lastAuditBoundary = "";
  let started = false, segment = 0, segmentStart = 0, segmentTokens = 0, segmentActions = 0, idle = 0, decision = 0, extraBlocks = 0;
  let rawEstimate = 0, rollThreshold = 0, evictAnchorIndex = 0;
  let actedThisTurn = false, observeCallsThisTurn = 0, observeLimitHitThisTurn = false, consecutiveObserveTurns = 0;
  let toolBuildFreeUsedThisTurn = false;
  let consecutiveLengthStops = 0, currentRequestOutputTokens = options.outputTokens;
  const maxLengthRecoveries = options.maxLengthRecoveries ?? Number(process.env.ARC_LAYERED_MAX_LENGTH_RECOVERIES ?? 2);
  let endReason: string | undefined, lastStop: string | undefined, pending: ActionBatch | null = null;
  let shownFrame: number[][] | null = null, shownLevel = 0;
  const boardInventoryEnabled = options.boardInventory ?? Boolean(options.harnessProfile);
  const levelChangedColors = new Set<number>();
  let lastSkillIndex = "";
  const consultsByLevel = new Map<number, number>();
  const decisionTrace: DecisionTraceBlock[] = [];
  let currentTraceBlock: DecisionTraceBlock | null = null;
  let lastEvoTraceIndex = 0;
  let boundaryReviewsThisLevel: Array<{ step: number; boundary: string; decision: string; exit_reason: string; mutations: string[]; note: string }> = [];
  let lastConsultOnLevel: { name: string; step: number; question: string; answer: string } | null = null;
  const ensureTraceBlock = (st?: LayeredState): DecisionTraceBlock => {
    if (!currentTraceBlock) {
      const s = st ?? safeState();
      currentTraceBlock = {
        decision: decision + 1, level: s.level, stepStart: s.step, stepEnd: s.step,
        reasoningTail: "", pythonCalls: [], actions: [], consults: [],
      };
      decisionTrace.push(currentTraceBlock);
      if (decisionTrace.length > 200) {
        const drop = decisionTrace.length - 200;
        decisionTrace.splice(0, drop);
        lastEvoTraceIndex = Math.max(0, lastEvoTraceIndex - drop);
      }
    }
    return currentTraceBlock;
  };
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
  const collectMemoryChecks = () => components
    ? components.list("memory").filter(item => item.status !== "dormant").flatMap(item => Object.entries(item.verify ?? {}).map(([rule, expr]) => ({ id: `${item.name}/${rule}`, expr })))
    : [];
  const formatComponentLine = (item: Component) =>
    `${item.kind.toUpperCase()} ${item.name} v${item.version}: ${item.body}` +
    (item.kind === "memory" ? formatVerifySummary(item.name, item.verify, python.memoryCheckStats) : "");
  const registeredTools = new Set<string>();
  let activeBoundTool: string | null = null;
  const shownTurns = new Map<string, Set<number>>();
  const lastPublishError = new Map<string, string>();
  let pythonBin: string | undefined;
  function checkPythonSyntax(source: string, mode: "exec" | "eval" = "exec"): string | null {
    for (const bin of pythonBin ? [pythonBin] : ["python3", "python"]) {
      const res = spawnSync(bin, ["-c", `import ast,sys; ast.parse(sys.stdin.read(), mode='${mode}')`], { input: source, encoding: "utf8" });
      if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") continue;
      pythonBin = bin;
      return res.status === 0 ? null : (res.stderr?.trim().slice(0, 300) || `exit ${res.status}`);
    }
    return mode === "eval" ? "Python interpreter unavailable for verify validation" : null;
  }
  function publishTools(allowed?: ReadonlySet<string>): { published: Array<{ name: string; version: number }>; failed: Array<{ name: string; error: string }> } {
    const published: Array<{ name: string; version: number }> = [];
    const failed: Array<{ name: string; error: string }> = [];
    if (!components) return { published, failed };
    const dir = join(options.root, "work", "lib");
    if (!existsSync(dir)) return { published, failed };
    const st = safeState();
    for (const file of readdirSync(dir).filter(name => /^[a-z][a-z0-9_]*\.py$/.test(name))) {
      const name = file.slice(0, -3);
      if (allowed && !allowed.has(name)) continue;
      const source = readFileSync(join(dir, file), "utf8");
      const match = new RegExp(`^def\\s+(${name}|run)\\s*\\(\\s*([^)\\n]*)\\)\\s*(?:->[^:\\n]+)?\\s*:`, "m").exec(source);
      if (!match) { failed.push({ name, error: "tool entry function not found or invalid signature" }); continue; }
      const [, fn, rawArgs] = match;
      const trimmedArgs = rawArgs.trim();
      const zeroArg = trimmedArgs === "";
      const singleArg = /^[a-zA-Z_]\w*(?:\s*:[^=]+)?(?:\s*=.*)?$/.test(trimmedArgs);
      if (!zeroArg && !singleArg) { failed.push({ name, error: "tool entry function must take zero or one argument" }); continue; }
      const syntaxErr = checkPythonSyntax(source);
      if (syntaxErr) {
        if (lastPublishError.get(name) !== `${source.length}:${syntaxErr}`) {
          lastPublishError.set(name, `${source.length}:${syntaxErr}`);
          components.recordPublishFailure(name, st.level, st.step, syntaxErr);
          log("tool_publish_failed", { name, error: syntaxErr });
        }
        failed.push({ name, error: syntaxErr });
        continue;
      }
      lastPublishError.delete(name);
      const entrySummary = zeroArg ? `${fn}()` : fn;
      const active = components.current("tool", name);
      if (!active || active.body !== source || active.summary !== entrySummary) {
        const scope = /^\s*#\s*scope:\s*(game|level)\s*$/m.exec(source)?.[1] as "game" | "level" | undefined;
        const layer = /^\s*#\s*layer:\s*(L[1-5])\s*$/m.exec(source)?.[1] as Component["layer"];
        const saved = components.reflect(active ? "redefine" : "define", "tool", name, source, entrySummary, undefined, undefined, { ...(scope ? { scope } : {}), ...(layer ? { layer } : {}) });
        components.recordChange("tool", name, st.level, st.step);
        log("tool_published", { name, version: saved.version, hash: saved.hash, after_audit: lastAuditBoundary || null });
        lastEvolution = { kind: "tool", name, version: saved.version, level: st.level, step: st.step,
          actionsSince: 0, newStatesSince: 0, deathsSince: 0 };
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
          if (current.retired || current.status === "dormant" || current.status === "variant_broken") return { details: {}, isError: true, content: [{ type: "text", text: "tool unavailable in this level; await audit adaptation" }] };
          const latest = readFileSync(join(dir, file), "utf8");
          if (createHash("sha256").update(latest).digest("hex") !== current.hash)
            return { details: {}, isError: true, content: [{ type: "text", text: "tool source changed; wait for the next publication boundary" }] };
          const isZeroArg = current.summary.endsWith("()");
          const fnName = isZeroArg ? current.summary.slice(0, -2) : current.summary;
          const encoded = Buffer.from(JSON.stringify(params.args ?? {})).toString("base64");
          const callExpr = isZeroArg
            ? `${name}.${fnName}()`
            : `${name}.${fnName}(__import__('json').loads(__import__('base64').b64decode('${encoded}').decode()))`;
          activeBoundTool = name;
          let result: any;
          try {
            result = await pythonTool.execute(_id, { code: `print(repr(${callExpr}))` }, signal);
          } finally {
            activeBoundTool = null;
          }
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
  let latestContextEstimate: number | undefined;
  let requestContextEstimate: number | undefined;
  let calibratedRatio = 1.0;
  let calibratedOverhead = 0;
  let calibratedSamples = 0;

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

  function formatEvolutionFeedback(evo: EvolutionRecord | null, auditLevel: number): string {
    if (!evo || evo.level !== auditLevel || !components) return "";
    const label = evo.kind === "consult"
      ? `consult/${evo.name}`
      : `${evo.kind}/${evo.name}${evo.version ? ` v${evo.version}` : ""}`;
    let detail = "";
    if (evo.kind === "tool") {
      const st = components.stats("tool", evo.name);
      if (st) detail = `used ${st.total.ok}/${st.total.invocations} ok, `;
    } else if (evo.kind === "prompt" || evo.kind === "skill") {
      if (evo.kind === "skill") {
        const st = components.stats("skill", evo.name);
        if (st) detail = `reads=${st.total.reads}, `;
      }
      if (evo.baseline) {
        const curUnchecked = safeState().unchecked_batches ?? 0;
        const curRepeats = levelSteps.filter(f => f.same).length;
        detail += `unchecked=${curUnchecked}(was ${evo.baseline.unchecked}), repeats_since=${Math.max(0, curRepeats - evo.baseline.repeats)}, `;
      }
    } else if (evo.kind === "memory") {
      const cur = components.current("memory", evo.name);
      const vs = cur ? formatVerifySummary(cur.name, cur.verify, python.memoryCheckStats).trim() : "";
      detail = vs ? `${vs}, ` : "verify=0 rules, ";
    }
    return `Last evolution (L${evo.level} s${evo.step}): ${label} -> ${detail}+${evo.newStatesSince} new states, ${evo.deathsSince} deaths over ${evo.actionsSince} actions`;
  }

  function layer2Snapshot(auditLevel: number, metrics: AttemptMetrics = attemptMetrics, evo: EvolutionRecord | null = lastEvolution): string {
    if (!components) return "";
    const describeKind = (kind: Kind): string => {
      const items = components.list(kind);
      if (!items.length) return `${kind}=0`;
      const parts = items.map(item => {
        const st = components.stats(kind, item.name);
        const cur = st?.by_level[String(auditLevel)];
        if (kind === "memory") return `${item.name}@v${item.version}${formatVerifySummary(item.name, item.verify, python.memoryCheckStats)}`;
        if (kind === "skill") return `${item.name}@v${item.version}(L${auditLevel}:${cur?.reads ?? 0}r/${st?.total.reads ?? 0}r)`;
        if (kind === "tool" || kind === "subagent") return `${item.name}@v${item.version}(L${auditLevel}:${cur?.ok ?? 0}/${cur?.invocations ?? 0},tot:${st?.total.ok ?? 0}/${st?.total.invocations ?? 0})`;
        return `${item.name}@v${item.version}`;
      });
      return `${kind}=${items.length}[${parts.join(", ")}]`;
    };
    const pubFails = Object.entries(components.allStats())
      .filter(([key, st]) => key.startsWith("tool/") && st.consecutive_publish_failures > 0)
      .map(([key, st]) => `${key.slice(5)}(${st.consecutive_publish_failures}x:${st.last_publish_error?.slice(0, 60) ?? "err"})`);
    const consults = consultsByLevel.get(auditLevel) ?? 0;
    const compLine = [
      describeKind("memory"), describeKind("prompt"), describeKind("skill"), describeKind("tool"),
      `${describeKind("subagent")}; consults L${auditLevel}=${consults}/2`,
      ...(pubFails.length ? [`publish_failed=[${pubFails.join(", ")}]`] : []),
    ].join(" | ");
    const recentErrs = [...new Set(metrics.errors)].slice(-2);
    const execLine = `python calls=${metrics.py_calls}, errors=${metrics.py_errors}, truncated=${metrics.truncated}, observe_limits=${metrics.observe_limits}` +
      (recentErrs.length ? `; recent_errors=[${recentErrs.join(" | ")}]` : "");
    const evoLine = formatEvolutionFeedback(evo, auditLevel);
    return [
      "Layer 2 (Active capabilities & execution):",
      `- Capabilities: ${compLine}`,
      `- Execution: ${execLine}`,
      ...(evoLine ? [`- ${evoLine}`] : []),
      `- Decision: adjust task actions only, or make 1 minimal update in the editable space (memory + optional verify, prompt, skills, tools via @tool or work/lib/, subagents via consult) and verify it next.`,
    ].join("\n");
  }

  function dualAudit(
    boundary: "game_over" | "level_complete" | "stall" | "stuck" | "verify_contradiction" | "repeated_surprise" | "method_drift",
    steps: StepFact[],
    state: LayeredState,
    auditLevel: number,
    opts?: { compact?: boolean; richWindow?: boolean; includeInventory?: boolean; metrics?: AttemptMetrics; evolution?: EvolutionRecord | null; emitLog?: boolean; limit?: number },
  ): string {
    const compact = Boolean(opts?.compact);
    const rich = Boolean(opts?.richWindow);
    const layer1: string[] = [];
    if (boundary === "game_over" && steps.length) {
      const dead = [...steps].reverse().find(f => f.death) ?? steps.at(-1)!;
      const tail = steps.slice(-4).map(f => `s${f.step} ${f.action}${f.death ? " DEATH" : ""}`).join(" -> ");
      const repeatNote = typeof dead.same_death === "number" ? ` (REPEATS death at step ${dead.same_death})`
        : dead.same_death ? " (REPEATS earlier death)" : "";
      const diffNote = dead.changed_cells !== undefined
        ? `, diff=${dead.changed_cells} cells${dead.change_box ? ` box=${JSON.stringify(dead.change_box)}` : ""}`
        : "";
      layer1.push(`- Fatal transition: step ${dead.step}, action ${dead.action}${repeatNote}${diffNote}; trail: ${tail}`);
    }
    if (steps.length) layer1.push(`- Trajectory:\n${compressedTrajectory(steps).slice(0, rich ? 3000 : compact ? 320 : 650)}`);
    if (state.causal_briefing) layer1.push(`- Causal summary:\n${state.causal_briefing.slice(0, rich ? 2000 : compact ? 220 : 350)}`);
    if (state.action_invariant) layer1.push(`- Invariant drift: ${state.action_invariant}`);
    if (boardInventoryEnabled && opts?.includeInventory) {
      const inv = boardInventory(state.frame, levelChangedColors);
      if (inv.line) layer1.push(`- ${inv.line}`);
      if (inv.unchanged.length) layer1.push(`- Unchanged symbols since attempt start: ${inv.unchanged.join(", ")}`);
    }
    const layer2 = layer2Snapshot(auditLevel, opts?.metrics ?? attemptMetrics, opts?.evolution !== undefined ? opts.evolution : lastEvolution);
    const legibilityLines: string[] = [];
    if (rich) {
      const surprises = decisionTrace.slice(-12).flatMap(turn => turn.pythonCalls.flatMap(call =>
        call.result.split("\n").filter(line => /SURPRISE/i.test(line)).map(line => line.slice(0, 160))));
      if (surprises.length) legibilityLines.push(`- SURPRISE: ${surprises.slice(-6).join("; ")}`);
      const witnesses = Object.entries(python.memoryCheckStats ?? {}).filter(([, stat]) => stat.counter > 0 && stat.witness);
      if (witnesses.length) legibilityLines.push(`- verify witness: ${witnesses.map(([id, stat]) => `${id}: ${stat.witness}; by_level=${JSON.stringify(stat.by_level)}`).join("; ")}`);
      const usage = components?.list().map(item => {
        const key = `${auditLevel}/${item.kind}/${item.name}`;
        const stats = components.stats(item.kind, item.name)?.by_level[String(auditLevel)];
        return `${item.kind}/${item.name}: shown_turns=${shownTurns.get(key)?.size ?? 0}, used_ok=${(stats?.ok ?? 0) + (stats?.reads ?? 0)}, action_aligned=${alignedUses.get(`${auditLevel}/${item.name}`) ?? 0}`;
      });
      if (usage?.length) legibilityLines.push(`- Component use: ${usage.join("; ")}`);
      if (structuralDelta) legibilityLines.push(`- Cross-Level Structural Delta: ${structuralDelta}`);
      const observations = decisionTrace.slice(-12).flatMap(turn => turn.pythonCalls).filter(call => !call.acted);
      legibilityLines.push(`- Observation scripts: ${observations.length}; repeated structures: ${JSON.stringify(observations.map(call => call.code.replace(/\b[0-9]+\b/g, "#").replace(/\s+/g, " ").slice(0, 120)))}`);
      legibilityLines.push("- Diagnose ONE bottleneck: L1 perception, L2 state/frontier, L3 causal rule, L4 strategy/probe, L5 orchestration/pacing. Cross-level contradictions require refine preconditions vs demote/retire.");
      const eff = effortProgressSummary();
      if (eff) legibilityLines.push(`- ${eff}`);
      const tail30 = levelSteps.slice(-30);
      const rep30 = tail30.filter(f => f.same).length;
      if (tail30.length) {
        const new30 = tail30.filter(f => f.new).length;
        const rst30 = tail30.filter(f => f.action === "RESET").length;
        legibilityLines.push(`- Branch reuse (last ${tail30.length}): repeats=${rep30}, new_states=${new30}, resets=${rst30}`);
      }
      const recentTrace = decisionTrace.slice(-12);
      const vacuousCalls = recentTrace.reduce((s, b) => s + b.pythonCalls.filter(p => p.result.includes("[vacuous expect=")).length, 0);
      if (vacuousCalls || (state.unchecked_batches ?? 0) > 0) {
        legibilityLines.push(`- Prediction quality: vacuous_expect_calls=${vacuousCalls} (last 12 decisions), unchecked_batches=${state.unchecked_batches ?? 0}`);
      }
      const actingDecisions = recentTrace.filter(b => b.actions.length > 0).length;
      const maxBatch = recentTrace.reduce((m, b) => Math.max(m, b.actions.length), 0);
      const largeBatches = recentTrace.filter(b => b.actions.length >= 4).length;
      legibilityLines.push(
        `- Process profile (last ${recentTrace.length} decisions): acting=${actingDecisions}, max_batch=${maxBatch}, large_batches(>=4)=${largeBatches}, unchecked_batches=${state.unchecked_batches ?? 0}, vacuous_expect=${vacuousCalls}, repeats=${rep30}/${tail30.length}`,
      );
      const toolUsesTotal = components ? components.list("tool").reduce((s, t) => s + (components.stats("tool", t.name)?.total.invocations ?? 0), 0) : 0;
      legibilityLines.push(`- Tooling gap: python_calls=${(opts?.metrics ?? attemptMetrics).py_calls}, active_tools=${components?.list("tool").length ?? 0}, tool_invocations=${toolUsesTotal}`);
      if (boundaryReviewsThisLevel.length) {
        legibilityLines.push(`- Prior reviews on L${auditLevel}: ${boundaryReviewsThisLevel.map(r => `s${r.step} ${r.boundary}->${r.decision}(${r.exit_reason}${r.mutations.length ? `:${r.mutations.join(",")}` : ""}${r.note ? `:"${r.note}"` : ""})`).join("; ")}`);
      }
      if (lastConsultOnLevel) {
        legibilityLines.push(`- Last consult (${lastConsultOnLevel.name} at s${lastConsultOnLevel.step}): ${lastConsultOnLevel.answer.slice(0, 500)}`);
      }
    }
    lastAuditBoundary = boundary;
    if (opts?.emitLog !== false) log("dual_audit_shown", { boundary, level: auditLevel, step: state.step, steps: steps.length });
    const limit = opts?.limit ?? (rich ? 6000 : boundary === "level_complete" ? 1600 : boundary === "game_over" ? 1350 : 950);
    const taskBlock = [
      "Layer 1 (Task facts):",
      ...(layer1.length ? layer1 : ["- no transitions recorded yet"]),
    ].join("\n");
    const diagBlock = [layer2, ...legibilityLines].filter(Boolean).join("\n");
    if (rich) {
      const diagPart = diagBlock.slice(0, Math.min(3500, limit));
      const taskBudget = Math.max(400, limit - diagPart.length - 1);
      return [diagPart, taskBlock.slice(0, taskBudget)].filter(Boolean).join("\n");
    }
    return [taskBlock, diagBlock].filter(Boolean).join("\n").slice(0, limit);
  }

  const STUCK_BACKOFF = options.harnessProfile ? [16, 20, 28, 36, 48, 60] : [12, 16, 24, 36, 48, 60];
  const canRunStuckAudit = (actionsUsed: number) =>
    stuckAuditsThisLevel < STUCK_BACKOFF.length &&
    (lastStuckAuditStep < 0 || actionsUsed - lastStuckAuditStep >= STUCK_BACKOFF[stuckAuditsThisLevel]);

  function content(batch: ActionBatch | null, nudge = false, evoOpts?: { evolutionReceipt?: string; boundaryHandled?: boolean }): Content {
    const state = python.state(), events: string[] = [];
    const boundaryHandled = Boolean(evoOpts?.boundaryHandled);
    const isFreshBoard = !shownFrame || shownLevel !== state.level || Boolean(batch?.reset);
    if (isFreshBoard) levelChangedColors.clear();
    else if (shownFrame && state.frame !== shownFrame) recordFrameColorChanges(shownFrame, state.frame, levelChangedColors);
    if (consecutiveLengthStops > 0) {
      events.push(`LENGTH RECOVERY (${consecutiveLengthStops}/${maxLengthRecoveries}): the previous reply hit the output token limit before calling a tool. Output minimal reasoning and call python now.`);
    }
    if (evoOpts?.evolutionReceipt) events.push(evoOpts.evolutionReceipt);
    let inventoryShown = false;
    let dualAuditEmitted = boundaryHandled;
    const canStuckAudit = !boundaryHandled && canRunStuckAudit(state.actions_used);
    if (boardInventoryEnabled && isFreshBoard) {
      const inv = boardInventory(state.frame);
      if (inv.line) { events.push(inv.line); inventoryShown = true; }
    }
    if (components) {
      const regionStall = batch?.steps?.some(fact => (fact.region_tries ?? 0) >= 4 || (fact.same_death !== null && fact.same_death !== undefined && fact.same_death !== false));
      const stallThreshold = options.harnessProfile ? Math.max(16, options.stuckAfter) : 12;
      const stalled = options.consult !== false && (state.stale_steps >= stallThreshold || regionStall);
      if (stalled && canStuckAudit && !batch?.level_changed && state.state !== "GAME_OVER") {
        const ep = effortProgressSummary();
        if (ep) events.push(ep);
        if (state.action_invariant) events.push(`INVARIANT: ${state.action_invariant} — do not mistake this drift for action-specific progress.`);
        const audit = dualAudit("stall", attemptSteps.length ? attemptSteps : levelSteps, state, state.level, {
          compact: true, includeInventory: !inventoryShown,
        });
        inventoryShown = true;
        dualAuditEmitted = true;
        lastStuckAuditStep = state.actions_used;
        stuckAuditsThisLevel += 1;
        events.push(`STALL: ${state.stale_steps} steps without a new state${regionStall ? " or repeated failure/clicks" : ""}; consult("reframer", ...) is available.\n${audit}`);
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
        ? "Context is near the configured limit. Keep the next probe focused."
        : "Context is near the configured limit. Save current findings in work/WORKING.md.");
      contextWarning = false;
    }
    if (nudge && consecutiveObserveTurns > 0)
      events.push(`OBSERVE LIMIT: static inspection already ran ${consecutiveObserveTurns} turn(s) on this unchanged board without acting. Take a 1-step probe or plan now.`);
    if (batch?.level_changed) {
      if (options.harnessProfile) {
        if (boundaryHandled) {
          events.push(`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done.`);
        } else {
          const audit = dualAudit("level_complete", finishedLevelSteps, state, finishedLevelNumber || Math.max(1, state.level - 1), {
            compact: false, includeInventory: false, metrics: finishedLevelMetrics ?? attemptMetrics, evolution: finishedLevelEvolution,
          });
          dualAuditEmitted = true;
          events.push(`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done.\n${audit}`);
        }
        finishedLevelSteps = [];
        finishedLevelNumber = 0;
        finishedLevelMetrics = null;
        finishedLevelEvolution = null;
      } else {
        events.push(`LEVEL COMPLETE: ${state.levels_completed} of ${state.win_levels} levels are done. ` +
          "Write 2-3 lines of notes about what carries over. The latest frame is the starting board of the next level: carry the " +
          "mechanics you established forward as hypotheses, inspect unfamiliar elements (new elements often introduce the mechanic " +
          "this level needs), and reassess whether the goal is still the same.");
      }
    }
    if (state.state === "GAME_OVER") {
      if (options.harnessProfile) {
        if (!boundaryHandled && lastDeathAuditStep !== state.step) {
          lastDeathAuditStep = state.step;
          const failSteps = lastFailedAttemptSteps.length ? lastFailedAttemptSteps : attemptSteps;
          const audit = dualAudit("game_over", failSteps, state, state.level, {
            compact: false, includeInventory: !inventoryShown,
          });
          inventoryShown = true;
          dualAuditEmitted = true;
          events.push(`GAME_OVER: this attempt FAILED (only RESET is valid now).\n${audit}`);
        } else {
          events.push("GAME_OVER: this attempt FAILED (only RESET is valid now).");
        }
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
        ? `LEVEL BUDGET: ${state.level_budget_left} of ${state.level_budget} actions left on this level. Run discriminating probes with expect=.`
        : `LEVEL BUDGET: ${state.level_budget_left} of ${state.level_budget} actions left on this level, and the run ` +
          "ends when they are gone. If the level looks lost, stop re-trying routes: spend the rest on deliberate probes and bank " +
          "what you learned as work/claims/ files - knowledge survives this level, unspent actions do not.");
    if (options.stuckAfter > 0 && state.stale_steps >= options.stuckAfter) {
      if (options.harnessProfile) {
        if (!dualAuditEmitted && canStuckAudit && !batch?.level_changed && state.state !== "GAME_OVER") {
          const ep = effortProgressSummary();
          if (ep && !events.includes(ep)) events.push(ep);
          if (state.action_invariant && !events.some(e => e.startsWith("INVARIANT:")))
            events.push(`INVARIANT: ${state.action_invariant} — do not mistake this drift for action-specific progress.`);
          const audit = dualAudit("stuck", attemptSteps.length ? attemptSteps : levelSteps, state, state.level, {
            compact: true, includeInventory: !inventoryShown,
          });
          inventoryShown = true;
          dualAuditEmitted = true;
          lastStuckAuditStep = state.actions_used;
          stuckAuditsThisLevel += 1;
          events.push(`STUCK: ${state.stale_steps} steps without a new state.\n${audit}`);
        }
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
      ? `MINI REVIEW: ${miniReview}. ${EDITABLE_SPACE}`
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
      const from = Date.now(), outcome = await python.run(params.code, signal, { parentReadonlyTools: options.harnessProfile }), batch = outcome.acted, state = python.state();
      attemptMetrics.py_calls += 1;
      if (outcome.error) {
        attemptMetrics.py_errors += 1;
        const errLine = outcome.error.trim().split("\n").at(-1)?.slice(0, 120) ?? "error";
        attemptMetrics.errors.push(errLine);
        if (attemptMetrics.errors.length > 4) attemptMetrics.errors.shift();
      }
      if (outcome.truncated) attemptMetrics.truncated += 1;
      const pub = options.harnessProfile ? { published: [], failed: [] } : publishTools();
      for (const name of outcome.decoratedTools ?? []) {
        log("tool_decorated", { name, level: state.level, step: state.step, after_audit: lastAuditBoundary || null });
      }
      capabilitiesDirty ||= !!outcome.notes?.some(note => /^(?:loaded |claims\/|lib\/|model\.py)/.test(note));
      log("python", { ms: Date.now() - from, acted: !!batch, actions: batch?.executed ?? 0, stop_reason: batch?.stop_reason ?? null,
        truncated: outcome.truncated, error: outcome.error ?? null, kernel_restarted: !!outcome.kernelRestarted,
        level: state.level, step: state.step, images: outcome.images.length, metrics: outcome.metrics });
      const traceBlock = ensureTraceBlock(state);
      traceBlock.stepEnd = Math.max(traceBlock.stepEnd, state.step);
      traceBlock.pythonCalls.push({
        code: params.code.slice(0, 1000),
        result: outcome.text.slice(0, 600),
        ...(outcome.error ? { error: outcome.error.trim().slice(0, 200) } : {}),
        acted: !!batch,
      });
      let terminate = false;
      const freeToolBuild = !batch && pub.published.length > 0 && !toolBuildFreeUsedThisTurn;
      if (freeToolBuild) toolBuildFreeUsedThisTurn = true;
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
      } else if (!freeToolBuild) {
        observeCallsThisTurn += 1;
      }
      let libCallsInRun = 0;
      const creditedActionLibs = new Set<string>();
      for (const fact of outcome.steps ?? []) {
        write("decisions.jsonl", { t: new Date().toISOString(), ...fact, notes: outcome.notes ?? [], error: outcome.error ?? null });
        traceBlock.actions.push(`s${fact.step} ${fact.action} try${fact.tries}${fact.changed_cells !== undefined ? ` diff=${fact.changed_cells}` : ""}${fact.new ? " new" : ""}${fact.same ? " same" : ""}${fact.death ? " DEATH" : ""}${fact.level_up ? " LEVEL_UP" : ""}`);
        levelSteps.push(fact);
        if (fact.action === "RESET") {
          attemptSteps.length = 0;
          lastFailedAttemptSteps = [];
          attemptMetrics = freshAttemptMetrics();
        } else {
          attemptSteps.push(fact);
          if (fact.new && !options.harnessProfile) lastStuckAuditStep = -1;
        }
        if (lastEvolution && lastEvolution.level === fact.level && fact.action !== "RESET") {
          lastEvolution.actionsSince += 1;
          if (fact.new) lastEvolution.newStatesSince += 1;
          if (fact.death) lastEvolution.deathsSince += 1;
        }
        recentSteps.push(fact);
        if (recentSteps.length > WINDOW_SIZE) recentSteps.shift();
        const m = fact.source && /^(?:direct_lib|assisted_lib)\/([a-z][a-z0-9_]*)$/.exec(fact.source);
        if (m && m[1] !== activeBoundTool) {
          libCallsInRun += 1;
          creditedActionLibs.add(m[1]);
          components?.recordInvocation("tool", m[1], fact.level, fact.step, { ok: !outcome.error, action_producing: true });
          log("lib_invocation", { name: m[1], ok: !outcome.error, action_producing: true, level: fact.level, step: fact.step });
        }
        for (const cid of fact.verify_failed ?? []) {
          log("memory_verify_failure", { check: cid, level: fact.level, step: fact.step, action: fact.action,
            witness: python.memoryCheckStats?.[cid]?.witness ?? null });
        }
        if (fact.branch_handoff?.aligned) alignedUses.set(`${fact.level}/${fact.branch_handoff.tool}`, (alignedUses.get(`${fact.level}/${fact.branch_handoff.tool}`) ?? 0) + 1);
        if (fact.branch_handoff) log("branch_handoff", { ...fact.branch_handoff, level: fact.level, step: fact.step, upward_writeback: true });
      }
      for (const libName of outcome.usedLibs ?? []) {
        if (creditedActionLibs.has(libName) || libName === activeBoundTool) continue;
        libCallsInRun += 1;
        const ok = !outcome.error;
        const witness = ok ? undefined : `L${state.level} s${state.step} ${libName}: ${outcome.error!.trim().split("\n").at(-1)?.slice(0, 120)}`;
        components?.recordInvocation("tool", libName, state.level, state.step, { ok, action_producing: false, witness });
        log("lib_invocation", { name: libName, ok, action_producing: false, level: state.level, step: state.step });
      }
      if (activeBoundTool === null) {
        recentCalls.push({ errors: outcome.error ? 1 : 0, truncated: outcome.truncated ? 1 : 0, tools: libCallsInRun });
        if (recentCalls.length > WINDOW_SIZE) recentCalls.shift();
      }
      if (batch && (batch.level_changed || batch.game_over) && levelSteps.length) {
        const invUnchanged = boardInventoryEnabled && state.frame.length ? boardInventory(state.frame, levelChangedColors).unchanged : [];
        const reviewExtra = options.harnessProfile && components ? {
          components,
          verifyStats: python.memoryCheckStats,
          consults: consultsByLevel.get(levelSteps[0].level) ?? 0,
          attemptMetrics: { ...attemptMetrics, errors: [...attemptMetrics.errors] },
          unchangedSymbols: invUnchanged,
        } : undefined;
        if (batch.level_changed) {
          finishedLevelSteps = [...levelSteps];
          finishedLevelNumber = levelSteps[0].level;
          const old = previousLevelFrame;
          structuralDelta = JSON.stringify({ from: finishedLevelNumber, to: state.level,
            before: old ? structuralSnapshot(old) : null,
            after: structuralSnapshot(state) });
          log("cross_level_delta", { delta: structuralDelta });
          components?.onLevelTransition(finishedLevelNumber, state.level);
          healthCheckPending = true;
          shownTurns.clear();
          cognitiveAudits = correctiveAudits = 0; lastCognitiveStep = lastAnyAuditStep = -Infinity; surpriseSteps.length = 0; consecutiveSurprises = 0; lastPredictionStep = -1; promptRevisionsThisLevel.clear();
          finishedLevelMetrics = { ...attemptMetrics, errors: [...attemptMetrics.errors] };
          finishedLevelEvolution = lastEvolution ? { ...lastEvolution } : null;
          lastReviewPath = writeLevelReview(options.root, levelSteps[0].level, state, levelSteps, outcome.notes ?? [], reviewExtra);
          levelSteps.length = 0;
          attemptSteps.length = 0;
          lastFailedAttemptSteps = [];
          attemptMetrics = freshAttemptMetrics();
          lastEvolution = null;
          lastStuckAuditStep = -1;
          stuckAuditsThisLevel = 0;
          lastDeathAuditStep = -1;
          lastAuditBoundary = "";
          boundaryReviewsThisLevel = [];
          lastConsultOnLevel = null;
        } else if (batch.game_over) {
          lastFailedAttemptSteps = attemptSteps.length ? [...attemptSteps] : [...levelSteps];
          lastReviewPath = writeLevelReview(options.root, levelSteps[0].level, state, levelSteps, outcome.notes ?? [], reviewExtra);
        }
        lastReviewCallback = readReviewCallback(options.root);
        capabilityContext = readCapabilityContext(options.root);
      }
      let resultText = outcome.text;
      for (const p of pub.published)
        resultText += `\n[tool mounted: ${p.name} v${p.version} — callable directly as ${p.name}() or bound tool]`;
      for (const f of pub.failed)
        resultText += `\n[tool publish failed: work/lib/${f.name}.py — ${f.error}]`;
      const observeLimit = options.maxObserveCallsPerTurn ?? (options.harnessProfile ? 4 : 2);
      if (!batch && !freeToolBuild && observeLimit > 0) {
        if (observeCallsThisTurn < observeLimit) {
          resultText += `\n[observe ${observeCallsThisTurn}/${observeLimit}: no action taken; bundle remaining checks into ONE script and act next]`;
        } else {
          observeLimitHitThisTurn = true;
          consecutiveObserveTurns += 1;
          attemptMetrics.observe_limits += 1;
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
        const role = params.name === "reframer"
          ? "Give two mutually exclusive explanations and one discriminating next probe. Cite observed facts. Keep reasoning brief and answer in <= 200 words."
          : components.current("subagent", params.name)?.body;
        if (!role || !ctx.model) return { details: {}, isError: true, content: [{ type: "text", text: "unknown subagent or no model selected" }] };
        consultsByLevel.set(state.level, used + 1);
        log("consult", { name: params.name, level: state.level, step: state.step, attempted: true, after_audit: lastAuditBoundary || null });
        const consultTimeoutMs = Number(process.env.ARC_LAYERED_CONSULT_TIMEOUT_MS ?? 120000);
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), consultTimeoutMs);
        const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
        const started = Date.now();
        let usageRecorded = false;
        const parentThinking = typeof (pi as any).getThinkingLevel === "function" ? (pi as any).getThinkingLevel() : undefined;
        const consultMaxTokens = process.env.ARC_LAYERED_CONSULT_OUTPUT_TOKENS
          ? Number(process.env.ARC_LAYERED_CONSULT_OUTPUT_TOKENS)
          : (options.outputTokens || (ctx.model as any).maxTokens || undefined);
        try {
          const memories = components.list("memory");
          const falsifiedParts = memories.flatMap(item => {
            const match = /(?:^|\n)(?:#+\s*)?Falsified[^\n]*(?:\n(?!(?:#+\s*)?(?:Confirmed|Competing|Next)\b)[^\n]*)*/i.exec(item.body);
            return match ? [`[${item.name}] ${match[0].trim()}`] : [];
          });
          const falsified = (falsifiedParts.join("\n") || memories.map(item => `[${item.name}] ${item.body}`).join("\n")).slice(0, 800);
          const consultSteps = attemptSteps.length ? attemptSteps : (lastFailedAttemptSteps.length ? lastFailedAttemptSteps : levelSteps);
          const trajectory = params.include_trajectory === false ? "" : compressedTrajectory(consultSteps).slice(-900);
          const causal = state.causal_briefing ? `Causal evidence:\n${state.causal_briefing}\n` : "";
          const useImage = !options.noImage && Array.isArray(state.frame) && state.frame.length > 0 && Array.isArray(state.frame[0]) && state.frame[0].length > 0;
          const textFrame = useImage ? "" : `Frame:\n${state.frame.map(row => row.map(cell => cell.toString(16)).join("")).join("\n")}`;
          const valid = (state.valid_actions ?? []).join(" ");
          const budget = [
            state.level_budget_left !== undefined && state.level_budget !== undefined ? `level budget ${state.level_budget_left}/${state.level_budget}` : "",
            state.budget_left !== undefined ? `run budget ${state.budget_left}` : "",
          ].filter(Boolean).join(", ");
          const stateLine = `State: level ${state.level}/${state.win_levels}, step ${state.step}, ${state.state}${budget ? `, ${budget}` : ""}\nValid actions (propose ONLY from this set): ${valid}`;
          const inv = boardInventoryEnabled ? boardInventory(state.frame, levelChangedColors) : null;
          const invBlock = inv?.line
            ? `${inv.line}${inv.unchanged.length ? `\nUnchanged symbols since attempt start: ${inv.unchanged.join(", ")}` : ""}\n`
            : "";
          const capBlock = layer2Snapshot(state.level);
          const briefing = `Question: ${params.question.slice(0, 500)}\n${stateLine}\n${invBlock}Falsified: ${falsified}\n${causal}Trajectory: ${trajectory}${capBlock ? `\n${capBlock}` : ""}${textFrame ? `\n${textFrame}` : "\nThe attached image shows the current frame."}`.slice(0, 9000);
          const userContent: Content = [{ type: "text", text: briefing }, ...(useImage ? [{
            type: "image" as const, mimeType: "image/png",
            data: framePng(state.frame, options.scale, options.gridLines).toString("base64"),
          }] : [])];
          const streamOpts: Record<string, unknown> = {
            signal: controller.signal,
            ...(consultMaxTokens ? { maxTokens: consultMaxTokens } : {}),
            ...(parentThinking && parentThinking !== "off" ? { reasoning: parentThinking } : {}),
          };
          const reply: any = await ctx.modelRegistry.streamSimple(ctx.model, {
            systemPrompt: role, messages: [{ role: "user", content: userContent, timestamp: Date.now() }], tools: [] } as any,
            streamOpts as any).result();
          const answer = (reply.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
          const thinkingChars = (reply.content ?? []).filter((part: any) => part.type === "thinking").map((part: any) => String(part.thinking ?? part.text ?? "")).join("").length;
          const ok = reply.stopReason !== "error" && reply.stopReason !== "aborted" && Boolean(answer);
          write("usage.jsonl", { decision, kind: "subagent", name: params.name, model: ctx.model.id,
            ...usageRecord(reply), ms: Date.now() - started, stop_reason: reply.stopReason });
          usageRecorded = true;
          components.recordInvocation("subagent", params.name, state.level, state.step,
            { ok, witness: ok ? undefined : `L${state.level} s${state.step} consult(${params.name}): ${reply.errorMessage ?? (answer ? reply.stopReason : `empty output (${reply.stopReason})`)}` });
          log("consult", { name: params.name, level: state.level, step: state.step, ok, ms: Date.now() - started,
            stop_reason: reply.stopReason, text_chars: answer.length, thinking_chars: thinkingChars,
            max_tokens: consultMaxTokens ?? null, thinking: parentThinking ?? null, image: useImage,
            after_audit: lastAuditBoundary || null });
          if (!ok) throw Error(reply.errorMessage ?? (answer ? String(reply.stopReason) : `empty output at stopReason=${reply.stopReason}`));
          lastEvolution = { kind: "consult", name: params.name, level: state.level, step: state.step,
            actionsSince: 0, newStatesSince: 0, deathsSince: 0 };
          lastConsultOnLevel = { name: params.name, step: state.step, question: params.question.slice(0, 240), answer: answer.slice(0, 600) };
          ensureTraceBlock(state).consults.push({ name: params.name, question: params.question.slice(0, 240), answer: answer.slice(0, 500) });
          const finalAnswer = reply.stopReason === "length" ? `${answer}\n[truncated at ${consultMaxTokens ?? "model"} tokens]` : answer;
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
  let cognitiveAudits = 0, correctiveAudits = 0, lastCognitiveStep = -Infinity, lastAnyAuditStep = -Infinity;
  const promptRevisionsThisLevel = new Map<string, number>();
  const contradictionAudited = new Set<string>();
  const surpriseSteps: number[] = [];
  let consecutiveSurprises = 0, lastPredictionStep = -1;
  const alignedUses = new Map<string, number>();
  let structuralDelta = "";
  let healthCheckPending = existsSync(join(options.root, "transfer.json"));
  let previousLevelFrame: LayeredState | undefined;
  const archive = options.recoverableFold ? new LayeredArchive(join(options.root, "harness", "archive")) : undefined;
  if (archive) pi.registerTool({ name: "read_archive", label: "read_archive", executionMode: "sequential",
    description: "Read immutable historical evidence by archive handle. Archived advice is not current guidance. Pagination offsets count serialized characters.",
    parameters: Type.Object({ id: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }),
    async execute(_id, params) {
      try {
        const result = archive.read(params.id, params.offset, params.limit);
        log("archive_read", { id: params.id, offset: result.offset, chars: result.text.length });
        return { details: {}, content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { details: {}, isError: true, content: [{ type: "text", text: String(error) }] };
      }
    } });
  const evolutionEnabled = options.evolution ?? Boolean(options.harnessProfile);
  const reflectSchema = Type.Object({ op: Type.Union([Type.Literal("add"), Type.Literal("revise"), Type.Literal("retire"), Type.Literal("restore"), Type.Literal("merge"), Type.Literal("promote"), Type.Literal("demote")]),
    kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent"), Type.Literal("tool")]),
    sources: Type.Optional(Type.Array(Type.String())),
    scope: Type.Optional(Type.Union([Type.Literal("level"), Type.Literal("game")])),
    layer: Type.Optional(Type.Union([Type.Literal("L1"), Type.Literal("L2"), Type.Literal("L3"), Type.Literal("L4"), Type.Literal("L5")])),
    name: Type.String(), body: Type.Optional(Type.String()), summary: Type.Optional(Type.String()), version: Type.Optional(Type.Number()),
    verify: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Object({ when: Type.String(), assert: Type.String() })]),
      { description: "Optional verify rules: either {when, assert} (auto-formatted to '(assert) if (when) else None') or a 1-line Python expr over t returning True/False/None (return None for non-matching transitions)." })) });
  const readSchema = Type.Object({ kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent")]),
    name: Type.String(), version: Type.Optional(Type.Number()) });

  async function executeReflectComponent(
    params: { op: ReflectOp; kind: string; name: string; body?: string; summary?: string; version?: number; verify?: Record<string, VerifyRuleInput>; scope?: Component["scope"]; layer?: Component["layer"]; sources?: string[] },
    source: "parent" | "evolution",
  ): Promise<{ ok: boolean; text: string; label?: string }> {
    if (!components) return { ok: false, text: "components disabled" };

    if (!["memory", "skill", "prompt", "subagent", "tool"].includes(params.kind)) return { ok: false, text: "invalid component kind" };
    if (params.kind === "tool" && !["promote", "demote", "retire"].includes(params.op)) return { ok: false, text: "Use python_inspect to author tools" };
    if (source === "evolution" && params.kind === "prompt" && (params.op === "revise" || params.op === "redefine")) {
      const used = promptRevisionsThisLevel.get(params.name) ?? 0;
      if (used >= 2) {
        return { ok: false, text: `Prompt '${params.name}' already revised ${used}x on this level; stop rewriting prose and instead author a read-only @tool via python_inspect, update Memory with verify, or call finish_evolution(decision='no_change', ...).` };
      }
    }
    try {
      if (params.kind === "memory" && params.verify && Object.keys(params.verify).length === 2 &&
          typeof params.verify.when === "string" && typeof params.verify.assert === "string") {
        params.verify = { rule: { when: params.verify.when, assert: params.verify.assert } };
      }
      if (params.kind === "memory" && params.verify) {
        const checks: Array<{ id: string; expr: string }> = [];
        for (const [name, rule] of Object.entries(params.verify)) {
          const expr = normalizeVerifyExpr(rule);
          const error = checkPythonSyntax(expr, "eval");
          if (error) return { ok: false, text: `verify/${name}: ${error}` };
          checks.push({ id: `${params.name}/${name}`, expr });
        }
        if (python.validateMemoryChecks) {
          const stats = await python.validateMemoryChecks(checks);
          for (const check of checks) {
            const error = stats[check.id]?.error;
            if (error && /^(SyntaxError|NameError|AttributeError):/.test(error))
              return { ok: false, text: `verify/${check.id}: ${error} during historical validation` };
          }
        }
      }
      const item = components.reflect(params.op, params.kind as Kind, params.name, params.body, params.summary, params.version, params.verify, { sources: params.sources, ...(params.scope ? { scope: params.scope } : {}), ...(params.layer ? { layer: params.layer } : {}), ...(params.op === "promote" ? { last_promoted_level: lastAuditBoundary === "level_complete" ? finishedLevelNumber : safeState().level } : {}) });
      if (source === "evolution" && item.kind === "prompt" && (params.op === "revise" || params.op === "redefine")) {
        promptRevisionsThisLevel.set(item.name, (promptRevisionsThisLevel.get(item.name) ?? 0) + 1);
      }
      const st = safeState();
      components.recordChange(item.kind, item.name, st.level, st.step);
      log("component_change", { op: params.op, component_kind: item.kind, layer: item.layer ?? null, scope: item.scope, status: item.status, name: item.name, version: item.version, level: st.level, step: st.step,
        verify_rules: item.verify ? Object.keys(item.verify) : [], after_audit: lastAuditBoundary || null, source });
      lastEvolution = { kind: item.kind, name: item.name, version: item.version, level: st.level, step: st.step,
        actionsSince: 0, newStatesSince: 0, deathsSince: 0,
        baseline: { unchecked: st.unchecked_batches ?? 0, repeats: levelSteps.filter(f => f.same).length, actions: st.actions_used } };
      let reply = `${item.kind}/${item.name} v${item.version} ${item.retired ? "retired" : "active"}`;
      if (item.kind === "memory") {
        if (python.syncMemoryChecks) {
          const stats = await python.syncMemoryChecks(collectMemoryChecks());
          const rules = Object.keys(item.verify ?? {});
          const checkStats = Object.fromEntries(rules.map(r => [`${item.name}/${r}`, stats[`${item.name}/${r}`] ?? null]));
          log("memory_verify_sync", { name: item.name, version: item.version, rules, level: st.level, step: st.step, stats: checkStats, source });
          const summary = formatVerifySummary(item.name, item.verify, stats);
          if (summary) reply += `\n${summary.trim()}`;
          const unscopedNames = rules.filter(r => checkStats[`${item.name}/${r}`]?.unscoped);
          if (unscopedNames.length) {
            reply += `\n[verify fallback: ${unscopedNames.join(", ")} failed all historical transitions with 0 support — marked unscoped so memory stays active]`;
          }
        }
        if (source === "evolution" && !Object.keys(item.verify ?? {}).length) {
          reply += "\n[note: saved memory with 0 verify rules — if this addresses a repeatable check or falsifiable hypothesis, prefer adding a verify rule or authoring & testing a @tool via python_inspect before finish_evolution]";
        }
      }
      return { ok: true, text: reply, label: `${item.kind}/${item.name} v${item.version}` };
    } catch (error) {
      return { ok: false, text: String(error) };
    }
  }

  function executeReadComponent(
    params: { kind: string; name: string; version?: number },
    source: "parent" | "evolution",
  ): { ok: boolean; text: string } {
    if (!components) return { ok: false, text: "components disabled" };
    try {
      const item = params.version ? components.read(params.kind as Kind, params.name, params.version)
        : components.current(params.kind as Kind, params.name);
      if (!item) throw Error("no active component");
      const st = safeState();
      components.recordRead(item.kind, item.name, st.level, st.step);
      log("read_component", { kind: item.kind, name: item.name, version: item.version, level: st.level, step: st.step, source });
      const verifyBlock = item.verify && Object.keys(item.verify).length
        ? `\nverify: ${JSON.stringify(item.verify)}${formatVerifySummary(item.name, item.verify, python.memoryCheckStats)}`
        : "";
      return { ok: true, text: `${item.kind}/${item.name} v${item.version}\n${item.body}${verifyBlock}` };
    } catch (error) {
      return { ok: false, text: String(error) };
    }
  }

  async function runBoundaryEvolution(
    boundary: "game_over" | "level_complete" | "stall" | "stuck" | "verify_contradiction" | "repeated_surprise" | "method_drift",
    steps: StepFact[],
    state: LayeredState,
    auditLevel: number,
    ctx: any,
    opts?: { metrics?: AttemptMetrics; evolution?: EvolutionRecord | null },
  ): Promise<string | undefined> {
    if (!components || !ctx?.model || !ctx?.modelRegistry?.streamSimple) return undefined;
    const timeoutMs = Number(process.env.ARC_LAYERED_EVOLUTION_TIMEOUT_MS ?? 240000);
    const maxRounds = Number(process.env.ARC_LAYERED_EVOLUTION_MAX_ROUNDS ?? 3);
    const contextWindow = Number((ctx.model as any)?.contextWindow ?? 102400);
    const maxDossierChars = Math.min(
      Number(process.env.ARC_LAYERED_EVOLUTION_CONTEXT_CHARS ?? 24000),
      Math.max(6000, Math.floor(contextWindow * 0.35 * 3)),
    );
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const auditTimeout = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(Error(`evolution audit timed out after ${timeoutMs} ms`)), { once: true });
    });
    const started = Date.now();
    const mutations: string[] = [];
    let verifiedToolSample = "";
    let evoDecision: "evolved" | "no_change" | "incomplete" = "incomplete";
    let claimedDecision: string | undefined;
    let exitReason: "finish_evolution" | "max_rounds_exhausted" | "text_stop" | "error" = "max_rounds_exhausted";
    let note = "";
    let roundsRun = 0;
    const parentThinking = typeof (pi as any).getThinkingLevel === "function" ? (pi as any).getThinkingLevel() : undefined;
    const requestedEvoTokens = process.env.ARC_LAYERED_EVOLUTION_OUTPUT_TOKENS
      ? Number(process.env.ARC_LAYERED_EVOLUTION_OUTPUT_TOKENS)
      : (options.outputTokens || (ctx.model as any).maxTokens || undefined);
    const evoMaxTokens = requestedEvoTokens && Math.min(requestedEvoTokens, ctx.model.maxTokens ?? requestedEvoTokens);
    const evoTools = [
      { name: "reflect_component", description: "Add, revise, retire, restore, merge, promote or demote a versioned component (memory with optional verify, L5 prompt <=600 chars, L4 skill, subagent, or tool lifecycle) with scope=level|game and layer=L1..L5.", parameters: reflectSchema },
      { name: "read_component", description: "Read an existing component body.", parameters: readSchema },
      { name: "python_inspect", description: "Run non-acting Python in the live kernel to inspect frames/transitions or author & test @tool helpers (submit_actions is disabled).",
        parameters: Type.Object({ code: Type.String({ description: "Non-acting Python code to run" }) }) },
      { name: "finish_evolution", description: "Finish this evolution review and return control to task play.",
        parameters: Type.Object({ decision: Type.Union([Type.Literal("evolved"), Type.Literal("no_change")]), note: Type.String() }) },
    ];
    try {
      const auditText = dualAudit(boundary, steps, state, auditLevel, {
        compact: false, richWindow: true, includeInventory: true, metrics: opts?.metrics, evolution: opts?.evolution, emitLog: true, limit: 6000,
      });
      const allLive = components.list();
      const nonDormant = allLive.filter(item => item.status !== "dormant" && item.status !== "variant_broken");
      const slotLine = `Harness slots (active): prompt=${nonDormant.filter(i => i.kind === "prompt").length}/1, skill=${nonDormant.filter(i => i.kind === "skill").length}/2, memory=${nonDormant.filter(i => i.kind === "memory").length}/6, tool=${nonDormant.filter(i => i.kind === "tool").length}, subagent=${nonDormant.filter(i => i.kind === "subagent").length}`;
      const metaTag = (item: Component) => `[layer=${item.layer ?? "?"} scope=${item.scope ?? "level"} status=${item.status ?? "active"}${item.when ? ` when=${item.when}` : ""}]`;
      const activeItems = allLive.map(item => {
        const tag = metaTag(item);
        if (item.status === "dormant" || item.status === "variant_broken") {
          return `${item.kind.toUpperCase()} ${item.name} v${item.version} ${tag} (not mounted in parent panel; summary: ${item.summary || item.body.slice(0, 80)})`;
        }
        if (item.kind === "tool") {
          let src = "";
          try { src = readFileSync(join(options.root, "work", "lib", `${item.name}.py`), "utf8").trim().slice(0, 1200); } catch {}
          return `TOOL ${item.name} v${item.version} ${tag}:\n${src || item.body}`;
        }
        if (item.kind === "skill") {
          const st = components.stats("skill", item.name);
          return `SKILL ${item.name} v${item.version} ${tag} (reads=${st?.total.reads ?? 0}, summary=${item.summary}):\n${item.body}`;
        }
        if (item.kind === "subagent") return `SUBAGENT ${item.name} v${item.version} ${tag}:\n${item.body}`;
        return `${tag} ${formatComponentLine(item)}`;
      });
      const activeBudget = Math.min(14000, Math.floor(maxDossierChars * 0.25));
      const activeText = [slotLine, ...(activeItems.length ? activeItems : ["none"])].join("\n\n").slice(0, activeBudget);
      const headerPart = `Boundary: ${boundary.toUpperCase()} | level ${state.level}/${state.win_levels}, step ${state.step}, state=${state.state}` +
        `${[state.level_budget_left !== undefined && state.level_budget !== undefined ? `level budget ${state.level_budget_left}/${state.level_budget}` : "", state.budget_left !== undefined ? `run budget ${state.budget_left}` : ""].filter(Boolean).join(", ") ? `, ${[state.level_budget_left !== undefined && state.level_budget !== undefined ? `level budget ${state.level_budget_left}/${state.level_budget}` : "", state.budget_left !== undefined ? `run budget ${state.budget_left}` : ""].filter(Boolean).join(", ")}` : ""} | valid: ${(state.valid_actions ?? []).join(" ")}`;
      const windowBudget = Math.max(2000, maxDossierChars - headerPart.length - auditText.length - activeText.length - 200);
      const traceSlice = decisionTrace.slice(lastEvoTraceIndex);
      const decisionWindowText = renderDecisionWindow(traceSlice, windowBudget);
      const levelCompleteRule = boundary === "level_complete"
        ? "Boundary rule (LEVEL_COMPLETE): use at most 1 python_inspect call (or 0 if dossier facts suffice), then apply at most 1 component update (or no_change) and call finish_evolution immediately."
        : "";
      const dossier = [
        headerPart,
        levelCompleteRule,
        auditText,
        decisionWindowText ? `DECISIONS SINCE LAST REVIEW:\n${decisionWindowText}` : "",
        `Current Active Components (full bodies):\n${activeText}`,
      ].filter(Boolean).join("\n\n").slice(0, maxDossierChars);
      const useImage = !options.noImage && Array.isArray(state.frame) && state.frame.length > 0 && Array.isArray(state.frame[0]) && state.frame[0].length > 0;
      const userContent: Content = [{ type: "text", text: dossier }, ...(useImage ? [{
        type: "image" as const, mimeType: "image/png",
        data: framePng(state.frame, options.scale, options.gridLines).toString("base64"),
      }] : [])];
      const messages: any[] = [{ role: "user", content: userContent, timestamp: Date.now() }];
      let lengthRetries = 0;
      let done = false;
      for (let round = 1; round <= maxRounds && !done; round += 1) {
        roundsRun = round;
        try { writeFileSync(join(store, "heartbeat"), String(Date.now())); } catch {}
        const roundStart = Date.now();
        const useThinking = lengthRetries === 0 && parentThinking && parentThinking !== "off";
        const evoPromptEst = Math.ceil(EVOLUTION_SYSTEM_PROMPT.length / 3);
        const calcEvoEst = () =>
          Math.ceil(messages.reduce((s, m) => s + estimateTokens(m), 0) * Math.max(calibratedSamples > 0 ? calibratedRatio : 1.0, 1.35)) +
          calibratedOverhead +
          evoPromptEst;
        let evoEst = calcEvoEst();
        if (messages.length > 2 && evoEst + 2048 > contextWindow) {
          for (let mi = 1; mi < messages.length - 1; mi += 1) {
            const msg = messages[mi];
            if (msg?.role === "toolResult" && Array.isArray(msg.content)) {
              msg.content = msg.content.map((p: any) =>
                p.type === "text" && typeof p.text === "string" && p.text.length > 1200
                  ? { ...p, text: `${p.text.slice(0, 1200)}\n[trimmed for context budget]` }
                  : p
              );
            }
          }
          evoEst = calcEvoEst();
        }
        const roundMaxTokens = evoMaxTokens ? Math.min(evoMaxTokens, Math.max(512, contextWindow - evoEst - 1024)) : undefined;
        const streamOpts: Record<string, unknown> = {
          signal: controller.signal,
          ...(roundMaxTokens ? { maxTokens: roundMaxTokens } : {}),
          ...(useThinking ? { reasoning: parentThinking } : {}),
        };
        const reply: any = await Promise.race([ctx.modelRegistry.streamSimple(ctx.model, {
          systemPrompt: EVOLUTION_SYSTEM_PROMPT, messages, tools: evoTools,
        } as any, streamOpts as any).result(), auditTimeout]);
        write("usage.jsonl", { decision, kind: "evolution", boundary, round, model: ctx.model.id,
          ...usageRecord(reply), ms: Date.now() - roundStart, stop_reason: reply.stopReason });
        if (reply.stopReason === "error" || reply.stopReason === "aborted") {
          exitReason = "error";
          throw Error(reply.errorMessage ?? `evolution ${reply.stopReason}`);
        }
        messages.push(reply);
        const calls = (reply.content ?? []).filter((part: any) => part.type === "toolCall");
        const replyText = (reply.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
        if (!calls.length) {
          if (reply.stopReason === "length" && !replyText && lengthRetries < 1) {
            lengthRetries += 1;
            messages.push({ role: "user", content: [{ type: "text", text: `Output concise tool call or finish_evolution now. [evolution round ${round}/${maxRounds}]` }], timestamp: Date.now() });
            continue;
          }
          if (replyText) note = replyText.split("\n")[0].trim().slice(0, 160);
          exitReason = "text_stop";
          if (mutations.length > 0) evoDecision = "evolved";
          break;
        }
        const traceResults: Array<{ name: string; ok: boolean; preview: string }> = [];
        let turnHadError = false;
        for (let ci = 0; ci < calls.length; ci += 1) {
          const call = calls[ci];
          const args = (call.arguments ?? {}) as Record<string, any>;
          let text = "", isError = false;
          if (call.name === "reflect_component") {
            const res = mutations.length
              ? { ok: false, text: "This audit already changed one component." }
              : await executeReflectComponent(args as any, "evolution");
            text = res.text; isError = !res.ok;
            if (res.ok && res.label) mutations.push(res.label);
          } else if (call.name === "read_component") {
            const res = executeReadComponent(args as any, "evolution");
            text = res.text; isError = !res.ok;
          } else if (call.name === "python_inspect") {
            recoverToolPublication();
            const libDir = join(options.root, "work", "lib");
            const beforeLib = new Map((existsSync(libDir) ? readdirSync(libDir).filter(name => /^[a-z][a-z0-9_]*\.py$/.test(name)) : [])
              .map(name => [name, readFileSync(join(libDir, name), "utf8")]));
            writeFileSync(`${publicationJournal}.tmp`, JSON.stringify({ files: Object.fromEntries(beforeLib),
              heads: Object.fromEntries(components.list("tool").map(item => [item.name, item.version])) }), "utf8");
            renameSync(`${publicationJournal}.tmp`, publicationJournal);
            const outcome = await python.run(String(args.code ?? ""), controller.signal, {
              forbidActions: true, parentReadonlyTools: mutations.length > 0, singleToolWrite: true,
            });
            const pub = mutations.length || outcome.error
              ? { published: [], failed: [] }
              : publishTools(new Set(outcome.decoratedTools ?? []));
            for (const name of outcome.decoratedTools ?? []) {
              log("tool_decorated", { name, level: state.level, step: state.step, after_audit: boundary, source: "evolution" });
            }
            for (const p of pub.published) mutations.push(`tool/${p.name} v${p.version}`);
            text = outcome.text;
            if (pub.published.length && !outcome.error) {
              const firstLine = outcome.text.split("\n").map(l => l.trim()).find(Boolean) ?? "";
              if (firstLine) verifiedToolSample = firstLine.slice(0, 120);
            }
            for (const p of pub.published) text += `\n[tool mounted: ${p.name} v${p.version} — callable directly as ${p.name}() or bound tool]`;
            for (const f of pub.failed) text += `\n[tool publish failed: work/lib/${f.name}.py — ${f.error}]`;
            isError = Boolean(outcome.error) || pub.failed.length > 0;
            if (isError && existsSync(libDir)) {
              for (const name of readdirSync(libDir).filter(name => /^[a-z][a-z0-9_]*\.py$/.test(name))) {
                const previous = beforeLib.get(name);
                if (previous === undefined) unlinkSync(join(libDir, name));
                else if (readFileSync(join(libDir, name), "utf8") !== previous) writeFileSync(join(libDir, name), previous, "utf8");
              }
            }
            unlinkSync(publicationJournal);
          } else if (call.name === "finish_evolution") {
            claimedDecision = String(args.decision ?? "");
            if (turnHadError && round < maxRounds) {
              text = "Blocked finish_evolution: an earlier tool call in this round failed. Fix the error or call finish_evolution(decision='no_change', ...) on the next round.";
              isError = true;
            } else if (args.decision === "evolved" && mutations.length === 0) {
              text = "No component was changed. Apply a change or finish with decision='no_change'.";
              isError = true;
            } else {
              evoDecision = args.decision === "evolved" || mutations.length > 0 ? "evolved" : "no_change";
              note = String(args.note ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
              text = `evolution finished (${evoDecision})`;
              exitReason = "finish_evolution";
              done = true;
            }
          } else {
            text = `unknown evolution tool: ${call.name}`;
            isError = true;
          }
          if (isError) turnHadError = true;
          if (ci === calls.length - 1 && !done) {
            const roundNote = round >= maxRounds - 1
              ? `\n[evolution round ${round}/${maxRounds} — FINAL round next: apply at most 1 update and call finish_evolution]`
              : `\n[evolution round ${round}/${maxRounds}]`;
            text += roundNote;
          }
          traceResults.push({ name: call.name, ok: !isError, preview: text.slice(0, 240) });
          messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name,
            content: [{ type: "text", text }], isError, timestamp: Date.now() });
        }
        write("evolution-trace.jsonl", {
          t: new Date().toISOString(), boundary, level: auditLevel, step: state.step, round,
          ...(round === 1 ? { dossier_chars: dossier.length, trace_blocks: traceSlice.length } : {}),
          calls: calls.map((c: any) => ({ name: c.name, args_preview: JSON.stringify(c.arguments ?? {}).slice(0, 240) })),
          results: traceResults,
          ...(replyText ? { text_preview: replyText.slice(0, 240) } : {}),
          ...(done ? { exit_reason: exitReason } : {}),
        });
      }
      if (mutations.length > 0) evoDecision = "evolved";
      const uniqueMutations = [...new Set(mutations)];
      lastEvoTraceIndex = decisionTrace.length;
      if (boundary !== "level_complete") {
        boundaryReviewsThisLevel.push({ step: state.step, boundary, decision: evoDecision, exit_reason: exitReason, mutations: uniqueMutations, note });
      }
      log("evolution_round", { boundary, level: auditLevel, step: state.step, ok: true, decision: evoDecision, exit_reason: exitReason,
        mutations: uniqueMutations, claimed_decision: claimedDecision, note, rounds: roundsRun, dossier_chars: dossier.length, ms: Date.now() - started });
      if (evoDecision === "incomplete" && !uniqueMutations.length) return undefined;
      const mutSummary = uniqueMutations.length ? ` [${uniqueMutations.join(", ")}]` : "";
      const samplePart = verifiedToolSample ? ` (verified output: ${verifiedToolSample})` : "";
      return `EVOLUTION (${boundary}): ${evoDecision}${mutSummary}${samplePart}${note ? ` — ${note}` : ""}`;
    } catch (error) {
      lastEvoTraceIndex = decisionTrace.length;
      log("evolution_round", { boundary, level: auditLevel, step: state.step, ok: false,
        exit_reason: controller.signal.aborted ? "timeout" : "error", error: String(error).slice(0, 200),
        mutations: [...new Set(mutations)], rounds: roundsRun, ms: Date.now() - started });
      return mutations.length ? `EVOLUTION (${boundary}): partial [${[...new Set(mutations)].join(", ")}]` : undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  if (components) {
    pi.registerTool({ name: "read_component", label: "read_component", executionMode: "sequential",
      description: "Read one versioned component body, especially a skill when its index is relevant.",
      parameters: readSchema,
      async execute(_id, params) {
        consecutiveLengthStops = 0;
        const res = executeReadComponent(params as any, "parent");
        return { details: {}, ...(res.ok ? {} : { isError: true }), content: [{ type: "text", text: res.text }] };
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

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!started) await python.init();
    if (components && python.syncMemoryChecks) {
      const checks = collectMemoryChecks();
      if (checks.length) await python.syncMemoryChecks(checks);
    }
    if (components && healthCheckPending) {
      healthCheckPending = false;
      for (const item of components.list("tool").filter(item => item.scope === "game" && item.status !== "dormant")) {
        const fn = item.summary.replace(/\(\)$/, "");
        const code = `import inspect\nimport ${item.name}\nf = ${item.name}.${fn}\nsig = inspect.signature(f)\nrequired = [p for p in sig.parameters.values() if p.default is inspect.Parameter.empty and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)]\nif not required:\n    value = f()\n    if value is None or value == {} or value == [] or value == '':\n        raise ValueError('empty tool result')`;
        const check = await python.run(code, undefined, { forbidActions: true, parentReadonlyTools: true });
        if (check.error) components.reflect("revise", "tool", item.name, item.body, item.summary, undefined, undefined, { status: "variant_broken" });
        log("tool_health_check", { name: item.name, level: python.state().level, ok: !check.error, error: check.error });
      }
    }
    previousLevelFrame = python.state();
    started = true;
    segment += 1; segmentStart = Date.now(); segmentTokens = 0; segmentActions = 0; idle = 0;
    actedThisTurn = false; observeCallsThisTurn = 0; observeLimitHitThisTurn = false; toolBuildFreeUsedThisTurn = false;
    endReason = lastStop = undefined;
    const batch = pending;
    pending = null;
    let evolutionReceipt: string | undefined;
    let boundaryHandled = false;
    if (components && evolutionEnabled && ctx?.model && ctx?.modelRegistry?.streamSimple) {
      const state = python.state();
      if (batch && batch.executed > 0 && lastPredictionStep !== state.step) {
        lastPredictionStep = state.step;
        consecutiveSurprises = batch.surprise ? consecutiveSurprises + 1 : 0;
        if (batch.surprise) surpriseSteps.push(state.step);
      }
      for (const item of components.list("memory")) {
        const rules = Object.keys(item.verify ?? {}).map(rule => python.memoryCheckStats?.[`${item.name}/${rule}`]).filter(rule => rule && !rule.unscoped);
        const buckets: Record<string, { support: number; counter: number }> = {};
        for (const rule of rules) for (const [level, bucket] of Object.entries(rule.by_level ?? {})) {
          const total = buckets[level] ??= { support: 0, counter: 0 };
          total.support = Math.max(total.support, bucket.support); total.counter += bucket.counter;
        }
        const proof = components.updateProof(item.name, state.level, buckets);
        if (proof) log("component_proof", { name: item.name, status: proof.status, level: state.level, buckets });
      }
      const contradiction = components.list("memory").find(item => Object.keys(item.verify ?? {}).some(rule => !python.memoryCheckStats?.[`${item.name}/${rule}`]?.unscoped && Number(python.memoryCheckStats?.[`${item.name}/${rule}`]?.counter ?? 0) > 0) && !contradictionAudited.has(`${item.name}/${item.hash}`));
      const cognitiveBoundary = cognitiveAudits < 3 && contradiction && state.step - lastCognitiveStep >= 4 ? "verify_contradiction"
        : cognitiveAudits < 3 && (consecutiveSurprises >= 2 || surpriseSteps.filter(step => state.step - step < 8).length >= 3) && state.step - lastCognitiveStep >= 6 ? "repeated_surprise"
        : cognitiveAudits < 3 && (state.unchecked_batches ?? 0) >= 4 && state.step - lastCognitiveStep >= 6 ? "method_drift"
        : null;
      const canRun = state.state !== "WIN" && state.budget_left !== 0 && state.level_budget_left !== 0;
      log("audit_gate", { level: state.level, step: state.step, cognitive: cognitiveAudits, total: correctiveAudits,
        last_cognitive_step: Number.isFinite(lastCognitiveStep) ? lastCognitiveStep : null, candidate: cognitiveBoundary,
        can_run: canRun, corrective_limit_reached: correctiveAudits >= 8, cognitive_limit_reached: cognitiveAudits >= 3,
        stale_steps: state.stale_steps, unchecked_batches: state.unchecked_batches, state: state.state,
        budget_left: state.budget_left ?? null, level_budget_left: state.level_budget_left ?? null });
      if (canRun) {
        if (batch?.level_changed) {
          evolutionReceipt = await runBoundaryEvolution("level_complete", finishedLevelSteps, state,
            finishedLevelNumber || Math.max(1, state.level - 1), ctx,
            { metrics: finishedLevelMetrics ?? attemptMetrics, evolution: finishedLevelEvolution });
          boundaryHandled = true;
        } else if (correctiveAudits < 8 && cognitiveBoundary) {
          if (contradiction && cognitiveBoundary === "verify_contradiction") contradictionAudited.add(`${contradiction.name}/${contradiction.hash}`);
          if (cognitiveBoundary === "repeated_surprise") consecutiveSurprises = 0;
          cognitiveAudits += 1; correctiveAudits += 1; lastCognitiveStep = lastAnyAuditStep = state.step;
          evolutionReceipt = await runBoundaryEvolution(cognitiveBoundary, attemptSteps.length ? attemptSteps : levelSteps, state, state.level, ctx);
          boundaryHandled = true;
        } else if (correctiveAudits < 8 && state.step - lastAnyAuditStep >= 2 && state.state === "GAME_OVER" && lastDeathAuditStep !== state.step) {
          correctiveAudits += 1; lastAnyAuditStep = state.step;
          lastDeathAuditStep = state.step;
          const failSteps = lastFailedAttemptSteps.length ? lastFailedAttemptSteps : attemptSteps;
          evolutionReceipt = await runBoundaryEvolution("game_over", failSteps, state, state.level, ctx);
          boundaryHandled = true;
        } else {
          const canStuckAudit = canRunStuckAudit(state.actions_used);
          const regionStall = batch?.steps?.some(fact => (fact.region_tries ?? 0) >= 4 || (fact.same_death !== null && fact.same_death !== undefined && fact.same_death !== false));
          const stallThreshold = options.harnessProfile ? Math.max(16, options.stuckAfter) : 12;
          const stalled = options.consult !== false && (state.stale_steps >= stallThreshold || regionStall);
          const stuck = options.stuckAfter > 0 && state.stale_steps >= options.stuckAfter;
          if (correctiveAudits < 8 && canStuckAudit && (stalled || stuck) && state.state !== "GAME_OVER") {
            lastStuckAuditStep = state.actions_used;
            stuckAuditsThisLevel += 1;
            correctiveAudits += 1; lastAnyAuditStep = state.step;
            evolutionReceipt = await runBoundaryEvolution(stalled ? "stall" : "stuck",
              attemptSteps.length ? attemptSteps : levelSteps, state, state.level, ctx);
            boundaryHandled = true;
          }
        }
      }
    }
    currentTraceBlock = null;
    return { systemPrompt: system, message: { customType: STATE_TYPE, content: content(batch, false, { evolutionReceipt, boundaryHandled }), display: false } };
  });
  pi.on("turn_start", () => { actedThisTurn = false; observeCallsThisTurn = 0; observeLimitHitThisTurn = false; toolBuildFreeUsedThisTurn = false; });
  pi.on("session_before_compact", () => ({ cancel: true }));

  pi.on("context", (event, ctx) => {
    const window = (ctx.model?.contextWindow ?? 128000);
    const scale = calibratedSamples > 0 ? calibratedRatio : 1.0;
    const overhead = calibratedSamples > 0 ? calibratedOverhead : 0;
    const cap = Math.min(options.contextCap || window - 32000, window - options.outputTokens - 8192);
    const target = Math.min(options.contextTarget || Math.floor(cap / 2), cap);
    const recoveryReserve = recoveryText ? estimateTokens({ role: "user", content: [{ type: "text", text: recoveryText }] }) : 0;
    const effectiveCap = Math.max(2048, Math.floor((cap - overhead) / scale) - recoveryReserve);
    const effectiveTarget = Math.min(Math.floor(target / scale), effectiveCap);
    const archived = archive ? foldRecoverably(event.messages, options.foldAfter || 10, archive) : undefined;
    if (archived?.folded) log("archive_fold", { count: archived.folded });
    const result = evict(archived?.messages ?? event.messages, effectiveCap, effectiveTarget, extraBlocks, evictAnchorIndex);
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
      tokens_removed: result.removed, estimate_before: result.before, cap: effectiveCap, target: effectiveTarget });
    const effectiveFoldAfter = options.harnessProfile && components && components.list("memory").length === 0 && options.foldAfter > 0
      ? Math.max(options.foldAfter, 10)
      : options.foldAfter;
    const folding = archive ? { messages: result.messages, folded: 0 } : fold(result.messages, effectiveFoldAfter);
    const preObs = archive || effectiveFoldAfter <= 0
      ? { messages: folding.messages, folded: 0 }
      : foldPreActionObservations(folding.messages);
    if (folding.folded || preObs.folded) log("fold", { parts: folding.folded, pre_action_observe: preObs.folded, keep_blocks: effectiveFoldAfter });
    let messages = recoveryText ? [{ role: "user", content: [{ type: "text", text: recoveryText }] }, ...preObs.messages] : preObs.messages;
    const estimate = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    const calibratedEstimate = Math.ceil(estimate * scale) + overhead;
    const hardTarget = (ctx.model?.contextWindow ?? 128000) - options.compactMargin;
    if (options.compactMargin > 0 && calibratedEstimate > hardTarget) {
      const state = python.state();
      const summary = ["Earlier history was compacted away. What you know so far:",
        options.harnessProfile ? "" : TAGS.filter(tag => memory[tag]).map(tag => `${tag}: ${memory[tag]}`).join("\n"),
        options.notebook ? NOTEBOOK_SECTIONS.filter(name => notebook[name]).map(name => `${name}: ${notebook[name]}`).join("\n") : "",
        lastReviewCallback ? `Last review callback: ${lastReviewCallback}` : "",
        capabilityContext ? `Capabilities restored after eviction:\n${capabilityContext}` : "",
        `Progress: level ${state.level} of ${state.win_levels}, ${state.state}, ${state.actions_used} actions used` +
          `${state.budget_left === undefined ? "" : `, ${state.budget_left} budget left`}.`,
        trail.length ? `Recent action results:\n${trail.join("\n")}` : ""].filter(Boolean).join("\n\n");
      const compacted = compactHistory(messages, summary);
      if (compacted) {
        log("compact", { messages_before: messages.length, messages_after: compacted.length, estimate_before: estimate, calibrated_estimate: calibratedEstimate, target: hardTarget });
        messages = compacted;
      }
    }
    if (components && messages.length > 0) {
      const lastIdx = messages.length - 1;
      const lastMsg = messages[lastIdx];
      if (lastMsg && Array.isArray(lastMsg.content)) {
        const current = lastMsg.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        const live = components.list().filter(item => item.status !== "dormant" && item.status !== "variant_broken");
        const state = python.state();
        const reviewDue = Boolean(lastEvolution && lastEvolution.level === state.level && lastEvolution.actionsSince >= 15 && lastEvolution.newStatesSince === 0);
        const memories = live.filter(item => item.kind === "memory")
          .sort((a, b) => ((a.scope ?? "level") === "level" ? 0 : 1) - ((b.scope ?? "level") === "level" ? 0 : 1))
          .slice(0, 6)
          .map(item => {
            const contradicted = Object.keys(item.verify ?? {}).some(rule => {
              const stat = python.memoryCheckStats?.[`${item.name}/${rule}`];
              return Number(stat?.counter ?? 0) > 0 && !stat?.unscoped;
            });
            if (contradicted || item.status === "contradicted") {
              return { item, line: `[CONTRADICTED] ${item.name} v${item.version}` };
            }
            const statusTag = item.status && item.status !== "active" ? `[${item.status.toUpperCase()}] ` : "";
            const dueTag = reviewDue && lastEvolution?.kind === "memory" && lastEvolution?.name === item.name ? " [REVIEW_DUE]" : "";
            return { item, line: `${statusTag}${formatComponentLine(item)}${dueTag}` };
          });
        const prompts = live.filter(item => item.kind === "prompt").slice(0, 1).map(item => ({ item, line: formatComponentLine(item) }));
        const items = [...prompts, ...memories, ...live.filter(item => item.kind === "tool").map(item => ({
          item, line: `TOOL ${item.name}() v${item.version} — when: ${item.when ?? "inspect current state"}; out/branch: ${item.out_branch ?? item.summary}`,
        }))];
        const newest = items.filter(({ item, line }) => {
          const stats = components.stats(item.kind, item.name);
          const key = `${state.level}/${item.kind}/${item.name}/${item.version}`;
          const turns = shownTurns.get(key);
          return !line.startsWith("[CONTRADICTED]") && stats?.updated_level === state.level &&
            (!turns || turns.size < 2 || turns.has(decision + 1) && turns.size === 2);
        }).at(-1);
        const ordered = newest ? [newest, ...items.filter(entry => entry !== newest)] : items;
        const skills = live.filter(item => item.kind === "skill").map(item => item.name).join(", ");
        let block = "## ACTIVE HARNESS";
        for (const entry of ordered) {
          const { item } = entry;
          const line = entry === newest ? `[NEW] ${entry.line}` : entry.line;
          if (block.length + line.length + 1 > 2500) continue;
          block += `\n${line}`;
          const key = `${state.level}/${item.kind}/${item.name}`;
          for (const bucket of [key, `${key}/${item.version}`]) {
            const turns = shownTurns.get(bucket) ?? new Set<number>();
            turns.add(decision + 1);
            shownTurns.set(bucket, turns);
          }
        }
        const agents = live.filter(item => item.kind === "subagent" && (python.state().stale_steps >= 16 || cognitiveAudits > 0)).map(item => `${item.name}: ${item.summary}`).join("; ");
        if (agents && block.length + agents.length + 21 <= 2500) block += `\nSUBAGENTS (consult): ${agents}`;
        if (skills && block.length + skills.length + 9 <= 2500) block += `\nSKILLS: ${skills}`;
        if (block !== "## ACTIVE HARNESS" && !current.includes(block)) {
          const firstTextIdx = lastMsg.content.findIndex((part: any) => part.type === "text");
          const nextContent = firstTextIdx >= 0
            ? lastMsg.content.map((part: any, i: number) => i === firstTextIdx ? { ...part, text: `${part.text}\n${block}` } : part)
            : [...lastMsg.content, { type: "text", text: block }];
          messages = messages.map((message, i) => i === lastIdx ? { ...message, content: nextContent } : message);
        }
      }
      const active = components.list().filter(item => item.kind === "memory" || item.kind === "prompt");
      const visible = messages.map(message => Array.isArray(message.content)
        ? message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") : "").join("\n");
      for (const item of active) if (visible.includes(`${item.kind.toUpperCase()} ${item.name} v${item.version}: ${item.body}`))
        log("live_injected", { component_kind: item.kind, layer: item.layer ?? null, scope: item.scope, status: item.status, name: item.name, version: item.version, decision: decision + 1 });
    }
    latestContextEstimate = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    write("context.jsonl", { t: new Date().toISOString(), segment, decision: decision + 1,
      total_estimate: latestContextEstimate,
      messages: messages.map(message => ({ role: message.role, type: message.customType,
        tokens: estimateTokens(message), image: Array.isArray(message.content) && message.content.some((part: any) => part.type === "image") })) });
    return { messages };
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (request) requests.finish(request);
    request = requests.start("parent", decision += 1);
    const currentEst = latestContextEstimate;
    requestContextEstimate = currentEst;
    latestContextEstimate = undefined;
    const payload = event.payload as Record<string, any>;
    if (!options.outputTokens) return;
    const key = ctx.model?.api?.includes("responses") ? "max_output_tokens" : "max_completion_tokens" in payload ? "max_completion_tokens" : "max_tokens";
    for (const name of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) delete payload[name];
    let limit = Math.min(options.outputTokens, ctx.model?.maxTokens ?? options.outputTokens);
    if (consecutiveLengthStops >= 1) {
      if ("enable_thinking" in payload) payload.enable_thinking = false;
      if ("reasoning_effort" in payload) payload.reasoning_effort = "none";
      const bumped = Math.min(8192, Math.max(options.outputTokens, options.outputTokens * 2));
      limit = Math.min(bumped, ctx.model?.maxTokens ?? bumped);
      log("length_recovery", { attempt: consecutiveLengthStops, output_tokens: limit });
    }
    if (ctx.model?.contextWindow && currentEst !== undefined) {
      const estInput = Math.ceil(currentEst * (calibratedSamples > 0 ? calibratedRatio : 1.0)) + (calibratedSamples > 0 ? calibratedOverhead : 0);
      if (estInput + limit > ctx.model.contextWindow - 1024) {
        limit = Math.min(limit, Math.max(512, ctx.model.contextWindow - estInput - 1024));
      }
    }
    currentRequestOutputTokens = limit;
    payload[key] = limit;
    return payload;
  });
  pi.on("after_provider_response", event => { if (request) requests.headers(request, event.status); });

  pi.on("message_end", event => {
    const message: any = event.message;
    if (message.role !== "assistant") return;
    const usage = usageRecord(message);
    if (request && requestContextEstimate !== undefined && usage.input !== null && usage.cache_read !== null && usage.cache_write !== null) {
      const reported = usage.input + usage.cache_read + usage.cache_write;
      if (requestContextEstimate > 0 && reported > 0) {
        calibratedSamples += 1;
        if (requestContextEstimate < 4000) {
          calibratedOverhead = Math.max(calibratedOverhead, Math.min(12000, Math.max(0, reported - requestContextEstimate)));
        } else {
          const rawRatio = Math.max(1.0, Math.min(2.2, (reported - calibratedOverhead) / requestContextEstimate));
          calibratedRatio = Math.max(rawRatio, calibratedRatio * 0.7 + rawRatio * 0.3);
        }
      }
      write("context-calibration.jsonl", { t: new Date().toISOString(), request_id: request, decision,
        message_estimate: requestContextEstimate, reported_input_with_cache: reported,
        ratio: requestContextEstimate > 0 ? reported / requestContextEstimate : null,
        scope: "estimate excludes system and tool schemas; reported input includes them and image accounting" });
    }
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
    const msgText = (message.content ?? []).filter((part: any) => part.type === "text" || part.type === "thinking")
      .map((part: any) => String(part.type === "thinking" ? (part.thinking ?? part.text ?? "") : (part.text ?? ""))).join("\n").trim();
    if (msgText) {
      const tb = ensureTraceBlock();
      tb.reasoningTail = `${tb.reasoningTail ? `${tb.reasoningTail}\n` : ""}${msgText}`.slice(-800);
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
  pi.on("session_shutdown", () => {
    if (levelSteps.length) {
      const st = safeState();
      const invUnchanged = boardInventoryEnabled && st.frame.length ? boardInventory(st.frame, levelChangedColors).unchanged : [];
      writeLevelReview(options.root, levelSteps[0].level, st, levelSteps, [], options.harnessProfile && components ? {
        components,
        verifyStats: python.memoryCheckStats,
        consults: consultsByLevel.get(levelSteps[0].level) ?? 0,
        attemptMetrics: { ...attemptMetrics, errors: [...attemptMetrics.errors] },
        unchangedSymbols: invUnchanged,
      } : undefined);
    }
    python.close();
  });
}

export default function arcLayeredExtension(pi: ExtensionAPI) {
  const env = process.env, root = env.ARC_RUN_ROOT ?? process.cwd(), local = env.ARC_LAYERED_CONFIG === "kaggle-local";
  const harnessProfile = env.ARC_LAYERED_PROFILE === "qwen27b-harness";
  const qwen27b = env.ARC_LAYERED_PROFILE === "qwen27b" || harnessProfile;
  const maxActionsPerCall = 16;
  const stuckAfter = Number(env.ARC_LAYERED_STUCK_AFTER ?? (harnessProfile ? 16 : 8));
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
  const outputTokens = Number(env.ARC_LAYERED_OUTPUT_TOKENS ?? (env.ARC_LAYERED_PROFILE === "qwen27b" ? 4096 : 12000));
  installLayered(pi, python, { scale: Number(env.ARC_LAYERED_SCALE ?? 10), gridLines: !local, reminder: env.ARC_LAYERED_REMINDER !== "0", root, maxActionsPerCall,
    outputTokens,
    contextCap: Number(env.ARC_LAYERED_CONTEXT_CAP ?? (harnessProfile ? 80000 : qwen27b ? 40960 : 131072)),
    contextTarget: Number(env.ARC_LAYERED_CONTEXT_TARGET ?? (harnessProfile ? 48000 : qwen27b ? 20480 : 57344)),
    diffImage: env.ARC_LAYERED_DIFF_IMAGE === "1" || (!qwen27b && env.ARC_LAYERED_DIFF_IMAGE !== "0"),
    noImage: env.ARC_LAYERED_NO_IMAGE === "1",
    harnessProfile, minimalBasePrompt: env.ARC_LAYERED_MINIMAL_BASE_PROMPT === "1", consult: env.ARC_LAYERED_CONSULT !== "0",
    recoverableFold: env.ARC_LAYERED_RECOVERABLE_FOLD === "1",
    evolution: harnessProfile && env.ARC_LAYERED_EVOLUTION !== "0",
    boardInventory: harnessProfile && env.ARC_LAYERED_BOARD_INVENTORY !== "0",
    idleContinuations: Number(env.ARC_LAYERED_IDLE_CONTINUATIONS ?? 3),
    segmentSeconds: Number(env.ARC_LAYERED_SEGMENT_SECONDS ?? 1_000_000), segmentTokens: Number(env.ARC_LAYERED_SEGMENT_TOKENS ?? 100_000_000),
    stuckAfter, foldAfter: Number(env.ARC_LAYERED_FOLD_AFTER ?? 0),
    compactMargin: Number(env.ARC_LAYERED_COMPACT_MARGIN ?? (qwen27b ? Math.max(outputTokens + 8192, 16384) : 0)), notebook: env.ARC_LAYERED_NOTEBOOK === "1" && !local,
    gradient: env.ARC_LAYERED_GRADIENT === "1", rollAfter: Number(env.ARC_LAYERED_ROLL_AFTER ?? 0),
    maxObserveCallsPerTurn: Number(env.ARC_LAYERED_MAX_OBSERVE_CALLS ?? (harnessProfile ? 4 : 2)),
    flags: { expect: env.ARC_LAYERED_EXPECT !== "0", graph: env.ARC_LAYERED_GRAPH === "1",
      work: env.ARC_LAYERED_WORK !== "0", model: env.ARC_LAYERED_MODEL !== "0", tags: env.ARC_LAYERED_TAGS === "1",
      claims: env.ARC_LAYERED_CLAIMS !== "0" } });
}
