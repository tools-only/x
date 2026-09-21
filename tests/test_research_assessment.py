import json
import os
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli


def run_output(expression, value):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_auto_research_output.ts"
    env = os.environ.copy()
    env["ASSESSMENT_INPUT"] = json.dumps(value)
    script = (
        f'import * as output from {json.dumps(helper.as_uri())};'
        f"console.log(JSON.stringify({expression}));"
    )
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True, text=True, env=env,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_report_preserves_scoped_explanation_assessment():
    report = {
        "status": "provisional",
        "conclusion": "The panel transition is conditionally predictive.",
        "findings": [{
            "subject_kind": "mechanism",
            "question": "Why did the exit change from failure to success?",
            "conclusion": "The two visible panels may need to match.",
            "evidence_refs": ["observation:success@v1"],
            "uncertainty": "A key-collection explanation remains possible.",
            "assessment": {
                "target_ref": "candidate:run-1/panel-match",
                "dimension": "explanation",
                "verdict": "inconclusive",
                "scope": "Observed exit transition in level 1",
                "evidence_kind": "historical_observation",
            },
        }],
        "evidence_refs": ["observation:success@v1"],
        "alternatives": ["key collection"],
        "limitations": [],
        "validation_plan": "Compare the failed and successful panel states.",
        "harness_proposals": [],
    }
    normalized = run_output(
        "output.normalizeAutoResearchReport(JSON.parse(process.env.ASSESSMENT_INPUT))",
        report,
    )
    assert normalized["findings"][0]["assessment"]["dimension"] == "explanation"
    assert normalized["findings"][0]["assessment"]["scope"] == "Observed exit transition in level 1"


def test_method_utility_assessment_requires_effect_reference():
    report = {
        "status": "supported_within_scope",
        "conclusion": "The helper was useful.",
        "findings": [{
            "subject_kind": "method",
            "question": "Did the helper improve decisions?",
            "conclusion": "It reduced repeated inspection.",
            "evidence_refs": ["effect-assessment:1"],
            "uncertainty": "Only one later use was observed.",
            "assessment": {
                "target_ref": "tool:panel-check@v1",
                "dimension": "method_utility",
                "verdict": "supported",
                "scope": "One later level",
                "evidence_kind": "historical_observation",
                "effect_assessment_ref": "effect-assessment:1",
            },
        }],
        "evidence_refs": ["effect-assessment:1"],
        "alternatives": [], "limitations": [], "validation_plan": "Repeat on a held-out level.",
        "harness_proposals": [],
    }
    result = run_output(
        "(()=>{const r=output.normalizeAutoResearchReport(JSON.parse(process.env.ASSESSMENT_INPUT));return r.findings[0].assessment})()",
        report,
    )
    assert result["effect_assessment_ref"] == "effect-assessment:1"


def test_report_preserves_research_only_planning_outputs_without_harness_proposal():
    report = {
        "status": "provisional",
        "conclusion": "Switch exploration policy after the marker reaches the phase boundary.",
        "findings": [],
        "evidence_refs": ["observation:phase-boundary@v1"],
        "alternatives": ["continue the current sweep"],
        "limitations": ["only one boundary state was observed"],
        "validation_plan": "Compare the two policies at the same reachable phase.",
        "planning_implications": [{
            "decision_context": "marker at the phase boundary",
            "implication": "stop the sweep and test the alternate module",
            "applicability": "current level before terminal boundary",
            "evidence_refs": ["observation:phase-boundary@v1"],
            "reconsider_when": "the alternate module is inert or terminal",
        }],
        "next_research_question": "Does the alternate module activate only at this phase boundary?",
        "harness_proposals": [],
    }
    normalized = run_output(
        "output.normalizeAutoResearchReport(JSON.parse(process.env.ASSESSMENT_INPUT))",
        report,
    )
    assert normalized["planning_implications"][0]["implication"] == "stop the sweep and test the alternate module"
    assert normalized["next_research_question"].startswith("Does the alternate module")
    assert normalized["harness_proposals"] == []
