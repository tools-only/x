# ARC SelfRoot Migration Design

## Intent and rationale

Keep ARC task and environment behavior while moving the ARC native run onto the shared SelfRoot core synced from `worktrees/evo-loop-impl`. Persist its state under `<ARC_RUN_ROOT>/self_root/` by default so shared core updates no longer require copying the ARC-specific reflection loop.

## Goals

- Use the shared `demo/self_root.ts` lifecycle and reflection contract in native ARC runs by default.
- Put ARC-specific contract, evidence, metrics, tool schemas, and action receipts in `demo/self_root_arc.ts`.
- Record ARC and Python `env.act` actions through the same ARC environment path and keep Python/WASI execution available.
- Preserve old ARC selfloop as an explicit fallback, without running both self-evolution loops as writers.
- Keep game- and strategy-specific interpretation out of generic core and contract facts.

## Non-goals and anti-goals

- Do not remove ARC guard, hook, refine, binder, legacy selfview/selfslots, or old selfloop code in this migration.
- Do not change action semantics, Python/WASI execution, bridge budgets, observation projection, or level progression.
- Do not claim autonomous adoption or task benefit without real-provider ARC runs.
- Do not inject development workflow documents into gameplay context.

## Approaches considered

1. Keep the ARC loop and copy shared core updates manually. Lowest immediate integration risk, but retains duplicate evolution mechanics and the maintenance burden that prompted this change.
2. Replace the ARC adapter and runtime wholesale with the PPT integration. Rejected because PPT acceptance, delivery, and workspace assumptions do not fit ARC, and wholesale replacement would threaten ARC task behavior.
3. Add a narrow ARC SelfRoot adapter around the shared core and preserve ARC's existing environment/runtime path. Chosen: shares reflection, context policy, ledger, and lifecycle while ARC continues to own only task facts, evidence, action receipts, and boundaries.

## Design and implementation choices

- Store the ARC contract and exported SelfRoot state in `<ARC_RUN_ROOT>/self_root/contract.json` and `state.json`; use atomic `.next` replacement for state.
- Default SelfRoot on for native non-control ARC runs. `ARC_THIN_SELFROOT=0` disables it. `ARC_THIN_SELFLOOP=1` enables the legacy selfloop only when SelfRoot is disabled.
- Keep action calls named `arc_action`; record successful actions with opaque action/state facts and `arc_action` or `python.env_act` receipts. No plan or memory side-channel is added to action parameters.
- Create lifecycle boundaries at ARC reset, level completion/terminal completion, and session shutdown using the shared contract floor.
- Make the shared SelfRoot mirror the one Agent-facing runtime view. The ARC adapter supplies current observation, action history, run position and ARC-owned context facts into that view; the extension retains environment execution and raw persistence.
- Preserve ARC image delivery and the Pi conversation transcript as distinct provider inputs. Do not separately inject the old ARC state/recent/self digest beside the SelfRoot view.
- Tool writes and orchestration changes use the shared core protocol and become active at request boundaries through its `boundary(refreshTools, persist)` lifecycle.
- Old ARC mechanisms remain available for explicit fallback and comparison; do not silently retire their files or records.

## Lifecycle, permissions, versioning, and recovery

The ARC extension initializes/loads the contract and root state, then exposes SelfRoot facts and protocol schemas on requests. Reflection remains agent-initiated and core-validated; it does not execute in WASI and does not permit arbitrary file writes to core state. Writes activate only after the response boundary. ARC action receipts are produced only after the existing bridge confirms the action. State writes use a same-directory temporary file and rename. A changed contract hash must stop loading with an actionable error rather than silently resetting state. Disabling SelfRoot leaves its persisted state intact; legacy fallback uses its existing ARC records.

## Evidence and evaluation

The initial scope requested static work only. The user later authorized targeted checks and one real ARC run, capped at 3 decisions, 5 actions, and 120k provider-reported tokens, specifying `az` / `qwen3.8-27B`. Targeted SelfRoot and bridge recovery tests passed. A real ARC bridge started, but the runner stopped before Pi because the configured workspace does not provide the OpenAI-compatible endpoint/key that Pi requires; no provider request or game action occurred. Provider Session verifies the `讯星AZ` route, but its credentials are not available to this Pi runner. Full-chain reachability, autonomous adoption, and net benefit remain unverified. A future real-provider comparison must measure task outcome and parent-plus-child cost/latency against the current ARC path, including reasonable non-use and failed reflection cases.

## Deferred research

This touches deferred research item A (environment adapter / Agent runtime boundary). It records ARC action/state facts through the existing extension and does not complete the larger adapter responsibility cleanup. Items B/C (subagent research and parent-child communication) and D (cross-compaction continuity) are not changed by this migration.

## Builder decisions

- Use a thin adapter to place ARC observation/history facts in the SelfRoot view. Keep the bridge, image delivery and Python/WASI path; remove the parallel ARC state/recent working-set text when SelfRoot is active.
- Default to SelfRoot for native non-control runs; provide an explicit opt-out and prevent concurrent legacy writer activation.
- Preserve old mechanisms pending separate real-run evidence.
