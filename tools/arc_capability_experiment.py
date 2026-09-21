"""Launch a bounded, real-provider ARC experiment from credential-free source snapshots."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def prepare_snapshot(project: Path, destination: Path, settings: dict) -> Path:
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("experiment destination must be empty")
    source = destination / "source"
    source.mkdir(parents=True)
    hashes = {}
    for directory in ("src", "demo", "tools"):
        for original in sorted((project / directory).rglob("*")):
            if not original.is_file() or original.suffix not in {".py", ".ts", ".md"}:
                continue
            relative = original.relative_to(project)
            target = source / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            hashes[relative.as_posix()] = hashlib.sha256(target.read_bytes()).hexdigest()
    (destination / "experiment.json").write_text(json.dumps({
        "created_at": datetime.now(timezone.utc).isoformat(),
        "settings": settings, "source_sha256": hashes,
        "provider_mocked": False, "environment_mocked": False,
        "acceptance": "manager evidence audit required; completion is not capability success",
    }, indent=2) + "\n", encoding="utf-8")
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--game", default="ls20")
    parser.add_argument("--max-actions", type=int, default=60)
    parser.add_argument("--seconds", type=float, default=2700)
    parser.add_argument(
        "--max-output-tokens",
        type=positive_int,
        default=65536,
        help="Maximum tokens requested from the provider per parent or child response.",
    )
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    environment = dict(os.environ)
    # Same simple KEY=value format as project.load_project_dotenv, but explicitly
    # select the user-approved DeepSeek profile without modifying either .env.
    for raw in (project / ".env_deepseek").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        environment[key.strip()] = value
    environment.update({
        "ARC_OPENAI_API_BASE": environment["OPENAI_API_BASE"],
        "ARC_OPENAI_API_KEY": environment["OPENAI_API_KEY"],
        "ARC_MODEL": "a:deepseek-v4-flash",
        "ARC_PI_API": "openai-completions",
        "ARC_MODEL_MAX_OUTPUT_TOKENS": str(args.max_output_tokens),
    })
    root = args.root.resolve()
    source = prepare_snapshot(project, root, {
        "model": environment["ARC_MODEL"], "game": args.game,
        "max_actions": args.max_actions, "pi_runtime_seconds": args.seconds,
        "max_output_tokens": args.max_output_tokens,
        "variant": "treatment", "context_compaction": True,
        "harness_validation": False, "auto_research_validation": False,
    })
    environment["PYTHONPATH"] = str(source / "src")
    command = [sys.executable, "-m", "autoresearch_pi.cli", "arc-agi-3-e2e",
               "--root", str(root / "run"), "--game", args.game,
               "--max-actions", str(args.max_actions), "--experiment-timeout", str(args.seconds),
               "--variant", "treatment", "--context-compaction"]
    print(json.dumps({"experiment": str(root), "model": environment["ARC_MODEL"],
                      "max_actions": args.max_actions, "seconds": args.seconds,
                      "max_output_tokens": args.max_output_tokens}), flush=True)
    with (root / "runner-output.log").open("w", encoding="utf-8") as output:
        result = subprocess.run(command, cwd=source, env=environment, stdout=output,
                                stderr=subprocess.STDOUT)
    print(json.dumps({"exit_code": result.returncode, "summary": str(root / "run/summary.json")}), flush=True)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
