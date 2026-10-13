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
disabled = len(sys.argv) > 3 and sys.argv[3] == 'disabled'
uncapped = len(sys.argv) > 3 and sys.argv[3] == 'uncapped'
automatic = len(sys.argv) > 3 and sys.argv[3] == 'automatic'
split = len(sys.argv) > 3 and sys.argv[3] == 'split'
if defaults or disabled:
    class AuditKernel(PiKernel):
        def start(self):
            audit = str(PROJECT_ROOT/'tools/arc_foundation_runtime_audit.ts')
            if audit not in self.command:
                self.command = [*self.command,'--extension',audit]
            return super().start()
    arc_thin_e2e.PiKernel=AuditKernel
# 'tight' narrows the summarised history so a short smoke drops older decisions.
tight = len(sys.argv) > 3 and sys.argv[3] == 'tight'
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
    max_decisions=30 if script == "history" else 9 if script == "activation" else 7 if script == "components" else 6 if script == "reuse" else 4 if script == 'nativeclaims' else 2 if script == "receipts" else 3, consolidate_after_actions=100, experiment_timeout_seconds=0 if uncapped else 240,
    decision_timeout_seconds=0 if uncapped else 900,
    pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
    input_modalities="text,image" if script == "query" else None,
    bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",),
    ledger=defaults, critic=defaults, review_at_level_change=False,
    extension_env={"ARC_THIN_SMOKE_SCRIPT": script,
        **({'ARC_THIN_SMOKE_CONSULT_LENGTH':'1'} if script=='components' else {}),
        **({'ARC_REFINE_EVERY': '6'} if script == 'activation' else {}),
        **({'ARC_THIN_NATIVE_HISTORY_CHARS': '1200'} if tight else {}),
        **({'ARC_THIN_NATIVE_HISTORY_CHARS': '0'} if disabled else {}),
        **({'ARC_THIN_SMOKE_AUTO_COMPACTION': '1'} if automatic else {} if defaults or disabled else {'ARC_THIN_AUTO_COMPACTION': '0'})})
summary = json.loads(path.read_text(encoding="utf-8"))
requests = [json.loads(s) for s in (root / "smoke-requests.jsonl").read_text(encoding="utf-8").splitlines()]
results = [r for request in requests for r in request.get("last_tool_results", [])]
text = json.dumps(results)
assert summary["passed"], summary
parent_requests = [r for r in requests if not r.get("analyst") and not r.get("critic")]
# Earlier decisions reach the model as one summarised section of the working set, so what an ended decision's tools
# returned is checked there as well as in the tool results of the request that followed them.
shown_history = json.dumps([r.get("current", "") for r in parent_requests], ensure_ascii=False)
config = json.loads((root / 'run-config.json').read_text(encoding='utf-8'))
assert config['native_history'] == {'summary_chars': 0 if disabled else 1200 if tight else 12000, 'decision_tool_calls': 16}, config['native_history']
assert config['decision_reasoning'] is True and config['python_session'] is True, config
if defaults or disabled:
    assert config['auto_compaction'] is True, 'native default compaction must reach installed Pi'
    policy=json.loads((root/'runtime-audit/compaction-policy.json').read_text())
    assert config['pi_auto_compaction_enabled'] is True and policy['settings']['enabled'] is True
    assert 'Spend reasoning where it is new' in (root/'runtime-audit/provider-inputs.jsonl').read_text(encoding='utf-8')
if disabled:
    # Summary off: the whole session is replayed, as before 2026-10-13.
    assert 'RECENT HISTORY' not in shown_history
    assert any(r['roles'].count('user') > 1 for r in parent_requests), 'the whole session must be replayed'
elif len(parent_requests) > 1 and script != 'receipts':
    assert all(r['roles'].count('user') == 1 for r in parent_requests), 'a request carries one decision, not a transcript'
if tight:
    assert 'older not shown: memory, your prompts and tools' in shown_history, 'a tight budget must drop older decisions with a note'
