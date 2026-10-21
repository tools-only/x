/**
 * Skills with a consumer (docs/plans/2026-10-21-components-by-default-canonical-forms.md, S3; ARC_THIN_SKILLS=1): a skill whose
 * frontmatter says metadata.trigger is shown, once, at the first decision after its event; every skill's description stays in the
 * HARNESS index, and its body is read when a step matches. The runtime counts events and shows; the agent decides whether the
 * procedure applies. This module is the pure part: which skills are due, how they are shown, and the kind of edit an event
 * suggests to a refinement.
 */
import type { Component } from './arc_thin_binder.ts';
import { loadPrompt } from './prompt_loader.ts';

/** Skills shown at one event at most, and how much of each body: a push is resident once, not a manual. */
export const SKILL_PUSH_MAX = 2;
export const SKILL_BODY_CHARS = 1500;

/**
 * The rules for writing a skill, carried by the instructions that ask for one (the refinement charter and the two reviews),
 * and by nothing resident: the system prompt only says what a skill is.
 */
export const skillAuthoring = () => loadPrompt("arc_thin_skill_authoring.md").replace(/\r\n/g, "\n").trim();

/** What the refinement charter adds with ARC_THIN_SKILLS: the reply format for a skill directory, and when to choose one. */
export const refinerSkills = () => "\n\nSKILLS: choose a skill only when the edit is a procedure with judgment steps (which scripts to run, what to check, what the " +
  "result decides); a fact is a MEMORY entry, a standing rule a prompt, one function a lib script. Reply with a skill as one edit of several FILE blocks: " +
  "skills/<name>/SKILL.md first, then the files beside it (skills/<name>/scripts/<file>.py, at most 4 in all), every path under that one directory, then one WHY " +
  "line. A single FILE may also add a file beside an existing SKILL.md. When SAVED SKILLS below already holds a skill for the procedure, rewrite it (if it is " +
  "marked REFINED) instead of adding a second one; never replace one marked AGENT'S, add a new path. " + skillAuthoring();

/** The events the runtime counts: the first decision of a level (`level:<levels completed>`), and the first after a stall review (`stall:<actions>`). */
export type SkillEvents = { level: string; stall?: string };
/** A skill pushed at a decision (`at`: the action count then): kept until the decision is answered, then it counts as shown. */
export type SkillPush = { path: string; version: number; trigger: string; event: string; at: number };

/**
 * The skills due now: active ones with a trigger whose event has happened and which were not shown for it. `shown` is the
 * event each path was last shown for. Newest version first, at most SKILL_PUSH_MAX.
 */
export function dueSkills(skills: Component[], events: SkillEvents, shown: Map<string, string>, at: number): SkillPush[] {
  const due: SkillPush[] = [];
  for (const c of skills) {
    if (c.kind !== 'skill' || !c.enabled || !c.trigger) continue;
    const event = c.trigger === 'level_start' ? events.level : c.trigger === 'stall' ? events.stall : undefined;
    if (event !== undefined && shown.get(c.path) !== event) due.push({ path: c.path, version: c.version, trigger: c.trigger, event, at });
  }
  return due.sort((a, b) => b.version - a.version || a.path.localeCompare(b.path)).slice(0, SKILL_PUSH_MAX);
}

/** What the decision shows of the skills pushed to it: each one's path, version, trigger, description and (clipped) body. */
export function renderSkillPush(pushes: SkillPush[], skills: Component[], level: number): string {
  const lines: string[] = [];
  for (const push of pushes) {
    const c = skills.find((s) => s.path === push.path);
    if (!c) continue;
    const body = (c.body ?? '').trim();
    lines.push(`SKILL ${c.path} v${c.version}, shown once ${push.trigger === 'stall' ? 'after the stall review just made' : `for level ${level + 1}`} ` +
      `(read ${c.path} again when a step matches; whether it applies now is yours to judge): ${c.description}\n` +
      (body.length > SKILL_BODY_CHARS ? `${body.slice(0, SKILL_BODY_CHARS - 1)}…\n(${body.length - SKILL_BODY_CHARS + 1} more characters in the file)` : body));
  }
  return lines.join('\n\n');
}

/**
 * The kind of edit an event suggests to a refinement, one line per event it recognises (the runtime counts events; the
 * refinement decides what to write, and `NONE` stays an answer). `kind` rules, one per event class:
 * a level reached: a procedure that won it is a skill, a goal a check confirmed is a rule, what was found is memory;
 * python redone: a function is a script (`persist`: the runtime saves defined functions), the same output at every state is a
 * view, a computation with steps and a check is a skill; no goal test, or a stalled level: the strategy or, when the record
 * shows a procedure that repeats, a skill; cells or coordinates located by hand: a view.
 */
export function eventKinds(triggers: string[], persist = false): string[] {
  const hints = new Set<string>();
  for (const trigger of triggers) {
    if (/^level \d+ reached/.test(trigger))
      hints.add('a level reached: a procedure that won it, repeatable on another level → a skill (skills/<name>/SKILL.md with metadata.trigger level_start, scripts beside it); a goal the checks confirmed → a line of prompts/rules.md; what was found → MEMORY');
    else if (/redone \d+ times|retyped \d+ times/.test(trigger))
      hints.add(`python redone: the same output wanted at every state → a view (tools/); a function → lib/<name>.py${persist ? ' (the runtime already saves the functions the agent defines in python)' : ''}; a computation with steps and a check → a skill`);
    else if (/no goal test yet|no step predicted a level change/.test(trigger))
      hints.add('no goal test: the strategy\'s next experiment (prompts/strategy.md)');
    else if (/located cells or coordinates/.test(trigger))
      hints.add('cells located by hand: a view (tools/) that reports them');
    else if (/actions since the last refinement|stall/.test(trigger))
      hints.add('a stalled level: the strategy, or a skill (metadata.trigger stall) when the record shows a procedure that repeats');
  }
  return [...hints];
}
