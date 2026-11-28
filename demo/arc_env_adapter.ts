import { readFileSync } from 'node:fs';
import { COLOR_LEGEND } from './arc_layered_python.ts';
import type { LayeredEnvAdapter, LoopSignals } from './layered_env_adapter.ts';

type ArcLoopState = {
  batch?: { steps?: Array<{ new?: boolean; death?: boolean }>; executed?: number; surprise?: boolean; level_changed?: boolean; game_over?: boolean } | null;
  state?: string;
  budget_left?: number;
  level_budget_left?: number;
};

export const arcEnvAdapter: LayeredEnvAdapter = {
  systemPrompt(flags, maxActionsPerCall, harnessProfile) {
    const name = harnessProfile ? 'arc_layered_system_harness.md' : 'arc_layered_system.md';
    return readFileSync(new URL(`./prompts/${name}`, import.meta.url), 'utf8')
      .replace(/\{\{\?(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, flag, body) => flags[flag] ? body : '')
      .replaceAll('{{color_legend}}', COLOR_LEGEND)
      .replaceAll('{{max_actions_per_call}}', String(maxActionsPerCall));
  },
  loopSignals(state) {
    const s = (state ?? {}) as ArcLoopState;
    const steps = s.batch?.steps ?? [];
    const executed = s.batch?.executed ?? steps.length;
    return {
      executed,
      new_states: steps.filter(step => Boolean(step?.new)).length,
      failures: steps.filter(step => Boolean(step?.death)).length,
      surprises: s.batch?.surprise ? 1 : 0,
      completed: Boolean(s.batch?.level_changed) || s.state === "WIN",
      budget_exhausted: (s.budget_left ?? 1) === 0 || (s.level_budget_left ?? 1) === 0,
      time_exhausted: false,
      facts: [],
    } satisfies LoopSignals;
  },
};
