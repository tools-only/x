from __future__ import annotations

from pathlib import Path


def scoped_root(root: Path | str, scope: str) -> Path:
    """Add a command scope while preserving explicit legacy root names."""
    path = Path(root)
    name = path.name
    lower_name = name.lower()
    if lower_name.startswith((".meta-", ".task-", "meta-", "task-")):
        return path
    if "-meta-" in lower_name or "-task-" in lower_name:
        return path
    clean_name = name[1:] if name.startswith(".") else name
    prefix = f".{scope}-" if name.startswith(".") else f"{scope}-"
    return path.with_name(prefix + clean_name)
