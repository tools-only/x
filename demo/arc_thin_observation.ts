/** Raw ARC data lives in the workspace/guest, not the default model working set. */
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Workspace } from './arc_thin_workspace.ts';
import { renderArcFrameImage } from './pi_arc_frame_image.ts';

export function publicObservation(value: any, n: number) {
  const frames: number[][][] = value?.frames ?? [];
  const frame_images = frames.map((_, i) => i === frames.length - 1
    ? `data/frames/${n}.png` : `data/observations/${n}-frame-${i}.png`);
  return { n, state: value?.state ?? null, levels_completed: value?.levels_completed ?? 0,
    available_actions: value?.agent_available_actions ?? value?.available_actions ?? [],
    action_budget: value?.action_budget ?? null, frames, frame_images,
    grid_sha256: frames.length ? createHash('sha256').update(JSON.stringify(frames.at(-1))).digest('hex') : null };
}

export function storeObservation(workspace: Workspace, value: any, n: number) {
  const snapshot = publicObservation(value, n);
  // A refresh with no frame must not advertise an old current grid. Exact past snapshots remain available.
  workspace.runtimeWrite('data/current.json', JSON.stringify({ ...snapshot, grid: snapshot.frames.at(-1) ?? null }) + '\n');
  if (!snapshot.frames.length) return;
  const ref = `data/observations/${n}.json`;
  if (existsSync(workspace.path(ref))) return; // canonical action index; avoid re-rendering on every query/refresh
  for (let i = 0; i < snapshot.frames.length; i++) {
    const png = renderArcFrameImage({ frames: [snapshot.frames[i]] }, ref);
    workspace.runtimeWrite(snapshot.frame_images[i], Buffer.from(png.content.data, 'base64'));
  }
  workspace.runtimeWrite(ref, JSON.stringify(snapshot) + '\n');
}

/**
 * A grid as row runs: per row the x ranges and their color, the most common color left out, equal consecutive rows
 * merged ("y8-12: 32-40:3"). Lossless, and about a tenth of the tokens of digit rows for a tokenizer that splits
 * digits (Qwen: one token per cell). Coordinates are written out, so nothing has to be counted by eye. The python
 * helper show() in arc_thin_components.ts prints the same format.
 */
export function gridRuns(grid: number[][], limit = 6000): string {
  const counts = new Map<number, number>();
  for (const row of grid) for (const v of row) counts.set(v, (counts.get(v) ?? 0) + 1);
  const bg = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const rowText = (row: number[]) => {
    const out: string[] = [];
    for (let x = 0, start = 0; x <= row.length; x++) {
      if (x < row.length && row[x] === row[start]) continue;
      if (row[start] !== bg) out.push(x - 1 === start ? `${start}:${row[start]}` : `${start}-${x - 1}:${row[start]}`);
      start = x;
    }
    return out.join(' ');
  };
  const groups: Array<{ from: number; to: number; text: string }> = [];
  grid.forEach((row, y) => {
    const text = rowText(row), last = groups.at(-1);
    if (last && last.text === text && last.to === y - 1) last.to = y; else groups.push({ from: y, to: y, text });
  });
  const lines = groups.filter((g) => g.text).map((g) => `y${g.from}${g.to > g.from ? `-${g.to}` : ''}: ${g.text}`);
  const head = `Grid ${grid.length}×${grid[0]?.length ?? 0} as row runs (x ranges inclusive, then the color; background ${bg} not listed; ` +
    'rows not listed are all background):';
  const body = [head, ...lines].join('\n');
  return body.length <= limit ? body : `${head}\n(${lines.length} row groups, ${body.length} characters: too varied to show here; use show() in python)`;
}

export function observationReference(value: any, n: number): string {
  const snapshot = publicObservation(value, n), grid = snapshot.frames.at(-1);
  if (!grid?.length) return 'CURRENT STATE: unavailable — do not act on remembered grids.';
  return `CURRENT STATE #${n}: ${snapshot.state}; levels_completed=${snapshot.levels_completed}; ` +
    `available_actions=${JSON.stringify(snapshot.available_actions)}; action_budget=${JSON.stringify(snapshot.action_budget)}\n` +
    `${gridRuns(grid)}\n` +
    `animation_frames=${snapshot.frames.length}; grid_sha256=${snapshot.grid_sha256}. ` +
    `Exact data: data/observations/${n}.json (all frames and image refs); data/frames/${n}.json (latest grid); ` +
    `data/frames/${n}.png (latest image). Python: grid, prev_grid, state['frames'], history.grid(n), show().`;
}
