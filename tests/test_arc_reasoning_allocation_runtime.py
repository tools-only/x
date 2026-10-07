"""Exercise allocation consumption at the runner's actual RPC/recovery seam."""
import json

import pytest

from autoresearch_pi import arc_agi_3_e2e as runner


@pytest.mark.parametrize("recovery", ["length", "rejected_prompt"])
@pytest.mark.parametrize("geometry", [False, True])
@pytest.mark.parametrize("policy,declared,follow", [
    ("adaptive-binary", ("off", "medium"), "off"),
    ("adaptive-evidence", ("low", "medium"), "low"),
])
def test_deep_allocation_survives_incomplete_turn_and_is_consumed_on_completion(
    tmp_path, monkeypatch, recovery, policy, declared, follow, geometry
):
    if geometry and policy != 'adaptive-evidence':
        pytest.skip('Exact geometry batches apply only to adaptive-evidence')
    if geometry:
        (tmp_path/'task-checkpoint.json').write_text(json.dumps({'recent_actions':[
            {'action':'ACTION1','changed_cells':0,'observation_id':'a','level_after':0}]}),encoding='utf-8')
        (tmp_path/'arc-geometry-facts.json').write_text(json.dumps({'level':0,'facts':['stationary-a','pattern-b']}),encoding='utf-8')
    monkeypatch.setattr(runner, "_resolve_pi_cli", lambda: ("node", "cli.js"))
    monkeypatch.setattr(runner, "load_project_dotenv", lambda _: {})
    monkeypatch.setattr(runner, "resolve_model_settings", lambda _: {
        "thinking_format": "qwen", "base_url": "", "api_key": "", "model": "test",
        "pi_api": "openai-completions", "input_modalities": ["text"],
        "context_window": 175000, "max_tokens": 65536,
    })
    monkeypatch.setattr(runner, "_sync_bridge_events", lambda *args: 0)
    monkeypatch.setattr(runner, "_get_json", lambda _: {
        "state": "NOT_FINISHED", "levels_completed": 0, "action_budget": {},
        "available_actions": ["ACTION6"],
    })
    levels = []
    prompts = []
    sessions = []
    batches = [
        [{"type": "message_end", "message": {
            "role": "assistant", "stopReason": "length" if recovery == "length" else "aborted"}}],
        [{"type": "message_end", "message": {"role": "assistant", "stopReason": "toolUse"}}],
    ]

    class Kernel:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def send(self, command, **kwargs):
            if command == "set_thinking_level":
                levels.append(kwargs["level"])
            return {"success": True}

        def prompt(self, message):
            prompts.append(message)
            return {"success": not (recovery == "rejected_prompt" and len(prompts) == 2)}

        def new_session(self):
            sessions.append(True)

        def wait_for_event(self, *args, **kwargs):
            return {"type": "turn_start"}

        def wait_for_agent_events(self, **kwargs):
            if batches:
                return batches.pop(0)
            raise TimeoutError("bounded diagnostic end")

    monkeypatch.setattr(runner, "PiKernel", Kernel)
    assert runner._run_pi(
        tmp_path, bridge_url="http://test", game="test", variant="control",
        context_compaction=False, provider_extension=tmp_path / "provider.ts",
        reasoning_policy=policy, reasoning_levels=declared,
    ) == 124
    assert sessions == [True]
    recovery_prompt = prompts[1] if recovery == "length" else prompts[2]
    assert prompts[0] in recovery_prompt
    saved_purpose = json.loads((tmp_path / "arc-parent-purpose.json").read_text(encoding="utf-8"))
    assert saved_purpose["prompt"] == prompts[0]
    assert levels == (["medium", "medium", follow] if recovery == "length" else
                      ["medium", "medium", "medium", follow])
    trace = [json.loads(line) for line in (tmp_path / "pi-events.jsonl").read_text().splitlines()]
    consumed = [event for event in trace if event["type"] == "reasoning_policy_consumed"]
    assert len(consumed) == 1
    assert (consumed[0]["opportunity_ref"].startswith('geometry-batch:0:') if geometry
            else consumed[0]["opportunity_ref"] == "initial-discovery")
    assert consumed[0]["evidence"] == "complete_native_assistant_message"
    selections = [event for event in trace if event["type"] == "reasoning_policy_selection"]
    assert selections[-1]["level"] == follow
    assert selections[-2]["reason"] == "length_recovery_preserves_allocation"
