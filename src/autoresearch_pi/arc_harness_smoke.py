"""ARC-runner self-harness diagnostics and real-provider evidence capture.

The model provider is deterministic, but every boundary under test is the
production ARC/Pi path. Real-provider mode reuses the production closure probe;
its captured evidence requires semantic review and is never a scripted pass.
"""

from __future__ import annotations

import json
import hashlib
import sys
from pathlib import Path
from typing import Any

from .arc_agi_3_e2e import run_arc_agi_3_e2e


SCENARIOS = ("memory", "skills", "tools", "subagents", "system_prompt")
PROFILE_HEADINGS = {
    "harness_component": "component",
    "composition": "composition",
    "task_decomposition": "task decomposition",
    "solution_path": "solution path",
    "strategy": "strategy and organization",
    "research_method": "research method",
}


def _records(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    values: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            values.append(value)
    return values


def _check(condition: bool, message: str, checks: list[dict[str, Any]]) -> None:
    checks.append({"check": message, "passed": bool(condition)})


def _validate_action_alignment(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    bridge_actions = [row for row in _records(root / "bridge-events.jsonl")
                      if row.get("event") == "action"]
    observations = _records(root / "execution-observations.jsonl")
    provider = _records(root / "arc-smoke-provider-contexts.jsonl")
    invocations = _records(root / "subagent-invocations.jsonl")
    starts = [row for row in _records(root / "pi-events.jsonl")
              if row.get("type") == "tool_execution_start"]
    _check([row.get("action") for row in bridge_actions] ==
           ["ACTION1", "ACTION2", "ACTION3", "ACTION4"],
           "delegated, batched and later parent actions reached the canonical bridge in order", checks)
    _check(any(row.get("tool_name") == "arc_action" and
               row.get("input", {}).get("delegated_invocation_id") for row in observations),
           "delegated action entered the parent action ledger", checks)
    _check(len([row for row in observations if row.get("batch_tool_call_id")]) == 2,
           "both batch actions entered the parent action ledger separately", checks)
    successful = [row for row in observations if row.get("tool_name") == "arc_action" and not row.get("is_error")]
    _check([row.get("arc_outcome", {}).get("action_budget", {}).get("total_used") for row in successful] == [1, 2, 3, 4],
           "parent, batch and delegated receipts share the native action sequence without duplicates", checks)
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    _check([row.get("action") for row in checkpoint.get("recent_actions", [])] == ["ACTION1", "ACTION2", "ACTION3", "ACTION4"]
           and checkpoint.get("latest_environment", {}).get("action_budget", {}).get("total_used") == 4,
           "delegated and batch results advance the same parent checkpoint", checks)
    _check(any(row.get("result", {}).get("arc_action_receipts") and
               "SMOKE_DELEGATED_ACTION" in str(row.get("result", {}).get("text", ""))
               for row in invocations),
           "ordinary delegate returned a semantic report and exact action receipt", checks)
    _check(any(row.get("child") and not row.get("research_child") and
               "arc_action" in row.get("tool_names", []) for row in provider),
           "only the explicitly authorized ordinary child received arc_action", checks)
    _check(any(not row.get("child") and row.get("system_has_delegated_action") for row in provider),
           "later parent input contained the delegated action result", checks)
    _check(any(not row.get("child") and row.get("system_has_batch_results") for row in provider),
           "later parent input contained both batch action results", checks)
    _check(any(row.get("toolName") == "arc_actions" for row in starts),
           "parent used the real batch tool", checks)
    _check(not any(row.get("toolName") == "arc_state" for row in starts)
           and all("arc_state" not in row.get("tool_names", [])
                   for row in provider if not row.get("child")),
           "parent receives complete observations without an arc_state tool or explicit reload", checks)
    return {"scenario": "action_alignment", "research_scope": None,
            "passed": all(item["passed"] for item in checks), "checks": checks,
            "run_root": str(root)}


def _validate_direct_use(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    _check(summary.get("runtime", {}).get("agent_actions") == 4, "four real ARC action boundaries completed", checks)
    starts = [r for r in _records(root / "pi-events.jsonl") if r.get("type") == "tool_execution_start"]
    _check(not any(r.get("toolName") == "read" or r.get("args", {}).get("action") == "read_method" for r in starts),
           "authored Skill and complete candidates used without compulsory rereads", checks)
    parent = [r for r in _records(root / "arc-smoke-provider-contexts.jsonl") if not r.get("child")]
    _check(any(r.get("direct_fact") and r.get("direct_unused") for r in parent), "capture+select projected both saved memory bodies", checks)
    _check(any(r.get("direct_fact") and not r.get("direct_unused") for r in parent)
           and not parent[-1].get("direct_unused"), "custom memory subset persists into later parent turns", checks)
    _check(any(r.get("direct_policy_v1") and not r.get("direct_policy_v2") for r in parent), "Prompt creation reached the next request", checks)
    _check(any(r.get("direct_policy_v2") and not r.get("direct_policy_v1") for r in parent), "Prompt update replaced the old overlay in the same run", checks)
    _check(not parent[-1].get("direct_policy_v1") and not parent[-1].get("direct_policy_v2"), "retired Prompt absent from later parent request", checks)
    invocations = _records(root / "subagent-invocations.jsonl")
    invocation = invocations[-1] if invocations else {}
    _check(len(invocations) == 1 and invocation.get("status") == "completed" and invocation.get("ephemeral")
           and invocation.get("component_ref") is None and not _records(root / "task-subagents.jsonl"),
           "one-off delegation delivered without creating a saved role", checks)
    child_result = json.loads(invocation.get("result", {}).get("text", "{}"))
    trials = _records(root / "task-harness-initial-trials.jsonl")
    trial = trials[-1] if trials else {}
    text = trial.get("result", {}).get("content", [{}])[0].get("text", "{}")
    tool_result = json.loads(text)
    snapshots = _records(root / "observation-snapshots.jsonl")
    ref = child_result.get("selected_ref")
    snapshot = next((r for r in snapshots if _snapshot_ref(r) == ref), {})
    frame = snapshot.get("public_state", {}).get("frames", [[]])[-1]
    expected = {"rows": len(frame), "columns": len(frame[0]) if frame else 0, "first": frame[0][0] if frame else None}
    _check(bool(frame) and trial.get("status") == "completed" and tool_result == expected
           and {"rows": child_result.get("rows"), "columns": child_result.get("columns"), "first": child_result.get("first_cell")} == expected,
           "native Tool and actual child report match the selected canonical ARC frame", checks)
    resumes = _records(root / "subagent-continuations.jsonl")
    _check(len(resumes) == 2 and resumes[0].get("stop_reason") == "length"
           and invocation.get("budget", {}).get("tool_calls") == 1,
           "one-off length resume retains one invocation and its budget", checks)
    _check(any(r.get("input", {}).get("decision", {}).get("used_resource_refs") for r in _records(root / "execution-observations.jsonl")),
           "later native ARC decision carries selected procedure/evidence references", checks)
    return {"scenario": "direct_use", "run_root": str(root), "checks": checks,
            "passed": all(item["passed"] for item in checks)}


def _observation_ids(refs: list[Any]) -> set[str]:
    values: set[str] = set()
    for ref in refs:
        text = str(ref)
        if text.startswith("observation:") and "@v" in text:
            text = text[len("observation:"):].rsplit("@v", 1)[0]
        values.add(text)
    return values


def _snapshot_ref(record: dict[str, Any]) -> str:
    return f"observation_snapshot:{record.get('snapshot_id')}@v{record.get('version', 1)}"


def _validate_scenario(
    root: Path,
    scenario: str,
    scope: str | None = None,
    *,
    periodic: bool = False,
    method_lifecycle: bool = False,
    method_rejection: bool = False,
    continuous_memory_pool: bool = False,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0, "real ARC Pi loop exited cleanly", checks)
    expected_actions = 7 if periodic else 3 if scenario in {"memory", "system_prompt"} else 2
    _check(runtime.get("agent_actions") == expected_actions, "expected real ARC action boundaries completed", checks)

    if scenario == "skills":
        windows = [row for row in _records(root / "task-validations.jsonl")
                   if row.get("source_hypothesis_id") == "smoke-delta-continuity"]
        latest = windows[-1] if windows else {}
        experiment = latest.get("experiment", {})
        evidence = [sample.get("facts", {}) for sample in experiment.get("samples", [])]
        bridge = {row.get("index"): row for row in _records(root / "bridge-events.jsonl")
                  if row.get("event") == "action"}
        _check(experiment.get("status") == "open" and experiment.get("actions_used") == 2
               and [row.get("action_index") for row in evidence] == [1, 2]
               and all(isinstance(row.get("changed_cells"), int)
                       and row["changed_cells"] == bridge.get(row["action_index"], {}).get(
                           "observation_delta", {}).get("changed_cells") for row in evidence),
               "undeclared continuation persists both canonical action delta counts", checks)

    events = _records(root / "pi-events.jsonl")
    parent_tools = [
        str(event.get("toolName"))
        for event in events
        if event.get("type") == "tool_execution_start"
    ]
    _check(parent_tools[:2] == ["task_harness", "arc_action"],
           "opening parent flow used the runtime-injected ARC state and created real action evidence", checks)
    _check("arc_state" not in parent_tools,
           "main Agent did not manually reload ARC state already injected by the adapter", checks)
    if periodic:
        reviews = _records(root / "task-harness-reviews.jsonl")
        handoffs = _records(root / "auto-research-handoffs.jsonl")
        sessions = _records(root / "auto-research-sessions.jsonl")
        _check(len(reviews) == 1 and len(reviews[0].get("entries", [])) == 6,
               "runtime expanded partial review and bound the pending opportunity", checks)
        _check(bool(sessions) and bool(sessions[-1].get("research_handoff_ref")),
               "parent selected the runtime's exact current handoff and started linked child", checks)
        _check(bool(handoffs) and handoffs[-1].get("status") == "completed",
               "periodic handoff completed before the later parent action", checks)
        _check(not _records(root / "task-operation-failures.jsonl"), "periodic control path had no operation failures", checks)

    progress = _records(root / "subagent-progress.jsonl")
    _check(any(item.get("event") == "spawned" and str(item.get("progress_id", "")).startswith("auto-research-1")
               for item in progress), "auto_research started a real child process through the broker", checks)
    _check(any(item.get("event") == "process_closed" and str(item.get("progress_id", "")).startswith("auto-research-1")
               for item in progress), "auto_research child process completed", checks)

    runs = _records(root / "auto-research-runs.jsonl")
    _check(bool(runs) and runs[-1].get("status") == "completed",
           "structured child report parsed as completed", checks)
    authoring_handoffs = _records(root / "parent-authoring-handoffs.jsonl")
    change_receipts = _records(root / "task-harness-change-receipts.jsonl")
    component_requires_creator = scenario in {"skills", "tools", "subagents"}
    if component_requires_creator:
        latest_handoff = authoring_handoffs[-1] if authoring_handoffs else {}
        _check([item.get("status") for item in authoring_handoffs[-2:]] ==
               ["awaiting_parent_authoring", "authored"]
               and latest_handoff.get("component_ref"),
               "runtime exposed a non-executable handoff and linked the later parent-authored version", checks)
    else:
        _check(not authoring_handoffs,
               "research produced no synthetic capability handoff when it returned no method candidate", checks)
    if not periodic:
        workflow = [event for event in events if event.get("type") == "tool_execution_start"
                    and not (event.get("toolName") == "task_harness"
                             and event.get("args", {}).get("action") == "read_method")]
        expected_prefix = (["task_harness", "arc_action", "task_memory_pool", "auto_research", "task_harness", "task_harness"]
                           if continuous_memory_pool else ["task_harness", "arc_action", "auto_research", "task_harness", "task_harness"])
        change_index = 4 if continuous_memory_pool else 3
        assemble_index = change_index + 1
        if scenario == "skills":
            expected_prefix[change_index] = "task_harness_create"
        _check([event.get("toolName") for event in workflow[:len(expected_prefix)]] == expected_prefix
               and (workflow[change_index].get("toolName") == "task_harness_create"
                    or workflow[change_index].get("args", {}).get("action") == "change")
               and workflow[assemble_index].get("args", {}).get("action") == "assemble",
               "parent researched from real action evidence, authored a complete candidate, then assembled its exact version", checks)
        auto_end = next((index for index, event in enumerate(events)
                         if event.get("type") == "tool_execution_end" and event.get("toolName") == "auto_research"), -1)
        change_start = next((index for index, event in enumerate(events)
                            if index > auto_end and event.get("type") == "tool_execution_start"
                            and (event.get("toolName") == "task_harness_create"
                                 or (event.get("toolName") == "task_harness"
                                     and event.get("args", {}).get("action") == "change"))), -1)
        _check(auto_end >= 0 and change_start > auto_end,
               "research returned before the parent submitted semantic component content", checks)
    _check(any(item.get("status") == "applied" for item in change_receipts),
           "runtime validated the parent-authored change and invoked the native harness executor", checks)

    materialization = {
        "memory": ("task-memory.jsonl", "key", "smoke-memory"),
        "skills": ("task-skills.jsonl", "name", "smoke-skill"),
        "tools": ("task-tools.jsonl", "name", "smoke-counter"),
        "subagents": ("task-subagents.jsonl", "name", "smoke-reviewer"),
        "system_prompt": ("task-system-prompt.jsonl", "name", "smoke-core-rule"),
    }


    file_name, identity, expected = materialization[scenario]
    resources = _records(root / file_name)
    _check(any(item.get(identity) == expected and item.get("status") == "active" for item in resources),
           f"native {scenario} resource materialized", checks)

    selected_ref = {
        "memory": "memory:smoke-memory@v1",
        "skills": "skill:smoke-skill@v1",
        "tools": "tool:smoke-counter@v1",
        "subagents": "subagent:smoke-reviewer@v1",
        "system_prompt": "system_prompt:smoke-core-rule@v1",
    }[scenario]
    assemblies = _records(root / "task-harness-assemblies.jsonl")
    _check(any(selected_ref in item.get("selected_resource_refs", []) for item in assemblies),
           "main Agent explicitly selected the exact materialized component version", checks)

    contexts = [item for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                if item.get("child") is False]
    next_turn = contexts
    _check(bool(contexts) and all(item.get("parent_decision_contract_present")
                                  or item.get("parent_guide_present") for item in contexts),
           "ARC parent receives the thin decision-cycle Auto-Research contract", checks)
    research_contexts = [item for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                         if item.get("research_child")]
    expected_headings = [PROFILE_HEADINGS[scope]] if scope in PROFILE_HEADINGS else []
    _check(bool(research_contexts) and all(item.get("child_guide_present")
               and not item.get("parent_guide_present")
               and item.get("profile_headings") == expected_headings
               and not item.get("delivery_guide_in_system") for item in research_contexts),
           "child receives only its common guide and selected research profile", checks)
    _check(bool(research_contexts) and all(item.get("submission_contract_seen") for item in research_contexts),
           "child received the structured research and method-candidate contract", checks)
    _check(bool(research_contexts) and all(item.get("child_creator_tools_absent")
                                          and "research_approval" not in item.get("tool_names", [])
                                          for item in research_contexts),
           "child had neither creators nor Harness mutation/approval tools", checks)
    prompt_loads = _records(root / "auto-research-prompt-loads.jsonl")
    _check(bool(prompt_loads) and all(item.get("scope") == (scope or "unspecified")
               and bool(item.get("profile_sha256")) == bool(expected_headings)
               for item in prompt_loads), "actual child profile load is recorded across continuations", checks)
    _check(bool(next_turn), "a later real parent provider turn occurred after authoring and assembly", checks)
    if scenario == "memory":
        _check(any(item.get("messages_have_memory_marker") is True for item in next_turn),
               "next parent turn received routed memory content", checks)
        if not periodic:
            _check(any(item.get("scoped_memory_expiry_verified") for item in contexts),
                   "real reset expired level/state memory while retaining task-scoped guidance on a later parent turn", checks)
            _check(any(item.get("knowledge_lifecycle_verified") for item in contexts),
                   "later real parent turn received replacement policy and suspended transitive stale guidance", checks)
        if continuous_memory_pool:
            pool_rows = [row for row in _records(root / "task-memory.jsonl") if row.get("key") == "smoke-captured-probe"]
            action_rows = [row for row in _records(root / "task-memory.jsonl")
                           if row.get("action_decision_observation_id") == "execution-observation-1"]
            assembly_refs = {ref for row in assemblies for ref in row.get("selected_resource_refs", [])}
            _check(len(pool_rows) == 1 and pool_rows[0].get("claim_kind") == "observation"
                   and pool_rows[0].get("basis_refs") == ["execution-observation-1"]
                   and pool_rows[0].get("validity", {}).get("scope") == "task",
                   "parent captured one free-form task-scoped Memory item with exact action evidence", checks)
            _check(len(action_rows) == 1 and action_rows[0].get("claim_kind") == "probe_record"
                   and action_rows[0].get("probe_record", {}).get("decision_capsule", {}).get("hypothesis")
                   == _records(root / "execution-observations.jsonl")[0].get("input", {}).get("decision", {}).get("hypothesis")
                   and "observation_delta" not in action_rows[0].get("probe_record", {}).get("observed_outcome", {})
                   and "verdict" not in action_rows[0].get("probe_record", {}),
                   "runtime indexed the verbatim parent decision separately from a public outcome without a verdict", checks)
            _check("memory:smoke-captured-probe@v1" in assembly_refs
                   and any(item.get("messages_have_capture_memory_marker") is True for item in next_turn)
                   and any(item.get("memory_pool_tool_available") is True for item in next_turn)
                   and next_turn[0].get("messages_have_capture_memory_marker") is False,
                   "later parent selected the captured pool version and received its content after explicit assembly", checks)
    elif scenario == "skills":
        _check(any(item.get("messages_have_skill_marker") is True for item in next_turn),
               "next parent turn received routed skill content", checks)
    elif scenario == "system_prompt":
        _check(any(item.get("system_has_marker") is True for item in next_turn),
               "next parent turn received routed system-prompt content", checks)
    elif scenario == "tools":
        tool_events = _records(root / "task-tool-events.jsonl")
        invoked = [item for item in tool_events if item.get("event") == "invoked"
                   and item.get("name") == "smoke-counter" and item.get("status") == "completed"]
        _check(bool(invoked) and invoked[-1].get("status") == "completed",
               "next parent turn invoked the routed native task tool", checks)
        _check(bool(invoked) and invoked[-1].get("output_excerpt") == "2"
               and invoked[-1].get("semantic_effect_observed") is True,
               "routed tool executed its program and returned semantic output 2", checks)
        if method_lifecycle:
            lifecycle = _records(root / "task-method-lifecycle.jsonl")
            research_methods = [item for item in lifecycle if item.get("author") != "parent"]
            parent_methods = [item for item in lifecycle if item.get("author") == "parent"]
            _check([item.get("maturity") for item in research_methods] == ["candidate_method"]
                   and [item.get("maturity") for item in parent_methods] == [
                       "candidate_method", "trial",
                       "contradicted" if method_rejection else "validated_within_scope",
                   ], "research method stayed method-only while the parent-authored trial advanced on actual use", checks)
            actual_use_ref = invoked[-1].get("invocation_id") if invoked else None
            expected_actual_use_ref = f"task-tool-use-{actual_use_ref}" if actual_use_ref else None
            _check(bool(parent_methods) and parent_methods[-1].get("actual_use_observation_refs") == [expected_actual_use_ref]
                   and parent_methods[-1].get("latest_assessment", {}).get("actual_use_refs") == [expected_actual_use_ref],
                   "method validation is bound to the routed tool's real semantic-use observation", checks)
            feedback = [item for item in _records(root / "auto-research-handoffs.jsonl")
                        if str(item.get("handoff_id", "")).startswith("method-feedback-")]
            _check(bool(feedback) and feedback[-1].get("status") == "proposed"
                   and feedback[-1].get("research_line_ref") == "research_line:arc-smoke-counter@v1"
                   and feedback[-1].get("completion_contract_kind") == "method_feedback_evaluation",
                   "actual-use assessment produced a same-line Auto-Research feedback handoff", checks)
            assessment_end = next((index for index, event in enumerate(events)
                                   if event.get("type") == "tool_execution_end"
                                   and event.get("toolName") == "task_harness"
                                   and event.get("result", {}).get("details", {}).get("effect_assessment_id")), -1)
            later_action = next((index for index, event in enumerate(events)
                                 if index > assessment_end and event.get("type") == "tool_execution_start"
                                 and event.get("toolName") == "arc_action"), -1)
            _check(assessment_end >= 0 and later_action > assessment_end,
                   "feedback was persisted before a later real ARC parent action boundary", checks)
            if method_rejection:
                rejected = [item for item in tool_events if item.get("status") == "failed"
                            and "method_requires_revision" in str(item.get("error", ""))]
                _check(bool(rejected) and len(invoked) == 1,
                       "failed semantic prediction blocked reuse of the exact version before any second execution", checks)
                assessments = _records(root / "effect-assessments.jsonl")
                _check(bool(assessments) and assessments[-1].get("verdict") == "unsupported"
                       and "predicted 3" in assessments[-1].get("consequence", ""),
                       "negative control compared actual numeric output 2 against candidate prediction 3", checks)
    else:
        invocations = _records(root / "subagent-invocations.jsonl")
        completed = [item for item in invocations if item.get("agent_name") == "smoke-reviewer"]
        _check(bool(completed) and completed[-1].get("status") == "completed"
               and completed[-1].get("result", {}).get("text") == "SMOKE_SUBAGENT_RESULT",
               "next parent turn delegated to the routed role and received its result", checks)
        continuations = _records(root / "subagent-continuations.jsonl")
        _check([item.get("stop_reason") for item in continuations] == ["length", "stop"],
               "ordinary delegate_task resumed a provider length boundary", checks)
        _check(len({item.get("invocation_id") for item in continuations}) == 1
               and len({item.get("native_session_id") for item in continuations}) == 1,
               "ordinary delegate continuation kept one invocation and native Pi session", checks)

    if scenario == "memory":
        continuations = _records(root / "auto-research-continuations.jsonl")
        checkpoint = continuations[0].get("checkpoint", {}) if continuations else {}
        _check(checkpoint.get("cursor") == "provider-output-length"
               and "observation:execution-observation-1@v1" in checkpoint.get("selected_resource_refs", [])
               and checkpoint.get("partial_output") == ""
               and checkpoint.get("evidence_read_count", 0) >= 1,
               "thinking-only length preserved runtime checkpoint and evidence progress", checks)
        child_contexts = [item for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                          if item.get("research_child") and item.get("request") == 0]
        _check(any((item.get("checkpoint_reloaded") or {}).get("cursor") == "provider-output-length"
                   and (item.get("checkpoint_reloaded") or {}).get("evidence_read_count", 0) >= 1
                   for item in child_contexts),
               "next real child process reloaded the saved research state", checks)
        _check(any((item.get("checkpoint_reloaded") or {}).get("evidence_read_count", 0) >= 2
                   and (item.get("checkpoint_reloaded") or {}).get("cursor") == "provider-output-length"
                   for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                   if item.get("research_child") and item.get("request", -1) >= 1),
               "resumed child advanced persisted evidence progress", checks)
        _check([item.get("stop_reason") for item in continuations] == ["length", "submitted_report"],
               "Auto-Research resumed a provider length boundary and submitted", checks)
        _check(len({item.get("session_id") for item in continuations}) == 1
               and len({item.get("native_session_id") for item in continuations}) == 1,
               "Auto-Research continuation kept one logical and native Pi session", checks)

    return {
        "scenario": scenario,
        "research_scope": scope,
        "passed": all(item["passed"] for item in checks),
        "checks": checks,
        "run_root": str(root),
    }


def _validate_cross_context_method(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False,
           "real ARC Pi loop completed without timeout", checks)
    _check(runtime.get("agent_actions") == 7 and runtime.get("environment_error_count") == 0,
           "seven irreversible ARC action boundaries completed the bounded online run", checks)

    events = _records(root / "pi-events.jsonl")
    starts = [event for event in events if event.get("type") == "tool_execution_start"]
    parent_sequence = [(event.get("toolName"), event.get("args", {}).get("action")) for event in starts
                       if not (event.get("toolName") == "task_harness"
                               and event.get("args", {}).get("action") == "read_method")]
    expected_prefix = [
        ("task_harness", "start"),
        ("arc_action", "ACTION1"), ("arc_action", "RESET"),
        ("arc_action", "ACTION2"), ("arc_action", "ACTION1"),
        ("task_harness", "inspect"), ("auto_research", "start"),
        ("task_harness", "change"),
        ("task_harness", "assemble"),
    ]
    expected_suffix = [
        ("task_harness", "assess_effect"), ("auto_research", "start"),
        ("task_harness", "inspect"), ("arc_action", "ACTION3"),
    ]
    expected_interstitial = [
        ("task_harness", "focus"), ("arc_action", "ACTION3"),
        ("task_harness", "defer_review"),
        ("task_harness", "inspect"), ("arc_action", "ACTION2"),
    ]
    # The small core discloses review/defer inputs on demand. Full-schema
    # diagnostics may already advertise them, so allow that single read only
    # at the deferral boundary; do not discard arbitrary contract operations.
    opportunity_reads = [event for event in starts if event.get("toolName") == "task_harness"
                         and event.get("args", {}).get("action") == "contract"]
    if opportunity_reads:
        expected_interstitial.insert(2, ("task_harness", "contract"))
    expected_sequence = expected_prefix + expected_interstitial + expected_suffix
    sequence_ok = (parent_sequence[:len(expected_sequence)] == expected_sequence
                   and len(opportunity_reads) <= 1
                   and all(event.get("args", {}).get("topic") == "opportunity" for event in opportunity_reads))
    _check(sequence_ok, "parent preserved the online sequence from two contexts through feedback research", checks)

    observations = _records(root / "execution-observations.jsonl")
    by_id = {item.get("observation_id"): item for item in observations}
    _check(by_id.get("execution-observation-1", {}).get("input", {}).get("action") == "ACTION1"
           and by_id.get("execution-observation-2", {}).get("input", {}).get("action") == "RESET"
           and by_id.get("execution-observation-3", {}).get("input", {}).get("action") == "ACTION2"
           and by_id.get("execution-observation-4", {}).get("input", {}).get("action") == "ACTION1",
           "same ARC action produced distinct observable transitions across a reset and intervening action", checks)

    opportunities = _records(root / "auto-research-opportunities.jsonl")
    opportunity = next((item for item in opportunities
                        if item.get("action_signature") == "arc_action:ACTION1"), {})
    _check(opportunity.get("causal_interpretation") is False
           and opportunity.get("semantic_equivalence_claimed") is False
           and opportunity.get("situation_basis") == "pre_action_state"
           and len(set(opportunity.get("situation_context_ids", []))) == 2
           and all("attempt:" not in str(item)
                   and "basis:pre_action_state" in str(item)
                   for item in opportunity.get("situation_context_ids", []))
           and set(opportunity.get("episode_context_ids", [])) == {
               "level:0:attempt:1", "level:0:attempt:2",
           }
           and set(opportunity.get("construction_evidence_refs", [])) == {
               "execution-observation-1", "execution-observation-4",
           }
           and "execution-observation-3" in opportunity.get("intervening_evidence_refs", []),
           "runtime discovered a causal-neutral candidate from public pre-action states rather than attempt identity",
           checks)
    sessions = _records(root / "auto-research-sessions.jsonl")
    construction_session = next((item for item in sessions
                                 if item.get("run_id") == "auto-research-1"
                                 and item.get("status") == "completed"), {})
    candidate_ref = (f"research_candidate:{opportunity.get('candidate_id')}@v{opportunity.get('version')}"
                     if opportunity else None)
    _check(candidate_ref is not None
           and construction_session.get("research_candidate_ref") == candidate_ref
           and set(construction_session.get("evidence_refs", [])) >= {
               "execution-observation-1", "execution-observation-3", "execution-observation-4",
           }, "parent selected one candidate ref and runtime expanded its exact evidence", checks)

    bundles = _records(root / "auto-research-comparison-bundles.jsonl")
    construction = next((item for item in bundles if item.get("run_id") == "auto-research-1"), {})
    repeated = construction.get("repeated_cases", [])
    repeated_action = next((item for item in repeated if item.get("action_signature") == "arc_action:ACTION1"), {})
    _check(construction.get("causal_interpretation") is False
           and construction.get("semantic_equivalence_claimed") is False,
           "code-built comparison remained causal-neutral", checks)
    _check(set(construction.get("selected_evidence_refs", [])) >= {
        "execution-observation-1", "execution-observation-3", "execution-observation-4",
    } and set(construction.get("episode_context_ids", [])) >= {
        "level:0:attempt:1", "level:0:attempt:2",
    } and repeated_action.get("context_count") == 2
       and repeated_action.get("episode_context_count") == 2,
           "comparison bundle retained two reset-separated construction cases and an explicit contrast", checks)

    construction_cards = [item for item in construction.get("evidence_cards", [])
                          if item.get("observation_ref") in {
                              "execution-observation-1", "execution-observation-4",
                          }]
    construction_pre_state_refs = {
        item.get("pre_action_condition", {}).get("canonical_detail_ref")
        for item in construction_cards
        if item.get("pre_action_condition", {}).get("canonical_detail_ref")
    }
    _check(len(construction_pre_state_refs) == 2
           and len({item.get("pre_action_condition", {}).get("fingerprint")
                    for item in construction_cards}) == 2
           and all(item.get("pre_action_condition", {}).get("basis") == "pre_action_state"
                   and item.get("pre_action_condition", {}).get("canonical_detail_ref")
                   in construction_pre_state_refs
                   for item in construction_cards),
           "construction cards retained distinct lossless public pre-action state references", checks)

    accesses = _records(root / "task-resource-access.jsonl")
    child_reads = [item.get("resource_ref") for item in accesses if item.get("reader") == "subagent"]
    _check(construction_pre_state_refs.issubset(set(child_reads))
           and "observation:execution-observation-1@v1" in child_reads
           and "observation:execution-observation-3@v1" in child_reads
           and "observation:execution-observation-4@v1" in child_reads,
           "construction child read both public pre-action states, construction observations, and the contrast", checks)

    reports = _records(root / "auto-research-reports.jsonl")
    first_report = next((item for item in reports if item.get("run_id") == "auto-research-1"), {})
    first_body = first_report.get("report", {})
    method_candidates = first_body.get("method_candidates") or []
    method_candidate = method_candidates[0] if method_candidates else {}
    method = method_candidate.get("method", {})
    _check(_observation_ids(first_body.get("evidence_refs", [])) >= {
        "execution-observation-1", "execution-observation-3", "execution-observation-4",
    } and _observation_ids(method.get("construction_evidence_refs", [])) >= {
        "execution-observation-1", "execution-observation-4",
    } and _observation_ids(method.get("contrast_evidence_refs", [])) >= {
        "execution-observation-3",
    }, "child grounded the method in two contexts and an explicit contrast", checks)
    method_text = "\n".join(str(value) for value in [
        method.get("problem", ""), method.get("applicability", ""), method.get("abstain_when", ""),
        *(method.get("inputs", []) or []), *(method.get("steps", []) or []),
        *(method.get("decision_points", []) or []), *(method.get("failure_modes", []) or []),
    ])
    _check(method.get("abstraction_scope") == "cross_context"
           and bool(method.get("applicability")) and bool(method.get("abstain_when"))
           and bool(method.get("invariants")) and bool(method.get("parameters"))
           and bool(method.get("steps")) and bool(method.get("falsifier"))
           and not any(token in method_text.lower() for token in ["obs-", "rows", "changed cells", "palette"]),
           "child returned a cross-context, applicable method with abstention rather than a trajectory recap", checks)
    authoring_handoffs = _records(root / "parent-authoring-handoffs.jsonl")
    authored_handoff = authoring_handoffs[-1] if authoring_handoffs else {}
    _check(first_body.get("harness_proposals") == []
           and method_candidate.get("candidate_ref") == "cross-context-smoke-method"
           and [item.get("status") for item in authoring_handoffs[-2:]] ==
               ["awaiting_parent_authoring", "authored"]
           and authored_handoff.get("component_ref") == "skill:smoke-action-method@v1"
           and authored_handoff.get("change_call_template", {}).get("executable") is False,
           "child returned only a method; parent creator authoring produced the linked skill version", checks)

    lifecycle = _records(root / "task-method-lifecycle.jsonl")
    research_lifecycle = [item for item in lifecycle if item.get("author") != "parent"]
    parent_lifecycle = [item for item in lifecycle if item.get("author") == "parent"]
    _check([item.get("maturity") for item in research_lifecycle] == ["candidate_method"]
           and [item.get("maturity") for item in parent_lifecycle] ==
               ["candidate_method", "trial", "trial"],
           "research method stayed method-only while parent authoring, application and assessment remained distinct", checks)
    _check(bool(lifecycle) and lifecycle[0].get("generalization_basis") == "cross_context"
           and lifecycle[0].get("generalization_scope") == "cross_episode"
           and set(lifecycle[0].get("episode_context_ids", [])) == {
               "level:0:attempt:1", "level:0:attempt:2",
           } and len(lifecycle[0].get("context_ids", [])) == 2,
           "method lifecycle retained its exact cross-context generalization basis", checks)

    resource_refs = parent_lifecycle[1].get("resource_refs", []) if len(parent_lifecycle) >= 2 else []
    _check(bool(resource_refs) and any(str(ref).startswith("skill:") for ref in resource_refs),
           "parent-authored method procedure entered a bounded trial as an exact harness version", checks)
    exposures = _records(root / "task-harness-context-exposures.jsonl")
    exact_skill_exposed = any(any(
        item.get("name") == "smoke-action-method" and item.get("version") == 1
        for item in exposure.get("skill_versions", [])
    ) for exposure in exposures)
    scalar_carrier_intent = any(
        item.get("carrier") == "skill"
        for item in _records(root / "task-harness-conversion-intents.jsonl")
    )
    provider_contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    later_action = next((item for item in observations
                         if item.get("tool_name") == "arc_action"
                         and item.get("input", {}).get("decision", {}).get("basis_refs") == resource_refs), {})
    later_action_start = next((item for item in starts
                               if item.get("toolName") == "arc_action"
                               and item.get("args", {}).get("decision", {}).get("basis_refs") == resource_refs), {})
    try:
        provider_request = int(str(later_action_start.get("toolCallId", "")).rsplit("-", 1)[1]) - 1
    except (IndexError, ValueError):
        provider_request = None
    action_provider_context = next((item for item in provider_contexts
                                    if item.get("child") is False and item.get("request") == provider_request), {})
    actual_use_ref = later_action.get("observation_id")
    cited_basis = later_action.get("input", {}).get("decision", {}).get("basis_refs", [])
    decision = later_action.get("input", {}).get("decision", {})
    _check(later_action.get("tool_name") == "arc_action"
           and bool(resource_refs) and cited_basis == resource_refs
           and exact_skill_exposed
           and scalar_carrier_intent
           and action_provider_context.get("messages_have_exact_method_skill_projection") is True
           and bool(decision.get("prediction")) and bool(decision.get("falsifier")) and len(parent_lifecycle) >= 3
           and parent_lifecycle[2].get("actual_use_observation_refs") == [actual_use_ref],
           "evaluation credited the later ARC action selected from the exact read procedure version", checks)

    handoffs = _records(root / "auto-research-handoffs.jsonl")
    feedback_versions = [item for item in handoffs
                         if item.get("handoff_id") == "method-feedback-effect-assessment-1"]
    _check([item.get("status") for item in feedback_versions] == ["proposed", "completed"],
           "feedback handoff started and completed a second Auto-Research child", checks)
    second_report = next((item for item in reports if item.get("run_id") == "auto-research-2"), {})
    _check(second_report.get("research_line_ref") == opportunity.get("research_line_ref")
           and second_report.get("report", {}).get("status") in {
               "supported_within_scope", "contradicted", "inconclusive", "provisional",
           },
           "feedback research returned on the same research line", checks)
    _check(f"observation:{actual_use_ref}@v1" in child_reads
           and "observation:execution-observation-3@v1" in child_reads,
           "feedback child read actual use alongside construction and contrast evidence", checks)
    _check(not _records(root / "task-operation-failures.jsonl"),
           "cross-context method loop had no operation failures", checks)

    return {
        "scenario": "cross_context_method",
        "research_scope": "research_method",
        "passed": all(item["passed"] for item in checks),
        "checks": checks,
        "run_root": str(root),
    }


def _validate_pure_expression_scenario(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False,
           "pure-expression real ARC Pi loop completed without timeout", checks)
    _check(runtime.get("agent_actions") == 2 and runtime.get("environment_error_count") == 0,
           "two real ARC action boundaries completed without environment errors", checks)

    events = _records(root / "pi-events.jsonl")
    starts = [event for event in events if event.get("type") == "tool_execution_start"]
    workflow = [(event.get("toolName"), event.get("args", {}).get("action")) for event in starts]
    expected_workflow = [
        ("task_harness", "read_method"),
        ("task_harness", "change"),
        ("task_harness", "assemble"),
        ("task_tool_smoke-frame-row-count_v1", None),
        ("arc_action", "ACTION1"),
        ("task_tool_smoke-frame-row-count_v1", None),
        ("arc_action", "ACTION2"),
    ]
    _check(workflow[:len(expected_workflow)] == expected_workflow,
           "parent read tool-creator, authored, assembled, used, acted, then intentionally rebound history", checks)
    invocation_args = [event.get("args", {}) for event in starts
                       if event.get("toolName") == "task_tool_smoke-frame-row-count_v1"]
    _check(len(invocation_args) == 2 and all(args.get("parameters") == {}
           and args.get("bindings") == [{"name": "grid", "ref": "observation_snapshot:parent-state-1@v1",
                                          "path": ["public_state", "frames", 0]}]
           for args in invocation_args),
           "both calls used the native parameters/bindings envelope and exact public frame path", checks)

    creator_reads = _records(root / "task-baseline-method-reads.jsonl")
    creator = next((item for item in creator_reads if item.get("name") == "tool-creator"
                    and item.get("actor") == "parent"), {})
    _check(bool(creator.get("method_ref")) and creator.get("origin") == "baseline",
           "main Agent actually read the exact tool-creator baseline", checks)

    receipts = _records(root / "task-harness-change-receipts.jsonl")
    result = receipts[-1].get("results", [{}])[0] if receipts else {}
    _check(bool(receipts) and receipts[-1].get("status") == "applied"
           and result.get("native_tool") == "task_tool"
           and result.get("resource", {}).get("resource_ref") == "tool:smoke-frame-row-count@v1",
           "task_harness change classified and applied the parent-authored tool candidate", checks)

    tools = [item for item in _records(root / "task-tools.jsonl")
             if item.get("name") == "smoke-frame-row-count"]
    tool = tools[-1] if tools else {}
    _check(len(tools) == 1 and tool.get("status") == "active"
           and tool.get("implementation_ref") == "task.local.pure_expression"
           and tool.get("authoring_method_ref") == creator.get("method_ref"),
           "native tool materialization retained the creator receipt and pure implementation boundary", checks)
    _check(tool.get("program", {}).get("format") == "task-pure-expression-v1"
           and tool.get("program", {}).get("expression", {}).get("op") == "length"
           and tool.get("output_schema") == {"type": "number"}
           and all(len(str(tool.get(key, ""))) == 64 for key in (
               "program_sha256", "input_schema_sha256", "output_schema_sha256")),
           "materialized tool retained exact pure program and input/output schema hashes", checks)

    assemblies = _records(root / "task-harness-assemblies.jsonl")
    _check(bool(assemblies) and assemblies[-1].get("selected_resource_refs") ==
           ["tool:smoke-frame-row-count@v1"]
           and assemblies[-1].get("selection_mode") == "explicit",
           "main Agent assembled only the exact authored tool version", checks)

    snapshots = _records(root / "observation-snapshots.jsonl")
    first_ref = _snapshot_ref(snapshots[0]) if snapshots else ""
    second_ref = _snapshot_ref(snapshots[1]) if len(snapshots) > 1 else ""
    frame = snapshots[0].get("public_state", {}).get("frames", [[]])[0] if snapshots else []
    _check(len(snapshots) >= 2 and first_ref == "observation_snapshot:parent-state-1@v1"
           and second_ref == "observation_snapshot:parent-state-2@v1"
           and snapshots[0].get("decision_cycle_sequence") == 1
           and snapshots[1].get("decision_cycle_sequence") == 2
           and isinstance(frame, list),
           "real ARC decision cycles auto-captured two ordered immutable public snapshots", checks)

    contexts = [item for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                if item.get("child") is False]
    announcements = [ref for item in contexts for ref in item.get("announced_snapshot_refs", [])]
    _check(first_ref in announcements and second_ref in announcements
           and announcements.index(first_ref) < announcements.index(second_ref),
           "provider contexts auto-announced the first snapshot and a new later-turn snapshot", checks)

    tool_events = [item for item in _records(root / "task-tool-events.jsonl")
                   if item.get("event") == "invoked" and item.get("name") == "smoke-frame-row-count"]
    _check(len(tool_events) == 2 and all(item.get("status") == "completed" for item in tool_events),
           "the selected native pure tool completed once before and once after the ARC boundary", checks)
    expected_count = len(frame) if isinstance(frame, list) else None
    semantic_outputs: list[Any] = []
    for item in tool_events:
        try:
            semantic_outputs.append(json.loads(str(item.get("output_excerpt", ""))))
        except json.JSONDecodeError:
            semantic_outputs.append(None)
    _check(expected_count is not None and semantic_outputs == [expected_count, expected_count],
           "both executions returned the semantic row count of the exact bound frame", checks)

    pure_details = [item.get("pure_expression", {}) for item in tool_events]
    _check(len(pure_details) == 2 and all(item.get("representation") == "task-pure-expression-v1"
           and item.get("output_schema_validated") is True
           and item.get("consumed", {}).get("steps", 0) > 0
           and len(str(item.get("output_sha256", ""))) == 64 for item in pure_details),
           "bounded evaluator recorded schema-validated semantic outputs and consumption", checks)

    provenances = [item.get("input_provenance", {}) for item in pure_details]
    first_binding = provenances[0].get("bindings", [{}])[0] if provenances else {}
    second_binding = provenances[1].get("bindings", [{}])[0] if len(provenances) > 1 else {}
    # Binding paths are serialized JSON strings, including array indices.
    exact_path = ["public_state", "frames", "0"]
    _check(first_binding.get("ref") == first_ref and first_binding.get("path") == exact_path
           and first_binding.get("historical_or_stale") is False,
           "first invocation bound the actual current snapshot's public frame path with fresh provenance", checks)
    _check(second_binding.get("ref") == first_ref and second_binding.get("path") == exact_path
           and second_binding.get("historical_or_stale") is True
           and second_binding.get("capture_boundary") != second_binding.get("current_observed_boundary"),
           "later invocation intentionally reused the old exact ref and recorded stale historical provenance", checks)

    _check(bool(first_binding.get("record_sha256"))
           and first_binding.get("record_sha256") == second_binding.get("record_sha256")
           and first_binding.get("content_sha256") == second_binding.get("content_sha256")
           and first_binding.get("resolved_value_sha256") == second_binding.get("resolved_value_sha256")
           and second_binding.get("resolved_value_bytes", 0) > 0,
           "later binding resolver read the same immutable historical record and value", checks)

    start_names = [event.get("toolName") for event in starts]
    first_use_index = start_names.index("task_tool_smoke-frame-row-count_v1") if tool_events else -1
    first_action_index = start_names.index("arc_action") if "arc_action" in start_names else -1
    second_use_index = (start_names.index("task_tool_smoke-frame-row-count_v1", first_use_index + 1)
                        if first_use_index >= 0 and start_names.count("task_tool_smoke-frame-row-count_v1") > 1 else -1)
    _check(0 <= first_use_index < first_action_index < second_use_index,
           "historical binding read and reuse occurred only after the first irreversible ARC action", checks)

    observations = [item for item in _records(root / "harness-observations.jsonl")
                    if item.get("observation_kind") == "pi_task_tool_invocation"]
    _check(len(observations) == 2 and all(item.get("actual_use") is True
           and item.get("semantic_effect_observed") is True for item in observations),
           "both semantic tool results were recorded as real selected-component use", checks)
    _check(not _records(root / "task-operation-failures.jsonl")
           and not [event for event in events
                    if event.get("type") == "tool_execution_end" and event.get("isError")],
           "pure-expression real-bridge scenario had no task operation failures", checks)

    return {
        "scenario": "pure_expression",
        "research_scope": None,
        "passed": all(item["passed"] for item in checks),
        "checks": checks,
        "run_root": str(root),
    }


def _validate_source_handoff(root: Path) -> dict[str, Any]:
    """Interpret actual child, native source and canonical frame receipts."""
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime", {})
    _check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False,
           "source-handoff ARC Pi loop completed without timeout", checks)
    _check(runtime.get("agent_actions") == 3 and runtime.get("environment_error_count") == 0,
           "three real ARC action boundaries completed without environment errors", checks)
    progress = _records(root / "subagent-progress.jsonl")
    _check(any(row.get("event") == "spawned" for row in progress)
           and any(row.get("event") == "process_closed" and row.get("phase") == "completed" for row in progress),
           "the real broker launched and completed the research child process", checks)
    reports = _records(root / "auto-research-reports.jsonl")
    report = reports[-1].get("report", {}) if reports else {}
    candidates = report.get("method_candidates", [])
    candidate = candidates[0] if len(candidates) == 1 else {}
    program = candidate.get("program", {})
    _check(candidate.get("semantic_kind") == "computation" and program.get("format") == "task-pure-python-v1"
           and bool(program.get("source")) and report.get("harness_proposals") == [],
           "structured child report retained bounded source without a component mutation", checks)
    handoffs = _records(root / "parent-authoring-handoffs.jsonl")
    original = handoffs[0] if handoffs else {}
    _check(original.get("computation_candidate") == {key: candidate.get(key)
               for key in ("program", "input_schema", "output_schema")}
           and original.get("change_call_template", {}).get("executable") is False
           and [row.get("status") for row in handoffs] == ["awaiting_parent_authoring", "authored"],
           "parent received exact candidate content and explicitly authored it", checks)
    tools = [row for row in _records(root / "task-tools.jsonl") if row.get("name") == "source-frame"]
    source = tools[0].get("program_source_evidence", {}) if len(tools) == 1 else {}
    _check(len(tools) == 1 and source.get("source") == program.get("source")
           and source.get("source_sha256") == hashlib.sha256(str(program.get("source", "")).encode()).hexdigest(),
           "native materialization compiled the exact child-authored source once", checks)
    assemblies = _records(root / "task-harness-assemblies.jsonl")
    _check(bool(assemblies) and assemblies[-1].get("selected_resource_refs") == ["tool:source-frame@v1"],
           "parent selected the exact native source tool version", checks)
    starts = [row for row in _records(root / "pi-events.jsonl") if row.get("type") == "tool_execution_start"]
    publication = next((i for i, row in enumerate(starts) if row.get("toolName") == "task_harness_create"), -1)
    research = next((i for i, row in enumerate(starts) if row.get("toolName") == "auto_research"), -1)
    later_action = next((i for i, row in enumerate(starts) if row.get("toolName") == "arc_action"
                         and row.get("args", {}).get("action") == "ACTION2"), -1)
    later_use = max((i for i, row in enumerate(starts) if row.get("toolName") == "task_tool_source-frame_v1"), default=-1)
    _check(0 <= research < publication < later_action < later_use,
           "source use continued after explicit publication and a later real ARC action", checks)
    _check(not any(row.get("toolName") == "task_harness" and row.get("args", {}).get("method_name") == "tool-creator"
                   for row in starts), "source adoption did not restore a creator-read prerequisite", checks)
    snapshots = {_snapshot_ref(row): row for row in _records(root / "observation-snapshots.jsonl")}
    invoked = [row for row in _records(root / "task-tool-events.jsonl")
               if row.get("event") == "invoked" and row.get("name") == "source-frame"]
    outputs: list[Any] = []
    bound_refs: list[str] = []
    correct = len(invoked) == 3
    for row in invoked:
        details = row.get("pure_expression", {})
        bindings = details.get("input_provenance", {}).get("bindings", [])
        binding = bindings[0] if len(bindings) == 1 else {}
        ref = binding.get("ref", "")
        bound_refs.append(ref)
        frames = snapshots.get(ref, {}).get("public_state", {}).get("frames", [])
        frame = frames[0] if frames else []
        try:
            value = json.loads(row.get("output_excerpt", ""))
        except (ValueError, TypeError):
            value = None
        expected = {"rows": len(frame), "columns": len(frame[0]), "first": frame[0][0]} if frame and frame[0] else None
        outputs.append(value)
        correct = correct and expected is not None and value == expected and row.get("status") == "completed"
        correct = correct and binding.get("path") in (["public_state", "frames", "0"], ["public_state", "frames", 0])
    _check(correct, "trial and both later uses returned the bound canonical frame's exact dimensions and first cell", checks)
    _check(len(bound_refs) == 3 and bound_refs[0] == bound_refs[1] and bound_refs[2] != bound_refs[1],
           "the same source version was rebound to a newer exact public snapshot", checks)
    provider = _records(root / "arc-smoke-provider-contexts.jsonl")
    _check(any(not row.get("child") and row.get("source_handoff_visible") for row in provider),
           "real parent provider input contained the child's source handoff", checks)
    _check(bool(outputs) and any(not row.get("child") and outputs[-1] in row.get("source_native_results", []) for row in provider),
           "a later real parent provider turn received the native semantic result", checks)
    return {"scenario": "source_handoff", "research_scope": "harness_component", "checks": checks,
            "passed": all(row["passed"] for row in checks), "run_root": str(root)}


def _validate_minimal_five_pool(root: Path, *, publication: bool = False) -> dict[str, Any]:
    """Validate direct parent authoring and later use of the five native kinds.

    This intentionally checks the pool before assembly and does not require a
    research report, method dossier, or auto-generated handoff.  The provider
    still drives the real ARC/Pi/broker path; these checks only interpret its
    persisted receipts and semantic uses.
    """
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False,
           "minimal five-component real ARC Pi loop completed without timeout", checks)
    _check(runtime.get("agent_actions") == 2 and runtime.get("environment_error_count") == 0,
           "two later real ARC action boundaries completed without environment errors", checks)

    events = _records(root / "pi-events.jsonl")
    starts = [event for event in events if event.get("type") == "tool_execution_start"]
    workflow = [(event.get("toolName"), event.get("args", {}).get("action")) for event in starts]
    expected_prefix = [
        ("task_harness", "start"),
        ("task_harness", "read_method"),
        ("task_harness", "read_method"),
        ("task_harness", "read_method"),
        ("task_harness", "change"),
        ("task_harness", "inspect"),
        ("task_harness", "status" if publication else "assemble"),
        ("task_harness", "inspect"),
    ]
    _check(workflow[:len(expected_prefix)] == expected_prefix,
           "parent created and explicitly selected all five candidates in one call" if publication else
           "parent created all five candidates, inspected the unselected pool, then explicitly assembled it", checks)
    assemble_index = next((index for index, item in enumerate(workflow)
                           if item == ("task_harness", "assemble")), -1)
    if publication:
        _check(assemble_index == -1, "publication did not require a separate parent assembly call", checks)
        assemble_index = next((index for index, item in enumerate(workflow)
                               if item == ("task_harness", "change")), -1)
    tool_index = next((index for index, item in enumerate(workflow)
                       if item == ("task_tool_pool-tool_v1", None)), -1)
    delegate_index = next((index for index, item in enumerate(workflow)
                           if item == ("delegate_task", None)), -1)
    _check(assemble_index >= 0 and tool_index > assemble_index,
           "the selected Pi tool was used only after exact assembly", checks)
    _check(assemble_index >= 0 and delegate_index > assemble_index,
           "the selected subagent role was delegated only after exact assembly", checks)
    ends_by_call = {event.get("toolCallId"): event for event in events
                    if event.get("type") == "tool_execution_end"}
    read_index = next((index for index, item in enumerate(starts)
                      if item.get("toolName") == "read"
                      and Path(item.get("args", {}).get("path", "")).resolve()
                      == (root / "task-harness/skills/pool-skill/SKILL.md").resolve()), -1)
    skill_action_index = next((index for index, item in enumerate(starts)
                               if item.get("toolName") == "arc_action"
                               and "skill:pool-skill@v1" in item.get("args", {}).get("decision", {}).get("basis_refs", [])), -1)
    read_start = starts[read_index] if read_index >= 0 else {}
    read_end = ends_by_call.get(read_start.get("toolCallId"), {})
    read_success = (read_end.get("isError") is not True
                    and "SMOKE_POOL_SKILL" in json.dumps(read_end.get("result", {})))
    _check(assemble_index >= 0 and assemble_index < read_index < skill_action_index and read_success,
           "later parent successfully read the exact Skill body before citing it on an ARC action", checks)
    _check(not any(item == ("task_harness", "focus") for item in workflow),
           "loading the selected Skill did not implicitly narrow the composed Harness", checks)
    inspect_bodies: list[dict[str, Any]] = []
    for event in starts:
        if event.get("toolName") != "task_harness" or event.get("args", {}).get("action") != "inspect":
            continue
        end = ends_by_call.get(event.get("toolCallId"), {})
        content = end.get("result", {}).get("content", [])
        text = content[0].get("text", "") if content and isinstance(content[0], dict) else ""
        try:
            parsed = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            parsed = {}
        if isinstance(parsed, dict):
            inspect_bodies.append(parsed)
    expected_refs = [
        "memory:pool-memory@v1", "skill:pool-skill@v1", "tool:pool-tool@v1",
        "subagent:pool-reviewer@v1", "system_prompt:pool-rule@v1",
    ]
    def pool_state(body: dict[str, Any]) -> dict[str, tuple[bool, bool]]:
        if body.get("format") == "task-harness-status-section-v1" and body.get("section") == "component_pool":
            rows = body.get("value", [])
        else:
            rows = body.get("component_pool", [])
        return {str(row.get("resource_ref")): (row.get("eligible") is True, row.get("selected") is True)
                for row in rows if isinstance(row, dict)}
    first_pool = pool_state(inspect_bodies[0]) if inspect_bodies else {}
    second_pool = pool_state(inspect_bodies[1]) if len(inspect_bodies) > 1 else {}
    _check(set(first_pool) >= set(expected_refs)
           and all(first_pool[ref] == (True, publication) for ref in expected_refs),
           "first pool inspection exposed all five eligible refs as selected" if publication else
           "first pool inspection exposed all five eligible refs as unselected", checks)
    _check(set(second_pool) >= set(expected_refs)
           and all(second_pool[ref] == (True, True) for ref in expected_refs),
           "later pool inspection exposed all five exact refs as selected", checks)

    _check(not _records(root / "auto-research-runs.jsonl")
           and not _records(root / "parent-authoring-handoffs.jsonl"),
           "pool creation did not require research or a synthetic child authoring handoff", checks)
    receipts = _records(root / "task-harness-change-receipts.jsonl")
    result_refs = [item.get("resource", {}).get("resource_ref") for receipt in receipts
                   if receipt.get("status") == "applied" for item in receipt.get("results", [])]
    _check(bool(receipts) and receipts[-1].get("status") == "applied"
           and set(result_refs) == set(expected_refs) and len(result_refs) == 5,
           "one native change receipt materialized exactly five parent-authored versions", checks)
    if publication:
        combined = _records(root / "task-harness-publication-receipts.jsonl")
        receipt = combined[-1] if combined else {}
        request = starts[assemble_index].get("args", {}).get("assembly", {}) if assemble_index >= 0 else {}
        _check(len(combined) == 1 and receipt.get("requested_assembly") == request
               and request.get("expected_assembly_revision") == 0
               and request.get("selected_resource_refs") == [],
               "parent explicitly authorized selecting this call's new versions with current CAS", checks)
        selected = receipt.get("assembly_receipt", {}).get("current_assembly", {})
        _check(receipt.get("assembly_receipt", {}).get("applied") is True
               and selected.get("selected_resource_refs") == expected_refs
               and selected.get("revision") == 1,
               "combined receipt confirms all five exact native versions selected in the same call", checks)
        _check("assemble_template" not in receipt.get("activation", {})
               and all(item.get("selection_call") is None
                       for item in receipt.get("activation", {}).get("created_resources", [])),
               "successful publication receipt does not repeat already completed selection work", checks)
    readiness = receipts[-1].get("activation", {}).get("created_resources", []) if receipts else []
    skill_entry = next((item for item in readiness if item.get("resource_ref") == "skill:pool-skill@v1"), {})
    skill_use = skill_entry.get("use_after_selection", {})
    _check(skill_use.get("load_if_needed", {}).get("tool") == "read"
           and Path(skill_use.get("load_if_needed", {}).get("arguments", {}).get("path", "")).resolve()
           == (root / "task-harness/skills/pool-skill/SKILL.md").resolve(),
           "creation receipt supplied the exact confined optional Skill load entry", checks)

    materialization = {
        "memory": ("task-memory.jsonl", "key", "pool-memory", "memory:pool-memory@v1"),
        "skill": ("task-skills.jsonl", "name", "pool-skill", "skill:pool-skill@v1"),
        "tool": ("task-tools.jsonl", "name", "pool-tool", "tool:pool-tool@v1"),
        "subagent": ("task-subagents.jsonl", "name", "pool-reviewer", "subagent:pool-reviewer@v1"),
        "system_prompt": ("task-system-prompt.jsonl", "name", "pool-rule", "system_prompt:pool-rule@v1"),
    }
    for kind, (filename, identity, expected, ref) in materialization.items():
        rows = [row for row in _records(root / filename) if row.get(identity) == expected]
        row = rows[0] if rows else {}
        _check(len(rows) == 1 and row.get("version") == 1 and row.get("status") == "active",
               f"native {kind} candidate persisted as one active version in the pool", checks)
        if kind in {"skill", "tool", "subagent"}:
            _check("method" not in row,
                   f"{kind} candidate did not require or invent a universal method dossier", checks)
        if kind == "memory":
            _check(row.get("atom", {}).get("value") == "SMOKE_POOL_MEMORY"
                   and row.get("validity", {}).get("scope") == "task",
                   "memory retained authored atom and explicit lifecycle validity", checks)
        if kind == "system_prompt":
            _check(row.get("content") == "SMOKE_POOL_SYSTEM: use only actions advertised by current ARC state."
                   and row.get("scope") == "this deterministic ARC smoke task",
                   "standalone system-prompt candidate retained its body and scope", checks)

    assemblies = _records(root / "task-harness-assemblies.jsonl")
    assembly = assemblies[-1] if assemblies else {}
    _check(assembly.get("selection_mode") == "explicit"
           and assembly.get("selected_resource_refs") == expected_refs
           and assembly.get("revision") == 1,
           "later parent selected all five exact current refs with an explicit assembly CAS", checks)
    assembly_receipts = _records(root / "task-harness-assembly-receipts.jsonl")
    entries = assembly_receipts[-1].get("components", []) if assembly_receipts else []
    _check({item.get("resource_ref") for item in entries} == set(expected_refs)
           and all(item.get("use") for item in entries),
           "assembly receipt gave typed use entries for all five selected components", checks)

    # Terminal outcome review intentionally omits live gameplay projections.
    # The provider records the phase from Pi's latest native prompt boundary.
    contexts = [row for row in _records(root / "arc-smoke-provider-contexts.jsonl")
                if row.get("child") is False and row.get("terminal_review") is not True]
    latest_context = contexts[-1] if contexts else {}
    _check(any(row.get("messages_have_pool_memory_marker") is True
               for row in contexts if int(row.get("request", -1)) >= 7),
           "a later parent context after exact assembly received the selected memory body", checks)
    _check(latest_context.get("messages_have_pool_skill_marker") is True,
           "later parent context contained the selected Skill body after exact scoped read", checks)
    after_read_request = next((int(row.get("request", -1)) for row in contexts
                               if "read" in row.get("tool_names", []) and int(row.get("request", -1)) > 8), -1)
    after_read_contexts = [row for row in contexts if int(row.get("request", -1)) >= after_read_request]
    _check(after_read_request >= 0 and bool(after_read_contexts)
           and all(row.get("messages_have_pool_memory_marker") is True for row in after_read_contexts),
           "selected Memory remained in the live projection after Skill read, Tool and Subagent use", checks)
    _check(any("read" in row.get("tool_names", []) for row in contexts if int(row.get("request", -1)) >= 7),
           "Skill assembly exposed the already-authorized confined read schema", checks)
    _check(latest_context.get("system_has_pool_marker") is True,
           "later parent context retained the standalone system-prompt selection", checks)
    action_basis = starts[skill_action_index].get("args", {}).get("decision", {}).get("basis_refs", []) if skill_action_index >= 0 else []
    _check({"skill:pool-skill@v1", "memory:pool-memory@v1", "system_prompt:pool-rule@v1"} <= set(action_basis),
           "parent action explicitly used the composed Skill, Memory and policy basis", checks)

    tool_events = [row for row in _records(root / "task-tool-events.jsonl")
                   if row.get("event") == "invoked" and row.get("name") == "pool-tool"]
    _check(len(tool_events) == 1 and tool_events[0].get("status") == "completed"
           and tool_events[0].get("output_excerpt") == "2"
           and tool_events[0].get("semantic_effect_observed") is True,
           "later parent used the selected Pi tool and received semantic output 2", checks)
    invocations = [row for row in _records(root / "subagent-invocations.jsonl")
                   if row.get("agent_name") == "pool-reviewer"]
    _check(len(invocations) == 1 and invocations[0].get("status") == "completed"
           and invocations[0].get("result", {}).get("text") == "SMOKE_SUBAGENT_RESULT",
           "later parent used the selected subagent role and received its semantic result", checks)
    observations = [row for row in _records(root / "harness-observations.jsonl")
                    if row.get("actual_use") is True]
    _check(bool(observations) and any(row.get("semantic_effect_observed") is True for row in observations),
           "selected component use was recorded as semantic harness observation", checks)
    _check(not _records(root / "task-operation-failures.jsonl")
           and not [event for event in events if event.get("type") == "tool_execution_end" and event.get("isError")],
           "minimal five-component pool path had no task operation failures", checks)
    return {
        "scenario": "minimal_five_publish" if publication else "minimal_five_pool",
        "research_scope": None,
        "passed": all(item["passed"] for item in checks),
        "checks": checks,
        "run_root": str(root),
    }


def _validate_round2_recovery(root: Path) -> dict[str, Any]:
    """Validate recoverable review drafts, stale retries, and later Skill use."""
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False,
           "review-recovery real ARC Pi loop completed without timeout", checks)
    _check(runtime.get("agent_actions") == 7 and runtime.get("environment_error_count") == 0,
           "review recovery crossed five evidence actions and two later parent actions", checks)
    events = _records(root / "pi-events.jsonl")
    starts = [event for event in events if event.get("type") == "tool_execution_start"]
    actions = [event for event in starts if event.get("toolName") == "arc_action"]
    _check(len(actions) == 7 and [item.get("args", {}).get("action") for item in actions[:5]] == ["ACTION1"] * 5,
           "recovery preserved the original five real ARC transitions", checks)
    _check(sum(event.get("args", {}).get("action") == "inspect" for event in starts
               if event.get("toolName") == "task_harness") >= 1,
           "parent inspected the recoverable review opportunity before authoring", checks)
    drafts = _records(root / "task-harness-review-drafts.jsonl")
    _check(bool(drafts) and any(item.get("opportunity_id") == "harness-opportunity-1" for item in drafts),
           "failed review preserved a named parent-authored opportunity draft", checks)
    review_calls = [event for event in starts if event.get("toolName") == "task_harness"
                    and event.get("args", {}).get("action") == "review"]
    review_ends = {event.get("toolCallId"): event for event in events
                   if event.get("type") == "tool_execution_end" and event.get("toolName") == "task_harness"}
    stale_review_call = review_calls[-1] if review_calls else {}
    stale_review_end = review_ends.get(stale_review_call.get("toolCallId"), {})
    _check(len(review_calls) >= 4 and stale_review_end.get("isError") is True,
           "stale revisioned review repair remained visibly rejected", checks)
    assembly_calls = [event for event in starts if event.get("toolName") == "task_harness"
                      and event.get("args", {}).get("action") == "assemble"]
    stale_assembly_call = assembly_calls[-1] if assembly_calls else {}
    stale_assembly_end = review_ends.get(stale_assembly_call.get("toolCallId"), {})
    _check(len(assembly_calls) >= 2 and stale_assembly_call.get("args", {}).get("expected_assembly_revision") == 0
           and stale_assembly_end.get("isError") is True,
           "stale assembly CAS remained visibly rejected without replacing the active selection", checks)
    reads = _records(root / "task-baseline-method-reads.jsonl")
    _check(any(item.get("name") == "skill-creator" and item.get("actor") == "parent" for item in reads),
           "parent read the exact Skill creator before recovery authoring", checks)
    skills = [item for item in _records(root / "task-skills.jsonl") if item.get("name") == "smoke-recovered-procedure"]
    _check(len(skills) == 1 and skills[0].get("status") == "active"
           and "SMOKE_RECOVERED_SKILL_MARKER" in skills[0].get("instructions", ""),
           "recovery materialized one complete procedural Skill without duplication", checks)
    receipts = _records(root / "task-harness-change-receipts.jsonl")
    _check(any(item.get("status") == "applied" and any(result.get("resource", {}).get("resource_ref") ==
           "skill:smoke-recovered-procedure@v1" for result in item.get("results", [])) for item in receipts),
           "recovery applied the parent-authored Skill through the native change receipt", checks)
    assemblies = _records(root / "task-harness-assemblies.jsonl")
    _check(any(item.get("selected_resource_refs") == ["skill:smoke-recovered-procedure@v1"]
               and item.get("selection_mode") == "explicit" for item in assemblies),
           "recovery assembled the exact Skill version", checks)
    later_skill_uses = [event for event in starts if event.get("toolName") == "arc_action"
                        and "smoke-recovered-procedure@v1" in json.dumps(event.get("args", {}))]
    _check(bool(later_skill_uses), "later parent ARC action cited the recovered Skill version", checks)
    assess_calls = [event for event in starts if event.get("toolName") == "task_harness"
                    and event.get("args", {}).get("action") == "assess_effect"]
    _check(bool(assess_calls) and review_ends.get(assess_calls[-1].get("toolCallId"), {}).get("isError") is not True,
           "later parent assessed the recovered Skill's actual ARC use", checks)
    return {"scenario": "round2_recovery", "research_scope": "harness_component",
            "passed": all(item["passed"] for item in checks), "checks": checks, "run_root": str(root)}


