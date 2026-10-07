"""Pi-native ARC-AGI-3 end-to-end adapter."""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import socket
import subprocess
import secrets
import queue
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .jev_routing import apply_jev_routing_policy
from .pi_kernel import PiKernel
from .project import load_project_dotenv
from .arc_agi_3_adapter import (
    DEFAULT_ACTION_BUDGET_MULTIPLIER,
    DEFAULT_MAX_ANIMATION_FRAMES,
    OFFICIAL_ARC_SYSTEM_PROMPT,
    OFFICIAL_MAX_RUNTIME_SECONDS,
    resolve_input_modalities,
    resolve_model_settings,
)
from .observation_compaction_evidence import audit_observation_compaction_effects
from .research_evidence import project_research_evidence
from .subagent_broker import SubagentBroker


_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "demo" / "prompts"


class _ArcOuterRequestStopped(Exception):
    """An operator-declared evaluation checkpoint stopped outer dispatch."""


def _arc_reported_usage(path: Path) -> dict[str, Any]:
    """Read the native shared ledger with the same fail-closed integrity rule."""
    reported, unmeasured = 0, False
    def invalid_constant(value: str):
        raise ValueError(f"invalid JSON constant: {value}")
    try:
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line:
                    continue
                try:
                    row = json.loads(line, parse_constant=invalid_constant)
                    if not isinstance(row, dict):
                        raise ValueError("budget record must be an object")
                    if row.get("event") == "unmeasured_usage":
                        unmeasured = True
                    if row.get("event") == "reported_usage":
                        tokens = row.get("tokens")
                        if type(tokens) is not int or not 0 <= tokens <= 2**53 - 1:
                            unmeasured = True
                        else:
                            reported += tokens
                except (ValueError, TypeError):
                    unmeasured = True
    except (OSError, UnicodeError):
        unmeasured = True
    return {"reported_tokens": reported, "unmeasured_usage": unmeasured}


def _load_prompt(name: str, **values: str) -> str:
    """Load a human-readable runtime prompt and expand simple placeholders."""
    prompt = (_PROMPTS_DIR / name).read_text(encoding="utf-8").strip()
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)
    return prompt


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    """Append one compact runtime fact without rewriting the artifact."""
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def _compact_arc_pi_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Keep ARC execution evidence without repeating full assistant payloads."""
    event_type = event.get("type")
    if event_type in {"message_start", "turn_end", "agent_end"}:
        return None
    if event_type != "message_end":
        return event
    message = event.get("message")
    if not isinstance(message, dict):
        return {"type": "message_end"}
    retained = {
        key: message[key]
        for key in (
            "role", "stopReason", "errorMessage", "usage", "provider", "model", "api", "timestamp"
        )
        if key in message
    }
    return {"type": "message_end", "message": retained}


def _project_arc_kernel_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Retain only fields needed to drive a live ARC turn in process memory."""
    event_type = event.get("type")
    if event_type == "response":
        return event
    if event_type == "message_end":
        return _compact_arc_pi_event(event)
    if event_type == "tool_execution_end":
        projected = {
            "type": "tool_execution_end",
            "toolName": event.get("toolName"),
            "isError": event.get("isError", False),
        }
        if "toolCallId" in event:
            projected["toolCallId"] = event.get("toolCallId")
        # Keep only the small decision signature inputs/evidence needed by
        # the generic watchdog; do not duplicate the full ARC frame in RAM.
        if "args" in event:
            projected["args"] = event.get("args")
        result = event.get("result")
        details = result.get("details") if isinstance(result, dict) else None
        if isinstance(details, dict):
            evidence = {
                key: details[key]
                for key in (
                    "version", "revision", "state_version", "state", "progress",
                    "levels_completed", "action_budget",
                    "public_transition", "arc_action_boundary", "arc_terminal",
                    "terminal_reason",
                )
                if key in details
            }
            delta = details.get("observation_delta")
            if isinstance(delta, dict):
                evidence["observation_delta"] = {
                    key: delta[key]
                    for key in ("changed_cells", "bbox", "frame_available")
                    if key in delta
                }
            if evidence:
                projected["evidence"] = evidence
        return projected
    if event_type == "agent_progress_watchdog":
        return event
    if event_type in {"turn_start", "agent_end", "agent_settled"}:
        return {"type": event_type}
    return None


def _turn_has_nonreset_arc_feedback(events: list[dict[str, Any]]) -> bool:
    """Accept committed public receipts, including a successful partial batch."""
    def completed(receipt):
        return (isinstance(receipt, dict) and isinstance(receipt.get("action"), str) and receipt.get("action") in
                {"ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION6", "ACTION7"}
                and not receipt.get("is_error", False) and not receipt.get("isError", False)
                and (receipt.get("status") is None or isinstance(receipt.get("status"), str))
                and receipt.get("status") not in {"failed", "error", "unknown", "pending"})

    for event in events:
        if event.get("type") != "tool_execution_end":
            continue
        evidence = event.get("evidence") if isinstance(event.get("evidence"), dict) else {}
        if (event.get("toolName") in {"arc_action", "arc_actions", "delegate_task"}
                and evidence.get("nonreset_arc_feedback") is True):
            return True  # This fact is produced only by the scoped projector below.
        result = event.get("result") if isinstance(event.get("result"), dict) else {}
        details = result.get("details") if isinstance(result.get("details"), dict) else {}
        name = event.get("toolName")
        if name == "arc_action" and not event.get("isError", False):
            public = details or evidence
            if (public.get("arc_action_boundary") is True or isinstance(public.get("state"), str)
                    or isinstance(public.get("public_transition"), dict)) and completed(event.get("args")):
                return True
        receipts = details.get("completed") if name == "arc_actions" else (
            details.get("arc_action_receipts") if name == "delegate_task" else None)
        if isinstance(receipts, list) and any(completed(receipt) for receipt in receipts):
            return True
    return False


def _project_arc_feedback_kernel_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Keep one receipt-derived fact for the opt-in allocator, never full frames."""
    projected = _project_arc_kernel_event(event)
    if projected is not None and _turn_has_nonreset_arc_feedback([event]):
        projected.setdefault("evidence", {})["nonreset_arc_feedback"] = True
    return projected


def _initial_reasoning_after_feedback(env, reasoning_policy, reasoning_levels, model_settings):
    configured = env.get("PI_REASONING_INITIAL_AFTER_FEEDBACK", "")
    if configured not in {"", "disabled", "enabled"}:
        raise ValueError("PI_REASONING_INITIAL_AFTER_FEEDBACK must be enabled or disabled")
    if configured != "enabled":
        return False
    if (reasoning_policy != "adaptive-binary" or not {"off", "medium"}.issubset(reasoning_levels)
            or model_settings.get("pi_api") != "openai-completions"
            or model_settings.get("thinking_format") != "qwen"):
        raise ValueError("initial reasoning after feedback requires adaptive-binary, verified off+medium, "
                         "openai-completions and native qwen thinking format")
    return True


def _reasoning_length_recovery(env, reasoning_policy, reasoning_levels, model_settings, provider_extension=None):
    configured = env.get("PI_REASONING_LENGTH_RECOVERY", "")
    if configured not in {"", "disabled", "enabled"}:
        raise ValueError("PI_REASONING_LENGTH_RECOVERY must be enabled or disabled")
    if configured != "enabled":
        return False
    if (reasoning_policy != "adaptive-binary" or not {"off", "medium"}.issubset(reasoning_levels)
            or model_settings.get("pi_api") != "openai-completions"
            or model_settings.get("thinking_format") != "qwen" or provider_extension is not None):
        raise ValueError("length recovery requires adaptive-binary, verified off+medium, "
                         "openai-completions and native qwen HTTP thinking format")
    return True


def _latest_records(
    records: list[dict[str, Any]],
    *,
    key: str,
    fields: tuple[str, ...],
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Project latest component versions without copying large task-local bodies."""
    latest: dict[str, dict[str, Any]] = {}
    for record in records:
        identity = record.get(key)
        if not isinstance(identity, str) or not identity:
            continue
        previous = latest.get(identity)
        if previous is None or int(record.get("version", 0) or 0) >= int(previous.get("version", 0) or 0):
            latest[identity] = record
    selected = sorted(latest.values(), key=lambda item: str(item.get("recordedAt") or ""))[-limit:]
    return [{field: item.get(field) for field in fields if field in item} for item in selected]


def _provider_telemetry_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate provider telemetry without copying request or response bodies."""
    requests = [item for item in records if item.get("event") == "provider_request"]
    responses = [item for item in records if item.get("event") == "provider_response"]
    assistants = [item for item in records if item.get("event") == "assistant_message"]

    def values(items: list[dict[str, Any]], key: str) -> list[int]:
        return [int(item[key]) for item in items if isinstance(item.get(key), (int, float))]

    def stats(items: list[dict[str, Any]], key: str) -> dict[str, Any]:
        selected = values(items, key)
        return {
            "count": len(selected),
            "first": selected[0] if selected else None,
            "last": selected[-1] if selected else None,
            "maximum": max(selected) if selected else None,
            "total": sum(selected),
        }

    stop_reasons: dict[str, int] = {}
    for item in assistants:
        reason = str(item.get("stop_reason") or "unknown")
        stop_reasons[reason] = stop_reasons.get(reason, 0) + 1
    token_usage = {}
    for key in ("input", "output", "reasoning", "non_reasoning_output", "cache_read", "cache_write", "total_tokens"):
        known = [item.get("usage", {}).get(key) for item in assistants if isinstance(item.get("usage"), dict)]
        numbers = [v for v in known if isinstance(v, (int, float))]
        token_usage[key] = {"total": sum(numbers), "measured_messages": len(numbers), "message_count": len(assistants)}
    return {
        "record_count": len(records),
        "request_count": len(requests),
        "response_count": len(responses),
        "assistant_message_count": len(assistants),
        "payload_json_chars": stats(requests, "payload_json_chars"),
        "message_count": stats(requests, "message_count"),
        "system_message_json_chars": stats(requests, "system_message_json_chars"),
        "tool_result_json_chars": stats(requests, "tool_result_json_chars"),
        "tool_definition_json_chars": stats(requests, "tool_definition_json_chars"),
        "response_latency_ms": stats(responses, "latency_ms"),
        "assistant_elapsed_ms": stats(assistants, "elapsed_ms"),
        "stop_reasons": stop_reasons,
        "token_usage": token_usage,
        "superseded_attempts": sum(item.get("event") == "provider_attempt_superseded" for item in records),
        "interpretation": (
            "Observation-only request telemetry; payload bodies and credentials are not persisted. "
            "A missing request count can occur for providers that bypass the HTTP payload hook."
        ),
    }


def _context_token_debug_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize the privacy-preserving per-turn context token debug log."""
    requests = [item for item in records if item.get("event") == "provider_request_context"]
    usages = [item for item in records if item.get("event") == "provider_response_usage"]

    def numeric_values(items: list[dict[str, Any]], key: str) -> list[int]:
        return [int(item[key]) for item in items if isinstance(item.get(key), (int, float))]

    def stats(items: list[dict[str, Any]], key: str) -> dict[str, Any]:
        values = numeric_values(items, key)
        return {
            "count": len(values),
            "first": values[0] if values else None,
            "last": values[-1] if values else None,
            "maximum": max(values) if values else None,
            "total": sum(values),
        }

    latest_modules = requests[-1].get("modules") if requests else {}
    return {
        "record_count": len(records),
        "request_count": len(requests),
        "usage_count": len(usages),
        "estimated_input_tokens": stats(requests, "estimated_input_tokens"),
        "actual_input_tokens": stats(usages, "actual_input_tokens"),
        "actual_output_tokens": stats(usages, "actual_output_tokens"),
        "latest_turn": requests[-1].get("turn") if requests else None,
        "latest_modules": latest_modules,
        "interpretation": (
            "Per-provider-turn context accounting. estimated_input_tokens uses the explicit "
            "provider-independent JSON-character heuristic; actual_input_tokens is copied from "
            "the provider usage event when available. Module bodies are not persisted."
        ),
    }


