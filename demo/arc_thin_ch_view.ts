/**
 * Continual Harness's game observation and ARC action conventions, rendered inside this harness's own decision (user,
 * 2026-10-20: only CH's game observations and ARC-related predefined tools and information are to match CH; the rest is
 * this harness's). Source, read 2026-10-20: D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3/agents/templates/
 * continual_harness/{context,helpers,trajectory,action_descriptions,tools}.py. Pure functions; the extension decides
 * when they run. Record: docs/plans/2026-10-20-ch-observation-adapter-alignment.md.
 */
import { deflateSync } from "node:zlib";

export type Grid = number[][];

/** action_descriptions.py, verbatim (the official ARC-AGI-3 agents template's meanings). */
export const ACTION_DESCRIPTIONS: Record<string, string> = {
  RESET: "Start or restart a game. Must be called first when NOT_PLAYED or after GAME_OVER to play again.",
  ACTION1: "(1, W, Up).",
  ACTION2: "(2, S, Down).",
  ACTION3: "(3, A, Left).",
  ACTION4: "(4, D, Right).",
  ACTION5: "(5, Enter, Spacebar, Delete).",
  ACTION6: "(6, Click, Point).",
  ACTION7: "(7, Undo, Back).",
};
export const GAME_ACTIONS = ["RESET", "ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION6", "ACTION7"];
export const CURRENT_STATE_GRID_LABEL = "current_state_frame";
export const MAX_OBSERVATION_TEXT_GRIDS = 4;
/** ContinualHarness.HISTORY_MAX_CHARS (RECENT HISTORY) and FULL_HISTORY_MAX_LIMIT (the step records code sees). */
export const HISTORY_MAX_CHARS = 12000;
export const FULL_HISTORY_MAX_LIMIT = 80;

// ---------------------------------------------------------------------------------------------------- hex and images

const HEX = "0123456789abcdef";
export const colorToHex = (value: number) => HEX[((Math.trunc(Number(value)) % 16) + 16) % 16];
export const gridToHexLines = (grid: Grid) => grid.map((row) => row.map(colorToHex).join(""));
const widthOf = (grid: Grid) => grid.reduce((n, row) => Math.max(n, row.length), 0);

export function prettyPrintGrid(grid: Grid, label: string): string {
  return [`Grid ${label} (${grid.length}x${widthOf(grid)}) [hex 0-f = color 0-15]:`, ...gridToHexLines(grid)].join("\n");
}

/** helpers._PALETTE: the ARC-AGI-3 16-colour palette, indexed by cell value modulo 16 (RGBA). */
export const PALETTE: Array<[number, number, number, number]> = [
  [0xff, 0xff, 0xff, 0xff], [0xcc, 0xcc, 0xcc, 0xff], [0x99, 0x99, 0x99, 0xff], [0x66, 0x66, 0x66, 0xff],
  [0x33, 0x33, 0x33, 0xff], [0x00, 0x00, 0x00, 0xff], [0xe5, 0x3a, 0xa3, 0xff], [0xff, 0x7b, 0xcc, 0xff],
  [0xf9, 0x3c, 0x31, 0xff], [0x1e, 0x93, 0xff, 0xff], [0x88, 0xd8, 0xf1, 0xff], [0xff, 0xdc, 0x00, 0xff],
  [0xff, 0x85, 0x1b, 0xff], [0x92, 0x12, 0x31, 0xff], [0x4f, 0xcc, 0x30, 0xff], [0xa3, 0x56, 0xd6, 0xff],
];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngChunk(name: string, data: Buffer): Buffer {
  const label = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([label, data])) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, label, data, tail]);
}

