from pathlib import Path

from hos.harness_runtime import KernelHarnessRuntime


def test_runtime_supports_harness_defined_checkpoint_boundaries(tmp_path: Path) -> None:
    runtime = KernelHarnessRuntime(tmp_path)
    session = runtime.open("sha256:" + "a" * 64)
    runtime.observe(session, "tool_result", command="redacted-locally")
    checkpoint = runtime.checkpoint(session, boundary="action", trigger="stagnation", evidence_ref="evidence-1")
    runtime.close(session, status="completed")

    assert checkpoint.boundary == "action"
    events = (tmp_path / "harness-events.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(events) == 4
    assert '"type":"harness.checkpoint"' in events[2]


def test_event_sequence_continues_across_runtime_instances(tmp_path: Path) -> None:
    path = tmp_path / "harness-events.jsonl"
    first = KernelHarnessRuntime(tmp_path)
    first.open("sha256:" + "b" * 64)
    second = KernelHarnessRuntime(tmp_path)
    second.open("sha256:" + "c" * 64)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert [int(__import__("json").loads(line)["seq"]) for line in lines] == [1, 2]
