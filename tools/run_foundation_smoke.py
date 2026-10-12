"""Bounded native smoke: mock SDK, production bridge, actual Pi and WASI."""
import json
import sys
from pathlib import Path
from autoresearch_pi.arc_thin_e2e import PROJECT_ROOT, SMOKE_PROVIDER, run_arc_thin_e2e
from autoresearch_pi import arc_thin_e2e
from autoresearch_pi.pi_kernel import PiKernel

root = Path(sys.argv[1])
script = sys.argv[2] if len(sys.argv) > 2 else "foundation"
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
    max_decisions=4 if script == "components" else 2 if script == "receipts" else 3, consolidate_after_actions=100, experiment_timeout_seconds=240,
    pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
    bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",),
    ledger=False, critic=False, review_at_level_change=False,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": script})
summary = json.loads(path.read_text(encoding="utf-8"))
requests = [json.loads(s) for s in (root / "smoke-requests.jsonl").read_text(encoding="utf-8").splitlines()]
results = [r for request in requests for r in request.get("last_tool_results", [])]
text = json.dumps(results)
assert summary["passed"], summary
if script == "receipts":
    assert "COUNTEREXAMPLE_MIDDLE_EXACT" in text
    refs = list((root / "workspace/results").glob("*.txt"))
    assert any("COUNTEREXAMPLE_MIDDLE_EXACT" in ref.read_text(encoding="utf-8") for ref in refs)
    inputs = (root / "native-summary-input.jsonl").read_text(encoding="utf-8")
    assert "ref: results/" in inputs and '"thinking"' not in inputs
    assert (root / "native-compaction-rpc.json").is_file()
elif script == "components":
    for expected in ["compare v1", "42", "v2: saved", "NOT loaded", "v1 (v2 failed)", "compare v3", "43", "53", "CONSULT_SEMANTIC", "NATIVE_SKILL_BODY_READ_ON_DEMAND"]:
        assert expected in text, expected
    parent = [r for r in requests if not r.get("analyst") and not r.get("critic")]
    assert any("NATIVE_STANDING_RULE" in r["system_prompt"] for r in parent)
    assert "NATIVE_STANDING_RULE" not in parent[-1]["system_prompt"]
    assert any("NATIVE_SKILL_DESCRIPTION" in r["head"] for r in parent)
    observations = [json.loads(s) for s in (root / "harness/observer_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(r["n"], r.get("value")) for r in observations] == [(2, 4)], observations
    children = [r for r in requests if r.get("analyst") and "CONSULT_ROLE" in r["system_prompt"]]
    assert all("arc_action" not in [t["name"] for t in r["tools"]] for r in children)
    assert any("not granted" in json.dumps(r) for r in children)
else:
    assert "COUNTEREXAMPLE" in text and "EDITED_NOTE" in text
    assert "read-only" in text and "invalid workspace path" in text
    assert "PermissionError: invalid workspace path" in text and "NO_TOKEN" in text
assert (root / "workspace/data/frames/1.json").is_file()
assert "CURRENT STATE" not in (root / "session.jsonl").read_text(encoding="utf-8")
summary["foundation_checks"] = {"workspace": True, "secrets": True, "native_history": True}
path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
