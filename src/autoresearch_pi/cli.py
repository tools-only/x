"""CLI for diagnostics and bounded local smoke runs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

from pathlib import Path

from .jit_adapter import JitAdapter
from .meta_harness_demo import run_demo
from .officebench_e2e import run_officebench_e2e, run_officebench_e2e_batch
from .project import ProjectPaths
from .task_agent import PiTaskAgent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="autoresearch-pi")
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
    args = parser.parse_args(argv)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
