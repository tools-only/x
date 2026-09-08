"""Deterministic, task-local demo of the proposed meta-harness architecture.

The decision fixture stands in for a task agent so the smoke is repeatable.
The runner records and executes those decisions; it is not a production
Auto-Research controller or a claim that a scripted fixture is autonomous.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass
from html import escape
from pathlib import Path
from typing import Callable, Iterable, Sequence
from zipfile import ZIP_DEFLATED, ZipFile

from .pi_kernel import PiKernel


@dataclass(frozen=True)
class AgentDecision:
    task_turn: int
    research_id: str
    parent_id: str | None
    depth: int
    iteration: int
    decision: str
    observation: str
    basis_resource_ids: tuple[str, ...]
    effect: str


@dataclass(frozen=True)
class NativeEvidence:
    pi_version: str
    before: dict[str, object]
    after: dict[str, object]
    observed: dict[str, object]


@dataclass(frozen=True)
class DemoResult:
    root: Path
    artifact: Path
    score: float
    auto_research_handoff: Path
    self_harness_handoff: Path
    round_hierarchy: Path
    summary: Path


DEMO_DECISIONS: tuple[AgentDecision, ...] = (
    AgentDecision(
        1, "R0", None, 0, 1, "iterate",
        "Two source summaries conflict and neither carries an observation date.",
        ("task.brief", "source.a.summary", "source.b.summary"),
        "Repeat the same research question with date-bearing evidence.",
    ),
    AgentDecision(
        2, "R0", None, 0, 2, "nest",
        "The conflict may be temporal; the date mismatch is a bounded prerequisite.",
        ("source.a.raw", "source.b.raw"),
        "Open child R0.1 to establish the collection dates.",
    ),
    AgentDecision(
        3, "R0.1", "R0", 1, 1, "return",
        "Source A is dated 2026-08-31 and Source B is dated 2026-09-05.",
        ("source.a.date", "source.b.date"),
        "Return the temporal explanation and an evidence-handling recommendation to R0.",
    ),
    AgentDecision(
        4, "R0", None, 0, 3, "prune",
        "A proposed style-comparison branch cannot change the report finding.",
        ("R0.1.handoff", "task.acceptance"),
        "Prune R0.2 and spend no task budget on it.",
    ),
    AgentDecision(
        5, "R0", None, 0, 4, "adapt_harness",
        "Later report work must preserve source and date, and Pi exposes a task-local primitive.",
        ("R0.1.handoff", "capability.set_evidence_policy"),
        "Use the Pi-native evidence_policy primitive with source_and_date.",
    ),
    AgentDecision(
        6, "R0", None, 0, 5, "terminate",
        "The report contains the reconciled finding, both dated sources, and the recommendation.",
        ("artifact.officebench_case", "pi.observed.evidence_policy", "task.acceptance"),
        "End the task because the task agent judges the acceptance conditions sufficient.",
    ),
)


def _json_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _xml_paragraph(text: str, *, bold: bool = False) -> str:
    run_properties = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:p><w:r>{run_properties}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def write_officebench_docx(path: Path) -> None:
    """Create a small, valid DOCX artifact using only the standard library."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(
        (
            _xml_paragraph("Quarterly Evidence Review", bold=True),
            _xml_paragraph("Finding: the apparent conflict is explained by different collection dates."),
            _xml_paragraph("Source A — observed 2026-08-31"),
            _xml_paragraph("Source B — observed 2026-09-05"),
            _xml_paragraph("Recommendation: retain source and observation date when evidence is reused."),
        )
    )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}<w:sectPr/></w:body></w:document>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        "</Relationships>"
    )
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document_xml)


def evaluate_officebench_smoke(path: Path) -> tuple[float, dict[str, bool]]:
    """Evaluate the small local OfficeBench-style document contract."""
    with ZipFile(path) as archive:
        document = archive.read("word/document.xml").decode("utf-8")
    checks = {
        "valid_docx": True,
        "finding_present": "different collection dates" in document,
        "source_a_dated": "Source A — observed 2026-08-31" in document,
        "source_b_dated": "Source B — observed 2026-09-05" in document,
        "recommendation_present": "retain source and observation date" in document,
    }
    return sum(checks.values()) / len(checks), checks