/** helpers.grid_to_image: one RGBA pixel per cell (an empty grid is a 64x64 image of colour 0), as a PNG. */
export function gridPng(grid: Grid): Buffer {
  const height = grid.length, width = widthOf(grid);
  const [w, h] = height && width ? [width, height] : [64, 64];
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const value = height && width ? (x < grid[y].length ? Number(grid[y][x]) : 0) : 0;
      const color = PALETTE[((Math.trunc(value) % 16) + 16) % 16];
      raw.set(color, y * stride + 1 + x * 4);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
export const gridImage = (grid: Grid) => ({ type: "image" as const, data: gridPng(grid).toString("base64"), mimeType: "image/png" as const });

// ---------------------------------------------------------------------------------------------------- differences

type DiffStats = { count: number; bbox: [number, number, number, number] | null; colors: Set<number> };
const NO_DIFF = (): DiffStats => ({ count: 0, bbox: null, colors: new Set() });

/** context._grid_diff_stats: changed cells, their box (r0, r1, c0, c1) and the colours on either side. */
function gridDiffStats(before: Grid | undefined, after: Grid | undefined): DiffStats {
  if (!before || !after) return NO_DIFF();
  const height = Math.max(before.length, after.length), width = Math.max(widthOf(before), widthOf(after));
  let count = 0, minR = height, maxR = -1, minC = width, maxC = -1;
  const colors = new Set<number>();
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const a = before[y]?.[x], b = after[y]?.[x];
      if (a === b) continue;
      count += 1;
      minR = Math.min(minR, y); maxR = Math.max(maxR, y); minC = Math.min(minC, x); maxC = Math.max(maxC, x);
      if (a !== undefined) colors.add(Number(a));
      if (b !== undefined) colors.add(Number(b));
    }
  return { count, bbox: count ? [minR, maxR, minC, maxC] : null, colors };
}

function mergeBbox(boxes: Array<DiffStats["bbox"]>): DiffStats["bbox"] {
  const present = boxes.filter((box): box is [number, number, number, number] => box !== null);
  if (!present.length) return null;
  return [Math.min(...present.map((b) => b[0])), Math.max(...present.map((b) => b[1])),
    Math.min(...present.map((b) => b[2])), Math.max(...present.map((b) => b[3]))];
}
const rangeLabel = (prefix: string, start: number, end: number) => start === end ? `${prefix}${start}` : `${prefix}${start}-${end}`;
const formatBbox = (box: DiffStats["bbox"]) => box ? `${rangeLabel("r", box[0], box[1])} ${rangeLabel("c", box[2], box[3])}` : "none";
function formatIndexRanges(indices: number[]): string {
  if (!indices.length) return "none";
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], prev = sorted[0];
  for (const index of sorted.slice(1)) {
    if (index === prev + 1) { prev = index; continue; }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = index;
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  return ranges.join(",");
}
const colorsText = (colors: Set<number>) => `[${[...colors].sort((a, b) => a - b).map(colorToHex).join(",")}]`;
/** Python's round(): halves go to the even neighbour. */
function pyRound(value: number): number {
  const floor = Math.floor(value), fraction = value - floor;
  return fraction > 0.5 ? floor + 1 : fraction < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
}
/** max(indices, key=lambda i: (stats[i].count, -i)): the largest count, the earliest index on a tie. */
const argmaxCount = (indices: number[], stats: DiffStats[]) =>
  indices.reduce((best, i) => stats[i].count > stats[best].count || (stats[i].count === stats[best].count && i < best) ? i : best);

/** context._select_transient_keyframes. */
function selectTransientKeyframes(diffToPre: DiffStats[], diffToPrev: DiffStats[], changed: number[], limit = 3): number[] {
  if (!changed.length || limit <= 0) return [];
  const first = changed[0], last = changed.at(-1)!;
  const peak = argmaxCount(changed, diffToPre);
  const motion = Array.from({ length: Math.max(0, diffToPrev.length - 1) }, (_, k) => k + 1);
  const maxMotion = motion.length ? argmaxCount(motion, diffToPrev) : peak;
  const chosen: number[] = [];
  for (const index of [first, peak, last, maxMotion]) {
    if (changed.includes(index) && !chosen.includes(index)) chosen.push(index);
    if (chosen.length >= limit) return chosen.sort((a, b) => a - b);
  }
  if (chosen.length < limit && changed.length > chosen.length) {
    const slots = limit - chosen.length;
    for (let slot = 0; slot < slots; slot += 1) {
      if (limit - chosen.length <= 0) break;
      const index = changed[pyRound(slot * (changed.length - 1) / Math.max(1, limit - 1))];
      if (!chosen.includes(index)) chosen.push(index);
    }
  }
  return chosen.slice(0, limit).sort((a, b) => a - b);
}

