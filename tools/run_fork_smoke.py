"""Matched-prefix evaluation smoke (docs/plans/2026-10-14-matched-prefix-evaluation.md): mock SDK, production bridge,
actual Pi and WASI.

1. A source run (the activation script) snapshots its state after decision 3.
2. A fork starts from that snapshot: the bridge replays the source's actions and checks every grid, Pi continues the
   source's session, the python session keeps the names decision 3 defined, and new actions continue the numbering.
3. A snapshot whose recorded grid was altered cannot be forked: the replay stops at the bridge.
4. A step that does not return (once, at the second action) ends its decision; before the next one the runner starts a
   new game on the same port and token and replays the recorded action with its grid checked. The next decision is told,
   and its action continues the numbering.
5. A source that stops at its first level (snapshot_at_levels, max_levels) leaves a snapshot right after the level
   change, and a fork from it plays on from level 2's start.
"""
import json
import os
import shutil
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from autoresearch_pi.arc_thin_e2e import PROJECT_ROOT, SMOKE_PROVIDER, run_arc_thin_e2e

root = Path(sys.argv[1])
common = dict(arc_root=PROJECT_ROOT, game="ls20", foundation="native", consolidate_after_actions=100,
              experiment_timeout_seconds=240, decision_timeout_seconds=900, pi_provider="offline-arc-thin-smoke",
              pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER, bridge_python=Path(sys.executable),
              bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",), ledger=False, critic=False,
              review_at_level_change=False)
read = lambda path: [json.loads(s) for s in path.read_text(encoding="utf-8").splitlines() if s.strip()]

source = json.loads(run_arc_thin_e2e(root / "source", max_decisions=3, snapshot_after_decisions=(3,),
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "activation", "ARC_THIN_AUTO_COMPACTION": "0"}, **common).read_text(encoding="utf-8"))
assert source["passed"], source
snapshot = root / "source/snapshots/after-decision-3"
meta = json.loads((snapshot / "snapshot.json").read_text(encoding="utf-8"))
source_actions = read(root / "source/harness/trajectory.jsonl")
assert meta["decision"] == 3 and meta["actions"] == len(source_actions) > 0, (meta, len(source_actions))
assert (snapshot / "session.jsonl").is_file() and (snapshot / ".harness/python_session/HEAD.json").is_file()

fork = json.loads(run_arc_thin_e2e(root / "fork", max_decisions=2, fork_from=snapshot,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "fork", "ARC_THIN_AUTO_COMPACTION": "0"}, **common).read_text(encoding="utf-8"))
assert fork["passed"], fork
k = meta["actions"]
assert fork["fork"]["actions"] == k and fork["fork"]["decision"] == 3, fork["fork"]
config = json.loads((root / "fork/run-config.json").read_text(encoding="utf-8"))
assert config["fork"]["source"] == str(snapshot.resolve()), config["fork"]
events = read(root / "fork/bridge-events.jsonl")
assert any(e.get("event") == "fork_replayed" and e.get("actions") == k for e in events), [e.get("event") for e in events]
trajectory = read(root / "fork/harness/trajectory.jsonl")
assert [r["n"] for r in trajectory[:k]] == [r["n"] for r in source_actions], 'the prefix is the source\'s'
new = trajectory[k:]
assert new and new[0]["n"] == k + 1 and new[0]["action"] == "ACTION4" and new[0].get("note") == "after fork", new
assert (new[0].get("budget") or {}).get("total_used") == k + 1, new[0]
requests = read(root / "fork/smoke-requests.jsonl")
results = json.dumps([r for request in requests for r in request.get("last_tool_results", [])])
assert f"[42,{k}]" in results.replace(" ", ""), results[:2000]
first = next(r for r in requests if not r.get("analyst") and not r.get("critic"))
# Earlier decisions reach the forked parent as a transcript (several user turns) or, with a history summary, as one section.
assert first["roles"].count("user") > 1 or "RECENT HISTORY" in first.get("current", ""), 'the forked parent sees the source\'s earlier decisions'

bad = root / "bad-snapshot"
shutil.copytree(snapshot, bad)
states = read(bad / "harness/states.jsonl")
last = max(i for i, row in enumerate(states) if isinstance(row.get("grid"), list))
states[last]["grid"][0][0] = (states[last]["grid"][0][0] + 1) % 16
(bad / "harness/states.jsonl").write_text("".join(json.dumps(row) + "\n" for row in states), encoding="utf-8")
refused = json.loads(run_arc_thin_e2e(root / "bad-fork", max_decisions=1, fork_from=bad,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "fork", "ARC_THIN_AUTO_COMPACTION": "0"}, **common).read_text(encoding="utf-8"))
assert not refused["passed"] and str(refused["stop_reason"]).startswith("runner_error"), refused
assert "bridge_start_retries" not in refused, 'a replay mismatch is not a transient start failure and is never retried'
error = json.loads((root / "bad-fork/bridge-error.json").read_text(encoding="utf-8"))
assert error["environment_error"]["type"] == "ReplayMismatch", error

