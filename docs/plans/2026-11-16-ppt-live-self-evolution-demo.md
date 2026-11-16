# PPT Live Presentation Self-Evolution Demo

Date: 2026-11-16 (Asia/Shanghai). Status: design on `evo-loop-ppt-live-demo`; implementation not started.

## Problem and claim

The OBS capture prototype demonstrated media transport, but screen labeling and cartoon rendering do not make self-evolution necessary. The current `evo-loop-implementation` branch already contains a PPT production host and live Agent reflection: `demo/ppt_demo_extension.ts` provides rendering, slide-image inspection, delivery, component reflection, orchestration reflection and task-local feedback; `demo/live_orchestration_core.ts` carries task receipts and workflow state; `src/autoresearch_pi/ppt_demo.py` launches the real Pi/PPT task. The Agent can change its own prompt, skill, tool, subagent, memory and orchestration. The demo must reuse that loop rather than build another one.

**Claim to test:** Given a topic, audience, duration and source brief, the existing PPT task Agent can author a presentation and narration, use rendered/rehearsal evidence to decide whether a change to its own working method is warranted, use any such change on later production work, and deliver the final presentation as a visible, narrated OBS show.

The claim is falsified if the task Agent does not author the deliverable, the rehearsal evidence never enters its task decisions, any self-authored change is not used later, the final show is not watchable through OBS, or the presented material fails the stated task objective. A reasoned no-change is valid; if no change occurs, the run demonstrates the presentation task but not autonomous evolution.

## Task and visible result

The user supplies a topic, target audience, language, duration and any required source material. For the first live run, use a topic grounded in the project’s own Evo Loop materials so that the Agent can cite concrete mechanisms and evidence. Later runs can accept broader topics when an appropriate research/source path is available.

The Agent authors a self-contained slide presentation and a per-slide narration script in the current PPT workspace. Reuse the existing HTML/scene-JSON source and `office.render` / `office.look` / `office.deliver` workflow. The visible live output is the final rendered deck with synchronized captions and spoken narration, presented in a browser or PowerPoint window captured by OBS’s existing display source. The output should remain an editable presentation artifact as well as a live show.

OBS is the audience-facing surface. During preparation, show a compact progress/evidence view only when it can be derived from actual task receipts: current deck revision, rendered slides, the Agent-authored method/orchestration change (if any), and evidence of later use. Then show the final slides full-screen with readable captions and narration. Do not display model/tool counts as quality. Do not start public streaming or recording by default.

## Evolution path

1. The task Agent receives the topic and source brief, plans the presentation, and authors slides plus narration.
2. It renders and inspects the actual slides using existing PPT host tools. Rehearsal facts may include the exact rendered revision and pages viewed; viewer feedback is recorded only when a person actually provides it. Preserve model critique as model judgment, separate from mechanical renderer facts and human judgment.
3. The existing live Evo Loop exposes task outcomes and component/workflow state. The Agent decides whether a recurring method gap merits investment; it may also decide that the weakness belongs only to this deck or that evidence is insufficient.
4. If warranted, the Agent uses existing `reflect_component` or `reflect_orchestration` to change one task-local method. The changed version must be used in later authoring/revision, and the runtime’s existing receipts must show that semantic use.
5. The Agent renders and inspects the final revision, delivers the artifact, and the presenter plays that exact delivered/rendered revision with narration and captions in OBS.

The loop’s transitions—opportunity, recognition, investment, candidate, assembly, semantic use, feedback, retain/revise/retire—must be evidenced by the existing Evo/PPT receipts. The OBS adapter presents those receipts; it must not force reflection, select a method, or claim a causal improvement from the existence of a changed component. If a post-show correction is fed back into the still-open task, that correction must enter the same Agent loop as ordinary task evidence.

## Architecture boundary

Keep the change in a task-local OBS/presentation adapter, expected under `demo/ppt_live/`, plus the smallest runner hook needed to launch playback. Reuse the branch’s `ppt_demo_extension.ts`, `live_orchestration_core.ts`, current Pi runner, self-reflection tools and workspace. Do not modify the Pi kernel, generic Evo Loop lifecycle, ARC semantics, global prompts, or component storage.

The adapter handles presentation playback, caption timing, speech output and OBS-facing status. Prefer the OBS desktop capture source already configured on the user’s machine; do not require Browser Source/CEF or OBS WebSocket for the first display path. The current runner creates benchmark-case workspaces and has bounded AZ model/spend/deadline controls; the live task entry must preserve those controls, explicitly accept a topic/source brief, and record its exact task inputs. It must not silently reuse a benchmark evaluator or hidden answer as a quality gate.

Before implementation, verify the branch’s exact renderer output layout and current Pi multi-extension/runner constraints. If the renderer only provides HTML/PDF/PNG, retain that source as the live show and export a PPTX only through a verified available path; do not claim PPTX delivery from an HTML artifact.

## Bounded evaluation

First evaluation: one real task run on the configured branch provider/model, one Agent-controlled reflection opportunity, and one playback of the exact final revision in OBS. Preserve the initial and final render artifacts plus run receipts. Stop on provider rate limit; do not retry in a loop. No public stream, recording, or additional paid runs are implied.

Assess separately:
- **Functional correctness:** source deck renders; narration and captions are associated with the right slide; final artifact opens; OBS displays it.
- **Full-chain reachability:** task input → real Pi Agent authoring → existing reflection/evolution loop → later semantic use (if changed) → render/delivery → OBS playback.
- **Autonomous adoption:** whether the Agent independently identified a justified method gap and chose/used a change; reasoned no-change and opportunity non-use remain visible.
- **Net task benefit:** whether the final live presentation is clearer, more accurate, better paced and more watchable than the initial revision, with the method change and its evidence accounted for. One run is exploratory evidence, not a general improvement claim.

The viewer must be able to judge the final show directly. Automated renderer checks and model critique are useful evidence but cannot substitute for human watchability.

## Open checks

- Confirm which existing receipts/events can be projected into the OBS status panel without adding another persistence path.
- Confirm the current presenter can speak locally and update captions in sync; if speech is unavailable, keep captions and advance manually rather than claiming narrated playback.
- Confirm editable artifact format and whether a PPTX export path already exists.
- Keep `.camera-test` isolated; its recent OBS source screenshot was black and the AZ model call hit rate limiting, so it is not acceptance evidence.