def _validate_direct_development_intent(root: Path) -> dict[str, Any]:
    """A direct parent intent survives Memory churn and closes only after explicit Tool use."""
    checks: list[dict[str, Any]] = []
    runtime = json.loads((root / "summary.json").read_text(encoding="utf-8")).get("runtime", {})
    _check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False
           and runtime.get("agent_actions") == 3 and runtime.get("environment_error_count") == 0,
           "real ARC Pi loop crossed three clean action boundaries", checks)
    events = _records(root / "pi-events.jsonl")
    starts = [row for row in events if row.get("type") == "tool_execution_start"]
    actions = [row.get("args", {}).get("action") for row in starts if row.get("toolName") == "arc_action"]
    _check(actions == ["ACTION1", "ACTION2", "ACTION3"],
           "parent crossed initial, open-intent, and later resolved-intent ARC actions", checks)
    calls = [(row.get("toolName"), row.get("args", {}).get("action")) for row in starts]
    expected = [("task_harness", "start"), ("arc_action", "ACTION1"),
                ("task_harness", "development_intent"), ("task_harness", "change"),
                ("task_harness", "status"), ("arc_action", "ACTION2"),
                ("task_harness", "change"), ("task_harness", "status"),
                ("task_harness", "read_method"), ("task_harness", "change"),
                ("task_harness", "status"), ("task_harness", "assemble"),
                ("task_tool_direct-enabled-counter_v1", None),
                ("task_harness", "development_intent"), ("task_harness", "status"),
                ("arc_action", "ACTION3")]
    _check(calls[:len(expected)] == expected and not any(action == "review" for _, action in calls),
           "parent owned the full sequence without a preceding review", checks)
    intent_rows = [row for row in _records(root / "task-development-intents.jsonl")
                   if row.get("operation_id") == "smoke-direct-counter"]
    _check([row.get("status") for row in intent_rows] == ["open", "resolved"],
           "only explicit parent intent writes opened and resolved the operation", checks)
    ends = {row.get("toolCallId"): row for row in events if row.get("type") == "tool_execution_end"}
    inspections: list[dict[str, Any]] = []
    for start in starts:
        if start.get("toolName") != "task_harness" or start.get("args", {}).get("action") != "status":
            continue
        content = ends.get(start.get("toolCallId"), {}).get("result", {}).get("content", [])
        try:
            inspections.append(json.loads(content[0].get("text", "{}")))
        except (IndexError, TypeError, json.JSONDecodeError):
            inspections.append({})
    def intent_status(body: dict[str, Any]) -> str | None:
        return next((row.get("status") for row in body.get("direct_development_intents", [])
                     if row.get("operation_id") == "smoke-direct-counter"), None)
    _check(len(inspections) == 4 and [intent_status(body) for body in inspections] ==
           ["open", "open", "open", "resolved"],
           "Memory creation, ARC action, revision, and Tool authoring did not close the intent", checks)
    def pool_state(body: dict[str, Any], ref: str) -> tuple[bool, bool] | None:
        return next(((row.get("eligible") is True, row.get("selected") is True)
                     for row in body.get("component_pool", []) if row.get("resource_ref") == ref), None)
    _check(len(inspections) >= 3 and pool_state(inspections[2], "tool:direct-enabled-counter@v1") == (True, False),
           "new Tool was eligible but unselected before parent assembly", checks)
    _check(len(inspections) == 4 and pool_state(inspections[3], "tool:direct-enabled-counter@v1") == (True, True),
           "resolved intent left the exact Tool selected only after assembly", checks)
    memory_rows = [row for row in _records(root / "task-memory.jsonl")
                   if row.get("key") == "direct-counter-context"]
    _check([row.get("version") for row in memory_rows] == [1, 2]
           and memory_rows[-1].get("atom", {}).get("value") == "enabled-only",
           "Memory was created and revised as exact native versions", checks)
    _check(not _records(root / "task-harness-reviews.jsonl")
           and not _records(root / "auto-research-runs.jsonl"),
           "no periodic review or Auto-Research authored the Tool", checks)
    creator_reads = _records(root / "task-baseline-method-reads.jsonl")
    _check(any(row.get("name") == "tool-creator" and row.get("actor") == "parent" for row in creator_reads),
           "parent read the appropriate creator before Tool authoring", checks)
    tool_rows = [row for row in _records(root / "task-tools.jsonl")
                 if row.get("name") == "direct-enabled-counter"]
    _check(len(tool_rows) == 1 and tool_rows[0].get("version") == 1
           and tool_rows[0].get("status") == "active", "one native Tool version was parent-authored", checks)
    assemblies = _records(root / "task-harness-assemblies.jsonl")
    _check(len(assemblies) == 1 and assemblies[0].get("selection_mode") == "explicit"
           and assemblies[0].get("selected_resource_refs") == ["tool:direct-enabled-counter@v1"],
           "Tool was selected only through one explicit exact-ref assembly", checks)
    tool_events = [row for row in _records(root / "task-tool-events.jsonl")
                   if row.get("event") == "invoked" and row.get("name") == "direct-enabled-counter"]
    _check(len(tool_events) == 1 and tool_events[0].get("status") == "completed"
           and tool_events[0].get("output_excerpt") == "2"
           and tool_events[0].get("semantic_effect_observed") is True,
           "selected Tool returned semantic enabled-record count 2", checks)
    contexts = [row for row in _records(root / "arc-smoke-provider-contexts.jsonl")
                if row.get("child") is False]
    _check(any(row.get("parent_projection_has_open_direct_intent") is True for row in contexts[6:14]),
           "open direct intent reached a later parent capability projection after ARC action and Memory revision", checks)
    _check(not _records(root / "task-operation-failures.jsonl")
           and not any(row.get("type") == "tool_execution_end" and row.get("isError") for row in events),
           "direct development path had no task operation errors", checks)
    return {"scenario": "direct_development_intent", "research_scope": None,
            "passed": all(item["passed"] for item in checks), "checks": checks, "run_root": str(root)}


