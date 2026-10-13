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

export function observationReference(value: any, n: number): string {
  const snapshot = publicObservation(value, n), grid = snapshot.frames.at(-1);
  if (!grid?.length) return 'CURRENT STATE: unavailable — do not act on remembered grids.';
  return `CURRENT STATE #${n}: ${snapshot.state}; levels_completed=${snapshot.levels_completed}; ` +
    `available_actions=${JSON.stringify(snapshot.available_actions)}; action_budget=${JSON.stringify(snapshot.action_budget)}\n` +
    `Grid ${grid.length}×${grid[0].length}; animation_frames=${snapshot.frames.length}; grid_sha256=${snapshot.grid_sha256}\n` +
    `Exact data: data/observations/${n}.json (all frames and image refs); data/frames/${n}.json (latest grid); ` +
    `data/frames/${n}.png (latest image). Python: grid, prev_grid, state['frames'], history.grid(n).`;
}
