"""Production native runner/bridge/Pi with a once-only SDK None result; no paid provider or live ARC."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from autoresearch_pi.arc_thin_e2e import PROJECT_ROOT, SMOKE_PROVIDER, run_arc_thin_e2e

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
os.environ.update(MOCK_ARC_FAIL_AFTER="1", MOCK_ARC_FAIL_MARKER=str(root / "failed-once"))
path = run_arc_thin_e2e(
    root, arc_root=PROJECT_ROOT, game="mock", foundation="native", max_decisions=3,
    consolidate_after_actions=100, experiment_timeout_seconds=180, decision_timeout_seconds=60,
    pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
    bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",),
    ledger=False, critic=False, review_at_level_change=False, max_environment_restarts=1,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "restart", "ARC_THIN_AUTO_COMPACTION": "0"})
summary = json.loads(path.read_text(encoding="utf-8"))
read = lambda p: [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
assert summary["stop_reason"] == "max_decisions", summary
assert summary["actions"] == 2 and len(summary["environment_restarts"]) == 1, summary
restart = summary["environment_restarts"][0]
assert restart["after_action"] == 1 and restart["error"]["type"] == "EnvironmentReturnedNoFrame", restart
assert not any(row.get("fatal") for row in read(root / "harness/errors.jsonl"))
assert [row["n"] for row in read(root / "harness/trajectory.jsonl")] == [1, 2]
assert len(read(root / "restart-replay-1.jsonl")) == 1
assert read(root / "harness/trajectory.jsonl")[-1]["budget"]["total_used"] == 2
print(json.dumps({"passed": True, "actions": 2, "restart": restart}, ensure_ascii=False))