/** context._animation_summary. */
function animationSummary(animation: Grid[], preGrid: Grid | undefined) {
  if (!animation.length || !preGrid)
    return { summary: "ANIMATION SUMMARY: unavailable", finalChanged: false, transientChanged: false, changed: [] as number[],
      diffToPre: [] as DiffStats[], diffToPrev: [] as DiffStats[] };
  const diffToPre = animation.map((grid) => gridDiffStats(preGrid, grid));
  const diffToPrev = [NO_DIFF(), ...animation.slice(1).map((grid, i) => gridDiffStats(animation[i], grid))];
  const changed = diffToPre.flatMap((stats, i) => stats.count > 0 ? [i] : []);
  const finalChanged = diffToPre.at(-1)!.count > 0;
  const transientChanged = diffToPre.some((stats, i) => i !== animation.length - 1 && stats.count > 0);
  let summary: string;
  if (changed.length) {
    const peak = argmaxCount(changed, diffToPre);
    const motion = Array.from({ length: diffToPrev.length - 1 }, (_, k) => k + 1);
    const maxMotion = motion.length ? argmaxCount(motion, diffToPrev) : 0;
    const colors = new Set<number>();
    for (const i of changed) for (const c of diffToPre[i].colors) colors.add(c);
    summary = "ANIMATION SUMMARY: " +
      `frame_count=${animation.length}; ` +
      `changed_frames=${formatIndexRanges(changed)} (${changed.length}/${animation.length}); ` +
      `peak_change=${diffToPre[peak].count} cells at grid ${peak}; ` +
      `max_motion=${diffToPrev[maxMotion].count} cells at grid ${maxMotion}; ` +
      `bbox=${formatBbox(mergeBbox(changed.map((i) => diffToPre[i].bbox)))}; ` +
      `colors_seen(hex)=${colorsText(colors)}`;
  } else {
    summary = "ANIMATION SUMMARY: " +
      `frame_count=${animation.length}; changed_frames=none; peak_change=0 cells; max_motion=0 cells; bbox=none; colors_seen(hex)=[]`;
  }
  return { summary, finalChanged, transientChanged, changed, diffToPre, diffToPrev };
}

// ---------------------------------------------------------------------------------------------------- observations

/** One action since the previous decision's prompt (models.PendingActionObservation, with the frames it refers to). */
export type PendingObservation = {
  step: number; action: string; data?: Record<string, unknown>; source: string;
  batchId?: string; batchPosition?: number; batchTotal?: number;
  preState: string; preScore: number; preGrid?: Grid;
  postState?: string; postScore?: number; animation: Grid[]; validFrame: boolean;
};
export type RenderedGrid = { label: string; grid: Grid };

function formatAction(obs: PendingObservation): string {
  const data = obs.data ?? {};
  const keys = Object.keys(data);
  if (!keys.length) return obs.action;
  if (keys.length === 2 && "x" in data && "y" in data) return `${obs.action}(x=${data.x},y=${data.y})`;
  return `${obs.action}(${keys.sort().map((k) => `${k}=${data[k]}`).join(",")})`;
}

type Candidate = { observation: number; frame: number; grid: Grid; role: string; priority: [number, number, number] };

