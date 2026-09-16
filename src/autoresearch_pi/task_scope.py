"""Seal an owned task at shutdown, retaining audit artifacts, not live cache."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def seal_task_scope(root: Path) -> bool:
    root = root.resolve()
    marker = root / ".task-scope.json"
    if not marker.is_file():
        return False
    value = json.loads(marker.read_text(encoding="utf-8"))
    if value.get("format") != "task-local-scope-v1" or Path(value["root"]).resolve() != root:
        raise ValueError("refusing cleanup of a mismatched task scope")
    cache = root / "task-context-cache"
    # Never traverse links or delete the run root. Only our named cache file is
    # removed; unexpected files are retained for diagnosis, not recursively erased.
    if cache.is_symlink() or cache.resolve().parent != root:
        raise ValueError("refusing cleanup of an external cache path")
    if cache.exists():
        journal = cache / "messages.jsonl"
        if journal.is_symlink() or journal.resolve().parent != cache.resolve():
            raise ValueError("refusing cleanup of an external cache file")
        journal.unlink(missing_ok=True)
        child_results = cache / "auto-research-child-results"
        if child_results.exists():
            if child_results.is_symlink() or child_results.resolve().parent != cache.resolve():
                raise ValueError("refusing cleanup of an external child-result cache")
            for result in child_results.iterdir():
                if (
                    result.is_symlink()
                    or not result.is_file()
                    or result.resolve().parent != child_results.resolve()
                    or not result.name.startswith("auto-research-")
                    or result.suffix != ".json"
                ):
                    raise ValueError("refusing cleanup of an unexpected child-result cache entry")
                result.unlink()
            child_results.rmdir()
        if not any(cache.iterdir()):
            cache.rmdir()
    value.update(status="closed", closedAt=datetime.now(timezone.utc).isoformat())
    temporary = root / ".task-scope.json.tmp"
    temporary.write_text(json.dumps(value) + "\n", encoding="utf-8")
    temporary.replace(marker)
    return True
