"""Prompt-boundary checks; these do not establish real-provider behavior."""
import json
from pathlib import Path
import pytest

from test_pi_external_benchmark_native import _pi_cli
from test_task_research_context import _run_fixture, results, records, run_research_protocol_helper


@pytest.mark.parametrize("arc_compact", [True, False])
def test_harness_references_are_read_only_and_arc_disclosure_is_lazy(tmp_path, arc_compact):
    project = Path(__file__).resolve().parents[1]
    files = {
        "charter": "harness_charter_operations.md", "components": "harness_components_operations.md",
        "memory": "harness_memory_operations.md", "assembly": "harness_assembly_operations.md",
        "review": "harness_review_operations.md", "opportunity": "harness_opportunity_reference.md",
        "induction": "state_transition_induction.md", "assessment": "harness_assessment_operations.md",
        "development": "harness_development_operations.md", "arc_reasoning": "arc_reasoning_reference.md",
        "research": "harness_research_operations.md", "experiments": "harness_experiments_operations.md",
    }
    events = _run_fixture(tmp_path, "treatment", arc_compact=arc_compact, steps=[
        {"name": "task_harness", "arguments": {"action": "contract"}},
        *[{"name": "task_harness", "arguments": {"action": "contract", "topic": topic}}
          for topic in files],
        *[{"name": "task_harness", "arguments": {"action": "contract", "topic": topic, "section": "all"}}
          for topic in ("development", "components", "assembly")],
    ])
    calls = results(events, "task_harness")
    assert len(calls) == len(files) + 4
    assert not any(call.get("isError") for call in calls)
    payloads = [json.loads(call["result"]["content"][0]["text"]) for call in calls]
    assert all(value["read_only"] for value in payloads)
    assert {entry["topic"] for entry in payloads[0]["topics"]} == set(files)
    assert "instructions" not in payloads[0]
    for index, payload in enumerate(payloads[1:], 1):
        expected = (project / "demo/prompts" / files[payload["topic"]]).read_bytes().decode("utf-8")
        expected = expected.replace("{{game}}", "the current game")
        if payload["topic"] == "opportunity":
            opportunities = records(tmp_path, "task-harness-opportunities.jsonl")
            latest = opportunities[-1] if opportunities else {}
            expected = expected.replace("{{observation_count}}", str(latest.get("observation_count", len(records(tmp_path, "execution-observations.jsonl")))))
            expected = expected.replace("{{repeated_operations}}", json.dumps(latest.get("repeated_operations", []), separators=(",", ":")))
            expected = expected.replace("{{missing_components}}", json.dumps(latest.get("missing_components", []), separators=(",", ":")))
        if payload["topic"] in {"development", "components", "assembly"}:
            if arc_compact and index <= len(files):
                expected = (project / f"demo/prompts/harness_{payload['topic']}_brief.md").read_bytes().decode("utf-8")
                assert len(expected) < 4000
                assert "expected_assembly_revision" in expected and "without recreating" in expected
                if payload["topic"] == "development":
                    assert "exact kind:name@vN" in expected and "check its semantic value" in expected
                if payload["topic"] == "components":
                    assert all(kind in expected for kind in ("Memory", "System Prompt", "Skill", "Tool", "Subagent"))
                    assert 'atom:{subject:' in expected and 'validity:{scope:' in expected
            elif payload["topic"] == "development":
                expected += "\n\n" + (project / "demo/prompts/capability_extraction_process.md").read_bytes().decode("utf-8")
        assert payload["instructions"] == expected
    initial = records(tmp_path, "provider-contexts.jsonl")[0]["context"]
    text = json.dumps(initial)
    development = (project / "demo/prompts/capability_extraction_process.md").read_bytes().decode("utf-8")
    if arc_compact:
        assert json.dumps(development)[1:-1] not in text
        assert "Capability workflow reference:" in text
        assert "baseline_method:skill-creator@sha256:" not in text
        assert "Skills" in text and "procedures" in text  # Keep role discovery resident.
    else:
        assert json.dumps(development)[1:-1] in text
    for filename in ("task-skills.jsonl", "task-memory.jsonl", "task-system-prompt.jsonl",
                     "task-tools.jsonl", "task-subagents.jsonl", "task-baseline-method-reads.jsonl",
                     "auto-research-sessions.jsonl", "task-harness-assemblies.jsonl",
                     "task-harness-reviews.jsonl", "task-harness-conversion-intents.jsonl"):
        assert not records(tmp_path, filename)