function observationPlan(obs: PendingObservation, index: number) {
  const animation = obs.validFrame ? obs.animation : [];
  const { summary, finalChanged, transientChanged, changed, diffToPre, diffToPrev } = animationSummary(animation, obs.preGrid);
  const lines = [
    `### ACTION step ${obs.step}: ${formatAction(obs)}`,
    "RESULT: " +
      `state ${obs.preState} -> ${obs.validFrame ? obs.postState ?? "?" : "?"}; ` +
      `score ${obs.preScore} -> ${obs.validFrame ? obs.postScore ?? "?" : "?"}; ` +
      `source=${obs.source}; ` +
      `final_grid_changed=${finalChanged ? "yes" : "no"}; ` +
      `transient_animation=${transientChanged && !finalChanged ? "yes" : "no"}`,
  ];
  if (obs.batchId && obs.batchPosition !== undefined && obs.batchTotal !== undefined)
    lines[lines.length - 1] += `; batch=${obs.batchId}[${obs.batchPosition}/${obs.batchTotal}]`;
  const candidates: Candidate[] = [];
  if (!obs.validFrame) {
    lines.push("ANIMATION SUMMARY: environment returned no frame; the remote action outcome is unknown. Do not assume the " +
      "action was rejected or blindly repeat it.");
    return { obs, lines, candidates };
  }
  if (animation.length > 1) lines.push(summary);
  if (finalChanged && animation.length) {
    const frame = animation.length - 1;
    candidates.push({ observation: index, frame, grid: animation[frame], role: "final_changed_result", priority: [4, -obs.step, frame] });
  } else if (transientChanged && animation.length) {
    const selected = selectTransientKeyframes(diffToPre, diffToPrev, changed, 3);
    const peak = changed.length ? argmaxCount(changed, diffToPre) : -1;
    const first = changed.length ? changed[0] : -1, last = changed.length ? changed.at(-1)! : -1;
    for (const frame of selected) {
      const [rank, role] = frame === peak ? [0, "peak_changed"] : frame === first ? [1, "first_changed"]
        : frame === last ? [2, "last_changed"] : [3, "motion_sample"];
      candidates.push({ observation: index, frame, grid: animation[frame], role: role as string, priority: [rank as number, -obs.step, frame] });
    }
  }
  return { obs, lines, candidates };
}

const comparePriority = (a: Candidate, b: Candidate) => a.priority[0] - b.priority[0] || a.priority[1] - b.priority[1] || a.priority[2] - b.priority[2];

/** context.build_observation_section: the text, and exactly the grids rendered in it (their PNGs go with the prompt). */
export function buildObservationSection(observations: PendingObservation[], maxTextGrids = MAX_OBSERVATION_TEXT_GRIDS):
  { text: string; grids: RenderedGrid[] } {
  if (!observations.length) return { text: "", grids: [] };
  const plans = observations.map(observationPlan);
  const selected = new Set(plans.flatMap((plan) => plan.candidates).sort(comparePriority).slice(0, Math.max(0, maxTextGrids))
    .map((c) => `${c.observation}:${c.frame}`));
  const lines = [
    "The grids below are selected transition/result grids from actions executed after the previous VLM query.",
    "Grid indices refer to that action's returned frame list.",
  ];
  const grids: RenderedGrid[] = [];
  for (const plan of plans) {
    lines.push("", ...plan.lines);
    const shown = plan.candidates.filter((c) => selected.has(`${c.observation}:${c.frame}`)).sort((a, b) => a.frame - b.frame);
    if (shown.length) {
      lines.push(`RENDERED GRIDS: frame indices [${shown.map((c) => c.frame).join(", ")}]`);
      for (const c of shown) {
        const rendered = { label: `action_step_${plan.obs.step}_frame_${c.frame}`, grid: c.grid };
        grids.push(rendered);
        lines.push(prettyPrintGrid(rendered.grid, rendered.label));
      }
    } else lines.push(plan.candidates.length ? "RENDERED GRIDS: omitted by observation grid budget" : "RENDERED GRIDS: none");
  }
  return { text: lines.join("\n"), grids };
}

