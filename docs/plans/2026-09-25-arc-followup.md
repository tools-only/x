# ARC follow-up, 2026-09-25 00:16–00:22 Asia/Shanghai

Goal remains incomplete. Both real-provider runs were live (PIDs 89352 and
33472). Current-code run: 20 actions, 1 completed level; older run: 98 actions,
1 completed level. Current-code run has no Skill or child research session;
3 proposed handoffs. Older run has 2 Skills, 18 proposed handoffs, no child
session. Do not merge their evidence or restart either solely for slow output.

## Confirmed evaluation target mismatch

Current run `execution-observation-20` cites
`memory:ls20_action_direction_map@v1`. Its creation decision-1 already has a
supported assessment from observations 8–11. The new `assess_effect` call
omitted decision_id and described revalidating this same direction map.
`assessHarnessEffect` excludes already-assessed decisions from implicit
selection. Therefore it cannot choose the intended decision-1; the resulting
supported-use error is not evidence that action 20 omitted its exact ref.

Next: regression-test implicit repeat assessment using explicit observation
refs. Resolve the intended target from actual cited component versions, including
previously assessed decisions; preserve explicit target selection and ambiguity
reporting. Also check retirement-effect assessment separately: absence after
retirement is a different effect from component use. No runtime patch yet for
either concern.

## Guidance repair performed

The review contract and two parent prompt entry points now co-locate the existing
stable key/name, atom and validity.scope fields. This addresses two real missing
identity submissions, without adding validators or eligibility conditions.
Node import/load check passed; git diff --check passed. Real-model behavior with
this prompt change remains unverified. Live loaded runtimes were not restarted.

## Verification and communication

- Full pytest session 98162 finished: 621 passed, 51 failed, 721.11 s.
  JUnit: `runs/test-delta-projection-audit-20260925.xml`.
  Do not describe all failures as stale; prior audit categorizes them.
- Full real-SDK deterministic-provider smoke started at
  `runs/arc-delta-full-smoke-20260925`, tool session 47633. Result pending.
  Includes enhanced delta/window continuity assertion. Reap this session.
- Gmail concrete component/progress report sent to 595819371@qq.com,
  message ID `1a0d436749ed3165`. It explicitly states research/Skill gaps and
  the 51 test failures; no closure claim.
- Deferred research B/C/D remain open; correctly routed proposals alone do not
  demonstrate sustained child research or cognitive continuity.