def _resolve_pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Pi-native smoke unsupported: node executable was not found")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        raise RuntimeError(f"Pi-native smoke unsupported: installed Pi CLI was not found at {cli}")
    return node, str(cli)


def run_pi_native_probe(root: Path, extension: Path) -> NativeEvidence:
    """Exercise one official Pi extension instance without a remote model."""
    node, cli = _resolve_pi_cli()
    env = {
        "META_HARNESS_DEMO_ROOT": str(root),
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFLINE": "1",
    }
    command = (
        node,
        cli,
        "--mode", "rpc",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--offline",
        "--extension", str(extension),
    )
    with PiKernel(command, cwd=str(root), env=env, timeout=30.0) as kernel:
        for action in ("before", "mutate", "observe"):
            response = kernel.prompt(f"/meta-harness-demo {action}")
            if response.get("success") is False:
                raise RuntimeError(f"Pi command failed for {action}: {response}")

    native_root = root / "pi-native"
    snapshots = [json.loads((native_root / f"{name}.json").read_text(encoding="utf-8")) for name in ("before", "after", "observed")]
    version_result = subprocess.run(
        (node, cli, "--version"),
        cwd=str(root),
        env={**os.environ, **env},
        text=True,
        capture_output=True,
        check=False,
    )
    return NativeEvidence(version_result.stdout.strip() or "unknown", *snapshots)


def _render_auto_research_handoff(decisions: Sequence[AgentDecision]) -> str:
    rows = "\n".join(
        f"| {d.task_turn} | {d.research_id} | {d.iteration} | {d.decision} | {d.observation} |"
        for d in decisions
        if d.decision in {"iterate", "nest", "return", "prune", "terminate"}
    )
    return f"""# Auto-Research Handoff

This is a task-local resource. It records the research structure produced by the demo task-agent fixture; it does not modify the general Auto-Research method.

| Task turn | Research node | Local iteration | Agent decision | Result used by later work |
|---:|---|---:|---|---|
{rows}

## Returned result

- `R0.1` explained the source conflict as a difference in observation dates.
- The result returned to `R0`, where the agent pruned an irrelevant style branch.
- The root research ended after the task artifact satisfied the local acceptance checks.
"""


def _render_self_harness_handoff(native: NativeEvidence) -> str:
    return f"""# Self-Harness Handoff

This handoff is task-local and does not enter the baseline of another independent task.

- Pi version: `{native.pi_version}`
- Logical primitive: `evidence_policy`
- Pi-native realization: `pi.registerTool()` plus `before_agent_start`
- Scope demonstrated: one Pi extension process
- Before: `{native.before['value']}`
- Mutated to: `{native.after['value']}`
- Later Pi extension execution observed: `{native.observed['value']}`
- Research basis: `R0.1.handoff`
- Task effect: the OfficeBench-style artifact retains both source names and dates.

The model-free command is a deterministic smoke driver for the same extension state. It proves official Pi loaded the extension and retained the mutation in the same process. It does not prove that a live model autonomously selected the tool or that the policy improved general performance.
"""