if uncapped:
    assert 'of run time left' not in json.dumps(requests), 'zero must remove the run deadline, including from actual parent input'
    assert json.loads((root/'run-config.json').read_text())['decision_timeout_seconds']==0
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
elif script == "history":
    last = parent_requests[-1].get('current', '')
    assert 'RECENT HISTORY (your last' in last and 'older not shown' in last, 'the default budget must drop the oldest decisions with a note'
    assert 'said: HISTORY_28:' in last and 'HISTORY_0:' not in last
    assert '#29 ACTION1' in last, 'action receipts stay in the summary'
    budgets = [json.loads(s) for s in (root / 'harness/context_budget.jsonl').read_text(encoding='utf-8').splitlines()]
    rows = [r for r in budgets if 'decision' in r]
    assert rows[-1]['history_messages'] == 0 and 0 < rows[-1]['history_text_chars'] <= 12400 and rows[-1]['history_omitted'] > 0, rows[-1]
    assert summary['actions'] == summary['actions_on_bridge'] == 30
elif script == "budget":
    parent = parent_requests
    assert "This was tool call 16 of 16 for this decision: act now." in text, text[:2000]
    assert "used its 16 tool calls; this call was NOT run. Act now with arc_action." in text
    assert sum("cell" in r["text"] and not r["is_error"] for r in results if r["tool"] == "python") >= 16
    # The tool list is the same before and after the cap (a changing list broke the provider cache prefix).
    names = [sorted(t["name"] for t in r["tools"]) for r in parent]
    assert all(n == names[0] for n in names) and "python" in names[0] and "arc_action" in names[0], names
    assert summary["no_action_decisions"] == 0, summary
    assert "BUDGET_RECORDED" in (root / "harness/memory.jsonl").read_text(encoding="utf-8")
