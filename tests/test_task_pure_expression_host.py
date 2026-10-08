"""Authorization, immutable snapshot, and exact binding diagnostics."""
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import results

PROJECT = Path(__file__).resolve().parents[1]
FIXTURE = PROJECT / "tests" / "pi_task_pure_expression_host_fixture.ts"


def scenario(tmp_path, name):
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[FIXTURE], steps=[
        {"name": "pure_host_fixture", "arguments": {"scenario": name}},
    ])
    output = results(events, "pure_host_fixture")[-1]
    assert not output.get("isError"), output
    return output["result"]["details"]


def test_binding_requires_initialized_parent_and_is_not_exposed_to_children(tmp_path):
    value = scenario(tmp_path, "authorization")
    assert "uninitialized" in value["denied"]
    assert "not exposed to child" in value["childDenied"]
    assert "not exposed to child" in value["grantedChild"]
    assert value["prepared"]["input"] == {"pick": 1, "grid": [[0, 2], [3, 4]]}
    assert value["prepared"]["provenance"]["bindings"][0]["historical_or_stale"] is False


def test_child_install_order_cannot_widen_and_snapshot_wildcard_does_not_move_cutoff(tmp_path):
    value = scenario(tmp_path, "child_order")
    assert value["reads"][0] == value["reads"][2] == "allowed"
    assert all("not granted" in value["reads"][index] for index in (1, 3))
    assert value["inspect"]["total"] == 0
    assert "not granted" in value["wildcardRead"]
    assert "not granted" in value["afterGrant"]


def test_snapshot_whitelist_immutability_staleness_and_bounded_resolution(tmp_path):
    value = scenario(tmp_path, "snapshot")
    assert all(secret not in value["file"] for secret in
               ("top-secret", "nested-secret", "credentials", "adapter"))
    assert value["old"]["input"]["grid"][0][0] == 0
    assert value["current"]["input"]["grid"][0][0] == 99
    provenance = value["old"]["provenance"]["bindings"][0]
    assert provenance["historical_or_stale"] is True
    assert provenance["capture_boundary"]["total_used"] == 0
    assert provenance["current_observed_boundary"]["total_used"] == 1
    assert "exact" in value["traversal"]
    assert "scan exceeds" in value["smallScan"]


def test_envelope_and_strict_json_failures_are_lossless_and_root_is_fixed(tmp_path):
    value = scenario(tmp_path, "invalid_envelope")
    assert all(error != "bad" for error in value["errors"])
    assert "omit parameters.grid" in value["errors"][0]
    assert "no $binding placeholder" in value["errors"][0]
    assert "unique" in value["errors"][1]
    assert "missing" in value["errors"][2]
    assert "forbidden" in value["errors"][3]
    assert "finite" in value["errors"][4]
    assert "JSON types" in value["errors"][5]
    assert "plain or null prototype" in value["errors"][6]
    assert "byte limit" in value["errors"][7]
    assert "byte limit" in value["errors"][8]
    assert "across task roots" in value["rootError"]


def test_bound_snapshot_identity_preserves_epoch_cutoff_and_cross_level_history(tmp_path):
    value = scenario(tmp_path, "epoch_cutoff")
    assert value['first']['observation_epoch'] == 1
    assert value['second']['observation_epoch'] == 2
    assert value['first']['bridge_event_cutoff'] == 1
    assert value['second']['bridge_event_cutoff'] == 2
    assert value['unknown']['observation_epoch'] is None
    assert value['unknown']['bridge_event_cutoff'] is None
    assert value['reset']['observation_epoch'] == 3
    assert value['reset']['public_state'] == value['second']['public_state']
    assert value['repeated']['observation_epoch'] == 3
    assert value['gap']['observation_epoch'] is None
    assert value['gap']['bridge_event_cutoff'] == 6
    assert 'complete monotonic cutoff' in value['invalid'] and value['unchanged'] is True
    old, current = value['prepared']['provenance']['bindings']
    assert old['task_id'] == current['task_id'] == value['first']['task_id']
    assert old['observation_epoch'] == 1 and current['observation_epoch'] == 2
    assert old['bridge_event_cutoff'] == 1 and current['bridge_event_cutoff'] == 2
    assert old['capture_boundary']['level'] == 0 and current['capture_boundary']['level'] == 1
    assert old['frame_index'] == current['frame_index'] == 0
    assert old['historical_or_stale'] is True and current['historical_or_stale'] is False
    assert value['prepared']['input']['old'] == [[0, 2], [3, 4]]
    assert value['prepared']['input']['current'] == [[1, 2], [3, 4]]


def test_scan_charges_actual_file_reads_and_record_hashing_is_cached_per_ref(tmp_path):
    value = scenario(tmp_path, "budgets")
    assert value["currentOnly"]["resource_scan_bytes"] == value["fileBytes"]
    assert "scan" in value["oldDoubleScan"] and "limit" in value["oldDoubleScan"]
    assert "scan" in value["scanError"] and "limit" in value["scanError"]
    # One current-metadata scan plus one exact-ref scan; 64 aliases do not
    # serialize/hash the same record 64 times.
    assert value["cached"]["resource_scan_bytes"] == value["fileBytes"] * 2
    assert value["cached"]["parsed_resource_records"] == 1
    assert value["cached"]["work_bytes"] < 100_000
    assert "work budget exhausted" in value["workError"]


def test_current_grid_reuses_exact_binding_integrity_and_cost_without_implicit_context(tmp_path):
    value = scenario(tmp_path, 'current_grid')
    assert value['direct'] == value['explicit']
    assert value['direct']['input'] == {'bias': 1, 'grid': [[8]]}
    assert value['request_unchanged'] is True
    assert value['noContext']['input'] == {}
    assert value['noContext']['preparation']['resource_scan_bytes'] == 0
    assert value['disabled']['input'] == {'grid': [[5]]}
    assert value['disabled']['preparation']['resource_scan_bytes'] == 0
    assert 'nonempty final grid' in value['absent'] and 'nonempty final grid' in value['empty']
    assert 'not exposed to child' in value['childDenied']
    negative = value['negative']
    assert all(msg != 'NOT_REJECTED' for msg in negative.values())
    assert 'fills input.grid' in negative['conflict'] and 'fills input.grid' in negative['bindingConflict']
    assert 'boolean' in negative['type'] and '64' in negative['capacity']
    assert 'scan exceeds' in negative['scan'] and 'byte limit' in negative['input']
    assert 'work budget exhausted' in negative['work']
    assert 'uninitialized' in negative['uninitialized']
    assert 'root' in negative['crossRoot']
