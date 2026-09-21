"""Real Pi diagnostic checks; ARC closure is verified separately by runner smoke."""
import json
import os
import subprocess
from pathlib import Path
import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results, harness_delivery, run_router_helper


def run_lifecycle_helper(expression):
	from test_pi_external_benchmark_native import _pi_cli
	node, _ = _pi_cli()
	helper = Path(__file__).resolve().parents[1] / "demo" / "pi_task_knowledge_lifecycle.ts"
	completed = subprocess.run([
		node, "--experimental-strip-types", "--input-type=module", "-e",
		f'import * as lifecycle from {json.dumps(helper.as_uri())};console.log(JSON.stringify({expression}));',
	], capture_output=True, text=True, env=os.environ.copy())
	assert completed.returncode == 0, completed.stderr
	return json.loads(completed.stdout)


def memory(key, content, **kwargs):
    return {"name": "task_memory", "arguments": {
        "action": "upsert", "key": key, "content": content, **kwargs}}


def projected(root, prefix):
    context = records(root, "provider-contexts.jsonl")[-1]["context"]
    return [p["text"] for m in context["messages"] for p in m.get("content", [])
            if p.get("type") == "text" and p["text"].startswith(prefix)]


def test_unload_changes_availability_without_invalidating_content():
	result = run_lifecycle_helper("(()=>{const r={key:'probe',version:1,status:'active'};const n=lifecycle.applyKnowledgeControl(r,{operation_id:'op-1',source:'parent_direct',operation:'unload',target_ref:'memory:probe@v1',reason:'not needed now'});return {availability:n.availability,evidence:n.evidence_status,version:n.version,revision:n.control_revision}})()")
	assert result == {"availability": "unloaded", "evidence": "untested", "version": 1, "revision": 1}


def test_refuted_evidence_makes_guidance_ineligible_but_contested_does_not():
	result = run_lifecycle_helper("(()=>{const base={key:'probe',version:1,status:'active'};const c=lifecycle.applyKnowledgeControl(base,{operation_id:'op-c',source:'research',operation:'assess',target_ref:'memory:probe@v1',reason:'one counterexample',evidence_status:'contested',evidence_refs:['observation:2']});const f=lifecycle.applyKnowledgeControl(base,{operation_id:'op-f',source:'research',operation:'assess',target_ref:'memory:probe@v1',reason:'prediction failed',evidence_status:'refuted',evidence_refs:['observation:3']});return {contested:lifecycle.knowledgeState([{kind:'memory',record:c}]).eligible('memory',c),refuted:lifecycle.knowledgeState([{kind:'memory',record:f}]).eligible('memory',f)}})()")
	assert result == {"contested": True, "refuted": False}


def test_content_revision_cannot_inherit_old_custom_prompt(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        memory("position", "OLD_BODY", summary="OLD_SUMMARY",
               projection={"channel": "task_prompt", "prompt_text": "OLD_PROMPT"}),
        memory("position", "NEW_BODY", target_version=1),
    ])
    assert not any(e.get("isError") for e in results(events, "task_memory"))
    current = records(tmp_path, "task-memory.jsonl")[-1]
    assert "prompt_text" not in current["projection"]
    prompt = "".join(projected(tmp_path, "Active dynamic task/user prompt knowledge"))
    assert "NEW_BODY" in prompt and "OLD_PROMPT" not in prompt
    assert "OLD_SUMMARY" not in "".join(projected(tmp_path, "Active task-local memory"))


def test_summary_only_revision_rejected_without_promoting_version(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        memory("position", "OLD_BODY", summary="old position"),
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "position",
            "target_version": 1, "summary": "new position"}},
    ])
    assert results(events, "task_memory")[-1].get("isError")
    assert len(records(tmp_path, "task-memory.jsonl")) == 1


def test_replacement_suspends_dependent_skill_and_policy_transitively(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        memory("old-model", "OLD_MODEL"),
        {"name": "task_skill", "arguments": {"action": "create", "name": "route",
            "instructions": "OLD_ROUTE", "depends_on_refs": ["memory:old-model@v1"]}},
        memory("policy", "OLD_POLICY", depends_on_refs=["skill:route@v1"],
               projection={"channel": "task_prompt", "layer": "task_policy"}),
        memory("new-model", "NEW_MODEL", supersedes_refs=["memory:old-model@v1"]),
        {"name": "read", "arguments": {"path": str(tmp_path / "task-harness/skills/route/SKILL.md")}},
    ])
    assert not any(e.get("isError") for e in results(events, "task_memory"))
    assert results(events, "read")[-1].get("isError")
    assert not projected(tmp_path, "Active task-local skills")
    assert not projected(tmp_path, "Active task policy")
    active = "".join(projected(tmp_path, "Active task-local memory"))
    assert "NEW_MODEL" in active and "OLD_MODEL" not in active and "OLD_POLICY" not in active
    notices = "".join(projected(tmp_path, "Task-local knowledge requiring review"))
    assert "superseded" in notices and "skill:route@v1" in notices and "memory:policy@v1" in notices


