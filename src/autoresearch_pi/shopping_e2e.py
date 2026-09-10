"""Thin task-facing adapter for JIT DeepPlanning Shopping cases.

The adapter deliberately keeps the Pi process in charge of the agent loop.  It
only prepares an isolated case description and provides a one-action bridge for
the Pi extension; it does not schedule research or mutate a harness itself.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import subprocess
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .observation_compaction_evidence import (
    COMPACTION_METRIC,
    audit_observation_compaction_effects,
)
from .pi_kernel import PiKernel
from .validation_evidence import (
    aggregate_validation_evidence,
    project_pair_evidence,
    validation_manifest_fingerprint,
)


SHOPPING_TOOLS = frozenset(
    {
        "search_products",
        "filter_by_brand",
        "filter_by_color",
        "filter_by_size",
        "filter_by_applicable_coupons",
        "filter_by_range",
        "sort_products",
        "get_product_details",
        "calculate_transport_time",
        "get_user_info",
        "add_product_to_cart",
        "delete_product_from_cart",
        "get_cart_info",
        "add_coupon_to_cart",
        "delete_coupon_from_cart",
    }
)
SHOPPING_BRIDGE_TOOLS = SHOPPING_TOOLS | frozenset({"shopping_batch_action"})


def _shopping_execution_response_profile(
    events: tuple[dict[str, Any], ...] | list[dict[str, Any]],
    observations: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Describe repeated Shopping actions without selecting an intervention."""
    tool_call_responses: dict[str, int] = {}
    assistant_response = 0
    for event in events:
        if event.get("type") != "message_end":
            continue
        message = event.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        assistant_response += 1
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "toolCall":
                continue
            tool_call_id = part.get("id")
            if isinstance(tool_call_id, str) and tool_call_id:
                tool_call_responses[tool_call_id] = assistant_response

    decision_responses = [
        tool_call_responses[decision["toolCallId"]]
        for decision in decisions
        if decision.get("applied") is True
        and isinstance(decision.get("toolCallId"), str)
        and decision["toolCallId"] in tool_call_responses
    ]
    first_decision_response = min(decision_responses) if decision_responses else None
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for observation in observations:
        if observation.get("category") != "task_action":
            continue
        key = (
            str(observation.get("tool") or "unknown"),
            str(observation.get("operation") or observation.get("tool") or "unknown"),
        )
        grouped.setdefault(key, []).append(observation)

    repeated: list[dict[str, Any]] = []
    for (tool, operation), records in sorted(grouped.items()):
        if len(records) < 2:
            continue
        response_numbers = [
            tool_call_responses.get(str(record.get("toolCallId"))) for record in records
        ]
        known_responses = [value for value in response_numbers if value is not None]
        counts_by_response = {
            value: known_responses.count(value) for value in set(known_responses)
        }
        relative_counts: dict[str, int | None] = {
            "calls_before_decision_response": None,
            "calls_in_decision_response": None,
            "calls_after_decision_response": None,
        }
        if first_decision_response is not None:
            relative_counts = {
                "calls_before_decision_response": sum(
                    value is not None and value < first_decision_response for value in response_numbers
                ),
                "calls_in_decision_response": sum(
                    value == first_decision_response for value in response_numbers
                ),
                "calls_after_decision_response": sum(
                    value is not None and value > first_decision_response for value in response_numbers
                ),
            }
        repeated.append({
            "tool": tool,
            "operation": operation,
            "calls": len(records),
            "attempted_work_units": sum(
                int(record.get("attempted_work_units", 1)) for record in records
            ),
            "assistant_responses": len(set(known_responses)),
            "max_calls_in_one_response": max(counts_by_response.values(), default=0),
            "all_calls_issued_in_one_response": (
                len(known_responses) == len(records) and len(set(known_responses)) == 1
            ),
            **relative_counts,
            "response_mapping_complete": len(known_responses) == len(records),
        })
    return {
        "agent_visible": False,
        "candidate_inference": "none",
        "first_applied_decision_response": first_decision_response,
        "repeated_action_groups": repeated,
        "source_refs": [
            "pi-events.jsonl", "execution-observations.jsonl", "harness-decisions.jsonl",
        ],
    }


