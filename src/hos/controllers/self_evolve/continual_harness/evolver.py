from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ....provider import assistant_message, create_provider_client
from ....config import load_config
from .stores import EvolutionStores
from .compatibility import ContinualHarnessCompatibility
from .prompts import EVOLUTION_SYSTEM, EVOLUTION_USER, SKILL_EVOLUTION, SUBAGENT_EVOLUTION, MEMORY_EVOLUTION


class HarnessEvolver:
    """Task-agnostic four-pass Continual Harness evolution."""

    def __init__(self, stores: EvolutionStores, *, provider: str = "task", compatibility: ContinualHarnessCompatibility | None = None):
        self.stores = stores
        self.compatibility = compatibility or ContinualHarnessCompatibility()
        config = load_config()
        self.provider = config.resolve_provider(provider, require_secret=True)
        self.client = create_provider_client(self.provider)

    def evolve(self, *, trigger: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        before = self.stores.snapshot()
        working = dict(before)
        results = {}
        for component in self.compatibility.evolution_order:
            accepted, value = self._evolve_component(component, working, evidence, trigger)
            results[component] = accepted
            if accepted:
                working[component] = value
                getattr(self.stores, component).write(value)
        if self.compatibility.commit_mode == "generation-atomic" and not all(results.values()):
            for component, value in before.items():
                getattr(self.stores, component).write(value)
            working = before
        generation = {
            "generation": len(self.stores.generations.read()) + 1,
            "trigger": trigger,
            "accepted": results,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        generations = self.stores.generations.read()
        generations.append(generation)
        self.stores.generations.write(generations)
        return generation

    def _evolve_component(self, component: str, snapshot: dict, evidence: list[dict], trigger: str) -> tuple[bool, Any]:
        trajectory = json.dumps(evidence[-20:], ensure_ascii=False, indent=2)
        if component == "prompt":
            user = EVOLUTION_USER
            replacements = {
                "__CURRENT__": str(snapshot["prompt"].get("content", "")),
                "__TRAJECTORY__": trajectory,
                "__TRIGGER__": trigger,
                "__MEMORY__": json.dumps(snapshot["memory"], ensure_ascii=False),
                "__SKILLS__": json.dumps(snapshot["skills"], ensure_ascii=False),
                "__SUBAGENTS__": json.dumps(snapshot["subagents"], ensure_ascii=False),
            }
            for key, value in replacements.items():
                user = user.replace(key, value)
            response = self.client.chat(
                [{"role": "system", "content": EVOLUTION_SYSTEM}, {"role": "user", "content": user}],
                max_tokens=8192,
            )
            content = str(assistant_message(response).get("content") or "")
            marker = "IMPROVED BASE PROMPT:"
            value = content.split(marker, 1)[-1].strip() if marker in content else content.strip()
            return (200 <= len(value) <= 12000), {"content": value}
        template = {"skills": SKILL_EVOLUTION, "subagents": SUBAGENT_EVOLUTION, "memory": MEMORY_EVOLUTION}[component]
        prompt = template.replace("__CURRENT__", json.dumps(snapshot[component], ensure_ascii=False, indent=2)).replace("__TRAJECTORY__", trajectory).replace("__TRIGGER__", trigger)
        response = self.client.chat([{"role": "user", "content": prompt}], max_tokens=8192)
        content = str(assistant_message(response).get("content") or "{}")
        try:
            proposal = json.loads(content)
        except json.JSONDecodeError:
            return False, snapshot[component]
        if not all(isinstance(proposal.get(key, []), list) for key in ("add", "edit", "delete")):
            return False, snapshot[component]
        return True, self._apply_operations(component, snapshot[component], proposal)

    @staticmethod
    def _apply_operations(component: str, current: list[dict], proposal: dict) -> list[dict]:
        values = [dict(item) for item in current if isinstance(item, dict)]
        identity = "title" if component == "memory" else "name"
        for target in proposal.get("delete", []):
            values = [item for item in values if target not in {item.get("id"), item.get(identity)}]
        for edit in proposal.get("edit", []):
            if not isinstance(edit, dict):
                continue
            target = edit.get("id")
            for index, item in enumerate(values):
                if target in {item.get("id"), item.get(identity)}:
                    values[index] = {**item, **{key: value for key, value in edit.items() if key != "id"}}
                    break
        for addition in proposal.get("add", []):
            if isinstance(addition, dict):
                candidate = dict(addition)
                candidate.setdefault("id", f"{component[:-1]}_{len(values) + 1:03d}")
                values.append(candidate)
        return values
