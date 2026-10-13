"""Bounded native smoke: mock SDK, production bridge, actual Pi and WASI."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from autoresearch_pi.arc_thin_e2e import PROJECT_ROOT, SMOKE_PROVIDER, run_arc_thin_e2e
from autoresearch_pi import arc_thin_e2e
from autoresearch_pi.pi_kernel import PiKernel

root = Path(sys.argv[1])
script = sys.argv[2] if len(sys.argv) > 2 else "foundation"
defaults = len(sys.argv) > 3 and sys.argv[3] == 'defaults'
uncapped = len(sys.argv) > 3 and sys.argv[3] == 'uncapped'
# 'banded' narrows the native history bands so a short smoke crosses all three (verbatim, condensed, dropped).
banded = len(sys.argv) > 3 and sys.argv[3] == 'banded'
if script == 'migration':
    class MigrationKernel(PiKernel):
        def start(self):
            if getattr(self, 'seeded', False):
                return super().start()
            self.seeded = True
            store = root / 'harness'
            store.mkdir(exist_ok=True)
            records = {
                'skills': [dict(name='old', version=3, description='reads old artifacts', observe=False,
                    source='def run(state, args):\n    return state["artifacts"]["route"] + args.get("extra", 0)\n'),
                    dict(name='producer', version=2, description='returns legacy artifacts', observe=False,
                    source='def run(state, args):\n    return {"artifacts":{"route":50}}\n')],
                'memory': [dict(key='controls', text='LEGACY_NOTE_EXACT', at=0)],
                'prompt': [dict(text='LEGACY_STANDING_RULE')],
                'artifacts': [dict(name='route', n=0, level=0, skill='producer', version=1, value=40, chars=2)],
            }
            for name, rows in records.items():
                (store / (name + '.jsonl')).write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
            return super().start()
    arc_thin_e2e.PiKernel = MigrationKernel
if script == "receipts":
    class ProbeKernel(PiKernel):
        def start(self):
            settings = Path(self.env["PI_CODING_AGENT_DIR"]) / "settings.json"
            settings.write_text(json.dumps({"compaction": {"enabled": False, "keepRecentTokens": 100, "reserveTokens": 1000}}), encoding="utf-8")
            return super().start()
        def wait_for_agent_events(self, *args, **kwargs):
            events = super().wait_for_agent_events(*args, **kwargs)
            if not getattr(self, "probed", False):
                self.probed = True
                # Additional canonical user entries move the completed long-output turn into the summarize range.
                for _ in range(3):
                    self.prompt("Checkpoint before restart; retain exact result refs.")
                    super().wait_for_agent_events(*args, **kwargs)
                compact = self.send("compact")
                assert compact["success"], compact
                (root / "native-compaction-rpc.json").write_text(json.dumps(compact, ensure_ascii=False), encoding="utf-8")
                options = dict(command=self.command, cwd=self.cwd, env=dict(self.env or {}), timeout=self.timeout,
                    deadline=self.deadline, event_sink=self.event_sink, event_projector=self.event_projector)
                options["env"]["ARC_THIN_NATIVE_RESTART"] = "1"
                self.close()
                replacement = PiKernel(**options).start()
                self.__dict__.update(replacement.__dict__)
                self.probed = True
            return events
    arc_thin_e2e.PiKernel = ProbeKernel
path = run_arc_thin_e2e(root, arc_root=PROJECT_ROOT, game="ls20", foundation="native",
    max_decisions=7 if script == "components" else 6 if script == "reuse" else 2 if script == "receipts" else 3, consolidate_after_actions=100, experiment_timeout_seconds=0 if uncapped else 240,
    pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
    bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",),
    ledger=defaults, critic=defaults, review_at_level_change=False,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": script,
                   **({"ARC_THIN_NATIVE_VERBATIM": "2", "ARC_THIN_NATIVE_CONDENSED": "2"} if banded else {})})
summary = json.loads(path.read_text(encoding="utf-8"))
requests = [json.loads(s) for s in (root / "smoke-requests.jsonl").read_text(encoding="utf-8").splitlines()]
results = [r for request in requests for r in request.get("last_tool_results", [])]
text = json.dumps(results)
assert summary["passed"], summary
if banded:
    parent_requests = [r for r in requests if not r.get("analyst") and not r.get("critic")]
    shown = [json.dumps(r.get("transcript", [])) for r in parent_requests]
    assert any("earlier decision" in s and "not shown" in s for s in shown), "the oldest band must be dropped with a note"
    assert any("are condensed" in s for s in shown), "the middle band must be condensed"
    config = json.loads((root / "run-config.json").read_text(encoding="utf-8"))
    assert config["native_history"] == {"verbatim": 2, "condensed": 2}, config["native_history"]
if uncapped:
    assert 'of run time left' not in json.dumps(requests), 'zero must remove the run deadline, including from actual parent input'
if script == 'migration':
    assert 'old v1' in text and '42' in text and '52' in text and 'LEGACY_NOTE_EXACT' in text
    assert all('LEGACY_STANDING_RULE' in r['system_prompt'] for r in requests if not r.get('analyst') and not r.get('critic'))
    assert json.loads((root / 'workspace/artifacts/route.json').read_text()) == 50
    assert (root / 'harness/legacy_alias.jsonl').is_file()
    records = [json.loads(s) for s in (root / 'harness/artifacts.jsonl').read_text().splitlines()]
    assert records[-1]['skill'] == 'producer' and records[-1]['value'] == 50 and records[-1]['n'] == 0
elif script == "receipts":
    assert "COUNTEREXAMPLE_MIDDLE_EXACT" in text
    refs = list((root / "workspace/results").glob("*.txt"))
    assert any("COUNTEREXAMPLE_MIDDLE_EXACT" in ref.read_text(encoding="utf-8") for ref in refs)
    inputs = (root / "native-summary-input.jsonl").read_text(encoding="utf-8")
    assert "results/r" in inputs and '"thinking"' not in inputs
    assert (root / "native-compaction-rpc.json").is_file()
elif script == "budget":
    parent = [r for r in requests if not r.get("analyst") and not r.get("critic")]
    assert "budget of 10 calls is used" in text and "last look-up or compute call" in text, text[:2000]
    assert sum("cell" in r["text"] for r in results if r["tool"] == "python") >= 10
    names = [[t["name"] for t in r["tools"]] for r in parent]
    after = next(i for i, r in enumerate(parent) if "budget of 10 calls is used" in json.dumps(r.get("last_tool_results", [])))
    assert "python" not in names[after] and "memory" in names[after] and "arc_action" in names[after], names[after]
    assert "python" in names[-1], names[-1]
    assert summary["no_action_decisions"] == 0, summary
    assert any("REPEATED WORK: 9 of your last 10 python calls" in r.get("current", "") for r in parent)
    assert "BUDGET_RECORDED" in (root / "harness/memory.jsonl").read_text(encoding="utf-8")
elif script == "reuse":
    parent = [r.get("current", "") for r in requests if not r.get("analyst") and not r.get("critic")]
    assert any("REPEATED WORK: 1 of your last 2 python calls" in s for s in parent), "repetition must be shown"
    gap = next((s for s in parent if "REUSE GAP:" in s), "")
    assert "no component was saved for it; it was rebuilt 2 more times" in gap, gap[-1500:]
    if defaults:
        assert "Independent review of this gap" in gap and "- missing: " in gap and "tools/cell.py run(x: int)" in gap, gap[-1500:]
        reviews = [json.loads(s) for s in (root / "harness/reuse_reviews.jsonl").read_text(encoding="utf-8").splitlines()]
        assert [r["kind"] for r in reviews] == ["gap", "review"], reviews
        assert reviews[1]["dropped"] == ["not a cause line"], reviews[1]
        usage = (root / "harness/usage.jsonl").read_text(encoding="utf-8")
        assert '"kind":"adoption"' in usage
    assert any("tools/cell.py already covers it" in s for s in parent), "a saved tool must be matched with the calls it can replace"
    runs = [json.loads(s) for s in (root / "harness/component_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    kinds = [r["kind"] for r in runs]
    assert "reuse_shown" in kinds and kinds.count("reuse_gap") == 1 and any(r["kind"] == "save" and r["path"] == "tools/cell.py" and r["ok"] for r in runs), kinds
    # The acceptance report: six same-computation calls, a tool that covers them but was never called, so not a replacement.
    report = json.loads((root / "reuse_report.json").read_text(encoding="utf-8"))
    assert report["repetition"]["python_calls"] == 6 and report["repetition"]["repeated_calls"] == 5, report["repetition"]
    [cell] = [c for c in report["components"] if c["path"] == "tools/cell.py"]
    assert (cell["covered_calls_before"], cell["covered_calls_after"], cell["invocations"], cell["replaced"]) == (4, 2, 0, False), cell
    assert report["task"]["actions"] >= 5 and "agent" in report["cost"]["by_kind"], report["task"]
elif script == "components":
    for expected in ["compare v1", "42", "v2: saved", "NOT loaded", "v1 (v2 failed)", "compare v3", "43", "53", "CONSULT_SEMANTIC", "NATIVE_SKILL_BODY_READ_ON_DEMAND"]:
        assert expected in text, expected
    parent = [r for r in requests if not r.get("analyst") and not r.get("critic")]
    assert any("NATIVE_STANDING_RULE" in r["system_prompt"] for r in parent)
    assert "NATIVE_STANDING_RULE" not in parent[-1]["system_prompt"]
    assert any("NATIVE_SKILL_DESCRIPTION" in r["head"] for r in parent)
    observations = [json.loads(s) for s in (root / "harness/observer_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(r["n"], r.get("value")) for r in observations] == [(2, 4), (5, 777)], observations
    assert "REVISED_SKILL_BODY" in text and "set accepted" in text and "not applied:" in text
    memory = (root / "harness/memory.jsonl").read_text(encoding="utf-8")
    assert "corrupt_batch" not in memory and '"hyp.partial"' in memory and "VALID_IN_PARTIAL_BATCH" in memory
    assert all(t["name"] != "compare" for t in parent[-1]["tools"])
    assert not (root / "workspace/tools/compare.py").exists()
    budgets = [json.loads(s) for s in (root / "harness/context_budget.jsonl").read_text(encoding="utf-8").splitlines()]
    assert all(r["system_chars"] <= 3000 and r["capability_index_chars"] <= 1200 for r in budgets if "decision" in r)
    children = [r for r in requests if r.get("analyst") and "CONSULT_ROLE" in r["system_prompt"]]
    assert all("arc_action" not in [t["name"] for t in r["tools"]] for r in children)
    assert any("not granted" in json.dumps(r) for r in children)
else:
    assert "COUNTEREXAMPLE" in text and "EDITED_NOTE" in text
    assert "read-only" in text and "invalid workspace path" in text
    assert "PermissionError: invalid workspace path" in text and "NO_TOKEN" in text
assert (root / "workspace/data/frames/1.json").is_file()
assert "CURRENT STATE" not in (root / "session.jsonl").read_text(encoding="utf-8")
budgets = [json.loads(s) for s in (root / 'harness/context_budget.jsonl').read_text(encoding='utf-8').splitlines()]
assert all(r['system_chars'] <= 3000 and r['capability_index_chars'] <= 1200 for r in budgets if 'decision' in r)
summary["foundation_checks"] = {"workspace": True, "secrets": True, "native_history": True}
path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
