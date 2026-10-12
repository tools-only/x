/** Confined backends for Pi file tools. No host path reaches an agent receipt. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
  createGrepToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent';

export class Workspace {
  readonly root: string;
  onWrite?: (path: string) => Promise<string | undefined>;
  constructor(runRoot: string) {
    this.root = resolve(runRoot, 'workspace');
    mkdirSync(this.root, { recursive: true });
    if (lstatSync(this.root).isSymbolicLink()) throw Error('workspace root cannot be a link');
    for (const dir of ['data/frames', 'notes', 'prompts', 'lib', 'tools', 'observers', 'skills', 'roles', 'artifacts', 'results'])
      mkdirSync(this.path(dir, true, true), { recursive: true });
  }
  /** Also called by operations with Pi-resolved paths; callers must prevalidate raw arguments. */
  path(raw: string, write = false, runtime = false, resolved = false): string {
    const clean = resolved ? relative(this.root, raw).replace(/\\/g, '/') : raw.replace(/\\/g, '/');
    if ((!resolved && (isAbsolute(raw) || /^\w:|^\//.test(clean))) || clean.includes(':') ||
      clean.split('/').some(p => p === '..' || p.startsWith('.') && p !== '.') || clean.includes('\0'))
      throw Error('invalid workspace path');
    const target = resolve(this.root, clean);
    const rel = relative(this.root, target).replace(/\\/g, '/');
    if (rel.startsWith('../') || isAbsolute(rel)) throw Error('path leaves workspace');
    if (write && !runtime && /^(data|results)(\/|$)/i.test(rel)) throw Error('workspace data/ and results/ are read-only');
    let cursor = this.root;
    for (const part of rel.split('/').filter(Boolean)) {
      cursor = join(cursor, part);
      if (existsSync(cursor) || (() => { try { lstatSync(cursor); return true; } catch { return false; } })()) {
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw Error('workspace links and junctions are refused');
        const physical = relative(realpathSync(this.root), realpathSync(cursor));
        if (physical.startsWith('..') || isAbsolute(physical)) throw Error('path leaves workspace');
      }
    }
    return target;
  }
  runtimeWrite(path: string, content: string) {
    const target = this.path(path, true, true); mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(this.path(path, true, true), content, 'utf8');
  }
  files(path = '.'): string[] {
    const target = this.path(path);
    if (!lstatSync(target).isDirectory()) return [relative(this.root, target).replace(/\\/g, '/')];
    const out: string[] = [];
    for (const name of readdirSync(target).sort()) {
      if (name.startsWith('.')) continue;
      const rel = relative(this.root, join(target, name)).replace(/\\/g, '/');
      try { this.path(rel); } catch { continue; }
      out.push(...this.files(rel));
    }
    return out;
  }
  read(path: string): string { return readFileSync(this.path(path), 'utf8'); }
  fileTools(): ToolDefinition[] {
    const safe = (p: string, write = false) => this.path(p, write, false, true);
    const readFile = async (p: string) => readFileSync(safe(p));
    const writeFile = async (p: string, content: string) => { writeFileSync(safe(p, true), content, 'utf8'); };
    const access = async (p: string) => { if (!existsSync(safe(p))) throw Error('workspace file does not exist'); };
    const tools: ToolDefinition[] = [
      createReadToolDefinition(this.root, { operations: { readFile, access, detectImageMimeType: async () => null } }),
      createWriteToolDefinition(this.root, { operations: { writeFile, mkdir: async p => { mkdirSync(safe(p, true), { recursive: true }); } } }),
      createEditToolDefinition(this.root, { operations: { readFile, writeFile, access: async p => { safe(p, true); await access(p); } } }),
      createLsToolDefinition(this.root, { operations: { exists: p => existsSync(safe(p)), stat: p => lstatSync(safe(p)),
        readdir: p => readdirSync(safe(p)).filter(n => !n.startsWith('.')) } }),
      // Pi 0.87 grep's custom backend still spawns rg outside the backend. Keep its schema; replace traversal.
      { ...createGrepToolDefinition(this.root), execute: async (_id, args: any) => {
        const pattern = args.literal ? args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : args.pattern;
        const regex = new RegExp(pattern, args.ignoreCase ? 'i' : '');
        const glob = args.glob ? new RegExp('^' + args.glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null;
        const found: string[] = []; const limit = Math.min(1000, Math.max(1, args.limit ?? 100));
        for (const file of this.files(args.path ?? '.')) {
          if (glob && !glob.test(file) && !glob.test(file.split('/').at(-1)!)) continue;
          const lines = this.read(file).split('\n');
          for (let n = 0; n < lines.length && found.length < limit; n++) if (regex.test(lines[n])) {
            const context = Math.min(20, Math.max(0, args.context ?? 0));
            for (let k = Math.max(0, n - context); k <= Math.min(lines.length - 1, n + context); k++)
              found.push(`${file}:${k + 1}:${lines[k]}`);
          }
          if (found.length >= limit) break;
        }
        return { content: [{ type: 'text', text: found.join('\n') || '(no matches)' }] };
      } }
    ];
    return tools.map(tool => ({ ...tool, execute: async (id, args: any, signal, update, ctx) => {
      this.path(args.path ?? '.', tool.name === 'write' || tool.name === 'edit');
      const result = await tool.execute(id, args, signal, update, { ...ctx, cwd: this.root } as any);
      if ((tool.name === 'write' || tool.name === 'edit') && !result.isError) {
        const receipt = await this.onWrite?.(args.path.replace(/\\/g, '/'));
        if (receipt) return { ...result, content: [{ type: 'text', text: receipt }] };
      }
      return result;
    } }));
  }
}
