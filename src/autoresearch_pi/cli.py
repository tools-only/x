"""CLI for diagnostics and bounded local smoke runs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

from pathlib import Path

from .jit_adapter import JitAdapter
from .jev_routing import JEV_ROUTING_ENV
from .meta_harness_demo import run_demo
from .officebench_e2e import (
    run_officebench_e2e,
    run_officebench_e2e_batch,
    run_officebench_e2e_cohort,
    run_officebench_e2e_continuation,
    run_officebench_e2e_experiment,
)
from .project import ProjectPaths
from .task_agent import PiTaskAgent
from .shopping_e2e import (
    run_shopping_e2e,
    run_shopping_e2e_experiment,
    run_shopping_context_compaction_ablation,
)
from .validation_evidence import load_validation_manifest
from .arc_agi_3_e2e import run_arc_agi_3_e2e, write_arc_method_evolution_audit
from .arc_harness_smoke import run_arc_harness_smoke
from .arc_thin_e2e import (
    run_arc_thin_claims_smoke, run_arc_thin_continuity_smoke, run_arc_thin_e2e, run_arc_thin_environment_smoke, run_arc_thin_ledger_smoke,
    run_arc_thin_self_harness_smoke, run_arc_thin_smoke,
)
from .arc_blind_policy import run_arc_blind_policy
from .arc_agi_3_e2e import _pi_cli_version, _resolve_pi_cli
from .terminal_bench_e2e import run_terminal_bench_e2e


def main(argv: list[str] | None = None) -> int:
    # ARC summaries contain model-authored Unicode. Windows redirected stdout
    # otherwise inherits GBK and can fail after a paid run has already finished.
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="autoresearch-pi")
    jev_routing = parser.add_mutually_exclusive_group()
    jev_routing.add_argument(
        "--jev-routing", choices=("disabled", "shadow", "active"),
        help="route Self-Harness components with Jev (default: disabled)",
    )
    jev_routing.add_argument(
        "--no-jev-routing", dest="jev_routing", action="store_const", const="disabled",
        help="disable Jev component routing without calling Jev",
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("doctor", help="check local integration prerequisites")
    meta = sub.add_parser("meta-synthetic", help="run the network-free meta regression")
    meta.add_argument("--root", type=Path, default=None)
    jit = sub.add_parser("jit", help="run a bounded external JIT benchmark")
    jit.add_argument("--bench", choices=("officebench", "shopping"), default="officebench")
    jit.add_argument("--harness", default="auto_research")
    jit.add_argument("--max-samples", type=int, default=1)
    jit.add_argument("--cases", default=None)
    smoke = sub.add_parser("officebench-smoke", help="run a Pi-native OfficeBench-compatible smoke")
    smoke.add_argument("--root", type=Path, default=None)
    meta_harness = sub.add_parser("meta-harness-demo", help="run the task-local Auto-Research/self-harness demo")
    meta_harness.add_argument("--root", type=Path, default=None)
    e2e = sub.add_parser("officebench-e2e", help="run one real OfficeBench case through Pi and the JIT evaluator")
    e2e.add_argument("--root", type=Path, default=None)
    e2e_selection = e2e.add_mutually_exclusive_group()
    e2e_selection.add_argument("--case", default=None)
    e2e_selection.add_argument("--max-samples", type=int, default=None)
    experiment = sub.add_parser(
        "officebench-experiment",
        help="run counterbalanced control/treatment pairs for one real OfficeBench case",
    )
    experiment.add_argument("--root", type=Path, default=None)
    experiment.add_argument("--case", required=True)
    experiment.add_argument("--repeats", type=int, default=1)
    cohort = sub.add_parser(
        "officebench-cohort",
        help="run isolated control/treatment pairs for a validation cohort",
    )
    cohort.add_argument("--root", type=Path, default=None)
    cohort.add_argument("--cases", required=True, help="comma-separated OfficeBench case IDs")
    cohort.add_argument("--repeats", type=int, default=1)
    cohort.add_argument("--validation-manifest", type=Path, default=None)
    continuation = sub.add_parser(
        "officebench-continuation",
        help="continue one OfficeBench task across two independent Pi processes",
    )
    continuation.add_argument("--root", type=Path, default=None)
    continuation.add_argument("--case", default=None)
    continuation.add_argument("--variant", choices=("control", "treatment"), default="treatment")
    continuation.add_argument("--timeout", type=float, default=900.0)
    shopping = sub.add_parser("shopping-e2e", help="run one JIT DeepPlanning Shopping case through Pi")
    shopping.add_argument("--root", type=Path, default=None)
    shopping.add_argument("--dataset", type=Path, default=None)
    shopping.add_argument("--level", choices=("1", "2", "3"), default="3")
    shopping.add_argument("--case", default="1")
    shopping.add_argument("--variant", choices=("control", "treatment"), default="treatment")
    shopping.add_argument("--timeout", type=float, default=900.0)
    shopping.add_argument(
        "--context-compaction", action="store_true",
        help="expose the optional Agent-selected Pi context capability for this isolated run",
    )
    shopping_experiment = sub.add_parser(
        "shopping-experiment",
        help="run counterbalanced control/treatment pairs for Shopping cases",
    )
    shopping_experiment.add_argument("--root", type=Path, default=None)
    shopping_experiment.add_argument("--dataset", type=Path, default=None)
    shopping_experiment.add_argument("--cases", required=True, help="comma-separated LEVEL:CASE values, e.g. 2:2,3:2")
    shopping_experiment.add_argument("--repeats", type=int, default=1)
    shopping_experiment.add_argument("--timeout", type=float, default=900.0)
    shopping_experiment.add_argument("--validation-manifest", type=Path, default=None)
    shopping_context_ablation = sub.add_parser(
        "shopping-context-ablation",
        help="compare Shopping treatment runs with and without Agent-owned context compaction",
    )
    shopping_context_ablation.add_argument("--root", type=Path, default=None)
    shopping_context_ablation.add_argument("--dataset", type=Path, default=None)
    shopping_context_ablation.add_argument("--cases", required=True, help="comma-separated LEVEL:CASE values")
    shopping_context_ablation.add_argument("--repeats", type=int, default=1)
    shopping_context_ablation.add_argument("--timeout", type=float, default=900.0)
    arc = sub.add_parser("arc-agi-3-e2e", help="run one ARC-AGI-3 game through Pi")
    arc.add_argument("--root", type=Path, default=None)
    arc.add_argument("--arc-root", type=Path, default=None)
    arc.add_argument("--game", default="ls20")
    arc.add_argument("--variant", choices=("control", "treatment"), default="treatment")
    arc.add_argument("--max-actions", type=int, default=None, help="Omitted derives baseline_actions x 5; 0 disables both local total and per-level step limits")
    arc.add_argument(
        "--input-modalities", default=None,
        help="Comma-separated provider input modalities (text,image); defaults to ARC_INPUT_MODALITIES or text",
    )
    arc.add_argument("--context-compaction", action="store_true")
    research_switch = arc.add_mutually_exclusive_group()
    research_switch.add_argument("--auto-research", dest="auto_research_enabled", action="store_true",
                                 help="Enable Auto-Research for this run (overrides environment configuration)")
    research_switch.add_argument("--no-auto-research", dest="auto_research_enabled", action="store_false",
                                 help="Disable research tools, workers and automatic research resume for debugging")
    arc.set_defaults(auto_research_enabled=None)
    arc.add_argument("--review-mode", choices=("advisory", "required"), default=None,
                     help="Periodic review mode; defaults to advisory (does not block actions)")
    arc.add_argument("--reasoning-policy", choices=("provider-default", "adaptive", "adaptive-binary", "adaptive-evidence"), default=None)
    arc.add_argument("--reasoning-levels", default=None,
                     help="Comma-separated verified provider effort capabilities; omitted means unknown")
    arc.add_argument("--max-output-tokens", type=int, default=None,
                     help="Opt-in shared model output envelope (parent and children use the same registry)")
    arc.add_argument("--experiment-timeout", type=float, default=None,
                     help="Opt-in experimental Pi runtime cutoff in seconds; not an official ARC limit")
    arc.add_argument("--max-reported-tokens", type=int, default=None,
                     help="Shared parent/child reported usage stop threshold; in-flight unreported usage may exceed it")
    arc.add_argument(
        "--harness-validation", action="store_true",
        help="run an explicit real-ARC task-local self-harness closure probe before gameplay",
    )
    arc.add_argument(
        "--auto-research-validation", action="store_true",
        help="run a real-ARC memory -> clean child research -> parent action plumbing probe",
    )
    arc.add_argument(
        "--cross-situation-validation", action="store_true",
        help="run the real-ARC cross-situation method adoption/use/assessment/feedback probe",
    )
    arc_thin = sub.add_parser("arc-thin-e2e", help="run one ARC-AGI-3 game through the thin self-harness extension")
    arc_thin.add_argument("--root", type=Path, default=None)
    arc_thin.add_argument("--arc-root", type=Path, default=None)
    arc_thin.add_argument("--game", default="ls20")
    arc_thin.add_argument("--foundation", choices=("legacy", "native"), default="native",
                          help="native: workspace files and full Pi session; legacy: frozen comparator")
    arc_thin.add_argument("--replay-reasoning", action="store_true", help="native comparison: retain thinking blocks in replay")
    arc_thin.add_argument("--auto-compaction", action=argparse.BooleanOptionalAction, default=None,
                          help="Pi automatic compaction: native defaults on, legacy defaults off; --no-auto-compaction disables it")
    arc_thin.add_argument("--variant", choices=("control", "treatment"), default="treatment",
                          help="control registers only arc_action; treatment adds the selected foundation and ledger/critic")
    arc_thin.add_argument("--max-actions", type=int, default=None)
    arc_thin.add_argument("--max-decisions", type=int, default=None)
    arc_thin.add_argument("--max-reported-tokens", type=int, default=None)
    arc_thin.add_argument("--experiment-timeout", type=float, default=None,
                          help="run deadline in seconds; 0 disables the experiment deadline, None retains the official default")
    arc_thin.add_argument("--turn-idle-timeout", type=float, default=180.0,
                          help="seconds without a native Pi event before one bounded turn recovery")
    arc_thin.add_argument("--consolidate-after", type=int, default=None,
                          help="periodic review interval: native defaults off (0), legacy defaults 25")
    arc_thin.add_argument("--review-on-miss", action="store_true",
                          help="also make a review due after a scored prediction miss (at most every 4 actions)")
    arc_thin.add_argument("--provider", default="yibu")
    arc_thin.add_argument("--model", default=None)
    arc_thin.add_argument("--thinking", default="high", help="Pi thinking level (default: high; use off to disable)")
    arc_thin.add_argument("--thinking-format", choices=("openai", "qwen", "qwen-chat-template"), default=None,
                          help="how the thinking level is sent to an OpenAI-Completions gateway (default: "
                               "ARC_PI_THINKING_FORMAT, or qwen for explicit thinking on yibu/qwen3.8-27b); "
                               "on other OpenAI-Completions routes without a format the provider's default applies")
    arc_thin.add_argument("--input-modalities", default=None,
                          help="comma-separated provider input modalities (default: ARC_INPUT_MODALITIES, else text,image; "
                               "use text for a model without image input)")
    arc_thin.add_argument("--max-output-tokens", type=int, default=None)
    arc_thin.add_argument("--ledger", action=argparse.BooleanOptionalAction, default=True,
                          help="ledger service, on by default: tracks the agent's optional idea/expect, effort per idea "
                               "and its skills' measurements (--no-ledger also needs --no-critic)")
    arc_thin.add_argument("--critic", action=argparse.BooleanOptionalAction, default=True,
                          help="critic service, on by default: an external reviewer triggered at critical steps (advisory); "
                               "it needs the ledger")
    arc_thin.add_argument("--carry-reasoning", type=int, default=0, metavar="CHARS",
                          help="comparison variable: show the end of the previous decision's reasoning (0 = off)")
    arc_thin.add_argument("--continuity", choices=("rebuild", "session"), default="rebuild",
                          help="rebuild: each decision sees only the rebuilt working set; session: the agent's last "
                               "decisions from Pi's session (text, tool calls, results; no reasoning) stay in view")
    arc_thin.add_argument("--continuity-decisions", type=int, default=8, metavar="N",
                          help="legacy session window size; native retains all Pi history")
    arc_thin.add_argument("--level-change-review", action=argparse.BooleanOptionalAction, default=None,
                          help="a review after each level change (default on, or ARC_THIN_LEVEL_REVIEW; native: the level "
                               "review that rewrites prompts/lessons.md)")
    arc_thin.add_argument("--stall-review-after", type=int, default=None, metavar="ACTIONS",
                          help="native: a stall review (the agent rewrites prompts/review.md) after this many actions "
                               "without a level completed (default: ARC_THIN_STALL_REVIEW, else 40; 0 = off)")
    arc_thin.add_argument("--spin-review-after", type=int, default=None, metavar="DECISIONS",
                          help="native, work memory: the stall review also comes after this many decisions in a row that only "
                               "replayed results the same board had already shown, doubling after each until a decision learns "
                               "something new (default: ARC_THIN_SPIN_REVIEW, else 2; 0 = off)")
    arc_thin_smoke = sub.add_parser("arc-thin-smoke",
                                    help="offline thin-harness check: mock ARC SDK, real bridge and Pi, scripted provider")
    arc_thin_smoke.add_argument("--root", type=Path, required=True)
    arc_thin_smoke.add_argument("--ledger", action="store_true", help="run the ledger + critic scenario instead")
    arc_thin_smoke.add_argument("--environment", action="store_true",
                                help="run the environment-failure scenario instead (mock steps return no frame)")
    arc_thin_smoke.add_argument("--self-harness", action="store_true",
                                help="run the predictions / history / working-set / carried-reasoning scenario instead")
    arc_thin_smoke.add_argument("--continuity", action="store_true",
                                help="run the session-continuity scenario instead (earlier decisions kept in view)")
    arc_thin_smoke.add_argument("--claims", action="store_true",
                                help="run the hypothesis-check and one-off python scenario instead")
    arc_compaction_probe = sub.add_parser("arc-thin-compaction-probe",
                                           help="offline Pi 0.87.0 native-compaction boundary probe")
    arc_compaction_probe.add_argument("--root", type=Path, default=None)
    blind = sub.add_parser("arc-blind-policy",
                           help="play one ARC game with a scripted policy that never looks at the frame (evaluation floor)")
    blind.add_argument("--root", type=Path, default=None)
    blind.add_argument("--arc-root", type=Path, default=None)
    blind.add_argument("--game", default="ls20")
    blind.add_argument("--policy", choices=("repeat_each", "probe_then_each", "uniform_random"), required=True)
    blind.add_argument("--repeat", type=int, default=50, help="times each action is repeated (repeat policies)")
    blind.add_argument("--seed", type=int, default=0, help="seed for click coordinates and the random policy")
    blind.add_argument("--max-actions", type=int, default=200)
    blind.add_argument("--experiment-timeout", type=float, default=None)
    blind.add_argument("--mock-environment", action="store_true", help="mock ARC SDK (offline check of the policy runner)")
    arc_smoke = sub.add_parser(
        "arc-harness-smoke",
        help="run ARC/Pi self-harness diagnostics or capture real-provider closure evidence",
    )
    arc_smoke.add_argument("--root", type=Path, required=True)
    arc_smoke.add_argument("--arc-root", type=Path, default=None)
    arc_smoke.add_argument("--game", default="ls20")
    arc_smoke.add_argument("--mock-environment", action="store_true", help="mock SDK environment only; keep ARC bridge, Pi and child broker real")
    arc_smoke.add_argument("--case", default=None, help="run one named acceptance case")
    arc_smoke.add_argument("--provider-mode", choices=("deterministic", "real"), default="deterministic")
    arc_smoke.add_argument("--max-actions", type=int, default=None)
    arc_smoke.add_argument("--experiment-timeout", type=float, default=None)
    arc_smoke.add_argument("--max-reported-tokens", type=int, default=None)
    arc_smoke.add_argument("--max-output-tokens", type=int, default=None)
    arc_smoke.add_argument("--reasoning-policy", choices=("provider-default", "adaptive", "balanced-evidence"), default="provider-default")
    arc_smoke.add_argument("--reasoning-levels", default=None)
    arc_method_audit = sub.add_parser(
        "arc-method-audit",
        help="audit cross-situation induction through feedback from durable ARC run artifacts",
    )
    arc_method_audit.add_argument("--root", type=Path, required=True)
    terminal = sub.add_parser("terminal-bench-e2e", help="run one local Terminal-Bench task through Pi and Harbor")
    terminal.add_argument("--root", type=Path, default=None)
    terminal.add_argument("--dataset", type=Path, default=None)
    terminal.add_argument("--task", default="chess-best-move")
    terminal.add_argument("--variant", choices=("control", "treatment"), default="treatment")
    terminal.add_argument("--timeout", type=float, default=3600.0)
    terminal.add_argument("--model", default=None)
    terminal.add_argument("--context-compaction", action="store_true")
    args = parser.parse_args(argv)
    if args.jev_routing is not None:
        os.environ[JEV_ROUTING_ENV] = args.jev_routing
    paths = ProjectPaths.from_environment()
    paths.assert_isolated()
    if args.command in (None, "doctor"):
        print(f"project={paths.root}")
        print(f"jit_root={paths.jit_root} exists={paths.jit_root.is_dir()}")
        print(f"autoresearch_root={paths.autoresearch_root} exists={paths.autoresearch_root.is_dir()}")
        print(f"pi_command={os.getenv('PI_COMMAND', 'pi')}")
        print(f"docker_available={subprocess.run(['docker', 'version'], capture_output=True).returncode == 0}")
        print(f"officebench_prerequisites={JitAdapter(paths).check_prerequisites('officebench')}")
        return 0
    if args.command == "meta-synthetic":
        root = (args.root or paths.runs_dir / "meta-synthetic").resolve()
        root.parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["PYTHONPATH"] = str(paths.autoresearch_root.parent / "src")
        command = [str(Path(sys.executable)), str(paths.autoresearch_root / "demo.py"), "synthetic", "--root", str(root), "--agent", "scripted"]
        result = subprocess.run(command, cwd=str(paths.autoresearch_root.parent), env=env, text=True, capture_output=True)
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="")
        return result.returncode
    if args.command == "jit":
        adapter = JitAdapter(paths)
        prereqs = adapter.check_prerequisites(args.bench)
        if args.bench == "officebench" and not prereqs.get("officebench_python_deps", False):
            print(json.dumps({"returncode": 2, "error": prereqs}, ensure_ascii=False))
            return 2
        run = adapter.run_seed(bench=args.bench, harness=args.harness, max_samples=args.max_samples, cases=args.cases)
        print(json.dumps({"returncode": run.returncode, "output_dir": str(run.output_dir), "stdout": run.stdout, "stderr": run.stderr}, ensure_ascii=False))
        return run.returncode
    if args.command == "officebench-smoke":
        root = (args.root or paths.runs_dir / "pi-officebench-smoke").resolve()
        # Keep this command as a deterministic artifact smoke; task execution
        # itself is owned by Pi's native extension/session runtime.
        artifact = root / "officebench_case.docx"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(b"PK-officebench-smoke")
        summary = {"answer": "done", "score": 1.0, "artifact": str(artifact)}
        (root / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if summary["score"] == 1.0 else 1
    if args.command == "meta-harness-demo":
        root = (args.root or paths.runs_dir / "meta-harness-demo").resolve()
        result = run_demo(root)
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0 if result.score == 1.0 else 1
    if args.command == "officebench-e2e":
        root = (args.root or paths.runs_dir / "pi-officebench-e2e").resolve()
        if args.max_samples is not None:
            result = run_officebench_e2e_batch(root, max_samples=args.max_samples, paths=paths)
            print(result.summary.read_text(encoding="utf-8"), end="")
            return 0 if result.failed_cases == 0 else 1
        result = run_officebench_e2e(root, case_id=args.case, paths=paths)
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0 if result.passed else 1
    if args.command == "officebench-experiment":
        root = (args.root or paths.runs_dir / "pi-officebench-experiment").resolve()
        result = run_officebench_e2e_experiment(
            root, case_id=args.case, repeats=args.repeats, paths=paths,
        )
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0
    if args.command == "officebench-cohort":
        root = (args.root or paths.runs_dir / "pi-officebench-cohort").resolve()
        case_ids = [token.strip() for token in args.cases.split(",") if token.strip()]
        result = run_officebench_e2e_cohort(
            root, case_ids=case_ids, repeats=args.repeats, paths=paths,
            **({"validation_strata": load_validation_manifest(args.validation_manifest)}
               if args.validation_manifest else {}),
        )
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0
    if args.command == "officebench-continuation":
        root = (args.root or paths.runs_dir / "pi-officebench-continuation").resolve()
        result = run_officebench_e2e_continuation(
            root, case_id=args.case, paths=paths,
            experiment_variant=args.variant, timeout=args.timeout,
        )
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(result.summary.read_text(encoding="utf-8")).get("passed") else 1
    if args.command == "shopping-e2e":
        root = (args.root or paths.runs_dir / f"pi-shopping-level{args.level}-case{args.case}").resolve()
        summary = run_shopping_e2e(
            root, dataset=args.dataset, level=args.level, case_id=args.case,
            experiment_variant=args.variant, timeout=args.timeout,
            context_compaction=args.context_compaction,
        )
        print(summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(summary.read_text(encoding="utf-8")).get("passed") else 1
    if args.command == "shopping-experiment":
        root = (args.root or paths.runs_dir / "pi-shopping-experiment").resolve()
        cases: list[tuple[str, str]] = []
        for token in args.cases.split(","):
            token = token.strip()
            if not token or ":" not in token:
                raise SystemExit("--cases must be comma-separated LEVEL:CASE values")
            level, case_id = token.split(":", 1)
            cases.append((level.strip(), case_id.strip()))
        result = run_shopping_e2e_experiment(
            root, cases=cases, repeats=args.repeats, dataset=args.dataset, timeout=args.timeout,
            **({"validation_strata": load_validation_manifest(args.validation_manifest)}
               if args.validation_manifest else {}),
        )
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0
    if args.command == "shopping-context-ablation":
        root = (args.root or paths.runs_dir / "pi-shopping-context-ablation").resolve()
        cases: list[tuple[str, str]] = []
        for token in args.cases.split(","):
            token = token.strip()
            if not token or ":" not in token:
                raise SystemExit("--cases must be comma-separated LEVEL:CASE values")
            level, case_id = token.split(":", 1)
            cases.append((level.strip(), case_id.strip()))
        result = run_shopping_context_compaction_ablation(
            root, cases=cases, repeats=args.repeats, dataset=args.dataset, timeout=args.timeout,
        )
        print(result.summary.read_text(encoding="utf-8"), end="")
        return 0
    if args.command == "arc-agi-3-e2e":
        root = (args.root or paths.runs_dir / f"pi-arc-agi-3-{args.game}").resolve()
        arc_kwargs = {
            "arc_root": args.arc_root or paths.arc_agi_3_root,
            "game": args.game,
            "experiment_variant": args.variant,
            "max_actions": args.max_actions,
            "context_compaction": args.context_compaction,
        }
        if args.input_modalities is not None:
            arc_kwargs["input_modalities"] = args.input_modalities
        # Keep the default call compatible with lightweight runners/mocks that
        # predate the opt-in closure probe; the new argument is meaningful only
        # when the user explicitly enables it.
        if args.harness_validation:
            arc_kwargs["harness_validation"] = True
        if args.auto_research_validation:
            arc_kwargs["auto_research_validation"] = True
        if args.auto_research_enabled is not None:
            arc_kwargs["auto_research_enabled"] = args.auto_research_enabled
        if args.cross_situation_validation:
            arc_kwargs["cross_situation_validation"] = True
        if args.experiment_timeout is not None:
            arc_kwargs["experiment_timeout_seconds"] = args.experiment_timeout
        if args.max_reported_tokens is not None:
            arc_kwargs["max_reported_tokens"] = args.max_reported_tokens
        if args.review_mode is not None:
            arc_kwargs["review_mode"] = args.review_mode
        if args.reasoning_policy is not None:
            arc_kwargs["reasoning_policy"] = args.reasoning_policy
        if args.reasoning_levels is not None:
            arc_kwargs["reasoning_levels"] = tuple(x.strip() for x in args.reasoning_levels.split(",") if x.strip())
        if args.max_output_tokens is not None:
            arc_kwargs["max_output_tokens"] = args.max_output_tokens
        summary = run_arc_agi_3_e2e(root, **arc_kwargs)
        print(summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(summary.read_text(encoding="utf-8")).get("passed") else 1
    if args.command == "arc-thin-e2e":
        root = (args.root or paths.runs_dir / f"pi-arc-thin-{args.game}-{args.variant}").resolve()
        summary = run_arc_thin_e2e(
            root, arc_root=args.arc_root or paths.arc_agi_3_root, game=args.game, variant=args.variant,
            max_actions=args.max_actions, max_decisions=args.max_decisions,
            max_reported_tokens=args.max_reported_tokens, experiment_timeout_seconds=args.experiment_timeout,
            turn_idle_timeout_seconds=args.turn_idle_timeout,
            consolidate_after_actions=args.consolidate_after, review_on_miss=args.review_on_miss, pi_provider=args.provider, pi_model=args.model,
            thinking=args.thinking, thinking_format=args.thinking_format,
            input_modalities=args.input_modalities, max_output_tokens=args.max_output_tokens,
            ledger=args.ledger, critic=args.critic, carry_reasoning_chars=args.carry_reasoning,
            continuity=args.continuity, continuity_decisions=args.continuity_decisions,
            review_at_level_change=args.level_change_review, stall_review_after=args.stall_review_after,
            spin_review_after=args.spin_review_after,
            foundation=args.foundation, replay_reasoning=args.replay_reasoning,
            extension_env={} if args.auto_compaction is None else {"ARC_THIN_AUTO_COMPACTION": "1" if args.auto_compaction else "0"},
        )
        print(summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(summary.read_text(encoding="utf-8")).get("passed") else 1
    if args.command == "arc-thin-smoke":
        summary = (run_arc_thin_ledger_smoke(args.root) if args.ledger
                   else run_arc_thin_environment_smoke(args.root) if args.environment
                   else run_arc_thin_continuity_smoke(args.root) if args.continuity
                   else run_arc_thin_claims_smoke(args.root) if args.claims
                   else run_arc_thin_self_harness_smoke(args.root) if args.self_harness else run_arc_thin_smoke(args.root))
        print(summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(summary.read_text(encoding="utf-8")).get("passed") else 1
    if args.command == "arc-thin-compaction-probe":
        node, pi_cli = _resolve_pi_cli()
        if _pi_cli_version(Path(pi_cli)) != "0.87.0":
            raise RuntimeError(f"compaction probe requires project Pi 0.87.0, not {pi_cli}")
        root = (args.root or paths.runs_dir / f"arc-thin-compaction-probe-{time.strftime('%Y%m%d-%H%M%S')}").resolve()
        script = Path(__file__).resolve().parents[2] / "tools" / "arc_thin_compaction_probe.ts"
        return subprocess.run([node, "--experimental-transform-types", str(script), str(root), pi_cli],
                              cwd=script.parent.parent, check=False).returncode
    if args.command == "arc-blind-policy":
        root = (args.root or paths.runs_dir / f"arc-blind-{args.policy}-{args.game}-s{args.seed}").resolve()
        summary = run_arc_blind_policy(
            root, arc_root=args.arc_root or paths.arc_agi_3_root, game=args.game,
            policy=args.policy, repeat=args.repeat, seed=args.seed, max_actions=args.max_actions,
            experiment_timeout_seconds=args.experiment_timeout, mock_environment=args.mock_environment,
        )
        print(summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(summary.read_text(encoding="utf-8")).get("passed") else 1
    if args.command == "arc-harness-smoke":
        real_kwargs = {}
        if args.provider_mode == "real":
            real_kwargs = {
                "provider_mode": "real", "max_actions": args.max_actions,
                "experiment_timeout_seconds": args.experiment_timeout,
                "max_reported_tokens": args.max_reported_tokens,
                "max_output_tokens": args.max_output_tokens,
                "reasoning_policy": args.reasoning_policy,
                "reasoning_levels": tuple(x.strip() for x in args.reasoning_levels.split(",") if x.strip())
                    if args.reasoning_levels is not None else None,
            }
        summary = run_arc_harness_smoke(
            args.root,
            arc_root=args.arc_root or paths.arc_agi_3_root,
            game=args.game,
            mock_environment=args.mock_environment,
            case=args.case,
            **real_kwargs,
        )
        value = json.loads(summary.read_text(encoding="utf-8"))
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0 if value.get("passed") is True else 1
    if args.command == "arc-method-audit":
        audit_path = write_arc_method_evolution_audit(args.root)
        value = json.loads(audit_path.read_text(encoding="utf-8"))
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0 if value.get("complete") is True else 1
    if args.command == "terminal-bench-e2e":
        root = (args.root or paths.runs_dir / f"pi-terminal-bench-{args.task}").resolve()
        summary = run_terminal_bench_e2e(
            root,
            dataset=args.dataset or paths.terminal_bench_dataset,
            task_id=args.task,
            experiment_variant=args.variant,
            timeout=args.timeout,
            model=args.model,
            context_compaction=args.context_compaction,
        )
        print(summary.read_text(encoding="utf-8"), end="")
        return 0 if json.loads(summary.read_text(encoding="utf-8")).get("passed") else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