# The bridge gives up on a step after 90 s; the mock's second step outlasts it, once per marker file.
os.environ.update({"MOCK_ARC_HANG_AT": "2", "MOCK_ARC_HANG_MARKER": str(root / "hang-marker"), "MOCK_ARC_HANG_SECONDS": "100"})
restart = json.loads(run_arc_thin_e2e(root / "restart", max_decisions=3,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "restart", "ARC_THIN_AUTO_COMPACTION": "0"}, **common).read_text(encoding="utf-8"))
assert restart["passed"] and restart["stop_reason"] == "max_decisions", restart
[record] = restart["environment_restarts"]
assert record["cause"] == "outcome_unknown" and record["after_action"] == 1 \
    and record["error"].get("type") == "EnvironmentCallTimeout", record
assert restart["no_action_decisions"] == 0 and restart["harness"]["environment_errors"] == 1, restart
restart_rows = read(root / "restart/harness/trajectory.jsonl")
assert [(r["n"], r["action"], (r.get("budget") or {}).get("total_used")) for r in restart_rows] \
    == [(1, "ACTION1", 1), (2, "ACTION1", 2)], restart_rows
restart_events = read(root / "restart/bridge-events.jsonl")
assert [e["index"] for e in restart_events if e.get("event") == "action"] == [1, 2], 'the replayed action is on record once'
assert [e.get("event") for e in restart_events].count("environment_restarted") == 1, [e.get("event") for e in restart_events]
assert (root / "restart/bridge-stderr-restart1.log").is_file(), 'the first bridge\'s log is kept'
restart_parent = [r for r in read(root / "restart/smoke-requests.jsonl") if not r.get("analyst") and not r.get("critic")]
assert len(restart_parent) == 3 and restart_parent[-1]["current"].startswith(
    "Decide the next action. (The environment stopped answering during an action and was restarted at the state after "
    "action #1, the last one recorded; that action has an unknown outcome on the old scorecard; only confirmed actions were replayed.)"), [r["current"][:200] for r in restart_parent]
assert "(The environment" not in restart_parent[1]["current"][:200], 'the note is given once, after the restart'
# The mock board completes level 1 of 2 on the first step (the bridge inherits this environment).
for name in ("MOCK_ARC_HANG_AT", "MOCK_ARC_HANG_MARKER", "MOCK_ARC_HANG_SECONDS"):
    os.environ.pop(name, None)
os.environ["MOCK_ARC_LEVEL_AT"] = "1"
level_source = json.loads(run_arc_thin_e2e(root / "level-source", max_decisions=5, snapshot_at_levels=(1,), max_levels=1,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "restart", "ARC_THIN_AUTO_COMPACTION": "0"}, **common).read_text(encoding="utf-8"))
assert level_source["passed"] and level_source["stop_reason"] == "max_levels" and level_source["decisions"] == 1, level_source
level_snapshot = root / "level-source/snapshots/after-decision-1"
assert json.loads((level_snapshot / "snapshot.json").read_text(encoding="utf-8"))["actions"] == 1
level_config = json.loads((root / "level-source/run-config.json").read_text(encoding="utf-8"))
assert level_config["max_levels"] == 1 and level_config["snapshot_at_levels"] == [1], level_config
level_fork = json.loads(run_arc_thin_e2e(root / "level-fork", max_decisions=1, max_levels=2, fork_from=level_snapshot,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": "restart", "ARC_THIN_AUTO_COMPACTION": "0"}, **common).read_text(encoding="utf-8"))
assert level_fork["passed"] and level_fork["stop_reason"] == "max_decisions", level_fork["stop_reason"]
level_rows = read(root / "level-fork/harness/trajectory.jsonl")
assert [(r["n"], r["level_changed"], r["levels_completed"]) for r in level_rows] == [(1, True, 1), (2, False, 1)], level_rows
print(json.dumps({"source_actions": k, "fork_actions": len(new), "refused": refused["stop_reason"],
                  "restart": {key: record[key] for key in ("after_action", "attempts", "seconds")},
                  "level_fork_actions": len(level_rows) - 1}))
