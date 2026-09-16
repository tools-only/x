"""Real ARC-runner acceptance suite for Auto-Research -> self-harness.

The model provider is deterministic, but every boundary under test is the
production ARC/Pi path.  This is intentionally not a pytest fixture.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .arc_agi_3_e2e import run_arc_agi_3_e2e


SCENARIOS = ("memory", "skills", "tools", "subagents", "system_prompt")


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


def _validate_scenario(root: Path, scenario: str) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    runtime = summary.get("runtime") if isinstance(summary.get("runtime"), dict) else {}
    _check(runtime.get("pi_returncode") == 0, "real ARC Pi loop exited cleanly", checks)
    _check(runtime.get("agent_actions") == 2, "two real ARC action boundaries completed", checks)

    events = _records(root / "pi-events.jsonl")
    parent_tools = [
        str(event.get("toolName"))
        for event in events
        if event.get("type") == "tool_execution_start"
    ]
    required_prefix = ["task_harness", "arc_state", "auto_research"]
    _check(parent_tools[:3] == required_prefix,
           "opening parent turn forced task_harness -> arc_state -> auto_research", checks)
    _check("arc_action" in parent_tools[3:], "first parent turn ended at a real ARC action", checks)

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
    _check(any(item.get("status") == "applied" and item.get("applied") is not False for item in receipts),
           "parent runtime applied the route through the native harness executor", checks)

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
    _check(bool(next_turn), "a later real parent provider turn occurred after route application", checks)
    if scenario == "memory":
        _check(any(item.get("messages_have_memory_marker") is True for item in next_turn),
               "next parent turn received routed memory content", checks)
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
        _check([item.get("stop_reason") for item in continuations] == ["length", "submitted_report"],
               "Auto-Research resumed a provider length boundary and submitted", checks)
        _check(len({item.get("session_id") for item in continuations}) == 1
               and len({item.get("native_session_id") for item in continuations}) == 1,
               "Auto-Research continuation kept one logical and native Pi session", checks)

    return {
        "scenario": scenario,
        "passed": all(item["passed"] for item in checks),
        "checks": checks,
        "run_root": str(root),
    }


def run_arc_harness_smoke(root: Path, *, arc_root: Path, game: str = "ls20") -> Path:
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ARC harness smoke output must be an empty directory")
    root.mkdir(parents=True, exist_ok=True)
    project_root = Path(__file__).resolve().parents[2]
    provider = project_root / "tools" / "arc_harness_smoke_provider.ts"
    results: list[dict[str, Any]] = []
    for scenario in SCENARIOS:
        scenario_root = root / scenario
        try:
            run_arc_agi_3_e2e(
                scenario_root,
                arc_root=arc_root,
                game=game,
                experiment_variant="treatment",
                max_actions=2,
                context_compaction=True,
                pi_provider="offline-arc-harness-smoke",
                pi_model="scripted",
                pi_provider_extension=provider,
                pi_environment={
                    "PI_ARC_SMOKE_SCENARIO": scenario,
                    "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(provider),
                    "PI_AUTORESEARCH_THINKING": "off",
                },
            )
            results.append(_validate_scenario(scenario_root, scenario))
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
        "runtime_boundaries_mocked": False,
        "passed": all(item.get("passed") is True for item in results),
        "scenarios": results,
        "acceptance_statement": (
            "Only this real ARC-runner suite (plus a subsequent real-provider run when requested) "
            "may be used as self-harness closure evidence; offline pytest fixtures are diagnostic only."
        ),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output