elif script == "activation":
    parent = parent_requests
    trajectory = [json.loads(s) for s in (root / "harness/trajectory.jsonl").read_text(encoding="utf-8").splitlines()]
    via = [r.get("via") for r in trajectory]
    # Saved code acts in a closed loop: python save= takes two actions through env.act, the saved tool takes them
    # again, unsaved code cannot act, and code that sees its prediction miss stops itself after one action.
    assert via[:5] == ["tools/probe.py"] * 4 + [None], via
    assert via[5] == "tools/miss.py" and via[6] != "tools/miss.py", via
    assert "ACTED 2 action(s). This decision ends." in shown_history, shown_history[:3000]
    assert "ACTED 1 action(s). This decision ends." in shown_history
    assert "only saved code acts" in text
    played = [json.loads(s) for s in (root / "harness/played_actions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(r["via"], r["missed"]) for r in played] == [("tools/probe.py", False)] * 4 + [("tools/miss.py", True)], played
    # Factual receipts: the change count, and coordinates the action ignores are dropped and named.
    assert trajectory[4]["action"] == "ACTION1" and trajectory[4].get("ignored_xy") is True and "x" not in trajectory[4], trajectory[4]
    assert "(x,y ignored: ACTION1 takes no coordinates)" in shown_history and "changed=" in shown_history
    # One arc_action carries a planned sequence: three actions in one decision.
    sequences = [json.loads(s) for s in (root / "harness/action_sequences.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(r["planned"], r["played"]) for r in sequences] == [(3, 3)], sequences
    planned_decision = next(r["decision"] for r in trajectory if r.get("note") == "then 1 of 2")
    assert [r["action"] for r in trajectory if r["decision"] == planned_decision] == ["ACTION1", "ACTION4", "ACTION1"], trajectory
    # The python session: a function and a value defined in decision 3 are used in decision 5.
    assert "(kept for later python calls: plus_one, kept_value)" in text, text[:3000]
    assert any(r["tool"] == "python" and r["text"].endswith("→ 42") for r in results), [r["text"] for r in results if r["tool"] == "python"]
    # Reasoning stays within its decision: the next request of the same decision carries it, later decisions do not.
    carried = [r for r in parent if "THINK_MARK_DECISION3" in r.get("reasoning_in_context", [])]
    assert len(carried) == 1 and carried[0]["planned"]["calls"][0][0] == "arc_action", [r.get("reasoning_in_context") for r in parent]
    assert summary["actions"] == summary["actions_on_bridge"] == len(trajectory)
    # The context is the harness plus the present: no runtime-made analyses resident; ledger and memory are files.
    current = [r.get("current", "") for r in parent]
    for absent in ["GOAL CHECKS", "IDEAS", "PREDICTION CHALLENGE", "EXPLORATION", "CRITIC", "REPEATED WORK", "STRATEGY ("]:
        assert not any(absent in s for s in current), absent
    assert all(("MEMORY INDEX" in s or "MEMORY: empty" in s) for s in current)
    assert all(t["name"] not in ("ls", "grep") for r in parent for t in r["tools"])
    assert any("tool probe v1 active" in s and "probe(args)" in s for s in current), 'the capability index lists the saved tool'
    assert (root / "workspace/data/memory.md").is_file()
    assert not (root / "workspace/roles").exists() and (root / "workspace/agents").is_dir()
    assert all(("refine" in [t["name"] for t in r["tools"]]) is defaults for r in parent)
    if defaults:
        assert (root / "workspace/data/ledger.md").is_file()
        # The refinement pipeline: runtime machinery (no role file), triggered by retyped saved code, repeated python
        # work and the agent's own refine(focus); its edits go through the binder, the agent is told once, the
        # strategy is an active prompt from then on, and the agent's prompts/refine.md reaches the pipeline.
        refiner = [json.loads(s) for s in (root / "harness/refiner.jsonl").read_text(encoding="utf-8").splitlines()]
        edits = [r for r in refiner if r["kind"] == "edit"]
        paths = [r["path"] for r in edits]
        assert "prompts/strategy.md" in paths and "tools/cell_reader.py" in paths, refiner
        assert {r["category"] for r in edits} == {"prompt", "tool"}, edits
        assert all(r["loaded"] for r in edits), edits
        triggers = [t for r in refiner for t in r.get("triggers", [])]
        assert any("redone 3 times" in t for t in triggers), triggers
        assert any("retyped 2 times although tools/probe.py covers it" in t for t in triggers), triggers
        # The agent's own request is never dropped: started at once, or queued behind a running refinement and started after it.
        asked = [r for r in refiner if r.get("triggers") == ["the agent asked: write a goal test into the strategy"]]
        assert any(r["kind"] == "start" for r in asked), refiner
        # A refinement never replaces the agent's own file.
        assert any(r["kind"] == "refused" and r["path"] == "tools/probe.py" for r in asked), refiner
        assert "view: on" not in (root / "workspace/tools/probe.py").read_text(encoding="utf-8")
        assert any("HARNESS UPDATE by a refinement" in s for s in current)
        assert any("REFINED_NEXT_EXPERIMENT" in r["system_prompt"] for r in parent), 'the strategy must be an applied prompt'
        assert (root / "workspace/prompts/strategy.md").is_file() and (root / "workspace/tools/cell_reader.py").is_file()
        inputs = [json.loads(s) for s in (root / "refiner-inputs.jsonl").read_text(encoding="utf-8").splitlines()]
        assert any("THE AGENT'S GUIDANCE FOR REFINEMENTS (prompts/refine.md):\nREFINE_GUIDE_MARK" in r["systemPrompt"] for r in inputs)
        assert not any("REFINE_GUIDE_MARK" in r["system_prompt"] for r in parent), 'an inactive prompt is not applied to the agent'
        usage = (root / "harness/usage.jsonl").read_text(encoding="utf-8")
        assert '"kind":"refiner"' in usage
    report = json.loads((root / "reuse_report.json").read_text(encoding="utf-8"))
    assert report["offload"]["actions_from_components"] == 5 and report["offload"]["replaying_calls"] >= 1, report["offload"]
    assert report["offload"]["actions_by_component"] == {"tools/probe.py": 4, "tools/miss.py": 1}, report["offload"]
    categories = report["categories"]
    assert categories["tool"]["created"] >= 2 and categories["tool"]["used"] >= 1 and categories["tool"]["actions"] == 5, categories
    assert categories["prompt"]["created"] == (2 if defaults else 1), categories["prompt"]
elif script == "reuse":
    parent = [r.get("current", "") for r in parent_requests]
    # Repetition is no longer resident text: it triggers a refinement, which saves the computation itself.
    assert not any("REPEATED WORK" in s or "REUSE GAP" in s for s in parent)
    if defaults:
        refiner = [json.loads(s) for s in (root / "harness/refiner.jsonl").read_text(encoding="utf-8").splitlines()]
        edit = next(r for r in refiner if r["kind"] == "edit")
        assert edit["path"] == "tools/cell_reader.py" and edit["loaded"] and "redone 3 times" in edit["triggers"][0], refiner
        assert any("HARNESS UPDATE by a refinement" in s and "tools/cell_reader.py v1" in s for s in parent)
    runs = [json.loads(s) for s in (root / "harness/component_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(r["kind"] == "save" and r["path"] == "tools/cell.py" and r["ok"] for r in runs), runs
    # The acceptance report: six same-computation calls, a tool that covers them but was never called, so not a replacement.
    report = json.loads((root / "reuse_report.json").read_text(encoding="utf-8"))
    assert report["repetition"]["python_calls"] == 6 and report["repetition"]["repeated_calls"] == 5, report["repetition"]
    [cell] = [c for c in report["components"] if c["path"] == "tools/cell.py"]
    assert (cell["covered_calls_before"], cell["covered_calls_after"], cell["invocations"], cell["replaced"]) == (4, 2, 0, False), cell
    assert report["task"]["actions"] >= 5 and "agent" in report["cost"]["by_kind"], report["task"]
elif script == "components":
    assert (root/'consult-length.jsonl').is_file(), 'consult length continuation must reach semantic result'
    for expected in ["compare v1", "42", "v2: saved", "NOT loaded", "v1 (v2 failed)", "compare v3", "43", "53", "CONSULT_SEMANTIC", "NATIVE_SKILL_BODY_READ_ON_DEMAND"]:
        assert expected in text, expected
    parent = [r for r in requests if not r.get("analyst") and not r.get("critic")]
    assert any("NATIVE_STANDING_RULE" in r["system_prompt"] for r in parent)
    assert "NATIVE_STANDING_RULE" not in parent[-1]["system_prompt"]
    assert any("NATIVE_SKILL_DESCRIPTION" in r["head"] for r in parent)
    observations = [json.loads(s) for s in (root / "harness/observer_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    # A view runs on the state it became active at (#1, #4), then after each action; the switched-off version never runs.
    assert [(r["n"], r.get("value")) for r in observations] == [(1, 3), (2, 4), (4, 777), (5, 777)], observations
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
elif script == "query":
    assert config['observation_delivery'] == 'query', config
    assert all(not any(b['role'] == 'user' for b in r['image_blocks']) for r in parent_requests)
    assert any(any(b['role'] == 'toolResult' and b['tool'] == 'read' for b in r['image_blocks']) for r in parent_requests)
    for expected in ('[2,1]', '[3,2,2]', '[4,3]'):
        assert expected in text, (expected, text)
    assert all('data/observations/' in r['current'] for r in parent_requests)
    assert all('0-7:0' not in r['current'] for r in parent_requests)
    initial = json.loads((root/'workspace/data/observations/0.json').read_text(encoding='utf-8'))
    latest = json.loads((root/'workspace/data/observations/3.json').read_text(encoding='utf-8'))
    assert initial['frames'][0][3][2] == 9 and latest['frames'][0][3][5] == 9
    assert summary['actions'] == 3, summary
    if defaults:
        refinements = [json.loads(s) for s in (root/'refiner-inputs.jsonl').read_text(encoding='utf-8').splitlines()]
        assert refinements and all('data/observations/' in r['input'] for r in refinements)
        assert all('Lossless coordinate runs' not in r['input'] for r in refinements)
else:
    assert "COUNTEREXAMPLE" in text and "EDITED_NOTE" in text
    assert "read-only" in text and "invalid workspace path" in text
    assert "PermissionError: invalid workspace path" in text and "NO_TOKEN" in text
assert (root / "workspace/data/frames/1.json").is_file()
assert "CURRENT STATE" not in (root / "session.jsonl").read_text(encoding="utf-8")
budgets = [json.loads(s) for s in (root / 'harness/context_budget.jsonl').read_text(encoding='utf-8').splitlines()]
assert all(r['system_chars'] <= 3000 and r['capability_index_chars'] <= 1200 for r in budgets if 'decision' in r)
summary["foundation_checks"] = {"query_observation": True, "native_history": True} if script == "query" else {"workspace": True, "secrets": True, "native_history": True}
path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
