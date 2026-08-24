from hos.cli import build_parser


def test_cli_exposes_only_supported_environments() -> None:
    parser = build_parser()

    demo = parser.parse_args(["demo", "--environment", "arc3-local"])
    assert demo.environment == "arc3-local"

    terminal = parser.parse_args(
        [
            "task",
            "run",
            "--environment",
            "terminal-bench-2",
            "--task-name",
            "video-processing",
        ]
    )
    assert terminal.environment == "terminal-bench-2"
    assert terminal.task_name == "video-processing"
    assert terminal.dataset is None


def test_cli_exposes_research_control_plane_commands() -> None:
    parser = build_parser()

    research = parser.parse_args(
        [
            "research",
            "instantiate",
            "--root",
            ".meta-test",
            "--parent-run",
            "harness-meta",
            "--agent-run",
            "agent-meta",
            "--spec",
            "sha256:" + "a" * 64,
        ]
    )

    assert research.command == "research"
    assert research.research_command == "instantiate"
    assert research.parent_run == "harness-meta"

    state = parser.parse_args(
        [
            "research",
            "state",
            "--root",
            ".meta-test",
            "--parent-run",
            "harness-meta",
            "--limit",
            "3",
        ]
    )

    assert state.research_command == "state"
    assert state.limit == 3


def test_cli_exposes_experiment_commands() -> None:
    parser = build_parser()

    run = parser.parse_args(
        [
            "experiment",
            "run",
            "--root",
            ".meta-terminal-bench",
            "--suite",
            "experiments/terminal-bench-2.toml",
            "--duration-hours",
            "24",
            "--max-cycles",
            "3",
        ]
    )
    status = parser.parse_args(
        [
            "experiment",
            "status",
            "--suite",
            "experiments/terminal-bench-2.toml",
        ]
    )

    assert run.experiment_command == "run"
    assert run.duration_hours == 24
    assert run.max_cycles == 3
    assert run.controller is None
    assert status.experiment_command == "status"


def test_cli_accepts_controller_override() -> None:
    arguments = build_parser().parse_args(
        [
            "experiment",
            "run",
            "--suite",
            "experiments/terminal-bench-2.toml",
            "--controller",
            "fixed-task",
        ]
    )
    assert arguments.controller == "fixed-task"
