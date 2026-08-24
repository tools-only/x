from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import load_config, load_dotenv
from .candidates import derive_harness
from .demo import run_demo, run_task
from .experiment import (
    evaluate_checkpoint,
    load_experiment_suite,
    read_experiment_status,
    run_experiment,
)
from .gate import Gate
from .provider import create_provider_client
from .research import ResearchControlPlane
from .resolver import resolve_harness
from .store import ObjectStore
from .paths import scoped_root
from .smoke import run_live_pipeline_smoke


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hos", description="Minimal file-native Harness Kernel")
    subcommands = parser.add_subparsers(dest="command", required=True)

    init = subcommands.add_parser("init", help="initialize an empty Kernel state directory")
    init.add_argument("--root", type=Path, default=Path(".hos"))

    inspect = subcommands.add_parser("inspect", help="resolve and print a Harness definition graph")
    inspect.add_argument("harness")
    inspect.add_argument("--root", type=Path, default=Path(".hos"))

    demo = subcommands.add_parser("demo", help="run autonomous Meta research over Harness Specs")
    demo.add_argument("--root", type=Path, default=Path(".hos"))
    demo.add_argument("--environment", choices=("arc3", "arc3-local", "terminal-bench-2"), default="arc3-local")
    demo.add_argument("--game-id", default=None, help="ARC-AGI-3 game ID; required for arc3 environments")
    demo.add_argument("--seed", type=int, default=0)
    demo.add_argument("--task-name", default=None, help="Terminal-Bench task name")
    demo.add_argument("--dataset", default=None, help="Harbor dataset, default terminal-bench/terminal-bench-2")
    demo.add_argument("--runtime", choices=("llm",), default="llm")

    experiment = subcommands.add_parser("experiment", help="run isolated train/evaluation suites")
    experiment_actions = experiment.add_subparsers(dest="experiment_command", required=True)
    experiment_run = experiment_actions.add_parser("run", help="run an isolated controller and evaluation suite")
    experiment_run.add_argument("--root", type=Path, default=Path(".hos"))
    experiment_run.add_argument("--suite", type=Path, required=True)
    experiment_run.add_argument("--duration-hours", type=float, default=24.0)
    experiment_run.add_argument("--max-cycles", type=int, default=None)
    experiment_run.add_argument(
        "--controller",
        choices=("meta", "fixed-task", "continual-harness", "rule-search"),
        default=None,
        help="override the suite controller",
    )
    experiment_evaluate = experiment_actions.add_parser("evaluate", help="evaluate one Harness on the held-out tasks")
    experiment_evaluate.add_argument("--root", type=Path, default=Path(".hos"))
    experiment_evaluate.add_argument("--suite", type=Path, required=True)
    experiment_evaluate.add_argument("--harness", default=None)
    experiment_evaluate.add_argument("--reason", default="manual")
    experiment_status = experiment_actions.add_parser("status", help="show the latest session and evaluation checkpoint")
    experiment_status.add_argument("--root", type=Path, default=Path(".hos"))
    experiment_status.add_argument("--suite", type=Path, required=True)

    task = subcommands.add_parser("task", help="run a Task Harness without executing a Meta Harness")
    task_actions = task.add_subparsers(dest="task_command", required=True)
    task_run = task_actions.add_parser("run", help="run one Task Harness")
    task_run.add_argument("--root", type=Path, default=Path(".hos"))
    task_run.add_argument("--environment", choices=("arc3", "arc3-local", "terminal-bench-2"), default="arc3-local")
    task_run.add_argument("--game-id", default=None, help="ARC-AGI-3 game ID; required for arc3 environments")
    task_run.add_argument("--seed", type=int, default=0)
    task_run.add_argument("--task-name", default=None, help="Terminal-Bench task name")
    task_run.add_argument("--dataset", default=None, help="Harbor dataset, default terminal-bench/terminal-bench-2")
    task_run.add_argument("--runtime", choices=("llm",), default="llm")
    task_run.add_argument("--harness", default=None)
    task_run.add_argument("--job", type=Path, default=None)

    candidate = subcommands.add_parser("candidate", help="publish an immutable Harness candidate")
    candidate_actions = candidate.add_subparsers(dest="candidate_command", required=True)
    candidate_publish = candidate_actions.add_parser("publish", help="derive a candidate from a Harness")
    candidate_publish.add_argument("--root", type=Path, default=Path(".task-hos"))
    candidate_publish.add_argument("--target", required=True)
    candidate_publish.add_argument("--patch", type=Path, required=True)
    candidate_publish.add_argument("--created-by-run", default="manual")

    gate = subcommands.add_parser("gate", help="evaluate Harness candidates")
    gate_actions = gate.add_subparsers(dest="gate_command", required=True)
    task_gate = gate_actions.add_parser("evaluate-task", help="compare two Task Harnesses")
    task_gate.add_argument("--root", type=Path, default=Path(".task-hos"))
    task_gate.add_argument("--baseline", required=True)
    task_gate.add_argument("--candidate", required=True)
    task_gate.add_argument("--job", type=Path, required=True)
    task_gate.add_argument("--contract", type=Path, default=None)

    research = subcommands.add_parser("research", help="operate the Meta research control plane")
    research_actions = research.add_subparsers(dest="research_command", required=True)
    research_spec = research_actions.add_parser("spec", help="publish a RuntimeSpec")
    research_spec.add_argument("--root", type=Path, default=Path(".hos"))
    research_spec.add_argument("--parent-run", required=True)
    research_spec.add_argument("--agent-run", required=True)
    research_spec.add_argument("--input", type=Path, required=True)
    research_instantiate = research_actions.add_parser("instantiate", help="compile a RuntimeSpec into a RuntimeHarness")
    research_instantiate.add_argument("--root", type=Path, default=Path(".hos"))
    research_instantiate.add_argument("--parent-run", required=True)
    research_instantiate.add_argument("--agent-run", required=True)
    research_instantiate.add_argument("--spec", required=True)
    research_run = research_actions.add_parser("run", help="execute a RuntimeHarness")
    research_run.add_argument("--root", type=Path, default=Path(".hos"))
    research_run.add_argument("--parent-run", required=True)
    research_run.add_argument("--harness", required=True)
    research_run.add_argument("--job", type=Path, required=True)
    research_observe = research_actions.add_parser("observe", help="read a RuntimeRun evidence summary")
    research_observe.add_argument("--root", type=Path, default=Path(".hos"))
    research_observe.add_argument("--parent-run", required=True)
    research_observe.add_argument("--run", required=True)
    research_state = research_actions.add_parser("state", help="read the current Meta evolution state")
    research_state.add_argument("--root", type=Path, default=Path(".hos"))
    research_state.add_argument("--parent-run", required=True)
    research_state.add_argument("--limit", type=int, default=8)
    research_knowledge = research_actions.add_parser("knowledge", help="search persisted methodology evidence")
    research_knowledge.add_argument("--root", type=Path, default=Path(".hos"))
    research_knowledge.add_argument("--parent-run", required=True)
    research_knowledge.add_argument("--query", required=True)
    research_knowledge.add_argument("--limit", type=int, default=8)
    research_decision = research_actions.add_parser("decision", help="record a Meta assessment for a RuntimeSpec")
    research_decision.add_argument("--root", type=Path, default=Path(".hos"))
    research_decision.add_argument("--parent-run", required=True)
    research_decision.add_argument("--agent-run", required=True)
    research_decision.add_argument("--spec", required=True)
    research_decision.add_argument("--input", type=Path, required=True)

    config = subcommands.add_parser("config", help="validate or display provider configuration")
    config_actions = config.add_subparsers(dest="config_command", required=True)
    for action in ("check", "show"):
        command = config_actions.add_parser(action)
        command.add_argument("--config", type=Path, default=None)
        command.add_argument("--provider", default=None)

    provider = subcommands.add_parser("provider", help="operate configured model providers")
    provider_actions = provider.add_subparsers(dest="provider_command", required=True)
    probe = provider_actions.add_parser("probe", help="send a minimal chat-completions request")
    probe.add_argument("--config", type=Path, default=None)
    probe.add_argument("--provider", default=None)

    pipeline = subcommands.add_parser("pipeline", help="validate Kernel and Harness execution paths")
    pipeline_actions = pipeline.add_subparsers(dest="pipeline_command", required=True)
    pipeline_smoke = pipeline_actions.add_parser("smoke", help="run deterministic live Harness pipeline validation")
    pipeline_smoke.add_argument("--root", type=Path, default=Path(".hos-smoke"))
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    arguments = build_parser().parse_args(argv)
    if arguments.command == "init":
        store = ObjectStore(arguments.root)
        print(json.dumps({"root": str(store.root), "status": "initialized"}, ensure_ascii=False))
        return 0
    if arguments.command == "inspect":
        lock = resolve_harness(ObjectStore(arguments.root), arguments.harness)
        print(json.dumps(lock, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "demo":
        root = scoped_root(arguments.root, "meta")
        report = run_demo(
            root,
            environment=arguments.environment,
            game_id=arguments.game_id,
            seed=arguments.seed,
            runtime=arguments.runtime,
            task_name=arguments.task_name,
            terminal_dataset=arguments.dataset,
        )
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "experiment":
        root = scoped_root(arguments.root, "meta")
        if arguments.experiment_command == "run":
            report = run_experiment(
                root,
                arguments.suite,
                duration_hours=arguments.duration_hours,
                max_cycles=arguments.max_cycles,
                controller=arguments.controller,
            )
        elif arguments.experiment_command == "evaluate":
            suite = load_experiment_suite(arguments.suite)
            harness = arguments.harness
            if harness is None:
                harness = read_experiment_status(root, arguments.suite)["current_harness"]
            if harness is None:
                raise ValueError("no current Task Harness is available for evaluation")
            report = evaluate_checkpoint(root, suite, harness, reason=arguments.reason)
        elif arguments.experiment_command == "status":
            report = read_experiment_status(root, arguments.suite)
        else:
            raise AssertionError(arguments.experiment_command)
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "task" and arguments.task_command == "run":
        root = scoped_root(arguments.root, "task")
        job = _read_json(arguments.job) if arguments.job else None
        report = run_task(
            root,
            environment=arguments.environment,
            harness_ref=arguments.harness,
            job=job,
            game_id=arguments.game_id,
            seed=arguments.seed,
            runtime=arguments.runtime,
            task_name=arguments.task_name,
            terminal_dataset=arguments.dataset,
        )
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "pipeline" and arguments.pipeline_command == "smoke":
        report = run_live_pipeline_smoke(arguments.root)
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "research":
        control = ResearchControlPlane(ObjectStore(arguments.root), parent_run=arguments.parent_run)
        if arguments.research_command == "spec":
            report = control.publish_spec(_read_json(arguments.input), agent_run=arguments.agent_run)
        elif arguments.research_command == "instantiate":
            report = control.instantiate_runtime(arguments.spec, agent_run=arguments.agent_run)
        elif arguments.research_command == "run":
            report = control.run_runtime(arguments.harness, _read_json(arguments.job))
        elif arguments.research_command == "observe":
            report = control.observe_run(arguments.run)
        elif arguments.research_command == "state":
            report = control.read_evolution(arguments.limit)
        elif arguments.research_command == "knowledge":
            report = control.search_knowledge(arguments.query, arguments.limit)
        elif arguments.research_command == "decision":
            report = control.record_decision(arguments.spec, _read_json(arguments.input), agent_run=arguments.agent_run)
        else:
            raise AssertionError(arguments.research_command)
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "candidate" and arguments.candidate_command == "publish":
        root = scoped_root(arguments.root, "task")
        patch = _read_json(arguments.patch)
        candidate = derive_harness(
            ObjectStore(root),
            arguments.target,
            patch,
            created_by_run=arguments.created_by_run,
        )
        print(
            json.dumps(
                {
                    "status": "published",
                    "target": arguments.target,
                    "candidate": candidate,
                    "created_by_run": arguments.created_by_run,
                },
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
        )
        return 0
    if arguments.command == "gate" and arguments.gate_command == "evaluate-task":
        root = scoped_root(arguments.root, "task")
        job = _read_json(arguments.job)
        contract = _read_json(arguments.contract) if arguments.contract else None
        record = Gate(ObjectStore(root)).evaluate_task(
            arguments.baseline,
            arguments.candidate,
            job,
            contract,
        )
        print(json.dumps(record, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    if arguments.command == "config":
        require_secret = arguments.config_command == "check"
        config = load_config(arguments.config)
        provider = config.resolve_provider(arguments.provider, require_secret=require_secret)
        print(
            json.dumps(
                {"status": "valid", "config": str(config.path), "provider": provider.redacted()},
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
        )
        return 0
    if arguments.command == "provider" and arguments.provider_command == "probe":
        provider = load_config(arguments.config).resolve_provider(arguments.provider, require_secret=True)
        print(json.dumps(create_provider_client(provider).probe(), ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    raise AssertionError(arguments.command)


def _read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON file must contain an object: {path}")
    return value


if __name__ == "__main__":
    raise SystemExit(main())
