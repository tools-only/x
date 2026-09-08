"""One-call bridge from a Pi extension to JIT's OfficeBench action tool."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


_PATH_ARGUMENT_NAMES = {
    "file",
    "file_path",
    "input_file",
    "output_file",
}


def _boundary_error(reason: str) -> dict[str, Any]:
    return {
        "text": (
            "Error: task resource boundary violation. "
            f"{reason} Use relative paths inside the current testbed; use workspace_file_action for "
            "bounded listing/text reads and a direct OfficeBench document action for binary files."
        ),
        "outcome": "semantic_error",
        "error_kind": "task_resource_boundary_violation",
    }


def _relative_testbed_path(raw_value: str) -> str | None:
    """Convert documented /testbed aliases to a relative path, rejecting other roots."""
    normalized = raw_value.strip().replace("\\", "/")
    aliases = ("/workspace/testbed", "./workspace/testbed", "workspace/testbed", "/testbed", "./testbed", "testbed")
    for alias in aliases:
        if normalized == alias:
            return "."
        if normalized.startswith(alias + "/"):
            return normalized[len(alias) + 1 :]
    if normalized.startswith(("/", "//")) or re.match(r"^[A-Za-z]:", normalized):
        return None
    return normalized


def _path_stays_in_testbed(testbed: Path, raw_value: str) -> bool:
    relative = _relative_testbed_path(raw_value)
    if relative is None or "\x00" in relative:
        return False
    try:
        (testbed / relative).resolve().relative_to(testbed.resolve())
    except (OSError, ValueError):
        return False
    return True


def _safe_filename_component(value: object) -> bool:
    if not isinstance(value, str) or "\x00" in value or "/" in value or "\\" in value:
        return False
    return value not in {".", ".."}


def apply_task_resource_boundary(
    workspace: str | os.PathLike[str], action: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Validate one backend request against the current-testbed resource boundary.

    Arbitrary shell programs cannot be confined by lexical path checks, so this broker
    intentionally rejects broad shell execution. The Pi extension supplies a bounded
    workspace file tool for the legitimate listing and text-read use cases.
    """
    candidate = {
        "app": str(action.get("app", "")),
        "action": str(action.get("action", "")),
        "args": dict(action.get("args") or {}),
    }
    app = candidate["app"]
    operation = candidate["action"]
    args = candidate["args"]
    if app == "shell":
        return candidate, _boundary_error(
            "Broad shell execution is unavailable because child processes can address resources outside "
            "the current testbed even when the command text appears relative."
        )

    testbed = Path(workspace).resolve() / "testbed"
    for key, value in args.items():
        if not isinstance(value, str):
            continue
        if key.endswith("_path") or key in _PATH_ARGUMENT_NAMES:
            if not _path_stays_in_testbed(testbed, value):
                return candidate, _boundary_error(f"Argument {key!r} addresses a resource outside the current testbed.")

    component_fields: tuple[str, ...] = ()
    if app == "calendar":
        component_fields = ("user",) if operation in {"create_event", "delete_event"} else ("username",)
    elif app == "email":
        component_fields = {
            "send_email": ("sender", "recipient", "subject"),
            "list_emails": ("username",),
            "read_email": ("username", "email_id"),
        }.get(operation, ())
    for key in component_fields:
        if key in args and not _safe_filename_component(args[key]):
            return candidate, _boundary_error(f"Argument {key!r} is not a safe single path component.")
    return candidate, None


def classify_officebench_result(text: str) -> tuple[str, str | None]:
    """Classify strong backend failure signals without guessing from ordinary output."""
    normalized = text.strip()
    lowered = normalized.lower()
    normalized_lines = {
        line.strip().lower().rstrip(".。")
        for line in normalized.splitlines()
        if line.strip()
    }
    if lowered.startswith("error: unknown officebench action"):
        return "semantic_error", "unknown_action"
    if lowered.startswith("failed to ") or lowered.startswith("observation: failed to "):
        return "semantic_error", "action_failed"
    if lowered.startswith("error:") or lowered.startswith("error executing "):
        return "semantic_error", "action_error"
    exact_shell_errors = {
        "系统找不到指定的路径",
        "系统找不到指定的文件",
        "the system cannot find the path specified",
        "the system cannot find the file specified",
    }
    if normalized_lines & exact_shell_errors:
        return "semantic_error", "shell_command_error"
    if any(line.startswith("argument expected for the -c option") for line in normalized_lines):
        return "semantic_error", "shell_command_error"
    if any(line.startswith("traceback (most recent call last)") for line in normalized_lines):
        return "semantic_error", "shell_command_error"
    shell_error = re.search(
        r"(?im)^(?:[^\r\n:]+:\s*)?(?:unknown option|command not found|no such file or directory)\b"
        r"|^.+? is not recognized as an internal or external command\b",
        normalized,
    )
    if shell_error:
        return "semantic_error", "shell_command_error"
    return "success", None


def main() -> int:
    payload = json.loads(sys.stdin.read())
    from scripts.tools.officebench_tools import OfficeBenchActionTool

    tool = OfficeBenchActionTool()
    tool.set_workspace(str(payload["workspace"]))
    actions = payload.get("actions")
    if actions is None:
        actions = [{
            "app": payload["app"],
            "action": payload["action"],
            "args": payload.get("args") or {},
        }]
        is_batch = False
    elif not isinstance(actions, list) or not actions:
        raise ValueError("actions must be a non-empty list")
    else:
        is_batch = True

    results = []
    for action in actions:
        bounded_action, boundary_error = apply_task_resource_boundary(payload["workspace"], action)
        if boundary_error is not None:
            results.append(boundary_error)
            continue
        result = str(tool.forward(
            app=bounded_action["app"],
            action=bounded_action["action"],
            args=bounded_action["args"],
        ))
        outcome, error_kind = classify_officebench_result(result)
        results.append({"text": result, "outcome": outcome, "error_kind": error_kind})
    response = {"batch": True, "results": results} if is_batch else results[0]
    sys.stdout.write(json.dumps(response, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