/** _build_sandbox_observations: one entry per action since the last query, with its whole animation (hex rows). */
export function sandboxObservation(obs: PendingObservation): Record<string, unknown> {
  const data = obs.data ?? {};
  const keys = Object.keys(data);
  const label = "x" in data && "y" in data ? `${obs.action}(x=${data.x}, y=${data.y})`
    : keys.length ? `${obs.action}(${keys.map((k) => `${k}=${data[k]}`).join(", ")})` : obs.action;
  return { step: obs.step, action: label, source: obs.source, state: obs.validFrame ? obs.postState ?? obs.preState : obs.preState,
    score: obs.validFrame ? obs.postScore ?? obs.preScore : obs.preScore, frame: obs.animation.map(gridToHexLines) };
}

// ---------------------------------------------------------------------------------------------------- current state

/**
 * context._format_available_actions: the offered actions with their meanings. CH never lists RESET, because its own
 * harness plays it; here RESET is the agent's action, so it is listed when the environment offers it.
 */
export function formatAvailableActions(actions: string[]): string {
  const listed = [...new Set(actions.filter((name) => GAME_ACTIONS.includes(name)))];
  if (!listed.length) return "(none — wait for the next frame)";
  return "\n" + listed.map((name) => {
    const description = name === "ACTION6" ? "Complex click — provide x (column 0-63) and y (row 0-63)." : ACTION_DESCRIPTIONS[name] ?? "";
    return description ? `  ${name}: ${description}` : `  ${name}`;
  }).join("\n");
}

/** context.build_working_prompt's state block. */
export function currentStateBlock(state: string, levelsCompleted: number, actions: string[], grid: Grid | undefined): string {
  const frameText = grid?.length ? prettyPrintGrid(grid, CURRENT_STATE_GRID_LABEL) : "(empty frame)";
  return "## CURRENT STATE\n" +
    `state: ${state}\n` +
    `score (levels completed): ${levelsCompleted}\n` +
    `available actions: ${formatAvailableActions(actions)}\n` +
    `current grid (latest_frame.frame[-1]):\n${frameText}`;
}

// ---------------------------------------------------------------------------------------------------- history

/** trajectory.StepRecord, as far as RECENT HISTORY reads it. */
export type StepRecord = {
  step: number; action: string; data?: Record<string, unknown>; source: string;
  score: number; state: string; stateAfter?: string; scoreDelta?: number | null;
  gridChange?: number[][] | null; gridDelta?: number[][] | null;
};

/** trajectory.summarize_grid_transitions: [from, to, count, r0, r1, c0, c1] per colour transition, largest first. */
export function summarizeGridTransitions(pre: Grid | undefined, post: Grid | undefined): number[][] | null {
  if (!pre || !post) return null;
  const groups = new Map<string, number[]>();
  for (let y = 0; y < Math.min(pre.length, post.length); y += 1)
    for (let x = 0; x < Math.min(pre[y].length, post[y].length); x += 1) {
      const a = Number(pre[y][x]), b = Number(post[y][x]);
      if (a === b) continue;
      const key = `${a},${b}`, g = groups.get(key);
      if (!g) groups.set(key, [a, b, 1, y, y, x, x]);
      else { g[2] += 1; g[3] = Math.min(g[3], y); g[4] = Math.max(g[4], y); g[5] = Math.min(g[5], x); g[6] = Math.max(g[6], x); }
    }
  if (!groups.size) return null;
  return [...groups.values()].sort((a, b) => b[2] - a[2] || a[3] - b[3] || a[5] - b[5]);
}

