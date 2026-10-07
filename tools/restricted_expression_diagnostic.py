"""Minimal orchestrator for the restricted-expression Pi diagnostic.

The runner prepares versioned task resources, launches Pi through ``PiKernel``
after an explicit deterministic-readiness gate, and records native events. It
does not evaluate ASTs, parse inputs, resolve bindings, compute oracle output,
or expose the runner-side oracle to the provider.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import threading
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

try:
    from autoresearch_pi.pi_kernel import PiKernel
except ModuleNotFoundError as exc:
    # Keep the diagnostic directly runnable from a source checkout as well as
    # from an installed package (the normal test path sets pythonpath=src).
    if exc.name != "autoresearch_pi":
        raise
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from autoresearch_pi.pi_kernel import PiKernel
from tools.restricted_expression_diagnostic_oracle import (
    expected_invalid_paths,
    expected_output,
    load_resource,
    resource_hash,
)
from autoresearch_pi.project import load_project_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "restricted_expression_diagnostic"
BOOTSTRAP = PROJECT_ROOT / "tests" / "pi_restricted_expression_diagnostic_bootstrap.ts"
RESOURCE_FILE = "execution-observations.jsonl"
DIAGNOSTIC_EVENT_MAX_COUNT = 4_096
DIAGNOSTIC_EVENT_MAX_BYTES = 8 * 1024 * 1024
DIAGNOSTIC_EVENT_MAX_ITEM_BYTES = 64 * 1024
DIAGNOSTIC_CONTINUATION_PROMPT = (
    "Continue the unfinished diagnostic task in this same Pi session. "
    "Use the existing transcript and task resources, do not repeat completed work, "
    "and finish the remaining required checks and final response."
)

DIAGNOSTIC_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "rule": {"type": "object", "properties": {"minimum": {"type": "number"}}, "required": ["minimum"], "additionalProperties": False},
                    "records": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "active": {"type": "boolean"},
                                "label": {"type": "string"},
                                "measurements": {
                                    "type": "array",
                                    "items": {"type": "object", "properties": {"id": {"type": "string"}, "value": {"type": "number"}}, "required": ["id", "value"], "additionalProperties": False},
                                },
                            },
                            "required": ["id", "active", "label", "measurements"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["id", "rule", "records"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["groups"],
    "additionalProperties": False,
}

DIAGNOSTIC_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "records": DIAGNOSTIC_INPUT_SCHEMA["properties"]["groups"]["items"]["properties"]["records"],
                    "qualifying_record_count": {"type": "integer", "minimum": 0},
                    "qualifying_measurement_count": {"type": "integer", "minimum": 0},
                },
                "required": ["id", "records", "qualifying_record_count", "qualifying_measurement_count"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["groups"],
    "additionalProperties": False,
}


class DiagnosticReadinessBlocked(RuntimeError):
    """Raised before Pi starts when deterministic readiness is incomplete."""


def _json_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _content_digest(value: Any) -> dict[str, Any]:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    text = value if isinstance(value, str) else encoded.decode("utf-8", errors="replace")
    return {
        "content_bytes": len(encoded),
        "content_sha256": hashlib.sha256(encoded).hexdigest(),
        "content_excerpt": text[:2_048],
    }


def _bounded_event_projection(event: Mapping[str, Any]) -> dict[str, Any] | None:
    """Keep lifecycle/tool evidence while dropping provider streaming deltas.

    Pi ``message_update`` events can contain an ever-growing assistant message,
    so retaining every update is quadratic in output size. Terminal messages and
    tool receipts remain available; oversized individual events are replaced by
    a hash-bound outline instead of being silently truncated.
    """

    event_type = str(event.get("type", ""))
    if event_type in {"message_start", "message_update"}:
        return None
    projected = dict(event)
    if _json_size(projected) <= DIAGNOSTIC_EVENT_MAX_ITEM_BYTES:
        return projected
    outline: dict[str, Any] = {"type": event_type, "event_truncated": True,
                               "original_bytes": _json_size(projected)}
    for key in ("toolName", "toolCallId", "isError", "is_error", "error"):
        if key in event:
            outline[key] = event[key]
    message = event.get("message")
    if isinstance(message, Mapping):
        message_outline = {
            key: message[key] for key in ("role", "stopReason", "usage", "errorMessage") if key in message
        }
        if "content" in message:
            message_outline.update(_content_digest(message["content"]))
        outline["message"] = message_outline
    result = event.get("result")
    if result is not None:
        outline["result"] = _content_digest(result)
    messages = event.get("messages")
    if messages is not None:
        outline["messages"] = _content_digest(messages)
    return outline


def _is_terminal_evidence(event: Mapping[str, Any]) -> bool:
    if event.get("type") in {"agent_end", "agent_settled", "tool_execution_end"}:
        return True
    message = event.get("message")
    return event.get("type") == "message_end" and isinstance(message, Mapping) and message.get("role") == "assistant"


@dataclass
class DiagnosticEventJournal:
    """Bounded in-memory and on-disk projection of a native Pi event stream."""

    max_events: int = DIAGNOSTIC_EVENT_MAX_COUNT
    max_bytes: int = DIAGNOSTIC_EVENT_MAX_BYTES
    events: list[dict[str, Any]] = field(default_factory=list)
    _sizes: list[int] = field(default_factory=list, init=False, repr=False)
    _total_bytes: int = field(default=0, init=False, repr=False)
    raw_event_counts: Counter[str] = field(default_factory=Counter)
    raw_event_bytes: int = 0
    dropped_event_counts: Counter[str] = field(default_factory=Counter)
    truncated_events: int = 0
    persisted_bytes: int = 0

    def observe(self, event: Mapping[str, Any]) -> None:
        event_type = str(event.get("type", ""))
        self.raw_event_counts[event_type] += 1
        self.raw_event_bytes += _json_size(event) + 1
        projected = _bounded_event_projection(event)
        if projected is None:
            self.dropped_event_counts[event_type] += 1
            return
        if projected.get("event_truncated") is True:
            self.truncated_events += 1
        size = _json_size(projected) + 1
        terminal = _is_terminal_evidence(projected)
        while self.events and (len(self.events) >= self.max_events or self._total_bytes + size > self.max_bytes):
            removable = next((index for index, item in enumerate(self.events)
                              if not _is_terminal_evidence(item)), 0)
            removed = self.events.pop(removable)
            self._total_bytes -= self._sizes.pop(removable)
            self.dropped_event_counts[str(removed.get("type", ""))] += 1
        if len(self.events) >= self.max_events or self._total_bytes + size > self.max_bytes:
            self.dropped_event_counts[event_type] += 1
            return
        self.events.append(projected)
        self._sizes.append(size)
        self._total_bytes += size

    def write(self, path: Path) -> None:
        with path.open("w", encoding="utf-8") as stream:
            for event in self.events:
                stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.persisted_bytes = path.stat().st_size

    def snapshot(self) -> dict[str, Any]:
        return {
            "raw_event_count": sum(self.raw_event_counts.values()),
            "raw_event_bytes": self.raw_event_bytes,
            "raw_event_counts": dict(sorted(self.raw_event_counts.items())),
            "persisted_event_count": len(self.events),
            "persisted_bytes": self.persisted_bytes or self._total_bytes,
            "dropped_event_count": sum(self.dropped_event_counts.values()),
            "dropped_event_counts": dict(sorted(self.dropped_event_counts.items())),
            "truncated_events": self.truncated_events,
            "max_events": self.max_events,
            "max_bytes": self.max_bytes,
            "max_event_bytes": DIAGNOSTIC_EVENT_MAX_ITEM_BYTES,
        }


@dataclass
class DiagnosticEventBudget:
    """Count native Pi events and identify the first hard-stop condition."""

    max_turns: int = 8
    max_output_tokens: int = 30_000
    max_repairs: int = 2
    max_replacement_versions: int = 1
    turns: int = 0
    output_tokens: int = 0
    failed_calls: int = 0
    initial_failures: int = 0
    repairs: int = 0
    replacement_versions: int = 0
    stop_reason: str | None = None
    _tool_args: dict[str, dict[str, Any]] = field(default_factory=dict, init=False, repr=False)
    _versions: dict[str, set[int]] = field(default_factory=dict, init=False, repr=False)
    _failed_operations: set[str] = field(default_factory=set, init=False, repr=False)

    @staticmethod
    def _output_tokens(message: Mapping[str, Any]) -> int:
        usage = message.get("usage")
        if not isinstance(usage, Mapping):
            return 0
        for key in ("output", "output_tokens"):
            value = usage.get(key)
            if isinstance(value, (int, float)) and value >= 0:
                return int(value)
        return 0

    @staticmethod
    def _failed(event: Mapping[str, Any]) -> bool:
        if event.get("isError") is True or event.get("is_error") is True or event.get("error"):
            return True
        result = event.get("result")
        return isinstance(result, Mapping) and (result.get("isError") is True or result.get("is_error") is True)

    @staticmethod
    def _result_details(event: Mapping[str, Any]) -> Mapping[str, Any]:
        result = event.get("result")
        if isinstance(result, Mapping):
            details = result.get("details")
            if isinstance(details, Mapping):
                return details
            content = result.get("content")
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, Mapping) and isinstance(item.get("text"), str):
                        try:
                            value = json.loads(item["text"])
                        except (TypeError, ValueError):
                            continue
                        if isinstance(value, Mapping):
                            return value
        details = event.get("details")
        return details if isinstance(details, Mapping) else {}

    @staticmethod
    def _invalid_fixture_call(arguments: Mapping[str, Any]) -> bool:
        bindings = arguments.get("bindings")
        return isinstance(bindings, list) and any(
            isinstance(binding, Mapping) and "groups-invalid" in str(binding.get("ref", ""))
            for binding in bindings
        )

    @classmethod
    def _expected_invalid_fixture_failure(cls, event: Mapping[str, Any], arguments: Mapping[str, Any]) -> bool:
        if not cls._invalid_fixture_call(arguments):
            return False
        details = cls._result_details(event)
        return str(details.get("code", "")) == "invalid_input"

    @staticmethod
    def _operation_key(tool_name: str, arguments: Mapping[str, Any]) -> str:
        action = str(arguments.get("action", ""))
        if tool_name == "task_harness" and action == "change":
            changes = arguments.get("changes")
            names: list[str] = []
            if isinstance(changes, list):
                for change in changes:
                    if not isinstance(change, Mapping):
                        continue
                    candidate = change.get("candidate")
                    if isinstance(candidate, Mapping):
                        name = candidate.get("name") or candidate.get("key")
                    else:
                        name = change.get("target_ref")
                    if name:
                        names.append(str(name))
            return f"{tool_name}:{action}:{','.join(names)}"
        name = arguments.get("name") or arguments.get("key")
        return f"{tool_name}:{action}:{name or ''}"

    def _record_versions(self, details: Any, fallback_name: str = "", fallback_version: Any = None) -> None:
        """Record canonical native tool versions from facade receipts.

        Facade receipts contain both ``tool:name@vN`` and nested ``name`` /
        ``version`` fields. The resource reference is canonical; only the
        legacy direct ``task_tool`` path may use the fallback pair.
        """
        found: list[tuple[str, int]] = []

        def visit(value: Any) -> None:
            if isinstance(value, Mapping):
                ref = value.get("resource_ref")
                if isinstance(ref, str):
                    match = re.match(r"^(memory|system_prompt|skill|tool|subagent):(.+)@v(\d+)$", ref)
                    if match:
                        found.append((f"{match.group(1)}:{match.group(2)}", int(match.group(3))))
                for item in value.values():
                    visit(item)
            elif isinstance(value, list):
                for item in value:
                    visit(item)

        visit(details)
        if fallback_name and fallback_version is not None:
            try:
                found.append((fallback_name, int(fallback_version)))
            except (TypeError, ValueError):
                pass
        for name, version in found:
            if version > 0:
                self._versions.setdefault(name, set()).add(version)
        self.replacement_versions = sum(max(0, len(values) - 1) for values in self._versions.values())

    def _check_limits(self) -> None:
        # Stop at the boundary, not after scheduling one extra provider turn.
        # A provider response already in flight may still report usage above
        # the token budget; that overshoot remains visible in raw telemetry.
        if self.turns >= self.max_turns:
            self.stop_reason = self.stop_reason or "max_turns_exceeded"
        elif self.output_tokens >= self.max_output_tokens:
            self.stop_reason = self.stop_reason or "max_output_tokens_exceeded"
        elif self.repairs > self.max_repairs:
            self.stop_reason = self.stop_reason or "max_repairs_exceeded"
        elif self.replacement_versions > self.max_replacement_versions:
            self.stop_reason = self.stop_reason or "max_replacement_versions_exceeded"

    def observe(self, event: Mapping[str, Any]) -> None:
        if event.get("type") == "message_end":
            message = event.get("message")
            if isinstance(message, Mapping) and message.get("role") == "assistant":
                self.turns += 1
                self.output_tokens += self._output_tokens(message)
        tool_call_id = str(event.get("toolCallId", ""))
        event_type = event.get("type")
        if event_type == "tool_execution_start" and tool_call_id:
            arguments = event.get("args")
            self._tool_args[tool_call_id] = dict(arguments) if isinstance(arguments, Mapping) else {}
        elif event_type == "tool_execution_end":
            arguments = dict(self._tool_args.pop(tool_call_id, {}))
            tool_name = str(event.get("toolName", ""))
            relevant = tool_name in {"task_harness", "task_tool"} or tool_name.startswith("task_tool_")
            if relevant:
                expected_invalid = self._expected_invalid_fixture_failure(event, arguments)
                if not expected_invalid:
                    key = self._operation_key(tool_name, arguments)
                    if key in self._failed_operations:
                        # A retry after the first failed attempt is a repair,
                        # regardless of whether this retry succeeds.
                        self.repairs += 1
                    failed = self._failed(event)
                    if failed:
                        self.failed_calls += 1
                        if key not in self._failed_operations:
                            self.initial_failures += 1
                        self._failed_operations.add(key)
                    if not failed:
                        action = str(arguments.get("action", ""))
                        if action in {"create", "update", "change"}:
                            details = self._result_details(event)
                            self._record_versions(
                                details,
                                str(details.get("name") or arguments.get("name") or "")
                                if tool_name == "task_tool" else "",
                                details.get("version") if tool_name == "task_tool" else None,
                            )
        self._check_limits()

    def force_stop(self, reason: str) -> None:
        self.stop_reason = self.stop_reason or reason

    @property
    def exceeded(self) -> bool:
        return self.stop_reason is not None

    def snapshot(self) -> dict[str, Any]:
        return {
            "turns": self.turns,
            "output_tokens": self.output_tokens,
            "failed_calls": self.failed_calls,
            "initial_failures": self.initial_failures,
            "repairs": self.repairs,
            "replacement_versions": self.replacement_versions,
            "max_turns": self.max_turns,
            "max_output_tokens": self.max_output_tokens,
            "output_token_overshoot": max(0, self.output_tokens - self.max_output_tokens),
            "inflight_output_overshoot": self.output_tokens > self.max_output_tokens,
            "max_repairs": self.max_repairs,
            "max_replacement_versions": self.max_replacement_versions,
            "stop_reason": self.stop_reason,
        }


@dataclass(frozen=True)
class DiagnosticReadiness:
    pure_expression_conformance: bool = False
    native_task_tool_integration: bool = False
    resource_binding_provenance: bool = False
    execution_limits_enforced: bool = False
    repair_and_version_limits_enforced: bool = False

    @property
    def ready(self) -> bool:
        return all((
            self.pure_expression_conformance,
            self.native_task_tool_integration,
            self.resource_binding_provenance,
            self.execution_limits_enforced,
            self.repair_and_version_limits_enforced,
        ))

    @property
    def blocking_reasons(self) -> tuple[str, ...]:
        checks = (
            (self.pure_expression_conformance, "pure-expression conformance is not green"),
            (self.native_task_tool_integration, "native task_tool integration is not green"),
            (self.resource_binding_provenance, "resource binding/provenance checks are not green"),
            (self.execution_limits_enforced, "total-turn/output-token/wall-deadline controls are not enforced"),
            (self.repair_and_version_limits_enforced, "repair/replacement-version controls are not enforced"),
        )
        return tuple(reason for passed, reason in checks if not passed)

    def require(self) -> None:
        if not self.ready:
            raise DiagnosticReadinessBlocked("provider phase blocked: " + "; ".join(self.blocking_reasons))


@dataclass(frozen=True)
class DiagnosticConfig:
    root: Path
    provider: str
    model: str
    project_root: Path = PROJECT_ROOT
    command: tuple[str, ...] = ("pi", "--mode", "rpc")
    provider_extension: Path | None = None
    operation_timeout_seconds: float = 30.0
    total_wall_seconds: float = 180.0
    max_turns: int = 8
    max_output_tokens: int = 30_000
    max_repairs: int = 2
    max_replacement_versions: int = 1


def _root_scope(root: Path) -> tuple[str, str]:
    absolute = root.resolve()
    fingerprint = hashlib.sha256(str(absolute).encode("utf-8")).hexdigest()[:16]
    task_id = os.environ.get("PI_AUTORESEARCH_TASK_ID") or f"root-{fingerprint}"
    return task_id, fingerprint


def _ensure_scope_marker(root: Path) -> tuple[str, str]:
    root.mkdir(parents=True, exist_ok=True)
    task_id, fingerprint = _root_scope(root)
    marker = root / ".task-scope.json"
    if marker.exists():
        value = json.loads(marker.read_text(encoding="utf-8"))
        if value.get("task_id") != task_id or value.get("root_fingerprint") != fingerprint:
            raise ValueError("diagnostic root has a mismatched task scope")
    else:
        marker.write_text(json.dumps({
            "format": "task-local-scope-v1",
            "task_id": task_id,
            "root": str(root.resolve()),
            "root_fingerprint": fingerprint,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }) + "\n", encoding="utf-8")
    return task_id, fingerprint


def prepare_diagnostic_resources(root: Path, fixture_root: Path = FIXTURE_ROOT) -> list[dict[str, Any]]:
    """Publish fixture data as exact task-local observation records.

    This is resource preparation, not semantic execution. Existing records
    with the same exact ref must have the same fixture hash; conflicting data
    aborts rather than overwriting a task-local history.
    """

    task_id, fingerprint = _ensure_scope_marker(root)
    path = root / RESOURCE_FILE
    existing: dict[str, dict[str, Any]] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            ref = row.get("resource_ref")
            if isinstance(ref, str):
                existing[ref] = row

    handles: list[dict[str, Any]] = []
    additions: list[str] = []
    for name in ("normal", "contrast", "invalid"):
        resource = load_resource(fixture_root / f"{name}.json")
        ref = str(resource["resource_ref"])
        digest = resource_hash(resource)
        record = {
            "format": "task-diagnostic-resource-v1",
            "observation_id": ref.split(":", 1)[1].rsplit("@", 1)[0],
            "version": 1,
            "status": "recorded",
            "summary": "Domain-neutral restricted-expression diagnostic resource.",
            "result": {"groups": resource["groups"]},
            "resource_ref": ref,
            "content_sha256": digest,
            "task_id": task_id,
            "task_root_fingerprint": fingerprint,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
        }
        previous = existing.get(ref)
        if previous is not None:
            if previous.get("content_sha256") != digest or previous.get("result") != record["result"]:
                raise ValueError(f"conflicting existing diagnostic resource: {ref}")
        else:
            additions.append(json.dumps(record, ensure_ascii=False) + "\n")
        handles.append({"name": name, "ref": ref, "path": ["result"], "sha256": digest})
    if additions:
        with path.open("a", encoding="utf-8") as stream:
            stream.writelines(additions)
    return handles


def build_provider_prompt(resources: Sequence[Mapping[str, Any]]) -> str:
    """Build the provider task without oracle output or an authored AST."""

    resource_lines = "\n".join(
        f"- {item['name']}: bind exact resource {item['ref']} at path {json.dumps(item['path'])}; "
        f"fixture hash {item['sha256']}"
        for item in resources
    )
    return f"""Author one pure JSON transformation through the current tool-creator contract.

