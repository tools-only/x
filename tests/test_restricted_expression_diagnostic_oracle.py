import copy
import json
from pathlib import Path

import pytest

from tools.restricted_expression_diagnostic_oracle import (
    expected_invalid_paths,
    expected_output,
    inspect_invalid_error,
    inspect_output,
    load_resource,
    resource_hash,
)


FIXTURES = Path(__file__).parent / "fixtures" / "restricted_expression_diagnostic"


def fixture(name):
    return load_resource(FIXTURES / f"{name}.json")


def test_normal_oracle_preserves_record_identity_and_suppresses_inactive_measurements():
    resource = fixture("normal")
    expected = expected_output(resource)
    low = expected["groups"][0]
    inactive = next(record for record in low["records"] if record["id"] == "record-inactive")

    assert [record["id"] for record in low["records"]] == [
        "record-low-match", "record-inactive", "record-low-empty"
    ]
    assert inactive["measurements"] == []
    assert low["qualifying_record_count"] == 1
    assert low["qualifying_measurement_count"] == 2
    assert expected["groups"][1]["qualifying_measurement_count"] == 2


def test_normal_expected_output_is_semantic_not_an_echo():
    resource = fixture("normal")
    report = inspect_output(resource, resource)

    assert report["ok"] is False
    assert report["difference"]["path"].startswith("$.groups")


def test_contrast_uses_changed_thresholds_and_input_order():
    resource = fixture("contrast")
    expected = expected_output(resource)
    low = expected["groups"][0]
    high = expected["groups"][1]

    assert [record["id"] for record in low["records"]] == [
        "record-low-empty", "record-inactive", "record-low-match"
    ]
    assert low["qualifying_record_count"] == 0
    assert low["qualifying_measurement_count"] == 0
    assert high["qualifying_record_count"] == 1
    assert high["records"][1]["measurements"][0]["id"] == "measurement-80"
    assert expected_output(fixture("normal")) != expected


def test_invalid_oracle_requires_structured_path_and_rejects_partial_success():
    resource = fixture("invalid")
    paths = expected_invalid_paths(resource)
    assert paths == (
        "$.groups[0].records[0].measurements",
        "$.groups[1].rule.minimum",
    )

    valid_error = {"code": "invalid_input", "path": paths[0], "consumed": {"steps": 3}}
    assert inspect_invalid_error(resource, valid_error)["ok"] is True
    for success_payload in (
        {"partial_result": {}},
        {"result": {}},
        {"value": []},
        {"output": {}},
        {"status": "completed"},
    ):
        assert inspect_invalid_error(resource, {**valid_error, **success_payload})["ok"] is False
    assert inspect_invalid_error(resource, {"code": "invalid_input"})["ok"] is False


def test_oracle_rejects_nonfinite_numeric_thresholds_and_measurements():
    resource = fixture("normal")
    resource["groups"][0]["rule"]["minimum"] = float("inf")
    with pytest.raises(ValueError, match="minimum must be numeric"):
        expected_output(resource)

    resource = fixture("normal")
    resource["groups"][0]["records"][0]["measurements"][0]["value"] = float("nan")
    with pytest.raises(ValueError, match="nonnumeric value"):
        expected_output(resource)


def test_fixture_envelopes_are_versioned_and_hashable_without_mutation():
    resources = [fixture(name) for name in ("normal", "contrast", "invalid")]
    before = copy.deepcopy(resources)
    hashes = [resource_hash(resource) for resource in resources]

    assert all(len(digest) == 64 for digest in hashes)
    assert len(set(hashes)) == 3
    assert resources == before
    assert all(resource["resource_ref"].endswith("@v1") for resource in resources)
    assert all(resource["version"] == 1 for resource in resources)


def test_oracle_output_can_be_serialized_for_runner_side_report():
    resource = fixture("normal")
    report = inspect_output(resource, expected_output(resource))

    encoded = json.dumps(report, ensure_ascii=False, sort_keys=True)
    assert json.loads(encoded)["ok"] is True