def _validate_online_retrospective(root: Path) -> dict[str, Any]:
	checks: list[dict[str, Any]] = []
	summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
	runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
	_check(runtime.get("pi_returncode") == 0 and runtime.get("timed_out") is False,
		"real ARC Pi loop completed the online retrospective sequence", checks)
	_check(runtime.get("agent_actions") == 4 and runtime.get("environment_error_count") == 0,
		"four real ARC action boundaries continued across reset, authoring, and later use", checks)
	events = _records(root / "pi-events.jsonl")
	starts = [item for item in events if item.get("type") == "tool_execution_start"]
	sequence = [(item.get("toolName"), item.get("args", {}).get("action")) for item in starts]
	expected = [("task_harness", "start"), ("arc_action", "ACTION1"), ("arc_action", "RESET"),
		("task_harness", "contract"), ("task_harness", "level_review"), ("task_harness", "enable"), ("task_resource", "read"),
		("task_harness", "read_method"), ("task_harness", "change"), ("task_harness", "assemble"),
		("task_harness", "focus"), ("arc_action", "ACTION2"),
		("task_harness", "inspect"), ("arc_action", "ACTION3")]
	_check(sequence[:len(expected)] == expected
		and starts[3].get("args", {}).get("schema_action") == "level_review"
		and starts[3].get("args", {}).get("window_id") == "level-outcome:execution-observation-2",
		"parent read the exact reset review, used the Skill Creator, changed and assembled directly, then resumed online actions", checks)
	observations = _records(root / "execution-observations.jsonl")
	actions = [row for row in observations if row.get("tool_name") == "arc_action"]
	_check([row.get("input", {}).get("action") for row in actions] == ["ACTION1", "RESET", "ACTION2", "ACTION3"],
		"later actions continue the live trajectory without replaying the prior action path", checks)
	review_ref = "level_review:level-outcome:execution-observation-2@v1"
	skill_ref = "skill:smoke-online-retrospective-method@v1"
	prompt_ref = "system_prompt:smoke-online-planning-policy@v1"
	reviews = _records(root / "task-level-reviews.jsonl")
	_check(len(reviews) == 1 and reviews[0].get("window_id") == "level-outcome:execution-observation-2"
		and "current available actions" in reviews[0].get("lessons", ""),
		"the reset review preserves a forward-looking observation-bound method and exact review identity", checks)
	changes = _records(root / "task-harness-change-receipts.jsonl")
	created = {ref for receipt in changes if receipt.get("status") == "applied"
		for ref in receipt.get("activation", {}).get("created_resource_refs", [])}
	_check(skill_ref in created and prompt_ref in created,
		"the parent change materialized both the prospective Skill and scoped planning System Prompt", checks)
	skills = _records(root / "task-skills.jsonl")
	method = next((row for row in skills if row.get("name") == "smoke-online-retrospective-method"), {})
	method_body = str(method.get("content", method.get("instructions", "")))
	_check(method.get("basis_refs") == [review_ref] and "current public observation" in method_body
		and "Do not replay" in method_body and not any(action in method_body for action in ["ACTION1", "ACTION2", "ACTION3"]),
		"the authored method binds variables to current observations and contains no prior action script", checks)
	prompts = _records(root / "task-system-prompt.jsonl")
	policy = next((row for row in prompts if row.get("name") == "smoke-online-planning-policy"), {})
	_check(policy.get("basis_refs") == [review_ref] and "goal-directed candidate comparison" in policy.get("content", ""),
		"the scoped planning policy is parent-authored from the review evidence", checks)
	assemblies = _records(root / "task-harness-assemblies.jsonl")
	_check(any(set(row.get("selected_resource_refs", [])) == {skill_ref, prompt_ref} for row in assemblies),
		"the parent assembled both exact review-derived versions", checks)
	contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
	_check(any(row.get("messages_have_online_retrospective_skill")
		and row.get("system_has_online_retrospective_policy") for row in contexts if not row.get("child")),
		"a later real parent context received the selected Skill and planning policy", checks)
	later_decisions = [row.get("input", {}).get("decision", {}) for row in actions[2:]]
	_check(any(decision.get("basis_refs") == [skill_ref, prompt_ref] and decision.get("prediction")
		and decision.get("falsifier") for decision in later_decisions),
		"a later ARC action cited the exact selected versions with a prediction and falsifier", checks)
	review_reads = [event for event in events if event.get("type") == "tool_execution_end"
		and event.get("toolName") == "task_resource"]
	read_payloads = [json.dumps(event.get("result", {})) for event in review_reads if not event.get("isError")]
	_check(any(review_ref in payload and "current available actions" in payload for payload in read_payloads),
		"the parent successfully read the exact archived level_review resource", checks)
	inspect_events = [event for event in events if event.get("type") == "tool_execution_end"
		and event.get("toolName") == "task_harness" and event.get("args", {}).get("action") == "inspect"]
	inspect_text = json.dumps(inspect_events[-1].get("result", {})) if inspect_events else ""
	_check("level-review:" not in inspect_text,
		"level_review did not create a capability_followups adapter opportunity", checks)
	return {"scenario": "online_retrospective", "research_scope": None,
		"passed": all(item["passed"] for item in checks), "checks": checks, "run_root": str(root)}