Each input has groups. Each group has a numeric rule.minimum and records. A
record qualifies only when active is true and a nested measurement.value is
greater than or equal to that group's minimum. Preserve every record in order,
but retain only qualifying measurements in order. Preserve inactive records by
identity with measurements=[], and exclude them from both qualifying counts.
Emit each group id, transformed records, qualifying_record_count, and
qualifying_measurement_count. Do not mutate input; thresholds and collection
lengths are data, not constants.

Use these exact input/output schemas in the authored Tool and bind inputs by
the native parameters/bindings interface. These are the only versioned task
resources for this diagnostic:
{resource_lines}

Input schema:
{json.dumps(DIAGNOSTIC_INPUT_SCHEMA, ensure_ascii=False, sort_keys=True)}

Output schema:
{json.dumps(DIAGNOSTIC_OUTPUT_SCHEMA, ensure_ascii=False, sort_keys=True)}

Run the normal and contrast resources, inspect their semantic outputs, then run
the invalid resource and report its structured input error. Keep the authored
program pure and within the disclosed runtime limits; do not use filesystem,
network, process, bridge, child, clock, randomness, or hidden state access.
"""


def build_pi_command(
    config: DiagnosticConfig,
    bootstrap: Path = BOOTSTRAP,
    provider_extension: Path | None = None,
) -> list[str]:
    """Return the Pi RPC command with only the diagnostic bootstrap extension."""

    command = list(config.command)
    command.extend([
        "--provider", config.provider,
        "--model", config.model,
        "--no-session", "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
        "--extension", str(bootstrap.resolve()),
    ])
    extension = provider_extension or config.provider_extension
    if extension is not None:
        command.extend(["--extension", str(extension.resolve())])
    return command


def _prepare_run_local_provider_registry(config: DiagnosticConfig, env: dict[str, str]) -> str | None:
    """Materialize an isolated yibu registry from the existing project dotenv."""

    if config.provider != "yibu":
        return None
    source = load_project_dotenv(config.project_root)
    base_url = source.get("OPENAI_API_BASE")
    api_key = source.get("OPENAI_API_KEY")
    if not base_url or not api_key:
        raise RuntimeError("yibu diagnostic requires OPENAI_API_BASE and OPENAI_API_KEY from the existing project environment")
    agent_dir = (config.root / ".pi-agent").resolve()
    agent_dir.mkdir(parents=True, exist_ok=True)
    registry = {
        "providers": {"yibu": {
            "baseUrl": base_url,
            "api": "openai-completions",
            "apiKey": "$OPENAI_API_KEY",
            "authHeader": True,
            "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False},
            "models": [{
                "id": config.model, "name": config.model, "reasoning": True,
                "input": ["text"], "contextWindow": 128000, "maxTokens": 8192,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            }],
        }},
    }
    (agent_dir / "models.json").write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env["PI_CODING_AGENT_DIR"] = str(agent_dir)
    env["OPENAI_API_BASE"] = base_url
    env["OPENAI_API_KEY"] = api_key
    return "project .env -> run-local .pi-agent/models.json"


def _write_run_manifest(config: DiagnosticConfig, registry_source: str | None) -> None:
    files = [Path(__file__), BOOTSTRAP]
    extension = config.provider_extension
    if extension is not None:
        files.append(extension)
    source_hashes = {
        str(path.resolve().relative_to(config.project_root.resolve())): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in files if path.is_file()
    }
    (config.root / "diagnostic-run-manifest.json").write_text(json.dumps({
        "format": "restricted-expression-diagnostic-manifest-v1",
        "provider": config.provider, "model": config.model,
        "limits": {
            "total_wall_seconds": config.total_wall_seconds,
            "max_turns": config.max_turns, "max_output_tokens": config.max_output_tokens,
            "max_repairs": config.max_repairs,
            "max_replacement_versions": config.max_replacement_versions,
        },
        "registry_source": registry_source,
        "source_sha256": source_hashes,
        "oracle_transmitted_to_provider": False,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_oracle_baseline(config: DiagnosticConfig) -> None:
    """Persist runner-only expected semantics without exposing them to Pi."""

    fixture_root = config.project_root / "tests" / "fixtures" / "restricted_expression_diagnostic"
    normal = load_resource(fixture_root / "normal.json")
    contrast = load_resource(fixture_root / "contrast.json")
    invalid = load_resource(fixture_root / "invalid.json")
    (config.root / "oracle-baseline.json").write_text(json.dumps({
        "format": "restricted-expression-diagnostic-oracle-baseline-v1",
        "oracle_transmitted_to_provider": False,
        "normal": {"resource_ref": normal["resource_ref"], "expected": expected_output(normal)},
        "contrast": {"resource_ref": contrast["resource_ref"], "expected": expected_output(contrast)},
        "invalid": {
            "resource_ref": invalid["resource_ref"],
            "expected_paths": expected_invalid_paths(invalid),
            "provider_error_observed": False,
        },
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _assistant_stop_reason(events: Sequence[Mapping[str, Any]]) -> str | None:
    for event in reversed(events):
        if event.get("type") != "message_end":
            continue
        message = event.get("message")
        if isinstance(message, Mapping) and message.get("role") == "assistant":
            reason = message.get("stopReason")
            return str(reason) if reason is not None else None
    return None


def _settled_terminal_evidence(events: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    retained = [dict(event) for event in events if _is_terminal_evidence(event)]
    return retained[-64:]


def run_diagnostic(
    config: DiagnosticConfig,
    readiness: DiagnosticReadiness,
    *,
    prompt: str | None = None,
) -> dict[str, Any]:
    """Run the native Pi diagnostic only after all readiness checks pass."""

    readiness.require()
    resources = prepare_diagnostic_resources(config.root, config.project_root / "tests" / "fixtures" / "restricted_expression_diagnostic")
    _write_oracle_baseline(config)
    diagnostic_prompt = prompt or build_provider_prompt(resources)
    journal = DiagnosticEventJournal()
    budget = DiagnosticEventBudget(
        max_turns=config.max_turns,
        max_output_tokens=config.max_output_tokens,
        max_repairs=config.max_repairs,
        max_replacement_versions=config.max_replacement_versions,
    )
    abort_requested = threading.Event()
    monitor_done = threading.Event()
    env = {
        "PI_AUTORESEARCH_E2E_ROOT": str(config.root.resolve()),
        "PI_AUTORESEARCH_ROOT": str(config.project_root.resolve()),
        "PI_AUTORESEARCH_VARIANT": "restricted-expression-diagnostic",
        "PI_AUTORESEARCH_SCOPED_READ": "enabled",
        "PI_DIAGNOSTIC_MAX_TURNS": str(config.max_turns),
        "PI_DIAGNOSTIC_MAX_OUTPUT_TOKENS": str(config.max_output_tokens),
        "PI_DIAGNOSTIC_DEADLINE_MS": str(int((time.time() + config.total_wall_seconds) * 1000)),
    }
    registry_source = _prepare_run_local_provider_registry(config, env)
    _write_run_manifest(config, registry_source)

    def on_event(event: dict[str, Any]) -> None:
        # Budgeting sees the unmodified native event. The PiKernel projector
        # independently prevents streaming deltas from accumulating in its own
        # event log and wait result.
        journal.observe(event)
        budget.observe(event)
        if budget.exceeded:
            abort_requested.set()

    def monitor(kernel: PiKernel, deadline: float) -> None:
        while not monitor_done.wait(0.01):
            if time.monotonic() >= deadline:
                budget.force_stop("total_wall_deadline_exceeded")
                abort_requested.set()
            if abort_requested.is_set():
                try:
                    kernel.abort()
                except (RuntimeError, OSError, TimeoutError):
                    pass
                return

    # The readiness gate is intentionally stricter than this wiring skeleton:
    # event-level turn/output/repair counters still need native acceptance
    # evidence before a real provider can be admitted. Once green, PiKernel's
    # monotonic deadline bounds the complete prompt+wait session.
    deadline = time.monotonic() + config.total_wall_seconds
    with PiKernel(
        build_pi_command(config), cwd=str(config.root), env=env,
        timeout=config.operation_timeout_seconds, deadline=deadline,
        event_sink=on_event, event_projector=_bounded_event_projection,
    ) as kernel:
        watchdog = threading.Thread(target=monitor, args=(kernel, deadline), daemon=True)
        watchdog.start()
        settled: list[dict[str, Any]] = []
        continuation_attempts = 0
        continuation_receipts: list[dict[str, Any]] = []
        final_stop_reason: str | None = None
        error: str | None = None
        fatal_error: RuntimeError | TimeoutError | None = None
        try:
            kernel.prompt(diagnostic_prompt)
            while True:
                turn_events = kernel.wait_for_agent_events(timeout=max(0.0, deadline - time.monotonic()))
                settled = _settled_terminal_evidence(turn_events)
                final_stop_reason = _assistant_stop_reason(turn_events)
                if final_stop_reason != "length":
                    break
                remaining_wall = max(0.0, deadline - time.monotonic())
                receipt = {
                    "stop_reason": "length",
                    "continued": False,
                    "remaining_wall_seconds": remaining_wall,
                    "remaining_turns": max(0, config.max_turns - budget.turns),
                    "remaining_output_tokens": max(0, config.max_output_tokens - budget.output_tokens),
                    "budget": budget.snapshot(),
                }
                if remaining_wall <= 0 and not budget.exceeded:
                    budget.force_stop("total_wall_deadline_exceeded")
                    receipt["budget"] = budget.snapshot()
                if budget.exceeded:
                    continuation_receipts.append(receipt)
                    break
                # ``agent_settled`` means follow_up would only queue work. A
                # new prompt starts the next loop while retaining this exact Pi
                # session and transcript. No AST, oracle value, or solution hint
                # is injected by the runner.
                response = kernel.prompt(DIAGNOSTIC_CONTINUATION_PROMPT)
                if response.get("success") is False:
                    error = "Pi rejected the bounded length continuation prompt"
                    receipt["error"] = error
                    continuation_receipts.append(receipt)
                    break
                continuation_attempts += 1
                receipt["continued"] = True
                receipt["attempt"] = continuation_attempts
                continuation_receipts.append(receipt)
        except (RuntimeError, TimeoutError) as exc:
            error = str(exc)
            if budget.stop_reason is None:
                fatal_error = exc
        finally:
            monitor_done.set()
            watchdog.join(timeout=2.0)
    event_path = config.root / "diagnostic-events.jsonl"
    journal.write(event_path)
    report = {
        "format": "restricted-expression-diagnostic-run-v1",
        "resources": resources,
        "events": journal.events,
        "settled": settled,
        "error": error,
        "aborted": budget.exceeded,
        "budget": budget.snapshot(),
        "provider_usage_is_measurement": True,
        "oracle_transmitted_to_provider": False,
        "execution_limits_enforced": readiness.execution_limits_enforced,
        "repair_and_version_limits_enforced": readiness.repair_and_version_limits_enforced,
        "total_wall_seconds": config.total_wall_seconds,
        "max_turns": config.max_turns,
        "max_output_tokens": config.max_output_tokens,
        "max_repairs": config.max_repairs,
        "max_replacement_versions": config.max_replacement_versions,
        "registry_source": registry_source,
        "continuation": {
            "attempts": continuation_attempts,
            "final_stop_reason": final_stop_reason,
            "receipts": continuation_receipts,
            "same_pi_session": True,
        },
        "event_journal": journal.snapshot(),
        "artifacts": {"events": str(event_path.resolve())},
    }
    summary_path = config.root / "diagnostic-run-summary.json"
    report["artifacts"]["summary"] = str(summary_path.resolve())
    summary_path.write_text(json.dumps(diagnostic_cli_summary(report), ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
    if fatal_error is not None:
        raise fatal_error
    return report


def diagnostic_cli_summary(report: Mapping[str, Any]) -> dict[str, Any]:
    """Return a compact CLI-safe summary without replaying native event bodies."""

    budget = report.get("budget") if isinstance(report.get("budget"), Mapping) else {}
    continuation = report.get("continuation") if isinstance(report.get("continuation"), Mapping) else {}
    error = report.get("error")
    final_reason = continuation.get("final_stop_reason")
    if error:
        status = "error"
    elif budget.get("stop_reason"):
        status = "stopped"
    elif final_reason == "length":
        status = "incomplete"
    else:
        status = "completed"
    resources = report.get("resources")
    refs = [str(item.get("ref")) for item in resources
            if isinstance(item, Mapping) and item.get("ref")] if isinstance(resources, Sequence) else []
    return {
        "format": "restricted-expression-diagnostic-cli-summary-v1",
        "status": status,
        "error": error,
        "aborted": bool(report.get("aborted")),
        "resource_refs": refs,
        "budget": dict(budget),
        "continuation": dict(continuation),
        "event_journal": dict(report.get("event_journal", {}))
            if isinstance(report.get("event_journal"), Mapping) else {},
        "artifacts": dict(report.get("artifacts", {}))
            if isinstance(report.get("artifacts"), Mapping) else {},
        "provider_usage_is_measurement": bool(report.get("provider_usage_is_measurement")),
        "oracle_transmitted_to_provider": bool(report.get("oracle_transmitted_to_provider")),
    }


def run_creator_discovery_smoke(config: DiagnosticConfig, provider_extension: Path) -> dict[str, Any]:
    """Start native Pi with the thin bootstrap and read only tool-creator.

    This deterministic native smoke is a wiring check, not the diagnostic
    provider phase. It supplies no AST, fixture answer, or pre-created Tool.
    """

    resources: list[dict[str, Any]] = []
    prompt = (
        "Use task_harness(action=read_method, method_name=tool-creator) once. "
        "Return the exact creator reference and stop; do not create or invoke a Tool."
    )
    events: list[dict[str, Any]] = []
    # The scripted provider needs one turn for creator discovery and one
    # terminal turn after the tool result; leave one bounded turn of headroom
    # so the normal terminal response does not itself mark the smoke aborted.
    budget = DiagnosticEventBudget(max_turns=3, max_output_tokens=2_000, max_repairs=0, max_replacement_versions=0)
    deadline = time.monotonic() + config.total_wall_seconds
    env = {
        "PI_AUTORESEARCH_E2E_ROOT": str(config.root.resolve()),
        "PI_AUTORESEARCH_ROOT": str(config.project_root.resolve()),
        "PI_AUTORESEARCH_VARIANT": "restricted-expression-diagnostic-smoke",
    }
    with PiKernel(
        build_pi_command(config, provider_extension=provider_extension),
        cwd=str(config.root), env=env,
        timeout=config.operation_timeout_seconds, deadline=deadline,
        event_sink=lambda event: (events.append(event), budget.observe(event)),
    ) as kernel:
        kernel.prompt(prompt)
        settled = kernel.wait_for_agent_events(timeout=max(0.0, deadline - time.monotonic()))
    return {
        "format": "restricted-expression-diagnostic-creator-smoke-v1",
        "resources": resources,
        "events": events,
        "settled": settled,
        "budget": budget.snapshot(),
        "oracle_transmitted_to_provider": False,
    }


__all__ = [
    "DiagnosticConfig", "DiagnosticReadiness", "DiagnosticReadinessBlocked",
    "BOOTSTRAP", "DIAGNOSTIC_INPUT_SCHEMA", "DIAGNOSTIC_OUTPUT_SCHEMA", "FIXTURE_ROOT",
    "DiagnosticEventBudget", "build_pi_command", "build_provider_prompt",
    "DiagnosticEventJournal", "diagnostic_cli_summary",
    "prepare_diagnostic_resources", "run_diagnostic",
    "run_creator_discovery_smoke",
]


def _diagnostic_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        allow_abbrev=False,
        description="Run the restricted-expression diagnostic only through explicit gates."
    )
    parser.add_argument("--root", type=Path, help="Task-local root for resources and native run output.")
    parser.add_argument("--project-root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--provider", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--provider-extension", type=Path)
    # Keep Pi's own flags (for example ``--mode rpc``) opaque to argparse;
    # this option must be the final diagnostic CLI option on invocation.
    parser.add_argument("--pi-command", nargs=argparse.REMAINDER, default=["pi", "--mode", "rpc"])
    parser.add_argument("--prepare-resources", action="store_true")
    parser.add_argument("--creator-smoke", action="store_true")
    parser.add_argument(
        "--run-provider",
        action="store_true",
        help="Explicitly admit the provider phase after all five readiness flags.",
    )
    for name, help_text in (
        ("pure-expression-conformance", "Pure-expression conformance acceptance is green."),
        ("native-task-tool-integration", "Native task_tool integration acceptance is green."),
        ("resource-binding-provenance", "Resource binding/provenance acceptance is green."),
        ("execution-limits-enforced", "Turn/output-token/wall controls are natively enforced."),
        ("repair-and-version-limits-enforced", "Repair/version controls are natively enforced."),
    ):
        parser.add_argument(f"--ready-{name}", action="store_true", help=help_text)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Safe command-line entry point for diagnostics.

    With no explicit operation the command only reports the readiness gate. A
    creator smoke is deterministic and still requires an explicit provider
    extension. The provider phase additionally requires ``--run-provider`` and
    all five readiness flags, so invoking this module cannot accidentally start
    a real provider.
    """

    args = _diagnostic_cli_parser().parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    readiness = DiagnosticReadiness(
        pure_expression_conformance=args.ready_pure_expression_conformance,
        native_task_tool_integration=args.ready_native_task_tool_integration,
        resource_binding_provenance=args.ready_resource_binding_provenance,
        execution_limits_enforced=args.ready_execution_limits_enforced,
        repair_and_version_limits_enforced=args.ready_repair_and_version_limits_enforced,
    )
    if not (args.prepare_resources or args.creator_smoke or args.run_provider):
        print(json.dumps({
            "format": "restricted-expression-diagnostic-cli-v1",
            "status": "blocked",
            "reasons": readiness.blocking_reasons,
            "hint": "Choose --prepare-resources, --creator-smoke, or explicitly gated --run-provider.",
        }, ensure_ascii=False))
        return 2
    if args.root is None:
        print(json.dumps({"status": "error", "error": "--root is required for an operation."}))
        return 2
    if (args.creator_smoke or args.run_provider) and (not args.provider or not args.model):
        print(json.dumps({"status": "error", "error": "--provider and --model are required."}))
        return 2
    config = DiagnosticConfig(
        root=args.root,
        project_root=args.project_root,
        provider=args.provider,
        model=args.model,
        command=tuple(args.pi_command),
        provider_extension=args.provider_extension,
    )
    if args.prepare_resources:
        print(json.dumps({"status": "prepared", "resources": prepare_diagnostic_resources(
            args.root, args.project_root / "tests" / "fixtures" / "restricted_expression_diagnostic"
        )}, ensure_ascii=False))
    if args.creator_smoke:
        if args.provider_extension is None:
            print(json.dumps({"status": "error", "error": "--creator-smoke requires --provider-extension."}))
            return 2
        print(json.dumps(run_creator_discovery_smoke(config, args.provider_extension), ensure_ascii=False))
    if args.run_provider:
        try:
            result = run_diagnostic(config, readiness)
        except DiagnosticReadinessBlocked as exc:
            print(json.dumps({"status": "blocked", "error": str(exc)}, ensure_ascii=False))
            return 2
        print(json.dumps(diagnostic_cli_summary(result), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
