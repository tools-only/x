# Track: harness boundary v1

- Track ID: `harness-boundary-v1`
- Date: 2026-09-05
- Status: design baseline; optimization intentionally deferred
- Repository base commit: `e0a4843` (`chore: scaffold isolated autoresearch pi project`)
- Working tree: contains the current Pi-native RPC/task-agent changes and design notes; this track records the state, it does not claim a clean commit.

## Agreed boundary

- `PiKernel` remains a thin Pi RPC/session/event bridge. No complex harness interface layer is added to the kernel.
- `auto-research` exposes only a range/description of available harness primitive capabilities and external conditions.
- `auto-research` does not import or implement task-specific harness primitives.
- Concrete primitive implementations are owned, maintained, and updated by the task/harness side.
- A task agent may implement or update one primitive, but must express the change at primitive granularity rather than directly rewriting an undifferentiated harness.
- This separation keeps research design and task-harness implementation independently evolvable.

## Deferred

- Exact primitive names, interfaces, and granularity.
- Any kernel-side capability registry or protocol.
- Harness change trace memory (independent from task memory).
- Meta/task synchronization schema and transport.

## Verification snapshot

The current test baseline was `8 passed` with pytest using a project-local basetemp. No implementation optimization is performed by this track marker.
