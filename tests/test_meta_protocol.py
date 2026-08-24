import json
from pathlib import Path

import pytest

from hos.cli import main
from hos.meta import META_SYSTEM_PROMPT, KnowledgeLibrary, persist_meta_prompt, validate_hypothesis_spec
from hos.research import ResearchControlPlane
from hos.resolver import InvalidGraphError, resolve_harness
from hos.specs import instantiate_harness_spec, publish_harness_spec
from hos.store import ObjectStore
from hos.supervisor import Supervisor

from helpers import publish_agent, publish_harness


def structured_spec() -> dict:
    return {
        "kind": "harness-spec",
        "name": "probe-test",
        "role": "task",
        "hypothesis": {
            "claim": "A deliberate probe improves completion.",
            "mechanism": "The agent observes state transitions before committing.",
            "prediction": "The same case gets a higher authoritative score.",
            "falsifier": "The score is unchanged or lower after confirmation.",
            "metric": "authoritative score",
        },
        "method": {
            "intervention": "Add a probe rule to the strategy skill.",
            "procedure": ["instantiate", "run", "observe"],
        },
        "agent": {
            "name": "solver",
            "driver": "echo",
            "loop": {"name": "bounded-loop", "config": {"max_steps": 4}},
            "policy": {"name": "probe-policy", "content": "probe first"},
            "skills": [{"name": "strategy", "content": "probe first"}],
            "tools": [{"name": "trace", "config": {"write": True}}],
            "memory": {"name": "episode-memory", "files": {"README.md": "persist"}},
        },
        "environment": {"name": "arc3-local", "adapter": "arc3-local"},
        "evaluator": "score",
        "ruleset": "budget",
        "validation": {"same_case": True},
    }


