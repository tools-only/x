/**
 * Reuse facts for the native self-harness. Reasoning spent re-deriving or retyping a computation that recurs is the
 * cost the harness exists to remove; these functions find it in the agent's own python calls:
 *   - which calls redo one computation (same code up to numbers, or mostly the same lines);
 *   - whether a saved component already covers that computation;
 *   - whether the rebuilding went on after it was pointed out (an adoption gap, investigated once).
 * Facts only: whether to reuse, codify or leave a one-off computation alone is the agent's decision.
 */
import { createHash } from 'node:crypto';

export type CodeShape = { shape: string; lines: string[]; struct: string[]; gist: string };

const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else except finally for from global ' +
  'if import in is lambda nonlocal not or pass raise return try while with yield').split(' '));
/**
 * A line's structure: numbers and plain variable names become `_`; calls, attributes, keywords and strings stay. A
 * tool that takes as parameters what a python call hard-coded (history.grid(1) vs history.grid(x)) has the same
 * structure, which is how a saved component is matched with the calls it can replace.
 */
const structure = (line: string) => line.replace(/\b\d+(\.\d+)?\b/g, '_')
  .replace(/(?<![.\w'"])([A-Za-z_]\w*)\b(?!\s*\()/g, (name) => KEYWORDS.has(name) ? name : '_').replace(/\s+/g, ' ');

/**
 * A python call's code with comments, blank lines and number literals normalised, so calls that differ only in
 * numbers (history.grid(1) vs history.grid(2)) share a shape. `lines` are hashes of the normalised lines, for
 * calls that share most of their code; `struct` hashes each line's structure, for comparing with a component.
 */
export function codeShape(code: string): CodeShape {
  const raw = code.split(/\r?\n/).map(line => line.replace(/(^|\s)#.*$/, '').trim()).filter(Boolean);
  // Renaming a helper alone does not make its implementation new work.
  const norm = raw.map(line => line.replace(/^(async\s+)?def\s+[A-Za-z_]\w*(?=\s*\()/, '$1def _')
    .replace(/\b\d+(\.\d+)?\b/g, '0').replace(/\s+/g, ' '));
  const hash = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n);
  const gist = raw.find(line => !/^(import|from)\s/.test(line)) ?? raw[0] ?? '';
  return { shape: hash(norm.join('\n'), 12), lines: [...new Set(norm.map(line => hash(line, 8)))],
    struct: [...new Set(raw.filter(line => !/^(import|from|def|return|""")/.test(line)).map(line => hash(structure(line), 8)))],
    gist: gist.length > 60 ? gist.slice(0, 59) + '…' : gist };
}

export type PythonRun = CodeShape & { level: number; kit: string; decision?: number; n?: number; code?: string; ok?: boolean; used?: string[] };
/** A saved component's line structures. */
export type ComponentLines = { path: string; lines: Set<string> };
export const componentLines = (path: string, source: string): ComponentLines => ({ path, lines: new Set(codeShape(source).struct) });

/** The saved tools, observers and libraries (path@version): repetition is counted only since this last changed. */
export const kitOf = (versions: Record<string, number>) =>
  Object.entries(versions).filter(([path]) => /^(tools|observers|lib)\//.test(path)).map(([path, v]) => `${path}@${v}`).sort().join(',');

export type Family = { key: string; gist: string; runs: PythonRun[]; lines: Set<string>; covered?: string };

function overlap(a: Set<string>, b: string[]): number {
  const shared = b.filter(line => a.has(line)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

/**
 * Calls grouped by computation; a family's key is its first call's shape. A component covers a family when its
 * source has the structure of at least half of the family's lines (numbers and variable names aside), so a tool
 * that turned the call's constants into parameters is credited and an unrelated one is not.
 */
export function families(runs: PythonRun[], components: ComponentLines[] = []): Family[] {
  const out: Family[] = [];
  for (const run of runs) {
    const family = out.find(f => f.key === run.shape || f.runs.some(r => r.shape === run.shape) || overlap(f.lines, run.lines) >= 0.6);
    if (family) family.runs.push(run);
    else out.push({ key: run.shape, gist: run.gist, runs: [run], lines: new Set(run.lines) });
  }
  for (const family of out) {
    const lines = family.runs[0].struct ?? [];
    if (!lines.length) continue;
    const best = components.map(c => ({ path: c.path, matched: lines.filter(line => c.lines.has(line)).length }))
      .sort((a, b) => b.matched - a.matched)[0];
    // Half of the family's lines, and at least two: one generic line (`_ = _`) is not a match.
    if (best && best.matched >= Math.max(Math.min(2, lines.length), lines.length / 2)) family.covered = best.path;
  }
  return out;
}

const REPETITION_WINDOW = 12;

/**
 * The families repeated among the last calls, for the agent's working set. `runs` are one level's calls since the
 * saved tools/observers/libraries last changed.
 */
export function repeatedFamilies(runs: PythonRun[], components: ComponentLines[] = []): Array<Family & { recent: number }> {
  const window = new Set(runs.slice(-REPETITION_WINDOW));
  return families(runs, components).map(f => ({ ...f, recent: f.runs.filter(r => window.has(r)).length }))
    .filter(f => f.recent > 1).sort((a, b) => b.recent - a.recent);
}

export function repetitionText(runs: PythonRun[], components: ComponentLines[] = []): string {
  const repeated = repeatedFamilies(runs, components);
  if (!repeated.length) return '';
  const recent = Math.min(runs.length, REPETITION_WINDOW);
  const redone = repeated.reduce((n, f) => n + f.recent - 1, 0);
  return `REPEATED WORK: ${redone} of your last ${recent} python calls on this level redid one computation ` +
    `(${repeated.slice(0, 3).map(f => `\`${f.gist}\` ×${f.recent}${f.covered ? `, ${f.covered} already covers it` : ''}`).join('; ')}). ` +
    `Saved once as a tool or observer, it runs exactly every time and leaves your reasoning for what is new.`;
}

/** Rebuilt in at least two later decisions, at least twice, after the agent was shown the repetition. */
export const GAP_MIN_CALLS = 2;

/**
 * The saved component that already computes what the latest call retyped, when that computation has now been typed at
 * least twice: the point at which saying so once, in the call's own result, saves the next retyping.
 */
export function coveringComponent(runs: PythonRun[], components: ComponentLines[]): string | undefined {
  const latest = runs.at(-1);
  if (!latest) return undefined;
  const family = families(runs, components).find(f => f.runs.includes(latest));
  return family && family.runs.length >= 2 ? family.covered : undefined;
}

export type AdoptionGap = { key: string; shapes: string[]; gist: string; shownAt: number; after: PythonRun[]; total: number; covered?: string };

/**
 * Families that kept being rebuilt after they were shown. `shown` maps a shape to the decision REPEATED WORK first
 * named its family; a family counts as shown from the earliest of its shapes, and as investigated once any is.
 */
export function adoptionGaps(runs: PythonRun[], components: ComponentLines[], shown: Map<string, number>, investigated: Set<string>): AdoptionGap[] {
  const gaps: AdoptionGap[] = [];
  for (const family of families(runs, components)) {
    const shapes = [...new Set(family.runs.map(r => r.shape))];
    if (shapes.some(s => investigated.has(s))) continue;
    const shownAt = Math.min(...shapes.filter(s => shown.has(s)).map(s => shown.get(s)!));
    if (!Number.isFinite(shownAt)) continue;
    const after = family.runs.filter(r => (r.decision ?? 0) > shownAt);
    if (after.length < GAP_MIN_CALLS || new Set(after.map(r => r.decision)).size < 2) continue;
    gaps.push({ key: family.key, shapes, gist: family.gist, shownAt, after, total: family.runs.length, covered: family.covered });
  }
  return gaps;
}

/**
 * The adoption-gap investigation's question. It goes to an independent side call on the agent's model, which sees
 * the repeated code, the saved components and the mechanical finding, never the agent's reasoning.
 */
export const ADOPTION_SYSTEM = 'You review why an agent keeps rebuilding the same computation instead of reusing or saving a component. ' +
  'The agent plays an ARC-AGI-3 game and can save python components: tools/<name>.py (one typed run(...) callable as a tool), ' +
  'observers/<name>.py (observe(state) runs on every new state; its output is shown each decision) and lib/<name>.py (importable). ' +
  'You see the repeated code, what is saved, and a mechanical finding. Reply with at most 3 lines, each exactly: cause | evidence | smallest change. ' +
  'cause is one of: varies (the computation genuinely differs each time, so no component is needed), missing (nothing saved does it), ' +
  'uncovered (a component exists but lacks what these calls do), friction (a component fits but calling it is harder than retyping), ' +
  'unnoticed (a fitting component exists and was not used), stale (a component is wrong or out of date). ' +
  'evidence quotes the code briefly. smallest change names the file and signature to add or change, or none. No other text.';

export const ADOPTION_CAUSES = ['varies', 'missing', 'uncovered', 'friction', 'unnoticed', 'stale'];

/**
 * Sentences of reasoning text, and how many locate cells or coordinates ((34,15), x34-38, row 12, c04-13, r20).
 * A text heuristic: in the foundation-native ls20 run about 29% of reasoning sentences matched, and a reuse report
 * found only 2 of 21 python calls repeated, so most re-derivation happened in reasoning, not in code.
 */
const COORDINATES = /\(\s*\d+\s*,\s*\d+\s*\)|\b[xy]\s*=\s*\d+|\b[xy]\d+\s*[-–]\s*\d+|\brows?\s+\d+|\bcol(?:umn)?s?\s+\d+|\bc\d{2}-\d{2}|\br\d{2}\b/i;
export function coordinateSentences(text: string): { sentences: number; coordinate: number } {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
  return { sentences: sentences.length, coordinate: sentences.filter(s => COORDINATES.test(s)).length };
}

export function parseAdoptionReply(text: string): { lines: string[]; dropped: string[] } {
  const lines: string[] = [], dropped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•>]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    const fields = line.split('|').map(f => f.trim());
    const cause = fields[0]?.toLowerCase().replace(/^cause\s*:\s*/, '');
    if (fields.length < 3 || !ADOPTION_CAUSES.includes(cause) || lines.length >= 3) { dropped.push(line.slice(0, 300)); continue; }
    lines.push(`${cause}: ${fields[1].slice(0, 200)}; smallest change: ${fields.slice(2).join(' | ').slice(0, 200)}`);
  }
  return { lines, dropped };
}
