from pathlib import Path
from zipfile import ZipFile

from autoresearch_pi.meta_harness_demo import NativeEvidence, run_demo


def fake_native_probe(root: Path, _extension: Path) -> NativeEvidence:
    return NativeEvidence(
        "test",
        {"value": "summary_only"},
        {"value": "source_and_date"},
        {"value": "source_and_date"},
    )


def test_demo_emits_valid_office_artifact_and_two_handoffs(tmp_path: Path):
    result = run_demo(tmp_path, native_probe=fake_native_probe)

    assert result.score == 1.0
    assert result.auto_research_handoff.is_file()
    assert result.self_harness_handoff.is_file()
    assert result.round_hierarchy.is_file()
    with ZipFile(result.artifact) as archive:
        assert "word/document.xml" in archive.namelist()

    hierarchy = result.round_hierarchy.read_text(encoding="utf-8")
    for decision in ("iterate", "nest", "return", "prune", "adapt_harness", "terminate"):
        assert decision in hierarchy


def test_demo_rejects_unobserved_native_mutation(tmp_path: Path):
    def unobserved(root: Path, extension: Path) -> NativeEvidence:
        del root, extension
        return NativeEvidence(
            "test",
            {"value": "summary_only"},
            {"value": "source_and_date"},
            {"value": "summary_only"},
        )

    try:
        run_demo(tmp_path, native_probe=unobserved)
    except RuntimeError as exc:
        assert "did not observe" in str(exc)
    else:
        raise AssertionError("unobserved mutation must fail the smoke")
