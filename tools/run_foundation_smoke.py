"""Bounded native smoke: mock SDK, production bridge, actual Pi and WASI."""
import json
import re
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
session_compat = script not in ('python-stateless', 'observer', 'observer-semantic', 'observer-lifecycle', 'observer-restart', 'runtime-evidence-review', 'tool-isolation', 'arc-history-delivery')
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
if script == 'observer-restart':
    class ObserverRestartKernel(PiKernel):
        def wait_for_agent_events(self, *args, **kwargs):
            events = super().wait_for_agent_events(*args, **kwargs)
            if not getattr(self, 'observer_restarted', False) and any(
                event.get('type') == 'tool_execution_end' and event.get('toolName') == 'python' for event in events
            ):
                options = dict(command=self.command, cwd=self.cwd, env=dict(self.env or {}), timeout=self.timeout,
                    deadline=self.deadline, event_sink=self.event_sink, event_projector=self.event_projector)
                options['env']['ARC_THIN_NATIVE_RESTART'] = '1'
                (root / 'observer-pi-restart.json').write_text(json.dumps({'after_tool': 'python'}), encoding='utf-8')
                self.close()
                replacement = PiKernel(**options).start()
                self.__dict__.update(replacement.__dict__)
                self.observer_restarted = True
            return events
    arc_thin_e2e.PiKernel = ObserverRestartKernel
path = run_arc_thin_e2e(root, arc_root=PROJECT_ROOT, game="ls20", foundation="native",
    # promotion: 11 decisions since r04, whose refinements run the ledger's expectation checks in the sandbox before the
    # model call, so the dispute refinement's rule lands one decision later than before.
    max_decisions=30 if script == "history" else 11 if script in ("promotion", "hypotheses") else 9 if script == "activation" else 7 if script in ("components", "components-feedback") else 6 if script in ("reuse", "observer-lifecycle") else 5 if script in ('meta', 'observer-semantic') else 4 if script in ('nativeclaims', 'guard', 'checkpoint', 'arc-history-delivery') else 5 if script == 'observer-restart' else 2 if script == "receipts" else 3, consolidate_after_actions=100, experiment_timeout_seconds=0 if uncapped else 240,
    decision_timeout_seconds=0 if uncapped else 900,
    pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
    input_modalities="text,image" if script in ("query", "observer-semantic") else None,
    bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools/mock_arc_sdk",),
    # The promotion path and the hypothesis loop's refinement event run through refinements, which need the ledger and
    # its trigger service.
    ledger=defaults or script in ('promotion', 'hypotheses'), critic=defaults or script in ('promotion', 'hypotheses'), review_at_level_change=False,
    # guard, meta: a stall review after two actions is the harness turn that saves the components.
    **({'stall_review_after': 2} if script in ('guard', 'meta') else {}),
    extension_env={"ARC_THIN_SMOKE_SCRIPT": script,
        **({'ARC_THIN_CORE': '1'} if script in ('observer', 'observer-semantic', 'observer-lifecycle', 'observer-restart', 'runtime-evidence-review', 'tool-isolation', 'arc-history-delivery', 'python-stateless', 'checkpoint') else {}),
        **({'ARC_THIN_OBSERVATION': 'ch'} if script in ('observer-semantic', 'observer-lifecycle', 'runtime-evidence', 'runtime-evidence-review', 'components-feedback', 'arc-history-delivery') else {}),
        'ARC_THIN_PYTHON_SESSION': '1' if session_compat else '0',
        **({'ARC_THIN_HARNESS_TURN': '1', 'ARC_THIN_GUARDS': '1', 'ARC_THIN_REVIEW_CONSULT': '0'} if script in ('guard', 'meta') else {}),
        **({'ARC_THIN_HOOKS': '1'} if script == 'meta' else {}),
        **({'ARC_THIN_SMOKE_CONSULT_LENGTH':'1'} if script in ('components', 'components-feedback') else {}),
        **({'ARC_REFINE_EVERY': '6'} if script == 'activation' else {}),
        # The activation script checks the other refinement events; the promotion script checks this one.
        **({'ARC_REFINE_UNCHECKED_AFTER': '1000'} if script in ('activation', 'hypotheses') else {}),
        # Only events start refinements in the hypotheses script, so the contested one is the first.
        **({'ARC_REFINE_EVERY': '100'} if script == 'hypotheses' else {}),
        **({'ARC_THIN_NATIVE_HISTORY_CHARS': '1200'} if tight else {}),
        # The history script exercises the summarised section, no longer the native default.
        **({'ARC_THIN_NATIVE_HISTORY_CHARS': '12000'} if script == 'history' and not tight else {}),
        **({'ARC_THIN_NATIVE_HISTORY_CHARS': '0'} if disabled else {}),
        **({'ARC_THIN_SMOKE_AUTO_COMPACTION': '1'} if automatic else {} if defaults or disabled else {'ARC_THIN_AUTO_COMPACTION': '0'})})
