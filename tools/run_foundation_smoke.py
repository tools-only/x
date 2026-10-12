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
automatic = len(sys.argv) > 3 and sys.argv[3] == 'automatic'
split = len(sys.argv) > 3 and sys.argv[3] == 'split'
if defaults:
    class AuditKernel(PiKernel):
        def start(self):
            audit = str(PROJECT_ROOT/'tools/arc_foundation_runtime_audit.ts')
            if audit not in self.command:
                self.command = [*self.command,'--extension',audit]
            return super().start()
    arc_thin_e2e.PiKernel=AuditKernel
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
            if automatic and not getattr(self, 'captures_compaction', False):
                self.captures_compaction = True
                projector = self.event_projector
                self.event_projector = lambda event: event if event.get('type') in ['compaction_start', 'compaction_end'] else projector(event) if projector else event
            settings = Path(self.env["PI_CODING_AGENT_DIR"]) / "settings.json"
            settings.write_text(json.dumps({"compaction": {"enabled": automatic, "keepRecentTokens": 1 if split else 100, "reserveTokens": 1000}}), encoding="utf-8")
            return super().start()
        def wait_for_agent_events(self, *args, **kwargs):
            events = super().wait_for_agent_events(*args, **kwargs)
            if not getattr(self, "probed", False):
                self.probed = True
                config = json.loads((root / 'run-config.json').read_text(encoding='utf-8'))
                assert config['auto_compaction'] is automatic, 'native defaults must enable automatic compaction; explicit off must disable it'
                # Additional canonical user entries move the completed long-output turn into the summarize range.
                checkpoint_events = []
                for _ in range(3):
                    self.prompt("Checkpoint before restart; retain exact result refs.")
                    checkpoint_events.extend(super().wait_for_agent_events(*args, **kwargs))
                if automatic:
                    compact = next((event for event in checkpoint_events if event.get('type') == 'compaction_end'), None)
                    if compact is None:
                        compact = self.wait_for_event(['compaction_end'], timeout=30)
                    assert compact.get('reason') == 'threshold' and compact.get('result') and not compact.get('aborted'), compact
                    (root / "native-auto-compaction-event.json").write_text(json.dumps(compact, ensure_ascii=False), encoding="utf-8")
                else:
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
    max_decisions=7 if script == "components" else 4 if script == 'nativeclaims' else 2 if script == "receipts" else 3, consolidate_after_actions=100, experiment_timeout_seconds=0 if uncapped else 240,
    pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
    bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",),
    ledger=defaults, critic=defaults, review_at_level_change=False,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": script,
        **({'ARC_THIN_SMOKE_CONSULT_LENGTH':'1'} if script=='components' else {}),
        **({'ARC_THIN_SMOKE_AUTO_COMPACTION': '1'} if automatic else {} if defaults else {'ARC_THIN_AUTO_COMPACTION': '0'})})
summary = json.loads(path.read_text(encoding="utf-8"))
requests = [json.loads(s) for s in (root / "smoke-requests.jsonl").read_text(encoding="utf-8").splitlines()]
results = [r for request in requests for r in request.get("last_tool_results", [])]
text = json.dumps(results)
assert summary["passed"], summary
if defaults:
    assert json.loads((root/'run-config.json').read_text())['auto_compaction'] is True, 'native default compaction must reach installed Pi'
    config=json.loads((root/'run-config.json').read_text())
    policy=json.loads((root/'runtime-audit/compaction-policy.json').read_text())
    assert config['pi_auto_compaction_enabled'] is True and policy['settings']['enabled'] is True
    assert 'Treat reasoning time and tokens as a task resource' in (root/'runtime-audit/provider-inputs.jsonl').read_text(encoding='utf-8')
if uncapped:
    assert 'of run time left' not in json.dumps(requests), 'zero must remove the run deadline, including from actual parent input'
if script == 'nativeclaims':
    claims=[json.loads(line) for line in (root/'harness/claim_checks.jsonl').read_text().splitlines()]
    assert [(row['n'],row['result']) for row in claims if row['key']=='hyp.right']==[(1,True),(2,None),(3,True)],claims
    assert [(row['n'],row['result']) for row in claims if row['key']=='hyp.wrong']==[(1,False),(2,None),(3,False)],claims
    assert 'SyntaxError' in text and any('holds 2' in r.get('latest_user','') for r in requests),text
    assert summary['actions']==summary['actions_on_bridge']==4
    assert not any('Tool budget' in json.dumps(r) or 'Soft tool-call' in json.dumps(r) for r in results)
elif script == 'migration':
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
    assert "ref: results/" in inputs and '"thinking"' not in inputs
    assert all("refuted claims and their test conditions" in json.dumps(row) for row in map(json.loads, inputs.splitlines())), "ARC summary requirements must reach every actual Pi summarizer input"
    assert any('Native checkpoint: exact evidence' in json.dumps(row.get('transcript', [])) for row in requests), 'later parent must receive the native checkpoint'
    assert (root / ("native-auto-compaction-event.json" if automatic else "native-compaction-rpc.json")).is_file()
    usage = [json.loads(s) for s in (root / 'harness/usage.jsonl').read_text(encoding='utf-8').splitlines()]
    assert any(row['kind'] == 'compaction' and row['total'] > 0 for row in usage)
    assert any('compaction' in line for line in (root / 'session.jsonl').read_text(encoding='utf-8').splitlines())
    if split:
        probes = [json.loads(s) for s in (root / 'harness/compaction_probe.jsonl').read_text(encoding='utf-8').splitlines()]
        assert any(row['turnPrefixMessages'] for row in probes), 'split-turn path must be exercised'
        assert len(inputs.splitlines()) >= 2, 'Pi must summarize history and the split turn'
elif script == "components":
    assert (root/'consult-length.jsonl').is_file(), 'consult length continuation must reach semantic result'
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