def test_dependency_revision_requires_explicit_revalidation_and_survives_resume(tmp_path):
    _run_fixture(tmp_path, "treatment", steps=[
        memory("model", "v1"),
        {"name": "task_skill", "arguments": {"action": "create", "name": "route",
            "instructions": "OLD_ROUTE", "depends_on_refs": ["memory:model@v1"]}},
        memory("model", "v2", target_version=1),
    ])
    assert not projected(tmp_path, "Active task-local skills")
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_skill", "arguments": {"action": "update", "name": "route",
            "target_version": 1, "instructions": "REVALIDATED_ROUTE",
            "depends_on_refs": ["memory:model@v2"]}},
    ])
    assert not results(events, "task_skill")[-1].get("isError")
    assert "REVALIDATED_ROUTE" in "".join(projected(tmp_path, "Active task-local skills"))


def test_layers_and_activation_are_selected_before_body_projection(tmp_path):
    _run_fixture(tmp_path, "treatment", steps=[
        memory("state", "STATE_BODY", projection={"channel": "task_prompt"}),
        memory("policy", "POLICY_BODY", projection={"channel": "task_prompt", "layer": "task_policy"}),
        memory("inactive-policy", "INACTIVE_BODY", projection={"channel": "task_prompt",
            "layer": "task_policy", "activation": {"type": "state_match", "path": "assertions.probe", "value": True}}),
    ])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    assert "POLICY_BODY" not in context["systemPrompt"]
    text = "\n".join(p.get("text", "") for m in context["messages"] for p in m.get("content", []))
    policy = "".join(projected(tmp_path, "Active task policy"))
    state = "".join(projected(tmp_path, "Active dynamic task/user prompt knowledge"))
    assert "POLICY_BODY" in policy and "INACTIVE_BODY" not in policy
    assert "STATE_BODY" in state and "POLICY_BODY" not in state
    assert text.index(policy) < text.index(state)
    assert "INACTIVE_BODY" not in "".join(projected(tmp_path, "Active task-local memory"))
    manifest = records(tmp_path, "task-prompt-assemblies.jsonl")[-1]
    assert {p["layer"] for p in manifest["selected"]} >= {"task_policy", "task_state"}
    assert all(len(p["sha256"]) == 64 for p in manifest["selected"])


def test_router_preserves_lifecycle_and_layer_metadata():
    delivery = harness_delivery("policy", "plan", "policy", "Read changes before moving.",
        context_visibility="always", prompt_layer="task_policy",
        depends_on_refs=["memory:model@v2"], supersedes_refs=["memory:old-policy@v1"])
    plan = run_router_helper(
        "router.compileHarnessRoute({runId:'run',approvalId:'p',approvalVersion:1,approvalStatus:'approved',delivery:JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT),capabilities:['task_memory']})",
        input_value=delivery)
    args = plan["steps"][0]["native_call"]["arguments"]
    assert args["projection"]["layer"] == "task_policy"
    assert args["depends_on_refs"] == delivery["depends_on_refs"]
    assert args["supersedes_refs"] == delivery["supersedes_refs"]


@pytest.mark.parametrize("links", [
    {"depends_on_refs": ["memory:missing@v1"]},
    {"supersedes_refs": ["memory:model@v9"]},
    {"depends_on_refs": ["skill:route@v1"]},  # route depends on the old model
])
def test_invalid_links_do_not_partially_write(tmp_path, links):
    events = _run_fixture(tmp_path, "treatment", steps=[
        memory("model", "v1"),
        {"name": "task_skill", "arguments": {"action": "create", "name": "route",
            "instructions": "route", "depends_on_refs": ["memory:model@v1"]}},
        memory("model", "bad", target_version=1, **links),
    ])
    assert results(events, "task_memory")[-1].get("isError")
    assert len(records(tmp_path, "task-memory.jsonl")) == 1


def test_metadata_update_preserves_views_and_projection_can_be_disabled(tmp_path):
    _run_fixture(tmp_path, "treatment", steps=[
        memory("position", "body", summary="summary", projection={"channel": "task_prompt", "prompt_text": "prompt"}),
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "position", "target_version": 1, "pinned": True}},
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "position", "target_version": 2, "projection": None}},
    ])
    versions = records(tmp_path, "task-memory.jsonl")
    assert versions[1]["summary"] == "summary"
    assert versions[1]["projection"]["prompt_text"] == "prompt"
    assert "projection" not in versions[2]
    assert not projected(tmp_path, "Active dynamic task/user prompt knowledge")