summary = json.loads(path.read_text(encoding="utf-8"))
requests = [json.loads(s) for s in (root / "smoke-requests.jsonl").read_text(encoding="utf-8").splitlines()]
results = [r for request in requests for r in request.get("last_tool_results", [])]
# Full tool output is kept in workspace result artifacts; parent requests carry short receipts by design.
result_artifacts = [p.read_text(encoding="utf-8") for p in (root / "workspace/results").glob("*.txt")]
text = json.dumps(results, ensure_ascii=False) + "\n" + "\n".join(result_artifacts)
assert summary["passed"], summary
parent_requests = [r for r in requests if not r.get("analyst") and not r.get("critic")]
# Earlier decisions reach the model as a transcript before the current head (native default) or, with a summary
# budget, as a summarised section of the working set; what an ended decision's tools returned is checked in both.
shown_history = json.dumps([[r.get("current", ""), r.get("transcript", [])] for r in parent_requests], ensure_ascii=False)
config = json.loads((root / 'run-config.json').read_text(encoding='utf-8'))
summary_chars = 1200 if tight else 12000
assert config['native_history'] == {'summary_chars': summary_chars, 'result_chars': 5000, 'decision_tool_calls': 16}, config['native_history']
assert config['decision_reasoning'] is True and config['python_session'] is session_compat, config
if defaults or disabled:
    assert config['auto_compaction'] is True, 'native default compaction must reach installed Pi'
    policy=json.loads((root/'runtime-audit/compaction-policy.json').read_text())
    assert config['pi_auto_compaction_enabled'] is True and policy['settings']['enabled'] is True
    assert 'Spend reasoning where it is new' in (root/'runtime-audit/provider-inputs.jsonl').read_text(encoding='utf-8')