/** ContinualHarness._compute_grid_delta: changed cells [x, y, old, new], at most 50. */
export function computeGridDelta(pre: Grid | undefined, post: Grid | undefined): number[][] | null {
  if (!pre || !post) return null;
  const delta: number[][] = [];
  for (let y = 0; y < Math.min(pre.length, post.length); y += 1)
    for (let x = 0; x < Math.min(pre[y].length, post[y].length); x += 1)
      if (pre[y][x] !== post[y][x]) {
        delta.push([x, y, Number(pre[y][x]), Number(post[y][x])]);
        if (delta.length >= 50) return delta;
      }
  return delta.length ? delta : null;
}

const rangeToken = (r0: number, r1: number, c0: number, c1: number) => `${r0 === r1 ? `r${r0}` : `r${r0}-${r1}`} ${c0 === c1 ? `c${c0}` : `c${c0}-${c1}`}`;
function renderTransitions(transitions: number[][], maxGroups = 6): string {
  const total = transitions.reduce((n, e) => n + Number(e[2]), 0);
  const parts = transitions.slice(0, maxGroups).map(([f, t, count, r0, r1, c0, c1]) =>
    `color ${colorToHex(f)}→${colorToHex(t)}${count > 1 ? ` (×${count})` : ""}: ${rangeToken(r0, r1, c0, c1)}`);
  if (transitions.length > maxGroups) parts.push(`+${transitions.length - maxGroups} more`);
  return `${total} ${total === 1 ? "cell" : "cells"} changed: ${parts.join("; ")}`;
}
function transitionsFromDelta(delta: number[][] | null | undefined): number[][] | null {
  if (!delta?.length) return null;
  const groups = new Map<string, number[]>();
  for (const cell of delta) {
    if (!Array.isArray(cell) || cell.length < 4) continue;
    const [x, y, a, b] = cell.map(Number);
    const key = `${a},${b}`, g = groups.get(key);
    if (!g) groups.set(key, [a, b, 1, y, y, x, x]);
    else { g[2] += 1; g[3] = Math.min(g[3], y); g[4] = Math.max(g[4], y); g[5] = Math.min(g[5], x); g[6] = Math.max(g[6], x); }
  }
  return groups.size ? [...groups.values()].sort((a, b) => b[2] - a[2] || a[3] - b[3] || a[5] - b[5]) : null;
}
function shortActionLabel(record: StepRecord): string {
  const data = record.data ?? {};
  if ("x" in data && "y" in data) return `${record.action}(x=${data.x}, y=${data.y})`;
  const keys = Object.keys(data);
  return keys.length ? `${record.action}(${keys.map((k) => `${k}=${data[k]}`).join(", ")})` : record.action;
}
function renderEffect(record: StepRecord): string {
  if (typeof record.scoreDelta === "number" && record.scoreDelta > 0) return `LEVEL UP ${record.score}→${record.score + record.scoreDelta}`;
  if (record.stateAfter === "INVALID" || record.stateAfter === "UNKNOWN") return "outcome unknown (no frame returned)";
  if (record.stateAfter && record.stateAfter !== record.state && (record.stateAfter === "GAME_OVER" || record.stateAfter === "WIN"))
    return `→ ${record.stateAfter}`;
  const transitions = record.gridChange ?? transitionsFromDelta(record.gridDelta);
  return transitions?.length ? renderTransitions(transitions) : "no change";
}
const isReset = (record: StepRecord) => record.action === "RESET" || record.source === "auto_reset";
/** trajectory._source_label: the environment's own RESET reads "reset"; this harness's sources are already display names. */
const historySource = (record: StepRecord) => record.source === "auto_reset" ? "reset" : record.source || "arc_action";

