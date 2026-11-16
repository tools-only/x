# PPT Live Presentation Self-Evolution Demo

Date: 2026-11-16 (Asia/Shanghai). Status: design, implementation not started.

## Problem and claim

The OBS capture prototype demonstrates media transport, but it does not make self-evolution necessary: screen labeling and cartoon rendering can be completed by a fixed pipeline. The new task must make the Agent responsible for a consequential multi-stage deliverable, expose failures from its own work, and carry a self-authored improvement into later work.

**Claim to test:** Given a topic, audience, language, and target duration, the Agent can autonomously produce a coherent slide deck and spoken script, rehearse it, identify an evidenced weakness, revise one task-local capability, and use that revision to improve the final presentation. The user should see the final presentation live in OBS and be able to compare the iteration and its evidence.

The claim is falsified if the agent does not identify a real weakness, the changed capability is not used later, the measured presentation does not improve, or the final output is not watchable in OBS.

**User burden removed:** manually researching/structuring the talk, drafting slides and narration, rehearsing each slide, and diagnosing recurring quality problems.

## Task and observable result

Input: topic, audience, language, and duration. Initial demonstration defaults: a 5–7 minute Chinese talk, 6–8 slides, one run. Topic is supplied at launch; the demo must not depend on a pre-authored talk.

Deliverables: editable PPTX, slide-by-slide narration, a rehearsal/evaluation record, and an OBS presentation scene. The presenter advances slides and reads generated narration; TTS can be used where available, but must not be a prerequisite for verifying slide and narration quality.

OBS is the audience-facing surface: show the active slide, readable captions/narration, and a compact “iteration evidence” view naming the observed defect, the Agent-authored change, and the before/after check. Do not expose internal token or tool counts as quality.

## Self-evolution path

1. The task Agent plans and authors the deck and script using the task adapter.
2. A bounded rehearsal produces observable evidence: render checks (overflow, contrast/readability, slide-to-script alignment, duration estimate) and a same-model critic review of the rendered slides against a fixed rubric. Preserve raw evidence and distinguish measured checks from model judgments.
3. The Agent decides whether there is a recurring capability gap. A reasonable no-change is valid when evidence does not support an improvement.
4. If it invests, the Agent authors or revises one task-local component (for example a slide-design skill or generation prompt), activates it through the existing Evo Loop component lifecycle, and regenerates/rehearses affected material.
5. The final talk uses the resulting deck and narration. Record which component version was semantically used and whether its predicted effect occurred. Keep failed candidates and their evidence; do not label a self-score as an improvement.

The demo must demonstrate the actual loop transitions—opportunity, recognition, investment, candidate, assembly, semantic use, feedback, retain/revise/retire—without a forced edit or required mutation. The evidence panel reports omitted as well as completed transitions.

## Architecture boundary

Keep the change task-local under `demo/ppt_live/` plus one thin launch/OBS adapter. Reuse the branch’s existing Pi/Evo Loop lifecycle and component interface; do not modify ARC task semantics, the core decision loop, component storage, or global prompts. The adapter owns presentation inputs/outputs, PPTX generation/rendering, rehearsal observations, and OBS scene control. Task feedback is delivered through existing observation/context entry points, not injected into the core loop as an automatic recommendation.

The current `arc-thin-e2e` runner and extension are ARC-specific. Before implementation, verify whether the branch exposes a supported task-adapter seam. If not, keep the first demo as a task-local Pi extension that calls the existing component lifecycle, and document any unavoidable shared-runtime change as a separate decision rather than cloning the ARC runner or silently adding a generic abstraction.

Use the existing OBS desktop capture source for the presentation display where possible. Do not require OBS WebSocket authentication for the first viewing path; use WebSocket only for reversible scene setup/status if the current service is available. Do not start public streaming or recording by default.

## Bounded evaluation

One initial run; one rehearsal; at most one Agent-authored component revision; one final rehearsal. Provider/model comes from the selected branch’s existing project configuration. Stop on provider rate limit rather than retrying in a loop. No public stream, recording, external publication, or paid run beyond the configured model usage.

Compare initial and final versions with the same fixed rubric and rendered slide snapshots:
- factual/source support for material claims;
- narrative coherence and coverage of the stated learning objective;
- visual readability and layout defects;
- script-to-slide alignment and duration fit;
- human watchability in OBS.

Functional correctness (valid PPTX, slides render, captions update, OBS displays the presentation), full-chain reachability, autonomous component adoption, and net quality benefit are separate evidence levels. One run can establish wiring and an observed iteration, not general improvement. A human viewer’s direct judgment remains necessary to establish that the final talk is compelling.

## Remaining design checks

- Confirm the exact task-local component authoring/activation path and the Evo Loop observation point on this branch.
- Select the smallest available PPTX renderer and narration path without adding system-wide dependencies.
- Define the fixed rubric and display the raw observations supporting each score before implementation.
- Keep the earlier `.camera-test` prototype isolated; do not treat its rate-limited model call or black OBS source capture as acceptance evidence.
