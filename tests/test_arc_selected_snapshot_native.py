"""Exact scene handoff through the real ARC extension, broker and child Pi.

Providers are diagnostic fixtures, not evidence of autonomous model adoption.
"""
import json
import subprocess
from pathlib import Path

import pytest

from test_arc_capability_surface_native import _run_arc_parent
from test_pi_external_benchmark_native import _pi_cli, _run_fixture


PROJECT = Path(__file__).resolve().parents[1]
FIRST = "observation_snapshot:parent-state-1@v1"
SECOND = "observation_snapshot:parent-state-2@v1"


def seed(root):
    node, _ = _pi_cli()
    script = """
      import { registerArcObservationSnapshot } from './demo/pi_arc_observation_snapshot.ts';
      for (const cell of [4, 7]) registerArcObservationSnapshot(process.argv[1], {
        game_id: 'fixture', state: 'NOT_FINISHED', levels_completed: 0,
        available_actions: ['ACTION1'], frames: [Array.from({length:16}, () => Array(20).fill(cell))],
        action_budget: {total_used: cell === 4 ? 0 : 1}, private_field: 'must not escape'
      });
    """
    subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script, str(root)],
                   cwd=PROJECT, check=True, capture_output=True, text=True)


def read_rows(root, name):
    path = root / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def run(root, refs=(), *, ref_channel="evidence_refs", length=False, delegate_overrides=None):
    _, cli = _pi_cli()
    recipe = {"include_checkpoint": False, "recent_observations": 0, "recent_actions": 0,
              "inherit_harness_refs": list(refs) if ref_channel == "inherited" else [], "max_chars": 12000}
    steps = [
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "subagent-creator"}},
        {"name": "task_harness_create", "arguments": {"candidate": {
            "component": "subagent", "name": "scene-reader", "description": "Read selected public cells.",
            "instructions": "Return the row count and first cell of the explicitly provided scene.",
            "tools": [], "context_recipe": recipe},
            "assembly": {"expected_assembly_revision": 0, "selected_resource_refs": [], "prompt_contributions": []},
            "decision": {"basis_refs": [], "reason": "Use a bounded isolated scene reader.", "expected": "Return the selected cell."}}},
        {"name": "delegate_task", "arguments": {"agent_name": "scene-reader", "task": "Count rows and read cell (0,0).",
            **({ref_channel: list(refs)} if ref_channel != "inherited" else {}),
            **(delegate_overrides or {})}},
    ]
    return _run_arc_parent(root, steps, extra_env={
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(PROJECT / "tests/pi_subagent_provider.ts"),
        "PI_ARC_INPUT_MODALITIES": "text,image", "PI_ARC_CHILD_OBSERVATION": "published",
        "PI_SUBAGENT_SCENE_FROM_CONTEXT": "1", "PI_SUBAGENT_FORCE_LENGTH_ONCE": "1" if length else "0",
        # A stale inherited marker must not fabricate a scene for a new launch.
        "PI_TASK_CHILD_STATE_SNAPSHOT_REF": "observation_snapshot:stale@v1",
        "PI_TASK_CHILD_STATE_SNAPSHOT": '{"frames":[[[15]]]}',
    })