def test_original_prompt_rules_have_lossless_callable_destinations():
    """Prevent a short rewrite from silently dropping any original rule block."""
    import hashlib
    from collections import defaultdict

    project = Path(__file__).resolve().parents[1]
    baseline = json.loads((project / "tests/fixtures/arc_prompt_migration_baseline.json").read_text(encoding="utf-8"))
    groups = defaultdict(list)
    for unit in baseline["units"]:
        groups[(unit["source"], unit["paragraph"])].append(unit)
    for source, text in baseline["sources"].items():
        for index, paragraph in enumerate(text.split("\n\n")):
            if not paragraph.strip():
                continue
            key = (source, index)
            assert key in groups, f"Original rule has no destination: {key}"
            if source == "self_harness_index.md" and index == 0:
                counts, body = paragraph.split(". ", 1)
                segments = {"counts": counts + ".", "body": body.strip()}
            elif source == "arc_decision_cycle.md" and index == 19:
                review, rest = paragraph.split("The review persists", 1)
                research, experiments = ("The review persists" + rest).split("`task_harness(action=inspect)` may", 1)
                segments = {"review": review.strip(), "research": research.strip(),
                            "experiments": ("`task_harness(action=inspect)` may" + experiments).strip()}
            else:
                segments = {None: paragraph.strip()}
            assert {unit.get("segment") for unit in groups[key]} == set(segments)
            for unit in groups[key]:
                original = segments[unit.get("segment")]
                assert hashlib.sha256(original.encode()).hexdigest() == unit["text_sha256"]
                migrated = original
                for replacement in unit.get("delivery_replacements", []):
                    assert migrated.count(replacement["before"]) == 1
                    migrated = migrated.replace(replacement["before"], replacement["after"])
                destination = (project / "demo/prompts" / unit["file"]).read_text(encoding="utf-8")
                assert migrated in destination, f"Original rule was altered or lost: {key}"


def test_assembly_contract_uses_current_revision_without_reassembling(tmp_path):
    events = _run_fixture(tmp_path, "treatment", arc_compact=True, steps=[
        {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
            "selected_resource_refs": [], "decision": {"basis_refs": [], "reason": "Use the empty baseline.",
                                                          "expected": "No selected components."}}},
        {"name": "task_harness", "arguments": {"action": "contract", "topic": "assembly"}},
    ])
    calls = results(events, "task_harness")
    assert len(calls) == 2 and not any(call.get("isError") for call in calls)
    contract = json.loads(calls[-1]["result"]["content"][0]["text"])
    assert contract["current_assembly"]["revision"] == 1
    assert contract["assemble_template"]["expected_assembly_revision"] == 1
    assert contract["assemble_template"]["selected_resource_refs"] == []
    assert len(records(tmp_path, "task-harness-assemblies.jsonl")) == 1


def test_research_scope_representation_is_reachable_without_a_dedicated_profile(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        steps=[{"name": "auto_research", "arguments": {
            "action": "start", "scope": "representation", "research_kind": "representation",
            "question": "Compare two interpretations of the current observation.",
        }}],
    )
    result = results(events, "auto_research")[0]
    assert "must match a schema" not in json.dumps(result)
    assert "Unknown research scope" not in json.dumps(result)


def test_parent_can_read_operations_without_starting_research(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        steps=[{"name": "auto_research", "arguments": {"action": "contract"}}],
    )
    response = results(events, "auto_research")[0]
    assert not response.get("isError")
    contract = json.loads(response["result"]["content"][0]["text"])
    assert contract["format"] == "auto-research-operations-v1"
    assert contract["instructions"]
    assert not records(tmp_path, "auto-research-sessions.jsonl")
    assert not records(tmp_path, "auto-research-plans.jsonl")