def _validate_continuous_workers(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    workers = _records(root / "auto-research-workers.jsonl")
    latest = {row["worker_id"]: row for row in workers}
    batches = _records(root / "auto-research-evidence-batches.jsonl")
    updates = _records(root / "auto-research-updates.jsonl")
    deliveries = _records(root / "auto-research-deliveries.jsonl")
    sessions = _records(root / "auto-research-sessions.jsonl")
    calls = _records(root / "pi-events.jsonl")
    _check(set(latest) == {"rules", "counterexamples"}, "two independently assigned durable responsibilities", checks)
    _check(len({w["research_line_ref"] for w in latest.values()}) == 1, "independent workers share one research line", checks)
    _check(all(w["status"] == "revoked" and not w.get("stop_error") for w in latest.values()),
           "parent revocation stops both responsibilities without a cancellation race", checks)
    _check(all(w["consumed_refs"] for w in latest.values()), "analysis consumption is explicitly acknowledged", checks)
    _check(all(w["started_runs"] <= w["max_runs"] for w in latest.values()), "finite run budgets respected", checks)
    _check(len({(b["worker_id"], ref) for b in batches for ref in b["evidence_refs"]}) ==
           sum(len(b["evidence_refs"]) for b in batches), "overlapping windows do not duplicate worker evidence", checks)
    _check(any(s.get("status") == "pending" for s in sessions), "workers can wait for fresh parent evidence", checks)
    _check(any(s.get("status") == "active" and int(s.get("version", 0)) > 2 for s in sessions),
           "pending session resumes through the real child broker", checks)
    rule_sessions = {s["session_id"] for s in sessions if s.get("worker_id") == "rules"}
    _check(len(rule_sessions) >= 2, "completed session has a successor on the same responsibility", checks)
    by_update = {f"research_update:{u['update_id']}@v{u['version']}": u for u in updates}
    _check(len({d["update_ref"] for d in deliveries}) == len(deliveries), "each publication delivered once", checks)
    active_deliveries = [d for d in deliveries if by_update[d["update_ref"]]["lifecycle"] == "active"]
    _check(bool(active_deliveries), "active publications reach a later real parent model boundary", checks)
    _check(any(d["recordedAt"] < s["recordedAt"] for d in active_deliveries for s in sessions
               if s.get("session_id") == by_update[d["update_ref"]]["session_id"] and s.get("status") == "pending"),
           "core increment delivered before that compute slice pauses", checks)
    _check(any("WORKER_A" in u["report"]["conclusion"] for u in updates)
           and any("WORKER_B" in u["report"]["conclusion"] for u in updates), "independent disagreement retained", checks)
    _check(any(u.get("revises_ref") for u in updates) and any(u.get("withdraws_ref") for u in updates),
           "revisions and withdrawals reference exact prior worker publications", checks)
    _check(any("WORKER_FEEDBACK" in u["report"]["conclusion"] and u["lifecycle"] == "completed" for u in updates),
           "actual tool/assessment evidence returns to the continuing research line", checks)
    _check(any(ref.startswith("effect_assessment:") for b in batches for ref in b["evidence_refs"]),
           "exact assessment versions routed automatically", checks)
    _check(any(r.get("status") == "assigned" for r in _records(root / "task-harness-review-events.jsonl")),
           "periodic historical window belongs to the authorized responsibility", checks)
    _check(not any(e.get("isError") for e in calls if e.get("type") == "tool_execution_end"),
           "parent actions and creator/create/assembly/trial operations succeed", checks)
    _check(any(e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness_create" and not e.get("isError") for e in calls),
           "parent uses the dedicated create tool", checks)
    tool_calls = [e for e in calls if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_tool_smoke-counter_v1"]
    _check(any(r.get("name") == "smoke-counter" and r.get("output_excerpt") == "2"
               and r.get("semantic_effect_observed") is True for r in _records(root / "task-tool-events.jsonl")),
           "assembled native tool returns semantic numeric count 2", checks)
    _check(any(u.get("worker_id") == "rules" and u.get("evidence_cutoff") for u in updates),
           "publications retain exact evidence cutoffs", checks)
    child_contexts = [r for r in _records(root / "arc-smoke-provider-contexts.jsonl") if r.get("research_child")]
    _check(bool(child_contexts) and all(r.get("child_creator_tools_absent") for r in child_contexts),
           "research retains read-only environment and authoring boundary", checks)
    _check(any("PERSISTENT_WORKER_COUNTEREXAMPLE" in str(r.get("checkpoint_reloaded", {})) for r in child_contexts),
           "cross-stage recovery preserves unresolved counterexample state", checks)
    provider_refs = {ref for row in _records(root / "arc-smoke-provider-contexts.jsonl") for ref in row.get("worker_increment_refs", [])}
    _check(bool(provider_refs) and all(d["update_ref"] in provider_refs for d in deliveries),
           "delivered short refs reach actual later parent provider contexts", checks)
    _check(any(e.get("type") == "tool_execution_start" and e.get("toolName") == "arc_actions"
               and any(a.get("action") == "RESET" for a in e.get("args", {}).get("actions", [])) for e in calls),
           "continuing research crosses a real ARC reset boundary", checks)
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    _check(summary.get("runtime", {}).get("pi_returncode") == 0
           and summary.get("runtime", {}).get("agent_actions") == 8, "ARC runner finishes normally at eight actions", checks)
    return {"scenario": "continuous_workers", "passed": all(c["passed"] for c in checks), "checks": checks, "run_root": str(root)}


def _validate_read_workset(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    events = _records(root / "pi-events.jsonl")
    reads = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_resource"]
    pages = [json.loads(e["result"]["content"][0]["text"]) for e in reads if not e.get("isError")]
    _check(len(pages) == 3 and [p.get("offset") for p in pages] == [0, 4000, 0]
           and all(len(p.get("text", "")) == 4000 for p in pages), "all three reads return their requested exact body", checks)
    _check(len(pages) == 3 and pages[0].get("page_sha256") == pages[2].get("page_sha256"),
           "projected-out first page restores directly with the same hash", checks)
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    _check(any({p.get("offset") for p in c.get("read_workset_pages", [])} == {0, 4000} for c in contexts),
           "both gathered pages coexist in the actual provider request", checks)
    compact_calls = {e.get("toolCallId") for e in events if e.get("type") == "tool_execution_start"
                     and e.get("toolName") == "task_harness" and e.get("args", {}).get("action") == "compact_results"}
    _check(any(e.get("type") == "tool_execution_end" and e.get("toolCallId") in compact_calls
               and not e.get("isError") for e in events),
           "the native parent explicitly projects out the first result before rereading", checks)
    _check(not any(e.get("isError") for e in events if e.get("type") == "tool_execution_end"),
           "native tools complete without errors", checks)
    workset = _records(root / "task-read-workset-events.jsonl")
    _check(any(row.get("event") == "agent_release" and str(row.get("covered_by", "")).startswith("checkpoint:")
               for row in workset), "checkpoint explicit consumption releases exact native read results", checks)
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    _check(checkpoint.get("decision_state", {}).get("knowledge_gaps", [{}])[0].get("kind") == "goal_rule"
           and "SMOKE_OPERATION_EFFECT_IS_NOT_GOAL_PROOF" in json.dumps(checkpoint.get("decision_state")),
           "authored goal gap and counterexample persist in canonical checkpoint", checks)
    _check(any(row.get("decision_card_goal_gap_present") is True for row in contexts),
           "a later actual parent input retains the unresolved goal", checks)
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    _check(summary.get("runtime", {}).get("agent_actions") == 2
           and summary.get("runtime", {}).get("pi_returncode") == 0, "a later real ARC action consumes the restored batch", checks)
    return {"scenario": "read_workset", "passed": all(c["passed"] for c in checks),
            "checks": checks, "run_root": str(root)}


def _validate_review_advisory(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    config = summary.get("runtime", {}).get("review_configuration") or {}
    _check(config.get("review_mode") == "advisory" and config.get("periodic_review_enabled") is True,
           "actual runner keeps review enabled without requiring its decision", checks)
    actions = [r for r in _records(root / "execution-observations.jsonl")
               if r.get("tool_name") == "arc_action" and not r.get("is_error")]
    _check(len(actions) == 7 and summary.get("runtime", {}).get("pi_returncode") == 0,
           "seven real actions cross the five-action review boundary", checks)
    _check(bool(_records(root / "task-harness-opportunities.jsonl")),
           "the review opportunity remains durable", checks)
    events = _records(root / "pi-events.jsonl")
    _check(not any("action_deferred" in json.dumps(e.get("result", {}))
                   for e in events if e.get("type") == "tool_execution_end"),
           "periodic review does not defer ARC actions", checks)
    _check(not any(e.get("type") == "tool_execution_start" and e.get("toolName") == "task_harness"
                   and e.get("args", {}).get("action") in {"review", "defer_review", "skip_review"}
                   for e in events), "no parent review-management call is needed", checks)
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    later = [c for c in contexts if c.get("advisory_evidence_cue")]
    _check(bool(contexts) and all("task_memory_pool" not in c.get("tool_names", []) for c in contexts),
           "unselected automatic probe records do not activate memory management schema", checks)
    _check(bool(later) and all(len(c["advisory_evidence_cue"]) < 1600
                              and "no review" in c["advisory_evidence_cue"]
                              and '"batch"' not in c["advisory_evidence_cue"] for c in later),
           "later real parent input has a short optional evidence index", checks)
    _check(bool(later) and all(not c.get("due_review_cue_present") and not c.get("capability_workflow_present")
                              for c in later), "periodic window adds no repeated development obligation", checks)
    indexed = []
    for c in later:
        card, _ = json.JSONDecoder().raw_decode(c["advisory_evidence_cue"].split(": ", 1)[1])
        indexed.extend(card.get("evidence_refs", []))
    available = {r.get("observation_id") for r in _records(root / "execution-observations.jsonl")}
    _check(bool(indexed) and set(indexed) <= available, "short index preserves exact canonical action evidence", checks)
    probes = [r for r in _records(root / "task-memory.jsonl") if r.get("probe_record")]
    _check(len(probes) == 7 and all(r.get("probe_record", {}).get("decision_capsule", {}).get("hypothesis")
                                  == "SMOKE_UNRESOLVED_CONTROL" for r in probes),
           "all parent predictions remain durable as separate unverified evidence", checks)
    _check(bool(later) and all(not c.get("memory_candidate_cue") and c.get("decision_capsule_present") for c in later),
           "later parent retains its current prediction without automatic probe-component advertising", checks)
    research_cues = [c.get("research_opportunity_cue", "") for c in contexts if c.get("research_opportunity_cue")]
    _check(all("optional" in cue and "parent decision required" not in cue
               and "do not silently bypass" not in cue and "authoring_prerequisite" not in cue for cue in research_cues),
           "research directories add no compulsory per-opportunity disposition", checks)
    return {"scenario": "review_advisory", "passed": all(c["passed"] for c in checks),
            "checks": checks, "run_root": str(root)}


def _validate_action_knowledge(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    events = _records(root / "pi-events.jsonl")
    ends = [e for e in events if e.get("type") == "tool_execution_end"]
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    _check(summary.get("runtime", {}).get("pi_returncode") == 0
           and summary.get("runtime", {}).get("agent_actions") == 3,
           "three actual action boundaries finish normally", checks)
    _check([e.get("toolName") for e in ends] == ["arc_action"] * 3
           and all(not e.get("isError") for e in ends),
           "knowledge updates need no separate checkpoint tool call", checks)
    _check(len(contexts) == 3 and sum(e.get("type") == "agent_start" for e in events) == 3,
           "three actual parent turns use three provider requests", checks)
    expected = {
        "known_effects": ["SMOKE_ACTION_EFFECT: no supported control yet"],
        "knowledge_gaps": ["SMOKE_ACTION_GAP: goal is unknown"],
        "counterevidence": [{"fact": "SMOKE_ACTION_COUNTEREXAMPLE: change alone is not a goal rule",
                             "source_ref": "observation:execution-observation-1@v1"}],
    }
    _check(checkpoint.get("decision_state") == expected,
           "partial action patches retain complete knowledge and exact evidence", checks)
    _check(len(contexts) == 3
           and all(text in contexts[1].get("checkpoint_batch_state", "")
                   for text in [expected["known_effects"][0], expected["knowledge_gaps"][0]])
           and all(text in contexts[2].get("checkpoint_batch_state", "")
                   for text in [expected["known_effects"][0], expected["knowledge_gaps"][0],
                                expected["counterevidence"][0]["fact"], expected["counterevidence"][0]["source_ref"]]),
           "later actual provider inputs carry the effects, unresolved goal and counterexample", checks)
    snapshots = {_snapshot_ref(s): s for s in _records(root / "observation-snapshots.jsonl")}
    _check(len(contexts) == 3 and all(c.get("complete_observation_present")
           and len(c.get("announced_snapshot_refs", [])) == 1
           and snapshots.get(c["announced_snapshot_refs"][0], {}).get("latest_successful_action_event_boundary", {}).get("total_used") == i
           for i, c in enumerate(contexts)),
           "every parent receives its corresponding complete fresh observation", checks)
    _check(checkpoint.get("current_subgoal") == "SMOKE_ACTION_SUBGOAL: compare controls"
           and checkpoint.get("hypothesis") == "SMOKE_ACTION_HYPOTHESIS: controls unknown"
           and checkpoint.get("next_step") == "SMOKE_ACTION_NEXT: contrast another control"
           and checkpoint.get("latest_environment", {}).get("action_budget", {}).get("total_used") == 3,
           "existing capsule fields and canonical action facts remain intact", checks)
    native_actions = [e for e in _records(root / "bridge-events.jsonl") if e.get("event") == "action"]
    _check([e.get("action") for e in native_actions] == ["ACTION1", "ACTION2", "ACTION3"]
           and "SMOKE_ACTION_EFFECT" not in json.dumps(native_actions),
           "authored knowledge stays in Agent runtime and is not sent to the native action parser", checks)
    return {"scenario": "action_knowledge", "passed": all(c["passed"] for c in checks),
            "checks": checks, "run_root": str(root)}


def _validate_batch_guard(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    events = _records(root / "pi-events.jsonl")
    ends = [e for e in events if e.get("type") == "tool_execution_end" and not e.get("isError")]
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    actions = [e for e in _records(root / "bridge-events.jsonl") if e.get("event") == "action"]
    _check(summary.get("runtime", {}).get("pi_returncode") == 0
           and summary.get("runtime", {}).get("agent_actions") == 4,
           "four real native actions finish normally", checks)
    _check([e.get("action") for e in actions] == ["ACTION1", "ACTION2", "ACTION2", "ACTION3"]
           and [e.get("observation_delta", {}).get("changed_cells") for e in actions[:3]] == [52, 52, 2],
           "guard stops before the fourth authorized batch action and later parent chooses ACTION3", checks)
    batch = ends[0].get("result", {}) if ends else {}
    details = batch.get("details", {}) if isinstance(batch, dict) else {}
    _check([e.get("toolName") for e in ends] == ["arc_actions", "arc_action"]
           and len(details.get("completed", [])) == 3
           and details.get("stopped") == "changed_cells_lte_2:action_2:observed_2"
           and details.get("partial") is True,
           "parent receives ordered three-action partial receipt and exact stop reason", checks)
    snapshots = {_snapshot_ref(s): s for s in _records(root / "observation-snapshots.jsonl")}
    later_ref = contexts[1].get("announced_snapshot_refs", [None])[0] if len(contexts) > 1 else None
    later = snapshots.get(later_ref, {})
    frame = (later.get("public_state", {}).get("frames") or [None])[-1]
    _check(len(contexts) == 2 and later_ref is not None
           and later.get("latest_successful_action_event_boundary", {}).get("total_used") == 3
           and isinstance(frame, list) and len(frame) == 64 and all(len(row) == 64 for row in frame),
           "later real parent turn receives the current complete public observation", checks)
    return {"scenario": "batch_guard", "passed": all(c["passed"] for c in checks),
            "checks": checks, "run_root": str(root)}


def _validate_multi_region_cue(root: Path, *, broad: bool = False) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    actions = [e for e in _records(root / "bridge-events.jsonl") if e.get("event") == "action"]
    contexts = [e for e in _records(root / "arc-smoke-provider-contexts.jsonl") if not e.get("child")]
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    count, target_step, target_delta, target_sizes, context_index = (
        (49, 45, 138, [25, 25, 84, 4], 6) if broad else (33, 27, 58, [50, 4, 4], 4))
    _check(summary.get("runtime", {}).get("pi_returncode") == 0
           and summary.get("runtime", {}).get("agent_actions") == count
           and len(actions) == count, f"{count} native actions finish through real bridge", checks)
    target = actions[target_step - 1] if len(actions) >= target_step else {}
    delta = target.get("observation_delta", {})
    _check(delta.get("changed_cells") == target_delta and delta.get("cells_truncated") is False
           and len(delta.get("cells", [])) == target_delta
           and target.get("level_before") == target.get("frame", {}).get("levels_completed") == 0,
           f"action {target_step} yields complete public {target_delta}-cell delta without level transition", checks)
    later = contexts[context_index] if len(contexts) > context_index else {}
    refs = later.get("announced_snapshot_refs", [])
    snapshots = {_snapshot_ref(s): s for s in _records(root / "observation-snapshots.jsonl")}
    frame = (snapshots.get(refs[0], {}).get("public_state", {}).get("frames") or [None])[-1] if refs else None
    _check(len(contexts) > context_index and later.get("multi_region_cue_count") == 1
           and later.get("multi_region_cue_has_exact_ref") is True
           and later.get("multi_region_cue_has_lag") is True
           and later.get("multi_region_cue_has_goal_answer") is False,
           "next real Pi parent input carries one exact-reference cue without answer injection", checks)
    _check(later.get("complete_observation_present") is True
           and isinstance(frame, list) and len(frame) == 64
           and all(len(row) == 64 for row in frame),
           "next parent input retains complete current public frame", checks)
    _check(any(row.get("observation_id") == f"execution-observation-{target_step}"
               and [group.get("changed_cells") for group in row.get("change_groups", [])] == target_sizes
               for row in checkpoint.get("recent_actions", [])),
           "batch member geometry reaches durable checkpoint", checks)
    return {"scenario": "multi_region_broad_cue" if broad else "multi_region_cue",
            "passed": all(c["passed"] for c in checks),
            "checks": checks, "run_root": str(root)}


def _validate_checkpoint_action_batch(root: Path, *, boundary: bool = False) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    events = _records(root / "pi-events.jsonl")
    ends = [e for e in events if e.get("type") == "tool_execution_end"]
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    _check(summary.get("runtime", {}).get("pi_returncode") == 0 and summary.get("runtime", {}).get("agent_actions") == 3,
           "three real ARC action boundaries finish normally", checks)
    successful = [e for e in ends if not e.get("isError")]
    errors = [e for e in ends if e.get("isError")]
    _check([e.get("toolName") for e in successful] == ["task_checkpoint", "arc_action", "task_checkpoint", "arc_action", "arc_action"]
           and len(errors) == (2 if boundary else 0), "updates precede actions in successful native sequential batches", checks)
    if boundary:
        _check([e.get("toolName") for e in errors] == ["task_checkpoint", "arc_action"]
               and "ARC action boundary already completed" in json.dumps(errors[0].get("result"))
               and any(marker in json.dumps(errors[1].get("result")) for marker in
                       ("ARC action boundary already completed", "Earlier Harness mutation"))
               and [e.get("action") for e in _records(root / "bridge-events.jsonl") if e.get("event") == "action"] == ["ACTION1", "ACTION2", "ACTION3"],
               "extra writes/actions after the boundary are blocked and later parent actions still execute", checks)
    assistants = [e.get("message", {}) for e in events if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant"]
    _check(len(contexts) == 3 and len([e for e in assistants if e.get("stopReason") == "toolUse"]) == 3,
           "two updates and three actions require only three actual parent provider requests", checks)
    snapshots = {_snapshot_ref(s): s for s in _records(root / "observation-snapshots.jsonl")}
    _check(sum(e.get("type") == "agent_start" for e in events) == 3 and len(contexts) == 3
           and all(len(c.get("announced_snapshot_refs", [])) == 1
                   and snapshots.get(c["announced_snapshot_refs"][0], {}).get("latest_successful_action_event_boundary", {}).get("total_used") == i
                   for i, c in enumerate(contexts)),
           "each batch ends its parent cycle and the next actual provider receives the corresponding fresh snapshot", checks)
    _check(len(contexts) == 3 and "SMOKE_BATCH_KNOWLEDGE" in contexts[1].get("checkpoint_batch_state", "")
           and "SMOKE_BATCH_COUNTEREVIDENCE" in contexts[2].get("checkpoint_batch_state", ""),
           "later actual parent inputs retain knowledge then counterevidence", checks)
    _check(bool(contexts) and all(c.get("complete_observation_present") and c.get("announced_snapshot_refs") for c in contexts),
           "each provider request still receives the complete current public observation and exact ref", checks)
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    expected_knowledge = {
        "known_effects": ["SMOKE_AUTHORED_EFFECT: controls have not been verified"],
        "knowledge_gaps": ["SMOKE_AUTHORED_GAP: goal remains unknown"],
        "counterevidence": ["SMOKE_AUTHORED_COUNTEREXAMPLE: a pixel change does not establish a goal rule"],
    }
    _check(checkpoint.get("decision_state") == expected_knowledge
           and len(contexts) == 3
           and all(text in contexts[2].get("checkpoint_batch_state", "")
                   for values in expected_knowledge.values() for text in values),
           "normalized authored effects, gap and counterexample persist and reach a later real parent input", checks)
    _check("SMOKE_BATCH_COUNTEREVIDENCE" in checkpoint.get("working_summary", "")
           and checkpoint.get("summary_basis_refs") == ["execution-observation-1"]
           and checkpoint.get("latest_environment", {}).get("action_budget", {}).get("total_used") == 3,
           "authored interpretation and exact evidence coexist with final canonical action facts", checks)
    return {"scenario": "checkpoint_action_boundary" if boundary else "checkpoint_action_batch", "passed": all(c["passed"] for c in checks), "checks": checks, "run_root": str(root)}


def _validate_review_input_repair(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    _check(summary.get("runtime", {}).get("pi_returncode") == 0
           and summary.get("runtime", {}).get("agent_actions") == 6,
           "real SDK parent executes a later sixth action after review repair", checks)
    ends = [e for e in _records(root / "pi-events.jsonl") if e.get("type") == "tool_execution_end"]
    failures = [e for e in ends if e.get("isError")]
    try:
        error = json.loads(failures[0]["result"]["content"][0]["text"])
    except (IndexError, KeyError, TypeError, json.JSONDecodeError):
        error = {}
    repair_call = {"tool":"task_harness", "arguments":{"action":"inspect", "section":"review_contract"}}
    _check(len(failures) == 1 and error.get("code") == "invalid_review"
           and {e.get("path") for e in error.get("errors", [])} == {"review[0].component", "transition_analysis"},
           "missing semantic fields are rejected without guessing their content", checks)
    _check(error.get("required_next_call") == repair_call and error.get("applied") is False
           and "rules" not in error and "pattern_template" not in error,
           "error gives an exact section recovery without repeating the static manual", checks)
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    visible = [e for c in contexts for e in c.get("review_repair_errors", [])]
    _check(bool(visible) and all(e.get("chars", 9999) < 2000 and not e.get("static_manual_present")
                               and e.get("required_next_call") == repair_call for e in visible),
           "later actual provider input contains the short actionable error", checks)
    _check(any(c.get("review_contract_restored") for c in contexts),
           "parent explicitly restores complete rules and pattern template on demand", checks)
    drafts = _records(root / "task-harness-review-drafts.jsonl")
    _check(bool(drafts) and drafts[0].get("entries") == [{"disposition":"defer", "reason":"The control mechanism remains unknown."}],
           "original incomplete parent judgment remains in the durable draft", checks)
    reviews = _records(root / "task-harness-reviews.jsonl")
    _check(len(reviews) == 1 and reviews[0].get("transition_analysis", {}).get("predictive_rules", "").startswith("Unknown;"),
           "only the later explicit parent repair commits a review", checks)
    operation_failures = _records(root / "task-operation-failures.jsonl")
    resolutions = _records(root / "task-operation-resolutions.jsonl")
    successful_calls = {e["toolCallId"] for e in ends if e.get("toolCallId") and not e.get("isError")}
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    pending = checkpoint.get("pending_operations", [])
    # Failure history is append-only. Verify the separate resolution receipt,
    # its exact target and the actual successful parent call that produced it.
    _check(any(f.get("operation_key") and r.get("failure_ref") == f.get("resource_ref")
               and r.get("operation_key") == f["operation_key"]
               and r.get("resolved_operation_key") == f["operation_key"]
               and r.get("resolved_by") in successful_calls
               and not any(p.get("operation_key") == f["operation_key"] for p in pending)
               for f in operation_failures for r in resolutions),
           "success for the same bound review resolves its failure", checks)
    return {"scenario":"review_input_repair", "passed":all(c["passed"] for c in checks), "checks":checks, "run_root":str(root)}


def _validate_selected_snapshot(root: Path) -> dict[str, Any]:
    """Provider answers are derived from the complete context, not resource files."""
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime", {})
    _check(runtime.get("pi_returncode") == 0 and not runtime.get("timed_out"), "real runner finished", checks)
    snapshots = _records(root / "observation-snapshots.jsonl")
    first = next((r for r in snapshots if r.get("snapshot_id") == "parent-state-1"), {})
    frame = first.get("public_state", {}).get("frames", [[]])[-1]
    expected = {"rows": len(frame), "columns": len(frame[0]) if frame else 0,
                "first_cell": frame[0][0] if frame and frame[0] else None,
                "grid_sha256": hashlib.sha256("\n".join("".join(format(c, "x") for c in row) for row in frame).encode()).hexdigest(),
                "selected_ref": "observation_snapshot:parent-state-1@v1", "image_count": 1,
                "tools": ["task_resource", "child_context"]}
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    children = [c for c in contexts if c.get("child")]
    _check(len(children) == 2 and all(c.get("selected_scene") == expected for c in children),
           "initial and length-continuation provider inputs carry the complete exact historical grid and PNG", checks)
    invocations = _records(root / "subagent-invocations.jsonl")
    try:
        answer = json.loads(invocations[0].get("result", {}).get("text", "")) if invocations else None
    except (ValueError, TypeError):
        answer = None
    _check(bool(frame) and answer == expected, "independent child returns semantic public grid values from its provider context", checks)
    _check(len(snapshots) >= 2 and snapshots[-1].get("latest_successful_action_event_boundary", {}).get("total_used", 0) >= 1,
           "selected evidence stays historical after a newer action snapshot exists", checks)
    bindings = _records(root / "subagent-context-bindings.jsonl")
    _check(len(bindings) == 1 and bindings[0].get("evidence_refs") == [expected["selected_ref"]]
           and bindings[0].get("tools") == [] and bindings[0].get("effective_tools") == [],
           "pure saved role receives only explicitly selected evidence and no environment tools", checks)
    continuations = _records(root / "subagent-continuations.jsonl")
    _check([c.get("stop_reason") for c in continuations] == ["length", "stop"],
           "ordinary delegate output-length resumes through the real child process", checks)
    _check(any(not c.get("child") and c.get("parent_has_scene_result") for c in contexts),
           "later real parent turn receives semantic child return", checks)
    events = _records(root / "pi-events.jsonl")
    starts = [e for e in events if e.get("type") == "tool_execution_start"]
    _check(any(e.get("toolName") == "arc_action" and e.get("args", {}).get("action") == "ACTION2" for e in starts)
           and runtime.get("agent_actions") == 2, "native ARC action boundary follows the real delegation", checks)
    _check(not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")],
           "selected scene path has no operation errors", checks)
    return {"scenario": "selected_snapshot", "passed": all(c["passed"] for c in checks), "checks": checks, "run_root": str(root)}


def _validate_simple_coordinate_input(root: Path) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime", {})
    _check(runtime.get("pi_returncode") == 0 and not runtime.get("timed_out"), "real runner completed", checks)
    _check(runtime.get("agent_actions") == 2 and runtime.get("environment_error_count") == 0,
           "two native simple actions retain existing acceptance and budget semantics", checks)
    observations = [r for r in _records(root / "execution-observations.jsonl") if r.get("tool_name") == "arc_action"]
    _check(len(observations) == 2 and [r.get("input", {}).get("x") for r in observations] == [21, 22],
           "raw requested coordinate inputs stay available for exact audit", checks)
    _check(len(observations) == 2 and all("supplied x/y were ignored" in r.get("result_text", "")
           and "target=frame[" not in r.get("result_text", "") for r in observations),
           "actual ARC tool receipts explain ignored coordinates without a fictional target cell", checks)
    contexts = _records(root / "arc-smoke-provider-contexts.jsonl")
    receipts = [r for c in contexts for r in c.get("simple_action_receipts", [])]
    _check(bool(receipts) and all(r.get("ignored_coordinates") and not r.get("claims_coordinate_target") for r in receipts),
           "later real parent provider sees corrected execution semantics", checks)
    checkpoint_path = root / "task-checkpoint.json"
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8")) if checkpoint_path.exists() else {}
    for patch in _records(root / "task-checkpoint-patches.jsonl")[int(checkpoint.get("patch_sequence", 0)):]:
        checkpoint.update(patch.get("patch", {}))
    actions = checkpoint.get("recent_actions", [])
    _check(len(actions) >= 2 and all("x" not in r and "y" not in r and "target_cell" not in r for r in actions),
           "canonical action workset does not count unused request coordinates as spatial probes", checks)
    events = _records(root / "pi-events.jsonl")
    _check(not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")],
           "corrected receipt path adds no retry or operation failure", checks)
    return {"scenario": "simple_coordinate_input", "passed": all(c["passed"] for c in checks), "checks": checks, "run_root": str(root)}


def _capture_real_provider_smoke(
    root: Path, *, arc_root: Path, game: str, case: str | None,
    max_actions: int | None, experiment_timeout_seconds: float | None,
    max_reported_tokens: int | None, max_output_tokens: int | None,
    reasoning_policy: str, reasoning_levels: tuple[str, ...] | None,
) -> Path:
    """Collect real closure evidence without inferring semantics from status."""
    selected = case or "research-closure"
    if selected not in {"research-closure", "author-closure"}:
        raise ValueError("real provider supports research-closure or author-closure")
    for name, value in (("max_actions", max_actions),
                        ("experiment_timeout_seconds", experiment_timeout_seconds),
                        ("max_reported_tokens", max_reported_tokens),
                        ("max_output_tokens", max_output_tokens)):
        if value is None or value <= 0:
            raise ValueError(f"real-provider capture requires an explicit positive {name}")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ARC harness smoke output must be an empty directory")
    root.mkdir(parents=True, exist_ok=True)
    run_root = root / selected
    run_summary = run_arc_agi_3_e2e(
        run_root, arc_root=arc_root, game=game, experiment_variant="treatment",
        max_actions=max_actions, experiment_timeout_seconds=experiment_timeout_seconds,
        max_reported_tokens=max_reported_tokens, max_output_tokens=max_output_tokens,
        auto_research_validation=selected == "research-closure",
        auto_research_enabled=selected == "research-closure",
        harness_validation=selected == "author-closure", pi_provider="yibu",
        input_modalities="text,image", review_mode="advisory",
        reasoning_policy=reasoning_policy, reasoning_levels=reasoning_levels,
        pi_environment={"PI_AUTORESEARCH_PROVIDER_PROMPT_CAPTURE": "all",
                        "PI_PROVIDER_REPORTED_ADMISSION": "enabled"},
    )
    output = root / "arc-self-harness-smoke-summary.json"
    output.write_text(json.dumps({
        "format": "arc-real-provider-self-harness-capture-v1",
        "provider_mocked": False, "environment_mocked": False,
        "runtime_boundaries_mocked": False, "guided": True,
        "passed": False, "acceptance_status": "unverified",
        "case": selected, "run_root": str(run_root),
        "run_summary": str(run_summary),
        "component_matrix": {kind: {"semantic_use": "unverified"} for kind in SCENARIOS},
        "length_matrix": {kind: "unverified" for kind in ("auto_research", "delegate_task")},
        "evidence": [str(run_root / name) for name in (
            "provider-telemetry.jsonl", "provider-token-budget.jsonl", "pi-events.jsonl",
            "subagent-progress.jsonl", "subagent-invocations.jsonl", "auto-research-runs.jsonl",
            "task-harness-decisions.jsonl", "execution-observations.jsonl", "bridge-events.jsonl")
            if (run_root / name).is_file()],
        "acceptance_statement": "Real-provider capture only. Review actual child returns, exact native "
            "versions/assembly, semantic outputs, canonical actions and later response-confirmed inputs. "
            "A successful run or completed report does not establish five-kind closure, either length "
            "path, autonomous adoption, stage acceptance or net benefit.",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def run_arc_harness_smoke(
    root: Path,
    *,
    arc_root: Path,
    game: str = "ls20",
    mock_environment: bool = False,
    case: str | None = None,
    provider_mode: str = "deterministic",
    max_actions: int | None = None,
    experiment_timeout_seconds: float | None = None,
    max_reported_tokens: int | None = None,
    max_output_tokens: int | None = None,
    reasoning_policy: str = "provider-default",
    reasoning_levels: tuple[str, ...] | None = None,
) -> Path:
    if provider_mode == "real":
        if mock_environment:
            raise ValueError("real-provider capture requires the official ARC environment")
        return _capture_real_provider_smoke(
            root, arc_root=arc_root, game=game, case=case, max_actions=max_actions,
            experiment_timeout_seconds=experiment_timeout_seconds,
            max_reported_tokens=max_reported_tokens, max_output_tokens=max_output_tokens,
            reasoning_policy=reasoning_policy, reasoning_levels=reasoning_levels,
        )
    if provider_mode != "deterministic":
        raise ValueError(f"unknown ARC harness smoke provider mode: {provider_mode}")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ARC harness smoke output must be an empty directory")
    root.mkdir(parents=True, exist_ok=True)
    project_root = Path(__file__).resolve().parents[2]
    provider = project_root / "tools" / "arc_harness_smoke_provider.ts"
    results: list[dict[str, Any]] = []
    cases = list(zip(SCENARIOS, list(PROFILE_HEADINGS)[:5], SCENARIOS)) + [
        ("memory", "harness_component", "continuous-memory-pool"),
        ("memory", "research_method", "profile-research-method"),
        ("memory", None, "profile-general"),
        ("memory", "hypothesis", "profile-hypothesis"),
        ("memory", "research_method", "periodic-memory"),
        ("tools", "research_method", "periodic-tools"),
        ("tools", "research_method", "method-lifecycle-tools"),
        ("tools", "research_method", "method-rejection-tools"),
        ("tools", "research_method", "cross-context-method"),
        ("pure_expression", None, "pure-expression-tool"),
        ("source_handoff", "harness_component", "source-handoff-tool"),
        ("minimal_five_pool", None, "minimal-five-pool"),
        ("tools", "research_method", "continuous-workers"),
        ("direct_use", None, "direct-use"),
    ]
    diagnostic_cases = [("action_alignment", None, "action-alignment"),
                        ("batch_guard", None, "batch-guard"),
                        ("multi_region_cue", None, "multi-region-cue"),
                        ("multi_region_broad_cue", None, "multi-region-broad-cue"),
                        ("review_advisory", None, "review-advisory"),
                        ("read_workset", None, "read-workset"),
                        ("skills", "research_method", "round2-review-recovery-skill"),
                        ("direct_development_intent", None, "direct-development-intent"),
                        ("online_retrospective", None, "online-retrospective"),
                        ("minimal_five_publish", None, "publish-five-pool"),
                        ("selected_snapshot", None, "selected-snapshot-subagent"),
                        ("simple_coordinate_input", None, "simple-coordinate-input"),
                        ("review_input_repair", None, "review-input-repair"),
                        ("checkpoint_action_batch", None, "checkpoint-action-batch"),
                        ("checkpoint_action_boundary", None, "checkpoint-action-boundary"),
                        ("action_knowledge", None, "action-knowledge")]
    if case is not None:
        cases = [item for item in [*cases, *diagnostic_cases] if item[2] == case]
        if not cases:
            raise ValueError(f"unknown ARC harness smoke case: {case}")
    for scenario, scope, case_name in cases:
        scenario_root = root / case_name
        periodic = case_name.startswith("periodic-")
        method_lifecycle = case_name in {"method-lifecycle-tools", "method-rejection-tools"}
        method_rejection = case_name == "method-rejection-tools"
        cross_context_method = case_name == "cross-context-method"
        pure_expression = case_name == "pure-expression-tool"
        direct_use = case_name == "direct-use"
        source_handoff = case_name == "source-handoff-tool"
        minimal_five_pool = case_name in {"minimal-five-pool", "publish-five-pool"}
        round2_recovery = case_name == "round2-review-recovery-skill"
        direct_development = case_name == "direct-development-intent"
        online_retrospective = case_name == "online-retrospective"
        action_alignment = case_name == "action-alignment"
        continuous_workers = case_name == "continuous-workers"
        review_advisory = case_name == "review-advisory"
        read_workset = case_name == "read-workset"
        selected_snapshot = case_name == "selected-snapshot-subagent"
        simple_coordinate_input = case_name == "simple-coordinate-input"
        review_input_repair = case_name == "review-input-repair"
        checkpoint_batch = case_name in {"checkpoint-action-batch", "checkpoint-action-boundary"}
        action_knowledge = case_name == "action-knowledge"
        batch_guard = case_name == "batch-guard"
        multi_region_cue = case_name == "multi-region-cue"
        multi_region_broad_cue = case_name == "multi-region-broad-cue"
        try:
            run_arc_agi_3_e2e(
                scenario_root,
                arc_root=project_root if mock_environment else arc_root,
                **({"bridge_python": Path(sys.executable), "bridge_module_paths": (project_root / "tools/mock_arc_sdk",)} if mock_environment else {}),
                game=game,
                experiment_variant="treatment",
                max_actions=(4 if direct_use else 49 if multi_region_broad_cue else 33 if multi_region_cue else 3 if (checkpoint_batch or action_knowledge or source_handoff) else 6 if review_input_repair else 2 if read_workset else 7 if review_advisory else 8 if continuous_workers else 4 if (online_retrospective or action_alignment or batch_guard) else 7 if (periodic or round2_recovery or cross_context_method) else 2 if (pure_expression or minimal_five_pool)
                             else 3 if (scenario in {"memory", "system_prompt"} or direct_development) else 2),
                context_compaction=True,
                auto_research_enabled=True,
                experiment_timeout_seconds=300 if (multi_region_cue or multi_region_broad_cue) else 180,
                pi_provider="offline-arc-harness-smoke",
                pi_model="scripted",
                **({"input_modalities": "text,image"} if selected_snapshot else {}),
                pi_provider_extension=provider,
                review_mode="advisory" if (direct_use or review_advisory or read_workset or review_input_repair or checkpoint_batch or action_knowledge or batch_guard or multi_region_cue or multi_region_broad_cue) else "required",
                pi_environment={
                    **({"PI_ARC_ACTION_BATCH": "enabled"} if continuous_workers else {}),
                    "PI_ARC_SMOKE_SCENARIO": scenario,
                    "PI_ARC_SMOKE_WORKERS": "1" if continuous_workers else "0",
                    "PI_ARC_SMOKE_SCOPE": scope or "",
                    "PI_ARC_SMOKE_PERIODIC": "1" if periodic else "0",
                    "PI_ARC_SMOKE_METHOD_LIFECYCLE": "1" if method_lifecycle else "0",
                    "PI_ARC_SMOKE_METHOD_REJECTION": "1" if method_rejection else "0",
                    "PI_ARC_SMOKE_MEMORY_POOL": "1" if case_name == "continuous-memory-pool" else "0",
                    "PI_ARC_SMOKE_CROSS_CONTEXT_METHOD": "1" if cross_context_method else "0",
                    "PI_ARC_SMOKE_ROUND2_RECOVERY": "1" if round2_recovery else "0",
                    "PI_AUTORESEARCH_THINKING": "off",
                },
            )
            results.append(_validate_direct_use(scenario_root) if direct_use else
                           _validate_multi_region_cue(scenario_root, broad=True) if multi_region_broad_cue else
                           _validate_multi_region_cue(scenario_root) if multi_region_cue else
                           _validate_batch_guard(scenario_root) if batch_guard else
                           _validate_action_knowledge(scenario_root) if action_knowledge else
                           _validate_checkpoint_action_batch(scenario_root, boundary=case_name == "checkpoint-action-boundary") if checkpoint_batch else
                           _validate_review_input_repair(scenario_root) if review_input_repair else
                           _validate_simple_coordinate_input(scenario_root) if simple_coordinate_input else
                           _validate_selected_snapshot(scenario_root) if selected_snapshot else
                           _validate_read_workset(scenario_root) if read_workset else
                           _validate_review_advisory(scenario_root) if review_advisory else
                           _validate_continuous_workers(scenario_root) if continuous_workers else
                           _validate_action_alignment(scenario_root) if action_alignment else
                           _validate_cross_context_method(scenario_root) if cross_context_method else
                           _validate_online_retrospective(scenario_root) if online_retrospective else
                           _validate_pure_expression_scenario(scenario_root) if pure_expression else
                           _validate_source_handoff(scenario_root) if source_handoff else
                           _validate_minimal_five_pool(scenario_root, publication=case_name == "publish-five-pool") if minimal_five_pool else
                           _validate_direct_development_intent(scenario_root) if direct_development else
                           _validate_round2_recovery(scenario_root) if round2_recovery else
                           _validate_scenario(
                               scenario_root,
                               scenario,
                               scope,
                               periodic=periodic,
                               method_lifecycle=method_lifecycle,
                               method_rejection=method_rejection,
                               continuous_memory_pool=case_name == "continuous-memory-pool",
                           ))
        except BaseException as exc:
            results.append({
                "scenario": scenario,
                "passed": False,
                "error": f"{type(exc).__name__}: {exc}",
                "run_root": str(scenario_root),
            })
    output = root / "arc-self-harness-smoke-summary.json"
    output.write_text(json.dumps({
        "format": "arc-real-runner-self-harness-smoke-v1",
        "provider_mocked": True,
        "parent_provider_mocked": True,
        "research_provider_mocked": True,
        "environment_mocked": mock_environment,
        "runtime_boundaries_mocked": False,
        "passed": all(item.get("passed") is True for item in results),
        "scenarios": results,
        "acceptance_statement": (
            "Selected-case diagnostics establish only the boundaries asserted in their checks. "
            "They do not establish the complete five-component closure matrix. "
            "Provider/benchmark performance requires a real-provider ARC run."
        ) if case is not None else (
            "This suite exercises the real ARC bridge, Pi parent, child broker/process, structured return, "
            "parent creator read, semantic change classifier, native mutation, assembly, use, assessment, and later action path. "
            "When environment_mocked is true, SDK game behavior is a test double. "
            "Provider/benchmark performance requires a real-provider ARC run."
        ),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output
