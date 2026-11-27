"""Run a real layered ARC preset. Credentials come from the configured dotenv source."""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from autoresearch_pi.arc_layered_e2e import run_arc_layered_e2e
from autoresearch_pi.project import load_project_dotenv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--preset", type=Path, default=ROOT / "config/arc-layered-real-az-qwen27b.json")
    parser.add_argument("--fork-from", type=Path)
    parser.add_argument("--snapshot-after-segments", type=int, nargs="*", default=[])
    parser.add_argument("--transfer-from", type=Path, help="Confirmed source capabilities exported by arc_layered_experiments")
    parser.add_argument("--recoverable-fold", action="store_true", help="Enable the experimental recoverable-fold arm")
    args = parser.parse_args()
    preset = json.loads(args.preset.read_text(encoding="utf-8-sig"))
    arc_root = Path(preset["arc_root"])
    credentials = load_project_dotenv(Path(preset.get("credential_root", arc_root)), environment={})
    if preset.get("credential_root") and credentials.get("OPENAI_API_BASE", "").rstrip("/") != preset["base_url"]:
        parser.error("Credential source is not configured for the preset endpoint")
    key = credentials.get(preset["api_key_env"])
    if not key:
        parser.error(f'Missing {preset["api_key_env"]} in the configured .env')
    if args.root.exists() and any(args.root.iterdir()):
        parser.error("Choose a fresh run directory")
    os.environ.update(ARC_OPENAI_API_BASE=preset["base_url"], ARC_OPENAI_API_KEY=key,
                      ARC_PI_API=preset["api"], ARC_PI_THINKING_FORMAT=preset["thinking_format"])
    print(run_arc_layered_e2e(
        args.root, arc_root=arc_root, game=preset["game"], pi_provider=preset["provider"],
        pi_model=preset["model"], thinking=preset["thinking"], profile=preset["profile"],
        config=preset["config"], benchmark_only=preset["benchmark_only"],
        extension_env={**preset["extension_env"], **({"ARC_LAYERED_RECOVERABLE_FOLD": "1"} if args.recoverable_fold else {})},
        fork_from=args.fork_from, snapshot_after_segments=tuple(args.snapshot_after_segments), transfer_from=args.transfer_from, dotenv_root=arc_root,
    ), flush=True)


if __name__ == "__main__":
    main()