def test_conditional_policy_reads_pretty_checkpoint_and_changes_on_resume(tmp_path):
    (tmp_path / "task-checkpoint.json").write_text(json.dumps({"assertions": {"probe": True}}, indent=2))
    _run_fixture(tmp_path, "treatment", steps=[memory("policy", "CONDITIONAL_POLICY", projection={
        "channel": "task_prompt", "layer": "task_policy",
        "activation": {"type": "state_match", "path": "assertions.probe", "value": True}})])
    assert "CONDITIONAL_POLICY" in "".join(projected(tmp_path, "Active task policy"))
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    checkpoint["assertions"]["probe"] = False
    (tmp_path / "task-checkpoint.json").write_text(json.dumps(checkpoint, indent=2))
    _run_fixture(tmp_path, "treatment", steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}])
    assert not projected(tmp_path, "Active task policy")
    assert "memory:policy@v1" in records(tmp_path, "task-prompt-assemblies.jsonl")[-1]["inactive_condition_refs"]


def test_system_overlay_is_removed_after_prerequisite_revision_and_resume(tmp_path):
    _run_fixture(tmp_path, "treatment", steps=[
        memory("model", "v1"),
        {"name": "task_system_prompt", "arguments": {"action": "create", "name": "rule",
            "content": "DEPENDENT_SYSTEM_RULE", "depends_on_refs": ["memory:model@v1"]}},
    ])
    _run_fixture(tmp_path, "treatment", steps=[memory("model", "v2", target_version=1)])
    contexts = records(tmp_path, "provider-contexts.jsonl")
    assert "DEPENDENT_SYSTEM_RULE" in contexts[-1]["context"]["systemPrompt"]
    _run_fixture(tmp_path, "treatment", steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}])
    assert "DEPENDENT_SYSTEM_RULE" not in records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["systemPrompt"]
    assert records(tmp_path, "task-system-prompt-assemblies.jsonl")[-1]["selected"] == []


def test_supersession_stays_effective_after_replacement_retirement(tmp_path):
    events = _run_fixture(tmp_path, "treatment", steps=[
        memory("old", "OLD_RULE"), memory("new", "NEW_RULE", supersedes_refs=["memory:memory-1@v1"]),
        {"name": "task_memory", "arguments": {"action": "retire", "key": "new", "target_version": 1}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": "memory:old@v1"}},
    ])
    assert not projected(tmp_path, "Active task-local memory")
    assert "OLD_RULE" in json.dumps(results(events, "task_resource")[-1])
    assert "superseded" in "".join(projected(tmp_path, "Task-local knowledge requiring review"))


@pytest.mark.parametrize("terminal", [False, True])
def test_terminal_review_requires_leading_marker(tmp_path, terminal):
    prompt = ("ARC_TERMINAL_LEVEL_REVIEW: The environment run has ended." if terminal else
              "Play ARC. The final ARC_TERMINAL_LEVEL_REVIEW turn is read-only.")
    events = _run_fixture(tmp_path, "treatment", prompt=prompt, steps=[memory("probe", "value")])
    assert bool(results(events, "task_memory")[-1].get("isError")) == terminal
    assert bool(records(tmp_path, "task-memory.jsonl")) != terminal


def test_layers_and_review_notice_survive_context_compaction(tmp_path):
    _run_fixture(tmp_path, "treatment", context_max_chars=18000, steps=[
        memory("model", "OLD_MODEL"),
        memory("stale", "OLD_POLICY", depends_on_refs=["memory:model@v1"],
               projection={"channel": "task_prompt", "layer": "task_policy"}),
        memory("model", "NEW_MODEL", target_version=1),
        memory("policy", "CURRENT_POLICY", projection={"channel": "task_prompt", "layer": "task_policy"}),
        memory("state", "CURRENT_STATE", projection={"channel": "task_prompt", "layer": "task_state"}),
        *[{"name": "benchmark_probe", "arguments": {}} for _ in range(25)],
    ])
    assert any(row["archived_messages"] > 0 for row in records(tmp_path, "task-context-compactions.jsonl"))
    for prefix, marker in [("Active task policy:", "CURRENT_POLICY"),
                           ("Active dynamic task/user prompt knowledge:", "CURRENT_STATE"),
                           ("Task-local knowledge requiring review:", "memory:stale@v1")]:
        cards = projected(tmp_path, prefix)
        assert len(cards) == 1 and marker in cards[0]
    assert "OLD_POLICY" not in "".join(projected(tmp_path, "Active task policy:"))
