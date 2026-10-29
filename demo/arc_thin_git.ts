/** A deliberately small, run-scoped Git interface. It never accepts shell text. */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Type } from 'typebox';
import type { Workspace } from './arc_thin_workspace.ts';

const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = 10_000;
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function runGit(workspace: Workspace, args: string[], maxOutput = MAX_OUTPUT): Promise<string> {
  const root = workspace.root;
  if (lstatSync(root).isSymbolicLink()) throw Error('workspace root cannot be a link');
  const gitDir = join(root, '.git');
  if (existsSync(gitDir)) {
    const stat = lstatSync(gitDir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(gitDir) !== resolve(gitDir))
      throw Error('.git must be a real directory inside the workspace');
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat', PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_NAME: 'ARC workspace agent', GIT_AUTHOR_EMAIL: 'arc-workspace@invalid',
    GIT_COMMITTER_NAME: 'ARC workspace agent', GIT_COMMITTER_EMAIL: 'arc-workspace@invalid',
    GIT_CONFIG_COUNT: '5', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: 'NUL',
    GIT_CONFIG_KEY_1: 'core.pager', GIT_CONFIG_VALUE_1: 'cat',
    GIT_CONFIG_KEY_2: 'core.attributesFile', GIT_CONFIG_VALUE_2: 'NUL',
    GIT_CONFIG_KEY_3: 'diff.external', GIT_CONFIG_VALUE_3: '',
    GIT_CONFIG_KEY_4: 'core.quotePath', GIT_CONFIG_VALUE_4: 'true',
  });
  if (args[0] === 'init') mkdirSync(root, { recursive: true });
  return new Promise((resolvePromise, reject) => {
    const child = spawn(GIT, ['--no-pager', '--git-dir', gitDir, '--work-tree', root, ...args], {
      cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', total = 0, settled = false;
    const timer = setTimeout(() => { child.kill(); finish(Error('git timed out')); }, TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolvePromise(stdout + (stderr ? `\n${stderr}` : ''));
    };
    for (const [stream, target] of [[child.stdout, 'out'], [child.stderr, 'err']] as const) stream.on('data', chunk => {
      total += chunk.length;
      if (total > maxOutput) { child.kill(); finish(Error('git output exceeded limit')); return; }
      if (target === 'out') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    });
    child.on('error', error => finish(error));
    child.on('close', code => code === 0 ? finish() : finish(Error((stderr || `git exited ${code}`).slice(0, 4000))));
  });
}

export function gitTool(workspace: Workspace) {
  return {
    name: 'git', label: 'Git',
    description: 'Manage a small local history of selected workspace files. No remote, branch, or shell access. Explicitly initialize and commit only when useful.',
    parameters: Type.Object({
      op: Type.Union(['init','status','add','commit','log','diff'].map(v => Type.Literal(v))),
      paths: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
      message: Type.Optional(Type.String({ maxLength: 200 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      cached: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, input: any) {
      try {
        const { op } = input;
        const gitDir = join(workspace.root, '.git');
        if (op !== 'init' && !existsSync(gitDir)) {
          if (op === 'status') return { content: [{ type: 'text', text: 'No run workspace repository; call git init if needed.' }] };
          throw Error('repository is not initialized; call git init first');
        }
        let args: string[];
        if (op === 'init') {
          if (existsSync(gitDir)) throw Error('repository already exists; init is allowed only once');
          args = ['init', '--quiet'];
        } else if (op === 'status') args = ['status', '--short', '--untracked-files=all'];
        else if (op === 'add') {
          if (!Array.isArray(input.paths) || input.paths.length < 1) throw Error('add requires specific paths');
          const paths = input.paths.map((path: string) => {
            if (typeof path !== 'string' || path === '.' || path.startsWith('-') || /[*?{}\[\]]/.test(path) || path.split(/[\\/]/).some(p => !p || p === '.' || p === '..') || isAbsolute(path)) throw Error(`invalid add path: ${path}`);
            const normalized = path.replace(/\\/g, '/');
            workspace.path(normalized, true);
            if (/^(data|results)(\/|$)/i.test(normalized)) throw Error(`read-only workspace path: ${normalized}`);
            return normalized;
          });
          args = ['add', '--', ...paths];
        } else if (op === 'commit') {
          if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 200 || /[\r\n\0]/.test(input.message)) throw Error('commit requires a one-line summary (1-200 chars)');
          args = ['commit', '--no-verify', '-m', input.message.trim()];
        } else if (op === 'log') args = ['log', '-n', String(input.limit ?? 5), '--oneline'];
        else if (op === 'diff') args = ['diff', ...(input.cached ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--'];
        else throw Error('unsupported git operation');
        const output = await runGit(workspace, args, op === 'diff' ? 32 * 1024 : MAX_OUTPUT);
        if (op === 'init') return { content: [{ type: 'text', text: 'Initialized run workspace repository.' }] };
        if (op === 'commit' || op === 'log') {
          const detail = await runGit(workspace, ['show', '--format=%H%n%s', '--name-only', '--no-renames', 'HEAD']);
          return { content: [{ type: 'text', text: [output, 'Latest commit:', detail].filter(Boolean).join('\n') }] };
        }
        return { content: [{ type: 'text', text: output || '(no changes)' }] };
      } catch (error) { return { content: [{ type: 'text', text: `Git refused: ${error instanceof Error ? error.message : String(error)}` }], isError: true }; }
    },
  };
}
