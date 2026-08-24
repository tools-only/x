from __future__ import annotations

import json
from pathlib import Path

from .events import append_jsonl, utc_now, write_json
from .phase_reports import validate_methodology
from .resolver import InvalidGraphError
from .store import ObjectStore


META_PROMPT_VERSION = "hos.meta-prompt.v5"
HYPOTHESIS_REFERENCE_PATH = Path(__file__).resolve().parents[2] / "hypothesis.md"


META_SYSTEM_PROMPT = """You are the Meta Harness autoresearch agent. Improve the supplied
Task Harness for the supplied task through bounded, evidence-based experiments.

Goal and authority
==================
Optimize the authoritative task result returned by research_run_observe. Agent claims,
final messages, phase reports, and traces are diagnostics only. When outcomes are equal,
prefer completed repeatable runs, simpler Harnesses, lower cost, and clearer attribution.

Scope and boundaries
====================
Change only a new complete Task Harness Spec: policy, skills, memory/retrieval, loop and
recovery stages, budgets, declared tools/subagents, and task methodology. Keep the task
case, evaluator, score truth, environment rules/actions, Host Protocol, Kernel enforcement,
published objects, completed runs, and undeclared capabilities fixed. Prefer one primary
change per candidate. Never edit runtime artifacts or invent evidence.

Required experiment loop
========================
1. Read research_state and research_knowledge; select the exact baseline and one concrete idea.
2. State claim, mechanism, prediction, falsifier, controls, budget, and keep/discard rule.
3. Publish one complete harness-spec, instantiate it, run the exact task job, and observe it.
4. Validate the full task-agent execution before interpreting the authoritative result.
5. Use research_decision_record to persist one decision: keep, discard, retry, revise,
   or defer. Cite evidence_runs for non-deferred decisions and use evidence from the
   same Harness for promotion.
6. Confirm a promising result under the same comparison conditions before promotion.

Validation and phases
=====================
A valid experiment used the intended Spec/Harness, completed the full task-agent and
environment lifecycle, and produced an evaluable verifier result. Truncation, empty final
output, turn exhaustion, an unclosed episode, provider/environment failure, or missing
verifier output means not_evaluable. Retry transient failures; never keep or discard a
hypothesis from an invalid run. Use only reconnaissance, intervention, verification, and
confirmation phases when they change the next action. Phase reports never set the score.

Stopping and completion
=======================
Continue autonomously while budget and a concrete admissible next experiment remain. Stop
only for objective_resolved, research_limit_reached, no_valid_successor, blocked, or
externally_stopped. Persist every observed decision first. End with a non-empty report of
the baseline, attempted Spec/Harness/run IDs, execution validity, authoritative metrics,
keep/discard/retry/revise/defer decisions, promoted Harness, uncertainty, next action, and
explicit stop reason. A process that merely exits successfully is not task progress.
"""


def meta_prompt_manifest(*, name: str = "meta-research-prompt") -> tuple[dict, dict[str, str]]:
    payload = {"PROMPT.md": META_SYSTEM_PROMPT}
    if HYPOTHESIS_REFERENCE_PATH.is_file():
        payload["HYPOTHESIS.md"] = HYPOTHESIS_REFERENCE_PATH.read_text(encoding="utf-8")
    return (
        {
            "api_version": "hos.meta-prompt.v1",
            "kind": "meta-prompt",
            "name": name,
            "version": META_PROMPT_VERSION,
        },
        payload,
    )


def validate_hypothesis_spec(spec: dict) -> None:
    if spec.get("kind") != "harness-spec":
        raise InvalidGraphError("spec.kind must be 'harness-spec'")
    if spec.get("role") != "task":
        raise InvalidGraphError("meta experiments must publish role='task' specs")
    hypothesis = spec.get("hypothesis")
    method = spec.get("method")
    if not isinstance(hypothesis, dict):
        raise InvalidGraphError("spec.hypothesis must be an object")
    for field in ("claim", "mechanism", "prediction", "falsifier", "metric"):
        if not isinstance(hypothesis.get(field), str) or not hypothesis[field].strip():
            raise InvalidGraphError(f"spec.hypothesis.{field} is required")
    for field in ("phase", "research_question", "exit_criteria", "next_if_pass", "next_if_fail"):
        value = hypothesis.get(field)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise InvalidGraphError(f"spec.hypothesis.{field} must be a non-empty string when provided")
    if not isinstance(method, dict) or not isinstance(method.get("procedure"), list):
        raise InvalidGraphError("spec.method.procedure must be a list")
    if not isinstance(spec.get("validation"), dict):
        raise InvalidGraphError("spec.validation is required")
    base_harness = spec.get("base_harness")
    if base_harness is not None and not isinstance(base_harness, str):
        raise InvalidGraphError("spec.base_harness must be a reference")


class KnowledgeLibrary:
    """File-native, content-addressed methodology and experience library."""

    def __init__(self, store: ObjectStore):
        self.store = store
        self.root = store.root / "knowledge"
        self.root.mkdir(parents=True, exist_ok=True)
        self.experience_index = self.root / "experiences.jsonl"

    def publish_experience(self, experience: dict, *, created_by_run: str) -> str:
        required = ("observation_pattern", "action_rule", "failure_mode", "scope", "confidence")
        for field in required:
            if field not in experience:
                raise InvalidGraphError(f"experience.{field} is required")
        if "methodology" in experience:
            try:
                validate_methodology(experience["methodology"], prefix="experience.methodology")
            except ValueError as exc:
                raise InvalidGraphError(str(exc)) from exc
        manifest = {
            "api_version": "hos.experience.v1",
            "kind": "experience",
            "name": str(experience.get("name", "task-experience")),
            "created_by_run": created_by_run,
            "created_at": utc_now(),
        }
        payload = {"experience.json": json.dumps(experience, ensure_ascii=False, sort_keys=True)}
        digest = self.store.publish(manifest, payload)
        append_jsonl(
            self.experience_index,
            {"digest": digest, "created_by_run": created_by_run, "name": manifest["name"], **experience},
        )
        write_json(self.root / "latest.json", {"digest": digest, "updated_at": utc_now()})
        return digest

    def search(self, query: str = "", *, limit: int = 8) -> list[dict]:
        terms = {term.lower() for term in query.split() if term.strip()}
        if not self.experience_index.is_file():
            return []
        matches: list[dict] = []
        for line in self.experience_index.read_text(encoding="utf-8").splitlines():
            if not line:
                continue
            record = json.loads(line)
            methodology = record.get("methodology")
            haystack = json.dumps(methodology, ensure_ascii=False).lower() if isinstance(methodology, dict) else ""
            if not terms or all(term in haystack for term in terms):
                matches.append(
                    {
                        "digest": record["digest"],
                        "confidence": record.get("confidence"),
                        "methodology": methodology,
                        "methodology_available": isinstance(methodology, dict),
                    }
                )
        return matches[-max(1, limit) :]


def persist_meta_prompt(store: ObjectStore) -> str:
    manifest, payload = meta_prompt_manifest()
    return store.publish(manifest, payload)
