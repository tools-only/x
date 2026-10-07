# Capability authoring implementation ledger

Scope: implement the accepted capability-authoring ADR on the current branch; preserve pre-existing edits and live ARC processes. No branch, commit, live-run restart, or cross-task memory migration.

## Plan

1. Pin upstream Anthropic skill-creator with license and supporting resources; derive tool authoring from the pinned Pi `pi.registerTool` API and this project's task-local tool contracts. Add baseline catalog and on-demand loading independent of dynamic assembly. Tool creation is Pi-native and does not involve MCP.
2. Add shared authoring guidance/contracts and preserve method metadata across native, facade and research routes. Raise research instructions from trajectory recap to sustained problem/method development.
3. Add explicit task/episode/level/state memory validity, evaluated at usage boundaries with transitive dependency suppression and preserved history.
4. Add saved/ephemeral subagent context recipes and explicit empty-tool support.
5. Create research-orchestration using the requested draft/test/compare/review workflow. Save evaluation artifacts and an upstream-generated static review viewer.
6. Run focused diagnostics, real ARC runner smoke (five component kinds and both length-continuation paths), then document actual results and remaining provider-quality acceptance.

## Decisions and progress

- Initial worktree already contains changes to router, protocol, assembly, self-harness, prompts, ARC smoke and tests. These are retained, not attributed to this task.
- User explicitly requested current branch implementation, overriding worktree-isolation defaults. No automatic commits.
- Use the specified Anthropic skill-creator, not a substitution with the local Codex skill-creator. Claude-specific CLI/UI operations require explicit Pi adapters; runtime permissions remain authoritative.
- Source research: the user-specified Anthropic skill-creator is pinned for skill authoring. Tool authoring instead uses the installed and upstream Pi 0.80.6 `pi.registerTool` contract plus this repository's declarative/adapter task-tool substrate; no measured popularity claim.
- Source retrieval succeeded via GitHub connector. Direct shell network unavailable; no network configuration changes.
- `tool-creator` was corrected to use Pi 0.80.6 `pi.registerTool`, TypeBox, active-tool selection, and this repository's declarative/adapter task-tool substrate. MCP server guidance and its copied resources were removed. A semantic execution diagnostic now covers create -> exact assembly -> invocation -> decoded output.
- Structured methods may have empty construction evidence only as explicit untested candidates. Direct task skills record `structured_untested_candidate` versus `structured_grounded_candidate`; Auto-Research lifecycle records `grounding_status` separately from candidate structure and later utility evidence.
- Research-orchestration iteration 1 completed three with/without-skill cases, independent grading, benchmark aggregation, and a static review viewer. Both configurations passed all current assertions (10/10, observed delta `+0.00`); graders found the prompts/assertions insufficiently discriminating, so this is not evidence of skill benefit. Timing/token telemetry was unavailable and remains null.
- Diagnostics passed: capability authoring plus assembly `11 passed`; selected method/tool/subagent/memory regressions `19 passed`; Auto-Research self-harness pytest smoke `6 passed`; all four baseline methods pass upstream quick validation (the vendored UTF-8 skill-creator requires Python UTF-8 mode on Windows).
- Real-environment deterministic smoke started twelve cases. The first nine passed, including all five component kinds, semantic Pi tool output, both provider-length paths, profile selection, and periodic memory. The final three could not start a new official ARC bridge (`timed out waiting for ARC bridge readiness`, with zero environment/provider calls); an isolated real-environment retry failed at the same pre-runtime boundary. The same three cases passed with only the SDK environment mocked and all Pi/broker/router/action runtime boundaries real. Therefore code-path regression is not indicated, but the required all-cases real-environment smoke remains incomplete and no closure claim is made.
