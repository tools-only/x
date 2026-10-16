"""Gateway refusal smoke (docs/plans/2026-10-16-provider-repeat-refusal.md): mock SDK, production bridge, actual Pi and
WASI, and the scripted provider imitating the yibu gateway: a request whose messages repeat an identical tool call in 5
consecutive rounds is refused (stop=error, no usage). Rounds are counted across decision prompts, as the gateway does.

1. Default transcript: decision 2 makes one python call five times, and the request after it is refused. The next
   decision's history shows the five rounds once, with their count; its request is accepted and it acts.
2. ARC_THIN_COLLAPSE_REPEATS=0: every later request carries the five rounds and is refused, and the run stops after 3
   refused turns in a row (stop_reason provider_error) instead of continuing without usage.
   Parts 1 and 2 test recovery, so the loop guard's count of repeated calls that succeeded is off there
   (ARC_THIN_LOOP_RESULTS=0); with it on, the third identical call already ends the decision.
3. Defaults: the third identical call with the same result ends decision 2, no request is refused, and the next
   decision acts.
4. Repeats across decisions (docs/plans/2026-10-17-su15-level2-loop.md, iteration L1; MOCK_ARC_STILL_ACTIONS=ACTION3
   changes only the counter cell). Decision 1 sends RESET, which is not available before the first action: the tool
   refuses it with what is available, and the decision plays ACTION3. Decisions 2-3 play ACTION3 again. In decision 4
   it is refused (three plays in a row changed 1 cell each), and the third identical refusal ends the decision. Decision
   5 plays ACTION1. No request is refused: the history shows the plays across decisions 1-3 once, and the refusals once.
5. The same with ARC_THIN_COLLAPSE_REPEATS=0: from decision 4 on the requests carry 5 identical calls in a row and are
   refused, and the run stops as provider_error.
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

os.environ["MOCK_ARC_STILL_ACTIONS"] = "ACTION3"  # read by the mock SDK inside the bridge
still_env = {"ARC_THIN_SMOKE_SCRIPT": "still", "ARC_THIN_AUTO_COMPACTION": "0"}
still = json.loads(run_arc_thin_e2e(root / "still", extension_env=still_env, **{**common, "max_decisions": 7}).read_text(encoding="utf-8"))
still_rows = read(root / "still/harness/trajectory.jsonl")
assert still["passed"] and still["stop_reason"] == "max_decisions", still["stop_reason"]
assert not read(root / "still/gateway-refusals.jsonl") and still["provider_errors"] == 0, still["provider_errors"]
assert [r["action"] for r in still_rows[:4]] == ["ACTION3", "ACTION3", "ACTION3", "ACTION1"], still_rows
assert [r["changed_cells"] for r in still_rows[:3]] == [1, 1, 1], still_rows
assert still_rows[3].get("note") == "something else" and still_rows[3]["decision"] == 5, still_rows[3]
still_requests = [r for r in read(root / "still/smoke-requests.jsonl") if not r.get("analyst") and not r.get("critic")]
results = [m["text"] for r in still_requests for m in r["transcript"] if m["role"] == "toolResult"]
assert any("action 'RESET' is not currently available (available now: ACTION1, ACTION2, ACTION3, ACTION4); nothing was played"
           in text for text in results), 'an unavailable action is refused with what is available'
assert any("ACTION3 was NOT played: the last 3 actions (#1-#3) were this same action and each changed at most 2 cells; "
           "play a different action" in text for text in results), 'the fourth ACTION3 is refused'
assert any("Repeated unchanged error; decision ends: ACTION3 was NOT played" in text for text in results), \
    'the third identical refusal ends decision 4'
fifth = next(r for r in still_requests if any(call == ["arc_action", {"action": "ACTION1", "note": "something else"}]
                                              for call in (r.get("planned") or {}).get("calls", [])))
still_rounds = [m for m in fifth["transcript"] if m["role"] == "assistant"
                and any(c["arguments"].get("action") == "ACTION3" for c in m.get("calls", []))]
assert len(still_rounds) == 2, [m.get("calls") for m in fifth["transcript"]]
still_notes = [m["text"] for m in fifth["transcript"] if m["role"] == "toolResult"]
assert any(text.startswith("(This call was made 3 times in a row, in 3 decisions; 2 earlier results are not shown; their action "
                           "receipts:\n#1 ACTION3") for text in still_notes), still_notes
assert any(text.startswith("(This call was made 3 times in a row; 2 earlier results are not shown\nThe last result:)\n"
                           "Repeated unchanged error") for text in still_notes), still_notes

every = json.loads(run_arc_thin_e2e(root / "still-every-copy", extension_env={**still_env, "ARC_THIN_COLLAPSE_REPEATS": "0"},
                                    **{**common, "max_decisions": 7}).read_text(encoding="utf-8"))
every_refusals = read(root / "still-every-copy/gateway-refusals.jsonl")
assert not every["passed"] and every["stop_reason"] == "provider_error", every["stop_reason"]
assert every["provider_errors"] == 3 and len(every_refusals) == 3 and all(r["longest"] == 5 for r in every_refusals), every_refusals
assert [r["action"] for r in read(root / "still-every-copy/harness/trajectory.jsonl")] == ["ACTION3"] * 3
del os.environ["MOCK_ARC_STILL_ACTIONS"]
print(json.dumps({"collapse": {"actions": len(rows), "refusals": len(refusals), "stop": collapsed["stop_reason"]},
                  "every_copy": {"actions": len(kept_rows), "refusals": len(kept_refusals), "stop": kept["stop_reason"]},
                  "guarded": {"actions": len(guarded_rows), "refusals": 0, "stop": guarded["stop_reason"]},
                  "still": {"actions": len(still_rows), "refusals": 0, "stop": still["stop_reason"]},
                  "still_every_copy": {"refusals": len(every_refusals), "stop": every["stop_reason"]}}))
