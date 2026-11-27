import { readFileSync } from 'node:fs';
import { COLOR_LEGEND } from './arc_layered_python.ts';
import type { LayeredEnvAdapter } from './layered_env_adapter.ts';

export const arcEnvAdapter: LayeredEnvAdapter = {
  systemPrompt(flags, maxActionsPerCall, harnessProfile) {
    const name = harnessProfile ? 'arc_layered_system_harness.md' : 'arc_layered_system.md';
    return readFileSync(new URL(`./prompts/${name}`, import.meta.url), 'utf8')
      .replace(/\{\{\?(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, flag, body) => flags[flag] ? body : '')
      .replaceAll('{{color_legend}}', COLOR_LEGEND)
      .replaceAll('{{max_actions_per_call}}', String(maxActionsPerCall));
  },
};
