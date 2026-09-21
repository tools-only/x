"""Real ARC-runner acceptance suite for Auto-Research -> self-harness.

The model provider is deterministic, but every boundary under test is the
production ARC/Pi path.  This is intentionally not a pytest fixture.
"""

from __future__ import annotations

import json
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


def _observation_ids(refs: list[Any]) -> set[str]:
    values: set[str] = set()
    for ref in refs:
        text = str(ref)
        if text.startswith("observation:") and "@v" in text:
            text = text[len("observation:"):].rsplit("@v", 1)[0]
        values.add(text)
    return values


def _validate_scenario(
    root: Path,
    scenario: str,
    scope: str | None = None,
    *,
    periodic: bool = False,
    method_lifecycle: bool = False,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0, "real ARC Pi loop exited cleanly", checks)
    expected_actions = 7 if periodic else 3 if scenario == "memory" else 2
    _check(runtime.get("agent_actions") == expected_actions, "expected real ARC action boundaries completed", checks)

    events = _records(root / "pi-events.jsonl")
    parent_tools = [
        str(event.get("toolName"))
        for event in events
        if event.get("type") == "tool_execution_start"
    ]
    required_prefix = ["task_harness", "arc_state", "arc_action" if periodic else "auto_research"]
    _check(parent_tools[:3] == required_prefix,
           "opening parent turn forced task_harness -> arc_state -> auto_research", checks)
    _check("arc_action" in parent_tools[3:], "first parent turn ended at a real ARC action", checks)
    if periodic:
        reviews = _records(root / "task-harness-reviews.jsonl")
        handoffs = _records(root / "auto-research-handoffs.jsonl")
        sessions = _records(root / "auto-research-sessions.jsonl")
        _check(len(reviews) == 1 and len(reviews[0].get("entries", [])) == 6,
               "runtime expanded partial review and bound the pending opportunity", checks)
        _check(bool(sessions) and bool(sessions[-1].get("research_handoff_ref")),
               "runtime bound handoff without model-copied ID and started linked child", checks)
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
    routes = _records(root / "auto-research-harness-routes.jsonl")
    receipts = _records(root / "auto-research-harness-route-receipts.jsonl")
    _check(any(item.get("route_status") == "ready" for item in routes),
           "code router compiled a ready route", checks)
    if not periodic:
        _check(parent_tools[:5] == ["task_harness", "arc_state", "auto_research", "task_harness", "arc_action"],
               "parent explicitly adopted the research proposal before the first ARC action", checks)
        auto_end = next((index for index, event in enumerate(events)
                         if event.get("type") == "tool_execution_end" and event.get("toolName") == "auto_research"), -1)
        apply_start = next((index for index, event in enumerate(events)
                            if index > auto_end and event.get("type") == "tool_execution_start"
                            and event.get("toolName") == "task_harness"
                            and event.get("args", {}).get("action") == "adopt_research"), -1)
        _check(auto_end >= 0 and apply_start > auto_end,
               "research returned before Self-Harness received the parent change", checks)
    _check(any(item.get("status") == "applied" and item.get("applied") is not False for item in receipts),
           "explicit parent change applied the route through the native harness executor", checks)

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

    contexts = [item for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                if item.get("child") is False]
    next_turn = [item for item in contexts if int(item.get("request", -1)) >= 4]
    _check(bool(contexts) and all(item.get("parent_guide_present") for item in contexts),
           "ARC parent uses the shared parent guide", checks)
    research_contexts = [item for item in _records(root / "arc-smoke-provider-contexts.jsonl")
                         if item.get("research_child")]
    expected_headings = [PROFILE_HEADINGS[scope]] if scope in PROFILE_HEADINGS else []
    _check(bool(research_contexts) and all(item.get("child_guide_present")
               and not item.get("parent_guide_present")
               and item.get("profile_headings") == expected_headings
               and not item.get("delivery_guide_in_system") for item in research_contexts),
           "child receives only its common guide and selected research profile", checks)
    _check(bool(research_contexts) and all(item.get("submission_contract_seen") for item in research_contexts),
           "child received the direct structured report and method delivery contract", checks)
    _check(bool(research_contexts) and all("research_approval" not in item.get("tool_names", [])
                                          for item in research_contexts),
           "child submitted an immutable candidate without the retired approval workflow", checks)
    prompt_loads = _records(root / "auto-research-prompt-loads.jsonl")
    _check(bool(prompt_loads) and all(item.get("scope") == (scope or "unspecified")
               and bool(item.get("profile_sha256")) == bool(expected_headings)
               for item in prompt_loads), "actual child profile load is recorded across continuations", checks)
    _check(bool(next_turn), "a later real parent provider turn occurred after route application", checks)
    if scenario == "memory":
        _check(any(item.get("messages_have_memory_marker") is True for item in next_turn),
               "next parent turn received routed memory content", checks)
        if not periodic:
            _check(any(item.get("knowledge_lifecycle_verified") for item in contexts if item.get("request", -1) >= 9),
                   "later real parent turn received replacement policy and suspended transitive stale guidance", checks)
    elif scenario == "skills":
        _check(any(item.get("messages_have_skill_marker") is True for item in next_turn),
               "next parent turn received routed skill content", checks)
    elif scenario == "system_prompt":
        _check(any(item.get("system_has_marker") is True for item in next_turn),
               "next parent turn received routed system-prompt content", checks)
    elif scenario == "tools":
        tool_events = _records(root / "task-tool-events.jsonl")
        invoked = [item for item in tool_events if item.get("event") == "invoked"
                   and item.get("name") == "smoke-counter"]
        _check(bool(invoked) and invoked[-1].get("status") == "completed",
               "next parent turn invoked the routed native task tool", checks)
        _check(bool(invoked) and invoked[-1].get("output_excerpt") == "2"
               and invoked[-1].get("semantic_effect_observed") is True,
               "routed tool executed its program and returned semantic output 2", checks)
        if method_lifecycle:
            lifecycle = _records(root / "task-method-lifecycle.jsonl")
            _check([item.get("maturity") for item in lifecycle] == [
                "candidate_method", "trial", "validated_within_scope",
            ], "method advanced only from grounded candidate through adoption and actual-use assessment", checks)
            actual_use_ref = invoked[-1].get("invocation_id") if invoked else None
            expected_actual_use_ref = f"task-tool-use-{actual_use_ref}" if actual_use_ref else None
            _check(bool(lifecycle) and lifecycle[-1].get("actual_use_observation_refs") == [expected_actual_use_ref]
                   and lifecycle[-1].get("latest_assessment", {}).get("actual_use_refs") == [expected_actual_use_ref],
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
    _check(runtime.get("agent_actions") == 6 and runtime.get("environment_error_count") == 0,
           "six irreversible ARC action boundaries completed the bounded online run", checks)

    events = _records(root / "pi-events.jsonl")
    starts = [event for event in events if event.get("type") == "tool_execution_start"]
    parent_sequence = [(event.get("toolName"), event.get("args", {}).get("action")) for event in starts]
    expected_prefix = [
        ("task_harness", "start"), ("arc_state", None),
        ("arc_action", "ACTION1"), ("arc_action", "RESET"),
        ("arc_action", "ACTION2"), ("arc_action", "ACTION1"),
        ("task_harness", "inspect"), ("auto_research", "start"),
        ("task_harness", "adopt_research"),
    ]
    expected_suffix = [
        ("task_harness", "assess_effect"), ("auto_research", "start"),
        ("task_harness", "inspect"), ("arc_action", "ACTION3"),
    ]
    sequence_ok = (parent_sequence[:len(expected_prefix)] == expected_prefix
                   and parent_sequence[len(expected_prefix)][0] == "task_resource"
                   and parent_sequence[len(expected_prefix) + 1][0] == "arc_action"
                   and parent_sequence[len(expected_prefix) + 2:len(expected_prefix) + 6] == expected_suffix)
    _check(sequence_ok, "parent preserved the online sequence from two contexts through feedback research", checks)

    observations = _records(root / "execution-observations.jsonl")
    by_id = {item.get("observation_id"): item for item in observations}
    _check(by_id.get("execution-observation-2", {}).get("input", {}).get("action") == "ACTION1"
           and by_id.get("execution-observation-3", {}).get("input", {}).get("action") == "RESET"
           and by_id.get("execution-observation-4", {}).get("input", {}).get("action") == "ACTION2"
           and by_id.get("execution-observation-5", {}).get("input", {}).get("action") == "ACTION1",
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
               "execution-observation-2", "execution-observation-5",
           }
           and "execution-observation-4" in opportunity.get("intervening_evidence_refs", []),
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
               "execution-observation-2", "execution-observation-4", "execution-observation-5",
           }, "parent selected one candidate ref and runtime expanded its exact evidence", checks)

    bundles = _records(root / "auto-research-comparison-bundles.jsonl")
    construction = next((item for item in bundles if item.get("run_id") == "auto-research-1"), {})
    repeated = construction.get("repeated_cases", [])
    repeated_action = next((item for item in repeated if item.get("action_signature") == "arc_action:ACTION1"), {})
    _check(construction.get("causal_interpretation") is False
           and construction.get("semantic_equivalence_claimed") is False,
           "code-built comparison remained causal-neutral", checks)
    _check(set(construction.get("selected_evidence_refs", [])) >= {
        "execution-observation-2", "execution-observation-4", "execution-observation-5",
    } and set(construction.get("episode_context_ids", [])) >= {
        "level:0:attempt:1", "level:0:attempt:2",
    } and repeated_action.get("context_count") == 2
       and repeated_action.get("episode_context_count") == 2,
           "comparison bundle retained two reset-separated construction cases and an explicit contrast", checks)

    construction_cards = [item for item in construction.get("evidence_cards", [])
                          if item.get("observation_ref") in {
                              "execution-observation-2", "execution-observation-5",
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
           and "observation:execution-observation-2@v1" in child_reads
           and "observation:execution-observation-4@v1" in child_reads
           and "observation:execution-observation-5@v1" in child_reads,
           "construction child read both public pre-action states, construction observations, and the contrast", checks)

    reports = _records(root / "auto-research-reports.jsonl")
    first_report = next((item for item in reports if item.get("run_id") == "auto-research-1"), {})
    first_body = first_report.get("report", {})
    method_candidates = first_body.get("method_candidates") or []
    method_candidate = method_candidates[0] if method_candidates else {}
    method = method_candidate.get("method", {})
    _check(_observation_ids(first_body.get("evidence_refs", [])) >= {
        "execution-observation-2", "execution-observation-4", "execution-observation-5",
    } and _observation_ids(method.get("construction_evidence_refs", [])) >= {
        "execution-observation-2", "execution-observation-5",
    } and _observation_ids(method.get("contrast_evidence_refs", [])) >= {
        "execution-observation-4",
    }, "child grounded the method in two contexts and an explicit contrast", checks)
    _check(bool(method.get("invariants")) and bool(method.get("parameters"))
           and bool(method.get("steps")) and bool(method.get("falsifier")),
           "child returned an auditable method abstraction rather than a trajectory summary", checks)
    proposals = first_body.get("harness_proposals") or []
    first_delivery = proposals[0].get("delivery", {}) if proposals else {}
    linked_delivery_id = method_candidate.get("proposed_delivery_id")
    _check(bool(linked_delivery_id) and linked_delivery_id == first_delivery.get("delivery_id")
           and not first_delivery.get("method"),
           "method candidate and executable component remained separate and explicitly linked", checks)

    lifecycle = _records(root / "task-method-lifecycle.jsonl")
    expected_maturity = ["candidate_method", "trial", "trial"]
    _check([item.get("maturity") for item in lifecycle[:3]] == expected_maturity,
           "method advanced through candidate, adoption trial, and assessed actual use", checks)
    _check(bool(lifecycle) and lifecycle[0].get("generalization_basis") == "cross_context"
           and lifecycle[0].get("generalization_scope") == "cross_episode"
           and set(lifecycle[0].get("episode_context_ids", [])) == {
               "level:0:attempt:1", "level:0:attempt:2",
           } and len(lifecycle[0].get("context_ids", [])) == 2,
           "method lifecycle retained its exact cross-context generalization basis", checks)

    resource_refs = lifecycle[1].get("resource_refs", []) if len(lifecycle) >= 2 else []
    _check(bool(resource_refs) and any(str(ref).startswith("skill:") for ref in resource_refs),
           "child-authored method procedure was adopted as an exact harness version", checks)
    accesses_by_parent = [item for item in accesses if item.get("reader") == "parent"]
    later_action = next((item for item in observations
                         if item.get("tool_name") == "arc_action"
                         and item.get("input", {}).get("decision", {}).get("basis_refs") == resource_refs), {})
    actual_use_ref = later_action.get("observation_id")
    cited_basis = later_action.get("input", {}).get("decision", {}).get("basis_refs", [])
    decision = later_action.get("input", {}).get("decision", {})
    _check(later_action.get("tool_name") == "arc_action"
           and bool(resource_refs) and cited_basis == resource_refs
           and any(item.get("resource_ref") in resource_refs for item in accesses_by_parent)
           and bool(decision.get("prediction")) and bool(decision.get("falsifier")) and len(lifecycle) >= 3
           and lifecycle[2].get("actual_use_observation_refs") == [actual_use_ref],
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
           and "observation:execution-observation-4@v1" in child_reads,
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

def run_arc_harness_smoke(
    root: Path,
    *,
    arc_root: Path,
    game: str = "ls20",
    mock_environment: bool = False,
    case: str | None = None,
) -> Path:
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ARC harness smoke output must be an empty directory")
    root.mkdir(parents=True, exist_ok=True)
    project_root = Path(__file__).resolve().parents[2]
    provider = project_root / "tools" / "arc_harness_smoke_provider.ts"
    results: list[dict[str, Any]] = []
    cases = list(zip(SCENARIOS, list(PROFILE_HEADINGS)[:5], SCENARIOS)) + [
        ("memory", "research_method", "profile-research-method"),
        ("memory", None, "profile-general"),
        ("memory", "hypothesis", "profile-hypothesis"),
        ("memory", "research_method", "periodic-memory"),
        ("tools", "research_method", "periodic-tools"),
        ("tools", "research_method", "method-lifecycle-tools"),
        ("tools", "research_method", "cross-context-method"),
    ]
    if case is not None:
        cases = [item for item in cases if item[2] == case]
        if not cases:
            raise ValueError(f"unknown ARC harness smoke case: {case}")
    for scenario, scope, case_name in cases:
        scenario_root = root / case_name
        periodic = case_name.startswith("periodic-")
        method_lifecycle = case_name == "method-lifecycle-tools"
        cross_context_method = case_name == "cross-context-method"
        try:
            run_arc_agi_3_e2e(
                scenario_root,
                arc_root=project_root if mock_environment else arc_root,
                **({"bridge_python": Path(sys.executable), "bridge_module_paths": (project_root / "tools/mock_arc_sdk",)} if mock_environment else {}),
                game=game,
                experiment_variant="treatment",
                max_actions=7 if periodic else 6 if cross_context_method else 3 if scenario == "memory" else 2,
                context_compaction=True,
                pi_provider="offline-arc-harness-smoke",
                pi_model="scripted",
                pi_provider_extension=provider,
                pi_environment={
                    "PI_ARC_SMOKE_SCENARIO": scenario,
                    "PI_ARC_SMOKE_SCOPE": scope or "",
                    "PI_ARC_SMOKE_PERIODIC": "1" if periodic else "0",
                    "PI_ARC_SMOKE_METHOD_LIFECYCLE": "1" if method_lifecycle else "0",
                    "PI_ARC_SMOKE_CROSS_CONTEXT_METHOD": "1" if cross_context_method else "0",
                    "PI_AUTORESEARCH_THINKING": "off",
                },
            )
            results.append(_validate_cross_context_method(scenario_root) if cross_context_method else
                           _validate_scenario(
                               scenario_root,
                               scenario,
                               scope,
                               periodic=periodic,
                               method_lifecycle=method_lifecycle,
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
            "This suite exercises the real ARC bridge/Pi/broker/router/action path. "
            "When environment_mocked is true, SDK game behavior is a test double. "
            "Provider/benchmark performance requires a real-provider ARC run."
        ),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output
