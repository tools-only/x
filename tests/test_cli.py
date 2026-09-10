import json
from types import SimpleNamespace

from autoresearch_pi import cli
from autoresearch_pi.project import ProjectPaths


def test_shopping_e2e_cli_enables_isolated_context_compaction_capability(monkeypatch, tmp_path):
    """Catches the smoke-test switch failing to reach the selected Shopping run."""
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_run(root, *, dataset, level, case_id, experiment_variant, timeout, context_compaction):
        seen.append((root, level, case_id, experiment_variant, context_compaction))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"passed": True}), encoding="utf-8")
        return summary

    monkeypatch.setattr(cli, "run_shopping_e2e", fake_run)
    root = paths.root / "runs" / "shopping-context-smoke"

    code = cli.main([
        "shopping-e2e", "--level", "2", "--case", "11", "--context-compaction",
        "--root", str(root),
    ])

    assert code == 0
    assert seen == [(root.resolve(), "2", "11", "treatment", True)]


def test_officebench_experiment_cli_runs_requested_pair_count(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_experiment(root, *, case_id, repeats, paths):
        seen.append((root, case_id, repeats, paths))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"status": "completed"}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_officebench_e2e_experiment", fake_experiment)
    root = paths.root / "runs" / "paired"

    code = cli.main([
        "officebench-experiment", "--case", "3-6-0",
        "--repeats", "3", "--root", str(root),
    ])

    assert code == 0
    assert seen == [(root.resolve(), "3-6-0", 3, paths)]


def test_shopping_experiment_cli_parses_validation_cohort(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_experiment(root, *, cases, repeats, dataset, timeout):
        seen.append((root, cases, repeats, dataset, timeout))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"status": "completed"}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_shopping_e2e_experiment", fake_experiment)
    root = paths.root / "runs" / "shopping-paired"
    dataset = tmp_path / "shopping"
    code = cli.main([
        "shopping-experiment", "--cases", "2:2,3:2", "--repeats", "2",
        "--dataset", str(dataset), "--timeout", "300", "--root", str(root),
    ])

    assert code == 0
    assert seen == [(root.resolve(), [("2", "2"), ("3", "2")], 2, dataset, 300.0)]


def test_shopping_experiment_cli_loads_runner_only_validation_manifest(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    manifest = tmp_path / "validation.json"
    manifest.write_text(json.dumps({
        "format": "constitutional-validation-v1",
        "cases": {"shopping:3:2": {
            "stratum": "feedback_dependent",
            "hypothesis": "no_change_is_valid",
        }},
    }), encoding="utf-8")
    seen = []

    def fake_experiment(root, *, cases, repeats, dataset, timeout, validation_strata):
        seen.append(validation_strata)
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"status": "completed"}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_shopping_e2e_experiment", fake_experiment)
    code = cli.main([
        "shopping-experiment", "--cases", "3:2",
        "--validation-manifest", str(manifest),
        "--root", str(paths.root / "runs" / "shopping-manifest"),
    ])

    assert code == 0
    assert seen == [{"shopping:3:2": {
        "stratum": "feedback_dependent",
        "hypothesis": "no_change_is_valid",
    }}]


def test_shopping_context_ablation_cli_parses_cases_without_changing_agent_variant(monkeypatch, tmp_path):
    """Catches the dedicated mechanism comparison being routed through full-stack control."""
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_ablation(root, *, cases, repeats, dataset, timeout):
        seen.append((root, cases, repeats, dataset, timeout))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"status": "completed"}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_shopping_context_compaction_ablation", fake_ablation)
    root = paths.root / "runs" / "shopping-context-ablation"
    dataset = tmp_path / "shopping"

    code = cli.main([
        "shopping-context-ablation", "--cases", "2:11,3:2", "--repeats", "2",
        "--dataset", str(dataset), "--timeout", "300", "--root", str(root),
    ])

    assert code == 0
    assert seen == [(root.resolve(), [("2", "11"), ("3", "2")], 2, dataset, 300.0)]


def test_officebench_cohort_cli_parses_case_ids(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_cohort(root, *, case_ids, repeats, paths):
        seen.append((root, case_ids, repeats, paths))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"status": "completed"}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_officebench_e2e_cohort", fake_cohort)
    root = paths.root / "runs" / "cohort"
    code = cli.main([
        "officebench-cohort", "--cases", "2-13-0,3-45-0,3-52-0",
        "--repeats", "2", "--root", str(root),
    ])

    assert code == 0
    assert seen == [(root.resolve(), ["2-13-0", "3-45-0", "3-52-0"], 2, paths)]


def test_officebench_cohort_cli_loads_runner_only_validation_manifest(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    manifest = tmp_path / "validation.json"
    manifest.write_text(json.dumps({
        "format": "constitutional-validation-v1",
        "cases": {"officebench:2-13-0": {
            "stratum": "low_next_request_benefit",
            "hypothesis": "no_change_is_valid",
        }},
    }), encoding="utf-8")
    seen = []

    def fake_cohort(root, *, case_ids, repeats, paths, validation_strata):
        seen.append(validation_strata)
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"status": "completed"}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_officebench_e2e_cohort", fake_cohort)
    code = cli.main([
        "officebench-cohort", "--cases", "2-13-0",
        "--validation-manifest", str(manifest),
        "--root", str(paths.root / "runs" / "manifest-cohort"),
    ])

    assert code == 0
    assert seen == [{"officebench:2-13-0": {
        "stratum": "low_next_request_benefit",
        "hypothesis": "no_change_is_valid",
    }}]


def test_officebench_continuation_cli_passes_variant_and_timeout(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_continuation(root, *, case_id, paths, experiment_variant, timeout):
        seen.append((root, case_id, paths, experiment_variant, timeout))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"passed": True}), encoding="utf-8")
        return SimpleNamespace(summary=summary)

    monkeypatch.setattr(cli, "run_officebench_e2e_continuation", fake_continuation)
    root = paths.root / "runs" / "continuation"
    code = cli.main([
        "officebench-continuation", "--case", "2-13-0", "--variant", "control",
        "--timeout", "42", "--root", str(root),
    ])
    assert code == 0
    assert seen == [(root.resolve(), "2-13-0", paths, "control", 42.0)]