def test_workset_keeps_research_resume_state_when_optional_material_is_trimmed():
    checkpoint = {"cursor": "tested-A", "draft_findings": ["A contradicted"],
                  "unresolved_questions": ["Does B explain it?"], "next_step": "Test B"}
    result = run_research_protocol_helper(
        "protocol.buildResearchWorkset(JSON.parse(process.env.AUTORESEARCH_PROTOCOL_TEST_INPUT), 1100)",
        input_value={"goal": "Resolve mechanism", "research_checkpoint": checkpoint,
                     "selected_context": "x" * 4000},
    )
    assert result["research_checkpoint"] == checkpoint
    assert result["projection"]["truncated"]
    assert len(json.dumps(result, separators=(",", ":"))) <= 1100


@pytest.mark.parametrize("force_length", [False, True])
def test_child_workset_keeps_node_contract_and_parent_summary_provenance(tmp_path, force_length):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    report = {"format": "auto-research-report-v1", "status": "inconclusive",
              "conclusion": "More evidence required.", "findings": [], "evidence_refs": [],
              "alternatives": [], "limitations": [], "validation_plan": "Request evidence.",
              "method_candidates": []}
    (tmp_path / "task-checkpoint.json").write_text(json.dumps({
        "working_summary": "A is rejected; B remains open.",
        "summary_basis_refs": ["observation:obs-a@v1"],
        "decision_capsule": {"hypothesis_id": "B", "prediction": "movement", "falsifier": "no movement"},
        "pending_operations": [{"operation_key": "probe-B"}],
    }), encoding="utf-8")
    plan = {"goal": "Resolve the global mechanism", "complexity_assessment": {
        "level": "compound", "rationale": "Evidence then interpretation"},
        "nodes": [{"node_id": "a", "question": "Check evidence", "completion_contract": "Evidence or explicit gap",
                   "constraints": ["Keep competing interpretations separate."]},
                  {"node_id": "b", "question": "Interpret evidence", "completion_contract": "Interpretation or gap",
                   "depends_on": ["a"], "activation_policy": "parent_release"}]}
    events = _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
                   "PI_AUTORESEARCH_MODEL": "scripted",
                   "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
                   "PI_SUBAGENT_REPORT": json.dumps(report),
                   "PI_SUBAGENT_FORCE_LENGTH_ONCE": "1" if force_length else "0",
                   "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}])},
        steps=[{"name": "auto_research", "arguments": {"action": "enqueue", "plan": plan}},
               {"name": "auto_research", "arguments": {"plan_ref": "research_plan:research-plan-1@v1",
                    "node_id": "a", "context_window": {"include_checkpoint": True}}}],
    )
    assert not results(events, "auto_research")[-1].get("isError")
    prompt = (tmp_path / ".task-child-prompts/auto-research-1_continuation-1.txt").read_text(encoding="utf-8")
    workset = json.loads(prompt.split("\n", 1)[1].split("\nParent-selected", 1)[0])
    assert workset["current_node"]["node_id"] == "a"
    assert workset["current_node"]["completion_contract"] == "Evidence or explicit gap"
    assert workset["current_node"]["plan_goal"] == "Resolve the global mechanism"
    assert workset["constraints"] == ["Keep competing interpretations separate."]
    assert prompt.count("Resolve the global mechanism") == 1
    assert prompt.count("Evidence or explicit gap") == 1
    assert workset["checkpoint"]["summary_basis_refs"] == ["observation:obs-a@v1"]
    assert workset["checkpoint"]["decision_capsule"]["falsifier"] == "no movement"
    assert workset["checkpoint"]["pending_operations"] == [{"operation_key": "probe-B"}]
    if force_length:
        resumed = (tmp_path / ".task-child-prompts/auto-research-1_continuation-2.txt").read_text(encoding="utf-8")
        resumed_workset = json.loads(resumed.split("\n", 1)[1].split("\nParent-selected", 1)[0])
        assert resumed_workset["current_node"] == {
            "node_id": "a", "completion_contract": "Evidence or explicit gap",
        }
        assert "Keep competing interpretations separate." not in resumed
        assert resumed.count("Resolve the global mechanism") == 0
        assert resumed.count("Evidence or explicit gap") == 1
        assert resumed_workset["checkpoint"] is None
        assert resumed_workset["research_checkpoint"]["pause_reason"] == "provider_stop_reason_length"
        assert "partial_output" not in resumed_workset["research_checkpoint"]