def _auto_research_harness_closure(
    *,
    route_receipts: list[dict[str, Any]],
    memory: list[dict[str, Any]],
    skills: list[dict[str, Any]],
    task_tools: list[dict[str, Any]],
    subagents: list[dict[str, Any]],
    system_prompts: list[dict[str, Any]],
    context_exposures: list[dict[str, Any]],
    task_tool_events: list[dict[str, Any]],
    subagent_invocations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Prove route -> native materialization -> later use for all five components."""
    specs = {
        "system_prompt": ("task_system_prompt", "system_prompt", system_prompts, "name"),
        "skills": ("task_skill", "skill", skills, "name"),
        "memory": ("task_memory", "memory", memory, "key"),
        "tools": ("task_tool", "tool", task_tools, "name"),
        "subagents": ("task_subagent", "subagent", subagents, "name"),
    }

    def exact_record(records: list[dict[str, Any]], identity_key: str, ref: str) -> dict[str, Any] | None:
        try:
            _kind, tail = ref.split(":", 1)
            name, raw_version = tail.rsplit("@v", 1)
            version = int(raw_version)
        except (ValueError, TypeError):
            return None
        return next((item for item in records
                     if str(item.get(identity_key) or "") == name
                     and int(item.get("version", 0) or 0) == version), None)

    def after(item: dict[str, Any], timestamp: str) -> bool:
        return str(item.get("recordedAt") or "") >= timestamp

    projected: dict[str, Any] = {}
    for component, (native_tool, resource_kind, records, identity_key) in specs.items():
        candidates = [item for item in route_receipts
                      if item.get("native_tool") == native_tool
                      and item.get("status") == "applied"
                      and item.get("applied") is not False]
        route_applied = bool(candidates)
        selected_receipt: dict[str, Any] | None = None
        selected_record: dict[str, Any] | None = None
        used_after_route = False
        for receipt in candidates:
            ref = str(receipt.get("resource_ref") or "")
            if not ref.startswith(resource_kind + ":"):
                continue
            record = exact_record(records, identity_key, ref)
            if record is None:
                continue
            receipt_time = str(receipt.get("recordedAt") or "")
            version = int(record.get("version", 0) or 0)
            name = str(record.get(identity_key) or "")
            if component == "memory":
                resource_id = str(record.get("memory_id") or "")
                used = any(after(exposure, receipt_time) and any(
                    str(item.get("memory_id") or "") == resource_id
                    and int(item.get("version", 0) or 0) == version
                    for item in exposure.get("memory_versions", [])
                ) for exposure in context_exposures)
            elif component == "skills":
                used = any(after(exposure, receipt_time) and any(
                    str(item.get("name") or "") == name
                    and int(item.get("version", 0) or 0) == version
                    for item in exposure.get("skill_versions", [])
                ) for exposure in context_exposures)
            elif component == "system_prompt":
                used = any(after(exposure, receipt_time) and any(
                    str(item.get("name") or "") == name
                    and int(item.get("version", 0) or 0) == version
                    for item in exposure.get("system_prompt_versions", [])
                ) for exposure in context_exposures)
            elif component == "tools":
                used = any(after(event, receipt_time)
                           and event.get("event") == "invoked"
                           and event.get("status") == "completed"
                           and event.get("semantic_effect_observed") is True
                           and str(event.get("name") or "") == name
                           and int(event.get("version", 0) or 0) == version
                           for event in task_tool_events)
            else:
                used = any(after(invocation, receipt_time)
                           and invocation.get("status") == "completed"
                           and str(invocation.get("agent_name") or "") == name
                           and isinstance(invocation.get("result"), dict)
                           and bool(str(invocation["result"].get("text") or "").strip())
                           for invocation in subagent_invocations)
            selected_receipt, selected_record = receipt, record
            if used:
                used_after_route = True
                break
        projected[component] = {
            "route_applied": route_applied,
            "materialized": selected_record is not None,
            "used_after_route": used_after_route,
            "route_id": selected_receipt.get("route_id") if selected_receipt else None,
            "resource_ref": selected_receipt.get("resource_ref") if selected_receipt else None,
        }
    required = ["system_prompt", "skills", "memory", "tools", "subagents"]
    return {
        "required_components": required,
        "complete": all(
            projected[name]["route_applied"]
            and projected[name]["materialized"]
            and projected[name]["used_after_route"]
            for name in required
        ),
        "components": projected,
        "interpretation": (
            "A component closes only when an approved Auto-Research route receipt applied its native Pi mutation, "
            "the exact resource version exists, and a later parent turn exposed or invoked that version. "
            "Tool invocation additionally requires a non-passthrough semantic effect; subagent invocation requires "
            "a completed non-empty result."
        ),
    }


METHOD_EVOLUTION_STAGE_ORDER = (
    "method_candidate",
    "adoption",
    "actual_arc_use",
    "effect_evaluation",
    "feedback_research",
)


def _method_evolution_audit(
    *,
    methods: list[dict[str, Any]],
    comparisons: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    assessments: list[dict[str, Any]],
    handoffs: list[dict[str, Any]],
    reports: list[dict[str, Any]],
    resource_accesses: list[dict[str, Any]] | None = None,
    harness_resources: dict[str, dict[str, Any]] | None = None,
    research_runs: list[dict[str, Any]] | None = None,
    subagent_progress: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Audit the strict online method lifecycle from durable references.

    The audit deliberately ignores component exposure and standalone tool use.
    A method reaches actual use only when a later successful ``arc_action``
    cites an exact adopted resource version in ``decision.basis_refs``.
    """
    research_runs = research_runs or []
    subagent_progress = subagent_progress or []
    resource_accesses = resource_accesses or []
    harness_resources = harness_resources or {}
    by_observation = {
        str(item.get("observation_id") or item.get("event_id") or ""): item
        for item in observations
    }
    by_assessment = {
        str(item.get("effect_assessment_id") or ""): item for item in assessments
    }
    by_report_ref: dict[str, dict[str, Any]] = {}
    for item in reports:
        run_id = str(item.get("run_id") or "")
        version = int(item.get("version", 1) or 1)
        if run_id:
            by_report_ref[str(item.get("report_ref") or f"research_report:{run_id}@v{version}")] = item

    def report_body(item: dict[str, Any] | None) -> dict[str, Any]:
        if not item:
            return {}
        nested = item.get("report")
        return nested if isinstance(nested, dict) else item

    def supported_report(item: dict[str, Any] | None) -> bool:
        body = report_body(item)
        return bool(
            item
            and item.get("status") == "completed"
            and body.get("status") in {"supported", "supported_within_scope"}
            and (body.get("conclusion") or body.get("findings"))
        )

    def observation_ref_id(value: Any) -> str:
        reference = str(value or "")
        match = re.match(r"^observation:([^@]+)@v\d+$", reference)
        return match.group(1) if match else reference

    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in methods:
        method_id = str(item.get("method_id") or "")
        if method_id:
            grouped.setdefault(method_id, []).append(item)

    def stage(passed: bool, reason: str, refs: list[str] | None = None) -> dict[str, Any]:
        return {
            "passed": bool(passed),
            "reason": reason,
            "evidence_refs": list(dict.fromkeys(str(ref) for ref in (refs or []) if str(ref))),
        }

    chains: list[dict[str, Any]] = []
    for method_id, versions in sorted(grouped.items()):
        versions.sort(key=lambda item: int(item.get("version", 0) or 0))
        candidate = next((item for item in versions
                          if item.get("maturity") == "candidate_method"), versions[0])
        specification = candidate.get("method") if isinstance(candidate.get("method"), dict) else {}
        construction_refs = [str(ref) for ref in candidate.get("construction_evidence_refs", [])]
        context_ids = [str(ref) for ref in candidate.get("context_ids", [])]
        episode_ids = [str(ref) for ref in candidate.get("episode_context_ids", [])]
        exact_construction = [ref for ref in construction_refs if ref in by_observation]
        source_report_ref = str(candidate.get("source_report_ref") or "")
        source_run_id = str(candidate.get("source_run_ref") or "").removeprefix("research_run:").split("@", 1)[0]
        if not source_run_id:
            source_run_id = source_report_ref.removeprefix("research_report:").split("@", 1)[0]
        source_comparison = next((item for item in comparisons
                                  if str(item.get("run_id") or "") == source_run_id), {})
        construction_contexts = {
            str(case.get("situation_context_id") or case.get("context_id") or "")
            for group in [*(source_comparison.get("outcome_contrasts") or []), *(source_comparison.get("repeated_cases") or [])]
            for case in group.get("cases", [])
            if observation_ref_id(case.get("observation_ref")) in set(exact_construction)
            and str(case.get("situation_context_id") or case.get("context_id") or "")
        }
        source_report = by_report_ref.get(source_report_ref)
        report_evidence = {
            str(ref) for ref in report_body(source_report).get("evidence_refs", [])
        }
        induction_ok = (
            candidate.get("generalization_basis") == "cross_context"
            and len(set(context_ids)) >= 2
            and len(construction_contexts) >= 2
            and len(set(exact_construction)) >= 2
            and supported_report(source_report)
            and set(exact_construction).issubset(report_evidence)
        )
        stages: dict[str, dict[str, Any]] = {
            "cross_situation_induction": stage(
                induction_ok,
                "Exact construction observations map to distinct situations in the source comparison."
                if induction_ok else
                "No supported research report preserves at least two exact construction observations that map to distinct situations in its source comparison.",
                [source_report_ref, *exact_construction, *context_ids, *episode_ids],
            ),
        }
        # The lifecycle audit also reads historical method records that predate
        # the richer authoring contract. Runtime admission enforces the full
        # procedural fields; the audit only needs enough structure to distinguish
        # a method record from experience text.
        required_method_fields = ("invariants", "parameters", "steps", "falsifier")
        structured = all(bool(specification.get(key)) for key in required_method_fields)
        candidate_ref = f"method:{method_id}@v{int(candidate.get('version', 1) or 1)}"
        stages["method_candidate"] = stage(
            structured,
            "The candidate contains a scoped procedure with inputs, decisions, stop and failure boundaries, and a falsifier."
            if structured else
            "No trajectory-independent method candidate supplies the complete procedural contract.",
            [candidate_ref, str(candidate.get("candidate_ref") or "")],
        )

        adopted = next((item for item in versions
                        if item.get("resource_refs") and item.get("application_refs")), None)
        adopted_refs = [str(ref) for ref in (adopted or {}).get("resource_refs", [])]
        adopted_at = str((adopted or {}).get("recordedAt") or "")
        adoption_ok = structured and bool(adopted_refs) and bool(adopted_at)
        stages["adoption"] = stage(
            adoption_ok,
            "The parent adoption materialized exact versioned harness resources."
            if adoption_ok else "No parent adoption produced an exact versioned harness resource.",
            [*(adopted or {}).get("application_refs", []), *adopted_refs],
        )

        action_uses: list[str] = []
        use_contracts: dict[str, dict[str, Any]] = {}
        for observation_id, observation in by_observation.items():
            if observation.get("tool_name") != "arc_action" or observation.get("is_error") is True:
                continue
            observed_at = str(observation.get("recordedAt") or "")
            if not observed_at or observed_at <= adopted_at:
                continue
            decision = ((observation.get("input") or {}).get("decision") or {})
            basis_refs = {str(ref) for ref in decision.get("basis_refs", [])}
            cited_refs = sorted(basis_refs.intersection(adopted_refs))
            if not cited_refs:
                continue
            prediction = str(decision.get("prediction") or "").strip()
            falsifier = str(decision.get("falsifier") or "").strip()
            read_refs = sorted({
                str(access.get("resource_ref") or "")
                for access in resource_accesses
                if access.get("reader") == "parent"
                and str(access.get("recordedAt") or "") > adopted_at
                and str(access.get("recordedAt") or "") <= observed_at
                and str(access.get("resource_ref") or "") in cited_refs
                and access.get("operation") == "paged_read"
            })
            if not prediction or not falsifier or not read_refs:
                continue
            # An online method may derive its next action and prediction from
            # this frame. Requiring NEXT_ACTION in its archived body would
            # reward fixed-state replay and reject legitimate parameterized
            # procedures. This join establishes a traceable application, not
            # semantic correctness; the later effect stage judges the result.
            action_uses.append(observation_id)
            use_contracts[observation_id] = {
                "adopted_resource_refs": cited_refs,
                "read_resource_refs": read_refs,
                "action": ((observation.get("input") or {}).get("action")),
                "prediction": prediction,
                "falsifier": falsifier,
                "application_basis": "exact_read_plus_action_citation_and_testable_prediction",
                "semantic_correctness": "not_established_until_effect_evaluation",
            }
        actual_use_ok = adoption_ok and bool(action_uses)
        stages["actual_arc_use"] = stage(
            actual_use_ok,
            "A later successful ARC action cites a parent-read exact adopted version and records a prediction and falsifier; this is traceable use, not correctness."
            if actual_use_ok else
            "No later successful ARC action follows an exact parent resource read while citing that version with a prediction and falsifier; exposure, reading, citation alone, and standalone tool calls do not count.",
            action_uses,
        )
        stages["actual_arc_use"]["use_contracts"] = use_contracts

        evaluated_refs: list[str] = []
        for version in versions:
            actual_refs = {str(ref) for ref in version.get("actual_use_observation_refs", [])}
            for validation_ref in version.get("validation_refs", []):
                match = re.match(r"^effect_assessment:([^@]+)@v\d+$", str(validation_ref))
                assessment = by_assessment.get(match.group(1)) if match else None
                assessed_observations = {
                    str(ref) for ref in (assessment or {}).get("observation_refs", [])
                }
                assessment_at = str((assessment or {}).get("recordedAt") or "")
                action_times = [
                    str(by_observation[ref].get("recordedAt") or "")
                    for ref in set(action_uses).intersection(actual_refs).intersection(assessed_observations)
                ]
                if action_times and assessment_at and all(assessment_at > value for value in action_times):
                    evaluated_refs.extend([str(validation_ref), *set(action_uses).intersection(assessed_observations)])
        evaluation_ok = actual_use_ok and bool(evaluated_refs)
        stages["effect_evaluation"] = stage(
            evaluation_ok,
            "An effect assessment cites the same ARC action credited as actual use."
            if evaluation_ok else
            "No effect assessment and method lifecycle version jointly cite the actual-use ARC action.",
            evaluated_refs,
        )

        line_ref = str(candidate.get("research_line_ref") or "")
        completed_feedback = next((item for item in handoffs
                                   if item.get("status") == "completed"
                                   and str(item.get("research_line_ref") or "") == line_ref
                                   and str(item.get("method_ref") or "").startswith(f"method:{method_id}@")), None)
        feedback_report_ref = str((completed_feedback or {}).get("report_ref") or "")
        feedback_report = by_report_ref.get(feedback_report_ref)
        feedback_body_refs = {observation_ref_id(ref) for ref in report_body(feedback_report).get("evidence_refs", [])}
        feedback_run_id = str((completed_feedback or {}).get("run_id") or "")
        feedback_reads = {
            str(item.get("resource_ref") or "") for item in resource_accesses
            if str(item.get("research_run_id") or "") == feedback_run_id
            and item.get("reader") == "subagent" and item.get("operation") == "paged_read"
        }
        feedback_assessment_ref = str((completed_feedback or {}).get("effect_assessment_ref") or "")
        feedback_actual_refs = set(action_uses).intersection(feedback_body_refs)
        feedback_at = str((completed_feedback or {}).get("recordedAt") or "")
        evaluated_assessment_times = [
            str(item.get("recordedAt") or "")
            for item in assessments
            if str(item.get("effect_assessment_id") or "") in {
                re.match(r"^effect_assessment:([^@]+)@v\d+$", ref).group(1)
                for ref in evaluated_refs
                if re.match(r"^effect_assessment:([^@]+)@v\d+$", ref)
            }
        ]
        feedback_ok = (
            evaluation_ok
            and completed_feedback is not None
            and feedback_report is not None
            and str(feedback_report.get("research_line_ref") or "") == line_ref
            and feedback_report_ref != source_report_ref
            and str(completed_feedback.get("effect_assessment_ref") or "") in evaluated_refs
            and bool(feedback_actual_refs)
            and f"observation:{next(iter(feedback_actual_refs))}@v1" in feedback_reads
            and feedback_assessment_ref in feedback_reads
            and bool(feedback_at)
            and bool(evaluated_assessment_times)
            and all(feedback_at > value for value in evaluated_assessment_times)
        )
        stages["feedback_research"] = stage(
            feedback_ok,
            "A completed feedback child on the same research line read the effect assessment and cited the assessed actual-use action."
            if feedback_ok else
            "No completed same-line feedback report both reads the effect assessment and cites its assessed actual-use action.",
            [feedback_assessment_ref, feedback_report_ref, line_ref, *sorted(feedback_actual_refs)],
        )
        first_incomplete = next((name for name in METHOD_EVOLUTION_STAGE_ORDER
                                 if not stages[name]["passed"]), None)
        chains.append({
            "method_id": method_id,
            "source_report_ref": source_report_ref or None,
            "research_line_ref": line_ref or None,
            "generalization_scope": candidate.get("generalization_scope"),
            "latest_maturity": versions[-1].get("maturity"),
            "complete": first_incomplete is None,
            "first_incomplete_stage": first_incomplete,
            "stages": stages,
        })

    complete_chains = [chain for chain in chains if chain["complete"]]
    comparison_evidence: list[dict[str, Any]] = []
    report_inductions: list[dict[str, Any]] = []
    for comparison in comparisons:
        situation_ids = [str(ref) for ref in (
            comparison.get("situation_context_ids") or comparison.get("context_ids") or []
        ) if str(ref)]
        selected_refs = [str(ref) for ref in comparison.get("selected_evidence_refs", [])
                         if str(ref) in by_observation]
        if len(set(situation_ids)) < 2 or len(set(selected_refs)) < 2:
            continue
        prepared = {
            "run_id": comparison.get("run_id"),
            "research_line_ref": comparison.get("research_line_ref"),
            "situation_context_ids": list(dict.fromkeys(situation_ids)),
            "episode_context_ids": list(dict.fromkeys(
                str(ref) for ref in comparison.get("episode_context_ids", []) if str(ref)
            )),
            "evidence_refs": list(dict.fromkeys(selected_refs)),
            "causal_interpretation": comparison.get("causal_interpretation"),
            "semantic_equivalence_claimed": comparison.get("semantic_equivalence_claimed"),
        }
        comparison_evidence.append(prepared)
        report_ref = next((
            ref for ref, report in by_report_ref.items()
            if str(report.get("run_id") or "") == str(comparison.get("run_id") or "")
        ), None)
        report = by_report_ref.get(report_ref or "")
        body_refs = {str(ref) for ref in report_body(report).get("evidence_refs", [])}
        cases = [
            case
            for repeated in comparison.get("repeated_cases", [])
            for case in repeated.get("cases", [])
            if isinstance(case, dict)
        ]
        cited_situations = {
            str(case.get("situation_context_id") or case.get("context_id") or "")
            for case in cases
            if str(case.get("observation_ref") or "") in body_refs
        }
        cited_refs = sorted(body_refs.intersection(selected_refs))
        if supported_report(report) and len(cited_situations) >= 2 and len(cited_refs) >= 2:
            report_inductions.append({
                "run_id": comparison.get("run_id"),
                "report_ref": report_ref,
                "research_line_ref": comparison.get("research_line_ref"),
                "situation_context_ids": sorted(cited_situations),
                "evidence_refs": cited_refs,
            })
    observed_induction = bool(report_inductions) or any(
        chain["stages"]["cross_situation_induction"]["passed"] for chain in chains
    )
    if complete_chains:
        first_incomplete_stage = None
    elif chains:
        # Report the most advanced reference-consistent chain. This answers
        # where the run stopped without allowing unrelated partial chains to
        # combine into a false completion.
        progress = lambda chain: next(
            (index for index, name in enumerate(METHOD_EVOLUTION_STAGE_ORDER)
             if not chain["stages"][name]["passed"]), len(METHOD_EVOLUTION_STAGE_ORDER)
        )
        first_incomplete_stage = max(chains, key=progress)["first_incomplete_stage"]
    else:
        first_incomplete_stage = "method_candidate"
    rejected_submissions = [
        item for item in subagent_progress
        if item.get("last_tool_name") == "submit_research_report"
        and item.get("is_error") is True
    ]
    stalled_runs = [
        str(item.get("run_id")) for item in research_runs
        if item.get("status") == "completed"
        and str(((item.get("result_summary") or {}).get("stop_reason") or "")) == "stalled"
    ]
    failed_runs = [
        {"run_id": item.get("run_id"), "error": item.get("error")}
        for item in research_runs if item.get("status") == "failed"
    ]
    return {
        "format": "arc-method-evolution-audit-v1",
        "stage_order": list(METHOD_EVOLUTION_STAGE_ORDER),
        "complete": bool(complete_chains),
        "method_count": len(chains),
        "complete_method_count": len(complete_chains),
        "first_incomplete_stage": first_incomplete_stage,
        "cross_situation_induction_observed": observed_induction,
        # Compatibility alias retained for summaries written by the first
        # audit draft.  New consumers should use the explicit field above.
        "cross_situation_evidence_observed": observed_induction,
        "cross_situation_material_ready": bool(comparison_evidence),
        "cross_situation_inductions": report_inductions,
        "orphan_cross_situation_evidence": comparison_evidence if not chains else [],
        "delivery_diagnostics": {
            "rejected_report_submission_count": len(rejected_submissions),
            "rejected_report_run_ids": list(dict.fromkeys(
                str(item.get("research_run_id")) for item in rejected_submissions
                if item.get("research_run_id")
            )),
            "stalled_run_ids": list(dict.fromkeys(stalled_runs)),
            "failed_runs": failed_runs,
            "interpretation": (
                "A rejected report submission shows that the child reached the structured delivery boundary, "
                "but its unpersisted payload does not count as a supported induction. Stalled and failed runs "
                "explain delivery failure without promoting private or invalid output into lifecycle evidence."
            ),
        },
        "chains": chains,
        "interpretation": (
            "Completion requires one reference-consistent chain from a structured method through parent adoption, "
            "a later ARC action following a read of the exact adopted version while preserving its "
            "prediction and falsifier, assessment of that same action, "
            "and a completed feedback report on the same research line. Cross-situation evidence is diagnostic "
            "for generalization scope, not a prerequisite for Skill identity or method adoption."
        ),
    }


def write_arc_method_evolution_audit(root: Path) -> Path:
    """Rebuild the six-stage audit from durable run artifacts."""
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    audit = _method_evolution_audit(
        methods=_read_jsonl(root / "task-method-lifecycle.jsonl"),
        comparisons=_read_jsonl(root / "auto-research-comparison-bundles.jsonl"),
        observations=_read_jsonl(root / "execution-observations.jsonl"),
        assessments=_read_jsonl(root / "effect-assessments.jsonl"),
        handoffs=_read_jsonl(root / "auto-research-handoffs.jsonl"),
        reports=_read_jsonl(root / "auto-research-reports.jsonl"),
        resource_accesses=_read_jsonl(root / "task-resource-access.jsonl"),
        harness_resources={
            f"skill:{item.get('name')}@v{int(item.get('version', 1) or 1)}": item
            for item in _read_jsonl(root / "task-skills.jsonl") if item.get("name")
        },
        research_runs=_read_jsonl(root / "auto-research-runs.jsonl"),
        subagent_progress=_read_jsonl(root / "subagent-progress.jsonl"),
    )
    path = root / "method-evolution-audit.json"
    temporary = root / "method-evolution-audit.json.tmp"
    temporary.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    return path


def _scorecard_id(scorecard: dict[str, Any] | None) -> str | None:
    if not scorecard:
        return None
    for key in ("scorecard_id", "card_id", "id"):
        value = scorecard.get(key)
        if value is not None:
            return str(value)
    return None


def _partial_bridge_result(root: Path) -> dict[str, Any]:
    """Recover action/state metadata when an interrupted bridge never closed."""
    events = _read_jsonl(root / "bridge-events.jsonl")
    actions = [event for event in events if event.get("event") == "action"]
    forced = [event for event in events if event.get("event") == "forced_action"]
    last_frame = (actions[-1].get("frame") if actions else None) or {}
    opened = next((event for event in events if event.get("event") == "scorecard_opened"), {})
    return {
        "terminal_state": str(last_frame.get("state") or "UNKNOWN"),
        "levels_completed": int(last_frame.get("levels_completed", 0) or 0),
        "actions": len(actions),
        "forced_actions": len(forced),
        "scorecard_id": opened.get("scorecard_id"),
        "partial": True,
    }


def project_arc_summary(
    root: Path,
    *,
    game: str,
    variant: str,
    bridge_result: dict[str, Any],
    scorecard: dict[str, Any] | None,
    pi_returncode: int,
    timed_out: bool,
    model_settings: dict[str, Any] | None = None,
    harness_validation: bool = False,
    auto_research_validation: bool = False,
    cross_situation_validation: bool = False,
) -> dict[str, Any]:
    """Project native task outcome and task-local mechanism evidence separately."""
    findings = _read_jsonl(root / "research-resources.jsonl")
    execution_signals = _read_jsonl(root / "execution-signals.jsonl")
    pattern_candidates = _read_jsonl(root / "pattern-candidates.jsonl")
    self_harness_checkpoints = _read_jsonl(root / "self-harness-checkpoints.jsonl")
    research_exposures = _read_jsonl(root / "research-exposures.jsonl")
    research_validation_windows = _read_jsonl(root / "research-validation-windows.jsonl")
    validation_records = _read_jsonl(root / "task-validations.jsonl")
    latest_validations = {record["validation_id"]: record for record in validation_records}
    decisions = _read_jsonl(root / "harness-decisions.jsonl")
    exposures = _read_jsonl(root / "harness-observations.jsonl")
    assessments = _read_jsonl(root / "effect-assessments.jsonl")
    pi_events = _read_jsonl(root / "pi-events.jsonl")
    observations = _read_jsonl(root / "execution-observations.jsonl")
    provider_contexts = _read_jsonl(root / "provider-contexts.jsonl")
    task_harness_entry = _read_jsonl(root / "task-harness-entry.jsonl")
    memory = _read_jsonl(root / "task-memory.jsonl")
    skills = _read_jsonl(root / "task-skills.jsonl")
    skill_events = _read_jsonl(root / "task-skill-events.jsonl")
    task_context_exposures = _read_jsonl(root / "task-harness-context-exposures.jsonl")
    task_harness_opportunities = _read_jsonl(root / "task-harness-opportunities.jsonl")
    task_resource_access = _read_jsonl(root / "task-resource-access.jsonl")
    system_prompts = _read_jsonl(root / "task-system-prompt.jsonl")
    task_tools = _read_jsonl(root / "task-tools.jsonl")
    task_tool_invocations = _read_jsonl(root / "task-tool-events.jsonl")
    native_skill_discovery = _read_jsonl(root / "native-skill-discovery.jsonl")
    provider_telemetry = _read_jsonl(root / "provider-telemetry.jsonl")
    context_token_debug = _read_jsonl(root / "context-token-debug.jsonl")
    subagent_provider_telemetry = _read_jsonl(root / "subagent-provider-telemetry.jsonl")
    subagent_context_token_debug = _read_jsonl(root / "subagent-context-token-debug.jsonl")
    subagent_progress = _read_jsonl(root / "subagent-progress.jsonl")
    auto_research_runs = _read_jsonl(root / "auto-research-runs.jsonl")
    auto_research_reports = _read_jsonl(root / "auto-research-reports.jsonl")
    auto_research_handoffs = _read_jsonl(root / "auto-research-handoffs.jsonl")
    auto_research_comparisons = _read_jsonl(root / "auto-research-comparison-bundles.jsonl")
    method_lifecycle = _read_jsonl(root / "task-method-lifecycle.jsonl")
    auto_research_route_receipts = _read_jsonl(root / "auto-research-harness-route-receipts.jsonl")
    bridge_events = _read_jsonl(root / "bridge-events.jsonl")
    environment_errors = [
        event for event in bridge_events if event.get("event") == "environment_error"
    ]
    environment_calls_started = [
        event for event in bridge_events if event.get("event") == "environment_call_started"
    ]
    watchdog_events = [item for item in pi_events if item.get("type") == "agent_progress_watchdog"]
    recovery_phase_events = [item for item in pi_events if item.get("type") == "arc_recovery_phase"]
    subagents = _read_jsonl(root / "task-subagents.jsonl")
    subagent_invocations = _read_jsonl(root / "subagent-invocations.jsonl")
    completed_subagent_invocations = [
        item for item in subagent_invocations
        if item.get("status") == "completed" or (item.get("status") is None and isinstance(item.get("result"), dict))
    ]
    failed_subagent_invocations = [item for item in subagent_invocations if item.get("status") == "failed"]
    subagent_usage = {
        key: sum(
            int((((item.get("result") or {}).get("usage") or {}).get(key, 0)) or 0)
            for item in completed_subagent_invocations
        )
        for key in ("input", "output", "cacheRead", "cacheWrite")
    }
    subagent_usage["cost_total"] = sum(
        float((((((item.get("result") or {}).get("usage") or {}).get("cost") or {}).get("total", 0)) or 0))
        for item in completed_subagent_invocations
    )
    provider_errors = [
        str((event.get("message") or {}).get("errorMessage"))
        for event in pi_events
        if event.get("type") == "message_end"
        and isinstance(event.get("message"), dict)
        and event["message"].get("stopReason") == "error"
        and (event.get("message") or {}).get("errorMessage")
    ]
    supported = [item for item in assessments if item.get("verdict") == "supported"]
    supported_decision_ids = {
        item.get("decision_id") for item in supported if isinstance(item.get("decision_id"), str)
    }
    runtime_exposure_linked_decisions = {
        item.get("decision_id")
        for item in exposures
        if item.get("effect_observed") is True and item.get("decision_id") in supported_decision_ids
    }
    independently_supported, effect_integrity_issues = audit_observation_compaction_effects(
        observations,
        findings,
        decisions,
        exposures,
        assessments,
        provider_contexts,
        pi_events=pi_events,
    )
    independently_supported_decisions = {
        item.get("decision_id") for item in independently_supported if item.get("decision_id")
    }
    provider_verified_decisions = {
        item.get("decision_id")
        for item in exposures
        if item.get("observation_kind") == "final_provider_payload"
        and item.get("effect_observed") is True
        and item.get("decision_id") in independently_supported_decisions
    }
    terminal_state = str(bridge_result.get("terminal_state") or "UNKNOWN")
    levels_completed = int(bridge_result.get("levels_completed", 0) or 0)
    benchmark_passed = terminal_state == "WIN"
    bridge_partial = bool(bridge_result.get("partial"))
    run_complete = bool(
        scorecard is not None
        and not bridge_partial
        and pi_returncode == 0
        and not timed_out
    )
    completion_status = (
        "timed_out" if timed_out else
        "reported_budget_exhausted" if pi_returncode == 125 else
        "interrupted" if pi_returncode == 130 else
        "runner_failed" if pi_returncode != 0 else
        "partial" if bridge_partial or scorecard is None else
        "completed"
    )
    return {
        "pipeline": "pi-native-arc-agi-3-e2e",
        "game": game,
        "experiment": {"variant": variant, "control": variant == "control"},
        "execution_model": "pi_native_agent_loop",
        "adapter": {
            "name": "arc-agi-3-official-agent-contract",
            "system_prompt": OFFICIAL_ARC_SYSTEM_PROMPT,
            "max_animation_frames": DEFAULT_MAX_ANIMATION_FRAMES,
            "action_budget_multiplier": DEFAULT_ACTION_BUDGET_MULTIPLIER,
            "official_source": "benchmarking.agent.BenchmarkingAgent",
            "research_extension": variant == "treatment",
        },
        "passed": bool(benchmark_passed and pi_returncode == 0 and not timed_out),
        "benchmark_evaluation": {
            "source": "arc_agi_3_native_scorecard",
            "scorecard_id": _scorecard_id(scorecard) or bridge_result.get("scorecard_id"),
            "terminal_state": terminal_state,
            "levels_completed": levels_completed,
            "passed": benchmark_passed,
            "evaluation_complete": bool(scorecard is not None and not bridge_partial),
        },
        "runtime": {
            "pi_returncode": pi_returncode,
            "timed_out": timed_out,
            "agent_actions": int(bridge_result.get("actions", 0) or 0),
            "forced_actions": int(bridge_result.get("forced_actions", 0) or 0),
            "model": (model_settings or {}).get("model"),
            "provider": (model_settings or {}).get("provider"),
            "provider_extension": (model_settings or {}).get("provider_extension"),
            "pi_api": (model_settings or {}).get("pi_api"),
            "context_window": (model_settings or {}).get("context_window"),
            "max_output_tokens": (model_settings or {}).get("max_tokens"),
            "review_configuration": (json.loads((root / "arc-runtime-config.json").read_text(encoding="utf-8"))
                                     if (root / "arc-runtime-config.json").is_file() else None),
            "provider_error_count": len(provider_errors),
            "last_provider_error": provider_errors[-1] if provider_errors else None,
            "environment_call_count": len(environment_calls_started),
            "environment_error_count": len(environment_errors),
            "last_environment_error": environment_errors[-1] if environment_errors else None,
            "run_complete": run_complete,
            "completion_status": completion_status,
            "harness_validation": harness_validation,
            "auto_research_validation": auto_research_validation,
            "cross_situation_validation": cross_situation_validation,
            "recovery": {
                "phase_transition_count": len(recovery_phase_events),
                "latest_phase": recovery_phase_events[-1].get("to") if recovery_phase_events else "normal",
                "transitions": recovery_phase_events,
            },
            "watchdog": {
                "event_count": len(watchdog_events),
                "interventions": [
                    {
                        "number": item.get("intervention_number"),
                        "kind": item.get("intervention"),
                        "repeated_read_calls": item.get("read_only_calls"),
                    }
                    for item in watchdog_events
                ],
            },
        },
        "native_skills": {
            "audit_count": len(native_skill_discovery),
            "latest": native_skill_discovery[-1] if native_skill_discovery else None,
            "source": "disabled_for_task_local_harness",
            "latest_skill_count": (
                int(native_skill_discovery[-1].get("skill_count", 0) or 0)
                if native_skill_discovery else 0
            ),
            "latest_skill_description_chars": (
                int(native_skill_discovery[-1].get("skill_description_chars", 0) or 0)
                if native_skill_discovery else 0
            ),
            "interpretation": (
                "The task-local harness does not use Pi native skill discovery or loading; "
                "task skills are projected by the extension from run-local resources."
            ),
        },
        "task_local_entry": {
            "audit_count": len(task_harness_entry),
            "initial": task_harness_entry[0] if task_harness_entry else None,
            "initial_resource_counts": (
                task_harness_entry[0].get("initial_resource_counts")
                if task_harness_entry else None
            ),
            "latest": task_harness_entry[-1] if task_harness_entry else None,
            "native_skill_loading": bool(task_harness_entry[-1].get("native_skill_loading")) if task_harness_entry else False,
            "interpretation": "The first treatment request exposes direct task-local component operations and the task_harness start/inspect/enable/focus entry; resource contents still start empty.",
        },
        "provider_telemetry": {
            "main": _provider_telemetry_summary(provider_telemetry),
            "context_tokens": _context_token_debug_summary(context_token_debug),
            "subagents": {
                **_provider_telemetry_summary(subagent_provider_telemetry),
                "context_tokens": _context_token_debug_summary(subagent_context_token_debug),
            },
            "combined_usage": {
                key: sum(_provider_telemetry_summary(rows)["token_usage"][key]["total"]
                         for rows in (provider_telemetry, subagent_provider_telemetry))
                for key in ("input", "output", "reasoning", "non_reasoning_output", "cache_read", "cache_write", "total_tokens")
            },
            "usage_interpretation": "Output includes reasoning; never add reasoning again. Missing reasoning/body counts remain unmeasured. Parent plus all child messages are counted, including failed and pending research slices.",
            "progress": {
                "record_count": len(subagent_progress),
                "latest": subagent_progress[-1] if subagent_progress else None,
                "latest_by_progress_id": {
                    str(progress_id): record
                    for progress_id, record in {
                        str(item.get("progress_id")): item
                        for item in subagent_progress
                        if item.get("progress_id")
                    }.items()
                },
                "interpretation": (
                    "Observation-only child liveness and protocol-stage telemetry. "
                    "It does not steer, interrupt, cap, approve, or route a child."
                ),
            },
        },
        "research": {
            **project_research_evidence(
                findings=findings,
                execution_signals=execution_signals,
                pattern_candidates=pattern_candidates,
                harness_decisions=decisions,
                harness_observations=exposures,
                effect_assessments=assessments,
            ),
            "exposure_count": len(research_exposures),
            "self_harness_checkpoint_count": len(self_harness_checkpoints),
            "latest_exposures": research_exposures,
            "validation_windows": {
                "event_count": len(research_validation_windows),
                "opened": len([item for item in research_validation_windows if item.get("status") == "open"]),
                "awaiting_assessment": len([item for item in research_validation_windows if item.get("status") == "awaiting_assessment" or item.get("outcome") == "needs_assessment"]),
                "expired": len([item for item in research_validation_windows if item.get("status") in {"expired", "awaiting_assessment", "falsify", "inconclusive"} or item.get("outcome") in {"not_met", "unknown", "needs_assessment", "interrupted"}]),
                "latest": research_validation_windows,
            },
            "auto_research": {
                "run_count": len(auto_research_runs),
                "completed": sum(item.get("status") == "completed" for item in auto_research_runs),
                "invalid_reports": sum(item.get("status") == "invalid_report" for item in auto_research_runs),
                "failed": sum(item.get("status") == "failed" for item in auto_research_runs),
                "latest": [
                    {
                        **{key: item.get(key) for key in (
                            "run_id", "version", "status", "scope", "summary", "report_ref",
                            "finding_count", "proposal_count", "progress_ref", "progress_id",
                        ) if key in item},
                        "output_tokens": int(
                            (((item.get("result_summary") or {}).get("usage") or {}).get("output", 0))
                            or (((item.get("result") or {}).get("usage") or {}).get("output", 0))
                            or 0
                        ),
                    }
                    for item in auto_research_runs
                ],
            },
            "method_evolution": _method_evolution_audit(
                methods=method_lifecycle,
                comparisons=auto_research_comparisons,
                observations=observations,
                assessments=assessments,
                handoffs=auto_research_handoffs,
                reports=auto_research_reports,
                resource_accesses=task_resource_access,
                harness_resources={
                    **{
                        f"skill:{item.get('name')}@v{int(item.get('version', 1) or 1)}": item
                        for item in skills if item.get("name")
                    },
                    **{
                        f"tool:{item.get('name')}@v{int(item.get('version', 1) or 1)}": item
                        for item in task_tools if item.get("name")
                    },
                },
                research_runs=auto_research_runs,
                subagent_progress=subagent_progress,
            ),
            "auto_research_harness_closure": _auto_research_harness_closure(
                route_receipts=auto_research_route_receipts,
                memory=memory,
                skills=skills,
                task_tools=task_tools,
                subagents=subagents,
                system_prompts=system_prompts,
                context_exposures=task_context_exposures,
                task_tool_events=task_tool_invocations,
                subagent_invocations=subagent_invocations,
            ),
            "validation_ledger": {
                "version_count": len(validation_records),
                "test_count": len(latest_validations),
                "unresolved": sum(r.get("status") == "open" for r in latest_validations.values()),
                "assessed": sum(r.get("status") == "assessed" for r in latest_validations.values()),
                "interpretation": "Agent-authored evidence-linked assessments, not independent proof or a count of research tool calls.",
            },
        },
        "task_local_resources": {
            "system_prompt": {
                "version_count": len(system_prompts),
                "latest": _latest_records(
                    system_prompts, key="name",
                    fields=("system_prompt_id", "name", "version", "status", "content", "basis_refs", "decision_id", "expected_effect", "reconsider_when"),
                ),
            },
            "memory": {
                "version_count": len(memory),
                "latest": _latest_records(
                    memory, key="key",
                    fields=("memory_id", "key", "version", "status", "content", "scope", "basis_refs", "pinned"),
                ),
            },
            "skills": {
                "version_count": len(skills),
                "event_count": len(skill_events),
                "latest": _latest_records(
                    skills, key="name",
                    fields=("skill_id", "name", "version", "status", "description", "file", "basis_refs", "decision_id", "expected_effect", "reconsider_when"),
                ),
            },
            "tools": {
                "version_count": len(task_tools),
                "invocation_count": len([
                    item for item in task_tool_invocations
                    if item.get("event") == "invoked" and item.get("status") == "completed"
                ]),
                "failed_invocation_count": len([
                    item for item in task_tool_invocations
                    if item.get("event") == "invoked" and item.get("status") == "failed"
                ]),
                "latest": _latest_records(
                    task_tools, key="name",
                    fields=("tool_id", "name", "version", "status", "description", "input_schema", "implementation_ref", "program", "exposed_name", "adapter_id", "permission", "basis_refs", "decision_id", "expected_effect", "reconsider_when"),
                ),
            },
            "subagents": {
                "version_count": len(subagents),
                "invocation_count": len(subagent_invocations),
                "completed_invocations": len(completed_subagent_invocations),
                "failed_invocations": len(failed_subagent_invocations),
                "usage": subagent_usage,
                "latest": _latest_records(
                    subagents, key="name",
                    fields=("agent_id", "name", "version", "status", "description", "tools", "file", "basis_refs", "decision_id", "expected_effect", "reconsider_when"),
                ),
            },
            "context_exposure_count": len(task_context_exposures),
            "opportunity_count": len(task_harness_opportunities),
            "resource_access_count": len(task_resource_access),
        },
        "self_harness_evaluation": {
            "decision_count": len(decisions),
            "exposure_count": len(exposures),
            "effect_assessment_count": len(assessments),
            "supported_effect_assessments": len(supported),
            "runtime_exposure_linked_supported_effect_assessments": len(runtime_exposure_linked_decisions),
            "artifact_integrity_supported_effect_assessments": len(independently_supported),
            "provider_payload_verified_effect_assessments": len(provider_verified_decisions),
            "unverified_supported_effect_assessments": max(
                0, len(supported) - len(provider_verified_decisions)
            ),
            "effect_integrity_issues": effect_integrity_issues,
            "harness_improved": None,
            "interpretation": (
                "Runtime effect claims and independent artifact checks are mediators; "
                "harness improvement requires a valid paired benchmark comparison."
            ),
        },
        "native_scorecard": scorecard,
        "artifacts": {
            "bridge_events": "bridge-events.jsonl",
            "trajectory": "bridge-events.jsonl#action-events",
            "scorecard": "arc-scorecard.json",
            "pi_events": "pi-events.jsonl",
            "observations": "execution-observations.jsonl",
            "execution_signals": "execution-signals.jsonl",
            "pattern_candidates": "pattern-candidates.jsonl",
            "findings": "research-resources.jsonl",
            "research_validation_windows": "research-validation-windows.jsonl",
            "research_exposures": "research-exposures.jsonl",
            "self_harness_checkpoints": "self-harness-checkpoints.jsonl",
            "decisions": "harness-decisions.jsonl",
            "harness_observations": "harness-observations.jsonl",
            "effects": "effect-assessments.jsonl",
            "task_memory": "task-memory.jsonl",
            "task_context_exposures": "task-harness-context-exposures.jsonl",
            "task_harness_opportunities": "task-harness-opportunities.jsonl",
            "task_resource_access": "task-resource-access.jsonl",
            "native_skill_discovery": "native-skill-discovery.jsonl",
            "task_harness_entry": "task-harness-entry.jsonl",
            "task_harness_entry_events": "task-harness-entry-events.jsonl",
            "provider_telemetry": "provider-telemetry.jsonl",
            "context_token_debug": "context-token-debug.jsonl",
            "subagent_provider_telemetry": "subagent-provider-telemetry.jsonl",
            "subagent_context_token_debug": "subagent-context-token-debug.jsonl",
            "auto_research_runs": "auto-research-runs.jsonl",
            "auto_research_reports": "auto-research-reports.jsonl",
            "auto_research_handoffs": "auto-research-handoffs.jsonl",
            "auto_research_comparisons": "auto-research-comparison-bundles.jsonl",
            "method_lifecycle": "task-method-lifecycle.jsonl",
            "method_evolution_audit": "method-evolution-audit.json",
            "auto_research_route_receipts": "auto-research-harness-route-receipts.jsonl",
            "task_skills": "task-skills.jsonl",
            "task_skill_events": "task-skill-events.jsonl",
            "task_subagents": "task-subagents.jsonl",
            "subagent_invocations": "subagent-invocations.jsonl",
            "subagent_progress": "subagent-progress.jsonl",
        },
    }


def compare_arc_runs(control: dict[str, Any], treatment: dict[str, Any]) -> dict[str, Any]:
    """Compare paired ARC summaries without conflating mechanism and task success."""
    control_eval = control.get("benchmark_evaluation") or {}
    treatment_eval = treatment.get("benchmark_evaluation") or {}
    control_scorecard = control.get("native_scorecard") or {}
    treatment_scorecard = treatment.get("native_scorecard") or {}
    control_runtime = control.get("runtime") or {}
    treatment_runtime = treatment.get("runtime") or {}
    control_harness = control.get("self_harness_evaluation") or {}
    treatment_harness = treatment.get("self_harness_evaluation") or {}
    control_levels = int(control_eval.get("levels_completed", 0) or 0)
    treatment_levels = int(treatment_eval.get("levels_completed", 0) or 0)
    control_actions = int(control_runtime.get("agent_actions", 0) or 0)
    treatment_actions = int(treatment_runtime.get("agent_actions", 0) or 0)
    level_delta = treatment_levels - control_levels
    action_delta = treatment_actions - control_actions
    control_score = control_eval.get("score", control_scorecard.get("score"))
    treatment_score = treatment_eval.get("score", treatment_scorecard.get("score"))
    control_score = float(control_score) if isinstance(control_score, (int, float)) else None
    treatment_score = float(treatment_score) if isinstance(treatment_score, (int, float)) else None
    score_delta = (
        treatment_score - control_score
        if control_score is not None and treatment_score is not None else None
    )
    task_improved: bool | None
    if treatment_levels != control_levels:
        task_improved = treatment_levels > control_levels
    elif bool(treatment_eval.get("passed")) != bool(control_eval.get("passed")):
        task_improved = bool(treatment_eval.get("passed"))
    elif score_delta is not None and score_delta != 0:
        task_improved = score_delta > 0
    else:
        task_improved = None
    supported_delta = int(treatment_harness.get("supported_effect_assessments", 0) or 0) - int(
        control_harness.get("supported_effect_assessments", 0) or 0
    )
    provider_verified_delta = int(
        treatment_harness.get("provider_payload_verified_effect_assessments", 0) or 0
    ) - int(control_harness.get("provider_payload_verified_effect_assessments", 0) or 0)
    runtime_linked_delta = int(
        treatment_harness.get("runtime_exposure_linked_supported_effect_assessments", 0) or 0
    ) - int(control_harness.get("runtime_exposure_linked_supported_effect_assessments", 0) or 0)
    invalid_reasons: list[str] = []
    if not control.get("game") or not treatment.get("game"):
        invalid_reasons.append("game_missing")
    elif control.get("game") != treatment.get("game"):
        invalid_reasons.append("game_mismatch")
    if (control.get("experiment") or {}).get("variant") != "control":
        invalid_reasons.append("control_variant_mismatch")
    if (treatment.get("experiment") or {}).get("variant") != "treatment":
        invalid_reasons.append("treatment_variant_mismatch")
    if control_runtime.get("run_complete") is not True:
        invalid_reasons.append("control_run_incomplete")
    if treatment_runtime.get("run_complete") is not True:
        invalid_reasons.append("treatment_run_incomplete")
    control_model = control_runtime.get("model")
    treatment_model = treatment_runtime.get("model")
    if not control_model or not treatment_model:
        invalid_reasons.append("model_missing")
    elif control_model != treatment_model:
        invalid_reasons.append("model_mismatch")
    for key in ("pi_api", "context_window", "max_output_tokens"):
        if control_runtime.get(key) is None or treatment_runtime.get(key) is None:
            invalid_reasons.append(f"{key}_missing")
        elif control_runtime.get(key) != treatment_runtime.get(key):
            invalid_reasons.append(f"{key}_mismatch")
    comparison_valid = not invalid_reasons
    treatment_improved = task_improved if comparison_valid else None
    treatment_decisions = int(treatment_harness.get("decision_count", 0) or 0)
    harness_improved = (
        True
        if treatment_improved is True
        and treatment_decisions > 0
        and max(runtime_linked_delta, provider_verified_delta) > 0
        else None
    )
    return {
        "comparison_valid": comparison_valid,
        "invalid_reasons": invalid_reasons,
        "task": {
            "control_levels_completed": control_levels,
            "treatment_levels_completed": treatment_levels,
            "levels_delta": level_delta,
            "control_score": control_score,
            "treatment_score": treatment_score,
            "score_delta": score_delta,
            "control_passed": bool(control_eval.get("passed")),
            "treatment_passed": bool(treatment_eval.get("passed")),
            "action_delta": action_delta,
            "treatment_improved": treatment_improved,
            "harness_improved": harness_improved,
        },
        "mechanism": {
            "control_decisions": int(control_harness.get("decision_count", 0) or 0),
            "treatment_decisions": int(treatment_harness.get("decision_count", 0) or 0),
            "control_supported_effects": int(control_harness.get("supported_effect_assessments", 0) or 0),
            "treatment_supported_effects": int(treatment_harness.get("supported_effect_assessments", 0) or 0),
            "supported_effect_delta": supported_delta,
            "runtime_exposure_linked_effect_delta": runtime_linked_delta,
            "provider_payload_verified_effect_delta": provider_verified_delta,
        },
        "interpretation": (
            "Paired task or harness improvement is not established because the runs are not comparable: "
            + ", ".join(invalid_reasons) + "."
            if not comparison_valid else
            "Task treatment gain and a supported effect linked to a recorded Pi runtime exposure are both present in this pair."
            if harness_improved is True else
            "Task treatment gain is supported, but self-harness improvement is not established."
            if treatment_improved is True else
            "Mechanism effect is observed, but paired task improvement is not established."
            if supported_delta > 0 else
            "No task-level or mechanism improvement is established by this pair."
        ),
    }


def _post_json(url: str, payload: dict[str, Any], timeout: float = 10.0,
               action_token: str | None = None) -> dict[str, Any]:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json",
                 **({"X-ARC-Action-Token": action_token} if action_token else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        # Keep structured bridge diagnostics (notably environment.step's
        # underlying SDK cause) instead of reducing every failure to
        # ``HTTP Error 502``.  The caller still treats this as a failed
        # operation and never replays an uncertain action automatically.
        try:
            body = json.loads(exc.read())
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = {"error": str(exc)}
        raise RuntimeError(json.dumps({
            "format": "arc-bridge-http-error-v1", "url": url,
            "status": exc.code, "response": body,
            "retryable": bool(body.get("retryable", False)) if isinstance(body, dict) else False,
        }, ensure_ascii=False)) from exc
    if not isinstance(value, dict):
        raise ValueError("ARC bridge returned a non-object")
    return value


def _get_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise ValueError("ARC bridge returned a non-object")
    return value


def _resolve_pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Pi runtime unsupported: node executable was not found")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        raise RuntimeError(f"Pi runtime unsupported: installed CLI was not found at {cli}")
    return node, str(cli)


def _wait_for_bridge(
    root: Path,
    process: subprocess.Popen[str],
    timeout: float = 60.0,
    *,
    port: int | None = None,
    launch_id: str | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    ready_path = root / "bridge-ready.json"
    receipts: queue.Queue[dict[str, Any]] = queue.Queue()
    def valid_receipt(value):
        return (isinstance(value, dict) and value.get("status") == "ready"
                and value.get("host") == "127.0.0.1" and type(value.get("port")) is int
                and 0 < value["port"] < 65536
                and type(value.get("pid")) is int and value["pid"] > 0
                and (value.get("launch_id") == launch_id if launch_id is not None
                     else value.get("pid") == process.pid))
    def read_stdout_receipt():
        try:
            for line in process.stdout:
                try:
                    value = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if valid_receipt(value):
                    receipts.put(value)
                    return
        except (OSError, UnicodeError):
            return  # File receipt and startup diagnostics remain available.
    if getattr(process, "stdout", None) is not None:
        threading.Thread(target=read_stdout_receipt, daemon=True, name="arc-bridge-readiness").start()
    while time.monotonic() < deadline:
        if ready_path.is_file():
            try:
                value = json.loads(ready_path.read_text(encoding="utf-8"))
                if valid_receipt(value):
                    return value
            except (OSError, ValueError):
                pass  # A non-atomic child file write may still be in progress.
        try:
            return receipts.get_nowait()
        except queue.Empty:
            pass
        if port:
            try:
                ready = _get_json(f"http://127.0.0.1:{port}/state", timeout=0.5)
                # A valid state response proves that the HTTP bridge is live;
                # the state itself is not used as the readiness receipt.
                ready = {
                    "status": "ready", "host": "127.0.0.1", "port": port,
                    "game": ready.get("game_id"), "pid": process.pid,
                }
                try:
                    ready_path.write_text(json.dumps(ready, indent=2) + "\n", encoding="utf-8")
                except OSError:
                    pass
                return ready
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        if process.poll() is not None:
            error_path = root / "bridge-error.json"
            detail = error_path.read_text(encoding="utf-8") if error_path.is_file() else ""
            raise RuntimeError(f"ARC bridge exited before ready: {detail}")
        time.sleep(0.1)
    # A readiness timeout is a startup failure, not a reason to silently wait
    # longer.  Persist enough child diagnostics for the caller to distinguish
    # SDK import/hardware failures from a deadlocked server.
    diagnostics: dict[str, Any] = {"returncode": process.poll()}
    # Never call read() on a live pipe here: the bridge still owns its stderr
    # descriptor and read-to-EOF would turn a bounded readiness failure into
    # an unbounded runner hang.  The outer finally block terminates the bridge
    # and persists the real stderr tail after EOF.
    if process.poll() is not None and process.stderr is not None:
        try:
            diagnostics["stderr_tail"] = process.stderr.read()[-16_384:]
        except (OSError, ValueError):
            diagnostics["stderr_tail"] = ""
    else:
        diagnostics["stderr_tail"] = "deferred until bridge termination"
    (root / "bridge-startup-diagnostics.json").write_text(
        json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    raise TimeoutError("timed out waiting for ARC bridge readiness; see bridge-startup-diagnostics.json")


def _pick_bridge_port() -> int:
    """Reserve an ephemeral localhost port for the child bridge."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _sync_bridge_events(root: Path, bridge_url: str, after: int) -> int:
    """Pull canonical bridge events and persist them from the parent process."""
    payload = _get_json(f"{bridge_url}/events?after={after}")
    events = payload.get("events")
    if not isinstance(events, list):
        raise ValueError("ARC bridge /events returned a non-list events field")
    if events:
        path = root / "bridge-events.jsonl"
        with path.open("a", encoding="utf-8") as stream:
            for event in events:
                if isinstance(event, dict):
                    stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
            stream.flush()
    return int(payload.get("next", after) or after)


def _append_bridge_event_batch(root: Path, events: list[Any]) -> None:
    """Persist a complete in-memory bridge batch without duplicating events."""
    existing = len(_read_jsonl(root / "bridge-events.jsonl"))
    if existing >= len(events):
        return
    path = root / "bridge-events.jsonl"
    with path.open("a", encoding="utf-8") as stream:
        for event in events[existing:]:
            if isinstance(event, dict):
                stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()


def _arc_terminal_or_budget_exhausted(state: dict[str, Any]) -> bool:
    """Stop the Pi loop when native state or either budget boundary is terminal."""
    if str(state.get("state", "")) == "WIN":
        return True
    budget = state.get("action_budget")
    if not isinstance(budget, dict):
        return False
    used = int(budget.get("used", 0) or 0)
    maximum = budget.get("maximum")
    total_used = int(budget.get("total_used", 0) or 0)
    total_maximum = budget.get("total_maximum")
    return (maximum is not None and used >= int(maximum)) or (
        total_maximum is not None and total_used >= int(total_maximum)
    )


def _arc_continuation_prompt(state: dict[str, Any], *, truncated: bool) -> str:
    """Choose the next prompt while preserving retryability after a failed life."""
    if str(state.get("state", "")) == "GAME_OVER":
        return _load_prompt("arc_game_over_recovery.md")
    if truncated:
        return _load_prompt("arc_length_recovery.md", **{
            "state": "unknown",
            "levels_completed": "unknown",
            "action_budget": "unknown",
            "available_actions": "unknown",
            "latest_action_evidence": "unknown",
            "research_notice": "",
        })
    return _load_prompt("arc_followup.md")


def _turn_has_arc_action(events: list[dict[str, Any]]) -> bool:
    """Return true only when this turn actually submitted an ARC action.

    A successful read or task-local harness mutation is useful evidence, but it
    does not advance the game.  Keeping this predicate at the adapter boundary
    prevents those operations from accidentally satisfying the ARC progress
    contract.
    """
    return any(
        event.get("type") == "tool_execution_end"
        and (event.get("toolName") == "arc_action"
             or (event.get("toolName") == "arc_actions"
                 and len((event.get("result") or {}).get("details", {}).get("completed", [])) > 0)
             or (event.get("toolName") == "delegate_task"
                 and (event.get("result") or {}).get("details", {}).get("arc_action_count", 0) > 0))
        and not bool(event.get("isError", False))
        for event in events
    )


def _turn_provider_error(events: list[dict[str, Any]]) -> str | None:
    """Return the provider failure that ended this turn, if any."""
    for event in reversed(events):
        if event.get("type") != "message_end":
            continue
        message = event.get("message")
        if not isinstance(message, dict):
            continue
        stop = message.get("stopReason")
        if stop == "error":
            return str(message.get("errorMessage") or "provider returned stopReason=error")
        if stop in {"stop", "toolUse", "length"}:
            # Pi may recover a transport error within this event window. A
            # later successful model response supersedes the historical error.
            # Ignore the runner's boundary abort while looking for that response.
            return None
    return None


def _turn_has_task_local_progress(events: list[dict[str, Any]]) -> bool:
    """Recognize bounded harness work without treating it as ARC progress."""
    task_local_tools = {
        "task_harness", "research_resource", "task_memory",
        "task_skill", "task_tool", "task_subagent", "delegate_task",
        "task_tool_policy", "assess_harness_effect", "task_resource", "task_validation",
        "auto_research",
    }
    return any(
        event.get("type") == "tool_execution_end"
        and str(event.get("toolName") or "") in task_local_tools
        and not bool(event.get("isError", False))
        for event in events
    )


ARC_RECOVERY_PHASES = frozenset({
    "normal", "compact_recovery", "research_returned", "awaiting_action",
})


def _turn_has_auto_research_result(events: list[dict[str, Any]]) -> bool:
    """Recognize a completed child report without treating it as an ARC action."""
    return any(
        event.get("type") == "tool_execution_end"
        and event.get("toolName") == "auto_research"
        and not bool(event.get("isError", False))
        for event in events
    )


def _advance_arc_recovery_phase(
    phase: str, events: list[dict[str, Any]],
) -> str:
    """Advance the compact recovery protocol while preserving the action boundary.

    Research and task-local harness work are legitimate recovery progress.  They
    never masquerade as an environment action, and the phase remains recoverable
    until a real ``arc_action`` closes the decision cycle.
    """
    if phase not in ARC_RECOVERY_PHASES:
        raise ValueError(f"unknown ARC recovery phase: {phase}")
    if phase == "normal":
        return phase
    if _turn_has_arc_action(events):
        return "normal"
    if _turn_has_auto_research_result(events):
        return "research_returned"
    if _turn_has_task_local_progress(events) or phase == "research_returned":
        return "awaiting_action"
    return phase


def _repeated_arc_action_intervention(
    events: list[dict[str, Any]], state: dict[str, Any],
) -> bool:
    """Detect a short no-progress action run without choosing the next action."""
    actions = [
        event for event in events
        if event.get("type") == "tool_execution_end"
        and event.get("toolName") == "arc_action"
        and not bool(event.get("isError", False))
    ]
    if len(actions) < 3:
        return False
    names = [str((event.get("args") or {}).get("action", "")) for event in actions[-3:]]
    if not names[0] or names != [names[0]] * 3:
        return False
    # An action may legitimately repeat while advancing a level. Only flag
    # repeated actions when the latest public transition says no progress.
    details = actions[-1].get("evidence")
    transition = details.get("public_transition") if isinstance(details, dict) else None
    if isinstance(transition, dict) and transition.get("level_changed"):
        return False
    return str(state.get("state", "")) not in {"WIN", "GAME_OVER"}


def _open_research_validation_window(
    decision: Any,
    *,
    action_index: int,
    action_name: str | None = None,
    changed_cells: Any = None,
    level_changed: Any = False,
) -> dict[str, Any] | None:
    """Legacy log/fixture normalization; the live runner consumes task_validation.

    A validation window is evidence bookkeeping, not an execution budget.  It
    may expire and request assessment, but it never computes a semantic verdict or
    admits or rejects a native ARC action.
    """
    if not isinstance(decision, dict):
        return None
    raw = decision.get("validation_window")
    if not isinstance(raw, dict):
        return None
    try:
        action_limit = int(raw.get("actions", 0))
    except (TypeError, ValueError):
        return None
    if action_limit < 1:
        return None
    # This is Agent-authored evidence bookkeeping, not an execution quota.
    # Keep the protocol's positive-integer requirement without introducing a
    # project-local maximum that silently changes the requested experiment.
    expiry = str(raw.get("on_expiry") or "falsify")
    if expiry not in {"falsify", "inconclusive"}:
        expiry = "falsify"
    return {
        "type": "research_validation_window",
        "status": "open",
        "hypothesis_id": str(decision.get("hypothesis_id") or "unidentified-hypothesis"),
        "hypothesis_version": int(decision.get("hypothesis_version", 1) or 1),
        "hypothesis": str(decision.get("hypothesis") or ""),
        "prediction": str(decision.get("prediction") or ""),
        "falsifier": str(decision.get("falsifier") or ""),
        "expected": str(raw.get("expected") or ""),
        "on_expiry": expiry,
        "action_limit": action_limit,
        "actions_used": 1,
        "start_action_index": action_index,
        "last_action_index": action_index,
        "evidence": [{
            "action_index": action_index,
            "action": action_name,
            "changed_cells": changed_cells,
            "level_changed": bool(level_changed),
        }],
    }


def _expire_research_validation_window_if_consumed(
    window: dict[str, Any], *, action_index: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Expire a newly opened one-action window at the declaring action."""
    if int(window.get("actions_used", 0) or 0) < int(window.get("action_limit", 0) or 0):
        return window, None
    return None, {
        **window,
        "status": "awaiting_assessment",
        "outcome": "unassessed",
        "assessment_required": True,
        "expired_at_action_index": action_index,
    }


def _advance_research_validation_window(
    window: dict[str, Any] | None,
    *,
    action_index: int,
    action_name: str,
    changed_cells: Any,
    level_changed: Any,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Consume one action in a declared window and report expiry only."""
    if window is None:
        return None, None
    updated = dict(window)
    updated["actions_used"] = int(updated.get("actions_used", 0) or 0) + 1
    updated["last_action_index"] = action_index
    updated["last_action"] = action_name
    updated["last_changed_cells"] = changed_cells
    updated["last_level_changed"] = bool(level_changed)
    updated["evidence"] = [
        *(updated.get("evidence") if isinstance(updated.get("evidence"), list) else []),
        {
            "action_index": action_index,
            "action": action_name,
            "changed_cells": changed_cells,
            "level_changed": bool(level_changed),
        },
    ]
    if updated["actions_used"] < int(updated["action_limit"]):
        return updated, None
    expired = {
        **updated,
        "status": "awaiting_assessment",
        "outcome": "unassessed",
        "assessment_required": True,
        "expired_at_action_index": action_index,
    }
    return None, expired


def _same_research_validation_window(
    active: dict[str, Any] | None,
    candidate: dict[str, Any] | None,
    decision: Any,
) -> bool:
    """Return whether a repeated declaration continues the current test.

    The hypothesis id is the stable identity. A caller must explicitly set
    ``validation_window.replace`` or increase ``hypothesis_version`` to begin a
    distinct window; textual refinement alone does not erase accumulated
    evidence.
    """
    if active is None or candidate is None or not isinstance(decision, dict):
        return False
    raw = decision.get("validation_window")
    replace = bool(raw.get("replace", False)) if isinstance(raw, dict) else False
    return (
        not replace
        and active.get("hypothesis_id") == candidate.get("hypothesis_id")
        and int(active.get("hypothesis_version", 1) or 1)
        == int(candidate.get("hypothesis_version", 1) or 1)
    )


def _run_pi(
    root: Path, *, bridge_url: str, game: str, variant: str,
    bridge_action_token: str | None = None,
    context_compaction: bool, subagent_broker_url: str | None = None,
    harness_validation: bool = False,
    auto_research_validation: bool = False,
    cross_situation_validation: bool = False,
    provider_name: str = "yibu",
    model_name: str | None = None,
    input_modalities: str | tuple[str, ...] | list[str] | None = None,
    provider_extension: Path | None = None,
    environment_overrides: dict[str, str] | None = None,
    review_mode: str = "advisory",
    experiment_timeout_seconds: float | None = None,
    reasoning_policy: str = "provider-default",
    reasoning_levels: tuple[str, ...] = (),
    max_output_tokens: int | None = None,
) -> int:
    max_reported_tokens = (environment_overrides or {}).get("PI_PROVIDER_MAX_REPORTED_TOKENS")
    from .reasoning_policy import validate_reasoning_options, select_reasoning_level
    validate_reasoning_options(reasoning_policy, reasoning_levels, max_output_tokens)
    if review_mode not in {"advisory", "required"}:
        raise ValueError("review_mode must be advisory or required")
    node, cli = _resolve_pi_cli()
    project_root = Path(__file__).resolve().parents[2]
    extension = project_root / "demo" / "pi_arc_agi_3_extension.ts"
    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(parents=True, exist_ok=True)
    env = load_project_dotenv(project_root)
    model_settings = resolve_model_settings(env)
    initial_after_feedback = _initial_reasoning_after_feedback(
        {**env, **(environment_overrides or {})}, reasoning_policy, reasoning_levels, model_settings)
    reasoning_length_recovery = _reasoning_length_recovery(
        {**env, **(environment_overrides or {})}, reasoning_policy, reasoning_levels, model_settings, provider_extension)
    if reasoning_policy == "adaptive-binary" and model_settings.get("thinking_format") not in {"qwen", "qwen-chat-template"}:
        raise ValueError("adaptive-binary requires an explicit verified Qwen thinking format")
    if max_output_tokens is not None:
        model_settings["max_tokens"] = max_output_tokens
    if input_modalities is not None:
        model_settings["input_modalities"] = list(resolve_input_modalities(input_modalities))
    base_url, api_key = model_settings["base_url"], model_settings["api_key"]
    if provider_extension is None and (not base_url or not api_key):
        raise RuntimeError(
            "this project environment must define ARC_OPENAI_API_BASE/ARC_OPENAI_API_KEY "
            "or OPENAI_API_BASE/OPENAI_API_KEY"
        )
    model = str(model_name or model_settings["model"])
    # The Pi child reads the canonical variable names from its own process.
    # Keep ARC-scoped values isolated from the parent process and from other
    # benchmark adapters.
    configure_real_provider = provider_extension is None
    if configure_real_provider and (not base_url or not api_key):
        raise RuntimeError(
            "the selected real parent or research-child provider requires "
            "ARC_OPENAI_API_BASE/ARC_OPENAI_API_KEY or OPENAI_API_BASE/OPENAI_API_KEY"
        )
    if configure_real_provider:
        env["OPENAI_API_BASE"] = str(base_url)
        env["OPENAI_API_KEY"] = str(api_key)
        (agent_dir / "models.json").write_text(json.dumps({"providers": {provider_name: {
            "baseUrl": base_url, "api": model_settings["pi_api"], "apiKey": "$OPENAI_API_KEY",
            # Preserve system instructions as system; Pi otherwise promotes
            # them to developer for reasoning models on unknown gateways.
            "compat": {"supportsDeveloperRole": False,
                       **({"thinkingFormat": model_settings["thinking_format"]}
                          if model_settings.get("thinking_format") else {})},
            "authHeader": True, "models": [{"id": model, "name": model, "reasoning": True,
                "input": model_settings["input_modalities"], "contextWindow": model_settings["context_window"],
                **({"maxTokens": model_settings["max_tokens"]} if model_settings.get("max_tokens") else {}),
                "cost": {"input": 5, "output": 30, "cacheRead": 0, "cacheWrite": 0}}],
        }}}), encoding="utf-8")
    env.update({
        "PI_CODING_AGENT_DIR": str(agent_dir), "PI_AUTORESEARCH_E2E_ROOT": str(root),
        # The run root is the durable boundary; this semantic id makes an
        # accidental root reuse by a different ARC task fail closed in the
        # task-local TypeScript resource registries.
        "PI_AUTORESEARCH_TASK_ID": f"arc-agi-3:{game}:{root.name}",
        "PI_AUTORESEARCH_OWNS_TASK": "enabled",
        "PI_AUTORESEARCH_ROOT": str(project_root), "PI_AUTORESEARCH_VARIANT": variant,
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled" if context_compaction else "disabled",
        "PI_ARC_BRIDGE_URL": bridge_url, "PI_ARC_GAME": game,
        "PI_ARC_INPUT_MODALITIES": ",".join(model_settings["input_modalities"]),
        "PI_ARC_EXECUTION_GATE": "enabled",
        "PI_HARNESS_PERIODIC_REVIEW": "enabled",
        "PI_HARNESS_REVIEW_DECISION_REQUIRED": "enabled" if review_mode == "required" else "disabled",
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": provider_name,
        "PI_AUTORESEARCH_MODEL": model,
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        # Open research allocation permits orchestration without a preliminary
        # read. Component authoring still requires an actual matching creator
        # read, a complete candidate and explicit assembly/trial.
        "PI_HARNESS_OPEN_ADMISSION": "enabled",
    })
    # Give the Pi context lifecycle the same declared window/output reserve
    # used by the provider registry. It may still report unknown when a custom
    # provider does not declare them; never infer capacity from cache hits.
    if (model_settings or {}).get("context_window"):
        env["PI_AUTORESEARCH_MODEL_CONTEXT_TOKENS"] = str(model_settings["context_window"])
    if (model_settings or {}).get("max_tokens"):
        env["PI_AUTORESEARCH_MODEL_OUTPUT_TOKENS"] = str(model_settings["max_tokens"])
    if provider_extension is not None:
        env["PI_AUTORESEARCH_PROVIDER_EXTENSION"] = str(provider_extension.resolve())
    if subagent_broker_url:
        env["PI_AUTORESEARCH_SUBAGENT_BROKER_URL"] = subagent_broker_url
    if environment_overrides:
        env.update({str(key): str(value) for key, value in environment_overrides.items()})
    if max_reported_tokens is not None:
        if not str(max_reported_tokens).isdigit() or int(max_reported_tokens) <= 0:
            raise ValueError("max_reported_tokens must be a positive integer")
        env["PI_PROVIDER_TOKEN_BUDGET_ROOT"] = str(root.resolve())
    no_level_configured = env.get("PI_ARC_NO_LEVEL_REPORTED_TOKENS")
    no_level_scope = env.get("PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE", "outer_prompt_dispatch")
    if no_level_scope not in {"outer_prompt_dispatch", "parent_provider_requests"}:
        raise ValueError("PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE must be outer_prompt_dispatch or parent_provider_requests")
    if no_level_scope == "parent_provider_requests" and not no_level_configured:
        raise ValueError("parent_provider_requests requires a no-level reported usage checkpoint")
    no_level_limit = None
    if no_level_configured:
        if not no_level_configured.isdigit() or not 0 < int(no_level_configured) <= 2**53 - 1:
            raise ValueError("PI_ARC_NO_LEVEL_REPORTED_TOKENS must be a positive safe integer")
        if not env.get("PI_PROVIDER_MAX_REPORTED_TOKENS"):
            raise ValueError("PI_ARC_NO_LEVEL_REPORTED_TOKENS requires the shared native reported usage budget")
        no_level_limit = int(no_level_configured)
    if bridge_action_token:
        env["PI_ARC_ACTION_TOKEN"] = bridge_action_token
    apply_jev_routing_policy(env)
    (root / "arc-runtime-config.json").write_text(json.dumps({
        "requested_review_mode": review_mode,
        "review_mode": "required" if env.get("PI_HARNESS_REVIEW_DECISION_REQUIRED") == "enabled" else "advisory",
        "periodic_review_enabled": env.get("PI_HARNESS_PERIODIC_REVIEW") == "enabled",
        "reasoning_policy": reasoning_policy, "reasoning_levels": list(reasoning_levels),
        **({"initial_reasoning_after_feedback": True} if initial_after_feedback else {}),
        **({"reasoning_length_recovery": "native_off_once_per_length_streak"} if reasoning_length_recovery else {}),
        "max_reported_tokens": int(env["PI_PROVIDER_MAX_REPORTED_TOKENS"]) if env.get("PI_PROVIDER_MAX_REPORTED_TOKENS") else None,
        "no_level_reported_tokens": no_level_limit,
        "no_level_checkpoint_scope": no_level_scope if no_level_limit is not None else None,
        **({"native_compaction_policy": "decline_unmeasured"} if no_level_scope == "parent_provider_requests" else {}),
        "parent_max_output_tokens": model_settings.get("max_tokens"),
        "child_max_output_tokens": model_settings.get("max_tokens"),
        "output_envelope_scope": "shared_model_registry",
        "parent_output_reserve": env.get("PI_AUTORESEARCH_MODEL_OUTPUT_TOKENS"),
        "child_thinking": env.get("PI_AUTORESEARCH_THINKING", "provider-default"),
        "provider_thinking_format": model_settings.get("thinking_format"),
        "reasoning_history_policy": env.get("PI_PROVIDER_REASONING_HISTORY_POLICY", "preserve"),
        "editable_reasoning_providers": env.get("PI_PROVIDER_EDITABLE_REASONING_PROVIDERS", ""),
        "exact_region_table": env.get("PI_ARC_EXACT_REGION_TABLE") in {"enabled", "after_action"},
        "exact_region_table_mode": env.get("PI_ARC_EXACT_REGION_TABLE", "disabled"),
        "concise_arc_guidance": env.get("PI_ARC_CONCISE_GUIDANCE") == "enabled",
        "tool_disclosure": env.get("PI_ARC_TOOL_DISCLOSURE", "on_demand"),
        "child_observation": env.get("PI_ARC_CHILD_OBSERVATION", "on_demand"),
    }, indent=2) + "\n", encoding="utf-8")
    command = [node, cli, "--mode", "rpc", "--provider", provider_name, "--model", model,
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
               "--no-context-files", "--no-builtin-tools",
               # The extension registers its confined Skill/Subagent reader.
               # Excluding the name 'read' also excludes that custom capability,
               # so disable built-ins separately and keep its name available.
               "--exclude-tools", "bash,edit,write,grep,find,ls",
               "--extension", str(extension)]
    if provider_extension is not None:
        command.extend(["--extension", str(provider_extension.resolve())])
    trace = (root / "pi-events.jsonl").open("a", encoding="utf-8")
    # Pi emits streaming deltas whose ``partial`` payload repeats the entire
    # assistant message on every token.  Persisting those deltas makes a long
    # ARC run grow quadratically while adding no execution evidence.  Keep
    # lifecycle, tool, response, and final-message events; omit only the
    # replaceable streaming fragments.
    persisted_event_types = {
        "response", "turn_start", "turn_end", "agent_start", "agent_end",
        "agent_settled", "message_start", "message_end", "toolCall",
        "tool_execution_start", "tool_execution_end", "agent_progress_watchdog", "text", "thinking",
        "arc_progress_intervention", "arc_recovery_phase", "arc_deadline_admission",
        "arc_provider_failure", "reasoning_policy_selection", "reasoning_policy_consumed",
        "reasoning_length_recovery_stopped",
    }
    def persist(event: dict[str, Any]) -> None:
        if event.get("type") not in persisted_event_types:
            return
        projected = _compact_arc_pi_event(event)
        if projected is None:
            return
        projected.setdefault("recordedAt", datetime.now(timezone.utc).isoformat())
        trace.write(json.dumps(projected, ensure_ascii=False, separators=(",", ":")) + "\n")
        trace.flush()
    try:
        # Preserve native defaults; a manager may explicitly bound an experiment.
        kernel_timeout = OFFICIAL_MAX_RUNTIME_SECONDS
        session_deadline = (time.monotonic() + experiment_timeout_seconds
                            if experiment_timeout_seconds is not None else None)
        with PiKernel(
            command,
            cwd=str(root),
            env=env,
            timeout=kernel_timeout,
            deadline=session_deadline,
            event_sink=persist,
            event_projector=_project_arc_feedback_kernel_event if initial_after_feedback else _project_arc_kernel_event,
        ) as kernel:
            consumed_reasoning_opportunities: set[str] = set()
            previous_reasoning_level = None
            pending_reasoning_opportunity = None
            pending_reasoning_keys: set[str] = set()
            action_feedback_received = False
            task_purpose = ""
            def prompt_with_policy(message: str, preserve_level: bool = False, recover_reasoning_length: bool = False):
                nonlocal previous_reasoning_level, pending_reasoning_opportunity, pending_reasoning_keys
                if no_level_limit is not None:
                    # At continuation this loop is settled and selected tools
                    # already committed their receipts. Never abort message_end
                    # for this softer checkpoint: only decline the next prompt.
                    ledger_path = Path(env.get("PI_PROVIDER_TOKEN_BUDGET_ROOT", str(root))) / "provider-token-budget.jsonl"
                    levels, state_error = None, None
                    try:
                        public_state = _get_json(bridge_url + "/state")
                        levels = public_state.get("levels_completed")
                        if type(levels) is not int or levels < 0:
                            raise ValueError("public levels_completed must be a nonnegative integer")
                    except (OSError, ValueError, TypeError, AttributeError) as exc:
                        levels, state_error = None, f"{type(exc).__name__}: {exc}"
                    usage = _arc_reported_usage(ledger_path)
                    reason = ("unknown provider usage" if usage["unmeasured_usage"] else
                              "unknown current public ARC levels" if state_error else
                              "no first level by declared cost checkpoint"
                              if levels == 0 and usage["reported_tokens"] >= no_level_limit else None)
                    if reason:
                        audit = {"reason": reason, "scope": "outer_prompt_dispatch",
                                 "limit": no_level_limit, "levels_completed": levels, **usage,
                                 "ledger_path": str(ledger_path.resolve()), "state_error": state_error,
                                 "recordedAt": datetime.now(timezone.utc).isoformat(),
                                 "interpretation": "Known shared parent/child usage; current response overshoot remains spent. Internal Pi continuations and asynchronous children are outside this checkpoint."}
                        (root / "arc-request-admission-stop.json").write_text(
                            json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                        raise _ArcOuterRequestStopped(reason)
                # A new Pi session keeps durable evidence but loses its user
                # purpose. Restore the original authored task only on recovery,
                # rather than replaying the manual on every normal action.
                if preserve_level and task_purpose:
                    message = f"{task_purpose}\n\n{message}"
                def state_from(name):
                    try:
                        value = json.loads((root / name).read_text(encoding="utf-8"))
                        return value if isinstance(value, dict) else {}
                    except (OSError, ValueError):
                        return {}
                checkpoint_state, strategy_state = state_from("task-checkpoint.json"), state_from("task-strategy-state.json")
                if reasoning_policy == "adaptive-evidence":
                    strategy_state = {**strategy_state, "geometry_evidence": state_from("arc-geometry-facts.json")}
                opportunity = None
                if recover_reasoning_length and previous_reasoning_level not in {None, "off"}:
                    # Only the qualified parent assistant length branch may
                    # change allocation; ordinary prompt rejection preserves it.
                    level, reason = "off", "length_recovery_native_off"
                elif preserve_level and previous_reasoning_level is not None:
                    level, reason = previous_reasoning_level, "length_recovery_preserves_allocation"
                else:
                    level, reason = select_reasoning_level(checkpoint_state,
                        strategy_state, reasoning_policy, reasoning_levels, consumed_reasoning_opportunities,
                        first_deep_after_feedback=initial_after_feedback,
                        action_feedback_received=action_feedback_received)
                    if reasoning_policy == "adaptive-binary" and level != "off":
                        from .reasoning_policy import binary_reasoning_opportunity
                        opportunity, _ = binary_reasoning_opportunity(checkpoint_state, strategy_state, consumed_reasoning_opportunities,
                            first_deep_after_feedback=initial_after_feedback,
                            action_feedback_received=action_feedback_received)
                    elif reasoning_policy == "adaptive-evidence" and level == "medium":
                        from .reasoning_policy import evidence_reasoning_opportunity
                        opportunity, _ = evidence_reasoning_opportunity(checkpoint_state, strategy_state, consumed_reasoning_opportunities)
                result = kernel.send("set_thinking_level", level=level) if level is not None else None
                persist({"type": "reasoning_policy_selection", "policy": reasoning_policy,
                         "level": level, "reason": reason, "rpc_result": result,
                         "opportunity_ref": opportunity,
                         "capability_basis": "operator_declared" if reasoning_levels else "unknown"})
                if result and result.get("success") is False:
                    raise RuntimeError("Pi rejected the declared reasoning capability")
                if not preserve_level:
                    pending_reasoning_opportunity = opportunity
                    if initial_after_feedback:
                        from .reasoning_policy import binary_reasoning_consumption_keys
                        pending_reasoning_keys = (binary_reasoning_consumption_keys(checkpoint_state, opportunity,
                            first_deep_after_feedback=True) if opportunity else set())
                previous_reasoning_level = level
                return kernel.prompt(message)
            bridge_event_cursor = len(_read_jsonl(root / "bridge-events.jsonl"))
            # Match the official ARC runtime's proactive context management.
            # This is Pi's native session facility, enabled for both arms; the
            # treatment-only finding-backed context capability remains a
            # separate, optional self-harness intervention.
            kernel.send("set_auto_compaction", enabled=True)
            prompt = _load_prompt("arc_decision_cycle_concise.md" if env.get("PI_ARC_CONCISE_GUIDANCE") == "enabled"
                                  else "arc_decision_cycle.md", game=game)
            if harness_validation:
                prompt = _load_prompt("arc_harness_composition_validation.md"
                                      if env.get("PI_HARNESS_COMPOSITION_VALIDATION") == "enabled"
                                      else "arc_harness_validation.md", game=game)
                capability = env.get("PI_HARNESS_CAPABILITY_VALIDATION")
                if capability:
                    creator = {"skill": "skill-creator", "tool": "tool-creator", "subagent": "subagent-creator"}.get(capability)
                    if creator is None:
                        raise ValueError("PI_HARNESS_CAPABILITY_VALIDATION must be skill, tool or subagent")
                    prompt = _load_prompt("arc_harness_capability_validation.md", game=game,
                                          component=capability, creator=creator)
            if auto_research_validation:
                prompt = _load_prompt("arc_auto_research_validation.md", game=game)
            if cross_situation_validation:
                prompt = _load_prompt("arc_cross_situation_validation.md", game=game)
            task_purpose = prompt
            (root / "arc-parent-purpose.json").write_text(json.dumps({
                "format": "arc-parent-purpose-v1", "prompt": prompt,
                "harness_validation": harness_validation,
                "auto_research_validation": auto_research_validation,
                "cross_situation_validation": cross_situation_validation,
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            response = prompt_with_policy(prompt)
            if response.get("success") is False:
                return 1
            consecutive_length_responses = 0
            seen_validation_versions: set[tuple[str, int]] = set()
            pending_research_notice: str | None = None
            research_window_path = root / "research-validation-windows.jsonl"
            latest_action_evidence: dict[str, Any] | None = None
            # Recovery is an explicit state machine. A clean-context research
            # report or task-local harness operation is useful recovery work,
            # but only a native action closes the ARC decision cycle.
            recovery_phase = "normal"
            while True:
                turn_events = kernel.wait_for_agent_events(
                    timeout=None,
                    # ARC must stop the model turn at the committed action.
                    # Planning, research, and task-local harness calls are
                    # intentionally allowed before that final action; the
                    # bridge records every native action in this decision
                    # cycle, including a bounded batch or authorized child.
                    stop_after_progress_tools=("arc_action", "arc_actions"),
                )
                if any(row.get("event") == "budget_stop"
                       for row in _read_jsonl(root / "provider-token-budget.jsonl")):
                    persist({"type": "reported_token_budget_exhausted",
                             "limit": int(env["PI_PROVIDER_MAX_REPORTED_TOKENS"]),
                             "interpretation": "Reported parent/child usage threshold; unfinished streams may add unmeasured cost."})
                    return 125
                # Admission/HTTP headers/aborted turns are not a consumed deep
                # reasoning opportunity. Keep the allocation across recovery
                # until a complete native assistant message actually returns.
                if pending_reasoning_opportunity and any(
                    event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant"
                    and event["message"].get("stopReason") in {"stop", "toolUse"} for event in turn_events
                ):
                    from .reasoning_policy import consumed_opportunity_keys
                    consumed_keys = (pending_reasoning_keys if initial_after_feedback else
                                     consumed_opportunity_keys(pending_reasoning_opportunity))
                    consumed_reasoning_opportunities.update(consumed_keys)
                    persist({"type": "reasoning_policy_consumed", "opportunity_ref": pending_reasoning_opportunity,
                             "level": previous_reasoning_level, "evidence": "complete_native_assistant_message",
                             **({"opportunity_refs": sorted(consumed_keys)} if initial_after_feedback else {})})
                    pending_reasoning_opportunity = None
                    pending_reasoning_keys = set()
                bridge_event_cursor = _sync_bridge_events(root, bridge_url, bridge_event_cursor)
                if initial_after_feedback and _turn_has_nonreset_arc_feedback(turn_events):
                    action_feedback_received = True
                turn_has_action = _turn_has_arc_action(turn_events)
                previous_recovery_phase = recovery_phase
                recovery_phase = _advance_arc_recovery_phase(recovery_phase, turn_events)
                if recovery_phase != previous_recovery_phase:
                    persist({
                        "type": "arc_recovery_phase",
                        "from": previous_recovery_phase,
                        "to": recovery_phase,
                        "arc_action": turn_has_action,
                        "auto_research": _turn_has_auto_research_result(turn_events),
                    })
                for event in turn_events:
                    if event.get("type") == "tool_execution_end" and event.get("toolName") in {"arc_action", "arc_actions", "delegate_task"} and not event.get("isError", False):
                        # PiKernel may deliver either the compact projected
                        # event or the raw tool event depending on the event
                        # cursor boundary. Normalize the evidence before
                        # constructing the durable latest-action checkpoint.
                        # Keep this ordering deliberate: the checkpoint must
                        # never reference event-local variables before they
                        # have been initialized (a failed recovery here used
                        # to turn a successful ARC action into runner return 1).
                        evidence = event.get("evidence") if isinstance(event.get("evidence"), dict) else {}
                        raw_result = event.get("result") if isinstance(event.get("result"), dict) else {}
                        raw_details = raw_result.get("details") if isinstance(raw_result.get("details"), dict) else {}
                        action_receipts = (raw_details.get("completed") if event.get("toolName") == "arc_actions"
                                           else raw_details.get("arc_action_receipts") if event.get("toolName") == "delegate_task"
                                           else None)
                        if event.get("toolName") != "arc_action" and not action_receipts:
                            continue
                        latest_receipt = action_receipts[-1] if isinstance(action_receipts, list) else {}
                        action_name = str(latest_receipt.get("action") or (event.get("args") or {}).get("action", ""))
                        transition = (
                            evidence.get("public_transition")
                            if isinstance(evidence, dict) else None
                        ) or latest_receipt.get("public_transition") or raw_details.get("public_transition")
                        observation_delta = (
                            evidence.get("observation_delta")
                            if isinstance(evidence.get("observation_delta"), dict) else None
                        ) or latest_receipt.get("observation_delta") or (
                            raw_details.get("observation_delta")
                            if isinstance(raw_details.get("observation_delta"), dict) else {}
                        )
                        latest_action_evidence = {
                            "action": action_name,
                            "changed_cells": observation_delta.get("changed_cells"),
                            "bbox": observation_delta.get("bbox"),
                            "level_changed": transition.get("level_changed") if isinstance(transition, dict) else False,
                        }
                        # A real action proves the recovery made progress;
                        # only then may a later length stop receive another
                        # one-time recovery opportunity.
                        consecutive_length_responses = 0
                        # Pi's validation ledger owns experiment lifecycle. This runner
                        # projects exact versions and never starts or advances another timer.
                        for validation in _read_jsonl(root / "task-validations.jsonl"):
                            experiment = validation.get("experiment")
                            if not isinstance(experiment, dict):
                                continue
                            identity = (str(validation.get("validation_id")), int(validation.get("version", 1)))
                            if identity in seen_validation_versions:
                                continue
                            seen_validation_versions.add(identity)
                            contract = experiment.get("contract") or {}
                            _append_jsonl(research_window_path, {
                                "type": "research_validation_window",
                                "authority": "task_validation",
                                "validation_ref": f"validation:{identity[0]}@v{identity[1]}",
                                "hypothesis_id": contract.get("candidate_id"),
                                "hypothesis_version": contract.get("candidate_version"),
                                "test_id": contract.get("test_id"),
                                "status": experiment.get("status"),
                                "outcome": experiment.get("outcome"),
                                "actions_used": experiment.get("actions_used", 0),
                                "action_limit": contract.get("actions"),
                            })
                provider_error = _turn_provider_error(turn_events)
                if provider_error is not None:
                    # Provider transport/quota failure is not an ARC no-action
                    # decision. Re-prompting here can spin while the online
                    # environment remains frozen at its last committed action.
                    persist({
                        "type": "arc_provider_failure",
                        "error": provider_error,
                        "arc_action_committed": turn_has_action,
                    })
                    return 1
                state = _get_json(bridge_url + "/state")
                if _arc_terminal_or_budget_exhausted(state):
                    if variant == "treatment":
                        # The action is already committed. A final read-only turn
                        # can assign outcome credit without another environment step.
                        review_response = prompt_with_policy(
                            "ARC_TERMINAL_LEVEL_REVIEW: The environment run has ended. "
                            "Perform whole-level outcome analysis for pending level windows, "
                            "read exact evidence with task_resource and submit "
                            "task_harness(action='level_review'). Assess useful behaviors and "
                            "actually applied harness versions, wasted work, failure/reset "
                            "causes, lessons and next-attempt recommendations. Do not take "
                            "environment actions, start research, or mutate harness resources. "
                            "Finish after submitting the reviews; uncertainty is valid."
                        )
                        review_error = None
                        if review_response.get("success") is not False:
                            try:
                                review_events = kernel.wait_for_agent_events(timeout=120)
                                review_error = _turn_provider_error(review_events)
                            except Exception as exc:
                                # Analysis failure must not rewrite the committed game result.
                                review_error = str(exc)
                        _append_jsonl(root / "task-level-review-events.jsonl", {
                            "event": "terminal_review_turn_finished",
                            "submission_count": len(_read_jsonl(root / "task-level-reviews.jsonl")),
                            "prompt_accepted": review_response.get("success") is not False,
                            "error": review_error,
                        })
                    return 0
                # ``follow_up`` only queues a message while an agent loop is
                # still active.  At this point the previous loop has emitted
                # ``agent_settled`` and is idle, so a follow_up would be
                # accepted but never start another turn.  Use Pi's native
                # prompt command to begin the next loop from the existing
                # session context.
                truncated = any(
                    event.get("type") == "message_end"
                    and isinstance(event.get("message"), dict)
                    and event["message"].get("stopReason") == "length"
                    and (not reasoning_length_recovery or event["message"].get("role") == "assistant")
                    for event in turn_events
                )
                if truncated:
                    consecutive_length_responses += 1
                    if reasoning_length_recovery and consecutive_length_responses > 1:
                        persist({"type": "reasoning_length_recovery_stopped", "policy": reasoning_policy,
                                 "reason": "consecutive_length_retry_exhausted",
                                 "consecutive_length_responses": consecutive_length_responses,
                                 "level": previous_reasoning_level})
                        return 1
                    # A length stop is a model-session failure, not an ARC or
                    # research failure. Recreate only Pi's in-memory session;
                    # the bridge, checkpoint, task-local resources and child
                    # reports remain durable. The compact recovery protocol
                    # permits bounded research/resource work before its final
                    # action. The opt-in native policy permits one retry per
                    # consecutive length streak; otherwise the caller's
                    # deadline bounds repeated truncation as before.
                    kernel.new_session()
                    recovery_state = _get_json(bridge_url + "/state")
                    recovery = _load_prompt("arc_length_recovery.md", **{
                        "state": str(recovery_state.get("state")),
                        "levels_completed": str(recovery_state.get("levels_completed", 0)),
                        "action_budget": json.dumps(recovery_state.get("action_budget", {}), separators=(",", ":")),
                        "available_actions": json.dumps(recovery_state.get("agent_available_actions", recovery_state.get("available_actions", [])), separators=(",", ":")),
                        "latest_action_evidence": json.dumps(latest_action_evidence, separators=(",", ":")),
                        "research_notice": f"{pending_research_notice} " if pending_research_notice else "",
                    })
                    previous_recovery_phase = recovery_phase
                    recovery_phase = "compact_recovery"
                    persist({
                        "type": "arc_recovery_phase", "from": previous_recovery_phase,
                        "to": recovery_phase, "reason": "model_output_length",
                        "consecutive_length_responses": consecutive_length_responses,
                    })
                    follow_up = prompt_with_policy(recovery, preserve_level=True,
                                                   recover_reasoning_length=reasoning_length_recovery)
                    if follow_up.get("success") is False:
                        return 1
                    kernel.wait_for_event(("turn_start",), timeout=None)
                    pending_research_notice = None
                    continue
                else:
                    consecutive_length_responses = 0
                if not turn_has_action:
                    if recovery_phase != "normal":
                        continuation = _load_prompt("arc_recovery_followup.md", **{
                            "phase": recovery_phase,
                            "state": str(state.get("state")),
                            "levels_completed": str(state.get("levels_completed", 0)),
                            "action_budget": json.dumps(state.get("action_budget", {}), separators=(",", ":")),
                            "available_actions": json.dumps(state.get("agent_available_actions", state.get("available_actions", [])), separators=(",", ":")),
                            "latest_action_evidence": json.dumps(latest_action_evidence, separators=(",", ":")),
                            "research_notice": f"{pending_research_notice} " if pending_research_notice else "",
                        })
                    else:
                        continuation = _load_prompt("arc_followup.md")
                else:
                    continuation = _arc_continuation_prompt(state, truncated=truncated)
                if pending_research_notice:
                    continuation = f"{pending_research_notice}\n{continuation}"
                follow_up = prompt_with_policy(continuation)
                if follow_up.get("success") is False:
                    # Some Pi versions reject a normal prompt immediately
                    # after an action-boundary abort even though the action
                    # itself completed successfully.  The bridge/checkpoint
                    # is authoritative; recover the model session once
                    # instead of misclassifying the completed action as a
                    # runner failure.
                    kernel.new_session()
                    recovery_state = _get_json(bridge_url + "/state")
                    recovery = _load_prompt("arc_action_boundary_recovery.md", **{
                        "state": str(recovery_state.get("state")),
                        "levels_completed": str(recovery_state.get("levels_completed", 0)),
                        "action_budget": json.dumps(recovery_state.get("action_budget", {}), separators=(",", ":")),
                        "latest_action_evidence": json.dumps(latest_action_evidence, separators=(",", ":")),
                    })
                    recovered = prompt_with_policy(recovery, preserve_level=True)
                    if recovered.get("success") is False:
                        return 1
                    kernel.wait_for_event(("turn_start",), timeout=None)
                    previous_recovery_phase = recovery_phase
                    recovery_phase = "awaiting_action"
                    persist({
                        "type": "arc_recovery_phase", "from": previous_recovery_phase,
                        "to": recovery_phase, "reason": "action_boundary_prompt_rejected",
                    })
                    continue
                # ``agent_settled`` from the previous turn is already in the
                # RPC event stream. Advance the cursor to the new turn before
                # collecting its completion, otherwise the runner can return
                # immediately without giving the continuation a chance to act.
                kernel.wait_for_event(("turn_start",), timeout=None)
                pending_research_notice = None
    except _ArcOuterRequestStopped:
        return 125
    except TimeoutError:
        return 124
    finally:
        trace.close()


def run_arc_agi_3_e2e(
    root: Path,
    *,
    arc_root: Path,
    game: str,
    experiment_variant: str = "treatment",
    max_actions: int | None = None,
    context_compaction: bool = False,
    harness_validation: bool = False,
    auto_research_validation: bool = False,
    cross_situation_validation: bool = False,
    pi_provider: str = "yibu",
    pi_model: str | None = None,
    input_modalities: str | tuple[str, ...] | list[str] | None = None,
    pi_provider_extension: Path | None = None,
    pi_environment: dict[str, str] | None = None,
    review_mode: str = "advisory",
    bridge_python: Path | None = None,
    bridge_module_paths: tuple[Path, ...] = (),
    experiment_timeout_seconds: float | None = None,
    reasoning_policy: str = "provider-default",
    reasoning_levels: tuple[str, ...] = (),
    max_output_tokens: int | None = None,
    max_reported_tokens: int | None = None,
) -> Path:
    from .reasoning_policy import validate_reasoning_options
    validate_reasoning_options(reasoning_policy, reasoning_levels, max_output_tokens)
    if max_reported_tokens is not None:
        if isinstance(max_reported_tokens, bool) or not isinstance(max_reported_tokens, int) or max_reported_tokens <= 0:
            raise ValueError("max_reported_tokens must be a positive integer")
        pi_environment = {**(pi_environment or {}), "PI_PROVIDER_MAX_REPORTED_TOKENS": str(max_reported_tokens)}
    if review_mode not in {"advisory", "required"}:
        raise ValueError("review_mode must be advisory or required")
    if experiment_timeout_seconds is not None and (
        not math.isfinite(experiment_timeout_seconds) or experiment_timeout_seconds <= 0
    ):
        raise ValueError("experiment_timeout_seconds must be finite and positive")
    if experiment_variant not in {"control", "treatment"}:
        raise ValueError("experiment_variant must be control or treatment")
    validation_probes = [harness_validation, auto_research_validation, cross_situation_validation]
    if any(validation_probes) and experiment_variant != "treatment":
        raise ValueError("task-local validation probes require the treatment variant")
    if sum(bool(value) for value in validation_probes) > 1:
        raise ValueError("choose one task-local validation probe")
    if max_actions is not None and max_actions < 0:
        raise ValueError("max_actions must be nonnegative; 0 disables local step limits")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ARC output must be an empty directory; use a new run root")
    root.mkdir(parents=True, exist_ok=True)
    arc_root = arc_root.resolve()
    arc_python = bridge_python or arc_root / ".venv" / "Scripts" / "python.exe"
    if not arc_python.is_file():
        raise FileNotFoundError(f"ARC SDK interpreter was not found: {arc_python}")
    project_root = Path(__file__).resolve().parents[2]
    env = load_project_dotenv(project_root)
    model_settings = resolve_model_settings(env)
    _initial_reasoning_after_feedback({**env, **(pi_environment or {})},
                                     reasoning_policy, reasoning_levels, model_settings)
    _reasoning_length_recovery({**env, **(pi_environment or {})},
                              reasoning_policy, reasoning_levels, model_settings, pi_provider_extension)
    if reasoning_policy == "adaptive-binary" and model_settings.get("thinking_format") not in {"qwen", "qwen-chat-template"}:
        raise ValueError("adaptive-binary requires an explicit verified Qwen thinking format")
    if max_output_tokens is not None:
        model_settings["max_tokens"] = max_output_tokens
    if input_modalities is not None:
        model_settings["input_modalities"] = list(resolve_input_modalities(input_modalities))
    src = str(Path(__file__).resolve().parent.parent)
    env["PYTHONPATH"] = os.pathsep.join([src, *(str(path.resolve()) for path in bridge_module_paths), env.get("PYTHONPATH", "")])
    # Bind once in the real child. Probe/close/rebind races with Windows port
    # reservations or another listener and is not a reservation of ownership.
    bridge_port = 0
    bridge_launch_id = secrets.token_hex(16)
    bridge_action_token = secrets.token_urlsafe(32)
    bridge_command = [str(arc_python), "-m", "autoresearch_pi.arc_agi_3_bridge", "--root", str(root), "--game", game, "--port", str(bridge_port)]
    if max_actions is not None:
        bridge_command.extend(["--max-actions", str(max_actions)])
    bridge = subprocess.Popen(
        bridge_command,
        cwd=str(arc_root), env={**env, "ARC_BRIDGE_EVENT_WRITER": "parent",
                                "ARC_BRIDGE_ACTION_TOKEN": bridge_action_token,
                                "ARC_BRIDGE_LAUNCH_ID": bridge_launch_id},
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    subagent_broker = SubagentBroker()
    subagent_broker.start()
    pi_returncode = 1
    timed_out = False
    bridge_result: dict[str, Any] = {}
    runner_stage = "bridge_readiness"
    try:
        ready = _wait_for_bridge(root, bridge, launch_id=bridge_launch_id)
        bridge_url = f"http://127.0.0.1:{int(ready['port'])}"
        runner_stage = "pi_parent_loop"
        pi_returncode = _run_pi(
            root, bridge_url=bridge_url, game=game, variant=experiment_variant,
            bridge_action_token=bridge_action_token,
            context_compaction=context_compaction,
            subagent_broker_url=subagent_broker.url,
            harness_validation=harness_validation,
            auto_research_validation=auto_research_validation,
            cross_situation_validation=cross_situation_validation,
            provider_name=pi_provider,
            model_name=pi_model,
            input_modalities=model_settings["input_modalities"],
            provider_extension=pi_provider_extension,
            environment_overrides=pi_environment,
            reasoning_policy=reasoning_policy, reasoning_levels=reasoning_levels,
            max_output_tokens=max_output_tokens,
            review_mode=review_mode,
            **({"experiment_timeout_seconds": experiment_timeout_seconds}
               if experiment_timeout_seconds is not None else {}),
        )
        timed_out = pi_returncode == 124
        runner_stage = "bridge_close"
        bridge_result = _post_json(bridge_url + "/close", {}, action_token=bridge_action_token)
        bridge_events = bridge_result.pop("events", [])
        if isinstance(bridge_events, list):
            _append_bridge_event_batch(root, bridge_events)
        runner_stage = "bridge_exit"
        bridge.wait(timeout=30)
    except (Exception, KeyboardInterrupt) as exc:
        (root / "runner-error.json").write_text(
            json.dumps({"error": f"{type(exc).__name__}: {exc}",
                        "stage": runner_stage,
                        "pi_returncode_before_error": pi_returncode,
                        "pi_timed_out_before_error": timed_out,
                        "recovery": "Preserve this run's bridge events, last public observation, checkpoint and exact assembly refs; diagnose the failed stage before a fresh online attempt. Do not replay prior actions."},
                       ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        # Preserve an analyzable terminal summary even when the operator
        # interrupts a long native run.  The bridge is still closed below so
        # its scorecard and bridge-result are flushed before projection.
        pi_returncode = 130 if isinstance(exc, KeyboardInterrupt) else 1
    finally:
        subagent_broker.close()
        if bridge.poll() is None:
            bridge.terminate()
            try:
                bridge.wait(timeout=5)
            except subprocess.TimeoutExpired:
                bridge.kill()
                bridge.wait(timeout=5)
        # Popen uses pipes so startup/runtime diagnostics are otherwise lost
        # when the runner exits on an exception or timeout.
        if bridge.stderr is not None:
            try:
                stderr = bridge.stderr.read()
                if stderr:
                    (root / "bridge-stderr.log").write_text(stderr[-65_536:], encoding="utf-8")
            except (OSError, ValueError):
                pass
    if not bridge_result and (root / "bridge-result.json").is_file():
        bridge_result = json.loads((root / "bridge-result.json").read_text(encoding="utf-8"))
    if not bridge_result:
        bridge_result = _partial_bridge_result(root)
    scorecard = None
    if (root / "arc-scorecard.json").is_file():
        scorecard = json.loads((root / "arc-scorecard.json").read_text(encoding="utf-8"))
    summary_model_settings = dict(model_settings)
    summary_model_settings["model"] = pi_model or summary_model_settings.get("model")
    summary_model_settings["provider"] = pi_provider
    summary_model_settings["provider_extension"] = (
        str(pi_provider_extension.resolve()) if pi_provider_extension is not None else None
    )
    payload = project_arc_summary(
        root, game=game, variant=experiment_variant, bridge_result=bridge_result,
        scorecard=scorecard, pi_returncode=pi_returncode, timed_out=timed_out,
        model_settings=summary_model_settings, harness_validation=harness_validation,
        auto_research_validation=auto_research_validation,
        cross_situation_validation=cross_situation_validation,
    )
    method_audit = root / "method-evolution-audit.json"
    method_audit_tmp = root / "method-evolution-audit.json.tmp"
    method_audit_tmp.write_text(
        json.dumps(payload["research"]["method_evolution"], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    method_audit_tmp.replace(method_audit)
    summary = root / "summary.json"
    if experiment_timeout_seconds is not None or max_reported_tokens is not None:
        payload["experiment_limits"] = {"pi_runtime_seconds": experiment_timeout_seconds,
                                        "max_actions": max_actions,
                                        "max_reported_tokens": max_reported_tokens,
                                        "budget_basis": "Reported parent and child usage; unfinished streams may add unmeasured cost.",
                                        "official_benchmark_default": False}
    temporary = root / "summary.json.tmp"
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(summary)
    return summary
