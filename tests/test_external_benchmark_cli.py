import json
from types import SimpleNamespace

from autoresearch_pi import cli
from autoresearch_pi.project import ProjectPaths


def test_arc_agi_3_cli_routes_one_pi_native_game(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_run(root, *, arc_root, game, experiment_variant, max_actions, context_compaction):
        seen.append((root, arc_root, game, experiment_variant, max_actions, context_compaction))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"passed": True}), encoding="utf-8")
        return summary

    monkeypatch.setattr(cli, "run_arc_agi_3_e2e", fake_run)
    root = paths.root / "runs" / "arc-ls20"
    arc_root = tmp_path / "arc"

    code = cli.main([
        "arc-agi-3-e2e", "--game", "ls20", "--arc-root", str(arc_root),
        "--variant", "treatment", "--context-compaction", "--max-actions", "12",
        "--root", str(root),
    ])

    assert code == 0
    assert seen == [(root.resolve(), arc_root, "ls20", "treatment", 12, True)]


def test_terminal_bench_cli_routes_one_harbor_task(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    monkeypatch.setattr(cli.ProjectPaths, "from_environment", lambda: paths)
    seen = []

    def fake_run(root, *, dataset, task_id, experiment_variant, timeout, model, context_compaction):
        seen.append((root, dataset, task_id, experiment_variant, timeout, model, context_compaction))
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text(json.dumps({"passed": False}), encoding="utf-8")
        return summary

    monkeypatch.setattr(cli, "run_terminal_bench_e2e", fake_run)
    root = paths.root / "runs" / "terminal-chess"
    dataset = tmp_path / "terminal-bench-2-1"

    code = cli.main([
        "terminal-bench-e2e", "--task", "chess-best-move", "--dataset", str(dataset),
        "--variant", "control", "--model", "yibu/a:deepseek-v4-flash",
        "--context-compaction", "--timeout", "84", "--root", str(root),
    ])

    assert code == 1
    assert seen == [(
        root.resolve(), dataset, "chess-best-move", "control", 84.0,
        "yibu/a:deepseek-v4-flash", True,
    )]


def test_project_paths_disclose_local_external_benchmark_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("ARC_AGI_3_ROOT", str(tmp_path / "arc"))
    monkeypatch.setenv("TERMINAL_BENCH_ROOT", str(tmp_path / "terminal"))
    monkeypatch.setenv("TERMINAL_BENCH_DATASET", str(tmp_path / "tasks"))

    paths = ProjectPaths.from_environment(root=tmp_path / "project")

    assert paths.arc_agi_3_root == (tmp_path / "arc").resolve()
    assert paths.terminal_bench_root == (tmp_path / "terminal").resolve()
    assert paths.terminal_bench_dataset == (tmp_path / "tasks").resolve()
