"""Runner-side oracle for the domain-neutral restricted-expression diagnostic.

This module is deliberately not imported by the provider-facing Tool or its
execution path. It supplies an independent semantic reference and structured
error checks to the eventual runner.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any


_MISSING = object()
_ERROR_CODES = frozenset({"invalid_input", "type_error", "missing_field"})


def load_resource(path: str | Path) -> dict[str, Any]:
    """Load one JSON fixture and require its versioned resource envelope."""
    resource = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(resource, dict):
        raise ValueError("resource must be a JSON object")
    validate_resource_envelope(resource)
    return resource


def validate_resource_envelope(resource: dict[str, Any]) -> None:
    if not isinstance(resource.get("resource_ref"), str) or not resource["resource_ref"].endswith("@v1"):
        raise ValueError("resource_ref must be an exact @v1 reference")
    if resource.get("version") != 1:
        raise ValueError("resource version must be 1")
    if not isinstance(resource.get("groups"), list):
        raise ValueError("groups must be an array")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def resource_hash(resource: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(resource).encode("utf-8")).hexdigest()


def _number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, float):
        return math.isfinite(value)
    return isinstance(value, int)


def expected_output(resource: dict[str, Any]) -> dict[str, Any]:
    """Compute the independent expected output from the diagnostic contract."""
    output_groups: list[dict[str, Any]] = []
    for group_index, group in enumerate(resource["groups"]):
        if not isinstance(group, dict):
            raise ValueError(f"$.groups[{group_index}] must be an object")
        try:
            minimum = group["rule"]["minimum"]
        except (KeyError, TypeError):
            raise ValueError(f"$.groups[{group_index}].rule.minimum is required") from None
        if not _number(minimum):
            raise ValueError(f"$.groups[{group_index}].rule.minimum must be numeric")
        records = group.get("records")
        if not isinstance(records, list):
            raise ValueError(f"$.groups[{group_index}].records must be an array")

        qualifying_records = 0
        qualifying_measurements = 0
        transformed_records: list[dict[str, Any]] = []
        for record_index, record in enumerate(records):
            if not isinstance(record, dict):
                raise ValueError(f"$.groups[{group_index}].records[{record_index}] must be an object")
            measurements = record.get("measurements")
            if not isinstance(measurements, list):
                raise ValueError(
                    f"$.groups[{group_index}].records[{record_index}].measurements must be an array"
                )
            kept: list[Any] = []
            if record.get("active") is True:
                for measurement in measurements:
                    if not isinstance(measurement, dict) or not _number(measurement.get("value")):
                        raise ValueError(
                            f"$.groups[{group_index}].records[{record_index}].measurements contains a nonnumeric value"
                        )
                    if measurement["value"] >= minimum:
                        kept.append(measurement)
            transformed = dict(record)
            transformed["measurements"] = kept
            transformed_records.append(transformed)
            if kept:
                qualifying_records += 1
                qualifying_measurements += len(kept)

        output_groups.append({
            "id": group.get("id"),
            "records": transformed_records,
            "qualifying_record_count": qualifying_records,
            "qualifying_measurement_count": qualifying_measurements,
        })
    return {"groups": output_groups}


def _first_difference(expected: Any, actual: Any, path: str = "$") -> dict[str, Any] | None:
    if expected is _MISSING or actual is _MISSING:
        return {"path": path, "expected": None if expected is _MISSING else expected,
                "actual": None if actual is _MISSING else actual}
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in expected:
            difference = _first_difference(expected[key], actual.get(key, _MISSING), f"{path}.{key}")
            if difference:
                return difference
        for key in actual:
            if key not in expected:
                return {"path": f"{path}.{key}", "expected": None, "actual": actual[key]}
        return None
    if isinstance(expected, list) and isinstance(actual, list):
        for index in range(max(len(expected), len(actual))):
            difference = _first_difference(
                expected[index] if index < len(expected) else _MISSING,
                actual[index] if index < len(actual) else _MISSING,
                f"{path}[{index}]",
            )
            if difference:
                return difference
        return None
    if type(expected) is not type(actual) and not (_number(expected) and _number(actual)):
        return {"path": path, "expected": expected, "actual": actual}
    if expected != actual:
        return {"path": path, "expected": expected, "actual": actual}
    return None


def inspect_output(resource: dict[str, Any], actual: Any) -> dict[str, Any]:
    """Return a semantic pass/fail record for a provider Tool result."""
    expected = expected_output(resource)
    difference = _first_difference(expected, actual)
    return {"ok": difference is None, "expected": expected, "actual": actual, "difference": difference}


def expected_invalid_paths(resource: dict[str, Any]) -> tuple[str, ...]:
    """Return the intentionally malformed paths in the invalid fixture."""
    paths: list[str] = []
    for group_index, group in enumerate(resource["groups"]):
        if not isinstance(group.get("rule"), dict) or "minimum" not in group["rule"]:
            paths.append(f"$.groups[{group_index}].rule.minimum")
        for record_index, record in enumerate(group.get("records", [])):
            if not isinstance(record.get("measurements"), list):
                paths.append(f"$.groups[{group_index}].records[{record_index}].measurements")
    return tuple(paths)


def inspect_invalid_error(resource: dict[str, Any], error: Any) -> dict[str, Any]:
    """Validate a structured input failure without accepting partial success.

    ``path`` is the runner's canonical normalized path. A future transport
    adapter may preserve a raw path separately and map it explicitly; this
    oracle does not silently guess such mappings.
    """
    paths = expected_invalid_paths(resource)
    issues: list[str] = []
    if not isinstance(error, dict):
        issues.append("error must be an object")
        return {"ok": False, "issues": issues, "expected_paths": paths}
    if error.get("code") not in _ERROR_CODES:
        issues.append("error code must describe malformed input")
    if error.get("path") not in paths:
        issues.append("error path must identify an intentional malformed field")
    success_payload_keys = ("partial_result", "result", "value", "output")
    if (
        error.get("ok") is True
        or error.get("success") is True
        or str(error.get("status", "")).lower() == "completed"
        or any(key in error for key in success_payload_keys)
    ):
        issues.append("invalid input must not include a successful or partial result")
    return {"ok": not issues, "issues": issues, "expected_paths": paths, "error": error}