def test_meta_prompt_is_a_persisted_component_and_lockable(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    prompt = persist_meta_prompt(store)
    assert store.read(prompt)["manifest"]["kind"] == "meta-prompt"
    assert (store.read(prompt)["payload_dir"] / "PROMPT.md").is_file()
    reference = store.read(prompt)["payload_dir"] / "HYPOTHESIS.md"
    assert reference.is_file()
    contract = reference.read_text(encoding="utf-8")
    assert "What Must Stay Fixed" in contract
    assert "Valid Execution" in contract
    assert "Decision Rules" in contract
    assert "Stopping Rules" in contract


def test_meta_prompt_is_compact_and_preserves_closed_loop_contract() -> None:
    assert len(META_SYSTEM_PROMPT) < 6000
    for required in (
        "Goal and authority",
        "Scope and boundaries",
        "Required experiment loop",
        "Validation and phases",
        "Stopping and completion",
        "research_run_observe",
        "research_decision_record",
        "authoritative",
        "keep, discard, retry, revise",
        "or defer",
        "not_evaluable",
        "stop reason",
    ):
        assert required in META_SYSTEM_PROMPT


def test_structured_spec_preserves_source_and_component_map(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    spec = publish_harness_spec(store, structured_spec(), created_by_run="meta-1")
    harness = instantiate_harness_spec(store, spec, created_by_run="meta-1")

    manifest = store.read(harness)["manifest"]
    assert manifest["spec"] == spec
    assert manifest["compiler"] == {"name": "hos.spec-compiler", "version": "v1"}
    assert manifest["component_map"]["agent.skills.strategy"]
    assert manifest["component_map"]["agent.tools.0"]
    lock = resolve_harness(store, harness)
    assert lock["resolved_objects"]["spec"] == spec
    assert lock["objects"]["root_agent.loop"]["name"] == "bounded-loop"
    assert lock["objects"]["root_agent.memory"]["name"] == "episode-memory"


def test_structured_hypothesis_requires_falsifier(tmp_path: Path) -> None:
    spec = structured_spec()
    del spec["hypothesis"]["falsifier"]
    with pytest.raises(InvalidGraphError, match="falsifier"):
        validate_hypothesis_spec(spec)


def test_optional_phase_fields_must_be_non_empty_strings() -> None:
    spec = structured_spec()
    spec["hypothesis"]["phase"] = ""
    with pytest.raises(InvalidGraphError, match="phase"):
        validate_hypothesis_spec(spec)


def test_observe_run_returns_recent_task_phase_reports(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    store = ObjectStore(root)
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    run_dir = root / "runs" / "harness-task"
    run_dir.mkdir(parents=True)
    (run_dir / "status.json").write_text(json.dumps({"state": "succeeded"}), encoding="utf-8")
    (run_dir / "result.json").write_text(json.dumps({"score": 0.0}), encoding="utf-8")
    (run_dir / "metrics.json").write_text(json.dumps({"score": 0.0}), encoding="utf-8")
    (run_dir / "usage.json").write_text(json.dumps({"agent_runs": 1}), encoding="utf-8")
    report_dir = run_dir / "agent" / "harbor-jobs"
    report_dir.mkdir(parents=True)
    raw_report = {
        "phase": "reconnaissance",
        "status": "blocked",
        "confidence": 0.8,
        "observations": ["task-private observation"],
        "actions": ["task-private command"],
        "failures": ["task-private failure"],
        "evidence": ["task-private path"],
        "current_state": "task-private current state",
        "recommended_next": "task-private recommendation",
        "methodology": {
            "exploration_strategy": "inspect",
            "information_states": ["dependency"],
            "outcome_signals": ["command_failed"],
            "failure_classes": ["dependency"],
            "next_strategy": "recover",
        },
    }
    (report_dir / "phase-reports.jsonl").write_text(
        json.dumps(raw_report) + "\n",
        encoding="utf-8",
    )

    observed = ResearchControlPlane(store, parent_run=meta_run["run_id"]).observe_run("harness-task")

    assert observed["methodology_reports"] == [{
        "phase": "reconnaissance",
        "status": "blocked",
        "confidence": 0.8,
        "methodology": raw_report["methodology"],
        "observation_count": 1,
        "action_count": 1,
        "failure_count": 1,
        "evidence_count": 1,
        "methodology_available": True,
    }]
    assert "result" not in observed
    assert "task-private" not in json.dumps(observed)


def test_experience_is_searchable_after_file_reload(tmp_path: Path) -> None:
    root = tmp_path / ".hos"
    store = ObjectStore(root)
    library = KnowledgeLibrary(store)
    digest = library.publish_experience(
        {
            "name": "probe-before-commit",
            "observation_pattern": "state changes after a legal probe",
            "action_rule": "observe before committing",
            "failure_mode": "repeating the first action",
            "scope": "transition-based tasks",
            "confidence": 0.63,
            "evidence": ["episode-1"],
            "methodology": {
                "exploration_strategy": "probe",
                "information_states": ["state"],
                "outcome_signals": ["partial_progress"],
                "failure_classes": ["unknown"],
                "next_strategy": "verify",
            },
        },
        created_by_run="agent-1",
    )

    reloaded = KnowledgeLibrary(ObjectStore(root))
    records = reloaded.search("probe state")
    assert records[-1]["digest"] == digest
    assert records[-1]["methodology"]["exploration_strategy"] == "probe"
    assert "observation_pattern" not in records[-1]
    assert json.loads((root / "knowledge" / "experiences.jsonl").read_text(encoding="utf-8"))


def test_meta_research_artifacts_link_spec_instance_and_harbor_verifier(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    supervisor = Supervisor(store)
    meta_run = supervisor.start_harness(meta_harness, {})
    spec = publish_harness_spec(store, structured_spec(), created_by_run="agent-meta")
    harness = instantiate_harness_spec(store, spec, created_by_run="agent-meta")

    control = ResearchControlPlane(
        store,
        parent_run=meta_run["run_id"],
        run_harness=lambda harness_ref, job, parent_run: {
            "run_id": "harness-terminal",
            "status": "succeeded",
            "result": {
                "terminal_bench": {
                    "score": 1.0,
                    "harbor_result": {"verifier_result": {"rewards": {"reward": 1.0}}},
                }
            },
        },
    )
    control.publish_spec(structured_spec(), agent_run="agent-meta")
    control.instantiate_runtime(spec, agent_run="agent-meta")
    control.run_runtime(
        harness,
        {},
    )
    decision = control.record_decision(
        spec,
        {
            "status": "revised",
            "rationale": "The verifier passed but the comparison evidence is incomplete.",
            "evidence_runs": ["harness-terminal"],
        },
        agent_run="agent-meta",
    )

    research_dir = store.root / "research" / meta_run["run_id"]
    spec_snapshot = json.loads((research_dir / "specs" / f"{spec.removeprefix('sha256:')}.json").read_text(encoding="utf-8"))
    instance_dir = research_dir / "instances" / harness.removeprefix("sha256:")
    verifier = json.loads((instance_dir / "runs" / "harness-terminal" / "harbor-verifier.json").read_text(encoding="utf-8"))

    assert spec_snapshot["manifest"]["name"] == "probe-test"
    assert json.loads((instance_dir / "harness.json").read_text(encoding="utf-8"))["spec"] == spec
    assert verifier["authoritative_score"] == 1.0
    assert verifier["verifier_result"]["rewards"]["reward"] == 1.0
    assert (research_dir / "decisions" / f"{decision['decision']}.json").is_file()


def test_research_cli_publishes_a_spec_into_the_meta_run_ledger(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    spec_path = tmp_path / "spec.json"
    spec_path.write_text(json.dumps(structured_spec()), encoding="utf-8")

    status = main(
        [
            "research",
            "spec",
            "--root",
            str(store.root),
            "--parent-run",
            meta_run["run_id"],
            "--agent-run",
            "agent-meta",
            "--input",
            str(spec_path),
        ]
    )

    assert status == 0
    assert (store.root / "research" / meta_run["run_id"] / "specs").is_dir()


def test_evolution_state_records_evidence_and_promotes_confirmed_harness(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    spec = publish_harness_spec(store, structured_spec(), created_by_run="agent-meta")
    harness = instantiate_harness_spec(store, spec, created_by_run="agent-meta")

    control = ResearchControlPlane(
        store,
        parent_run=meta_run["run_id"],
        run_harness=lambda harness_ref, job, parent_run: {
            "run_id": "harness-confirmed",
            "status": "succeeded",
            "result": {"score": 1.0},
        },
    )
    control.run_runtime(harness, {})
    store.set_ref("harness/task/candidate", harness)
    decision = control.record_decision(
        spec,
        {
            "status": "confirmed",
            "rationale": "The runtime completed with the declared evidence.",
            "evidence_runs": ["harness-confirmed"],
            "promote_harness": "ref:harness/task/candidate",
        },
        agent_run="agent-meta",
    )

    state = control.read_evolution()
    assert state["current"]["harness"] == harness
    assert state["rounds"][-1]["evidence_runs"] == ["harness-confirmed"]
    assert state["rounds"][-1]["evidence"] == [
        {"run_id": "harness-confirmed", "harness": harness}
    ]
    assert state["rounds"][-1]["promoted_harness"] == harness
    assert state["rounds"][-1]["assessment"]["promote_harness"] == harness
    assert decision["promoted_harness"] == harness
    assert store.resolve_ref("ref:harness/task/current") == harness


def test_non_deferred_decision_requires_evidence(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    spec = publish_harness_spec(store, structured_spec(), created_by_run="agent-meta")
    control = ResearchControlPlane(store, parent_run=meta_run["run_id"])

    with pytest.raises(ValueError, match="evidence_runs"):
        control.record_decision(
            spec,
            {"status": "confirmed", "rationale": "Missing evidence."},
            agent_run="agent-meta",
        )


def test_failed_run_is_persisted_as_decision_evidence(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    spec = publish_harness_spec(store, structured_spec(), created_by_run="agent-meta")
    control = ResearchControlPlane(
        store,
        parent_run=meta_run["run_id"],
        run_harness=lambda harness_ref, job, parent_run: {
            "run_id": "harness-failed",
            "status": "failed",
            "result": {"error": {"message": "agent exhausted max turns"}},
            "authoritative_metrics": {"score": 0.0, "episode_runs": 1},
        },
    )
    harness = instantiate_harness_spec(store, spec, created_by_run="agent-meta")
    control.run_runtime(harness, {})

    decision = control.record_decision(
        spec,
        {
            "status": "revised",
            "rationale": "The run is incomplete evidence and does not validate the hypothesis.",
            "evidence_runs": ["harness-failed"],
        },
        agent_run="agent-meta",
    )

    research_dir = store.root / "research" / meta_run["run_id"]
    saved = json.loads((research_dir / "decisions" / f"{decision['decision']}.json").read_text(encoding="utf-8"))
    assert saved["assessment"]["evidence_runs"] == ["harness-failed"]
    assert saved["round"]["evidence"][0]["run_id"] == "harness-failed"


def test_promotion_requires_evidence_from_the_same_harness(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    spec = publish_harness_spec(store, structured_spec(), created_by_run="agent-meta")
    tested_harness = instantiate_harness_spec(store, spec, created_by_run="candidate-a")
    untested_harness = instantiate_harness_spec(store, spec, created_by_run="candidate-b")
    control = ResearchControlPlane(
        store,
        parent_run=meta_run["run_id"],
        run_harness=lambda harness_ref, job, parent_run: {
            "run_id": "harness-tested",
            "status": "succeeded",
            "result": {"score": 1.0},
        },
    )
    control.run_runtime(tested_harness, {})

    with pytest.raises(ValueError, match="evidence_runs from that harness"):
        control.record_decision(
            spec,
            {
                "status": "confirmed",
                "rationale": "Cannot promote a harness that was not evaluated.",
                "evidence_runs": ["harness-tested"],
                "promote_harness": untested_harness,
            },
            agent_run="agent-meta",
        )


def test_research_runtime_passes_the_spec_budget_to_kernel(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    meta_harness = publish_harness(store, publish_agent(store, "meta", "echo"), role="meta")
    meta_run = Supervisor(store).start_harness(meta_harness, {})
    spec_data = structured_spec()
    spec_data["method"]["budget"] = {"max_agent_runs": 2, "max_episodes": 1}
    spec = publish_harness_spec(store, spec_data, created_by_run="agent-meta")
    harness = instantiate_harness_spec(store, spec, created_by_run="agent-meta")
    received: dict = {}

    def run_harness(harness_ref: str, job: dict, parent_run: str, budget: dict | None) -> dict:
        received.update({"harness": harness_ref, "job": job, "parent_run": parent_run, "budget": budget})
        return {"run_id": "harness-budgeted", "status": "succeeded", "result": {}}

    control = ResearchControlPlane(store, parent_run=meta_run["run_id"], run_harness=run_harness)
    control.run_runtime(harness, {"kind": "task"})

    assert received["harness"] == harness
    assert received["parent_run"] == meta_run["run_id"]
    assert received["budget"] == {"max_agent_runs": 2, "max_episodes": 1}
