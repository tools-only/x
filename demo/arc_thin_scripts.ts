/**
 * Scripts (docs/plans/2026-10-21-components-by-default-canonical-forms.md, S2; ARC_THIN_PERSIST_DEFS=1): the functions a python
 * cell defines at its top level are saved by the runtime as lib/<name>.py, one module each, through the same binder save path
 * as any file, so that later cells and saved components can `import lib.<name>` (arc_thin_components.ts resolves lib/*.py from
 * the sources it is given). Writing the analysis is persisting it: no save= decision, no namespace/saved split.
 *
 * A module is run in a namespace of its own, so a function is saved only when it is self-contained: everything it reads comes
 * from builtins, the names a module is given (state, grid, history, prev_grid, artifacts), an import (which the runtime writes
 * at the top of the module, found from the live session), or another script. A function that reads a value of the session
 * (OFFSET), env, show or anything defined outside it stays in the session and is said so once, with what to change: a script
 * that fails at its first call is worse than none. Planning is pure; the runtime writes the files.
 */
import type { CellDef } from './arc_thin_components.ts';

/** Names a script can have: lowercase, so lib/Snap.py and lib/snap.py cannot be two files on a case-insensitive disk. */
export const SCRIPT_NAME = /^[a-z_][a-z0-9_]{0,40}$/;
/** The second line of every script the runtime wrote: a file without it is the agent's own and is never replaced. */
export const SCRIPT_MARK = '# saved by the runtime from your python cell';
/** Scripts the runtime saves in one run; past it a new function is told so once and stays in the session. */
export const MAX_SCRIPTS = 40;
/** Scripts the HARNESS index describes one by one; the rest are listed by name. */
export const SCRIPT_LINES = 8;

export type ScriptWrite = { name: string; path: string; content: string };
export type ScriptPlan = { write: ScriptWrite[]; skipped: Array<{ name: string; why: string }>; unchanged: string[] };
/** What the plan needs to know of the workspace: the source of lib/<name>.py if there is one, and how many scripts there are. */
export type KnownScripts = { source(name: string): string | undefined; count: number };

/** The module a function is saved as: a description line, the runtime's mark, its imports, then its source. */
export function scriptSource(def: CellDef): string {
  const description = (def.doc || def.comment || `${def.name}${def.sig}`).replace(/\s+/g, ' ').trim().slice(0, 120);
  const imports = [...new Set([...def.imports, ...def.deps.map((name) => `from lib.${name} import ${name}`)])].sort();
  return [`# ${description}`, SCRIPT_MARK, ...imports, ...(imports.length ? [''] : []), def.source.replace(/\s+$/, '')].join('\n') + '\n';
}

/** Why a function cannot be a script by itself, or undefined. */
function ownProblem(def: CellDef): string | undefined {
  if (!SCRIPT_NAME.test(def.name)) return 'its name is not lowercase snake_case';
  if (def.decorated) return 'it has a decorator';
  if (def.asynchronous) return 'it is async';
  if (def.assigns_global) return 'it assigns a global';
  if (def.needs.length) return `it uses ${def.needs.join(', ')}, defined outside it (define it inside, or pass it in)`;
  return undefined;
}

/**
 * Which of a cell's functions to write as scripts. A function whose calls into the session are all scripts (an earlier one, or
 * one of this cell's that is) is one; the rest are skipped with the reason. The last definition of a name stands. A file that is
 * not the runtime's own is not replaced, one that would not change is left alone, and one that would import a script that
 * already imports it (a cycle at import time) is skipped.
 */
export function planScripts(defs: CellDef[], known: KnownScripts): ScriptPlan {
  const byName = new Map<string, CellDef>();
  for (const def of defs) byName.set(def.name, def);
  const plan: ScriptPlan = { write: [], skipped: [], unchanged: [] };
  const problems = new Map<string, string>();
  for (const def of byName.values()) { const why = ownProblem(def); if (why) problems.set(def.name, why); }
  const ready = new Set<string>();
  const exists = (name: string) => !byName.has(name) && known.source(name) !== undefined;
  for (let changed = true; changed;) {
    changed = false;
    for (const def of byName.values()) {
      if (ready.has(def.name) || problems.has(def.name)) continue;
      if (def.deps.every((name) => ready.has(name) || exists(name))) { ready.add(def.name); changed = true; }
    }
  }
  let added = 0;
  for (const def of byName.values()) {
    const path = `lib/${def.name}.py`, old = known.source(def.name);
    const skip = (why: string) => plan.skipped.push({ name: def.name, why });
    if (!ready.has(def.name)) {
      const open = def.deps.filter((name) => !ready.has(name) && !exists(name));
      skip(problems.get(def.name) ?? `it calls ${open.join(', ')}, which ${open.length === 1 ? 'is' : 'are'} not saved as ${open.length === 1 ? 'a script' : 'scripts'}`);
      continue;
    }
    if (old !== undefined && !old.includes(SCRIPT_MARK)) { skip(`${path} is your own file and is not replaced`); continue; }
    const content = scriptSource(def);
    if (old === content) { plan.unchanged.push(def.name); continue; }
    const importsIt = def.deps.filter((name) => !byName.has(name)).find((name) =>
      new RegExp(`^\\s*(?:from\\s+lib\\.${def.name}\\s+import|import\\s+lib\\.${def.name}\\b)`, 'm').test(known.source(name) ?? ''));
    if (importsIt) { skip(`lib/${importsIt}.py already imports it, so each would import the other`); continue; }
    if (old === undefined && known.count + added >= MAX_SCRIPTS) { skip(`the limit of ${MAX_SCRIPTS} scripts is reached`); continue; }
    if (old === undefined) added += 1;
    plan.write.push({ name: def.name, path, content });
  }
  return plan;
}

const IMPORT = /^[ \t]*(?:from[ \t]+lib\.(\w+)[ \t]+import|import[ \t]+lib\.(\w+)|from[ \t]+lib[ \t]+import[ \t]+([\w, \t]+))/gm;

/**
 * The scripts a cell uses: `imported` through a statement (from lib.x import …, import lib.x, from lib import x) and `named`
 * by a name the session already held (the guest's `uses`), as adoption of what was saved. Only names that are scripts count.
 */
export function scriptsUsed(code: string, uses: string[], scripts: Set<string>): { imported: string[]; named: string[] } {
  const imported = new Set<string>();
  for (const match of code.matchAll(IMPORT)) {
    for (const name of match[1] ? [match[1]] : match[2] ? [match[2]] : (match[3] ?? '').split(/[\s,]+/).filter(Boolean)) if (scripts.has(name)) imported.add(name);
  }
  return { imported: [...imported].sort(), named: uses.filter((name) => scripts.has(name) && !imported.has(name)).sort() };
}

/** `(a, b)` of a saved script's `def name(a, b):` line, for the index; empty when it cannot be read. */
export function scriptSignature(source: string, name: string): string {
  return new RegExp(`^def\\s+${name}\\s*(\\([^)]*\\))`, 'm').exec(source)?.[1]?.replace(/\s+/g, ' ') ?? '';
}
