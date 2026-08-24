from pathlib import Path

from hos.paths import scoped_root


def test_scoped_root_adds_meta_or_task_prefix_to_base_name(tmp_path: Path) -> None:
    root = tmp_path / ".ls20-offline"

    assert scoped_root(root, "meta") == tmp_path / ".meta-ls20-offline"
    assert scoped_root(root, "task") == tmp_path / ".task-ls20-offline"


def test_scoped_root_preserves_explicit_legacy_scope_names(tmp_path: Path) -> None:
    root = tmp_path / ".ls20-meta-offline"

    assert scoped_root(root, "meta") == root
    assert scoped_root(root, "task") == root