@pytest.mark.parametrize("ref_channel", ["evidence_refs", "resource_refs", "inherited"])
def test_pure_saved_role_sees_exact_historical_scene_in_all_child_continuations(tmp_path, ref_channel):
    seed(tmp_path)
    events = run(tmp_path, [FIRST, FIRST], ref_channel=ref_channel, length=True)
    errors = [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assert not errors, errors
    invocations = read_rows(tmp_path, "subagent-invocations.jsonl")
    result = json.loads(invocations[0]["result"]["text"])
    assert result == {"rows": 16, "columns": 20, "first_cell": 4, "image_count": 1,
                      "tools": ["task_resource", "child_context"]}
    contexts = read_rows(tmp_path, "subagent-provider-contexts.jsonl")
    assert len(contexts) == 2
    for item in contexts:
        ctx = item["context"]
        encoded = json.dumps(ctx)
        assert FIRST in encoded and "private_field" not in encoded
        assert "fixed at delegation" not in encoded
        assert "current; arc_state" not in ctx["systemPrompt"]
        assert not ({"arc_state", "inspect_arc_trajectory", "arc_action"} & {t["name"] for t in ctx["tools"]})
    # Publication offers the latest exact ref; explicitly choosing older evidence wins.
    create = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness_create")
    assert SECOND in json.dumps(create["result"])
    assert read_rows(tmp_path, "subagent-context-bindings.jsonl")[0]["effective_tools"] == []


@pytest.mark.parametrize("refs", [[], [FIRST, SECOND]])
def test_no_unique_explicit_scene_does_not_guess_or_expand_permissions(tmp_path, refs):
    seed(tmp_path)
    events = run(tmp_path, refs)
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    result = json.loads(read_rows(tmp_path, "subagent-invocations.jsonl")[0]["result"]["text"])
    assert result["rows"] == 0 and result["image_count"] == 0
    assert result["tools"] == ["task_resource", "child_context"]


def test_unknown_context_recipe_field_fails_before_blind_arc_child(tmp_path):
    events = run(tmp_path, delegate_overrides={
        "task": "Analyze the current public ARC frame and action deltas.",
        "context_recipe": {"include": ["current_public_observation", "recent_action_deltas", "grid"]},
    })
    call = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "delegate_task")
    assert call.get("isError")
    assert "context_recipe.include is unsupported" in json.dumps(call["result"])
    assert not read_rows(tmp_path, "subagent-invocations.jsonl")
    assert not read_rows(tmp_path, "subagent-context-bindings.jsonl")
    assert not read_rows(tmp_path, "subagent-provider-contexts.jsonl")
    contexts = read_rows(tmp_path, "provider-contexts.jsonl")
    schema = next(tool for row in contexts for tool in row["context"]["tools"]
                  if tool["name"] == "delegate_task")
    assert "recent_observations" in json.dumps(schema)
    assert "ARC scene: include arc_state" in json.dumps(schema)


@pytest.mark.parametrize("bad", ["missing", "malformed", "cross_task"])
def test_invalid_scene_rejected_before_child_launch(tmp_path, bad):
    seed(tmp_path)
    ref = FIRST
    if bad == "missing":
        ref = "observation_snapshot:missing@v1"
    elif bad == "malformed":
        ref = "observation_snapshot:parent-state-1"
    else:
        rows = read_rows(tmp_path, "observation-snapshots.jsonl")
        rows[0]["task_id"] = "another-task"
        (tmp_path / "observation-snapshots.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    events = run(tmp_path, [ref])
    errors = [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assert errors
    assert not read_rows(tmp_path, "subagent-provider-contexts.jsonl")


def test_non_arc_adapter_keeps_selected_snapshot_as_an_ordinary_granted_resource(tmp_path):
    seed(tmp_path)
    _, cli = _pi_cli()
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[PROJECT / "tests/pi_non_arc_task_subagents.ts"], steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "subagent-creator"}},
        {"name": "task_harness_create", "arguments": {"candidate": {
            "component": "subagent", "name": "fixture-reader", "description": "Read granted fixture evidence.",
            "instructions": "Answer the bounded question.", "tools": []},
            "assembly": {"expected_assembly_revision": 0, "selected_resource_refs": [], "prompt_contributions": []},
            "decision": {"basis_refs": [], "reason": "Use a selected generic role.", "expected": "Preserve generic isolation."}}},
        {"name": "delegate_task", "arguments": {"agent_name": "fixture-reader", "task": "Read the granted resource.", "evidence_refs": [FIRST]}},
    ], extra_env={"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted", "PI_SUBAGENT_SCENE_FROM_CONTEXT": "1",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(PROJECT / "tests/pi_subagent_provider.ts")})
    errors = [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    assert not errors, errors
    invocation = read_rows(tmp_path, "subagent-invocations.jsonl")[0]
    assert invocation["adapter_id"] == "fixture"
    answer = json.loads(invocation["result"]["text"])
    assert answer["rows"] == 0 and answer["image_count"] == 0
    for item in read_rows(tmp_path, "subagent-provider-contexts.jsonl"):
        assert "PARENT-SELECTED ARC OBSERVATION" not in json.dumps(item)
