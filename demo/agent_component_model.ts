import { createRequire } from 'node:module';

export type ComponentSpec = { kind: string; name: string; description: string; enabled: boolean;
  parameters?: any; body?: string; tools?: string[]; refs?: string[]; view?: boolean; predictor?: boolean; guard?: boolean;
  mount?: Array<'decision' | 'action' | 'feedback'>; program?: boolean; tags?: string[] };
export type Component = ComponentSpec & { path: string; version: number; hash: string; source: string; level: number };
export type Validator = (path: string, source: string) => Promise<ComponentSpec>;

const requirePi = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const { parseDocument } = requirePi('yaml');

/** Addressable objects in the Agent's writable self view. */
export function componentKind(path: string): string | undefined {
  if (path.split('/').includes('_off')) return;
  if (/^(tools|observers)\/[^/]+\.py$/.test(path)) return 'tool';
  if (/^lib\/[^/]+\.py$/.test(path)) return 'library';
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) return 'skill';
  if (/^prompts\/process\/[^/]+\.md$/.test(path)) return 'prompt';
  if (/^prompts\/[^/]+\.md$/.test(path)) return 'prompt';
  if (/^(agents|roles)\/[^/]+\.md$/.test(path)) return 'subagent';
  if (/^notes\/memory\/[^/]+\.md$/.test(path) || path === 'notes/memory.md') return 'memory';
  if (/^processes\/[^/]+\.json$/.test(path)) return 'process';
}

export function markdownSpec(path: string, source: string): ComponentSpec {
  const kind = componentKind(path)!;
  const name = kind === 'skill' ? path.split('/')[1]
    : `${path.startsWith('prompts/process/') ? 'process_' : ''}${path.split('/').at(-1)!.replace(/\.md$/, '')}`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  let header: Record<string, any> = {}; let body = source;
  if (match) {
    body = match[2];
    const doc = parseDocument(match[1]);
    if (doc.errors.length) throw Error(doc.errors.map((e: Error) => e.message).join('; '));
    const parsed = doc.toJS({ maxAliasCount: 20 });
    if (parsed === null || parsed === undefined) header = {};
    else if (typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('frontmatter must be a mapping');
    else header = parsed;
  }
  if (kind === 'prompt' && header.active !== undefined && ![true, false].includes(header.active)) throw Error('prompt active must be true or false');
  const description = String(header.description ?? body.split(/\r?\n/).find(s => s.trim()) ?? '').slice(0, 120);
  if (kind === 'skill' && header.name && header.name !== name) throw Error('skill name must match its address');
  if (kind === 'subagent' && Array.isArray(header.tools) && header.tools.some((t: string) => t === 'arc_action'))
    throw Error('a subagent cannot take environment actions');
  return { kind, name, description, enabled: kind !== 'prompt' || header.active !== false, body, tools: header.tools, refs: header.refs };
}
