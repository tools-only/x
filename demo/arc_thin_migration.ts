/** Idempotent on-demand migration: never overwrites an agent's workspace file. */
import { existsSync } from 'node:fs';
import { Workspace } from './arc_thin_workspace.ts';

type OldSkill = { source: string; description: string; observe?: boolean };
export function migrateWorkspace(workspace: Workspace, data: { skills: Map<string, OldSkill>; overlay: string;
  notes: Map<string, { text: string }>; artifacts: Record<string, unknown> }) {
  const saved: string[] = [];
  const write = (path: string, source: string) => {
    if (existsSync(workspace.path(path))) return;
    workspace.runtimeWrite(path, source); saved.push(path);
  };
  for (const [name, skill] of data.skills) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    // Legacy code keeps its run(state,args) contract inside an ordinary typed tool adapter.
    const legacy = skill.source.replace(/^def run\(/m, 'def _legacy_run(');
    write(`tools/${name}.py`, `"""${skill.description.replace(/"""/g, '')}"""\n${legacy}\ndef run(args: dict = {}):\n    return _legacy_run(state, args)\n`);
    if (skill.observe !== false) write(`observers/${name}.py`, `${legacy}\ndef observe(state):\n    return _legacy_run(state, {})\n`);
  }
  if (data.overlay) write('prompts/overlay.md', `---\nactive: true\n---\n${data.overlay}\n`);
  for (const [key, note] of data.notes) if (/^[\w.-]+$/.test(key)) write(`notes/${key}.md`, note.text);
  for (const [name, value] of Object.entries(data.artifacts)) if (/^[\w.-]+$/.test(name)) write(`artifacts/${name}.json`, JSON.stringify(value) + '\n');
  return saved;
}
