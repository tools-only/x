from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from arc_agi import Arcade, OperationMode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Download ARC-AGI-3 games for offline use")
    parser.add_argument(
        "game_id",
        nargs="?",
        help="Game ID, for example ls20 or ls20-1234abcd; omit to download all games",
    )
    parser.add_argument(
        "--environments-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "environment_files",
        help="Directory where game source and metadata are stored",
    )
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    if not os.environ.get("ARC_API_KEY"):
        raise SystemExit("ARC_API_KEY is required for downloading an ARC-AGI-3 game")

    environments_dir = arguments.environments_dir.expanduser().resolve()
    environments_dir.mkdir(parents=True, exist_ok=True)
    arcade = Arcade(
        operation_mode=OperationMode.NORMAL,
        environments_dir=str(environments_dir),
    )
    if arguments.game_id:
        game_ids = [arguments.game_id]
    else:
        game_ids = sorted({environment.game_id for environment in arcade.get_environments()})
        if not game_ids:
            raise SystemExit("ARC-AGI-3 returned no games to download")

    failed: list[str] = []
    for index, game_id in enumerate(game_ids, start=1):
        print(f"[{index}/{len(game_ids)}] downloading {game_id}", flush=True)
        game = arcade.make(
            game_id,
            save_recording=False,
            include_frame_data=False,
        )
        if game is None:
            print(f"failed to download or prepare {game_id!r}", file=sys.stderr)
            failed.append(game_id)

    print(f"downloaded {len(game_ids) - len(failed)}/{len(game_ids)} game(s) into {environments_dir}")
    if failed:
        print(f"failed games: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