function groupLevels(records: StepRecord[]): Array<[number, StepRecord[]]> {
  const levels: Array<[number, StepRecord[]]> = [];
  for (const record of records) {
    const score = Number.isInteger(record.score) ? record.score : 0;
    if (levels.length && levels.at(-1)![0] === score) levels.at(-1)![1].push(record);
    else levels.push([score, [record]]);
  }
  return levels;
}
function splitAttempts(rows: StepRecord[]): StepRecord[][] {
  const attempts: StepRecord[][] = [];
  let current: StepRecord[] = [];
  for (const row of rows) {
    if (isReset(row)) { if (current.length) { attempts.push(current); current = []; } }
    else current.push(row);
  }
  if (current.length) attempts.push(current);
  return attempts;
}
const stepRange = (rows: StepRecord[]): [number | undefined, number | undefined] => rows.length
  ? [Math.min(...rows.map((r) => r.step)), Math.max(...rows.map((r) => r.step))] : [undefined, undefined];
function attemptKey(attempt: StepRecord[]): [string, string] {
  if (!attempt.length) return ["empty", ""];
  const last = attempt.at(-1)!;
  return last.stateAfter === "GAME_OVER" ? ["GAME_OVER", shortActionLabel(last)] : ["ended", String(last.stateAfter ?? "?")];
}
function attemptSummaries(prior: StepRecord[][]): string[] {
  const lines: string[] = [];
  let i = 0, idx = 1;
  while (i < prior.length) {
    let j = i;
    const key = attemptKey(prior[i]);
    while (j + 1 < prior.length && JSON.stringify(attemptKey(prior[j + 1])) === JSON.stringify(key)) j += 1;
    if (i === j) {
      const [a, b] = stepRange(prior[i]);
      lines.push(key[0] === "GAME_OVER"
        ? `Attempt ${idx} (steps ${a}-${b}, ${prior[i].length} steps): GAME_OVER after ${key[1]} at step ${b}.`
        : `Attempt ${idx} (steps ${a}-${b}, ${prior[i].length} steps): ended ${key[1]}.`);
    } else {
      const tries = j - i + 1, [a0] = stepRange(prior[i]), [, b1] = stepRange(prior[j]);
      lines.push(key[0] === "GAME_OVER"
        ? `Attempts ${idx}-${idx + tries - 1} (${tries} tries, steps ${a0}-${b1}): each GAME_OVER after ${key[1]}.`
        : `Attempts ${idx}-${idx + tries - 1} (${tries} tries, steps ${a0}-${b1}): each ended ${key[1]}.`);
    }
    idx += j - i + 1;
    i = j + 1;
  }
  return lines;
}
function attemptDetail(rows: StepRecord[], maxChars: number): string[] {
  if (!rows.length) return ["(no actions yet)"];
  const units: Array<[string, string, string, number, number, number]> = [];
  for (const row of rows) {
    const source = historySource(row), action = shortActionLabel(row), effect = renderEffect(row);
    const last = units.at(-1);
    if (last && last[0] === source && last[1] === action && last[2] === effect) { last[4] = row.step; last[5] += 1; }
    else units.push([source, action, effect, row.step, row.step, 1]);
  }
  const lines = units.map(([source, action, effect, a, b, count]) => count === 1
    ? `[${source}] step ${a}  ${action} → ${effect}`
    : `[${source}] steps ${a}-${b}  ${action} ×${count} → ${effect}${effect === "no change" && count >= 10 ? " (no progress — possible loop)" : ""}`);
  if (lines.join("\n").length > maxChars) {
    while (lines.length > 1 && lines.join("\n").length > maxChars) lines.shift();
    lines.unshift("… (earlier steps of this attempt elided) …");
  }
  return lines;
}

