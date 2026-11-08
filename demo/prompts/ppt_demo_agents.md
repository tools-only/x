# Self-Harness reference

## Goal and ownership
The user's task outcome, scope and supplied constraints define success.
You own your strategy and supporting harness components; modification is optional and is not itself task success.
The environment adapter provides task actions and facts; component definitions express your capabilities and context.

## Objects and reflective mechanism
A component has a logical name, kind, source, saved version and mutation note.
The kinds are tool, subagent, skill, prompt, memory and process.
`reflect_component(op="inspect"|"define"|"redefine"|"restore")` is the single component modification primitive.
Successful publication binds the component as a native runtime resource, visible from the next provider request in this session.
`define` creates an identity; `redefine` replaces that identity's source; both require name, kind, source and a nonempty note.
`restore` republishes a saved version's source through current validation and requires name, kind, version and a nonempty note.
`inspect` returns the component inventory; name/kind selection returns active source, native binding/schema or location, saved versions, activation status and last failure.
Names begin with an ASCII letter and contain at most 64 ASCII letters, digits, underscores or hyphens; native skills also satisfy Pi's skill-name validation.
Native tool names are exclusive across built-ins, host tools, other extensions and your tool/subagent definitions.

| Kind | Source format | How it appears natively |
| --- | --- | --- |
| tool | Python at tools/<name>.py, with # program: on in the first ten lines; recognized run/observe/main/handler entry or top-level script; parameters are an optional args dictionary | Same-name native tool with that parameter schema |
| subagent | Markdown at agents/<name>.md; optional YAML tools grants and refs default paths; description metadata | Same-name native tool with question:string and optional refs:string[]; independent context on the working agent's model |
| skill | Markdown at skills/<name>/SKILL.md with YAML description and optional matching name, validated by Pi | Pi native available-skills index with description and published file location; body is an ordinary readable skill file |
| prompt | Markdown at prompts/<name>.md; optional metadata; active defaults to true | Subsequent request system context |
| memory | Text at notes/memory/<name>.md | Subsequent request context |
| process | JSON at processes/<name>.json with strategy text and optional refs:[{name,kind,version}] | Active strategy and exact references in subsequent request context |

The initial prompt component ppt_baseline_guidance contains the baseline guidance.
Process references identify exact active dependencies; strategy-only processes do not dispatch stages or rewrite Pi's internal turn loop.
Legacy workflow/loop process envelopes remain compatible with their existing synchronous boundary hooks.

## Lifecycle
Changed content receives a new saved version; identical current content can retain its version.
Tools and subagents replace their live named binding; skills replace their published index/body; context components enter the next request.
Calls already entered retain their captured version; replacement does not cancel them or alter an already-submitted request.
One process is active; publication occupies one pending slot until the next context binding, where exact references are rechecked.
Failed validation or registration leaves the prior published binding active and returns failure with its active version; failed process activation preserves the prior active process and reports the failure in context.
Restore changes future configuration, not prior actions, produced files or information already seen.
The interface has no delete operation; component lifetime ends with replacement or task context termination.

## Resources and boundaries
Ordinary task files are available through read, write, edit, ls and grep; python executes within workspace confinement.
Component storage and task AGENTS.md are protected from generic mutation; reflect_component owns component publication and history.
The reflective API, host/Pi implementation, authorized model/provider, budget/deadline guards, confinement and user acceptance criteria remain fixed boundaries.
Subagent tool grants and supplied references bound its capabilities; parent-plus-child work remains inside the authorized budget.
Definition, index exposure, body loading, context injection and execution are separate activity facts and do not establish task improvement.

## PPT adapter
office provides render, look and deliver for presentation sources, page images and delivery.
Task resources are data/instructions.md, data/material.txt and data/environment.md.
Render accepts JSON or HTML under artifacts/; canonical selection prefers artifacts/presentation.html, then artifacts/deck.json, then a sole HTML file under artifacts/.
Receipts, contact sheets and page images appear under results/renders/vNNN/; current context reports source/render state, lineage, spend and remaining time.
Delivery copies the rendered output and harness evidence to delivery/ and requires the latest successful rendered revision to match current canonical source and hash.
These checks enforce source/revision integrity; task quality remains governed by the user's criteria.
