/**
 * The canonical form of the harness's kinds (docs/plans/2026-10-21-components-by-default-canonical-forms.md, S1), said once
 * for both readers: the agent's system prompt (ARC_THIN_KINDS=canonical swaps the capability block of
 * prompts/arc_thin_native_system.md for prompts/arc_thin_native_kinds.md) and the refiner's charter (REFINER_SYSTEM's kind
 * list and its paragraph on views are swapped for the same statements). Before this, the agent was told "saved code that
 * takes no args is a view" and the refiner "a tool with the line '# view: on' is run after every new state".
 *
 * A mechanism is mentioned only when its flag is on (`persist`: S2, `skills`: S3), so the text never describes something
 * the runtime does not do. Nothing here is read when the flag is off: the legacy template and charter are not touched.
 */
import { loadPrompt } from './prompt_loader.ts';

/** What a view is. The agent's Hooks line and the refiner's charter both use this sentence word for word. */
export const VIEW_RULE = "saved code with no args that does not act (or '# view: on'; '# view: off' keeps a tool), run after each new state, its output shown at each decision";
/** What a predictor is, as the agent's Hooks line says it. */
export const PREDICT_RULE = "predict(state, action) returning {cells, level_changed, state} before each action, scored";

export type KindsOptions = {
  /** The consult tool is on: subagents can be asked, so the kind is described. */
  consult: boolean;
  /** S2: functions a python cell defines persist as lib/<name>.py. */
  persist: boolean;
  /** S3: skills have a trigger and are shown at it. */
  skills: boolean;
};

const SCRIPTS = {
  persist: "functions you define in python persist as lib/<name>.py (import lib.<name>)",
  written: "lib/<name>.py, functions for any cell or saved code to import (import lib.<name>)",
};
const SKILLS = {
  triggered: "skills/<name>/SKILL.md (description: what it does and when it applies; metadata.trigger: level_start or stall), a procedure with judgment steps, shown once at its trigger, else read when a step matches",
  read: "skills/<name>/SKILL.md (description: what it does and when it applies), a procedure with judgment steps, read when a step matches",
};
const SUBAGENTS = "- Subagents: agents/<name>.md (description, tools: [read, python, <tool names>]) answers consult(agent, question, refs) in its own context; it never acts.";

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), template);

/** The legacy capability block of the native template: its heading, then every bullet under it. */
const LEGACY_BLOCK = /^Your harness has \{\{kinds\}\} kinds of capability:\r?\n(?:- .*\r?\n)+/m;

/** The canonical capability block as text with LF line ends. */
export function canonicalKinds(options: KindsOptions): string {
  return fill(loadPrompt("arc_thin_native_kinds.md").replace(/\r\n/g, "\n"), {
    count: options.consult ? "seven" : "six",
    scripts: options.persist ? SCRIPTS.persist : SCRIPTS.written,
    skills: options.skills ? SKILLS.triggered : SKILLS.read,
    view_rule: VIEW_RULE,
    predict_rule: PREDICT_RULE,
    subagents: options.consult ? SUBAGENTS + "\n" : "",
  });
}

/**
 * The native system template with its capability block replaced by the canonical one, in the template's own line ends.
 * Everything outside the block is the legacy template's, so it cannot drift from it; the swap throws if the legacy
 * template no longer has a block it recognises.
 */
export function canonicalSystemTemplate(legacy: string, options: KindsOptions): string {
  const match = LEGACY_BLOCK.exec(legacy);
  if (!match) throw Error("arc_thin_native_system.md has no capability block to replace (ARC_THIN_KINDS=canonical)");
  const eol = legacy.includes("\r\n") ? "\r\n" : "\n";
  return legacy.slice(0, match.index) + canonicalKinds(options).replace(/\n/g, eol) + legacy.slice(match.index + match[0].length);
}

/** A piece of the refiner's charter replaced by another; it must be there. */
function swap(text: string, from: string, through: string, to: string): string {
  const start = text.indexOf(from);
  const end = start < 0 ? -1 : text.indexOf(through, start);
  if (end < 0) throw Error(`the refiner charter has no passage from "${from.slice(0, 40)}" to "${through.slice(0, 40)}" (ARC_THIN_KINDS=canonical)`);
  return text.slice(0, start) + to + text.slice(end + through.length);
}

/**
 * The refiner's charter with the kind list and the paragraph on views in the canonical form, the same statements as the
 * agent's system prompt. Edits to REFINER_SYSTEM outside those two passages carry over; the swap throws if one is gone.
 */
export function canonicalRefinerSystem(charter: string, options: Omit<KindsOptions, "consult">): string {
  const kinds = "The harness has seven kinds of capability: prompts (prompts/strategy.md is the agent's current plan and prompts/rules.md holds " +
    "the rules its checks have established; both are applied at every decision: how the agent works, not what it found), memory (what it found true " +
    "of this game: facts with a confidence 1-5, and hypotheses with a check(t) the runtime runs on every recorded move), scripts (lib/<name>.py, " +
    "functions cells and saved code import" + (options.persist ? "; the runtime saves each function the agent defines in python there" : "") + "), " +
    "skills (skills/<name>/SKILL.md, a procedure with judgment steps, its scripts beside it" +
    (options.skills ? "; metadata.trigger level_start or stall shows it once at that event" : "") + "), hooks (code the runtime runs for the agent: a view is " +
    VIEW_RULE + "; " + PREDICT_RULE + "; a hypothesis's check(t) on every move), subagents (agents/<name>.md; they never act) and tools " +
    "(tools/<name>.py, python the agent calls by name with args). ";
  const views = "A view is " + VIEW_RULE + ": use one to report positions the agent keeps reading off the grid; it must return a value " +
    "(a view that returns None shows nothing). ";
  const withKinds = swap(charter, "The harness has five kinds of capability: ", "and subagents. ", kinds);
  return swap(withKinds, "A tool with the line '# view: on' near its top", "(a view that returns None shows nothing). ", views);
}
