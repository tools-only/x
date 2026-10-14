/** Confined backends for Pi file tools. No host path reaches an agent receipt. */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
  createGrepToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent';

/** A receipt line longer than this is a stub. A 64-cell grid row printed as a list is about 190 characters. */
export const LONG_LINE_CHARS = 400;
/** Lines over LONG_LINE_CHARS as one-line stubs: dumped data, kept out of view; the lines code printed as findings stay. */
export function stubLongLines(raw: string[]): { lines: string[]; stubs: number } {
  const lines = raw.map((line, i) => line.length > LONG_LINE_CHARS
    ? `[line ${i + 1}: ${line.length} chars not shown; starts ${JSON.stringify(line.slice(0, 80))}]` : line);
  return { lines, stubs: raw.filter(line => line.length > LONG_LINE_CHARS).length };
}
/** Only refinements write it, from checked hypotheses (docs/plans/2026-10-14-knowledge-promotion.md). */
export const REFINED_ONLY = 'prompts/rules.md';

export class Workspace {
  readonly root: string;
  private resultIndex: string;
  private inlineChars: number;
  onWrite?: (path: string) => Promise<string | undefined>;
  constructor(runRoot: string, options: { inlineChars?: number } = {}) {
    this.root = resolve(runRoot, 'workspace');
    this.inlineChars = options.inlineChars ?? 8000;
    if (!Number.isInteger(this.inlineChars) || this.inlineChars < 0) throw Error('invalid inline result threshold');
    const privateRoot = resolve(runRoot, '.harness'); mkdirSync(privateRoot, {recursive:true});
    this.resultIndex = join(privateRoot, 'result-index.jsonl');
    mkdirSync(this.root, { recursive: true });
    if (lstatSync(this.root).isSymbolicLink()) throw Error('workspace root cannot be a link');
    for (const dir of ['data/frames', 'notes', 'prompts', 'lib', 'tools', 'skills', 'agents', 'artifacts', 'results'])
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
    // pr-01 (2026-10-14): the agent used the rules prompt as a notebook and rewrote it each request, so promotions had
    // nowhere to go. Its rules come from its checked hypotheses; notes and plans have their own places.
    if (write && !runtime && rel.toLowerCase() === REFINED_ONLY) throw Error(`${REFINED_ONLY} is kept by refinements from your ` +
      'hypotheses whose checks hold; write plans and open questions to prompts/strategy.md, notes to notes/');
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
  runtimeWrite(path: string, content: string | Uint8Array) {
    const target = this.path(path, true, true); mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(this.path(path, true, true), content, 'utf8');
  }
  mutate(op: { op: string; path: string; content?: string; destination?: string }) {
    const source = this.path(op.path, true);
    if (source === this.root) throw Error('workspace root cannot be changed');
    if (op.op === 'write') this.runtimeWrite(op.path, op.content!);
    else if (op.op === 'delete') {
      if (!lstatSync(source).isFile()) throw Error('only workspace files can be removed');
      unlinkSync(source);
    } else if (op.op === 'move') {
      const target = this.path(op.destination!, true);
      if (target === this.root) throw Error('workspace root cannot be changed');
      mkdirSync(dirname(target), { recursive: true });
      renameSync(this.path(op.path, true), this.path(op.destination!, true));
    } else throw Error('invalid workspace mutation');
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
  saveResult(body: string): { ref: string; hash: string } {
    const hash = createHash('sha256').update(body).digest('hex');
    const records = new Map<string, string>(); const mapped = new Set<string>();
    if (existsSync(this.resultIndex)) for (const line of readFileSync(this.resultIndex, 'utf8').split('\n')) {
      try { const row = JSON.parse(line);
        if (/^[a-f0-9]{64}$/.test(row.hash) && /^results\/r\d+\.txt$/.test(row.ref)) {
          records.set(row.hash, row.ref); mapped.add(row.ref);
        }
      } catch { /* Torn index entries are repaired from immutable evidence. */ }
    }
    const old = `results/${hash}.txt`;
    if (existsSync(this.path(old)) && this.read(old) === body) return {ref:old, hash};
    const known = records.get(hash);
    if (known && existsSync(this.path(known)) && this.read(known) === body) return {ref:known, hash};
    const names = readdirSync(this.path('results')).filter(n => /^r\d+\.txt$/.test(n));
    let next = 1;
    for (const name of names) {
      next = Math.max(next, Number(name.slice(1, -4)) + 1);
      const ref = `results/${name}`;
      if (mapped.has(ref)) continue;
      const saved = this.read(ref), savedHash = createHash('sha256').update(saved).digest('hex');
      appendFileSync(this.resultIndex, '\n' + JSON.stringify({hash:savedHash, ref}) + '\n');
      if (savedHash === hash && saved === body) return {ref, hash};
    }
    while (true) {
      const ref = `results/r${String(next++).padStart(6, '0')}.txt`;
      try { writeFileSync(this.path(ref, true, true), body, {encoding:'utf8', flag:'wx'}); }
      catch (error) { if ((error as any).code === 'EEXIST') continue; throw error; }
      appendFileSync(this.resultIndex, '\n' + JSON.stringify({hash, ref}) + '\n');
      return {ref, hash};
    }
  }
  /**
   * A result too long to show whole: saved under results/ (or, with `source`, the file it was read from) and shown as a
   * preview. Lines longer than LONG_LINE_CHARS become one-line stubs first: a dumped grid or state dict on one line
   * otherwise used the whole preview and hid the short lines the code printed as its findings, and the agent then read
   * the file back whole (kernel-02, 2026-10-14). If what remains fits the inline threshold it is shown whole.
   */
  receipt(body: string, status = 'ok', keyLines: string[] = [], source?: string): string {
    if (body.length <= this.inlineChars) return body;
    const {hash, ref} = source ? {hash: createHash('sha256').update(body).digest('hex'), ref: source} : this.saveResult(body);
    const raw = body.split('\n');
    const keys = [...keyLines, ...raw.filter(s => /^(KEY:|\[key\])/.test(s))].join('\n').slice(0, 350);
    const { lines, stubs } = stubLongLines(raw);
    const readBack = `read ${ref} with offset/limit for exact lines${stubs ? ', or open it in python' : ''}.`;
    if (stubs && lines.join('\n').length <= this.inlineChars)
      return `Result ${status}; ${body.length} chars; ${lines.length} lines; sha256=${hash}\nPreview partial; ${stubs} long line${stubs === 1 ? '' : 's'} not shown, every other line whole:\n${lines.join('\n')}\n${keys ? keys + '\n' : ''}ref: ${ref}\n${readBack}`;
    const shown = new Map<number, string>();
    const sample = (indices: number[]) => {
      let room = 240;
      for (const i of indices) {
        if (shown.has(i)) continue;
        const value = lines[i];
        if (value.length + 1 > room) {
          if (!shown.has(i) && room === 240) shown.set(i, value.slice(0, 210) + ' [partial line]');
          break;
        }
        shown.set(i, value); room -= value.length + 1;
      }
    };
    sample(lines.map((_,i) => i)); sample(lines.map((_,i) => lines.length - 1 - i));
    const preview = [...shown].sort(([a],[b]) => a-b).map(([i,line]) => `L${i+1}: ${line}`).join('\n');
    const omitted = lines.map((_,i) => i+1).filter(n => !shown.has(n-1));
    const omittedText = omitted.length ? `omitted lines ${omitted[0]}–${omitted.at(-1)}` : 'partial lines marked above';
    return `Result ${status}; ${body.length} chars; ${lines.length} lines; sha256=${hash}\nPreview partial; ${omittedText}\n${preview}\n${keys ? keys + '\n' : ''}ref: ${ref}\n${readBack}`;
  }
  fileTools(): ToolDefinition[] {
    const safe = (p: string, write = false) => this.path(p, write, false, true);
    const readFile = async (p: string) => readFileSync(safe(p));
    const writeFile = async (p: string, content: string) => { writeFileSync(safe(p, true), content, 'utf8'); };
    const access = async (p: string) => { if (!existsSync(safe(p))) throw Error('workspace file does not exist'); };
    const tools: ToolDefinition[] = [
      createReadToolDefinition(this.root, { autoResizeImages: false, operations: { readFile, access,
        detectImageMimeType: async p => readFileSync(safe(p)).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : null } }),
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
          if (file.endsWith('.png')) continue;
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