def _audit_shopping_effects(
    observations: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    exposures: list[dict[str, Any]],
    assessments: list[dict[str, Any]],
    *,
    provider_contexts: list[dict[str, Any]] | None = None,
    pi_events: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate supported Shopping effects from canonical task-local records.

    This is an offline projection only.  It neither changes the Pi task nor
    chooses whether research or a surface adjustment should occur.
    """
    observations_by_id = {
        item.get("event_id"): item for item in observations
        if isinstance(item.get("event_id"), str)
    }
    findings_by_version = {
        (item.get("finding_id"), item.get("version")): item for item in findings
        if isinstance(item.get("finding_id"), str)
    }
    decisions_by_id = {
        item.get("decision_id"): item for item in decisions
        if isinstance(item.get("decision_id"), str)
    }
    metric_modes = {"shopping_batch_utilization": "shopping_batch"}
    valid_supported, issues = audit_observation_compaction_effects(
        observations,
        findings,
        decisions,
        exposures,
        assessments,
        provider_contexts or [],
        pi_events=pi_events or [],
    )

    def close(left: Any, right: float) -> bool:
        try:
            return abs(float(left) - right) <= 1e-9
        except (TypeError, ValueError):
            return False

    for assessment in assessments:
        if assessment.get("verdict") != "supported":
            continue
        assessment_id = str(assessment.get("effect_assessment_id") or "unknown-assessment")
        metric = assessment.get("effect_metric")
        if metric == COMPACTION_METRIC:
            continue
        expected_mode = metric_modes.get(metric)
        decision_id = assessment.get("decision_id")
        decision = decisions_by_id.get(decision_id)
        local_issues: list[str] = []
        if expected_mode is None:
            local_issues.append("unsupported_assessment_metric")
        if not decision or decision.get("applied") is not True:
            local_issues.append("missing_applied_decision")
        else:
            if decision.get("effect_metric") != metric:
                local_issues.append("decision_metric_mismatch")
            if expected_mode and decision.get("value") != expected_mode:
                local_issues.append("decision_surface_mismatch")

        tool_call_id = assessment.get("toolCallId")
        if decision and tool_call_id != decision.get("toolCallId"):
            local_issues.append("decision_tool_call_mismatch")

        basis_ids = decision.get("basis_resource_ids") if decision else None
        basis_snapshots = decision.get("basis_snapshots") if decision else None
        if not isinstance(basis_ids, list) or not basis_ids:
            local_issues.append("missing_finding_basis")
        if not isinstance(basis_snapshots, list) or not basis_snapshots:
            local_issues.append("missing_finding_snapshot")
        else:
            for snapshot in basis_snapshots:
                canonical = findings_by_version.get((
                    snapshot.get("finding_id"), snapshot.get("version")
                )) if isinstance(snapshot, dict) else None
                if canonical is None:
                    local_issues.append("unknown_finding_snapshot")
                    break

        exposure = next((item for item in exposures if (
            item.get("decision_id") == decision_id
            and item.get("toolCallId") == tool_call_id
            and item.get("effect_observed") is True
            and (item.get("operation") or {}).get("capability") == "pi.setActiveTools"
        )), None)
        if exposure is None:
            local_issues.append("missing_pi_exposure")
        else:
            if exposure.get("basis_resource_ids") != basis_ids:
                local_issues.append("exposure_basis_mismatch")
        window = assessment.get("window")
        observation_ids = window.get("observation_ids") if isinstance(window, dict) else None
        if not isinstance(observation_ids, list) or not observation_ids:
            local_issues.append("missing_effect_observations")
            window_observations: list[dict[str, Any]] = []
        elif len(observation_ids) != len(set(observation_ids)):
            local_issues.append("duplicate_effect_observation")
            window_observations = []
        else:
            window_observations = [observations_by_id[item] for item in observation_ids if item in observations_by_id]
            if len(window_observations) != len(observation_ids):
                local_issues.append("unknown_effect_observation")

        if exposure and window_observations:
            exposure_at = exposure.get("recordedAt")
            if any(
                isinstance(exposure_at, str) and isinstance(item.get("recordedAt"), str)
                and item["recordedAt"] < exposure_at for item in window_observations
            ):
                local_issues.append("pre_exposure_observation")

        if window_observations and isinstance(window, dict):
            attempted = sum(int(item.get("attempted_work_units", 0) or 0) for item in window_observations)
            completed = sum(int(item.get("completed_work_units", 0) or 0) for item in window_observations)
            tool_calls = len(window_observations)
            compression = attempted / tool_calls if tool_calls else 0.0
            common_expected = {
                "attempted_work_units": attempted,
                "completed_work_units": completed,
                "pi_tool_calls": tool_calls,
            }
            for key, expected in common_expected.items():
                if window.get(key) != expected:
                    local_issues.append(f"window_{key}_mismatch")
            if "tool_call_compression" in window and not close(window.get("tool_call_compression"), compression):
                local_issues.append("window_tool_call_compression_mismatch")
            bridge_processes = sum(int(item.get("bridge_processes", 1) or 0) for item in window_observations)
            work_units_per_bridge = attempted / bridge_processes if bridge_processes else 0.0
            if window.get("bridge_processes") != bridge_processes:
                local_issues.append("window_bridge_processes_mismatch")
            if not close(window.get("work_units_per_bridge_process"), work_units_per_bridge):
                local_issues.append("window_work_units_per_bridge_process_mismatch")

            if metric == "shopping_batch_utilization":
                if any(item.get("tool") not in {"shopping_batch_action", "add_product_to_cart"} for item in window_observations):
                    local_issues.append("irrelevant_effect_observation")
                if any(
                    item.get("tool") == "shopping_batch_action"
                    and not isinstance(item.get("bridge_processes"), int)
                    for item in window_observations
                ):
                    local_issues.append("missing_batch_bridge_process_count")
                batch_calls = sum(item.get("tool") == "shopping_batch_action" for item in window_observations)
                if window.get("batch_calls") != batch_calls:
                    local_issues.append("window_batch_calls_mismatch")
                if not (batch_calls == 1 and attempted >= 2 and completed == attempted):
                    local_issues.append("unsupported_window_reported_supported")

        if local_issues:
            issues.extend(f"{assessment_id}:{issue}" for issue in dict.fromkeys(local_issues))
        else:
            valid_supported.append(assessment)

    return valid_supported, issues


def _project_shopping_closed_loop(
    findings: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    exposures: list[dict[str, Any]],
    assessments: list[dict[str, Any]],
) -> dict[str, Any]:
    """Project compact inspectable links without copying observation bodies."""

    findings_by_version = {
        (item.get("finding_id"), item.get("version")): item
        for item in findings
        if isinstance(item.get("finding_id"), str) and isinstance(item.get("version"), int)
    }

    def short(value: Any) -> str:
        return " ".join(str(value or "").split())[:500]

    def finding_view(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "goal_id": item.get("goal_id"),
            "finding_id": item.get("finding_id"),
            "version": item.get("version"),
            "question": short(item.get("question")),
            "evidence": short(item.get("evidence")),
            "decision": short(item.get("decision")),
            "evidence_refs": item.get("evidence_refs") if isinstance(item.get("evidence_refs"), list) else [],
            "assessment_refs": item.get("assessment_refs") if isinstance(item.get("assessment_refs"), list) else [],
            "status": item.get("status"),
            "resolution": item.get("resolution"),
        }

    chains: list[dict[str, Any]] = []
    linked_versions: set[tuple[Any, Any]] = set()
    absorbed_versions: set[tuple[Any, Any]] = set()
    for decision in decisions:
        decision_id = decision.get("decision_id")
        snapshots = decision.get("basis_snapshots") if isinstance(decision.get("basis_snapshots"), list) else []
        basis: list[dict[str, Any]] = []
        for snapshot in snapshots:
            if not isinstance(snapshot, dict):
                continue
            key = (snapshot.get("finding_id"), snapshot.get("version"))
            linked_versions.add(key)
            canonical = findings_by_version.get(key)
            basis.append(finding_view(canonical if canonical is not None else snapshot))
        linked_exposures = [item for item in exposures if item.get("decision_id") == decision_id]
        linked_assessments = [item for item in assessments if item.get("decision_id") == decision_id]
        assessment_ids = {
            item.get("effect_assessment_id")
            for item in linked_assessments
            if isinstance(item.get("effect_assessment_id"), str)
        }
        absorptions = [
            finding_view(item)
            for item in findings
            if assessment_ids.intersection(
                ref for ref in item.get("assessment_refs", []) if isinstance(ref, str)
            )
        ]
        absorbed_versions.update(
            (item.get("finding_id"), item.get("version"))
            for item in findings
            if assessment_ids.intersection(
                ref for ref in item.get("assessment_refs", []) if isinstance(ref, str)
            )
        )
        chains.append({
            "decision_id": decision_id,
            "choice": decision.get("choice"),
            "applied": decision.get("applied"),
            "operation": decision.get("operation") or {
                "capability": "pi.setActiveTools" if decision.get("value") else None,
                "value": decision.get("value"),
            },
            "effect_metric": decision.get("effect_metric"),
            "expected_effect": short(decision.get("expected_effect")),
            "reconsider_when": short(decision.get("reconsider_when")),
            "basis": basis,
            "exposure_ids": [item.get("observation_id") for item in linked_exposures],
            "assessment_ids": [item.get("effect_assessment_id") for item in linked_assessments],
            "assessment_verdicts": [item.get("verdict") for item in linked_assessments],
            "absorbed_by": absorptions,
        })
    standalone = [
        finding_view(item)
        for item in findings
        if (item.get("finding_id"), item.get("version")) not in linked_versions
        and (item.get("finding_id"), item.get("version")) not in absorbed_versions
    ]
    return {
        "format": "task-local-closed-loop-evidence-v1",
        "chain_count": len(chains),
        "observation_bodies": "canonical_jsonl_only",
        "chains": chains,
        "standalone_finding_versions": standalone,
    }


def _compact_shopping_event(event: dict[str, Any]) -> dict[str, Any]:
    """Drop cumulative streaming snapshots while retaining event ordering."""
    if event.get("type") != "message_update":
        return event
    compact = dict(event)
    compact.pop("message", None)
    update = compact.get("assistantMessageEvent")
    if isinstance(update, dict):
        compact["assistantMessageEvent"] = {
            key: value for key, value in update.items() if key != "partial"
        }
    return compact


@dataclass(frozen=True)
class ShoppingExperimentResult:
    """Paths and counts for a counterbalanced Shopping ablation."""

    root: Path
    cases: tuple[str, ...]
    repeats: int
    summary: Path


def _load_jit_shopping_system_prompt(jit_root: Path, level: str) -> str:
    """Read one canonical level contract without importing JIT runtime code."""
    if level not in {"1", "2", "3"}:
        raise ValueError("shopping level must be '1', '2', or '3'")
    source = jit_root.resolve() / "benchmark" / "adapter" / "deepplanning.py"
    if not source.is_file():
        raise FileNotFoundError(f"JIT Shopping task contract not found: {source}")
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    target_name = f"SHOPPING_SYSTEM_PROMPT_L{level}"
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == target_name for target in targets):
            continue
        try:
            value = ast.literal_eval(node.value)
        except (TypeError, ValueError, SyntaxError) as exc:
            raise ValueError(f"JIT Shopping task contract {target_name} is not a literal string") from exc
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"JIT Shopping task contract {target_name} is empty or non-string")
        return value.strip()
    raise ValueError(f"JIT Shopping task contract {target_name} was not found in {source}")


def _format_jit_shopping_task(jit_root: Path, *, level: str, question: str) -> str:
    """Combine canonical benchmark semantics with the immutable user query."""
    system_prompt = _load_jit_shopping_system_prompt(jit_root, level)
    return _compose_jit_shopping_task(system_prompt, question)


def _compose_jit_shopping_task(system_prompt: str, question: str) -> str:
    return f"{system_prompt}\n\n## User Request\n\n{question.strip()}"


def _load_level_queries(dataset: Path, level: str) -> list[dict[str, Any]]:
    if level not in {"1", "2", "3"}:
        raise ValueError("shopping level must be '1', '2', or '3'")
    path = dataset / "data" / f"level_{level}_query_meta.json"
    if not path.is_file():
        raise FileNotFoundError(f"shopping query metadata not found: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError(f"shopping query metadata must be a list: {path}")
    return [item for item in value if isinstance(item, dict)]


def _shopping_case(dataset: Path, *, level: str, case_id: str, root: Path) -> dict[str, Any]:
    """Resolve one immutable JIT case and a fresh run-local mutable cart."""
    dataset = dataset.resolve()
    root = root.resolve()
    query = next((item for item in _load_level_queries(dataset, level) if str(item.get("id")) == str(case_id)), None)
    if query is None:
        raise KeyError(f"shopping case not found: level={level} case={case_id}")
    db_dir = dataset / f"database_level{level}" / f"case_{case_id}"
    if not db_dir.is_dir():
        raise FileNotFoundError(f"shopping database not found: {db_dir}")
    root.mkdir(parents=True, exist_ok=True)
    cart_path = root / "cart.json"
    cart_path.write_text(
        json.dumps(
            {"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {
        "question_id": f"level{level}_case{case_id}",
        "level": level,
        "case_id": str(case_id),
        "question": str(query.get("query", "")),
        "db_dir": str(db_dir),
        "cart_path": str(cart_path),
        "dataset": str(dataset),
    }


def _shopping_tool_payload(
    *, db_dir: str, cart_path: str, tool: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    """Build one bounded bridge-process request; arbitrary code is excluded."""
    if tool not in SHOPPING_BRIDGE_TOOLS:
        raise ValueError(f"unsupported shopping tool: {tool}")
    if not isinstance(arguments, dict):
        raise TypeError("shopping tool arguments must be an object")
    return {"db_dir": db_dir, "cart_path": cart_path, "tool": tool, "arguments": arguments}


def run_shopping_tool(
    payload: dict[str, Any], *, jit_root: Path | None = None, python: str | None = None
) -> str:
    """Execute exactly one allow-listed JIT domain tool in a child process."""
    request = _shopping_tool_payload(
        db_dir=str(payload.get("db_dir", "")), cart_path=str(payload.get("cart_path", "")),
        tool=str(payload.get("tool", "")), arguments=dict(payload.get("arguments") or {}),
    )
    root = (jit_root or Path(os.getenv("JIT_ROOT", r"D:\JIT"))).resolve()
    interpreter = python or os.getenv("JIT_PYTHON") or r"D:\anaconda\envs\jit\python.exe"
    bridge = [interpreter, "-m", "autoresearch_pi.shopping_tool_bridge"]
    env = os.environ.copy()
    project_src = str(Path(__file__).resolve().parent.parent)
    env["PYTHONPATH"] = project_src + os.pathsep + env.get("PYTHONPATH", "")
    result = subprocess.run(
        bridge, cwd=str(root), env=env, input=json.dumps(request), text=True,
        encoding="utf-8", errors="replace", capture_output=True, timeout=120, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"shopping bridge exited {result.returncode}")
    return result.stdout


def shopping_evaluator(*, db_dir: str, cart_path: str, jit_root: Path | None = None,
                       python: str | None = None) -> dict[str, Any]:
    """Run JIT's deterministic cart evaluator without importing its runtime."""
    root = (jit_root or Path(os.getenv("JIT_ROOT", r"D:\JIT"))).resolve()
    interpreter = python or os.getenv("JIT_PYTHON") or r"D:\anaconda\envs\jit\python.exe"
    code = (
        "import json,sys; "
        "from benchmark.adapter.deepplanning_shopping_eval import evaluate_shopping_prediction; "
        "print(json.dumps(evaluate_shopping_prediction(db_dir=sys.argv[1], cart_path=sys.argv[2])))"
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root) + os.pathsep + str(Path(__file__).resolve().parent.parent) + os.pathsep + env.get("PYTHONPATH", "")
    result = subprocess.run(
        [interpreter, "-c", code, str(Path(db_dir).resolve()), str(Path(cart_path).resolve())],
        cwd=str(root), env=env, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=120, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"shopping evaluator exited {result.returncode}")
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise ValueError("shopping evaluator returned a non-object")
    return value


def _resolve_pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Pi runtime unsupported: node executable was not found")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        raise RuntimeError(f"Pi runtime unsupported: installed CLI was not found at {cli}")
    return node, str(cli)


def _run_pi_shopping_task(
    root: Path,
    case: dict[str, Any],
    *,
    timeout: float = 900.0,
    experiment_variant: str = "treatment",
    context_compaction: bool = False,
) -> Any:
    """Run one Shopping task through Pi's native agent loop."""
    node, cli = _resolve_pi_cli()
    extension = Path(__file__).resolve().parents[2] / "demo" / "pi_shopping_e2e_extension.ts"
    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    dotenv = Path(env.get("JIT_ROOT", r"D:\JIT")) / ".env"
    if dotenv.is_file():
        for line in dotenv.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            env.setdefault(key.strip(), value)
    src = str(Path(__file__).resolve().parent.parent)
    env.update({
        "PI_CODING_AGENT_DIR": str(agent_dir),
        "PI_SHOPPING_E2E_ROOT": str(root),
        "PI_SHOPPING_DB_DIR": case["db_dir"],
        "PI_SHOPPING_CART_PATH": case["cart_path"],
        "JIT_ROOT": env.get("JIT_ROOT", r"D:\JIT"),
        "JIT_PYTHON": env.get("JIT_PYTHON", r"D:\anaconda\envs\jit\python.exe"),
        "AUTORESEARCH_PI_SRC": src,
        "PYTHONPATH": src + os.pathsep + env.get("PYTHONPATH", ""),
        "PI_SHOPPING_EXPERIMENT_VARIANT": experiment_variant,
        "PI_SHOPPING_CONTEXT_COMPACTION": "enabled" if context_compaction else "disabled",
    })
    jit_root = Path(env["JIT_ROOT"]).resolve()
    system_prompt = _load_jit_shopping_system_prompt(jit_root, str(case["level"]))
    task_prompt = _compose_jit_shopping_task(system_prompt, str(case["question"]))
    model = env.get("EXEC_MODEL", "a:deepseek-v4-flash")
    base_url, api_key = env.get("OPENAI_API_BASE"), env.get("OPENAI_API_KEY")
    if not base_url or not api_key:
        raise RuntimeError("D:\\JIT\\.env must define OPENAI_API_BASE and OPENAI_API_KEY")
    (agent_dir / "models.json").write_text(json.dumps({"providers": {"yibu": {"baseUrl": base_url, "api": "openai-completions", "apiKey": "$OPENAI_API_KEY", "authHeader": True, "models": [{"id": model, "name": model, "reasoning": False, "contextWindow": 128000, "maxTokens": 8192}]}}}), encoding="utf-8")
    command = (node, cli, "--mode", "rpc", "--provider", "yibu", "--model", model, "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools", "--extension", str(extension))
    events: list[dict[str, Any]] = []
    root.mkdir(parents=True, exist_ok=True)
    contract_source = jit_root / "benchmark" / "adapter" / "deepplanning.py"
    (root / "task-contract.json").write_text(json.dumps({
        "status": "canonical",
        "source": contract_source.as_posix(),
        "level": str(case["level"]),
        "system_prompt_sha256": hashlib.sha256(system_prompt.encode("utf-8")).hexdigest(),
        "task_prompt_sha256": hashlib.sha256(task_prompt.encode("utf-8")).hexdigest(),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    trace_path = root / "pi-events.jsonl"
    status_path = root / "pi-runtime-status.json"
    trace_stream = trace_path.open("a", encoding="utf-8")
    def persist(event: dict[str, Any]) -> None:
        events.append(event)
        trace_stream.write(json.dumps(_compact_shopping_event(event), ensure_ascii=False, separators=(",", ":")) + "\n")
        trace_stream.flush()
    status_path.write_text(json.dumps({"status": "running", "trace_complete": False, "trace_format": "compact-jsonl-v1", "message_updates": "delta_without_cumulative_snapshots"}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    run_error = ""
    try:
        with PiKernel(command, cwd=str(root), env=env, timeout=timeout, event_sink=persist) as kernel:
            response = kernel.prompt(task_prompt)
            if response.get("success") is False:
                run_error = f"Pi rejected prompt: {response}"
            else:
                kernel.wait_for_agent_events(timeout=timeout)
    except Exception as exc:
        # Preserve the events already received by the runner.  A timeout is a
        # task outcome, not permission to discard the partial execution trace.
        run_error = f"{type(exc).__name__}: {exc}"
    finally:
        trace_stream.flush()
        trace_stream.close()
    answer = ""
    succeeded = False
    error = ""
    for event in reversed(events):
        if event.get("type") == "agent_end":
            message = next((m for m in reversed(event.get("messages") or []) if m.get("role") == "assistant"), {})
            parts = message.get("content") or []
            answer = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict) and part.get("type") == "text").strip()
            succeeded = bool(answer) and message.get("stopReason") not in {"error", "aborted", "length"}
            error = "" if succeeded else str(message.get("errorMessage") or message.get("stopReason") or "Pi completed without an answer")
            break
    if run_error and not succeeded:
        error = run_error
    status_path.write_text(json.dumps({"status": "settled" if succeeded else "interrupted", "trace_complete": bool(succeeded), "trace_format": "compact-jsonl-v1", "message_updates": "delta_without_cumulative_snapshots", "event_count": len(events), "error": error}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return type("ShoppingPiRun", (), {"model": model, "answer": answer, "agent_succeeded": succeeded, "agent_error": error, "events": tuple(events)})()


def run_shopping_e2e(
    root: Path,
    *,
    dataset: Path | None = None,
    level: str = "3",
    case_id: str = "1",
    timeout: float = 900.0,
    pi_runner: Any | None = None,
    experiment_variant: str = "treatment",
    context_compaction: bool = False,
) -> Path:
    """Run one isolated Shopping case and write a compact summary.json."""
    dataset = (dataset or Path(os.getenv("SHOPPING_ROOT", r"D:\JIT\dataset\deepplanning_shopping"))).resolve()
    root = root.resolve()
    case = _shopping_case(dataset, level=level, case_id=case_id, root=root)
    native: Any
    runner_error = ""
    try:
        if pi_runner is None:
            native = _run_pi_shopping_task(
                root, case, timeout=timeout, experiment_variant=experiment_variant,
                context_compaction=context_compaction,
            )
        else:
            native = pi_runner(root, case, timeout=timeout, experiment_variant=experiment_variant)
    except Exception as exc:
        runner_error = f"{type(exc).__name__}: {exc}"
        native = type("ShoppingPiRun", (), {"model": os.getenv("EXEC_MODEL", "unknown"), "answer": "", "agent_succeeded": False, "agent_error": runner_error, "events": tuple()})()
    try:
        evaluation = shopping_evaluator(db_dir=case["db_dir"], cart_path=case["cart_path"])
    except Exception as exc:
        evaluation = {"score": 0.0, "case_score": 0.0, "match_rate": 0.0, "error": f"{type(exc).__name__}: {exc}"}
    def read_jsonl(name: str) -> list[dict[str, Any]]:
        path = root / name
        if not path.is_file():
            return []
        result: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                result.append(value)
        return result
    observations = read_jsonl("execution-observations.jsonl")
    findings = read_jsonl("research-resources.jsonl")
    decisions = read_jsonl("harness-decisions.jsonl")
    exposures = read_jsonl("harness-observations.jsonl")
    assessments = read_jsonl("effect-assessments.jsonl")
    provider_contexts = read_jsonl("provider-contexts.jsonl")
    native_events = tuple(getattr(native, "events", ()) or ())
    applied = [item for item in decisions if item.get("applied") is True]
    observed_decisions = {item.get("decision_id") for item in exposures if item.get("effect_observed") is True}
    reported_supported = [item for item in assessments if item.get("verdict") == "supported"]
    supported, effect_integrity_issues = _audit_shopping_effects(
        observations, findings, decisions, exposures, assessments,
        provider_contexts=provider_contexts,
        pi_events=list(native_events),
    )
    supported_decisions = {item.get("decision_id") for item in supported}
    if effect_integrity_issues and applied:
        research_connection = "apply_effect_invalid"
    elif applied and all(item.get("decision_id") in observed_decisions for item in applied) and supported_decisions:
        research_connection = "apply_effect_observed"
    elif applied and all(item.get("decision_id") in observed_decisions for item in applied):
        research_connection = "apply_observed_no_supported_effect"
    elif findings:
        research_connection = "finding_recorded_no_decision"
    else:
        research_connection = "not_attempted"
    batch_observations = [item for item in observations if item.get("tool") == "shopping_batch_action"]
    task_actions = [item for item in observations if item.get("category") == "task_action"]
    attempted_work_units = sum(int(item.get("attempted_work_units", 1)) for item in task_actions)
    completed_work_units = sum(int(item.get("completed_work_units", 0)) for item in task_actions)
    backend_bridge_processes = sum(int(item.get("bridge_processes", 1)) for item in task_actions)
    response_profile = _shopping_execution_response_profile(
        list(native_events), observations, decisions,
    )
    runtime_status: dict[str, Any] = {}
    runtime_status_path = root / "pi-runtime-status.json"
    if runtime_status_path.is_file():
        try:
            loaded_status = json.loads(runtime_status_path.read_text(encoding="utf-8"))
            if isinstance(loaded_status, dict):
                runtime_status = loaded_status
        except json.JSONDecodeError:
            runtime_status = {"status": "unknown", "trace_complete": False}
    visible_metrics: dict[str, Any] = {}
    visible_metrics_path = root / "model-visible-observation-metrics.json"
    if visible_metrics_path.is_file():
        try:
            loaded_metrics = json.loads(visible_metrics_path.read_text(encoding="utf-8"))
            if isinstance(loaded_metrics, dict):
                visible_metrics = loaded_metrics
        except json.JSONDecodeError:
            visible_metrics = {"status": "invalid_json"}
    task_contract: dict[str, Any] = {"status": "unavailable"}
    task_contract_path = root / "task-contract.json"
    if task_contract_path.is_file():
        try:
            loaded_contract = json.loads(task_contract_path.read_text(encoding="utf-8"))
            if isinstance(loaded_contract, dict):
                task_contract = loaded_contract
        except json.JSONDecodeError:
            task_contract = {"status": "invalid_json"}
    context_reported = [
        item for item in assessments if item.get("effect_metric") == COMPACTION_METRIC
    ]
    context_supported = [
        item for item in supported if item.get("effect_metric") == COMPACTION_METRIC
    ]
    assistant_usages = [
        event.get("message", {}).get("usage")
        for event in native_events
        if event.get("type") == "message_end"
        and isinstance(event.get("message"), dict)
        and event["message"].get("role") == "assistant"
        and isinstance(event["message"].get("usage"), dict)
    ]
    summary = {
        "status": "passed" if bool(native.agent_succeeded and evaluation.get("case_score", 0.0) == 1.0) else "failed",
        "pipeline": "pi-native-shopping-e2e", "case_id": case["question_id"], "level": level,
        "question": case["question"], "execution_model": native.model,
        "pi_agent_succeeded": bool(native.agent_succeeded), "pi_agent_error": native.agent_error,
        "evaluator": "JIT DeepPlanning shopping evaluator", "score": float(evaluation.get("score", 0.0)),
        "evaluator_passed": bool(native.agent_succeeded and evaluation.get("case_score", 0.0) == 1.0),
        "passed": bool(native.agent_succeeded and evaluation.get("case_score", 0.0) == 1.0),
        "evaluation": evaluation, "harness_improvement": "not_established",
        "experiment": {
            "variant": experiment_variant,
            "agent_visible_attribution": experiment_variant == "treatment",
            "context_compaction_available": bool(context_compaction and experiment_variant == "treatment"),
        },
        "task_contract": task_contract,
        "research": {"finding_count": len(findings), "research_event_count": len(findings), "research_connection": research_connection},
        "self_harness": {"decision_count": len(decisions), "applied_decision_count": len(applied), "exposure_count": len(exposures), "effect_assessment_count": len(assessments)},
        "execution_condition_effect": {
            "status": "supported" if supported else "invalid_link" if effect_integrity_issues else "not_attempted",
            "reported_status": "supported" if reported_supported else "not_attempted",
            # A supported execution window means the declared behavior
            # occurred.  It is not, by itself, evidence of a useful task
            # intervention.  Keep the raw status and expose a separate
            # correctness-gated projection so shortcut metrics cannot treat a
            # semantically incorrect cart as a positive harness outcome.
            "correctness_gated_status": (
                "supported" if supported and bool(native.agent_succeeded and evaluation.get("case_score", 0.0) == 1.0)
                else "observed_but_correctness_failed" if supported else "not_attempted"
            ),
            "batch_observation_count": len(batch_observations),
            "supported_assessment_count": len(supported),
            "reported_supported_assessment_count": len(reported_supported),
            "supported_effect_metrics": sorted({
                str(item.get("effect_metric")) for item in supported if item.get("effect_metric")
            }),
            "context_compaction": {
                "reported_assessment_count": len(context_reported),
                "supported_assessment_count": len(context_supported),
                "independently_recomputed_removed_chars": sum(
                    int((item.get("window") or {}).get("removed_chars", 0) or 0)
                    for item in context_supported
                ),
            },
            "integrity_issues": effect_integrity_issues,
        },
        "execution_efficiency": {
            "model_turns": sum(event.get("type") == "turn_end" for event in native_events),
            "model_input_tokens": sum(int(usage.get("input", 0) or 0) for usage in assistant_usages),
            "model_output_tokens": sum(int(usage.get("output", 0) or 0) for usage in assistant_usages),
            "provider_requests_with_usage": len(assistant_usages),
            "task_action_calls": len(task_actions),
            "backend_bridge_processes": backend_bridge_processes,
            "attempted_work_units": attempted_work_units,
            "completed_work_units": completed_work_units,
            "work_units_per_bridge_process": (
                round(completed_work_units / backend_bridge_processes, 3)
                if backend_bridge_processes else 0
            ),
            "response_profile": response_profile,
            "source_refs": [
                "pi-events.jsonl", "execution-observations.jsonl", "harness-decisions.jsonl",
            ],
        },
        "trace": {"status": runtime_status.get("status", "unavailable"), "trace_complete": bool(runtime_status.get("trace_complete", False)), "event_count": int(runtime_status.get("event_count", 0) or 0)},
        "model_visible_observation": visible_metrics,
        "closed_loop_evidence": _project_shopping_closed_loop(
            findings, decisions, exposures, assessments,
        ),
        "canonical_sources": {"cart": "cart.json", "evaluation": "evaluation.json", "task_contract": "task-contract.json", "observations": "execution-observations.jsonl", "findings": "research-resources.jsonl", "decisions": "harness-decisions.jsonl", "effects": "effect-assessments.jsonl", "pi_events": "pi-events.jsonl", "runtime_status": "pi-runtime-status.json", "model_visible_observation": "model-visible-observation-metrics.json"},
    }
    (root / "evaluation.json").write_text(json.dumps(evaluation, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path = root / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary_path


def _shopping_variant_metrics(summary: dict[str, Any]) -> dict[str, Any]:
    """Project only predeclared outcomes used by the offline comparison.

    The projection intentionally does not treat a finding, mutation, or
    evaluator score as a reward.  Those remain separate mediator/effect
    signals in the per-run summary.
    """
    evaluation = summary.get("evaluation") if isinstance(summary.get("evaluation"), dict) else {}
    research = summary.get("research") if isinstance(summary.get("research"), dict) else {}
    harness = summary.get("self_harness") if isinstance(summary.get("self_harness"), dict) else {}
    effect = summary.get("execution_condition_effect") if isinstance(summary.get("execution_condition_effect"), dict) else {}
    context_compaction = effect.get("context_compaction") if isinstance(effect.get("context_compaction"), dict) else {}
    visible = summary.get("model_visible_observation") if isinstance(summary.get("model_visible_observation"), dict) else {}
    efficiency = summary.get("execution_efficiency") if isinstance(summary.get("execution_efficiency"), dict) else {}
    response_profile = efficiency.get("response_profile") if isinstance(efficiency.get("response_profile"), dict) else {}
    repeated_groups = response_profile.get("repeated_action_groups") if isinstance(response_profile.get("repeated_action_groups"), list) else []
    trace = summary.get("trace") if isinstance(summary.get("trace"), dict) else {}
    task_contract = summary.get("task_contract") if isinstance(summary.get("task_contract"), dict) else {}
    error = str(summary.get("pi_agent_error") or "").lower()
    return {
        "passed": bool(summary.get("passed")),
        "agent_succeeded": bool(summary.get("pi_agent_succeeded")),
        "evaluator_passed": bool(summary.get("evaluator_passed")),
        "score": float(summary.get("score", evaluation.get("score", 0.0)) or 0.0),
        "case_score": float(evaluation.get("case_score", 0.0) or 0.0),
        "length_failure": "length" in error or "length" == str(summary.get("pi_agent_error") or "").lower(),
        "finding_count": int(research.get("finding_count", 0) or 0),
        "research_connection": research.get("research_connection", "not_attempted"),
        "decision_count": int(harness.get("decision_count", 0) or 0),
        "applied_decision_count": int(harness.get("applied_decision_count", 0) or 0),
        "effect_assessment_count": int(harness.get("effect_assessment_count", 0) or 0),
        "execution_condition_effect": effect.get("status", "not_attempted"),
        "correctness_gated_effect": effect.get("correctness_gated_status", "not_attempted"),
        "batch_observation_count": int(effect.get("batch_observation_count", 0) or 0),
        "context_compaction_supported_assessments": int(context_compaction.get("supported_assessment_count", 0) or 0),
        "context_compaction_removed_chars": int(context_compaction.get("independently_recomputed_removed_chars", 0) or 0),
        "model_visible_observation_chars": int(visible.get("observation_chars", 0) or 0),
        "decision_support_cards": int(visible.get("decision_support_cards", 0) or 0),
        "model_turns": int(efficiency.get("model_turns", 0) or 0),
        "model_input_tokens": int(efficiency.get("model_input_tokens", 0) or 0),
        "model_output_tokens": int(efficiency.get("model_output_tokens", 0) or 0),
        "provider_requests_with_usage": int(efficiency.get("provider_requests_with_usage", 0) or 0),
        "backend_bridge_processes": int(efficiency.get("backend_bridge_processes", 0) or 0),
        "repeated_action_group_count": len(repeated_groups),
        "multi_response_repeated_action_groups": sum(
            int(item.get("assistant_responses", 0) or 0) > 1
            for item in repeated_groups if isinstance(item, dict)
        ),
        "max_repeated_calls_in_one_response": max(
            (int(item.get("max_calls_in_one_response", 0) or 0)
             for item in repeated_groups if isinstance(item, dict)),
            default=0,
        ),
        "trace_event_count": int(trace.get("event_count", 0) or 0),
        "task_contract_status": task_contract.get("status", "unavailable"),
        "task_prompt_sha256": task_contract.get("task_prompt_sha256", ""),
        "variant": (summary.get("experiment") or {}).get("variant", "unknown"),
        "execution_model": summary.get("execution_model", "unknown"),
    }


def run_shopping_e2e_experiment(
    root: Path,
    *,
    cases: list[tuple[str, str]] | tuple[tuple[str, str], ...],
    repeats: int = 1,
    dataset: Path | None = None,
    timeout: float = 900.0,
    case_runner: Any | None = None,
    validation_strata: dict[str, dict[str, str]] | None = None,
) -> ShoppingExperimentResult:
    """Run fresh control/treatment Shopping pairs for a small validation cohort.

    ``cases`` contains ``(level, case_id)`` pairs.  The runner only isolates
    workspaces, alternates execution order, and projects already recorded
    outcomes; it never creates findings or invokes a Pi capability itself.
    """
    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    normalized_cases = tuple((str(level), str(case_id)) for level, case_id in cases)
    if not normalized_cases:
        raise ValueError("cases must contain at least one (level, case_id) pair")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("experiment output must be an empty directory; use a new run root")
    root.mkdir(parents=True, exist_ok=True)
    runner = case_runner or run_shopping_e2e
    pairs: list[dict[str, Any]] = []
    variant_records: dict[str, list[dict[str, Any]]] = {"control": [], "treatment": []}
    wins = {"control": 0, "treatment": 0, "ties": 0}
    completed_variants: list[dict[str, Any]] = []
    summary = root / "summary.json"

    def write_checkpoint(status: str) -> None:
        aggregates: dict[str, dict[str, Any]] = {}
        for variant, records in variant_records.items():
            if not records:
                aggregates[variant] = {"runs": 0}
                continue
            aggregates[variant] = {
                "runs": len(records),
                "passes": sum(bool(r["passed"]) for r in records),
                "pass_rate": sum(bool(r["passed"]) for r in records) / len(records),
                "average_case_score": sum(r["case_score"] for r in records) / len(records),
                "length_failures": sum(bool(r["length_failure"]) for r in records),
                "finding_runs": sum(r["finding_count"] > 0 for r in records),
                "applied_decisions": sum(r["applied_decision_count"] for r in records),
                "supported_effects": sum(r["execution_condition_effect"] == "supported" for r in records),
                "correctness_gated_supported_effects": sum(r["correctness_gated_effect"] == "supported" for r in records),
                "average_model_turns": sum(r["model_turns"] for r in records) / len(records),
                "average_model_input_tokens": sum(r["model_input_tokens"] for r in records) / len(records),
                "average_model_output_tokens": sum(r["model_output_tokens"] for r in records) / len(records),
                "average_provider_requests_with_usage": sum(r["provider_requests_with_usage"] for r in records) / len(records),
                "average_backend_bridge_processes": sum(r["backend_bridge_processes"] for r in records) / len(records),
                "multi_response_repeated_action_groups": sum(r["multi_response_repeated_action_groups"] for r in records),
                "average_model_visible_observation_chars": sum(r["model_visible_observation_chars"] for r in records) / len(records),
                "average_trace_event_count": sum(r["trace_event_count"] for r in records) / len(records),
            }
        contract_matches = sum(pair.get("task_contract_status") == "match" for pair in pairs)
        contract_mismatches = sum(pair.get("task_contract_status") == "mismatch" for pair in pairs)
        contract_unavailable = sum(pair.get("task_contract_status") == "unavailable" for pair in pairs)
        validity_status = (
            "invalid_task_contract" if contract_mismatches
            else "unverified" if not pairs or contract_unavailable
            else "valid"
        )
        payload = {
            "status": status, "pipeline": "pi-native-shopping-e2e-paired-experiment",
            "cases": [{"level": level, "case_id": case_id} for level, case_id in normalized_cases],
            "pair_count": len(pairs), "repeat_count": repeats,
            "planned_variant_run_count": len(normalized_cases) * repeats * 2,
            "completed_variant_run_count": len(completed_variants),
            "completed_variants": completed_variants,
            "design": {
                "unit": "same_case_paired_run",
                "control": "same JIT task/evaluator without agent-visible research or batch capability",
                "treatment": "optional task-local research resources and Pi-native shopping_batch surface",
                "execution_order": "counterbalanced_by_case_and_repeat",
                "agent_runtime": "fresh_independent_pi_process_per_variant",
                "task_workspace": "fresh independent cart per variant",
            },
            "pairs": pairs, "aggregate": {"completion_wins": wins, "variants": aggregates},
            "experiment_validity": {
                "status": validity_status,
                "task_contract_match_pairs": contract_matches,
                "task_contract_mismatch_pairs": contract_mismatches,
                "task_contract_unavailable_pairs": contract_unavailable,
            },
            "harness_improvement": "not_established",
            "causal_claim": "not_automatically_established",
            "interpretation": [
                "Use semantic task correctness as the primary outcome.",
                "Finding and Pi exposure are mediator/effect signals, not rewards.",
                "Treatment-minus-control deltas require repeated cases and stable model settings before a causal claim.",
            ],
        }
        if validation_strata:
            validation_records = []
            for pair in pairs:
                labels = validation_strata.get(
                    f"shopping:{pair.get('level')}:{pair.get('case_id')}"
                )
                if labels is None:
                    continue
                validation_records.append({
                    "benchmark": "shopping",
                    "level": pair.get("level"),
                    "case_id": pair.get("case_id"),
                    "repeat": pair.get("repeat"),
                    **project_pair_evidence(labels, pair),
                })
            payload["validation_evidence"] = {
                "agent_visible": False,
                "selection_policy": "runner_only_predeclared_strata",
                "manifest_sha256": validation_manifest_fingerprint(validation_strata),
                "records": validation_records,
                "unlabelled_pair_count": len(pairs) - len(validation_records),
                "aggregate": aggregate_validation_evidence(validation_records),
            }
        temporary = root / "summary.json.tmp"
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(summary)

    write_checkpoint("in_progress")
    for case_index, (level, case_id) in enumerate(normalized_cases, start=1):
        for repeat_index in range(1, repeats + 1):
            order = ("control", "treatment") if (case_index + repeat_index) % 2 else ("treatment", "control")
            variants: dict[str, dict[str, Any]] = {}
            for variant in order:
                variant_root = root / f"case-level{level}-{case_id}" / f"repeat-{repeat_index:03d}" / variant
                try:
                    result = runner(
                        variant_root, dataset=dataset, level=level, case_id=case_id,
                        timeout=timeout, experiment_variant=variant,
                    )
                    summary_path = result if isinstance(result, Path) else Path(result.summary)
                    projected = _shopping_variant_metrics(json.loads(summary_path.read_text(encoding="utf-8")))
                    projected["summary"] = str(summary_path)
                except Exception as exc:
                    variant_root.mkdir(parents=True, exist_ok=True)
                    error_path = variant_root / "runner-error.json"
                    error_path.write_text(json.dumps({"level": level, "case_id": case_id, "variant": variant, "error_type": type(exc).__name__, "error": str(exc)}, ensure_ascii=False, indent=2), encoding="utf-8")
                    projected = _shopping_variant_metrics({"pi_agent_error": str(exc), "experiment": {"variant": variant}})
                    projected["summary"] = str(error_path)
                variants[variant] = projected
                variant_records[variant].append(projected)
                completed_variants.append({
                    "level": level, "case_id": case_id,
                    "repeat": repeat_index, "variant": variant,
                    "summary": projected["summary"],
                })
                write_checkpoint("in_progress")
            treatment, control = variants["treatment"], variants["control"]
            treatment_contract = treatment.get("task_prompt_sha256")
            control_contract = control.get("task_prompt_sha256")
            task_contract_status = (
                "match" if treatment_contract and treatment_contract == control_contract
                else "mismatch" if treatment_contract and control_contract
                else "unavailable"
            )
            t_score, c_score = treatment["case_score"], control["case_score"]
            if treatment["passed"] and not control["passed"]:
                wins["treatment"] += 1
            elif control["passed"] and not treatment["passed"]:
                wins["control"] += 1
            else:
                wins["ties"] += 1
            pairs.append({
                "level": level, "case_id": case_id, "repeat": repeat_index,
                "execution_order": list(order), "variants": variants,
                "task_contract_status": task_contract_status,
                "observed_delta": {
                    "case_score": t_score - c_score,
                    "score": treatment["score"] - control["score"],
                    "passed": int(treatment["passed"]) - int(control["passed"]),
                    "model_turns": treatment["model_turns"] - control["model_turns"],
                    "model_input_tokens": treatment["model_input_tokens"] - control["model_input_tokens"],
                    "model_output_tokens": treatment["model_output_tokens"] - control["model_output_tokens"],
                    "provider_requests_with_usage": treatment["provider_requests_with_usage"] - control["provider_requests_with_usage"],
                    "backend_bridge_processes": treatment["backend_bridge_processes"] - control["backend_bridge_processes"],
                    "effect_supported": int(treatment["correctness_gated_effect"] == "supported") - int(control["correctness_gated_effect"] == "supported"),
                },
            })
            write_checkpoint("in_progress")
    write_checkpoint("completed")
    return ShoppingExperimentResult(root, normalized_cases, repeats, summary)


def run_shopping_context_compaction_ablation(
    root: Path,
    *,
    cases: list[tuple[str, str]] | tuple[tuple[str, str], ...],
    repeats: int = 1,
    dataset: Path | None = None,
    timeout: float = 900.0,
    case_runner: Any | None = None,
) -> ShoppingExperimentResult:
    """Compare one capability while preserving the full treatment runtime in both arms."""

    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    normalized_cases = tuple((str(level), str(case_id)) for level, case_id in cases)
    if not normalized_cases:
        raise ValueError("cases must contain at least one (level, case_id) pair")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ablation output must be an empty directory; use a new run root")
    root.mkdir(parents=True, exist_ok=True)
    runner = case_runner or run_shopping_e2e
    arms = ("without_context_compaction", "with_context_compaction")
    arm_records: dict[str, list[dict[str, Any]]] = {arm: [] for arm in arms}
    wins = {arms[0]: 0, arms[1]: 0, "ties": 0}
    pairs: list[dict[str, Any]] = []
    completed_arms: list[dict[str, Any]] = []
    summary = root / "summary.json"

    def write_checkpoint(status: str) -> None:
        aggregates: dict[str, dict[str, Any]] = {}
        for arm, records in arm_records.items():
            if not records:
                aggregates[arm] = {"runs": 0}
                continue
            aggregates[arm] = {
                "runs": len(records),
                "passes": sum(bool(item["passed"]) for item in records),
                "pass_rate": sum(bool(item["passed"]) for item in records) / len(records),
                "average_case_score": sum(item["case_score"] for item in records) / len(records),
                "finding_runs": sum(item["finding_count"] > 0 for item in records),
                "applied_decisions": sum(item["applied_decision_count"] for item in records),
                "supported_context_effects": sum(item["context_compaction_supported_assessments"] for item in records),
                "average_context_compaction_removed_chars": sum(item["context_compaction_removed_chars"] for item in records) / len(records),
                "average_model_input_tokens": sum(item["model_input_tokens"] for item in records) / len(records),
                "average_model_output_tokens": sum(item["model_output_tokens"] for item in records) / len(records),
                "average_provider_requests_with_usage": sum(item["provider_requests_with_usage"] for item in records) / len(records),
                "average_model_turns": sum(item["model_turns"] for item in records) / len(records),
                "average_backend_bridge_processes": sum(item["backend_bridge_processes"] for item in records) / len(records),
            }
        contract_matches = sum(pair.get("task_contract_status") == "match" for pair in pairs)
        contract_mismatches = sum(pair.get("task_contract_status") == "mismatch" for pair in pairs)
        contract_unavailable = sum(pair.get("task_contract_status") == "unavailable" for pair in pairs)
        payload = {
            "status": status,
            "pipeline": "pi-native-shopping-context-compaction-ablation",
            "cases": [{"level": level, "case_id": case_id} for level, case_id in normalized_cases],
            "pair_count": len(pairs),
            "repeat_count": repeats,
            "planned_arm_run_count": len(normalized_cases) * repeats * 2,
            "completed_arm_run_count": len(completed_arms),
            "completed_arms": completed_arms,
            "design": {
                "unit": "same_case_paired_run",
                "invariant_surface": "Auto-Research + shopping_batch treatment",
                "only_variable": "agent_owned_observation_compaction availability",
                "without_context_compaction": "full treatment runtime with the capability disabled",
                "with_context_compaction": "full treatment runtime with the optional capability disclosed",
                "execution_order": "counterbalanced_by_case_and_repeat",
                "agent_runtime": "fresh_independent_pi_process_per_arm",
                "task_workspace": "fresh independent cart per arm",
            },
            "pairs": pairs,
            "aggregate": {"completion_wins": wins, "arms": aggregates},
            "experiment_validity": {
                "status": (
                    "invalid_task_contract" if contract_mismatches
                    else "unverified" if not pairs or contract_unavailable
                    else "valid"
                ),
                "task_contract_match_pairs": contract_matches,
                "task_contract_mismatch_pairs": contract_mismatches,
                "task_contract_unavailable_pairs": contract_unavailable,
            },
            "harness_improvement": "not_established",
            "causal_claim": "not_automatically_established",
            "interpretation": [
                "Correctness gates every context and cost effect.",
                "A finding/apply/exposure mediator is required before attributing a delta to the capability.",
                "Repeated held-out pairs are required before any harness-improvement claim.",
            ],
        }
        temporary = root / "summary.json.tmp"
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(summary)

    write_checkpoint("in_progress")
    for case_index, (level, case_id) in enumerate(normalized_cases, start=1):
        for repeat_index in range(1, repeats + 1):
            order = arms if (case_index + repeat_index) % 2 else tuple(reversed(arms))
            variants: dict[str, dict[str, Any]] = {}
            for arm in order:
                enabled = arm == "with_context_compaction"
                arm_root = root / f"case-level{level}-{case_id}" / f"repeat-{repeat_index:03d}" / arm
                try:
                    result = runner(
                        arm_root,
                        dataset=dataset,
                        level=level,
                        case_id=case_id,
                        timeout=timeout,
                        experiment_variant="treatment",
                        context_compaction=enabled,
                    )
                    summary_path = result if isinstance(result, Path) else Path(result.summary)
                    projected = _shopping_variant_metrics(json.loads(summary_path.read_text(encoding="utf-8")))
                    projected["summary"] = str(summary_path)
                except Exception as exc:
                    arm_root.mkdir(parents=True, exist_ok=True)
                    error_path = arm_root / "runner-error.json"
                    error_path.write_text(json.dumps({
                        "level": level,
                        "case_id": case_id,
                        "arm": arm,
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    }, ensure_ascii=False, indent=2), encoding="utf-8")
                    projected = _shopping_variant_metrics({"pi_agent_error": str(exc)})
                    projected["summary"] = str(error_path)
                projected["variant"] = arm
                variants[arm] = projected
                arm_records[arm].append(projected)
                completed_arms.append({
                    "level": level,
                    "case_id": case_id,
                    "repeat": repeat_index,
                    "arm": arm,
                    "summary": projected["summary"],
                })
                write_checkpoint("in_progress")

            baseline = variants["without_context_compaction"]
            treatment = variants["with_context_compaction"]
            baseline_contract = baseline.get("task_prompt_sha256")
            treatment_contract = treatment.get("task_prompt_sha256")
            task_contract_status = (
                "match" if baseline_contract and baseline_contract == treatment_contract
                else "mismatch" if baseline_contract and treatment_contract
                else "unavailable"
            )
            if treatment["passed"] and not baseline["passed"]:
                wins["with_context_compaction"] += 1
            elif baseline["passed"] and not treatment["passed"]:
                wins["without_context_compaction"] += 1
            else:
                wins["ties"] += 1
            pairs.append({
                "level": level,
                "case_id": case_id,
                "repeat": repeat_index,
                "execution_order": list(order),
                "variants": variants,
                "task_contract_status": task_contract_status,
                "observed_delta": {
                    "case_score": treatment["case_score"] - baseline["case_score"],
                    "score": treatment["score"] - baseline["score"],
                    "passed": int(treatment["passed"]) - int(baseline["passed"]),
                    "model_turns": treatment["model_turns"] - baseline["model_turns"],
                    "model_input_tokens": treatment["model_input_tokens"] - baseline["model_input_tokens"],
                    "model_output_tokens": treatment["model_output_tokens"] - baseline["model_output_tokens"],
                    "provider_requests_with_usage": treatment["provider_requests_with_usage"] - baseline["provider_requests_with_usage"],
                    "backend_bridge_processes": treatment["backend_bridge_processes"] - baseline["backend_bridge_processes"],
                    "context_compaction_removed_chars": treatment["context_compaction_removed_chars"] - baseline["context_compaction_removed_chars"],
                },
            })
            write_checkpoint("in_progress")
    write_checkpoint("completed")
    return ShoppingExperimentResult(root, normalized_cases, repeats, summary)
