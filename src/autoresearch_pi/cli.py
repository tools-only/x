"""CLI placeholder for the isolated Pi-backed autoresearch runtime."""

from __future__ import annotations

from .project import ProjectPaths


def main() -> int:
    paths = ProjectPaths.from_environment()
    paths.assert_isolated()
    print(f"project={paths.root}")
    print(f"jit_root={paths.jit_root}")
    print(f"autoresearch_root={paths.autoresearch_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