/** trajectory.render_recent_history: levels cleared, then the current level's attempts and its current attempt in detail. */
export function renderRecentHistory(records: StepRecord[], maxChars = HISTORY_MAX_CHARS): string {
  if (!records.length) return "No previous actions recorded.";
  const levels = groupLevels(records);
  const out: string[] = [];
  const prior = levels.slice(0, -1);
  if (prior.length) {
    const archive = prior.map(([score, rows]) => {
      const attempts = splitAttempts(rows), steps = attempts.reduce((n, a) => n + a.length, 0);
      return attempts.length > 1 ? `level ${score + 1} cleared in ${attempts.length} attempts / ${steps} steps` : `level ${score + 1} cleared in ${steps} steps`;
    });
    out.push(`Levels cleared: ${archive.join(", ")}.`, "");
  }
  const [score, rows] = levels.at(-1)!;
  const attempts = splitAttempts(rows);
  const first = attempts.flat()[0]?.step;
  out.push(`══ Level ${score + 1} — started at step ${first ?? "None"} ══`);
  const priorAttempts = attempts.slice(0, -1), current = attempts.at(-1) ?? [];
  out.push(...attemptSummaries(priorAttempts));
  if (priorAttempts.length) out.push(`Attempt ${priorAttempts.length + 1} — current (started step ${stepRange(current)[0]}):`);
  out.push(...attemptDetail(current, maxChars));
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------- actions

/** tools.TAKE_ACTIONS_TOOL, verbatim (this harness calls it arc_action). */
export const TAKE_ACTIONS_DESCRIPTION = "Advance the game by executing a list of actions in order. Each runs synchronously; if a step " +
  "becomes invalid mid-sequence (level transition, game ended), the remainder is skipped. Keep lists short (1-4, prefer 1).";
export const TAKE_ACTIONS_TEXT = {
  reasoning: "Why this sequence of actions is the right next step. Required.",
  actions: "Ordered list of actions. Each entry must include `name`; ACTION6 additionally requires `x` and `y` in 0-63.",
  name: "ARC GameAction name (ACTION1..ACTION6).",
  x: "X coordinate for ACTION6 (column).",
  y: "Y coordinate for ACTION6 (row).",
};
/** _dispatch_response's message for a take_actions call that played nothing. */
export const NOTHING_EXECUTED = "take_actions executed no actions; send a non-empty valid actions list using the currently available actions";

export type ActionStep = { action: string; x?: number; y?: number; position: number; raw: Record<string, unknown> };
export type RejectedStep = { raw: unknown; reason: string; position: number };
const INVALID_STEP = "unknown action name / not in available_actions / invalid args (ACTION6 needs x,y in 0..63)";
/** helpers._coerce_action_data: int(value), 0 when it is not a number, clamped to 0..63. */
export const clampCoordinate = (value: unknown) => {
  const number = typeof value === "boolean" ? Number(value) : typeof value === "string" && /^\s*[-+]?\d+\s*$/.test(value) ? Number(value)
    : typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(63, number));
};

/**
 * helpers.validate_action_sequence: each entry needs a name that is an offered action; the list is truncated at the first
 * entry that fails, and the rest is returned as rejected. Two deviations: RESET is the agent's here, so it is valid when
 * offered (CH's harness owns RESET), and ACTION6 without x and y fails, where CH clicks at (0,0).
 */
export function validateActionSequence(raw: unknown, available: string[]): { steps: ActionStep[]; rejected: RejectedStep[] } {
  const steps: ActionStep[] = [], rejected: RejectedStep[] = [];
  if (!Array.isArray(raw)) return { steps, rejected: [{ raw, reason: "actions must be a list", position: 0 }] };
  const offered = available.filter((name) => GAME_ACTIONS.includes(name));
  for (const [index, item] of raw.entries()) {
    const position = index + 1;
    if (!item || typeof item !== "object" || Array.isArray(item) || !("name" in item)) {
      rejected.push({ raw: item, reason: "missing 'name' field", position });
      break;
    }
    const entry = item as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.toUpperCase() : "";
    const clicks = name === "ACTION6";
    if (!offered.includes(name) || (clicks && (entry.x === undefined || entry.x === null || entry.y === undefined || entry.y === null))) {
      rejected.push({ raw: entry, reason: INVALID_STEP, position });
      break;
    }
    steps.push({ action: name, ...(clicks ? { x: clampCoordinate(entry.x), y: clampCoordinate(entry.y) } : {}), position, raw: entry });
  }
  return { steps, rejected };
}
