"""ARC-AGI-3 agent-facing contract.

This module is deliberately benchmark-specific.  It mirrors the small set of
presentation and action-budget rules used by ARC's ``BenchmarkingAgent`` while
leaving transport, scorecards, and the shared Auto-Research extension outside
of the adapter.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping


OFFICIAL_ARC_SYSTEM_PROMPT = (
    "You are playing a game. Your goal is to win. Include any context you want "
    "to carry forward in your reply, along with the action you want to take. "
    "The final action mentioned in your reply will be executed next turn."
)

DEFAULT_MAX_ANIMATION_FRAMES = 7
DEFAULT_ACTION_BUDGET_MULTIPLIER = 5.0
OFFICIAL_CONTEXT_WINDOW = 175_000
# Mirrors ARC-AGI-3 benchmarking.Agent.MAX_RUNTIME_SECONDS.  The e2e
# runner uses this only as Pi's per-operation wait ceiling; it does not add a
# second session deadline or a project-specific shorter timeout.
OFFICIAL_MAX_RUNTIME_SECONDS = 12 * 60 * 60


def resolve_model_settings(environment: Mapping[str, str]) -> dict[str, Any]:
    """Resolve ARC's model settings without reading the external checkout.

    The endpoint/key may be scoped with ``ARC_OPENAI_*`` for a fair ARC run;
    generic project variables remain a backwards-compatible fallback.  The
    default Pi API is OpenAI Responses, matching ARC's official config; set
    ``ARC_PI_API=openai-completions`` only for a gateway that lacks Responses.
    """
    # This is provider capability/configuration, not a research output quota.
    # Do not guess the gateway's ceiling from its model name.
    declared_output = environment.get("ARC_MODEL_MAX_OUTPUT_TOKENS")
    max_output = int(declared_output) if declared_output else None
    if max_output is not None and max_output <= 0:
        raise ValueError("ARC_MODEL_MAX_OUTPUT_TOKENS must be a positive provider-supported value")
    settings = {
        "base_url": environment.get("ARC_OPENAI_API_BASE") or environment.get("OPENAI_API_BASE"),
        "api_key": environment.get("ARC_OPENAI_API_KEY") or environment.get("OPENAI_API_KEY"),
        "model": environment.get("ARC_MODEL") or environment.get("EXEC_MODEL") or "gpt-5.6-sol",
        "context_window": OFFICIAL_CONTEXT_WINDOW,
        "official_runtime": "openai-python/responses",
        "pi_api": environment.get("ARC_PI_API") or "openai-responses",
    }
    if max_output is not None:
        settings["max_tokens"] = max_output
    return settings


@dataclass
class ArcAgi3Adapter:
    """Render native ARC frames using the official agent-facing convention."""

    max_animation_frames: int = DEFAULT_MAX_ANIMATION_FRAMES
    action_budget_multiplier: float = DEFAULT_ACTION_BUDGET_MULTIPLIER
    action_counter: int = 0
    previous_action: str | None = None
    level_just_advanced: bool = False
    last_levels_completed: int = 0

    def interpolate_frames(self, frame_grids: list[list[list[int]]]) -> list[list[list[int]]]:
        target = self.max_animation_frames
        if target < 1:
            raise ValueError("max_animation_frames must be at least 1")
        if len(frame_grids) <= target:
            return frame_grids
        if target == 1:
            return [frame_grids[-1]]
        indices = [round(i * (len(frame_grids) - 1) / (target - 1)) for i in range(target)]
        return [frame_grids[i] for i in indices]

    def available_action_names(
        self,
        native_actions: Iterable[str],
        *,
        reset_name: str = "RESET",
    ) -> list[str]:
        """Apply ARC's reset visibility rule to the SDK advertised actions."""
        actions = list(native_actions)
        if reset_name not in actions and self.action_counter > 0 and self.previous_action != reset_name:
            actions.insert(0, reset_name)
        if self.action_counter == 0 or self.previous_action == reset_name:
            actions = [action for action in actions if action != reset_name]
        return actions

    @staticmethod
    def available_actions_text(
        actions: Iterable[str],
        *,
        complex_actions: Mapping[str, bool] | None = None,
    ) -> str:
        complex_actions = complex_actions or {}
        lines: list[str] = []
        for name in actions:
            if complex_actions.get(name, False):
                lines.append(f"- {name} x y  (where x and y are integers 0-63)")
            else:
                lines.append(f"- {name}")
        return "\n".join(lines)

    def render_frame(
        self,
        frame: Mapping[str, Any],
        *,
        available_actions: Iterable[str] | None = None,
        complex_actions: Mapping[str, bool] | None = None,
    ) -> str:
        """Return the text sent to ARC's model on each turn."""
        grids = frame.get("frames") or []
        rendered = self.interpolate_frames(grids)
        parts = [
            f"State: {frame.get('state', 'UNKNOWN')}\n"
            f"Levels completed: {int(frame.get('levels_completed', 0) or 0)}",
        ]
        for index, grid in enumerate(rendered):
            lines: list[str] = []
            if self.level_just_advanced and index == len(rendered) - 1:
                lines.extend(("", "New Level:", ""))
                self.level_just_advanced = False
            lines.append(f"Frame {index}:")
            lines.extend(f"  {row}" for row in grid)
            parts.append("\n".join(lines))
        if available_actions is None:
            available_actions = frame.get("available_actions") or []
        parts.append(
            "Available actions:\n"
            + self.available_actions_text(available_actions, complex_actions=complex_actions)
        )
        return "\n\n".join(parts)

    def observe(self, frame: Mapping[str, Any], *, native_actions: Iterable[str], complex_actions: Mapping[str, bool] | None = None) -> dict[str, Any]:
        """Decorate a raw bridge frame with the canonical model prompt."""
        levels = int(frame.get("levels_completed", 0) or 0)
        if levels > self.last_levels_completed:
            self.level_just_advanced = True
            self.last_levels_completed = levels
        actions = self.available_action_names(native_actions)
        result = dict(frame)
        result["agent_available_actions"] = actions
        result["model_prompt"] = self.render_frame(
            frame, available_actions=actions, complex_actions=complex_actions
        )
        result["adapter"] = {
            "name": "arc-agi-3-official-agent-contract",
            "system_prompt": OFFICIAL_ARC_SYSTEM_PROMPT,
            "max_animation_frames": self.max_animation_frames,
            "action_budget_multiplier": self.action_budget_multiplier,
        }
        return result

    def record_action(self, action_name: str) -> None:
        self.action_counter += 1
        self.previous_action = action_name