def _render_round_hierarchy(decisions: Sequence[AgentDecision]) -> str:
    rows = "\n".join(
        f"| {d.task_turn} | {d.research_id} | {d.parent_id or '—'} | {d.depth} | {d.iteration} | {d.decision} | {', '.join(d.basis_resource_ids)} |"
        for d in decisions
    )
    return f"""# Round Hierarchy Analysis

The task turn, research node, local research iteration, Pi prompt, and model/tool step are different levels. This demo records six task-agent decisions; the Pi-native probe separately issues three model-free slash commands in one Pi process.

| Task turn | Research node | Parent | Depth | Local iteration | Agent decision | Decision basis |
|---:|---|---|---:|---:|---|---|
{rows}

## Why the relations matter

- **Iteration:** `R0` keeps the same question but obtains date-bearing evidence on its second attempt.
- **Nesting:** `R0.1` isolates a bounded prerequisite without redefining the root task.
- **Return:** the child contributes a resource to `R0`; it does not dictate the parent's next action.
- **Pruning:** `R0` declines `R0.2` after judging that it cannot affect the accepted output.
- **Harness adaptation:** a task need plus a returned research result motivates one atomic, task-local capability change.
- **Termination:** the task agent fixture ends the root only after the artifact and later Pi observation exist.

## Pi execution rounds used by the smoke

| Pi execution | Transport request | Model agent turn | Purpose | Result |
|---:|---|---|---|---|
| E1 | `prompt /meta-harness-demo before` | none; extension command bypasses the model | Read the extension-process baseline | `summary_only` |
| E2 | `prompt /meta-harness-demo mutate` | none; extension command bypasses the model | Drive the same state mutation as the registered tool handler | `source_and_date` |
| E3 | `prompt /meta-harness-demo observe` | none; extension command bypasses the model | Make a later Pi extension execution read the state | `source_and_date` |

Task turn 5 is the logical decision to adapt the harness. E1–E3 are integration-probe executions that verify its Pi-native realization; they are not three Auto-Research iterations. A live model run could contain one or more model/tool steps around the same logical decision.

The runtime records these decisions and requires each one to cite basis resources. It does not contain rules that force iteration, nesting, pruning, or termination. A live task agent may choose a different shape for another task.
"""


def run_demo(
    root: Path,
    *,
    decisions: Iterable[AgentDecision] = DEMO_DECISIONS,
    native_probe: Callable[[Path, Path], NativeEvidence] = run_pi_native_probe,
) -> DemoResult:
    """Run the deterministic architecture demo and emit inspectable artifacts."""
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    decision_list = tuple(decisions)
    if not decision_list or any(d.basis_resource_ids == () for d in decision_list):
        raise ValueError("each task-agent decision must cite at least one resource")
    if any(d.task_turn != index for index, d in enumerate(decision_list, start=1)):
        raise ValueError("task turns must be contiguous in the demo trace")

    extension = Path(__file__).resolve().parents[2] / "demo" / "pi_native_harness_extension.ts"
    native = native_probe(root, extension)
    if native.before.get("value") != "summary_only":
        raise RuntimeError("Pi-native before snapshot did not match the baseline")
    if native.after.get("value") != "source_and_date" or native.observed.get("value") != "source_and_date":
        raise RuntimeError("later Pi extension execution did not observe the mutation")

    artifact = root / "artifact" / "officebench_case.docx"
    write_officebench_docx(artifact)
    score, checks = evaluate_officebench_smoke(artifact)

    trace = root / "task-agent-decisions.json"
    _json_write(trace, [asdict(item) for item in decision_list])
    auto_handoff = root / "auto-research-handoff.md"
    auto_handoff.write_text(_render_auto_research_handoff(decision_list), encoding="utf-8")
    harness_handoff = root / "self-harness-handoff.md"
    harness_handoff.write_text(_render_self_harness_handoff(native), encoding="utf-8")
    hierarchy = root / "round-hierarchy.md"
    hierarchy.write_text(_render_round_hierarchy(decision_list), encoding="utf-8")
    summary = root / "summary.json"
    _json_write(summary, {
        "status": "passed" if score == 1.0 else "failed",
        "score": score,
        "checks": checks,
        "artifact": str(artifact),
        "pi_version": native.pi_version,
        "pi_native_mutation": {
            "before": native.before.get("value"),
            "after": native.after.get("value"),
            "observed": native.observed.get("value"),
        },
        "task_agent_decisions": len(decision_list),
        "research_nodes": sorted({d.research_id for d in decision_list}),
        "handoffs": [str(auto_handoff), str(harness_handoff)],
        "round_hierarchy": str(hierarchy),
        "limitations": [
            "The task-agent decision source is deterministic, not a live model.",
            "The local document checks are OfficeBench-style smoke checks, not the full external OfficeBench evaluator.",
        ],
    })
    return DemoResult(root, artifact, score, auto_handoff, harness_handoff, hierarchy, summary)
