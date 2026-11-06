# PPT design priority — 2026-11-06

## Problem and narrow claim

Observed Qwen run ppt-qwen-context-20261105-225917 repeatedly revised numeric
matching, culminating in a broader bare-number fallback; successful checking
did not establish improved presentation design. User requests that PPT
self-iteration prioritize content design, layout, aesthetics and visual
communication. The claim is that explicitly prioritizing these outcomes in the
existing PPT instructions can redirect effort. It is not yet a measured result.

## Change and lifecycle

Update the actual task system prompt, independent ADAPT prompt, and PPT-specific
on-demand self-evolution skill source. Keep the general runtime unchanged.
Factual fidelity remains a baseline; priority shifts to narrative, purposeful
takeaways, hierarchy, typography, spacing, visual explanation, and deck rhythm.
Agent chooses its approach, components, collaborators, and when to revise.
Rendered evidence and subsequent application are the basis for assessing
method changes. No fixed reviewer, template, color palette, score, iteration
count, management turn or delivery gate is added.

The task host reads the two prompts at extension initialization; restart/new
process loads the new text. Independent ADAPT receives its own core prompt.
The skill is copied at prepare or when absent: existing run-local skills are
not overwritten. Existing processes retain cached base prompts. This change
does not restart a provider task or rewrite an existing run's components.

## Verification and limits

Check the diff, prompt loading paths and published text. This is an instruction
edit: no runtime code change or new test machinery. No paid run is launched.
Functional text change and load-path inspection can establish configuration
only. Actual payload delivery, autonomous design-method adoption and net
benefit remain unverified.

Future bounded behavioral check, if separately authorized: same Qwen/task,
review where design effort goes and compare actual slide revisions for clearer
narrative, readability and visual explanation. Method revisions must be used
in subsequent work; artifact-only edits and zero-warning/checker reports do
not prove self-evolution. Quality and parent/child cost must be assessed
together; no benefit is inferred from component counts.

## Text footprint

```json
[
  {
    "path": "demo/prompts/ppt_demo_system.md",
    "before_chars": 5311,
    "after_chars": 6656,
    "before_sha256": "bacf1450ea81146c5d076c721e11e85c15b06ff252930297bb22fb93f54d99f9",
    "after_sha256": "6cd93e3d255720362af5d5d888de3b3cc27caeb1afd59d177295ef670752d912"
  },
  {
    "path": "demo/prompts/ppt_adapt_system.md",
    "before_chars": 3088,
    "after_chars": 3830,
    "before_sha256": "adb09472655d4fbef5da350c84717c26291672a6dc936c1688a0dc550fed19bb",
    "after_sha256": "e5424a67bd29cb27d71697fd269a8fbdbb198c8e353f7df339316a06d7d88049"
  },
  {
    "path": "demo/harness-methods/self_evolution/SKILL.md",
    "before_chars": 10963,
    "after_chars": 11623,
    "before_sha256": "104483fbc16990d4f6490ae1364177b9096bedf88bd5a1972b3647da7b484d9a",
    "after_sha256": "db961c708f16b471482002c18394114ee483ba85bd625e1f23ea83c626d3d6fe"
  }
]
```

## User priority clarification

Explicitly state that factual accuracy is a necessary basic requirement, while the core objective and main allocation of self-iteration are presentation content design, layout, aesthetics and visual communication. Put the primary objective in the task prompt's opening. Replace sequential verify-then-design wording with proportionate checks alongside design work; additional verification responds to concrete concerns with material impact. This is a priority clarification, not authorization to invent or distort facts. No task was restarted.

## Capability-first self-evolution round

Follow-up: the user observed that iteration had no self-play — generation and
review did not each evolve into better versions of themselves. Add explicit
instruction that self-evolution means growing the Agent's own capabilities,
with producing (content, narrative, layout, typography, visual explanation) and
assessing (seeing weaknesses, understanding causes, knowing better
alternatives) iterated separately. Each round identifies which side limits
progress, improves that side's method, applies it to later work, and compares
rendered outcomes. Assessment ideas are probed with cases that should be
accepted and cases that should be rejected; production methods are judged by
observably better later output. A save, passing report, clean render, or
versioned snapshot is explicitly not capability growth. No fixed reviewer,
workflow, or report requirement is added.

Same three files updated again; current cumulative file hashes:

```json
[
  {
    "path": "demo/prompts/ppt_demo_system.md",
    "after_chars": 7762,
    "after_sha256": "46d77ee451b2e6266cabaebbf4df075ff21c3a33a9155fab4aec7a3210cdda92"
  },
  {
    "path": "demo/prompts/ppt_adapt_system.md",
    "after_chars": 4601,
    "after_sha256": "68c71bdce1313e2572e7e395102d0facd4cbef55896ef56dfa8c184429505549"
  },
  {
    "path": "demo/harness-methods/self_evolution/SKILL.md",
    "after_chars": 13079,
    "after_sha256": "5b25a1100735bd8653cd5f6e63e8b86e3c86b52534fcca5b4a46db0c0470c52d"
  }
]
```

## Fresh capability-first rerun

To exercise the capability-first instructions with actual provider behavior, a fresh
Qwen run was launched on the same PresentBench JPMorgan Chase Q3 2021 case with
the same route and parameters as before (AZ https://az.gptplus5.com/v1,
qwen3.8-27b, thinking high, HTML required, unbounded):

```
runs/ppt-qwen-capability-20261106-003429
```

Protocol records the new ppt_demo_system.md hash
46d77ee451b2e6266cabaebbf4df075ff21c3a33a9155fab4aec7a3210cdda92, so the
payload under test is the capability-first text, not the cached old prompt.
Observation target: whether producing and assessing evolve separately and
whether revisions shift from checker refinement to design/visual/communication
changes with rendered comparison.
