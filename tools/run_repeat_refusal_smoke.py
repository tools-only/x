"""Gateway refusal smoke (docs/plans/2026-10-16-provider-repeat-refusal.md): mock SDK, production bridge, actual Pi and
WASI, and the scripted provider imitating the yibu gateway: a request whose messages repeat an identical tool call in 5
consecutive rounds is refused (stop=error, no usage).

1. Default transcript: decision 2 makes one python call five times, and the request after it is refused. The next
   decision's history shows the five rounds once, with their count; its request is accepted and it acts.
2. ARC_THIN_COLLAPSE_REPEATS=0: every later request carries the five rounds and is refused, and the run stops after 3
   refused turns in a row (stop_reason provider_error) instead of continuing without usage.
   Parts 1 and 2 test recovery, so the loop guard's count of repeated calls that succeeded is off there
   (ARC_THIN_LOOP_RESULTS=0); with it on, the third identical call already ends the decision.
3. Defaults: the third identical call with the same result ends decision 2, no request is refused, and the next
   decision acts.
"""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from autoresearch_pi.arc_thin_e2e import PROJECT_ROOT, SMOKE_PROVIDER, run_arc_thin_e2e

root = Path(sys.argv[1])
os.environ["ARC_THIN_SMOKE_GATEWAY_REPEATS"] = "5"  # read by the scripted provider inside Pi
common = dict(arc_root=PROJECT_ROOT, game="ls20", foundation="native", consolidate_after_actions=100,
              experiment_timeout_seconds=240, decision_timeout_seconds=900, pi_provider="offline-arc-thin-smoke",
              pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER, bridge_python=Path(sys.executable),
              bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",), ledger=False, critic=False,
              review_at_level_change=False, max_decisions=5, max_no_action_decisions=10)
read = lambda path: [json.loads(s) for s in path.read_text(encoding="utf-8").splitlines() if s.strip()] if path.exists() else []
script = {"ARC_THIN_SMOKE_SCRIPT": "repeat", "ARC_THIN_AUTO_COMPACTION": "0"}
recovery = {**script, "ARC_THIN_LOOP_RESULTS": "0"}

collapsed = json.loads(run_arc_thin_e2e(root / "collapse", extension_env=recovery, **common).read_text(encoding="utf-8"))
rows = read(root / "collapse/harness/trajectory.jsonl")
refusals = read(root / "collapse/gateway-refusals.jsonl")
assert collapsed["passed"] and collapsed["stop_reason"] == "max_decisions", collapsed
assert len(refusals) == 1 and refusals[0]["longest"] == 5, refusals
assert collapsed["provider_errors"] == 1, collapsed["provider_errors"]
assert [r["action"] for r in rows[:2]] == ["ACTION1", "ACTION4"] and rows[1].get("note") == "after the refusal", rows
requests = [r for r in read(root / "collapse/smoke-requests.jsonl") if not r.get("analyst") and not r.get("critic")]
after = next(r for r in requests if any(call == ["arc_action", {"action": "ACTION4", "note": "after the refusal"}]
                                        for call in (r.get("planned") or {}).get("calls", [])))
python_rounds = [m for m in after["transcript"] if m["role"] == "assistant" and any(c["name"] == "python" for c in m.get("calls", []))]
assert len(python_rounds) == 1, [m.get("calls") for m in after["transcript"]]
notes = [m["text"] for m in after["transcript"] if m["role"] == "toolResult"]
assert any(text.startswith("(This call was made 5 times in a row; every result was the same:)") for text in notes), notes

kept = json.loads(run_arc_thin_e2e(root / "every-copy", extension_env={**recovery, "ARC_THIN_COLLAPSE_REPEATS": "0"},
                                   **common).read_text(encoding="utf-8"))
kept_rows = read(root / "every-copy/harness/trajectory.jsonl")
kept_refusals = read(root / "every-copy/gateway-refusals.jsonl")
assert not kept["passed"] and kept["stop_reason"] == "provider_error", kept["stop_reason"]
assert kept["provider_errors"] == 3 and len(kept_refusals) == 3, (kept["provider_errors"], kept_refusals)
assert "Repetitive tool calls detected" in kept["error"], kept["error"]
assert [r["action"] for r in kept_rows] == ["ACTION1"], kept_rows
config = json.loads((root / "every-copy/run-config.json").read_text(encoding="utf-8"))
assert config["max_provider_errors"] == 3, config

guarded = json.loads(run_arc_thin_e2e(root / "guarded", extension_env=script, **common).read_text(encoding="utf-8"))
guarded_rows = read(root / "guarded/harness/trajectory.jsonl")
assert guarded["passed"] and guarded["stop_reason"] == "max_decisions", guarded["stop_reason"]
assert not read(root / "guarded/gateway-refusals.jsonl") and guarded["provider_errors"] == 0, guarded["provider_errors"]
assert [r["action"] for r in guarded_rows[:2]] == ["ACTION1", "ACTION4"], guarded_rows
guarded_requests = [r for r in read(root / "guarded/smoke-requests.jsonl") if not r.get("analyst") and not r.get("critic")]
ended = [m["text"] for r in guarded_requests for m in r["transcript"] if m["role"] == "toolResult"
         and "Three identical observations/errors without a state or workspace change" in m["text"]]
assert ended, 'the third identical call ended decision 2'
print(json.dumps({"collapse": {"actions": len(rows), "refusals": len(refusals), "stop": collapsed["stop_reason"]},
                  "every_copy": {"actions": len(kept_rows), "refusals": len(kept_refusals), "stop": kept["stop_reason"]},
                  "guarded": {"actions": len(guarded_rows), "refusals": 0, "stop": guarded["stop_reason"]}}))