if not summary_chars:
    # Transcript: earlier decisions are replayed in front of the current head, without a summary.
    assert 'RECENT HISTORY' not in shown_history
    if len(parent_requests) > 1:
        assert any(r['roles'].count('user') > 1 for r in parent_requests), 'earlier decisions must be replayed'
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
    assert "COUNTEREXAMPLE_MIDDLE_EXACT" in shown_history, "the archived read's exact semantic result must remain visible in the provider transcript"
    # The python session survives the Pi restart: a function and an in-place changed list come back from the checkpoint.
    assert "[[41,1],42]" in shown_history, "the restored Python result must remain visible in the provider transcript"
    session_rows = [json.loads(s) for s in (root / "harness/python_session.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(r["event"] == "restored" and "twice()" in r["names"] for r in session_rows), session_rows
    assert (root / ".harness/python_session/HEAD.json").is_file()
    refs = list((root / "workspace/results").glob("*.txt"))
    assert any("COUNTEREXAMPLE_MIDDLE_EXACT" in ref.read_text(encoding="utf-8") for ref in refs)
    session = [json.loads(s) for s in (root / "session.jsonl").read_text(encoding="utf-8").splitlines()]
    archived_reads = [row["message"] for row in session if row.get("type") == "message"
        and row.get("message", {}).get("role") == "toolResult" and row["message"].get("toolName") == "read"
        and "ref: results/" in json.dumps(row["message"].get("content", []))]
    assert archived_reads and all(len(json.dumps(message["content"])) < 1400 for message in archived_reads), archived_reads
    inputs = (root / "native-summary-input.jsonl").read_text(encoding="utf-8")
    assert "ref: results/" in inputs and '"thinking"' not in inputs
    assert all("refuted claims and their test conditions" in json.dumps(row) for row in map(json.loads, inputs.splitlines())), "ARC summary requirements must reach every actual Pi summarizer input"
    # The summary replaces the calls that defined the session's names, not the names (live kernel).
    assert all("The python session keeps running after this summary" in json.dumps(row) for row in map(json.loads, inputs.splitlines()))
    # The Pi restart started a second kernel, which restored the session from its checkpoint.
    kernels = [row for row in map(json.loads, (root / "harness/wasi_runs.jsonl").read_text(encoding="utf-8").splitlines()) if row.get("mode") == "kernel"]
    assert sum(1 for row in kernels if row.get("fresh")) == 2, kernels
    assert any('Native checkpoint: exact evidence' in json.dumps(row.get('transcript', [])) for row in requests), 'later parent must receive the native checkpoint'
    assert (root / ("native-auto-compaction-event.json" if automatic else "native-compaction-rpc.json")).is_file()
    usage = [json.loads(s) for s in (root / 'harness/usage.jsonl').read_text(encoding='utf-8').splitlines()]
    assert any(row['kind'] == 'compaction' and row['total'] > 0 for row in usage)
    assert any('compaction' in line for line in (root / 'session.jsonl').read_text(encoding='utf-8').splitlines())
    if split:
        probes = [json.loads(s) for s in (root / 'harness/compaction_probe.jsonl').read_text(encoding='utf-8').splitlines()]
        assert any(row['turnPrefixMessages'] for row in probes), 'split-turn path must be exercised'
        assert len(inputs.splitlines()) >= 2, 'Pi must summarize history and the split turn'
elif script == "promotion":
    refiner = [json.loads(s) for s in (root / 'harness/refiner.jsonl').read_text(encoding='utf-8').splitlines()]
    edits = [(row.get('path'), row.get('version')) for row in refiner if row.get('kind') == 'edit']
    starts = [row['triggers'] for row in refiner if row.get('kind') == 'start']
    # A restated belief became a checked hypothesis, through the memory component.
    assert any('no hypothesis carries a check' in ' '.join(t) for t in starts), starts
    assert ('memory:hyp.right', None) in edits, edits
    checks = [json.loads(s) for s in (root / 'harness/claim_checks.jsonl').read_text(encoding='utf-8').splitlines()]
    # Its check discriminates: it fails on at least one mismatched move.
    controls = [row for row in checks if row.get('control') and row['key'] == 'hyp.right']
    assert controls and False in controls[0]['results'], controls
    # Four holds made it a rule in the rules prompt (a versioned prompt component), applied in later system prompts.
    assert any('a candidate rule for prompts/rules.md' in ' '.join(t) for t in starts), starts
    assert ('prompts/rules.md', 1) in edits and ('prompts/rules.md', 2) in edits, edits
    parents = [r for r in parent_requests if 'system_prompt' in r]
    assert any('(hyp.right)' in r['system_prompt'] for r in parents), 'the promoted rule must reach a later system prompt'
    # The wrap at #8 failed the cited check: the rule went into dispute and a refinement revised it.
    assert any(row['key'] == 'hyp.right' and row.get('n') == 8 and row.get('result') is False for row in checks), checks
    assert any('the rule is in dispute' in ' '.join(t) for t in starts), starts
    assert any('(hyp.right_wrap)' in r['system_prompt'] for r in parents), 'the revised rule must reach a later system prompt'
    # Prompt changes apply from the next decision: within a decision the system prompt never changes (cache prefix).
    for before, after in zip(parents, parents[1:]):
        if after.get('current') == before.get('current'):
            assert after['system_prompt'] == before['system_prompt'], 'the system prompt changed within a decision'
    currents = [r.get('current', '') for r in parent_requests]
    assert any('RULE CHECKS (prompts/rules.md)' in c and '1 held' in c for c in currents), 'the rule checks must be shown while play goes on'
    # The retyped computation was named in its own result.
    assert any('tools/nine.py already computes this' in r['text'] for r in results if r['tool'] == 'python'), [r['text'][-200:] for r in results if r['tool'] == 'python']
    # The refinement ledger (r04): the hypothesis edit keeps its id and expectation, the decision that showed it is
    # recorded, and a later refinement is told what its check and its expectation showed since then.
    first = next(row for row in refiner if row.get('kind') == 'edit' and row.get('path') == 'memory:hyp.right')
    assert first['id'] == 'e1' and first['expect']['within'] == 3 and 'def check(t)' in first['expect']['check'], first
    told = [row for row in refiner if row.get('kind') == 'told']
    assert told and told[0]['id'] == 'e1' and told[0]['at'] >= first['at'], told
    refinements = [json.loads(s) for s in (root / 'refiner-inputs.jsonl').read_text(encoding='utf-8').splitlines()]
    assert all('YOUR EARLIER EDITS, when present' in r['systemPrompt'] for r in refinements), refinements[0]['systemPrompt'][-400:]
    ledgers = [r['input'] for r in refinements if 'YOUR EARLIER EDITS (newest first' in r['input']]
    assert any('memory hyp.right (still as written)' in text and 'its check since: holds' in text
               and 'expected within 3: "the agent moves the 9 right" — met at #' in text for text in ledgers), [t[:1200] for t in ledgers]
    # Every refinement's input and reply is kept, with the model that answered.
    kept = [json.loads(s) for s in (root / 'harness/refiner_inputs.jsonl').read_text(encoding='utf-8').splitlines()]
    replies = [json.loads(s) for s in (root / 'harness/refiner_replies.jsonl').read_text(encoding='utf-8').splitlines()]
    assert 0 < len(kept) <= len(starts) and all(r['model'] == 'scripted' and r['input'].startswith('WHY NOW: ') for r in kept), [r.get('model') for r in kept]
    assert replies and all(r['model'] == 'scripted' for r in replies) and any('EXPECT within 3 actions' in r['text'] for r in replies), replies
    print(json.dumps({'ledger_checks': {'edits': len(edits), 'told': len(told), 'ledger_inputs': len(ledgers), 'kept_inputs': len(kept)}}), flush=True)
elif script == "hypotheses":
    # The hypothesis loop (plan 2026-10-17, Part H) in the full chain: real Pi, production bridge, mock SDK, WASI checks.
    assert 'hyp.prose: the check is not Python; it was kept as next_test' in text, text[-2000:]
    assert 'hyp.always_left contested: its check fails on 3 of 5 decided moves (#1, #3, #5)' in text, text[-2000:]
    memory_rows = [json.loads(s) for s in (root / 'harness/memory.jsonl').read_text(encoding='utf-8').splitlines()]
    contested = [row for row in memory_rows if row.get('by') == 'check']
    # hyp.left joins it once a fifth ACTION1 move (after the script, a fallback move) fails it too.
    assert [(row['key'], row['hyp']['status'], row['hyp']['contested_at']) for row in contested][:1] == [('hyp.always_left', 'contested', 5)], contested
    prose = [row['hyp'] for row in memory_rows if row.get('key') == 'hyp.prose' and 'hyp' in row]
    assert prose and 'check' not in prose[-1] and prose[-1]['next_test'].startswith('after an ACTION3'), prose
    # A later parent sees it first, with what its check says, and the rivals compared on the same moves (after #6).
    line = '! its check fails on 3 of 6 decided moves (#1, #3, #5): narrow the claim and its check to where it held, fix the check, or reject it; then restate its status'
    later = [r.get('current', '') for r in parent_requests if line in r.get('current', '')]
    assert later, [r.get('current', '')[:800] for r in parent_requests[-3:]]
    head = later[0][later[0].index('CURRENT KNOWLEDGE'):]
    assert head.index('- hyp.always_left [contested]') < head.index('- hyp.right'), head[:1500]
    assert 'question "controls": #5 separates hyp.right (holds) from hyp.left (fails)' in head, head[:1500]
    assert 'check source:' in (root / 'workspace/data/memory.md').read_text(encoding='utf-8')
    assert 'def check' not in head
    # The contest reached a refinement, which added a narrower hypothesis.
    refiner = [json.loads(s) for s in (root / 'harness/refiner.jsonl').read_text(encoding='utf-8').splitlines()]
    starts = [' '.join(row['triggers']) for row in refiner if row.get('kind') == 'start']
    assert starts and 'hyp.always_left is contested: its check fails on 3 of ' in starts[0], starts
    assert any(row.get('kind') == 'edit' and row.get('path') == 'memory:hyp.left_on_action3' for row in refiner), refiner
    print(json.dumps({'hypothesis_checks': {'contested': len(contested), 'refinements': len(starts)}}), flush=True)
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
    # again, and code that sees its prediction miss stops itself after one action.
    assert via[:5] == ["tools/probe.py"] * 4 + [None], via
    assert via[5] == "tools/miss.py" and via[6] != "tools/miss.py", via
    assert "ACTED 2 action(s). This decision ends." in shown_history, shown_history[:3000]
    assert "ACTED 1 action(s). This decision ends." in shown_history
    # show() prints a region as row runs (the mock grid's corner).
    assert any(r["tool"] == "python" and r["text"].startswith("rows y0-7, x0-7; background") for r in results), [r["text"][:200] for r in results if r["tool"] == "python"]
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
    assert "(python session: +plus_one(), +kept_value)" in text, text[:3000]
    assert any(r["tool"] == "python" and r["text"].endswith("→ 42") for r in results), [r["text"] for r in results if r["tool"] == "python"]
    # env.remember in a python cell commits through the memory tool's own update, with its receipt in the cell's result,
    # and the entry reaches a later decision's memory.
    remembered = [json.loads(s) for s in (root / "harness/memory.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(r.get("key") == "smoke.remember" for r in remembered), remembered
    assert any(r["tool"] == "python" and "memory: " in r["text"] and "smoke.remember" in r["text"] for r in results), \
        [r["text"][:300] for r in results if r["tool"] == "python"]
    assert any("REMEMBER_MARK" in r.get("current", "") for r in parent), [r.get("current", "")[:600] for r in parent]
    # The live kernel: one kernel served every parent python call, acting code acted inside it, and later decision
    # heads list what the session holds.
    kernel_runs = [row for row in map(json.loads, (root / "harness/wasi_runs.jsonl").read_text(encoding="utf-8").splitlines())
                   if row.get("mode") == "kernel"]
    assert config["python_kernel"] is True and config["session_view"] is True, config
    assert kernel_runs and sum(1 for row in kernel_runs if row.get("fresh")) == 1, kernel_runs
    assert any(row.get("acts") == 2 for row in kernel_runs), kernel_runs
    assert any("PYTHON SESSION (" in r.get("current", "") and "plus_one()" in r.get("current", "") and "kept_value 41" in r.get("current", "")
               for r in parent), [r.get("current", "")[:600] for r in parent]
    # Reasoning stays in view between tool rounds of its decision (append-only, so the cache prefix holds) and is not
    # carried into later decisions.
    with_mark = [i for i, r in enumerate(parent) if "THINK_MARK_DECISION3" in r.get("reasoning_in_context", [])]
    assert with_mark and with_mark[-1] < len(parent) - 1, [r.get("reasoning_in_context") for r in parent]
    assert len({parent[i]["current"] for i in with_mark}) == 1, 'reasoning must not outlive its decision'
    assert config["decision_reasoning_mode"] == "all" and config["archive_results"] is False, config
    # Within a decision every request extends the previous one unchanged: the cacheable prefix is never rewritten.
    for before, after in zip(parent, parent[1:]):
        if after["message_count"] > before["message_count"] and after["current"] == before["current"]:
            assert after["transcript"][:len(before["transcript"])] == before["transcript"], (before["transcript"], after["transcript"])
    # Across decisions, the earlier decisions' transcript is unchanged as well (only the current head is rebuilt).
    starts = [r for r, p in zip(parent[1:], parent) if r["current"] != p["current"]]
    for before, after in zip(starts, starts[1:]):
        users = [i for i, m in enumerate(before["transcript"]) if m["role"] == "user"]
        assert after["transcript"][:users[-1]] == before["transcript"][:users[-1]], 'history before the head must be byte-stable'
    # The current grid is in view as row runs, and show() prints a region the same way.
    assert all("as row runs" in s for s in [r.get("current", "") for r in parent]), parent[0].get("current", "")[:2000]
    assert summary["actions"] == summary["actions_on_bridge"] == len(trajectory)
    # The context is the harness plus the present: no runtime-made analyses resident; ledger and memory are files.
    current = [r.get("current", "") for r in parent]
    for absent in ["GOAL CHECKS", "IDEAS", "PREDICTION CHALLENGE", "EXPLORATION", "CRITIC", "REPEATED WORK", "STRATEGY ("]:
        assert not any(absent in s for s in current), absent
    assert all(("MEMORY INDEX" in s or "MEMORY: empty" in s or "CURRENT KNOWLEDGE" in s) for s in current)
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
        assert any("the predicted level change did not happen" in t for t in triggers), triggers
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
elif script == "runtime-evidence":
    assert summary["actions"] >= 2, summary
    assert any("RUNTIME EVIDENCE" in row.get("current", "") for row in parent_requests), [row.get("current", "") for row in parent_requests]
    assert any("3 recent calls share code structure" in row.get("current", "") for row in parent_requests)
    repeat_evidence = [row.get("current", "") for row in parent_requests if "Exact python input repeated 2 times" in row.get("current", "")]
    assert repeat_evidence and all(row.count("Exact python input repeated 2 times") == 1 for row in repeat_evidence), parent_requests
    assert any("Exact read input repeated 2 times from the same visible state" in row.get("current", "") for row in parent_requests), parent_requests
elif script == "runtime-evidence-review":
    reviews = [row.get("current", "") for row in parent_requests if "ROUND 1 - REVIEW AND GAPS" in row.get("current", "")]
    assert reviews, [row.get("current", "")[-1200:] for row in parent_requests]
    task_requests = [row for row in parent_requests if "ROUND 1 - REVIEW AND GAPS" not in row.get("current", "")]
    assert task_requests and all('full_self' not in row.get('current', '') for row in task_requests), task_requests
    assert any('read_self(section=' in prompt and '"evolution"' in prompt for prompt in reviews), reviews
    assert all(any(tool.get('name') == 'read_self' and tool.get('description', '').startswith('On-demand lookup')
                   for tool in row.get('tools', [])) for row in parent_requests), parent_requests
    assert any("RUNTIME EVIDENCE" in prompt and "recent calls share code structure" in prompt for prompt in reviews), reviews
    assert any("diagnose and verify a response or record why no change is useful" in prompt for prompt in reviews), reviews
    assert any("exact python input repeated 2 times" in prompt and "runtime:repeat:" in prompt for prompt in reviews), reviews
    assert any("exact read input repeated 2 times from the same visible state" in prompt for prompt in reviews), reviews
    assert all(prompt.count("## RUNTIME EVIDENCE") == 1 for prompt in reviews), reviews
    pi_events = [json.loads(line) for line in (root / "pi-events.jsonl").read_text(encoding="utf-8").splitlines()]
    self_receipts = [event.get("result", {}).get("content", [{}])[0].get("text", "") for event in pi_events
                     if event.get("type") == "tool_execution_end" and event.get("toolName") == "read_self"]
    assert any("SelfRoot r1; entries 1-8/" in receipt and "semantic use is not inferred" in receipt
               and "read_self_component" in receipt and "long line not shown" not in receipt
               and len(receipt) < 1000 and "omitted lines" not in receipt for receipt in self_receipts), self_receipts
    deliveries = [json.loads(line) for line in (root / 'harness/task_runtime_fact_delivery.jsonl').read_text(encoding='utf-8').splitlines()]
    assert any(str(row.get('key', '')).startswith('task:python:') for row in deliveries), deliveries
    assert any(str(row.get('key', '')).startswith('review:python:') for row in deliveries), deliveries
    assert summary["actions"] >= 1, summary
elif script == "components":
    assert (root/'consult-length.jsonl').is_file(), 'consult length continuation must reach semantic result'
    for expected in ["compare v1", "42", "v2: saved", "NOT loaded", "v1 still runs", "compare v3", "43", "53", "CONSULT_SEMANTIC", "NATIVE_SKILL_BODY_READ_ON_DEMAND"]:
        assert expected in text, expected
    parent = [r for r in requests if not r.get("analyst") and not r.get("critic")]
    assert any("NATIVE_STANDING_RULE" in r["system_prompt"] for r in parent)
    assert "NATIVE_STANDING_RULE" not in parent[-1]["system_prompt"]
    assert any("NATIVE_SKILL_DESCRIPTION" in r["head"] for r in parent)
    task_facts = [json.loads(line) for line in (root / "harness/self_harness_task_facts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(row.get("kind") == "component_delivery" and any(c.get("path") == "tools/compare.py" for c in row.get("components", [])) for row in task_facts), task_facts
    assert any(row.get("kind") == "component_execution" and row.get("path") == "tools/compare.py" and row.get("outcome") == "success" for row in task_facts), task_facts
    assert any("appeared in the active tool set" in r.get("current", "") and "no execution record" in r.get("current", "") for r in parent), parent
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
elif script == "components-feedback":
    feedback = [row.get("current", "") for row in parent_requests if "Component-use feedback runtime:component:tools/compare.py@1" in row.get("current", "")]
    assert feedback, parent_requests
    assert any("execution recorded success" in text and "environment action(s) have followed" in text
               and "temporal evidence, not causal attribution" in text for text in feedback), feedback
    assert summary["provider_errors"] == 0 and summary["actions"] >= 3, summary
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
elif script == 'guard':
    # The harness turn and the guard place (docs/plans/2026-10-26-e1-harness-turn-protocol.md R5) through real Pi, the
    # production bridge, the mock SDK and WASI: the review sees its contract and loop audit, saves a guard whose EXPECT
    # trailer is recorded and stripped, and the guard refuses ACTION3 before the game sees it.
    assert config['harness_turn'] is True and config['guards'] is True, config
    reviews = [r for r in parent_requests if r.get('current', '').startswith('STALL REVIEW.')]
    assert reviews, [r.get('current', '')[:200] for r in parent_requests]
    review = reviews[0]['current']
    assert 'Available places are prompt, view, predictor, guard and callable tool;' in review and 'NO HARNESS CHANGE: <reason>' in review, review[:1500]
    assert 'LOOP AUDIT (facts only; 2 actions' in review and 'prompts/review.md' not in review, review[:2500]
    assert all('def admit(state, action) is asked before every action is sent' in r['system_prompt'] for r in parent_requests)
    saved = (root / 'workspace/tools/no_three.py').read_text(encoding='utf-8')
    assert 'def admit(state, action)' in saved and 'HARNESS EXPECT' not in saved, saved
    rows = lambda name: [json.loads(s) for s in (root / 'harness' / name).read_text(encoding='utf-8').splitlines() if s.strip()]
    assert [(r['path'], r['review']) for r in rows('harness_changes.jsonl')] == [('tools/no_three.py', 'stall')], rows('harness_changes.jsonl')
    [expectation] = rows('harness_expectations.jsonl')
    assert expectation['kind'] == 'candidate' and expectation['within'] == 3 and 'def check(t)' in expectation['check'], expectation
    assert any('EXPECT recorded for v1: "no ACTION3 is played" within 3 actions' in r['text'] for r in results if r['tool'] == 'python'), \
        [r['text'][:300] for r in results if r['tool'] == 'python']
    guards = [(r['action'], r['verdict']) for r in rows('guard_runs.jsonl')]
    assert guards == [('ACTION3', 'refuse'), ('ACTION1', 'allow'), ('ACTION4', 'allow')], guards
    played = [r['action'] for r in rows('trajectory.jsonl')]
    assert played == ['ACTION1', 'ACTION4', 'ACTION1', 'ACTION4'], played
    refusal = 'ACTION3 was NOT played: refused by your guard tools/no_three.py v1: ACTION3 is refused by my rule. ' \
              "This is your own rule, not the game's: the game did not see this action."
    assert any(refusal in r['text'] for r in results if r['tool'] == 'arc_action'), [r['text'][:300] for r in results if r['tool'] == 'arc_action']
    assert summary['stall_reviews'] == 1 and summary['actions'] == summary['actions_on_bridge'] == 4, summary
    print(json.dumps({'guard_checks': {'review_contract': True, 'loop_audit': True, 'guard_saved': True, 'expect_recorded': True,
                                       'guard_refused': guards[0], 'played': played}}), flush=True)
elif script == 'meta':
    # The meta layer's example (E1b): at a harness turn the scripted agent writes a hypothesis and an experiment for it, a
    # hook keeping a measured map, a hook checking the experiment and backfilling the hypothesis, and a guard playing the
    # experiment first; the harness hosts them from then on. Real Pi, production bridge, mock SDK, WASI; scripted provider.
    assert config['harness_turn'] is True and config['guards'] is True and config['hooks'] is True, config
    rows = lambda name: [json.loads(s) for s in (root / 'harness' / name).read_text(encoding='utf-8').splitlines() if s.strip()] \
        if (root / 'harness' / name).is_file() else []
    reviews = [r['current'] for r in parent_requests if r.get('current', '').startswith('STALL REVIEW.')]
    assert len(reviews) >= 2 and 'Available places are prompt, view, predictor, guard, hook and callable tool;' in reviews[0], reviews[:1]
    assert all('def after(state, t) runs after every action' in r['system_prompt'] for r in parent_requests)
    saved = (root / 'workspace/tools/level_map.py').read_text(encoding='utf-8')
    assert 'def after(state, t)' in saved and 'HARNESS EXPECT' not in saved, saved
    assert [r['path'] for r in rows('harness_expectations.jsonl') if r.get('kind') == 'candidate'] == ['tools/level_map.py'], rows('harness_expectations.jsonl')
    played = [r['action'] for r in rows('trajectory.jsonl')]
    assert played == ['ACTION1', 'ACTION4', 'ACTION1', 'ACTION4', 'ACTION2'], played
    guards = [(r['action'], r['verdict']) for r in rows('guard_runs.jsonl')]
    assert guards == [('ACTION3', 'refuse'), ('ACTION1', 'allow'), ('ACTION4', 'allow'), ('ACTION2', 'allow')], guards
    hooks = sorted((r['path'], r['from'], r['to'], r['ok']) for r in rows('hook_runs.jsonl'))
    assert hooks == [('tools/experiments.py', 3, 3, True), ('tools/experiments.py', 4, 4, True),
                     ('tools/level_map.py', 3, 3, True), ('tools/level_map.py', 4, 4, True)], hooks
    level_map = json.loads((root / 'workspace/artifacts/level_map.json').read_text(encoding='utf-8'))
    assert level_map == {'visited': [[5, 3], [6, 3]], 'nine': [6, 3]}, level_map
    assert json.loads((root / 'workspace/notes/experiments.json').read_text(encoding='utf-8')) == []
    memory_text = (root / 'harness/memory.jsonl').read_text(encoding='utf-8')
    assert 'pinned experiment ACTION1' in memory_text and 'the 9 moved +1' in memory_text, memory_text[-1500:]
    after_three = [r['current'] for r in parent_requests if 'level_map v1 after #3' in r.get('current', '')]
    assert after_three and '{"checked":"ACTION1","verdict":"supports","next":null}' in after_three[0], after_three[:1]
    assert any('HARNESS EXPECT RESULTS' in text and 'tools/level_map.py v1' in text and 'check(t) returned true at #3' in text for text in reviews[1:]), reviews[1:]
    assert any('tools/level_map.py v1: ran on' in text for text in reviews[1:]), [t[:1500] for t in reviews[1:]]
    assert summary['stall_reviews'] == 2 and summary['actions'] == summary['actions_on_bridge'] == 5, summary
    print(json.dumps({'meta_checks': {'contract_names_hook': True, 'hooks_hosted': hooks, 'level_map': level_map, 'guarded': guards,
                                      'backfilled': True, 'expect_returned': True, 'played': played}}), flush=True)
elif script == 'auto-component':
    assert any(any(tool.get('name') == 'double' for tool in request.get('tools', [])) for request in parent_requests), 'automatically mounted tool must reach Pi provider schema'
    assert 'Double a supplied number. Applies: numeric inputs.' in shown_history, 'compact SelfRoot view must show purpose and scope'
    assert any(result.get('tool') == 'double' and not result.get('is_error') and '8' in result.get('text', '')
               for request in parent_requests for result in request.get('last_tool_results', [])), 'the mounted tool must execute successfully'
    assert summary['actions'] >= 2 and summary['provider_errors'] == 0, summary
elif script == 'observer':
    views = [json.loads(line) for line in (root / 'harness/observer_runs.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [(row['n'], row['ok']) for row in views] == [(0, True), (1, True)], views
    assert all('OBS_MARKER 8' in row['current'] for row in parent_requests[1:3]), parent_requests[1:3]
    assert summary['actions'] >= 1 and summary['provider_errors'] == 0, summary
elif script == 'checkpoint':
    checkpoints = [row.get('current', '') for row in parent_requests if 'task-memory:checkpoint:active' in row.get('current', '')]
    assert len(checkpoints) >= 2, parent_requests
    latest = checkpoints[-1]
    assert 'Active experiment strat.probe: test horizontal movement' in latest, latest
    assert 'hyp.motion [contested]' in latest and 'predicts the marker advances one cell' in latest, latest
    assert 'first result refuted the horizontal prediction' in latest and 'test ACTION4 from the new position' in latest, latest
    assert 'memory:hyp.motion' in latest and '[arc_action] step 1' in latest and '[arc_action] step 2' in latest, latest
    assert 2 <= summary['actions'] <= 3 and summary['provider_errors'] == 0, summary
elif script == 'observer-lifecycle':
    views = [json.loads(line) for line in (root / 'harness/observer_runs.jsonl').read_text(encoding='utf-8').splitlines()]
    versions = [(row['version'], row['n'], row['ok']) for row in views]
    assert versions[:4] == [(1, 0, True), (1, 1, True), (2, 1, True), (2, 2, True)], views
    assert len(versions) >= 6 and all(row['version'] == 3 and not row['ok'] for row in views[4:]), views
    state_counts = [(row['version'], row['n'], row.get('observer_state', {}).get('count')) for row in views if row['ok']]
    assert state_counts == [(1, 0, 1), (1, 1, 2), (2, 1, 1), (2, 2, 2)], views
    assert any('OBSERVER_V1 1' in row.get('current', '') for row in parent_requests)
    assert any('OBSERVER_V2 1' in row.get('current', '') for row in parent_requests)
    assert all('observer_state' not in row.get('current', '') for row in parent_requests)
    failed_view = [row for row in parent_requests if 'OBSERVER_V3_FAILURE' in row.get('current', '')]
    assert failed_view and 'CURRENT STATE' in failed_view[0]['current'], failed_view
    active_issue_requests = [row for row in parent_requests if 'runtime:observer:tools/cell_marker.py@3' in row.get('current', '')
                             and 'latest error:' in row.get('current', '')]
    assert len(active_issue_requests) >= 2, active_issue_requests
    assert 3 <= summary['actions'] <= 6 and summary['provider_errors'] == 0, summary
elif script == 'observer-semantic':
    views = [json.loads(line) for line in (root / 'harness/observer_runs.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [(row['version'], row['n'], row['ok'], row.get('semantic_view')) for row in views[:4]] == [
        (1, 0, True, True), (1, 1, True, True), (2, 1, False, True), (2, 2, False, True)], views
    compact = [row for row in parent_requests if 'SEMANTIC_BOARD marker=' in row.get('current', '')]
    assert compact and all('current grid (latest_frame.frame[-1])' not in row['current'] for row in compact), compact
    assert all(re.search(r'SEMANTIC_BOARD marker=(\d+).*Raw current frame: data/frames/\1\.json', row['current'], re.S)
               for row in compact), compact
    assert all(not row.get('image_blocks') for row in compact), compact
    fallback = [row for row in parent_requests if 'SEMANTIC_OBSERVER_FAILURE' in row.get('current', '')]
    assert fallback and all('current grid (latest_frame.frame[-1])' in row['current'] for row in fallback), fallback
    assert all('Raw current frame: data/frames/' not in row['current'] for row in fallback), fallback
    assert all(row.get('image_blocks') for row in fallback), fallback
    assert 2 <= summary['actions'] <= 4 and summary['provider_errors'] == 0, summary
elif script == 'observer-restart':
    assert (root / 'observer-pi-restart.json').is_file(), 'Pi must restart between the same-state Python call and next action'
    views = [json.loads(line) for line in (root / 'harness/observer_runs.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [(row['n'], row['ok']) for row in views] == [(0, True), (1, True), (2, True), (3, False), (4, False)], views
    assert all(row['version'] == 1 for row in views), views
    state_counts = {n: sum(row['n'] == n for row in views) for n in {row['n'] for row in views}}
    assert state_counts.get(1) == 1 and state_counts == {n: 1 for n in state_counts}, views
    assert all(row.get('observer_state', {}).get('count') == row['n'] + 1 for row in views if row['ok']), views
    assert all('observer_state' not in row and 'state up to 8192 bytes' in row.get('error', '') for row in views[-2:]), views
    resumed = [row for row in parent_requests if row.get('step', 0) >= 4]
    view_lines = [line for row in resumed for line in row.get('current', '').splitlines()
                  if line.startswith('restart_view v1 state #2:')]
    assert any('RESTART_VIEW' in line and 'count' not in line for line in view_lines), (view_lines, resumed)
    assert all('observer_state' not in row.get('current', '') for row in resumed)
    assert summary['actions'] >= 3 and summary['provider_errors'] == 0, summary
elif script == 'arc-history-delivery':
    after_first = next(row for row in parent_requests if row.get('step') == 5)
    after_repeat = next(row for row in parent_requests if row.get('step') == 6)
    first_text = '\n'.join(item.get('text', '') for item in after_first.get('transcript', []))
    repeated_text = '\n'.join(item.get('text', '') for item in after_repeat.get('transcript', []))
    assert all(token in first_text for token in ('ARC history:', '#3 ACTION1', '#2 ACTION1', '#1 ACTION1', 'next_offset=none')), first_text
    assert 'Result ok;' not in first_text and 'chars omitted' not in first_text, first_text
    assert 'Same answer as results/' in repeated_text and repeated_text.count('ARC history:') == 1, repeated_text
    assert not any(item.get('role') == 'toolResult' for item in after_repeat.get('transcript', [])), after_repeat
    evidence = [row for row in (json.loads(line) for line in (root / 'harness/self_harness_task_facts.jsonl').read_text(encoding='utf-8').splitlines())
                if row.get('kind') == 'tool' and row.get('tool') == 'read_self' and 'transition:1' in str(row.get('input'))]
    assert evidence and 'history move 1' in evidence[0].get('output', '') and 'data/frames/1.json' in evidence[0].get('output', '')
    assert not evidence[0].get('result_ref'), evidence
    assert summary['actions'] == 4 and summary['provider_errors'] == 0, summary
elif script == 'tool-isolation':
    assert config['tool_history_isolation'] == {'enabled': True, 'recent_batches': 0}, config['tool_history_isolation']
    isolated = next((row for row in parent_requests if row.get('step') == 5), None)
    assert isolated, parent_requests
    transcript = json.dumps(isolated.get('transcript', []), ensure_ascii=False)
    assert all(f'TOOL_ISOLATION_SECRET_{n}' not in transcript for n in (1, 2)), transcript
    assert all(f'TOOL_ISOLATION_SECRET_{n}' not in transcript for n in (3, 4)), transcript
    archive = [json.loads(line) for line in (root / 'harness/tool_history_archive.jsonl').read_text(encoding='utf-8').splitlines()]
    assert all(row['ref'] in transcript for row in archive if row['tool'] == 'python'), (archive, transcript)
    archived_records = [json.loads((root / 'workspace' / row['ref']).read_text(encoding='utf-8')) for row in archive]
    archived_source = json.dumps(archived_records, ensure_ascii=False)
    assert all(f'TOOL_ISOLATION_SECRET_{n}' in archived_source for n in (1, 2)), archived_records
    calls = [call for message in isolated.get('transcript', []) for call in message.get('calls', [])]
    assert all(call.get('id') not in {row['tool_call_id'] for row in archive} for call in calls), calls
    assert not any(row.get('role') == 'toolResult' for row in isolated.get('transcript', [])), isolated.get('transcript')
    assert len([row for row in archive if row['tool'] == 'python']) == 4
    assert summary['actions'] >= 1 and summary['provider_errors'] == 0, (archive, summary)
    context_rows = [json.loads(line) for line in (root / 'harness/context_budget.jsonl').read_text(encoding='utf-8').splitlines()]
    request_contexts = [row for row in context_rows if 'system_chars' in row]
    assert request_contexts and all(row.get('tool_history_isolation') is True and row.get('recent_tool_batches_kept') == 0
                                    for row in request_contexts), request_contexts
elif script == 'python-stateless':
    assert config['python_kernel'] is False and config['session_view'] is False, config
    python_tool = next(tool for tool in parent_requests[0]['tools'] if tool['name'] == 'python')
    assert 'save' not in python_tool['parameters']['properties'] and 'fresh sandbox' in python_tool['description'], python_tool
    assert 'do not persist' in python_tool['description'] and 'cannot act' in python_tool['description'], python_tool
    system = parent_requests[0].get('system_prompt', '')
    assert 'Python is a fresh, one-off sandbox' in system and 'cannot act' in system, system
    assert 'Python is a persistent sandbox' not in system and 'env.act' not in system and 'still publishes as a tool' not in system, system
    assert any('scratch_value' in result.get('text', '') and ('not defined' in result.get('text', '') or 'NameError' in result.get('text', ''))
               for result in results if result['tool'] == 'python'), results
    assert any('no action capability' in result.get('text', '') or 'read-only' in result.get('text', '')
               for result in results if result['tool'] == 'python'), results
    assert not (root / '.harness/python_session/HEAD.json').exists()
    calls = [json.loads(line) for line in (root / 'harness/python_calls.jsonl').read_text(encoding='utf-8').splitlines()]
    assert len(calls) == 5 and all(row.get('ephemeral') is True for row in calls), calls
    assert sum(bool(row.get('cached')) for row in calls) == 1, calls
    assert any('same code on the same state, not run again' in result.get('text', '')
               for result in results if result['tool'] == 'python'), results
    components = [json.loads(line) for line in (root / 'harness/component_runs.jsonl').read_text(encoding='utf-8').splitlines()]
    assert not any(row.get('kind') == 'python_component' for row in components), components
    assert any('STATELESS_OBSERVER 8' in row.get('current', '') for row in parent_requests), parent_requests
    assert summary['actions'] >= 1 and summary['provider_errors'] == 0, summary
else:
    assert "COUNTEREXAMPLE" in text and "EDITED_NOTE" in text
    assert "read-only" in text and "invalid workspace path" in text
    assert "PermissionError: invalid workspace path" in text and "NO_TOKEN" in text
assert (root / "workspace/data/frames/1.json").is_file()
assert "CURRENT STATE" not in (root / "session.jsonl").read_text(encoding="utf-8")
budgets = [json.loads(s) for s in (root / 'harness/context_budget.jsonl').read_text(encoding='utf-8').splitlines()]
assert all(r['system_chars'] <= 3000 and r['capability_index_chars'] <= 1200 for r in budgets if 'decision' in r and 'system_chars' in r)
summary["foundation_checks"] = {"query_observation": True, "native_history": True} if script == "query" else {"workspace": True, "secrets": True, "native_history": True}
path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(path)
