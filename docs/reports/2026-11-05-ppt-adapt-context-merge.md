# PPT and ADAPT context integration — 2026-11-05

## Scope and claim

Merge `codex/ppt-native-production-demo` at `193031e2` into `codex/ppt-adapt-context` (previously `d728cd6a`), and carry the five uncommitted context-management files from `codex/adapt-context-mgmt` at `90d636fe`. The latter commit is already an ancestor of the target. Keep the source worktree unchanged. This is integration, not a claim of autonomous adoption or performance benefit.

## Conflict decisions and implementation

Keep the target branch's independent ADAPT service, task-local agents with declared scopes, program versioning and workflow host calls, HTML/PowerPoint rendering and delivery, prompts, and runner. These conflict with the incoming branch's alternative free-hands host and HTML-only delivery; they are not replaced by that alternative. Incoming fresh-batch runner behavior is not enabled. Preserve incoming branch history and its design documents as historical records, not declarations of the active runtime.

Integrate binary workspace transport and IO, wider transport ceilings, additional Python entry shapes, optional Markdown frontmatter, image detection and the HTML renderer module. Preserve target subagent permissions and write scopes. When workflows resume after host calls, refresh binary files alongside text files; explicit Python material scopes filter both text and binary snapshots.

Carry the ADAPT context compiler, immutable evidence slices, budget accounting and context-management tool from the source's uncommitted changes. Existing `ARC_THIN_ADAPT_CONTEXT=1` remains the opt-in for the ARC extension; this merge does not automatically enable it in the separate PPT host.

## Bounded validation

- Node context/runtime/Binder/activation suites: 32 passed.
- PPT suite: 6 passed, including actual PowerPoint export, source-checked delivery, workflow host calls, scoped/nested agents and partial HTML rendering.
- `tests/test_ppt_adapt_pi.py`: 1 passed using actual Pi and a scripted provider, with context selection, method changes and return to the task.
- Temporary compatibility smoke: binary write, cross-call binary read, `main()` program entry and refusal of a binary read outside explicit material scope passed.
- Whitespace/conflict and ancestry checks are performed before final commit.

## Evidence boundaries and cost

Functional correctness: passed the bounded checks above. Full-chain reachability: the scripted Pi ADAPT path and actual PowerPoint path passed. Autonomous adoption and net benefit: unverified; no paid provider runs or comparative performance claims. No new resident agent obligations or default runtime enablement were added.
