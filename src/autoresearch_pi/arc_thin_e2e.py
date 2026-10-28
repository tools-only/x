"""Thin ARC-AGI-3 self-harness runner.

One Pi RPC process with ``demo/arc_thin_extension.ts`` plays one game. Each
decision is one ``prompt``; the extension rebuilds the model context from its
own stores and ends the run with one ``arc_action``. The runner only decides
when to prompt, when to consolidate and when to stop. Design:
docs/plans/2026-10-08-thin-arc-self-harness-extension.md
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .arc_agi_3_adapter import OFFICIAL_MAX_RUNTIME_SECONDS, resolve_input_modalities, resolve_model_settings
from .arc_agi_3_e2e import (
    _arc_terminal_or_budget_exhausted,
    _get_json,
    _pi_cli_version,
    _post_json,
    _read_jsonl,
    _resolve_pi_cli,
    _sync_bridge_events,
    _wait_for_bridge,
)
from .pi_kernel import PiKernel, PiTurnIdleTimeout
from .arc_thin_daemon import attach_arc_monitors
from .daemon_service import DaemonService
from .project import load_project_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EXTENSION = PROJECT_ROOT / "demo" / "arc_thin_extension.ts"
SMOKE_PROVIDER = PROJECT_ROOT / "tools" / "arc_thin_smoke_provider.ts"

DECIDE_PROMPT = "Decide the next action."
DAEMON_RESPONSE_PROMPT = (
    "DAEMON RESPONSE. Handle the pending maintenance notification before resuming Task. This turn takes no "
    "environment action. Read the daemon evidence below and data/maintenance.md; inspect details as needed. "
    "Leave task experiments to the next Task turn; repair or reuse a capability for Self, and change one general "
    "prompts/process/<name>.md rule for a recurring capability-making/using problem (Meta). "
    "Check later behavior of earlier rule versions, not only their delivery. Make one bounded improvement when "
    "supported; a reasoned no_change or waiting for an applicable opportunity is valid. Report control-kernel "
    "issues outside your write permissions. Writes are staged in separate Self/Meta workspaces; publish one "
    "validated component with daemon_reply(summary, publish=path), or omit publish for no_change. State what "
    "remains to observe. No EXPECT marker is required. Then stop."
)
DAEMON_RECOVERY_PROMPT = (
    "RECOVER DAEMON RESPONSE. Continue the pending maintenance response using persisted evidence and completed "
    "writes. Do not repeat changes or take an environment action. Finish with daemon_reply(summary, publish=path) "
    "for one staged component, or omit publish for justified no_change. Include unresolved work; then stop."
)
WINDOW_DECIDE_PROMPT = (
    "Decide the next action. Briefly check this window's recent trajectory: what changed and what remains uncertain? "
    "If there is no real blocker, contradiction, or tool failure, act on the clearest next test without extended analysis. "
    "Reuse repeated work when worthwhile."
)
NO_ACTION_PROMPT = (
    "Decide the next action. Your previous decision ended without arc_action; "
    "end this one with exactly one arc_action."
)
CONSOLIDATE_PROMPT = (
    "CONSOLIDATE. No action this turn. Update memory with what the actions since your last review showed: "
    "record new tests and prediction misses with rival verdicts, revise or reject claims only when the evidence "
    "supports it, keep 2-4 live rivals per open question with a separating next_test, update the active strategy "
    "dependencies, and delete obsolete per-step entries. Skills can be fixed or replaced here too, for example one "
    "written for an earlier level. Then stop."
)
CONSOLIDATE_RECOVERY_PROMPT = (
    "RECOVER CONSOLIDATION. The previous review hit the output limit. Do not reason aloud. "
    "Immediately call memory exactly once with only the smallest evidence-backed updates from the latest actions "
    "(include rival verdicts and a separating next_test where needed), then stop; do not call arc_action."
)
#: The native foundation's review after a level change (docs/plans/2026-10-20-level-review-lessons.md). The agent writes
#: its own prompts/lessons.md, an active prompt and so in front of every later decision, from the level's record (the
#: extension adds it below this prompt). In su15-cb-q38-1 the first level's win stood as a general rule and was the only
#: win condition tested in the second level's first 30 actions.
LEVEL_REVIEW_PROMPT = (
    "LEVEL REVIEW. Level {level} is complete; this turn takes no action. Rewrite prompts/lessons.md whole, in one write "
    "call, from the level record below and your own notes. It is shown with every decision from now on and rewritten at "
    "the next level change, so keep it under 1,200 characters. Start it with\n---\nactive: true\n---\nthen write:\n"
    "1. The win condition twice: literally, marked (level {level} only), and as a pattern a later level may share.\n"
    "2. For level {next}: 2-4 candidate win conditions, the one to test first first, each on a line of its own as\n"
    "- test: <move> — <the win condition it tests>\n"
    "with the move as ACTION6(x,y) or ACTIONn. The runtime pins them in this order as moves that predict a level change "
    "and reports each result. Level {level}'s pattern is one candidate, not a rule.\n"
    "Use the LOOP AUDIT to examine how you are solving the task: your strategy, information representations, tools, "
    "rules, experiments, checks, resource use and action workflow. Route a missing task test to Task, one missing or broken "
    "capability to Self, and repeated trouble in how capabilities are selected, created, reused, called or evaluated to Meta. "
    "For Meta, change one Agent-owned general rule in prompts/process/<name>.md; task strategy stays in ordinary prompts. "
    "Before creating a capability, consider reusing or adjusting an existing one. A tools/*.py file can use # mount: decision, action "
    "and on_event(state, event) to enter the runtime loop; optional # EXPECT within N actions: ... on that file opens a trial now. "
    "A reasoned no_change is valid. Do not treat component creation as "
    "the goal. If you make a change, add one line: EXPECT within <N> actions: <what you expect to change>. The runtime "
    "records changed component versions, their observed use and mechanical action/prediction/guard results; it does not "
    "judge the expectation's meaning. For a pending trial, decide with DECISION: keep | revise | remove — <reason>; "
    "without a candidate, use DECISION: no_change — <why>.\n"
    "Scope or delete memory entries that state level {level}'s win as a general rule. Then stop."
)
LEVEL_REVIEW_RECOVERY_PROMPT = (
    "RECOVER LEVEL REVIEW. The previous review reached the output limit. Do not reason aloud: write prompts/lessons.md "
    "once (the frontmatter, the win condition, then the - test: lines; include the shown meta-trial DECISION line if one "
    "is pending), then stop. This turn takes no action."
)
#: The native foundation's review after many actions without a level completed (docs/plans/2026-10-20-stall-review.md).
#: The user, 2026-10-20, in place of refusing repeated actions: "when no task progress is observed over an extended
#: period, the ledger, refiner, critic or similar components notify the agent to review recent and historical
#: trajectories, summarize current problems and bottlenecks, and identify directions for improvement." The agent writes its
#: own prompts/review.md, an active prompt, from the record of the level so far (the extension adds it below this prompt).
STALL_REVIEW_PROMPT = (
    "STALL REVIEW. {why}; this turn takes no action. Review the "
    "level's record below, the history shown and your own notes, then rewrite prompts/review.md whole, in one write call. "
    "It is shown with every decision until you delete it, so keep it under 1,200 characters. Start it with\n---\n"
    "active: true\n---\nthen write:\n"
    "1. What you tried on this level and what each try showed.\n"
    "2. The bottleneck: what you do not know, or cannot do, that keeps the level open.\n"
    "3. What wasted actions: repeated moves, rituals, beliefs kept too long.\n"
    "4. 2-4 directions not tested yet, the one to test first first, each on a line of its own as\n"
    "- test: <move> — <what it would show>\n"
    "with the move as ACTION6(x,y) or ACTIONn; say \"(level change)\" in a direction that should complete the level. The "
    "runtime pins them in this order and reports each result.\n"
    "Use the LOOP AUDIT to examine how you are solving the task: your strategy, information representations, tools, "
    "rules, experiments, checks, resource use and action workflow. Route a missing task test to Task, one missing or broken "
    "capability to Self, and repeated trouble in how capabilities are selected, created, reused, called or evaluated to Meta. "
    "For Meta, change one Agent-owned general rule in prompts/process/<name>.md; task strategy stays in ordinary prompts. "
    "Before creating a capability, consider reusing or adjusting an existing one. A tools/*.py file can use # mount: decision, action "
    "and on_event(state, event) to enter the runtime loop; optional # EXPECT within N actions: ... on that file opens a trial now. "
    "A reasoned no_change is valid. Do not treat component creation as "
    "the goal. If you make a change, add one line: EXPECT within <N> actions: <what you expect to change>. The runtime "
    "records changed component versions, their observed use and mechanical action/prediction/guard results; it does not "
    "judge the expectation's meaning. For a pending trial, decide with DECISION: keep | revise | remove — <reason>; "
    "without a candidate, use DECISION: no_change — <why>.\n"
    "Correct or delete memory entries the record contradicts. Then stop."
)
STALL_REVIEW_RECOVERY_PROMPT = (
    "RECOVER STALL REVIEW. The previous review reached the output limit. Do not reason aloud: write prompts/review.md "
    "once (the frontmatter, then the four parts in a few short lines; include the shown meta-trial DECISION line if one "
    "is pending), then stop. This turn takes no action."
)
#: Actions without a level completed, counted from the level's first action or the last stall review, after which a
#: native run's next turn is a stall review (0: none).
STALL_REVIEW_AFTER = 40
#: Work memory (docs/plans/2026-10-20-work-memory.md): decisions in a row whose actions only gave results the same board
#: had already shown (the extension's `novelty` on each trajectory row) after which the next turn is a stall review; it
#: doubles after each such review until a decision learns something new (0: none).
SPIN_REVIEW_AFTER = 2
DECIDE_RECOVERY_PROMPT = (
    "RECOVER ACTION. The previous turn hit the output limit. Use the persisted working set and latest native "
    "observation; do not explain. If the working set lists a saved Skill whose result has not been explicitly "
    "run for the current question, call run_skill(name=\"...\") exactly once and stop; otherwise call exactly "
    "one arc_action with a short note and prediction, then stop."
)
IDLE_RECOVERY_PROMPT = (
    "RECOVER TURN. The previous parent turn stopped producing events. Read the persisted working set and latest "
    "native observation; do not explain or repeat an already committed action. Make exactly one next lifecycle "
    "operation: call memory once if a consolidation is due, otherwise call exactly one arc_action, then stop."
)
# Streaming deltas repeat the whole partial message per token; keep lifecycle only.
PERSISTED_EVENTS = frozenset({
    "response", "turn_start", "turn_end", "agent_start", "agent_end", "agent_settled",
    "message_start", "message_end", "tool_execution_start", "tool_execution_end", "extension_error",
})
NORMAL_STOPS = frozenset({"win", "budget_exhausted", "max_decisions", "max_levels", "token_cap", "deadline"})
# rebuild: every decision shows only the rebuilt working set (the 2026-10-08 design); session: the agent's last
# decisions from Pi's session stay in view as well (docs/reports/2026-10-12-memory-mechanism-review.md).
CONTINUITY_MODES = frozenset({"rebuild", "session"})
# How Pi encodes a thinking level for an OpenAI-Completions gateway (models.json compat.thinkingFormat).
THINKING_FORMATS = frozenset({"openai", "qwen", "qwen-chat-template"})
# The provider protocols a run may take. Responses carries a decision's reasoning in the stored response
# (previous_response_id); Completions has no such state, so each request re-sends whatever history it is given.
PI_APIS = frozenset({"openai-responses", "openai-completions"})
# Decisions between snapshots of summary.json (marked "partial") while a run continues.
PARTIAL_SUMMARY_EVERY = 10
# With review_on_miss, a scored miss makes a review due once at least this many actions followed the last one.
REVIEW_ON_MISS_GAP = 4
#: The online ARC service sometimes times out while a game is created (2026-10-14: 5 of 6 launches in one hour). No
#: action has been taken then, so starting the bridge again is safe; anything else stops the run as before.
BRIDGE_START_ATTEMPTS = 3
TRANSIENT_BRIDGE_START = re.compile(r"ReadTimeout|ConnectTimeout|ConnectionError|timed out|handshake|"
                                    r"'NoneType' object has no attribute 'info'")
#: A step of the online service sometimes does not return for minutes; the bridge then refuses all access, since that
#: step's outcome is unknown (EnvironmentCallTimeout ended su15-s04, e1-A2, r9 and f0 on 2026-10-15/16). Between
#: decisions the runner can start a new game instead and replay the recorded actions with every grid checked, as a fork
#: does; the action whose outcome was unknown is not among them. At most this many restarts per run (0: stop as before).
MAX_ENVIRONMENT_RESTARTS = 3
#: A provider that ends this many turns in a row with the same error and no action will not answer the run again: the
#: run stops. su15-r1-B2 (2026-10-16) sent about 290 requests that the yibu gateway refused for repeated calls in their
#: history; the refusals reported no usage, so no token cap ended the run. 0 keeps going as before.
MAX_PROVIDER_ERRORS = 3
#: A provider error that names the connection rather than the request (the gateway down or unreachable) is waited out
#: instead of counted toward MAX_PROVIDER_ERRORS: su15-r04-e1 (2026-10-17) stopped after three decisions of "Connection
#: error." in a ~35-minute yibu outage. At most this many seconds of waiting per run (0: count them, as before), backing
#: off from OUTAGE_BACKOFF_SECONDS (doubled per wait, at most ten times it).
MAX_PROVIDER_OUTAGE_SECONDS = 3600
OUTAGE_BACKOFF_SECONDS = 30.0
TRANSPORT_ERROR = re.compile(r"connection error|timed out|timeout|econnreset|econnrefused|etimedout|eai_again|enotfound|"
                             r"socket hang up|fetch failed|network|terminated|bad gateway|service unavailable|overloaded|"
                             r"rate limit|\b(?:429|50[234])\b", re.IGNORECASE)
PROVIDER_CAPACITY_ERROR = re.compile(r"requires?\s+more\s+credits|insufficient\s+(?:credits|balance)|can only afford\s+\d+\s+tokens|"
                                     r"free-models-per-day|add\s+\d+\s+credits\s+to\s+unlock",
                                     re.IGNORECASE)


def _outage_wait(error: str | None, *, waited: float, max_wait: float, streak: int, base: float = OUTAGE_BACKOFF_SECONDS) -> float:
    """Seconds to wait before the next decision when the last turn ended on a transport error (0: none, a refusal, or
    the run's outage allowance is spent). The wait doubles with each one in a row, up to ten times the base."""
    if not error or not TRANSPORT_ERROR.search(error) or base <= 0 or waited >= max_wait:
        return 0.0
    return float(min(10 * base, base * 2 ** streak, max_wait - waited))


def _append_events(root: Path, events: list[Any]) -> None:
    with (root / "bridge-events.jsonl").open("a", encoding="utf-8") as stream:
        for event in events:
            if isinstance(event, dict):
                stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")


def _bridge_health(bridge_url: str) -> dict[str, Any] | None:
    try:
        return _get_json(bridge_url + "/health", timeout=2.0)
    except (OSError, ValueError):
        return None


def _bridge_state(bridge_url: str, attempts: int = 3) -> dict[str, Any] | None:
    for attempt in range(attempts):
        try:
            return _get_json(bridge_url + "/state", timeout=10.0)
        except (OSError, ValueError):
            health = _bridge_health(bridge_url)
            if health and health.get("status") in {"uncertain", "busy"}:
                return None
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    return None


def _reported_tokens(harness: Path) -> int:
    total = 0
    for row in _read_jsonl(harness / "usage.jsonl"):
        reported = int(row.get("total") or 0)
        total += reported or int(row.get("input") or 0) + int(row.get("output") or 0)
    return total


def _budget_tokens(harness: Path) -> int:
    """What max_reported_tokens caps: uncached input plus output. Cache reads are excluded (user decision 2026-10-14):
    counting them stopped the run that reused its prefix most (cont-01, 76k of 140k were cache reads)."""
    return sum(int(row.get("input") or 0) + int(row.get("output") or 0) for row in _read_jsonl(harness / "usage.jsonl"))


def _provider_admission_stop(harness: Path) -> dict[str, str] | None:
    """Consume local fail-closed evidence before retrying a provider turn.

    A missing usage settlement is a budget-integrity stop, not an outage to
    retry. Outstanding reservations alone remain valid and are not failures.
    """
    ledger = harness / "provider-token-budget.jsonl"
    try:
        if ledger.exists():
            for line in ledger.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError("invalid budget row")
                if row.get("event") == "unmeasured_usage" or row.get("unmeasured") is True:
                    return {"stop_reason": "provider_usage_unknown", "error": "provider usage unknown; shared budget closed"}
        for name in ("provider-token-budget-stop.json", "provider-window-admission-stop.json",
                     "arc-parent-provider-admission-stop.json"):
            path = harness / name
            if not path.exists():
                continue
            row = json.loads(path.read_text(encoding="utf-8"))
            reason = row.get("reason") or "shared budget stopped"
            return {"stop_reason": "token_cap" if reason == "reported_request_reserve_exceeded" else "provider_admission",
                    "error": f"provider request declined locally: {reason}"[:500]}
    except (OSError, ValueError, AttributeError):
        return {"stop_reason": "provider_usage_unknown", "error": "provider budget/admission evidence unreadable; refusing retry"}
    return None


def _fatal_errors(harness: Path) -> int:
    return sum(1 for row in _read_jsonl(harness / "errors.jsonl") if row.get("fatal"))


def _environment_errors(harness: Path) -> int:
    """arc_action calls the extension ended because the environment failed (timeout, 5xx)."""
    return sum(1 for row in _read_jsonl(harness / "errors.jsonl") if row.get("environment"))


def _environment_failure_can_recover(rows: list[dict[str, Any]], health: dict[str, Any] | None) -> bool:
    """An uncertain bridge owns its access failures; unrelated fatal errors still stop the harness."""
    return bool(health and health.get("status") == "uncertain" and any(row.get("environment") for row in rows)
                and all(not row.get("fatal") or (row.get("hook") == "before_agent_start:/state"
                        and str(row.get("message", "")).startswith("ARC environment access failed:")) for row in rows))


def _provider_error(events: list[dict[str, Any]]) -> str | None:
    """The error a provider ended a turn's last reply with (stop reason "error"), if it did."""
    for event in reversed(events or []):
        message = event.get("message") if isinstance(event, dict) else None
        if event.get("type") == "message_end" and isinstance(message, dict) and message.get("role") == "assistant":
            return str(message.get("errorMessage") or "provider error") if message.get("stopReason") == "error" else None
    return None


def _provider_capacity_error(error: str | None) -> bool:
    """Whether the provider explicitly says this request exceeds available credits/output capacity.

    These are terminal for the current run: retrying the same configured max_tokens cannot become affordable.
    """
    return bool(error and PROVIDER_CAPACITY_ERROR.search(error))


def _provider_capacity_summary(error: str) -> str:
    """Keep the useful token limits but omit provider URLs or credential identifiers from the run summary."""
    limits = re.search(r"requested up to\s+([\d,]+)\s+tokens,\s*but can only afford\s+([\d,]+)", error, re.IGNORECASE)
    if limits:
        requested, affordable = (part.replace(',', '') for part in limits.groups())
        return f"provider cannot afford requested max_tokens={requested}; affordable max_tokens={affordable}"
    return "provider reports insufficient credits or output-token capacity for this request"


def _tool_errors(events: Path) -> dict[str, int]:
    """Error results per tool (refusals and argument validation failures included)."""
    counts: dict[str, int] = {}
    if not events.exists():
        return counts
    with events.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if '"tool_execution_end"' not in line or '"isError":true' not in line:
                continue
            try:
                name = str(json.loads(line).get("toolName"))
            except ValueError:
                continue
            counts[name] = counts.get(name, 0) + 1
    return counts


def _harness_stats(harness: Path) -> dict[str, Any]:
    memory: dict[str, Any] = {}
    memory_rows = _read_jsonl(harness / "memory.jsonl")
    for row in memory_rows:
        if row.get("rev"):
            continue
        if row.get("deleted"):
            memory.pop(row.get("key"), None)
        else:
            memory[row.get("key")] = row
    hypotheses = {key: row["hyp"] for key, row in memory.items() if isinstance(row.get("hyp"), dict)}
    strategies = {key: row["strat"] for key, row in memory.items() if isinstance(row.get("strat"), dict)}
    evidence = [item for hyp in hypotheses.values() for item in hyp.get("evidence") or []]
    # A row by "check" is the runtime marking a hypothesis contested by its own check (H2a): nobody's write.
    written = [row for row in memory_rows if row.get("by") != "check"]
    skills: dict[str, Any] = {}
    skill_rows = _read_jsonl(harness / "skills.jsonl")
    for row in skill_rows:
        if row.get("deleted"):
            skills.pop(row.get("name"), None)
        else:
            skills[row.get("name")] = row
    runs = _read_jsonl(harness / "skill_runs.jsonl")
    usage = _read_jsonl(harness / "usage.jsonl")
    prompts = _read_jsonl(harness / "prompt.jsonl")
    errors = _read_jsonl(harness / "errors.jsonl")
    return {
        "memory_entries": len(memory) - len(hypotheses) - len(strategies),
        "memory_writes": len(written),
        "memory_deletes": sum(1 for row in memory_rows if row.get("deleted")),
        "hypotheses": {
            "final": {key: hyp.get("status") for key, hyp in hypotheses.items()},
            "writes": sum(1 for row in written if isinstance(row.get("hyp"), dict)),
            "contested_by_check": len(memory_rows) - len(written),
            "evidence": len(evidence),
            "refutations": sum(1 for item in evidence if item.get("verdict") == "refutes"),
            "questions": sorted({str(hyp.get("question")) for hyp in hypotheses.values() if hyp.get("question")}),
        },
        "lifecycle": _lifecycle_stats(memory_rows, _read_jsonl(harness / "trajectory.jsonl"), strategies),
        "tool_errors": _tool_errors(harness.parent / "pi-events.jsonl"),
        "skills": sorted(f"{name} v{row.get('version')}" for name, row in skills.items()),
        "skill_versions_saved": sum(1 for row in skill_rows if not row.get("deleted")),
        "skill_runs": sum(1 for row in runs if not row.get("duplicate")),
        "skill_run_duplicates": sum(1 for row in runs if row.get("duplicate")),
        "skill_run_errors": sum(1 for row in runs if not row.get("duplicate") and not row.get("ok")),
        "prompt_overlay_chars": len(str(prompts[-1].get("text") or "")) if prompts else 0,
        "prompt_writes": len(prompts),
        "analyst_calls": sum(1 for row in usage if row.get("kind") == "analyst"),
        "errors": len(errors),
        "fatal_errors": sum(1 for row in errors if row.get("fatal")),
        "environment_errors": sum(1 for row in errors if row.get("environment")),
        "decision_loop": _decision_loop_stats(usage, _read_jsonl(harness / "trajectory.jsonl"),
                                              _read_jsonl(harness / "batch_results.jsonl")),
        "prediction": _prediction_stats(_read_jsonl(harness / "trajectory.jsonl")),
        "history": {
            "states_recorded": len(_read_jsonl(harness / "states.jsonl")),
            # Whether a skill read the history is inferred from its source; a run shows the call.
            "skill_versions_reading_history": sorted(f"{row.get('name')} v{row.get('version')}" for row in skill_rows
                                                     if not row.get("deleted") and "history" in str(row.get("source") or "")),
            "runs_of_skills_reading_history": sum(1 for row in runs if f"{row.get('name')} v{row.get('version')}" in {
                f"{item.get('name')} v{item.get('version')}" for item in skill_rows if "history" in str(item.get("source") or "")}),
        },
        "working_set": _working_set_stats(_read_jsonl(harness / "working_set.jsonl")),
        "level_reviews": _level_review_stats(harness),
        "stall_reviews": _review_stats(harness, "stall_review", "review"),
        "loop_bound": _loop_bound_stats(harness),
        "work_memory": _work_memory_stats(harness),
        "ledger": _ledger_stats(harness),
    }


def _work_memory_stats(harness: Path) -> dict[str, Any] | None:
    """Work memory (docs/plans/2026-10-20-work-memory.md): python calls with an address, those that repeated an earlier
    one, those answered from the same state without a run, those that retyped lines of an earlier one, those that ran
    earlier calls with cell(k); actions by novelty; decisions that learned nothing new (spin), the longest run of them,
    and the novelty pins set. None when it was off."""
    calls = _read_jsonl(harness / "python_calls.jsonl")
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    if not calls and not any("novelty" in row for row in trajectory):
        return None
    novelty = {kind: sum(1 for row in trajectory if row.get("novelty") == kind) for kind in ("new", "known", "diverged")}
    spins, longest = 0, 0
    for end in range(1, len(trajectory) + 1):
        streak, _ = _spin_streak(trajectory[:end])
        if end == len(trajectory) or trajectory[end].get("decision") != trajectory[end - 1].get("decision"):
            longest = max(longest, streak)
    decisions: dict[int, list[dict[str, Any]]] = {}
    for row in trajectory:
        if row.get("decision") is not None:
            decisions.setdefault(int(row["decision"]), []).append(row)
    for rows in decisions.values():
        played = [row for row in rows if row.get("action") != "RESET"]
        if played and not any(row.get("level_changed") or row.get("novelty") != "known" for row in played):
            spins += 1
    pins = [row for row in _read_jsonl(harness / "work_memory.jsonl") if row.get("kind") == "novelty_pin"]
    return {
        "python_calls": len(calls),
        "repeats": sum(1 for row in calls if row.get("same") is not None),
        "answered_from_same_state": sum(1 for row in calls if row.get("cached")),
        "retyped_lines": sum(1 for row in calls if row.get("blocks")),
        "cell_calls": sum(1 for row in calls if row.get("cells")),
        "actions_by_novelty": novelty,
        "spin_decisions": spins,
        "longest_spin_streak": longest,
        "novelty_pins": len(pins),
    }


def _level_review_stats(harness: Path) -> dict[str, Any] | None:
    """What each level review cost (the agent's requests and budget tokens in that turn) and what became of
    prompts/lessons.md (versions saved, versions that failed to load, its size now); None when no review ran."""
    return _review_stats(harness, "level_review", "lessons")


def _loop_bound_stats(harness: Path) -> dict[str, Any]:
    """The call points and pinned tests of docs/plans/2026-10-20-loop-bound-artifacts.md, from their logs: refine points
    reached and the refine calls made at them, consults in reviews and the marks the reviews left of their answers, the
    tests pinned from review files and from the predictor tools' disagreement with what became of each, the predictor
    tools' scored predictions, and moves whose result differed from an earlier one from the same board and action."""
    calls = _read_jsonl(harness / "call_points.jsonl")
    refiner = _read_jsonl(harness / "refiner.jsonl")
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    tests = [row for row in refiner if row.get("kind") == "next" and row.get("test")]
    done = {row.get("edit"): row for row in refiner if row.get("kind") == "next_done"}
    outcomes: dict[str, int] = {}
    for row in tests:
        outcome = str((done.get(row.get("edit")) or {}).get("outcome", "open"))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    predictions = [p for row in trajectory for p in row.get("predictors") or []]
    count = lambda kind, **match: sum(1 for row in calls if row.get("kind") == kind and all(bool(row.get(k)) == v for k, v in match.items()))
    return {
        "refine_points": count("refine_point"), "refine_calls": count("refine"), "refine_calls_at_points": count("refine", point=True),
        "consult_points": count("consult_point"), "consults_in_reviews": count("consult", review=True),
        "consult_marks": sum(int(row.get("file_marks") or 0) + int(row.get("memory_marks") or 0)
                             for row in calls if row.get("kind") == "consult_use"),
        "tests_pinned": len(tests), "tests_by_outcome": outcomes,
        "disagreement_pins": sum(1 for row in tests if str(row.get("edit", "")).startswith("disagree:")),
        "predictions": len(predictions),
        "predictions_right": sum(1 for p in predictions if p.get("fields") and not p.get("misses") and p.get("hits")),
        "diverged_moves": sum(1 for row in trajectory if row.get("diverges_from") is not None),
    }


def _review_stats(harness: Path, flag: str, name: str) -> dict[str, Any] | None:
    """What each review turn marked `flag` in the working-set log cost, and what became of the prompt it rewrites,
    prompts/<name>.md; None when no such review ran."""
    reviews = sorted({int(row["decision"]) for row in _read_jsonl(harness / "working_set.jsonl")
                      if row.get(flag) and row.get("decision") is not None})
    if not reviews:
        return None
    usage = [row for row in _read_jsonl(harness / "usage.jsonl") if row.get("kind") == "agent"]
    versions = [row for row in _read_jsonl(harness.parent / ".harness" / "components.jsonl")
                if row.get("path") == f"prompts/{name}.md" and not row.get("retired")]
    path = harness.parent / "workspace" / "prompts" / f"{name}.md"
    return {
        "turns": [{"decision": decision,
                   "requests": sum(1 for row in usage if row.get("decision") == decision),
                   "budget_tokens": sum(int(row.get("input") or 0) + int(row.get("output") or 0)
                                        for row in usage if row.get("decision") == decision)} for decision in reviews],
        f"{name}_versions": len(versions),
        f"{name}_failed": sum(1 for row in versions if row.get("error")),
        f"{name}_chars": len(path.read_text(encoding="utf-8")) if path.is_file() else None,
    }


def _prediction_stats(trajectory: list[dict[str, Any]]) -> dict[str, Any]:
    """How often the agent stated a prediction with its action, and how the fields scored (P1/P2)."""
    by_field: dict[str, list[int]] = {}
    by_skill: dict[str, list[int]] = {}
    skill_failures = 0
    for row in trajectory:
        for item in (row.get("prediction") or {}).get("fields") or []:
            if item.get("hit") is not None:
                entry = by_field.setdefault(str(item.get("field")), [0, 0])
                entry[0] += 1 if item.get("hit") else 0
                entry[1] += 1
        skill = row.get("skill_prediction")
        if isinstance(skill, dict):
            if skill.get("error"):
                skill_failures += 1
            else:
                entry = by_skill.setdefault(f"{skill.get('name')} v{skill.get('version')}", [0, 0])
                entry[0] += int(skill.get("hits") or 0)
                entry[1] += int(skill.get("hits") or 0) + int(skill.get("misses") or 0)
    scored = sum(entry[1] for entry in by_field.values())
    return {
        "actions": len(trajectory),
        "actions_with_prediction": sum(1 for row in trajectory if row.get("prediction")),
        "fields_scored": scored,
        "field_hits": sum(entry[0] for entry in by_field.values()),
        "by_field": {field: {"hits": hits, "scored": total} for field, (hits, total) in sorted(by_field.items())},
        "actions_with_skill_prediction": sum(1 for row in trajectory if row.get("skill_prediction")),
        "skill_prediction_failures": skill_failures,
        "by_skill": {name: {"hits": hits, "scored": total} for name, (hits, total) in sorted(by_skill.items())},
    }


def _working_set_stats(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Size of what the agent was given per decision, by section (D1); None for runs before the log existed."""
    if not rows:
        return None
    sections: dict[str, list[int]] = {}
    for row in rows:
        for name, chars in (row.get("sections") or {}).items():
            sections.setdefault(name, []).append(int(chars or 0))
    return {
        "decisions": len(rows),
        "mean_chars": round(sum(sum((row.get("sections") or {}).values()) for row in rows) / len(rows)),
        "mean_chars_by_section": {name: round(sum(values) / len(rows)) for name, values in sorted(sections.items())},
        "decisions_with_carried_reasoning": sum(1 for row in rows if (row.get("sections") or {}).get("reasoning")),
    }


def _decision_loop_stats(usage: list[dict[str, Any]], trajectory: list[dict[str, Any]],
                         batched: list[dict[str, Any]]) -> dict[str, Any]:
    """Model messages per action decision and what they cost (agent calls only, side calls excluded)."""
    acted = {row.get("decision") for row in trajectory}
    per_decision: dict[Any, list[dict[str, Any]]] = {}
    for row in usage:
        if row.get("kind") == "agent" and row.get("decision") in acted:
            per_decision.setdefault(row.get("decision"), []).append(row)
    messages = [len(rows) for rows in per_decision.values()]
    later = sum(int(row.get("input") or 0) + int(row.get("cache_read") or 0) + int(row.get("output") or 0)
                for rows in per_decision.values() for row in rows[1:])
    every = sum(int(row.get("input") or 0) + int(row.get("cache_read") or 0) + int(row.get("output") or 0)
                for rows in per_decision.values() for row in rows)
    return {
        "action_decisions": len(messages),
        "messages_per_action_decision": round(sum(messages) / len(messages), 2) if messages else None,
        "single_message_decisions": sum(1 for count in messages if count == 1),
        "tokens_after_first_message_pct": round(100 * later / every, 1) if every else None,
        "batched_tool_results": len(batched),
        "batched_tool_failures": sum(1 for row in batched if row.get("failed")),
    }


def _lifecycle_stats(memory_rows: list[dict[str, Any]], trajectory: list[dict[str, Any]],
                     strategies: dict[str, Any]) -> dict[str, Any]:
    """Hypothesis-strategy lifecycle counts and what followed each revision. Mechanical only:
    whether later actions served the revised conclusion is a judgement left to the audit."""
    labels = [str(row.get("action")) + (f"({row.get('x')},{row.get('y')})" if row.get("x") is not None
                                        and row.get("y") is not None else "") for row in trajectory]
    times = [str(row.get("t") or "") for row in trajectory]

    def action_at(row: dict[str, Any]) -> int:
        return sum(1 for t in times if t and t <= str(row.get("t") or ""))

    deleted = [row for row in memory_rows if row.get("deleted") and str(row.get("key", "")).startswith("hyp.")]
    revisions = []
    for index, row in enumerate(memory_rows):
        rev = row.get("rev")
        if not isinstance(rev, dict):
            continue
        at = int(rev.get("at") or 0)
        after = labels[at:at + 8]
        before = labels[max(0, at - max(len(after), 1)):at]
        before_key = rev.get("active_before")
        activated = rev.get("active_after") if rev.get("active_after") not in (None, before_key) else None
        new_strategy_at = at if activated else next(
            (action_at(later) for later in memory_rows[index + 1:] if isinstance(later.get("strat"), dict)
             and later["strat"].get("status") == "active" and later.get("key") != before_key), None)
        revisions.append({
            "at": at, "causes": rev.get("causes"), "active_before": before_key, "active_after": rev.get("active_after"),
            "next_actions": after, "previous_actions": before,
            "same_action_set": bool(after) and set(after) <= set(before),
            "new_strategy_at": new_strategy_at, "linked": sorted(rev.get("linked") or {}),
        })
    strategy_rows = [row for row in memory_rows if isinstance(row.get("strat"), dict)]
    return {
        "hypotheses_deleted": len(deleted),
        "deleted_without_refutation": sum(1 for row in deleted if row.get("dropped")),
        **_separating_tests(memory_rows),
        **_refutation_responses(memory_rows),
        "strategies": {
            "final": {key: strat.get("status") for key, strat in strategies.items()},
            "writes": len(strategy_rows),
            "with_premises": len({row.get("key") for row in strategy_rows if row["strat"].get("depends_on")}),
            "with_components": len({row.get("key") for row in strategy_rows if row["strat"].get("uses")}),
        },
        "revisions": revisions,
    }


def _told_apart(hypotheses: dict[str, dict[str, Any]], key: str) -> int:
    """Recorded tests that gave `key` a different verdict than another hypothesis with its question
    (mirrors testsToldApart in demo/arc_thin_memory.ts: same action number, or same condition and
    observation when there is none)."""
    question = (hypotheses.get(key) or {}).get("question")
    if not question:
        return 0
    tests: dict[str, dict[str, str]] = {}
    for name, hyp in hypotheses.items():
        if hyp.get("question") != question:
            continue
        for item in hyp.get("evidence") or []:
            test = f"#{item['action']}" if item.get("action") is not None else f"{item.get('condition')}|{item.get('observed')}"
            tests.setdefault(test, {})[name] = str(item.get("verdict"))
    return sum(1 for verdicts in tests.values() if key in verdicts and len(set(verdicts.values())) >= 2)


def _separating_tests(memory_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Deletions and status changes of hypotheses that had rivals, and how many of them had a recorded
    test that told them apart from a rival at the time (H1/H2). A count of records, not a judgement."""
    current: dict[str, dict[str, Any]] = {}
    with_rivals = without = 0
    settled = settled_without = 0

    def rivals(key: str) -> int:
        question = (current.get(key) or {}).get("question")
        return sum(1 for hyp in current.values() if question and hyp.get("question") == question) - 1

    for row in memory_rows:
        key = str(row.get("key") or "")
        if not key.startswith("hyp."):
            continue
        if row.get("deleted"):
            if key in current and rivals(key) >= 1:
                with_rivals += 1
                without += 0 if _told_apart(current, key) else 1
            current.pop(key, None)
            continue
        hyp = row.get("hyp")
        if not isinstance(hyp, dict):
            continue
        before = (current.get(key) or {}).get("status")
        current[key] = hyp
        if hyp.get("status") in ("supported", "rejected") and before != hyp.get("status") and rivals(key) >= 1:
            settled += 1
            settled_without += 0 if _told_apart(current, key) else 1
    return {
        "deleted_with_rivals": with_rivals,
        "deleted_without_separating_test": without,
        "settled_with_rivals": settled,
        "settled_without_separating_test": settled_without,
    }


def _refutation_responses(memory_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """How hypotheses responded to refutations, from consecutive versions of each key.
    contested_outcomes: what a contested hypothesis became next (rejected, narrowed = claim
    rewritten, status_only = status restated with the same claim). restated_with_refutation:
    a refutation recorded in the same call that rewrote the claim, which never shows as
    contested; whether the rewrite was a fair narrowing is left to the audit."""
    previous: dict[str, dict[str, Any]] = {}
    outcomes = {"rejected": 0, "narrowed": 0, "status_only": 0}
    restated = 0

    def refutations(hyp: dict[str, Any]) -> int:
        return sum(1 for item in hyp.get("evidence") or [] if item.get("verdict") == "refutes")

    for row in memory_rows:
        key = row.get("key")
        if row.get("deleted"):
            previous.pop(key, None)
            continue
        hyp = row.get("hyp")
        if not isinstance(hyp, dict):
            continue
        before = previous.get(key)
        if before is not None:
            claim_changed = hyp.get("claim") != before.get("claim")
            if before.get("status") == "contested" and hyp.get("status") != "contested":
                outcome = "rejected" if hyp.get("status") == "rejected" else "narrowed" if claim_changed else "status_only"
                outcomes[outcome] += 1
            elif claim_changed and hyp.get("status") != "rejected" and refutations(hyp) > refutations(before):
                restated += 1
        previous[key] = hyp
    return {"contested_outcomes": outcomes, "restated_with_refutation": restated}


def _ledger_stats(harness: Path) -> dict[str, Any] | None:
    """Counts from the ledger and critic stores; None when the ledger was off. states.jsonl is written
    in every run (skills read it as history), so the run configuration decides."""
    config_path = harness.parent / "run-config.json"
    try:
        enabled = bool(json.loads(config_path.read_text(encoding="utf-8")).get("ledger")) if config_path.is_file() else None
    except ValueError:
        enabled = None
    observations = _read_jsonl(harness / "observations.jsonl")
    states = _read_jsonl(harness / "states.jsonl")
    if enabled is False or (enabled is None and not states and not observations):
        return None
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    critic = _read_jsonl(harness / "critic.jsonl")
    usage = _read_jsonl(harness / "usage.jsonl")
    notes = [row for row in critic if row.get("kind") == "note"]
    ideas = [str(row.get("idea") or "") for row in trajectory]
    longest = current = 0
    previous = None
    for idea in ideas:
        key = idea.lower() or None
        current = current + 1 if key is not None and key == previous else (1 if key is not None else 0)
        longest = max(longest, current)
        previous = key
    return {
        "actions_with_idea": sum(1 for idea in ideas if idea),
        "actions_with_expect": sum(1 for row in trajectory if row.get("expect")),
        "distinct_ideas": len({idea.lower() for idea in ideas if idea}),
        "longest_idea_run": longest,
        "states_recorded": len(states),
        "observations": {"ok": sum(1 for row in observations if row.get("ok")),
                         "error": sum(1 for row in observations if not row.get("ok"))},
        "observed_skills": sorted({f"{row.get('skill')} v{row.get('version')}" for row in observations if row.get("ok")}),
        "critic": {
            "notes": len(notes),
            "notes_shown": sum(1 for row in notes if row.get("lines") or row.get("suggest")),
            "lines_kept": sum(len(row.get("lines") or []) for row in notes),
            "lines_dropped": sum(len(row.get("dropped") or []) for row in notes),
            "suppressed": sum(1 for row in critic if row.get("kind") == "suppressed"),
            "failed": sum(1 for row in critic if row.get("kind") == "failed"),
            "tokens": sum(int(row.get("total") or 0) for row in usage if row.get("kind") == "critic"),
        } if critic else None,
    }


def _thinking_format_for_route(settings: dict[str, Any], provider: str, model: str,
                               thinking: str | None) -> str | None:
    """Encode an explicitly requested level on the project's known Qwen route.

    An explicit CLI/environment dialect wins. Unknown gateways and provider-default
    thinking retain their existing policy; do not guess another vendor's protocol.
    """
    declared = settings.get("thinking_format")
    if declared:
        return str(declared)
    if (thinking is not None and settings.get("pi_api") == "openai-completions"
            and provider == "yibu" and model == "qwen3.8-27b"):
        return "qwen"
    return None


def _resolve_pi_api(settings: dict[str, Any], foundation: str, pi_api: str | None,
                    declared_format: str | None) -> str:
    """Choose the provider protocol for this run.

    Native runs default to Completions because a generic OpenAI-compatible gateway need not store Responses.
    Responses remains an explicit opt-in for providers that support continuation by response ID.
    """
    if pi_api is not None:
        if pi_api not in PI_APIS:
            raise ValueError(f"pi_api must be one of {sorted(PI_APIS)}")
        if pi_api != "openai-completions" and declared_format:
            raise ValueError("a declared thinking format requires pi_api=openai-completions")
        return pi_api
    return "openai-completions" if foundation == "native" else str(settings["pi_api"])


def _write_models_json(agent_dir: Path, provider: str, model: str, settings: dict[str, Any]) -> None:
    compat: dict[str, Any] = {"supportsDeveloperRole": False}
    if settings.get("thinking_format"):
        compat["thinkingFormat"] = settings["thinking_format"]
    entry: dict[str, Any] = {
        "id": model, "name": model, "reasoning": True, "input": list(settings["input_modalities"]),
        "contextWindow": settings["context_window"],
        "cost": {"input": 5, "output": 30, "cacheRead": 0, "cacheWrite": 0},
    }
    if settings.get("max_tokens"):
        entry["maxTokens"] = settings["max_tokens"]
    (agent_dir / "models.json").write_text(json.dumps({"providers": {provider: {
        "baseUrl": settings["base_url"], "api": settings["pi_api"], "apiKey": "$OPENAI_API_KEY",
        "compat": compat, "authHeader": True, "models": [entry],
    }}}, indent=2) + "\n", encoding="utf-8")


def _start_bridge(root: Path, *, arc_root: Path, game: str, max_actions: int | None, env: dict[str, str],
                  bridge_python: Path | None, bridge_module_paths: tuple[Path, ...], replay_actions: Path | None = None,
                  port: int = 0, action_token: str | None = None,
                  ) -> tuple[subprocess.Popen[str], Any, str, str]:
    """Start the ARC bridge process; returns (process, stderr file, launch id, action token).
    The caller waits for it with _wait_for_bridge and stops it with _stop_bridge. ``replay_actions`` (a fork, or an
    environment restart) is played before the bridge reports ready; a restart passes the old ``port`` and
    ``action_token`` so that Pi keeps its bridge URL and token."""
    arc_root = arc_root.resolve()
    arc_python = bridge_python or arc_root / ".venv" / "Scripts" / "python.exe"
    if not arc_python.is_file():
        raise FileNotFoundError(f"ARC SDK interpreter was not found: {arc_python}")
    src = str(Path(__file__).resolve().parent.parent)
    bridge_env = dict(env)
    bridge_env["PYTHONPATH"] = os.pathsep.join(
        [src, *(str(path.resolve()) for path in bridge_module_paths), env.get("PYTHONPATH", "")])
    launch_id = secrets.token_hex(16)
    action_token = action_token or secrets.token_urlsafe(32)
    bridge_command = [str(arc_python), "-m", "autoresearch_pi.arc_agi_3_bridge",
                      "--root", str(root), "--game", game, "--port", str(int(port))]
    if max_actions is not None:
        bridge_command.extend(["--max-actions", str(max_actions)])
    if replay_actions is not None:
        bridge_command.extend(["--replay-actions", str(replay_actions)])
    # stderr goes to a file: an undrained pipe can block a long-running bridge.
    bridge_stderr = (root / "bridge-stderr.log").open("w", encoding="utf-8")
    try:
        bridge = subprocess.Popen(
            bridge_command, cwd=str(arc_root), text=True, stdout=subprocess.PIPE, stderr=bridge_stderr,
            env={**bridge_env, "ARC_BRIDGE_EVENT_WRITER": "parent",
                 "ARC_BRIDGE_ACTION_TOKEN": action_token, "ARC_BRIDGE_LAUNCH_ID": launch_id},
        )
    except OSError:
        bridge_stderr.close()
        raise
    return bridge, bridge_stderr, launch_id, action_token


def _stop_bridge(bridge: subprocess.Popen[str], bridge_stderr: Any, closed: bool) -> None:
    """Wait for a bridge that was closed through /close; terminate one that was not."""
    if bridge.poll() is None:
        try:
            bridge.wait(timeout=30 if closed else 0.1)
        except subprocess.TimeoutExpired:
            bridge.terminate()
            try:
                bridge.wait(timeout=10)
            except subprocess.TimeoutExpired:
                bridge.kill()
    bridge_stderr.close()


def _request_accounting(rows: list[dict[str, Any]]) -> dict[str, Any]:
    starts = {row['request_id']: row for row in rows if row.get('stage') == 'request_prepared' and row.get('request_id')}
    ends = {row['request_id']: row for row in rows if row.get('stage') == 'request_settlement' and row.get('request_id')}
    by_kind: dict[str, Any] = {}
    known = unknown = 0
    for key, start in starts.items():
        end = ends.get(key, {})
        kind = start.get('kind', 'unknown')
        counts = by_kind.setdefault(kind, dict(attempts=0, completed=0, aborted=0, unsettled=0, failed=0))
        counts['attempts'] += 1
        status = end.get('status', 'unsettled')
        counts[status if status in counts else 'failed'] += 1
        value = end.get('total')
        if isinstance(value, (int, float)) and value >= 0:
            known += value
        if end.get('cost_status') != 'reported':
            unknown += 1
    return dict(attempts=len(starts), by_kind=by_kind, known_tokens_lower_bound=known,
                unknown_cost_attempts=unknown, complete_cost_known=unknown == 0,
                cost_scope='provider-reported tokens, not verified billing')


#: What a snapshot keeps: the Pi session, the extension's stores, the agent's workspace, and the binder and python
#: session checkpoints. Bridge, provider and smoke logs belong to the run that wrote them.
FORK_ITEMS = ("session.jsonl", "harness", "workspace", ".harness", "maintenance")


def _copy_items(source: Path, target: Path) -> None:
    for name in FORK_ITEMS:
        if (source / name).is_dir():
            shutil.copytree(source / name, target / name)
        elif (source / name).is_file():
            shutil.copy2(source / name, target / name)


def _snapshot_run(root: Path, decision: int, game: str, fork: dict[str, Any] | None) -> Path:
    """Copy the run's state after ``decision`` to ``snapshots/after-decision-<k>`` for later forks."""
    target = root / "snapshots" / f"after-decision-{decision}"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    _copy_items(root, target)
    trajectory = _read_jsonl(root / "harness" / "trajectory.jsonl")
    meta = {"format": "arc-thin-snapshot-v1", "game": game, "decision": decision, "actions": len(trajectory),
            "reported_tokens": _reported_tokens(root / "harness"), "budget_tokens": _budget_tokens(root / "harness"),
            "created_at": time.time(),
            # A refinement may still be running in the background; its result then belongs to the source run only.
            **({"forked_from": fork["source"]} if fork else {})}
    (target / "snapshot.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return target


def _write_replay(root: Path, replay: Path) -> list[dict[str, Any]]:
    """Write the run's recorded actions for the bridge to replay, each with the grid it must yield; returns them."""
    trajectory = _read_jsonl(root / "harness" / "trajectory.jsonl")
    grids = {int(row["n"]): row["grid"] for row in _read_jsonl(root / "harness" / "states.jsonl")
             if isinstance(row.get("grid"), list) and "n" in row}
    with replay.open("w", encoding="utf-8") as stream:
        for row in trajectory:
            coordinates = {"x": row["x"], "y": row["y"]} if "x" in row and "y" in row else {}
            stream.write(json.dumps({"n": row["n"], "action": row["action"], **coordinates,
                                     "grid": grids.get(int(row["n"]))}, separators=(",", ":")) + "\n")
    return trajectory


def _seed_fork(root: Path, snapshot: Path, game: str) -> dict[str, Any]:
    """Copy a snapshot into a new run root and write the actions the bridge replays, each with the grid it must yield."""
    snapshot = snapshot.resolve()
    meta = json.loads((snapshot / "snapshot.json").read_text(encoding="utf-8"))
    if meta.get("format") != "arc-thin-snapshot-v1" or meta.get("game") != game:
        raise ValueError(f"{snapshot} is not a snapshot of {game}: {meta}")
    _copy_items(snapshot, root)
    replay = root / "fork-replay.jsonl"
    trajectory = _write_replay(root, replay)
    if len(trajectory) != meta["actions"]:
        raise ValueError(f"snapshot trajectory has {len(trajectory)} actions, its record {meta['actions']}")
    return {"source": str(snapshot), "decision": meta["decision"], "actions": len(trajectory), "replay": replay,
            "total_used": ((trajectory[-1].get("budget") or {}).get("total_used") if trajectory else None),
            "level_changed": bool(trajectory and trajectory[-1].get("level_changed")),
            "prefix_reported_tokens": _reported_tokens(root / "harness"),
            "prefix_budget_tokens": _budget_tokens(root / "harness")}


def _consolidation_interval(foundation: str, explicit: int | None) -> int:
    if explicit is not None and explicit < 0:
        raise ValueError('consolidation interval must be nonnegative')
    return (0 if foundation == 'native' else 25) if explicit is None else explicit


def _level_review_default(explicit: bool | None, env: dict[str, str]) -> bool:
    """Whether a review follows each level change: on unless turned off, by the argument or (for pilots, which pass only
    environment variables) ARC_THIN_LEVEL_REVIEW=0. Native runs had it off from 2026-10-12 (decision D2) to 2026-10-20."""
    return env.get("ARC_THIN_LEVEL_REVIEW", "1") != "0" if explicit is None else bool(explicit)


def _input_modalities(explicit: str | None, env: dict[str, str]) -> list[str]:
    """What the model is declared to take: the argument, else ARC_INPUT_MODALITIES, else text and image (the default since
    2026-10-20, at the user's request). A text-only model needs input_modalities="text"."""
    return list(resolve_input_modalities(explicit if explicit is not None else env.get("ARC_INPUT_MODALITIES") or "text,image"))


def _task_only_review(prompt: str, final_instruction: str) -> str:
    return prompt[:prompt.index("Use the LOOP AUDIT")] + prompt[prompt.index(final_instruction):]


def _level_review_prompt(levels_completed: int, include_process: bool = True) -> str:
    """The native review after a level change; the level just completed is the `levels_completed`-th."""
    prompt = LEVEL_REVIEW_PROMPT if include_process else _task_only_review(LEVEL_REVIEW_PROMPT, "Scope or delete memory")
    return prompt.format(level=levels_completed, next=levels_completed + 1)


def _stall_review_after(foundation: str, explicit: int | None, env: dict[str, str]) -> int:
    """Actions without a level completed before a stall review: the argument, else (for pilots, which pass only
    environment variables) ARC_THIN_STALL_REVIEW, else STALL_REVIEW_AFTER in the native foundation; 0 turns it off. The
    legacy foundation has no stall review."""
    value = explicit if explicit is not None else int(env.get("ARC_THIN_STALL_REVIEW") or STALL_REVIEW_AFTER)
    if value < 0:
        raise ValueError("stall review interval must be nonnegative")
    return value if foundation == "native" else 0


def _level_start(trajectory: list[dict[str, Any]]) -> int:
    """Actions played before the level on screen began: the number of the last action that changed the level, else 0."""
    return max((int(row.get("n") or index + 1) for index, row in enumerate(trajectory) if row.get("level_changed")), default=0)


def _stall_review_due(trajectory: list[dict[str, Any]], reviewed_at: int, after: int) -> bool:
    """Whether `after` actions have been played without a level completed, counted from the later of the level's first
    action and the last stall review (`reviewed_at`, an action count). Mechanical: it counts, it does not judge."""
    return after > 0 and len(trajectory) - max(_level_start(trajectory), reviewed_at) >= after


def _stall_review_prompt(trajectory: list[dict[str, Any]], reviewed_at: int, levels_completed: int,
                         spin: tuple[int, list[str]] | None = None, include_process: bool = True) -> str:
    """The stall review's prompt. `spin` (decisions in a row that learned nothing new, and their moves) says why it came
    early: the work-memory trigger, not the action count."""
    start = _level_start(trajectory)
    since = len(trajectory) - max(start, reviewed_at)
    anchor = (f"since your last stall review, at action {reviewed_at}" if reviewed_at > start
              else f"since it began at action {start + 1}")
    if spin:
        streak, moves = spin
        shown = ", ".join(moves[:4]) + (", …" if len(moves) > 4 else "")
        why = (f"Your last {streak} decisions only played moves whose results this board had already shown ({shown}); "
               f"level {levels_completed + 1} has been open for {since} actions ({anchor})")
    else:
        why = f"Level {levels_completed + 1} is still open after {since} actions ({anchor})"
    prompt = STALL_REVIEW_PROMPT if include_process else _task_only_review(STALL_REVIEW_PROMPT, "Correct or delete memory")
    return prompt.format(why=why)


def _spin_review_after(foundation: str, explicit: int | None, env: dict[str, str]) -> int:
    """Decisions in a row that learned nothing new before a stall review (work memory): the argument, else
    ARC_THIN_SPIN_REVIEW, else SPIN_REVIEW_AFTER in the native foundation; 0 turns it off, and so does
    ARC_THIN_WORK_MEMORY=0 (the extension then marks no row)."""
    value = explicit if explicit is not None else int(env.get("ARC_THIN_SPIN_REVIEW") or SPIN_REVIEW_AFTER)
    if value < 0:
        raise ValueError("spin review threshold must be nonnegative")
    return value if foundation == "native" and env.get("ARC_THIN_WORK_MEMORY") != "0" else 0


def _spin_streak(trajectory: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """Decisions in a row, latest first, whose actions all gave results the same board had already shown (the extension's
    `novelty` == "known"), with the moves they played. A RESET, or a decision without actions, is neutral; a level change
    or a new or diverging result ends the streak. The same rule as spinStreak in demo/arc_thin_work_memory.ts."""
    decisions: dict[int, list[dict[str, Any]]] = {}
    for row in trajectory:
        if row.get("decision") is not None:
            decisions.setdefault(int(row["decision"]), []).append(row)
    streak, moves = 0, []
    for decision in sorted(decisions, reverse=True):
        played = [row for row in decisions[decision] if row.get("action") != "RESET"]
        if not played:
            continue
        if any(row.get("level_changed") or row.get("novelty") != "known" for row in played):
            break
        streak += 1
        for row in played:
            move = row["action"] + (f"({row['x']},{row['y']})" if row.get("x") is not None and row.get("y") is not None else "")
            if move not in moves:
                moves.append(move)
    return streak, moves


def _review_recovery(message: str) -> str | None:
    """The prompt that resumes a review turn after a length stop or a stalled request; None for an action decision."""
    if message.startswith(("DAEMON RESPONSE", "RECOVER DAEMON RESPONSE")):
        return DAEMON_RECOVERY_PROMPT
    if message.startswith(("LEVEL REVIEW", "RECOVER LEVEL REVIEW")):
        return LEVEL_REVIEW_RECOVERY_PROMPT
    if message.startswith(("STALL REVIEW", "RECOVER STALL REVIEW")):
        return STALL_REVIEW_RECOVERY_PROMPT
    if message in {CONSOLIDATE_PROMPT, CONSOLIDATE_RECOVERY_PROMPT}:
        return CONSOLIDATE_RECOVERY_PROMPT
    return None


def _reconciled_action(before: int, health: dict | None, state: dict | None, trajectory_count: int) -> bool:
    total = ((state or {}).get('action_budget') or {}).get('total_used')
    if not health or health.get('status') not in {'ready', 'closed'} or total != trajectory_count or trajectory_count < before:
        raise RuntimeError('environment outcome unknown: recovery action/state reconciliation failed')
    if trajectory_count > before + 1:
        raise RuntimeError('environment outcome conflict: more than one action submitted during a decision')
    return trajectory_count > before


def _recover_native_turn(turn, message: str, kernel, summary: dict, reconcile, *, max_recoveries: int = 2,
                         settlement_timeout: float = 30.0, restart=None) -> list[dict[str, Any]]:
    """A local fault group. Abort, settle and reconcile before considering another paid request."""
    for attempt in range(max_recoveries + 1):
        try:
            return turn(message)
        except (PiTurnIdleTimeout, RuntimeError, OSError) as exc:
            dead = (not isinstance(exc, PiTurnIdleTimeout) and restart is not None
                    and (isinstance(exc,OSError) or 'Pi RPC process exited' in str(exc)) and kernel.process is not None
                    and kernel.process.poll() is not None)
            if not isinstance(exc, PiTurnIdleTimeout) and not dead:
                raise
            if not dead:
                summary['idle_timeouts'] += 1
            try:
                if dead:
                    settled = [{'type':'agent_settled', 'recovery':'committed_action'}]
                else:
                    kernel.abort()
                    settled = kernel.wait_for_agent_events(timeout=settlement_timeout)
                    if not any(e.get('type') == 'agent_settled' for e in settled):
                        raise RuntimeError('abort did not settle; recovery refused')
                committed = reconcile()
                if not committed and attempt >= max_recoveries:
                    raise RuntimeError('continuous idle recovery allowance exhausted') from exc
                if dead:
                    restart()
                    summary['pi_process_restarts'] = summary.get('pi_process_restarts', 0) + 1
            except Exception:
                summary['idle_recovery_failures'] += 1
                raise
            if committed:
                return settled
            summary['idle_recoveries'] += 1
            message = _review_recovery(message) or (
                       'RECOVER TURN. The previous request stopped; the environment confirms no action was committed. '
                       'Continue the unfinished investigation using available tools and the current observation, '
                       'then submit one arc_action. Do not repeat completed writes or earlier actions.')
    raise AssertionError('unreachable')


def run_arc_thin_e2e(
    root: Path,
    *,
    arc_root: Path,
    game: str,
    variant: str = "treatment",
    max_actions: int | None = None,
    max_decisions: int | None = None,
    max_reported_tokens: int | None = None,
    experiment_timeout_seconds: float | None = None,
    consolidate_after_actions: int | None = None,
    review_on_miss: bool = False,
    max_no_action_decisions: int = 3,
    max_environment_failures: int = 2,
    decision_timeout_seconds: float = 900.0,
    turn_idle_timeout_seconds: float = 180.0,
    pi_provider: str = "yibu",
    pi_model: str | None = None,
    pi_api: str | None = None,
    thinking: str | None = "high",
    thinking_format: str | None = None,
    input_modalities: str | None = None,
    max_output_tokens: int | None = None,
    pi_provider_extension: Path | None = None,
    bridge_python: Path | None = None,
    bridge_module_paths: tuple[Path, ...] = (),
    ledger: bool = True,
    critic: bool = True,
    carry_reasoning_chars: int = 0,
    continuity: str = "rebuild",
    continuity_decisions: int = 8,
    review_at_level_change: bool | None = None,
    stall_review_after: int | None = None,
    spin_review_after: int | None = None,
    extension_env: dict[str, str] | None = None,
    foundation: str = "native",
    self_baseline: bool = False,
    self_convert: bool = False,
    replay_reasoning: bool = False,
    snapshot_after_decisions: tuple[int, ...] = (),
    snapshot_at_levels: tuple[int, ...] = (),
    max_levels: int | None = None,
    fork_from: Path | None = None,
    max_environment_restarts: int = MAX_ENVIRONMENT_RESTARTS,
    max_provider_errors: int = MAX_PROVIDER_ERRORS,
    max_provider_outage_seconds: float = MAX_PROVIDER_OUTAGE_SECONDS,
    provider_outage_backoff_seconds: float = OUTAGE_BACKOFF_SECONDS,
) -> Path:
    """Play one ARC game with the thin self-harness and write ``summary.json``.

    ``snapshot_after_decisions`` copies the run's state after those decisions to ``snapshots/after-decision-<k>``;
    ``fork_from`` starts a new run from such a snapshot (replaying its actions on a fresh environment), so arms of a
    comparison share the same prefix (docs/plans/2026-10-14-matched-prefix-evaluation.md). ``snapshot_at_levels``
    also snapshots after the decision that completed each of those levels, and ``max_levels`` stops the run once that
    many are completed: a source for forks from a level's start.

    When a step's outcome is unknown (or the bridge process ended), the next decision does not start on it: the runner
    starts a new game on the same port and action token, replays the recorded actions with every grid checked, and the
    next decision's prompt says so, at most ``max_environment_restarts`` times (0: the run stops, as before).
    A provider that ends ``max_provider_errors`` turns in a row with the same error and no action stops the run as
    ``provider_error`` (0: it keeps going, as before). A transport error (the gateway unreachable, not refusing) is
    waited out first, for up to ``max_provider_outage_seconds`` per run (0: counted at once, as before).

    ``carry_reasoning_chars`` is the opt-in comparison variable C1 of
    docs/plans/2026-10-10-self-harness-priority-plan.md; off by default. ``continuity="session"`` keeps the
    agent's last ``continuity_decisions`` decisions from Pi's session in view (without reasoning), and recoveries
    keep that session instead of starting a new one; ``"rebuild"`` is the original per-decision working set.
    ``review_at_level_change`` (default on; None reads ARC_THIN_LEVEL_REVIEW, where 0 turns it off) makes the turn after a
    level change a review without actions: in the native foundation the level review, in which the agent rewrites its
    prompts/lessons.md from the level's record (LEVEL_REVIEW_PROMPT, docs/plans/2026-10-20-level-review-lessons.md), in
    the legacy one the consolidation. Off, the GAME_OVER review (and the legacy 25-action one) remains; the agent's
    hypothesis checks then show on the new level's moves without a review turn
    (docs/plans/2026-10-12-falsifiable-self-harness-plan.md). A fork from the snapshot of a level-completing decision
    starts with that level's review.

    ``stall_review_after`` (native only; None reads ARC_THIN_STALL_REVIEW, else STALL_REVIEW_AFTER; 0 turns it off): once
    that many actions have been played without a level completed, counted from the level's first action or the last
    stall review, the next turn is a stall review without actions, in which the agent rewrites prompts/review.md from the
    record of the level so far (STALL_REVIEW_PROMPT, docs/plans/2026-10-20-stall-review.md). A level review comes first
    when both are due; a due stall review takes the place of the GAME_OVER consolidation.

    ``spin_review_after`` (work memory, docs/plans/2026-10-20-work-memory.md; native only; None reads
    ARC_THIN_SPIN_REVIEW, else SPIN_REVIEW_AFTER; 0 turns it off): once that many decisions in a row only played moves
    whose results the same board had already shown, the next turn is the stall review, saying so; the next one needs twice
    as many, until a decision learns something new."""
    if variant not in {"treatment", "control"}:
        raise ValueError("variant must be treatment or control")
    if foundation not in {"legacy", "native"}:
        raise ValueError("foundation must be legacy or native")
    if self_baseline and (foundation != "native" or variant != "treatment"):
        raise ValueError("self baseline requires the native treatment")
    if self_convert and not self_baseline:
        raise ValueError("self conversion layer requires the self baseline")
    if self_baseline:
        ledger = critic = review_on_miss = False
        review_at_level_change = False
        stall_review_after = spin_review_after = consolidate_after_actions = 0
    if foundation == "native":
        continuity = "session"
    consolidate_after_actions = _consolidation_interval(foundation, consolidate_after_actions)
    if decision_timeout_seconds < 0 or turn_idle_timeout_seconds < 0:
        raise ValueError('request fault timeouts must be nonnegative; 0 disables them')
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError(f"run root must be new or empty: {root}")
    root.mkdir(parents=True, exist_ok=True)
    harness = root / "harness"
    # fork_from: start from another run's snapshot (a matched prefix for comparisons). Its stores are copied, the bridge
    # replays its actions and checks every grid, and only what happens after the fork counts toward the token cap.
    fork = _seed_fork(root, Path(fork_from), game) if fork_from is not None else None
    budget_offset = fork["prefix_budget_tokens"] if fork else 0
    snapshot_after_decisions = tuple(int(d) for d in snapshot_after_decisions)
    snapshot_at_levels = tuple(int(level) for level in snapshot_at_levels)
    started = time.monotonic()
    # Explicit zero disables the experimental run deadline; None retains the historical default.
    deadline = math.inf if experiment_timeout_seconds == 0 else started + (experiment_timeout_seconds or OFFICIAL_MAX_RUNTIME_SECONDS)

    env = load_project_dotenv(PROJECT_ROOT)
    env.pop("PI_AUTORESEARCH_OWNS_TASK", None)  # never let PiKernel.close seal a legacy task scope
    review_at_level_change = _level_review_default(review_at_level_change, env)
    stall_review_after = _stall_review_after(foundation, stall_review_after, env) if variant == "treatment" else 0
    spin_review_after = _spin_review_after(foundation, spin_review_after, env) if variant == "treatment" else 0
    settings = resolve_model_settings(env)
    if max_output_tokens is not None:
        settings["max_tokens"] = max_output_tokens
    # The scripted smoke provider reads text only, as its scripts were written.
    settings["input_modalities"] = _input_modalities(
        "text" if input_modalities is None and pi_provider == "offline-arc-thin-smoke" else input_modalities, env)
    if thinking_format is not None:
        if thinking_format not in THINKING_FORMATS:
            raise ValueError(f"thinking_format must be one of {sorted(THINKING_FORMATS)}")
        settings["thinking_format"] = thinking_format
    # Use the bounded local projection by default; an explicitly selected Responses route can use stored continuation.
    settings["pi_api"] = _resolve_pi_api(
        settings, foundation, pi_api if pi_api is not None else env.get("ARC_PI_API"),
        thinking_format or env.get("ARC_PI_THINKING_FORMAT"))
    model = str(pi_model or settings["model"])
    resolved_format = _thinking_format_for_route(settings, pi_provider, model, thinking)
    if resolved_format:
        settings["thinking_format"] = resolved_format
    # A thinking level reaches an OpenAI-Completions gateway only through a declared format (Pi sends
    # nothing otherwise, and the provider's default applies). Twenty real runs of 2026-10-10/11 were
    # labelled "thinking: off" while the model reasoned for 85-95% of its output; record what is sent.
    thinking_sent = thinking is None or bool(settings.get("thinking_format")) or settings.get("pi_api") != "openai-completions"

    summary: dict[str, Any] = {
        "format": "arc-thin-run-v1", "game": game, "variant": variant,
        "provider": pi_provider, "model": model, "thinking": thinking or "provider-default",
        "thinking_format": settings.get("thinking_format"), "thinking_reaches_provider": thinking_sent,
        "passed": False, "stop_reason": None,
        "decisions": 0, "consolidations": 0, "level_reviews": 0, "stall_reviews": 0, "spin_reviews": 0, "no_action_decisions": 0,
        "length_stops": 0, "length_recoveries": 0, "length_recovery_failures": 0,
        "idle_timeouts": 0, "idle_recoveries": 0, "idle_recovery_failures": 0, "environment_restarts": [],
        "provider_errors": 0, "daemon_responses": 0,
        **({"fork": {key: fork[key] for key in ("source", "decision", "actions", "prefix_reported_tokens", "prefix_budget_tokens")}}
           if fork else {}),
    }
    stage = "bridge"
    startup_error: Exception | None = None
    ready: dict[str, Any] = {}
    for attempt in range(1, BRIDGE_START_ATTEMPTS + 1):
        bridge, bridge_stderr, launch_id, action_token = _start_bridge(
            root, arc_root=arc_root, game=game, max_actions=max_actions, env=env,
            bridge_python=bridge_python, bridge_module_paths=bridge_module_paths,
            replay_actions=fork["replay"] if fork else None,
        )
        try:
            # A fork's bridge plays the recorded actions before it is ready.
            ready = _wait_for_bridge(root, bridge, timeout=60.0 + (5.0 * fork["actions"] if fork else 0.0), launch_id=launch_id)
            startup_error = None
            break
        except Exception as exc:  # noqa: BLE001 - classified below, re-raised inside the run's error handling
            startup_error = exc
            error_file = root / "bridge-error.json"
            text = error_file.read_text(encoding="utf-8") if error_file.is_file() else str(exc)
            if attempt == BRIDGE_START_ATTEMPTS or not TRANSIENT_BRIDGE_START.search(text):
                break
            _stop_bridge(bridge, bridge_stderr, False)
            if error_file.is_file():
                error_file.replace(root / f"bridge-error-attempt{attempt}.json")
            summary.setdefault("bridge_start_retries", []).append(TRANSIENT_BRIDGE_START.search(text).group(0))
            time.sleep(15.0 * attempt)
    bridge_closed = False
    kernel: PiKernel | None = None
    trace = None
    final_state: dict[str, Any] | None = None
    try:
        if startup_error is not None:
            raise startup_error
        bridge_url = f"http://127.0.0.1:{int(ready['port'])}"
        if fork:
            used = ((_bridge_state(bridge_url) or {}).get("action_budget") or {}).get("total_used")
            if fork["total_used"] is not None and used != fork["total_used"]:
                raise RuntimeError(f"fork replay left the environment at {used} actions, the snapshot at {fork['total_used']}")

        stage = "pi"
        node, cli = _resolve_pi_cli()
        agent_dir = root / ".pi-agent"
        agent_dir.mkdir(parents=True, exist_ok=True)
        pi_env = dict(env)
        if max_reported_tokens is not None:
            # Reserve each provider request before it is sent. The reservation uses a deliberately conservative
            # UTF-8-byte upper bound for text plus the declared output envelope; usage settlement remains input+output.
            pi_env["PI_PROVIDER_MAX_REPORTED_TOKENS"] = str(max_reported_tokens)
            pi_env["PI_PROVIDER_CONTEXT_ADMISSION"] = "enabled"
            pi_env["PI_PROVIDER_REPORTED_ADMISSION"] = "enabled"
            pi_env["PI_PROVIDER_TOKEN_BUDGET_ROOT"] = str((root / "harness").resolve())
        if pi_provider_extension is None:
            if not settings["base_url"] or not settings["api_key"]:
                raise RuntimeError("define ARC_OPENAI_API_BASE/ARC_OPENAI_API_KEY or OPENAI_API_BASE/OPENAI_API_KEY")
            pi_env["OPENAI_API_BASE"] = str(settings["base_url"])
            pi_env["OPENAI_API_KEY"] = str(settings["api_key"])
            _write_models_json(agent_dir, pi_provider, model, settings)
        pi_env.update({
            "PI_CODING_AGENT_DIR": str(agent_dir),
            "PI_ARC_BRIDGE_URL": bridge_url,
            "PI_ARC_ACTION_TOKEN": action_token,
            "ARC_RUN_ROOT": str(root),
            "ARC_GAME": game,
            "ARC_THIN_VARIANT": variant,
        })
        if math.isfinite(deadline):
            pi_env['ARC_RUN_DEADLINE_MS'] = str(int((time.time() + max(0.0, deadline - time.monotonic())) * 1000))
        else:
            pi_env.pop('ARC_RUN_DEADLINE_MS', None)
        # Services to the agent's self-harness, on by default in the treatment variant; the critic needs the ledger.
        # Both are always stated explicitly, because the extension also defaults to enabled.
        ledger_enabled = (ledger or critic) and variant == "treatment"
        critic_enabled = critic and variant == "treatment"
        pi_env["ARC_HARNESS_LEDGER"] = "enabled" if ledger_enabled else "disabled"
        pi_env["ARC_HARNESS_CRITIC"] = "enabled" if critic_enabled else "disabled"
        carry_chars = max(0, int(carry_reasoning_chars)) if variant == "treatment" else 0
        if carry_chars:
            pi_env["ARC_THIN_CARRY_REASONING"] = str(carry_chars)
        if continuity not in CONTINUITY_MODES:
            raise ValueError(f"continuity must be one of {sorted(CONTINUITY_MODES)}")
        pi_env["ARC_THIN_CONTINUITY"] = continuity
        pi_env["ARC_THIN_CONTINUITY_DECISIONS"] = str(max(1, int(continuity_decisions)))
        pi_env["ARC_THIN_FOUNDATION"] = foundation
        pi_env["ARC_THIN_PARENT_OUTPUT_TOKENS"] = str(settings.get("max_tokens") or 0)
        pi_env["ARC_THIN_REPLAY_REASONING"] = "1" if replay_reasoning else "0"
        # Responses can continue from a stored response ID. Completions resends its local projection on every request;
        # bound that projection with the existing recent-reasoning, history-summary and exact-result-ref paths. The
        # complete Pi session remains on disk, and extension_env can override these defaults for comparison runs.
        stored_responses = settings["pi_api"] == "openai-responses"
        pi_env["ARC_THIN_RESPONSES_CONTINUATION"] = "1" if stored_responses else "0"
        pi_env["ARC_THIN_REASONING_MODE"] = "fields" if stored_responses else "recent"
        if not stored_responses and foundation == "native":
            pi_env.setdefault("ARC_THIN_NATIVE_HISTORY_CHARS", "12000")
            pi_env.setdefault("ARC_THIN_ARCHIVE_RESULTS", "1")
        # The scripted smoke provider's steps call the earlier arc_action ({action, x, y, then}); Continual Harness's
        # observation and action list (ARC_THIN_OBSERVATION=ch, the native default since 2026-10-20) are left to real runs
        # and unit tests.
        if pi_provider == "offline-arc-thin-smoke":
            pi_env.setdefault("ARC_THIN_OBSERVATION", "query")
        pi_env.update(extension_env or {})
        pi_env["ARC_THIN_SELF_BASELINE"] = "1" if self_baseline else "0"
        pi_env["ARC_THIN_SELF_CONVERT"] = "1" if self_convert else "0"
        native_treatment = foundation == "native" and variant == "treatment"
        daemon_enabled = native_treatment and not self_baseline and pi_env.get("ARC_THIN_DAEMON", "1") != "0"
        pi_env["ARC_THIN_DAEMON"] = "1" if daemon_enabled else "0"
        pi_env["ARC_THIN_PROCESS"] = "1" if native_treatment and not self_baseline and pi_env.get("ARC_THIN_PROCESS", "1") != "0" else "0"
        daemon = DaemonService(root) if daemon_enabled else None
        if daemon:
            attach_arc_monitors(daemon)
        # Native admission sees the full serialized request. Bound completed-decision history
        # before it can crowd out the current observation; an explicit run setting wins.
        if foundation == "native" and pi_env.get("PI_PROVIDER_CONTEXT_ADMISSION") == "enabled":
            pi_env.setdefault("ARC_THIN_NATIVE_HISTORY_CHARS", "12000")
        observation_delivery = pi_env.get("ARC_THIN_OBSERVATION", "ch") if foundation == "native" else "inline"
        if observation_delivery not in ("query", "inline", "ch"):
            raise ValueError("ARC_THIN_OBSERVATION must be query, inline or ch")
        if foundation == "native":
            pi_env["ARC_THIN_OBSERVATION"] = observation_delivery
        auto_compaction = continuity == "session" and pi_env.get("ARC_THIN_AUTO_COMPACTION", "1" if foundation == "native" else "0") == "1"
        command = [node, cli, "--mode", "rpc", "--provider", pi_provider, "--model", model,
                   *(["--session", str(root / "session.jsonl")] if foundation == "native" else ["--no-session"]),
                   "--no-extensions", "--no-skills", "--no-prompt-templates",
                   "--no-context-files", "--no-builtin-tools", "--extension", str(EXTENSION)]
        if pi_provider_extension is not None:
            command.extend(["--extension", str(pi_provider_extension.resolve())])
        if max_reported_tokens is not None:
            command.extend(["--extension", str((PROJECT_ROOT / "demo" / "pi_final_provider_payload.ts").resolve())])
        sources = sorted(EXTENSION.parent.glob("arc_thin_*.ts")) + sorted((EXTENSION.parent / "prompts").glob("arc_thin_*.md"))
        sources += [Path(__file__), Path(__file__).with_name("arc_thin_daemon.py"),
                    Path(__file__).with_name("daemon_service.py")]
        (root / "run-config.json").write_text(json.dumps({
            **{key: summary[key] for key in ("format", "game", "variant", "provider", "model", "thinking",
                                             "thinking_format", "thinking_reaches_provider")},
            "max_actions": max_actions, "max_decisions": max_decisions,
            "max_reported_tokens": max_reported_tokens, "token_cap_measure": "uncached_input+output",
            "experiment_timeout_seconds": experiment_timeout_seconds,
            "consolidate_after_actions": consolidate_after_actions, "review_on_miss": review_on_miss, "input_modalities": settings["input_modalities"],
            "max_output_tokens": settings.get("max_tokens"), "command": command,
            "pi_cli": cli, "pi_version": _pi_cli_version(Path(cli)),
            "ledger": ledger_enabled, "critic": critic_enabled,
            "daemon": daemon_enabled, "process_evidence": pi_env["ARC_THIN_PROCESS"] == "1",
            "self_baseline": self_baseline,
            "self_convert": self_convert,
            "turn_idle_timeout_seconds": turn_idle_timeout_seconds,
            "decision_timeout_seconds": decision_timeout_seconds,
            "max_continuous_idle_recoveries": 2,
            "carry_reasoning_chars": int(pi_env.get("ARC_THIN_CARRY_REASONING") or 0),
            "continuity": continuity, "continuity_decisions": int(pi_env["ARC_THIN_CONTINUITY_DECISIONS"]),
            "review_at_level_change": review_at_level_change, "stall_review_after": stall_review_after,
            "spin_review_after": spin_review_after, "work_memory": pi_env.get("ARC_THIN_WORK_MEMORY") != "0",
            # Where the active prompts are (docs/plans/2026-10-21-context-layout.md): "head" opens each decision's head
            # with them and ends it with the agent's own record on the board; "system" keeps them as system-prompt
            # sections (ARC_THIN_CONTEXT_LAYOUT=0, the legacy foundation and the control variant).
            "context_layout": "head" if foundation == "native" and variant != "control"
                and pi_env.get("ARC_THIN_CONTEXT_LAYOUT") != "0" else "system",
            "auto_compaction": auto_compaction,
            "foundation": foundation, "replay_reasoning": replay_reasoning,
            "observation_delivery": observation_delivery,
            # A run started from another run's snapshot (matched prefix): where from, and how much of it was replayed.
            "fork": summary.get("fork"), "snapshot_after_decisions": list(snapshot_after_decisions),
            "snapshot_at_levels": list(snapshot_at_levels), "max_levels": max_levels,
            "max_environment_restarts": max_environment_restarts, "max_provider_errors": max_provider_errors,
            "max_provider_outage_seconds": max_provider_outage_seconds,
            # Reasoning between tool rounds of the current decision: "all" (the Completions default), "fields" (the
            # Responses default: only the short <carry> block the agent writes is replayed) or "none" keep the projection
            # append-only for the provider's prefix cache; "recent" and result archiving rewrite earlier messages.
            "pi_api": settings["pi_api"],
            "responses_continuation": pi_env.get("ARC_THIN_RESPONSES_CONTINUATION") == "1",
            "decision_reasoning": foundation == "native" and pi_env.get("ARC_THIN_DECISION_REASONING", "1") != "0",
            "decision_reasoning_mode": pi_env.get("ARC_THIN_REASONING_MODE", "all") if foundation == "native" else None,
            "archive_results": foundation == "native" and pi_env.get("ARC_THIN_ARCHIVE_RESULTS", "0") == "1",
            # Python names defined in one call stay defined in later calls (native default on).
            "python_session": foundation == "native" and pi_env.get("ARC_THIN_PYTHON_SESSION", "1") != "0",
            # The session as a live kernel (2026-10-14): one sandbox instance keeps the namespace in memory and env.act
            # continues where it is called; off: a fresh sandbox per call restored from the checkpoint, acting replayed.
            "python_kernel": foundation == "native" and pi_env.get("ARC_THIN_PYTHON_SESSION", "1") != "0"
                             and pi_env.get("ARC_THIN_PYTHON_KERNEL", "1") != "0",
            # The working set lists what the python session holds.
            "session_view": foundation == "native" and pi_env.get("ARC_THIN_SESSION_VIEW", "1") != "0",
            # Native history: 0 (default since 2026-10-14) keeps earlier decisions as a transcript before the current head,
            # each earlier result clipped to result_chars; > 0 is a summarised section within that many characters
            # (demo/arc_thin_native_context.ts). Native decisions end at decision_tool_calls.
            "native_history": {"summary_chars": int(pi_env.get("ARC_THIN_NATIVE_HISTORY_CHARS", "0")),
                               "result_chars": int(pi_env.get("ARC_THIN_HISTORY_RESULT_CHARS", "5000")),
                               "decision_tool_calls": 16} if foundation == "native" else None,
            "source_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sources if path.is_file()},
        }, indent=2) + "\n", encoding="utf-8")

        trace = (root / "pi-events.jsonl").open("a", encoding="utf-8")
        extension_errors: list[dict[str, Any]] = []

        def persist(event: dict[str, Any]) -> None:
            kind = event.get("type")
            if foundation == 'native' and kind in {'rpc_control','agent_settled'}:
                with (root/'request-control.jsonl').open('a',encoding='utf-8') as control:
                    row = event if kind=='rpc_control' else dict(type=kind,monotonic_ms=time.monotonic()*1000)
                    control.write(json.dumps(dict(t=time.time(),**row))+'\n')
            if kind == "extension_error":
                extension_errors.append(event)
            if kind in PERSISTED_EVENTS:
                trace.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
                trace.flush()
            if daemon and kind in {"message_end", "tool_execution_end", "agent_end", "agent_settled"}:
                daemon.refresh()

        kernel = PiKernel(
            command, cwd=str(root), env=pi_env, timeout=120.0, deadline=deadline if math.isfinite(deadline) else None, event_sink=persist,
            event_projector=lambda event: None if event.get("type") == "message_update" else event,
        ).start()
        kernel.send("set_auto_compaction", enabled=auto_compaction)
        if foundation == 'native':
            pi_state = kernel.send('get_state').get('data', {})
            if pi_state.get('autoCompactionEnabled') is not auto_compaction:
                raise RuntimeError('Pi effective automatic compaction does not match requested configuration')
            effective = json.loads((root / 'run-config.json').read_text(encoding='utf-8'))
            effective['pi_auto_compaction_enabled'] = pi_state['autoCompactionEnabled']
            effective['pi_context_window'] = (pi_state.get('model') or {}).get('contextWindow')
            (root / 'run-config.json').write_text(json.dumps(effective, ensure_ascii=False, indent=2), encoding='utf-8')
        if thinking:
            kernel.send("set_thinking_level", level=thinking)

        stage = "loop"
        bridge_after = 0
        consolidated_at = 0
        # A fork from the snapshot of a level-completing decision starts with the review the source run had next.
        level_changed_since_consolidation = bool(fork and fork["level_changed"])
        # The action count at the last stall review (a fork keeps its source's, from the copied working-set log).
        stall_reviewed_at = max((int(row.get("actions") or 0) for row in _read_jsonl(harness / "working_set.jsonl")
                                 if row.get("stall_review")), default=0)
        # Work memory: decisions in a row that learn nothing new before the next stall review; doubles after each such
        # review, back to spin_review_after once a decision learns something new.
        spin_threshold = spin_review_after
        no_action_streak = 0
        environment_streak = 0
        provider_errors: list[str] = []
        # Seconds slept waiting out transport errors, and how many such waits in a row (MAX_PROVIDER_OUTAGE_SECONDS).
        outage_waited = 0.0
        outage_streak = 0

        def turn(message: str) -> list[dict[str, Any]]:
            response = kernel.prompt(message)
            if response.get("success") is False:
                raise RuntimeError(f"Pi rejected the prompt: {response.get('error')}")
            return kernel.wait_for_agent_events(
                timeout=min(decision_timeout_seconds or math.inf, max(1.0, deadline - time.monotonic())),
                idle_timeout=(min(turn_idle_timeout_seconds, decision_timeout_seconds or math.inf)
                              if turn_idle_timeout_seconds else None),
            )

        def safe_turn(message: str, *, allow_idle_recovery: bool = True) -> list[dict[str, Any]]:
            """Bound a provider/Pi turn that stops emitting events before settlement.

            Native retries are local to this call; the retained session and bridge
            remain authoritative. A dead Pi process reopens the same session file.
            """
            if foundation == 'native':
                before = len(_read_jsonl(harness / 'trajectory.jsonl'))
                def reconcile():
                    nonlocal bridge_after
                    health = _bridge_health(bridge_url)
                    if not health or health.get('status') not in {'ready', 'closed'}:
                        raise RuntimeError('environment outcome unknown: bridge is not ready after cancellation')
                    bridge_after = _sync_bridge_events(root, bridge_url, bridge_after)
                    return _reconciled_action(before, health, _bridge_state(bridge_url),
                                              len(_read_jsonl(harness / 'trajectory.jsonl')))
                def restart():
                    kernel.restart()
                    kernel.send('set_auto_compaction', enabled=auto_compaction)
                    if thinking:
                        kernel.send('set_thinking_level', level=thinking)
                return _recover_native_turn(turn, message, kernel, summary, reconcile,
                    max_recoveries=2 if allow_idle_recovery else 0,
                    settlement_timeout=min(30.0, max(1.0, deadline - time.monotonic())), restart=restart)
            try:
                return turn(message)
            except PiTurnIdleTimeout as exc:
                summary["idle_timeouts"] += 1
                if not allow_idle_recovery or summary["idle_recoveries"] >= 2 or time.monotonic() >= deadline - 5:
                    summary["idle_recovery_failures"] += 1
                    raise RuntimeError(str(exc)) from exc
                try:
                    kernel.abort()
                    # Pi acknowledges abort before its active turn has necessarily
                    # emitted agent_settled.  Wait for that native settlement before
                    # issuing new_session; otherwise the recovery prompt races the
                    # still-running provider request (P056 exposed this exact error).
                    kernel.wait_for_agent_events(timeout=min(30.0, max(1.0, deadline - time.monotonic())))
                    # Session continuity keeps the session: the aborted reply holds no committed action, and the
                    # extension leaves reasoning-only and unanswered calls out of the history it shows.
                    if continuity != "session":
                        kernel.new_session()
                    summary["idle_recoveries"] += 1
                    resumed = safe_turn(IDLE_RECOVERY_PROMPT, allow_idle_recovery=False)
                except Exception as recovery_error:
                    summary["idle_recovery_failures"] += 1
                    raise RuntimeError(f"idle-turn recovery failed: {recovery_error}") from recovery_error
                return resumed

        def length_stopped(events: list[dict[str, Any]]) -> bool:
            """Detect provider output truncation from the native Pi event stream."""
            for event in events:
                message = event.get("message")
                if isinstance(message, dict) and message.get("stopReason") == "length":
                    return True
            return False

        def recover_length(message: str, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
            """Rotate only the model session after length; durable harness state remains authoritative."""
            if not length_stopped(events):
                return events
            summary["length_stops"] += 1
            # A missing environment result must be reconciled before any model continuation reads /state.
            if _environment_errors(harness) > environment_before:
                return events
            if foundation == 'native' and len(_read_jsonl(harness / 'trajectory.jsonl')) > action_count:
                return events
            if time.monotonic() >= deadline - 5:
                return events
            if continuity != "session":
                kernel.new_session()
            summary["length_recoveries"] += 1
            recovery = _review_recovery(message) or (
                'RECOVER ACTION. The previous reply reached the provider output limit. Continue the unfinished '
                'step using the available tools and current observation; reuse suitable components. '
                'Do not repeat completed operations. Finish with an acting call (arc_action or Python env.act).' if foundation == 'native' else DECIDE_RECOVERY_PROMPT)
            resumed = safe_turn(recovery)
            if length_stopped(resumed):
                summary["length_recovery_failures"] += 1
            return resumed

        restart_note = ""

        def restart_environment(health: dict[str, Any] | None) -> None:
            """Replace an environment whose last step has no known outcome (or whose process ended) by a new game at the
            last recorded state. Pi is idle between decisions and keeps its bridge URL and token."""
            nonlocal bridge, bridge_stderr, bridge_after, restart_note
            began = time.monotonic()
            k = len(summary["environment_restarts"]) + 1
            cause = "process_ended" if bridge.poll() is not None else "outcome_unknown"
            try:
                bridge_after = _sync_bridge_events(root, bridge_url, bridge_after)
            except (OSError, ValueError):
                pass
            _stop_bridge(bridge, bridge_stderr, False)
            if bridge.poll() is None:
                bridge.wait(timeout=10)  # never two bridges on one port

            def set_aside(suffix: str) -> None:
                # Kept for the record; a handle the ended process still holds only delays the rename.
                for name in ("bridge-stderr.log", "bridge-error.json"):
                    for _ in range(10):
                        try:
                            if (root / name).is_file():
                                (root / name).replace(root / f"{Path(name).stem}-{suffix}{Path(name).suffix}")
                            break
                        except OSError:
                            time.sleep(0.5)

            set_aside(f"restart{k}")
            replay = root / f"restart-replay-{k}.jsonl"
            recorded = _write_replay(root, replay)
            expected = (recorded[-1].get("budget") or {}).get("total_used") if recorded else None
            port = int(bridge_url.rsplit(":", 1)[1])
            failures: list[str] = []
            for attempt in range(1, BRIDGE_START_ATTEMPTS + 1):
                bridge, bridge_stderr, launch, _ = _start_bridge(
                    root, arc_root=arc_root, game=game, max_actions=max_actions, env=env, bridge_python=bridge_python,
                    bridge_module_paths=bridge_module_paths, replay_actions=replay, port=port, action_token=action_token)
                try:
                    _wait_for_bridge(root, bridge, timeout=60.0 + 5.0 * len(recorded), launch_id=launch)
                    used = ((_bridge_state(bridge_url) or {}).get("action_budget") or {}).get("total_used")
                    if expected is not None and used != expected:
                        raise RuntimeError(f"the replay left the environment at {used} actions, the record at {expected}")
                    break
                except Exception as exc:  # noqa: BLE001 - retried, then raised with every attempt's reason
                    reason = f"{type(exc).__name__}: {exc}"
                    failures.append(reason[:500])
                    _stop_bridge(bridge, bridge_stderr, False)
                    if bridge.poll() is None:
                        bridge.wait(timeout=10)
                    set_aside(f"restart{k}-attempt{attempt}")
                    # A grid that did not repeat will not repeat on the next attempt either.
                    if attempt == BRIDGE_START_ATTEMPTS or "ReplayMismatch" in reason:
                        raise RuntimeError("environment restart failed: " + " | ".join(failures)) from exc
                    time.sleep(15.0 * attempt)
            # The new game's replay is on record already, as the actions it repeats; only the restart is added.
            fresh = _get_json(f"{bridge_url}/events?after=0")
            events = fresh.get("events") if isinstance(fresh.get("events"), list) else []
            bridge_after = int(fresh.get("next") or len(events))
            opened = next((event for event in events if isinstance(event, dict) and event.get("event") == "scorecard_opened"), {})
            error = (health or {}).get("error") or {}
            record = {"restart": k, "cause": cause, "after_action": len(recorded), "decisions": summary["decisions"],
                      "error": {key: error[key] for key in ("type", "message") if key in error},
                      "attempts": attempt, "failures": failures, "seconds": round(time.monotonic() - began, 1),
                      "scorecard_id": opened.get("scorecard_id")}
            _append_events(root, [{"event": "environment_restarted", **record}])
            summary["environment_restarts"].append(record)
            where = f"the state after action #{len(recorded)}, the last one recorded" if recorded else "the start of the game"
            restart_note = (f"(The environment stopped answering during an action and was restarted at {where}; that action "
                            "has an unknown outcome on the old scorecard; only confirmed actions were replayed.)" if cause == "outcome_unknown"
                            else f"(The environment's process ended; it was restarted at {where}.)")

        while True:
            admission_stop = _provider_admission_stop(harness)
            if admission_stop:
                summary.update(admission_stop)
                break
            state = _bridge_state(bridge_url)
            if state is None:
                health = _bridge_health(bridge_url)
                # Pi is idle here: a step whose outcome is unknown, or a bridge that ended, is replaced by a new game at the
                # last recorded state instead of ending the run.
                if len(summary["environment_restarts"]) < max_environment_restarts and (
                        (health or {}).get("status") == "uncertain" or bridge.poll() is not None):
                    try:
                        restart_environment(health)
                        continue
                    except Exception as exc:  # noqa: BLE001 - the run stops below with the reason on record
                        summary["environment_restart_error"] = f"{type(exc).__name__}: {exc}"[:2000]
                summary["bridge_health"] = health
                summary["stop_reason"] = (
                    "environment_outcome_unknown" if health and health.get("status") in {"uncertain", "busy"}
                    else "bridge_unavailable"
                )
                break
            final_state = state
            if str(state.get("state")) == "WIN":
                summary["stop_reason"] = "win"
                break
            if _arc_terminal_or_budget_exhausted(state):
                summary["stop_reason"] = "budget_exhausted"
                break
            if max_levels is not None and int(state.get("levels_completed") or 0) >= max_levels:
                summary["stop_reason"] = "max_levels"
                break
            if max_decisions is not None and summary["decisions"] >= max_decisions:
                summary["stop_reason"] = "max_decisions"
                break
            if max_reported_tokens is not None and _budget_tokens(harness) - budget_offset >= max_reported_tokens:
                summary["stop_reason"] = "token_cap"
                break
            if time.monotonic() >= deadline - 5:
                summary["stop_reason"] = "deadline"
                break
            if no_action_streak >= max_no_action_decisions:
                summary["stop_reason"] = "no_action_streak"
                break

            action_count = len(_read_jsonl(harness / "trajectory.jsonl"))
            # Optional (review_on_miss): a scored prediction miss is unrecorded evidence, so it makes a review due,
            # at most every REVIEW_ON_MISS_GAP actions. Mechanical: it reads the scores, never judges them.
            miss_due = review_on_miss and action_count - consolidated_at >= REVIEW_ON_MISS_GAP and any(
                (row.get("prediction") or {}).get("misses") or (row.get("skill_prediction") or {}).get("misses")
                for row in _read_jsonl(harness / "trajectory.jsonl")[consolidated_at:])
            # Many actions without a level completed make the agent's stall review due (stall_review_after).
            trajectory_now = _read_jsonl(harness / "trajectory.jsonl")
            stall_due = _stall_review_due(trajectory_now, stall_reviewed_at, stall_review_after)
            # Work memory: so do decisions in a row that only replayed results the same board had already shown.
            spin = _spin_streak(trajectory_now) if spin_review_after else (0, [])
            if spin[0] == 0:
                spin_threshold = spin_review_after
            spin_due = spin_review_after > 0 and spin[0] >= spin_threshold
            consolidate = variant == "treatment" and not self_baseline and action_count > consolidated_at and (
                (level_changed_since_consolidation and review_at_level_change)
                or str(state.get("state")) == "GAME_OVER"
                or miss_due
                or stall_due
                or spin_due
                or (consolidate_after_actions > 0 and action_count - consolidated_at >= consolidate_after_actions)
            )
            notification = daemon.refresh() if daemon else None
            response_turn = notification is not None
            task_turn = not consolidate and not response_turn
            fatal_before = _fatal_errors(harness)
            environment_before = _environment_errors(harness)
            error_rows_before = len(_read_jsonl(harness / "errors.jsonl"))
            errors_before = len(extension_errors)
            try:
                if response_turn:
                    events = recover_length(DAEMON_RESPONSE_PROMPT, safe_turn(DAEMON_RESPONSE_PROMPT))
                    summary["daemon_responses"] += 1
                    daemon.refresh()
                elif consolidate:
                    # After a level change the native foundation reviews the level (prompts/lessons.md); after many
                    # actions without one, or decisions that learned nothing new, the level so far (prompts/review.md);
                    # otherwise the consolidation prompt.
                    level_review = foundation == "native" and level_changed_since_consolidation and review_at_level_change
                    stall_review = not level_review and (stall_due or spin_due)
                    # A: process reasoning is available without a pending daemon notification.
                    review = (_level_review_prompt(int(state.get("levels_completed") or 0), include_process=True) if level_review
                              else _stall_review_prompt(trajectory_now, stall_reviewed_at, int(state.get("levels_completed") or 0),
                                                        spin if spin_due and not stall_due else None,
                                                        include_process=True) if stall_review
                              else CONSOLIDATE_PROMPT)
                    events = recover_length(review, safe_turn(review))
                    summary["consolidations"] += 1
                    if level_review:
                        summary["level_reviews"] += 1
                    elif stall_review:
                        summary["stall_reviews"] += 1
                        stall_reviewed_at = action_count
                        if spin_due:
                            summary["spin_reviews"] += 1
                            spin_threshold *= 2
                    consolidated_at = action_count
                    level_changed_since_consolidation = False
                else:
                    base_prompt = (NO_ACTION_PROMPT if no_action_streak else
                                   WINDOW_DECIDE_PROMPT if foundation == "native" and variant == "treatment" else
                                   DECIDE_PROMPT)
                    prompt = base_prompt + (f" {restart_note}" if restart_note else "")
                    restart_note = ""
                    events = recover_length(prompt, safe_turn(prompt))
                    summary["decisions"] += 1
                    new_rows = _read_jsonl(harness / "trajectory.jsonl")[action_count:]
                    if new_rows:
                        no_action_streak = 0
                        level_changed_since_consolidation |= any(row.get("level_changed") for row in new_rows)
                    # A decision the environment ended is not one without an action (environment_streak below).
                    elif _environment_errors(harness) == environment_before:
                        no_action_streak += 1
                        summary["no_action_decisions"] += 1
            except TimeoutError as exc:
                summary["stop_reason"] = "deadline" if time.monotonic() >= deadline - 5 else "decision_timeout"
                summary["error"] = str(exc)
                break
            except RuntimeError as exc:
                summary["stop_reason"] = "environment_outcome_unknown" if 'environment outcome' in str(exc) else "pi_failed"
                summary["error"] = str(exc)
                break
            finally:
                try:
                    bridge_after = _sync_bridge_events(root, bridge_url, bridge_after)
                except (OSError, ValueError):
                    pass
            if len(extension_errors) > errors_before:
                summary["stop_reason"] = "extension_error"
                summary["error"] = str(extension_errors[-1].get("error"))
                break
            new_errors = _read_jsonl(harness / "errors.jsonl")[error_rows_before:]
            health = _bridge_health(bridge_url) if any(row.get("environment") for row in new_errors) else None
            if _environment_failure_can_recover(new_errors, health):
                if len(summary["environment_restarts"]) < max_environment_restarts:
                    try:
                        restart_environment(health)
                        continue
                    except Exception as exc:  # noqa: BLE001 - preserve the failed recovery, never retry the unknown action
                        summary["environment_restart_error"] = f"{type(exc).__name__}: {exc}"[:2000]
                summary["bridge_health"] = health
                summary["stop_reason"] = "environment_outcome_unknown"
                break
            if _fatal_errors(harness) > fatal_before:
                summary["stop_reason"] = "harness_fatal"
                break
            # The extension ends a decision when the environment fails; stop instead of
            # spending further model turns once it fails in consecutive decisions.
            if _environment_errors(harness) > environment_before and len(_read_jsonl(harness / "trajectory.jsonl")) == action_count:
                environment_streak += 1
                if environment_streak >= max_environment_failures:
                    summary["stop_reason"] = "environment_error"
                    summary["error"] = str((_read_jsonl(harness / "errors.jsonl") or [{}])[-1].get("message"))
                    break
            else:
                environment_streak = 0
            # The same refusal three turns in a row: the provider will not answer this run again (MAX_PROVIDER_ERRORS).
            # A transport error is not a refusal: it is waited out first (MAX_PROVIDER_OUTAGE_SECONDS), and the decision
            # it cost is not counted as one the agent ended without an action.
            refusal = _provider_error(events) if len(_read_jsonl(harness / "trajectory.jsonl")) == action_count else None
            if refusal:
                summary["provider_errors"] += 1
            if _provider_capacity_error(refusal):
                summary["stop_reason"] = "provider_capacity"
                summary["error"] = _provider_capacity_summary(refusal)
                break
            admission_stop = _provider_admission_stop(harness)
            if admission_stop:
                summary.update(admission_stop)
                break
            outage = _outage_wait(refusal, waited=outage_waited, max_wait=max_provider_outage_seconds, streak=outage_streak,
                                  base=provider_outage_backoff_seconds)
            if outage and time.monotonic() + outage < deadline - 5:
                outage_streak += 1
                outage_waited += outage
                summary["provider_outage_seconds"] = round(outage_waited, 2)
                if task_turn and no_action_streak:
                    no_action_streak -= 1
                time.sleep(outage)
            else:
                outage_streak = 0
                provider_errors = [*provider_errors, refusal] if refusal else []
                if max_provider_errors and len(provider_errors) >= max_provider_errors \
                        and len(set(provider_errors[-max_provider_errors:])) == 1:
                    summary["stop_reason"] = "provider_error"
                    summary["error"] = refusal[:500]
                    break
            if response_turn and not refusal and daemon.refresh():
                summary["stop_reason"] = "daemon_response_incomplete"
                summary["error"] = "Maintenance response ended without daemon_reply; pending notification is preserved."
                break
            if task_turn and (summary["decisions"] in snapshot_after_decisions or any(
                    row.get("level_changed") and row.get("levels_completed") in snapshot_at_levels for row in new_rows)):
                # Pi is idle between turns: the session, harness stores, workspace and python session are consistent.
                summary.setdefault("snapshots", []).append(str(_snapshot_run(root, summary["decisions"], game, fork)))
            if summary["decisions"] and summary["decisions"] % PARTIAL_SUMMARY_EVERY == 0 and task_turn:
                _write_summary(root, summary, final_state, started, partial=True)
        latest = _bridge_state(bridge_url, attempts=1)
        if latest is not None:
            final_state = latest
        stage = "close"
        try:
            closed = _post_json(bridge_url + "/close", {}, timeout=60.0, action_token=action_token)
            events = closed.pop("events", [])
            if isinstance(events, list):
                # The cursor, not the file's length: after a restart the bridge's events begin with its new game.
                _append_events(root, events[bridge_after:])
            summary["bridge_close"] = closed
            summary['bridge_close_status'] = closed.get('close_status','closed')
            summary['scorecard_verified'] = closed.get('scorecard_verified',False)
            bridge_closed = True
        except (OSError, RuntimeError, ValueError) as exc:
            summary["bridge_close_error"] = str(exc)
            summary["bridge_health"] = _bridge_health(bridge_url)
        summary["passed"] = summary["stop_reason"] in NORMAL_STOPS
    except Exception as exc:  # noqa: BLE001 - persist every runner failure
        summary["stop_reason"] = summary["stop_reason"] or f"runner_error:{stage}"
        summary["error"] = f"{type(exc).__name__}: {exc}"
        (root / "runner-error.json").write_text(json.dumps({"error": summary["error"], "stage": stage},
                                                           indent=2) + "\n", encoding="utf-8")
    finally:
        if kernel is not None:
            stderr_tail = kernel.stderr_tail
            try:
                kernel.close()
            except Exception:  # noqa: BLE001 - shutdown must not mask the summary
                pass
            (root / "pi-stderr.log").write_text(stderr_tail, encoding="utf-8")
        if trace is not None:
            trace.close()
        _stop_bridge(bridge, bridge_stderr, bridge_closed)

    return _write_summary(root, summary, final_state, started)


def _write_summary(root: Path, summary: dict[str, Any], final_state: dict[str, Any] | None,
                   started: float, *, partial: bool = False) -> Path:
    """Write ``summary.json`` from the stores. ``partial`` marks a snapshot taken while the
    run continues, so a run killed from outside still leaves its statistics (two 2026-10-10
    runs were killed at 19 and 23 actions with no summary); the final write replaces it."""
    harness = root / "harness"
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    budget = (final_state or {}).get("action_budget") or {}
    out = dict(summary)
    out.update({
        "actions": len(trajectory),
        "actions_on_bridge": budget.get("total_used"),
        "final_state": (final_state or {}).get("state"),
        "levels_completed": (final_state or {}).get("levels_completed"),
        "win_levels": (final_state or {}).get("win_levels"),
        "reported_tokens": _reported_tokens(harness),
        "budget_tokens": _budget_tokens(harness),
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "harness": _harness_stats(harness),
        "updated_at": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    })
    requests = _read_jsonl(harness / 'request-events.jsonl')
    if requests:
        out['request_accounting'] = _request_accounting(requests)
        out['reported_tokens'] = out['request_accounting']['known_tokens_lower_bound']
        out['cost_status'] = 'reported' if out['request_accounting']['complete_cost_known'] else 'partial'
    if partial:
        out["partial"] = True
        out["stop_reason"] = out.get("stop_reason") or "running"
    path = root / "summary.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    if not partial:
        # Repetition overhead, component costs/replacement, total cost and task result, measured separately.
        try:
            from .arc_thin_reuse_report import write_report
            write_report(root)
        except Exception:  # diagnostic only; never fails a run
            pass
    return path


def _tool_names(row: dict[str, Any]) -> list[str]:
    return [str(tool.get("name") if isinstance(tool, dict) else tool) for tool in row.get("tools", [])]


def _run_skill_names(row: dict[str, Any]) -> list[str] | None:
    """The name enum of run_skill in one recorded request, or None when run_skill was not offered."""
    for tool in row.get("tools", []):
        if isinstance(tool, dict) and tool.get("name") == "run_skill":
            return list(((tool.get("parameters") or {}).get("properties") or {}).get("name", {}).get("enum") or [])
    return None


def run_arc_thin_self_baseline_smoke(root: Path, *, self_convert: bool = False, all_components: bool = False) -> Path:
    """Exercise the shortest Self path through the real runner, Pi and bridge with a scripted provider."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", foundation="native",
        self_baseline=True, self_convert=self_convert,
        max_decisions=2, max_actions=2, experiment_timeout_seconds=600.0,
        decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        extension_env={"ARC_THIN_SMOKE_SCRIPT": "self-components" if all_components else "self-baseline"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    run_root = root.resolve()
    requests = _read_jsonl(run_root / "smoke-requests.jsonl")
    components = _read_jsonl(run_root / ".harness" / "components.jsonl")
    runs = _read_jsonl(run_root / "harness" / "component_runs.jsonl")
    call_points = _read_jsonl(run_root / "harness" / "call_points.jsonl")
    memory = _read_jsonl(run_root / "harness" / "memory.jsonl")
    actions = _read_jsonl(run_root / "harness" / "trajectory.jsonl")
    config = json.loads((run_root / "run-config.json").read_text(encoding="utf-8"))
    results = [result for row in requests for result in row.get("last_tool_results", [])]
    checks = [
        ("fixed_self_entry", bool(requests) and all(
            len(entries := [line for line in str(row.get("current", "")).splitlines() if line.startswith("SELF:")]) == 1
            and len(entries[0]) <= 320 and entries[0].isascii()
            and "self_component" in entries[0] and "promote_session_function" in entries[0]
            for row in requests if not row.get("analyst") and not row.get("critic")), None),
        ("simple_tool_save_schema", any(tool.get("name") == "self_component"
            for row in requests for tool in row.get("tools", [])) and all(
            "kind" not in tool.get("parameters", {}).get("required", [])
            for row in requests for tool in row.get("tools", []) if tool.get("name") == "self_component"), None),
        ("post_save_feedback", any("SELF FEEDBACK: answer v1: 1 calls OK, 0 failed" in str(row.get("current"))
                                   for row in requests if not row.get("analyst") and not row.get("critic")), None),
        ("minimal_profile", config.get("self_baseline") is True and
         config.get("self_convert") is self_convert and
         not any(config.get(name) for name in ("ledger", "critic", "daemon", "process_evidence",
                                               "review_at_level_change", "stall_review_after", "spin_review_after")),
         {key: config.get(key) for key in ("self_baseline", "ledger", "critic", "daemon")}),
        ("direct_authoring", any(row.get("path") == "tools/answer.py" and row.get("by") == "agent"
                                 and not row.get("error") for row in components), components[-3:]),
        ("save_runs_now", any(result.get("tool") == "self_component" and "42" in str(result.get("text"))
                              for result in results), None),
        ("immediate_save_feedback", any(result.get("tool") == "self_component"
            and "SELF FEEDBACK: answer v1: not called yet" in str(result.get("text")) for result in results), None),
        ("immediate_call_feedback", any(result.get("tool") == "answer"
            and "SELF FEEDBACK: answer v1: 1 calls OK, 0 failed" in str(result.get("text")) for result in results), None),
        ("same_decision_saved_call",
         any(row.get("kind") == "tool" and row.get("path") == "tools/answer.py"
             and row.get("ok") and row.get("decision") == 1 for row in runs) and
         any(result.get("tool") == "answer" and "42" in str(result.get("text"))
             for result in results), [row for row in runs if row.get("path") == "tools/answer.py"]),
        ("task_continues", [row.get("action") for row in actions] == ["ACTION1", "ACTION2"],
         [row.get("action") for row in actions]),
        ("no_management_round", not any(row.get("consolidating") or row.get("critic")
                                        or (row.get("analyst") and not all_components)
                                        for row in requests), None),
        ("core_tools_only", bool(requests) and all(
            "refine" not in {tool.get("name") for tool in row.get("tools", [])}
            and (all_components or "consult" not in {tool.get("name") for tool in row.get("tools", [])})
            for row in requests), None),
    ]
    if not all_components:
        deliveries = _read_jsonl(run_root / "harness" / "convert.jsonl")
        checks.extend([
            ("prototype_extracted", any(result.get("tool") == "promote_session_function"
                and "source extracted; function not called or saved" in str(result.get("text"))
                and "session dependencies: none detected" in str(result.get("text")) for result in results), None),
            ("agent_convert_delivery", bool(deliveries) is self_convert and all(
                row.get("owner") == "agent" and row.get("path") == "notes/convert.md" for row in deliveries), deliveries),
            ("convert_in_decision", any("CONVERT (agent-authored; notes/convert.md):" in str(row.get("head"))
                for row in requests) is self_convert, None),
            ("convert_retired", (run_root / "workspace" / "notes" / "convert.md").read_text(encoding="utf-8") == "", None),
            ("no_host_guide", not (run_root / "workspace" / "data" / "convert.md").exists(), None),
        ])
    if all_components:
        saved = {row.get("path") for row in components if row.get("by") == "agent" and not row.get("error")}
        checks.extend([
            ("five_components_saved", {"tools/answer.py", "prompts/strategy.md", "skills/probe/SKILL.md",
                                       "agents/reviewer.md"}.issubset(saved)
             and any(row.get("key") == "probe_note" and row.get("text") for row in memory), sorted(saved)),
            ("prompt_next_decision", any("SELF_PROMPT_MARK" in str(row.get("latest_user")) for row in requests), None),
            ("skill_read", any(result.get("tool") == "read" and "SELF_SKILL_MARK" in str(result.get("text"))
                               for result in results), None),
            ("memory_read", any(result.get("tool") == "memory" and "probe_note" in str(result.get("text"))
                                for result in results), None),
            ("subagent_used", any(result.get("tool") == "consult" and "SUBAGENT_SEMANTIC_MARK: 42" in str(result.get("text"))
                                   for result in results)
             and any(row.get("kind") == "consult" and row.get("decision") == 1 for row in call_points), None),
            ("consult_available_after_save", any("consult" in {tool.get("name") for tool in row.get("tools", [])}
                                                 for row in requests), None),
            ("invalid_subagent_keeps_version", any(row.get("path") == "agents/reviewer.md" and row.get("error")
                                                   and row.get("good", {}).get("version") == 1 for row in components), None),
            ("skill_retired_after_use", any(row.get("path") == "skills/probe/SKILL.md" and row.get("retired")
                                            for row in components)
             and not (run_root / "workspace" / "skills" / "probe" / "SKILL.md").exists(), None),
        ])
    summary["checks"] = [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]
    summary["passed"] = all(check["ok"] for check in summary["checks"])
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = _read_jsonl(root / "smoke-requests.jsonl")
    agent = [row for row in requests if not row.get("analyst")]
    results = [result for row in requests for result in row.get("last_tool_results", [])]
    def result_text(tool: str) -> list[str]:
        return [str(result.get("text") or "") for result in results if result.get("tool") == tool]
    def last_result(row: dict[str, Any]) -> str:
        return str((row.get("last_tool_results") or [{}])[-1].get("text") or "")
    skill_rows = _read_jsonl(harness / "skills.jsonl")
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    decision_heads = [row for row in agent if not row.get("consolidating")]
    # The first request of decision 2 is the first agent request after the double arc_action.
    second_decision = next((row for row in decision_heads if row.get("message_count") == 1
                            and "count_color v1" in str(row.get("head"))), None)
    consolidation = [row for row in agent if row.get("consolidating")]
    memory_keys = {row.get("key") for row in _read_jsonl(harness / "memory.jsonl")}
    memory_results = list(dict.fromkeys(result_text("memory")))
    # Decision 3 is the first decision after consolidation.
    after_consolidation = next((str(row.get("head")) for row in decision_heads
                                if row.get("message_count") == 1 and "hyp.static" in str(row.get("head"))), "")
    fourth_decision = next((row for row in decision_heads if row.get("message_count") == 1
                            and "strat.probe [active" in str(row.get("head"))), None)
    lifecycle = (summary.get("harness") or {}).get("lifecycle") or {}
    # Skill call binding: run_skill is offered only for saved names.
    first_save = next((index for index, row in enumerate(agent)
                       if last_result(row).startswith("skill set count_color v1")), None)
    unbound = next((row for row in agent if any(result.get("tool") == "run_skill" and result.get("is_error")
                                                and 'Validation failed for tool "run_skill"' in str(result.get("text"))
                                                for result in row.get("last_tool_results", [])[-1:])), None)
    widened = next((row for row in agent if last_result(row).startswith("skill set scratch v1")), None)
    narrowed = next((row for row in agent if last_result(row).startswith("skill deleted scratch")), None)
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("skill_syntax_error_reported", any("not saved" in text and "SyntaxError" in text for text in result_text("skill")),
         result_text("skill")[:2]),
        ("skill_saved_v1", [(row.get("name"), row.get("version"), bool(row.get("deleted"))) for row in skill_rows]
         == [("count_color", 1, False), ("scratch", 1, False), ("scratch", 1, True)],
         [(row.get("name"), row.get("version"), bool(row.get("deleted"))) for row in skill_rows]),
        ("run_skill_hidden_before_save", first_save is not None and all(_run_skill_names(row) is None for row in agent[:first_save]),
         [_tool_names(row) for row in agent[:1]]),
        ("run_skill_bound_after_save", first_save is not None and _run_skill_names(agent[first_save]) == ["count_color"]
         and "run_skill(name=\"count_color\") is callable from your next step" in last_result(agent[first_save]),
         None if first_save is None else [_run_skill_names(agent[first_save]), last_result(agent[first_save])]),
        ("unregistered_name_schema_error", unbound is not None and unbound.get("message_count", 0) > 1
         and not unbound.get("consolidating") and bool((unbound.get("planned") or {}).get("calls"))
         and not any(row.get("name") == "bottom_row" for row in _read_jsonl(harness / "skill_runs.jsonl")),
         None if unbound is None else last_result(unbound)[:300]),
        ("delete_removes_name", widened is not None and _run_skill_names(widened) == ["count_color", "scratch"]
         and narrowed is not None and _run_skill_names(narrowed) == ["count_color"]
         and "run_skill(name=\"scratch\") is no longer callable" in last_result(narrowed),
         [None if widened is None else _run_skill_names(widened), None if narrowed is None else _run_skill_names(narrowed)]),
        ("run_skill_error_has_line", any("KeyError" in text and "line 3 in" in text for text in result_text("run_skill")),
         result_text("run_skill")[:1]),
        ("run_skill_ok", any('"count":' in text for text in result_text("run_skill")), result_text("run_skill")[1:2]),
        ("history_pruned_and_memory_shown", second_decision is not None and "controls.action1" in str(second_decision.get("head")),
         None if second_decision is None else str(second_decision.get("head"))[:400]),
        # The project shows the current grid and what the game reported, never a frame comparison or a
        # derived view of its own (docs/plans/2026-10-10-self-harness-priority-plan.md §10.9).
        ("no_runtime_frame_analysis", bool(agent) and not any(marker in str(row.get("head")) for row in agent for marker in (
            "PIXEL CHANGES", "MOVED", "LATEST ACTION", "changed_cells=", "Coarse color layout", "Uniform 2x2 pixel map")),
         [marker for row in agent for marker in ("PIXEL CHANGES", "MOVED", "LATEST ACTION", "changed_cells=", "Coarse color layout",
                                                 "Uniform 2x2 pixel map") if marker in str(row.get("head"))][:4]),
        ("current_grid_and_report_shown", second_decision is not None
         and "Lossless coordinate runs" in str(second_decision.get("head"))
         and "#1 ACTION1 → level_changed=false state=PLAYING" in str(second_decision.get("head")),
         None if second_decision is None else str(second_decision.get("head"))[-1600:]),
        ("overlay_in_system_prompt", any("SMOKE-OVERLAY" in str(row.get("system_prompt")) for row in agent), None),
        ("analyst_answered", any(row.get("analyst") for row in requests)
         and any("ANALYST:" in text for text in result_text("ask_analyst")), result_text("ask_analyst")[:1]),
        # The analyst is told which inputs it has, and the receipt says what the answer was based on.
        ("analyst_inputs_named", any(row.get("analyst") and "You see only the inputs listed under INPUTS" in str(row.get("system_prompt"))
                                     and str(row.get("head")).startswith("INPUTS: the current grid (before any action), the agent's memory. ")
                                     for row in requests)
         and any(text.endswith("(analyst saw only: the current grid (before any action), the agent's memory)") for text in result_text("ask_analyst")),
         [str(row.get("head"))[:200] for row in requests if row.get("analyst")][:1] + result_text("ask_analyst")[:1]),
        ("one_action_per_decision", [row.get("action") for row in trajectory] == ["ACTION1", "ACTION4", "ACTION3", "ACTION2"],
         [row.get("action") for row in trajectory]),
        ("bridge_matches_trajectory", summary.get("actions_on_bridge") == len(trajectory),
         [summary.get("actions_on_bridge"), len(trajectory)]),
        ("consolidation_ran", bool(consolidation) and all("arc_action" not in _tool_names(row) for row in consolidation)
         and "plan" in memory_keys and summary.get("consolidations") == 1, summary.get("consolidations")),
        ("memory_batch_without_op", any("set state_1, state_2" in text and "hyp.counter (new)" in text
                                        for text in memory_results), memory_results),
        ("memory_batch_atomic_refusal", any("memory NOT changed" in text and "action #999 does not exist" in text
                                            for text in memory_results) and "atomic_probe" not in memory_keys,
         sorted(key for key in memory_keys if key)),
        ("memory_prefix_delete_in_one_call", any("deleted 2 (state_1, state_2)" in text and "hyp.static (new +evidence #1 refutes)" in text
                                                 for text in memory_results), None),
        ("hypotheses_keep_scoped_evidence", all(part in after_consolidation for part in (
            "hyp.counter [open]", '#2 supports when "after ACTION1"', "hyp.static [rejected]",
            '#1 refutes when "first action of the game"', "last tested: #2 (0 actions ago) · next test: ACTION3"))
         and "state_1" not in after_consolidation, after_consolidation[:900]),
        # Hypothesis-strategy lifecycle (docs/plans/2026-10-09-thin-hypothesis-strategy-lifecycle.md).
        ("strategy_premise_rivals_on_commit", any("strat.track active; premises: hyp.mover [open] (rivals: hyp.counter [open], hyp.paint [open])"
                                                  in text and "skill:nope" in text for text in memory_results),
         [text for text in memory_results if "strat.track" in text][:1]),
        ("one_test_reports_unassessed_rival", any("tests #1 → hyp.counter supports" in text and "rivals not assessed by #1: hyp.mover" in text
                                                  and "no refutation was recorded: hyp.paint" in text for text in memory_results),
         [text for text in memory_results if "tests #1" in text][:1]),
        ("rejection_suspends_dependent_strategy", any("strat.track suspended; it uses skill:count_color, prompt" in text
                                                      and '"controls" still has hyp.counter [open] — rejecting hyp.mover does not confirm them' in text
                                                      for text in memory_results),
         [text for text in memory_results if "hyp.mover (" in text and "rejected" in text][:1]),
        ("revision_in_next_decision", all(part in after_consolidation for part in (
            "strat.track [suspended (hyp.mover rejected after #2), 2 actions spent]",
            "- after #2: hyp.mover rejected; strat.track suspended (hyp.mover rejected after #2). Active now: none. no action since.",
            "Linked, unchanged since: skill:count_color v1, prompt.",
            '- hyp.paint at #1 ("controls"), 0 result(s)', "[used by strat.track (suspended)]")), after_consolidation[:2400]),
        ("behaviour_after_revision_shown", fourth_decision is not None
         and "Active now: strat.probe. next 1: ACTION3×1 | 1 before: ACTION4×1." in str(fourth_decision.get("head")),
         None if fourth_decision is None else str(fourth_decision.get("head"))[:2400]),
        ("lifecycle_in_summary", (lifecycle.get("deleted_without_refutation") == 1
                                  and [(rev.get("at"), rev.get("next_actions"), rev.get("new_strategy_at")) for rev in lifecycle.get("revisions", [])]
                                  == [(2, ["ACTION3", "ACTION2"], 2)]), lifecycle),
        # Decision loop (docs/plans/2026-10-09-thin-decision-loop-efficiency.md): repaired arguments pass Pi's
        # schema, and results of tools batched with arc_action reach the next decision once.
        ("boundary_repairs_pass_schema", not any('Validation failed for tool "memory"' in text or 'Validation failed for tool "skill"' in text
                                                 for text in result_text("memory") + result_text("skill"))
         and any("+evidence #1 supports +evidence #1 supports" in text for text in memory_results),
         [text for text in memory_results if "tests #1" in text][:1]),
        ("batched_results_carried_once", fourth_decision is not None and all(part in str(fourth_decision.get("head")) for part in (
            "RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION:", "- memory: memory:", "strat.probe",
            "- memory FAILED: memory NOT changed", "hyp.nope does not exist", "hyp.probe2 [open] ACTION3 repeats"))
         and "RESULTS OF THE TOOLS" not in after_consolidation,
         None if fourth_decision is None else str(fourth_decision.get("head"))[:1800]),
        ("decision_loop_in_summary", ((summary.get("harness") or {}).get("decision_loop") or {}).get("batched_tool_results") == 3
         and ((summary.get("harness") or {}).get("decision_loop") or {}).get("batched_tool_failures") == 1,
         (summary.get("harness") or {}).get("decision_loop")),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_smoke(root: Path) -> Path:
    """Offline end-to-end check: mock ARC SDK, real bridge, real Pi, scripted provider.
    The ledger and critic are switched off here: this scenario checks the base path against exact text."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="legacy",
        max_decisions=4, consolidate_after_actions=2, experiment_timeout_seconds=600.0,
        decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        ledger=False, critic=False, extension_env={"ARC_THIN_EXPANDED_TOOLS": "enabled", "ARC_THIN_SCRIPTED_TOOL_BUDGET": "40"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _ledger_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = _read_jsonl(root / "smoke-requests.jsonl")
    agent = [row for row in requests if not row.get("analyst") and not row.get("critic")]
    heads = [str(row.get("head")) for row in agent if row.get("message_count") == 1]
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    observations = _read_jsonl(harness / "observations.jsonl")
    notes = [row for row in _read_jsonl(harness / "critic.jsonl") if row.get("kind") == "note"]
    shown = [head for head in heads if "CRITIC (independent review at #3" in head]
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("ideas_recorded", [row.get("idea") for row in trajectory] == ["move right"] * 3 + ["move left"] * 2,
         [row.get("idea") for row in trajectory]),
        ("long_legacy_expect_folded_and_clipped", len(str(trajectory[1].get("expect") if len(trajectory) > 1 else "")) == 300
         and len(str((trajectory[1].get("predict") or {}).get("text") if len(trajectory) > 1 else "")) == 300,
         len(str(trajectory[1].get("expect") if len(trajectory) > 1 else ""))),
        ("plain_predict_kept_as_text_not_scored", len(trajectory) > 3 and trajectory[3].get("expect") == "the 9 moves left"
         and "prediction" not in trajectory[3], trajectory[3].get("predict") if len(trajectory) > 3 else None),
        ("states_and_skill_observed", len(_read_jsonl(harness / "states.jsonl")) >= 5
         and sum(1 for row in observations if row.get("skill") == "pos" and row.get("ok")) >= 5,
         [len(_read_jsonl(harness / "states.jsonl")), len(observations)]),
        ("effort_line_shown", any("IDEAS: move right — 3 in a row (#1–#3)" in head for head in heads), None),
        ("expected_vs_observed_shown", any('LAST EXPERIMENT move right #1–#3: expected "the 9 moves right by one"' in head
                                           and "pos.value 2→5" in head for head in heads), None),
        ("critic_called_once", sum(1 for row in requests if row.get("critic")) == 1
         and any(row.get("kind") == "critic" for row in _read_jsonl(harness / "usage.jsonl")), None),
        # The critic is a service, not part of the agent's interface: its dossier keeps the frame facts
        # and derived views it was designed with, although the agent's own working set has none.
        ("critic_dossier_keeps_frame_facts", any(row.get("critic") and "changed_cells=" in str(row.get("head"))
                                                 and "Coarse color layout" in str(row.get("head")) for row in requests)
         and not any("changed_cells=" in head or "Coarse color layout" in head for head in heads), None),
        ("critic_citations_filtered", len(notes) == 1 and len(notes[0].get("lines") or []) == 1
         and any("#99" in line for line in notes[0].get("dropped") or [])
         and (notes[0].get("suggest") or {}).get("action") == "ACTION2", notes[:1]),
        ("critic_shown_once", len(shown) == 1 and "#99" not in shown[0] and "suggest: ACTION2" in shown[0],
         [head[-700:] for head in shown]),
        # The note answers one falsifying question in fields; it was called by a failure (the missed level change at #3).
        ("critic_structured_after_failure", len(notes) == 1 and str((notes[0].get("lines") or [""])[0]).startswith("goal contradicted: #3")
         and notes[0].get("targets") == ["goal"] and any("#3: the predicted level change did not happen" in str(t) for t in notes[0].get("triggers") or []),
         notes[:1]),
        ("actions_not_blocked", [row.get("action") for row in trajectory] == ["ACTION1", "ACTION4", "ACTION1", "ACTION3", "ACTION2"],
         [row.get("action") for row in trajectory]),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_ledger_smoke(root: Path) -> Path:
    """Offline ledger + critic wiring check: mock ARC SDK, real bridge, Pi, thin extension and WASI sandbox.
    No ledger or critic argument is passed: this is the default configuration."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="legacy",
        max_decisions=5, consolidate_after_actions=100, experiment_timeout_seconds=900.0,
        decision_timeout_seconds=240.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        extension_env={"ARC_THIN_SMOKE_SCRIPT": "ledger", "ARC_THIN_EXPANDED_TOOLS": "enabled",
                       "ARC_CRITIC_EXPERIMENT_MIN": "3", "ARC_CRITIC_MIN_GAP": "1"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _ledger_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _environment_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = [row for row in _read_jsonl(root / "smoke-requests.jsonl") if not row.get("analyst") and not row.get("critic")]
    planned_notes = [str(((row.get("planned") or {}).get("calls") or [[None, {}]])[-1][1].get("note")) for row in requests]
    environment = [row for row in _read_jsonl(harness / "errors.jsonl") if row.get("environment")]
    saved_memory = _read_jsonl(harness / "memory.jsonl")
    checks = [
        ("stopped_on_unknown_outcome", summary.get("stop_reason") == "environment_outcome_unknown", summary.get("stop_reason")),
        ("only_the_working_action_recorded", [row.get("action") for row in _read_jsonl(harness / "trajectory.jsonl")] == ["ACTION1"]
         and summary.get("actions_on_bridge") == 1, summary.get("actions_on_bridge")),
        # A failed decision ends at once: one model request per decision, and the spare step is never reached.
        ("no_retry_or_further_model_turn", len(requests) == 2 and all(row.get("message_count") == 1 for row in requests)
         and "must never be requested" not in planned_notes, [(row.get("message_count"), note) for row, note in zip(requests, planned_notes)]),
        ("environment_errors_logged", len(environment) == 1 and summary.get("harness", {}).get("environment_errors") == 1
         and all("EnvironmentReturnedNoFrame" in str(row.get("message")) for row in environment)
         and not any(row.get("fatal") for row in _read_jsonl(harness / "errors.jsonl")), environment[:2]),
        ("batched_update_survives_failed_action", any(row.get("key") == "plan" and row.get("text") == "keep probing"
         for row in saved_memory), saved_memory),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_environment_smoke(root: Path) -> Path:
    """Offline check that an environment failure ends the decision and stops the run without model retries."""
    previous = os.environ.get("MOCK_ARC_FAIL_AFTER")
    os.environ["MOCK_ARC_FAIL_AFTER"] = "1"  # read by tools/mock_arc_sdk in the bridge process
    try:
        path = run_arc_thin_e2e(
            root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="legacy",
            max_decisions=6, consolidate_after_actions=100, experiment_timeout_seconds=600.0,
            decision_timeout_seconds=180.0,
            pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
            bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
            ledger=False, critic=False, extension_env={"ARC_THIN_SMOKE_SCRIPT": "environment",
                                                       "ARC_THIN_EXPANDED_TOOLS": "enabled"},
            # The stop path; tools/run_fork_smoke.py part 5 checks the restart.
            max_environment_restarts=0,
        )
    finally:
        if previous is None:
            os.environ.pop("MOCK_ARC_FAIL_AFTER", None)
        else:
            os.environ["MOCK_ARC_FAIL_AFTER"] = previous
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _environment_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _skill_value(text: str) -> Any:
    """The JSON value of a run_skill result ("<name> v<n> →\\n<json>"), or None."""
    try:
        return json.loads(text.split("→\n", 1)[1])
    except (IndexError, ValueError):
        return None


def _self_harness_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    """What the model was actually sent (smoke-requests.jsonl) and what the stores and summary hold."""
    harness = root / "harness"
    requests = [row for row in _read_jsonl(root / "smoke-requests.jsonl") if not row.get("analyst") and not row.get("critic")]
    heads = [str(row.get("head")) for row in requests]
    head_of = lambda step: next((str(row.get("head")) for row in requests if row.get("step") == step), "")  # noqa: E731
    results = [result for row in requests for result in row.get("last_tool_results", [])]
    texts = lambda tool: [str(result.get("text") or "") for result in results if result.get("tool") == tool]  # noqa: E731
    harness_stats = summary.get("harness") or {}
    prediction = harness_stats.get("prediction") or {}
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    config = json.loads((root / "run-config.json").read_text(encoding="utf-8"))
    action_schema = next((tool for row in requests for tool in row.get("tools", [])
                          if isinstance(tool, dict) and tool.get("name") == "arc_action"), {})
    # The provider logs the script position after taking a step: step n is the request for script entry n-1.
    second, third, review = head_of(2), head_of(3), next((head for row, head in zip(requests, heads) if row.get("consolidating")), "")
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("variable_recorded", config.get("carry_reasoning_chars") == 200 and "moved" not in config, config.get("carry_reasoning_chars")),
        ("prediction_in_action_schema", {"predict", "predict_skill"} <= set(((action_schema.get("parameters") or {}).get("properties") or {})),
         sorted(((action_schema.get("parameters") or {}).get("properties") or {}))),
        # The project shows no frame comparison or derived view of its own.
        ("no_runtime_frame_analysis", bool(heads) and not any(marker in head for head in heads for marker in (
            "PIXEL CHANGES", "MOVED", "LATEST ACTION", "changed_cells=", "Coarse color layout", "Uniform 2x2 pixel map")),
         [marker for head in heads for marker in ("PIXEL CHANGES", "MOVED", "LATEST ACTION", "changed_cells=") if marker in head][:4]),
        # P1: the agent's prediction is checked against the result and shown with the action on the next decision.
        ("own_prediction_scored", "#1 ACTION1 → level_changed=false state=PLAYING" in second
         and re.search(r"\| note: test the rivals \| predicted: cells=1 predicted value\(s\)( \[\d+ as change\])? ok; level_changed=false ok", second) is not None,
         second[:1500]),
        # P2: a skill named as predictor runs before the action and is checked; a wrong agent prediction is a MISS.
        ("skill_prediction_scored", re.search(r"predicted: cells=1 predicted value\(s\)( \[\d+ as change\])? MISS \(saw 0/1 right; \(4,3\)=0\) "
                                              r"\| step v1 predicted: cells=1 predicted value\(s\)( \[\d+ as change\])? ok", third) is not None,
         third[:1800]),
        ("predictor_tally_in_skills", any("- step v1 — predicts the next move [as predictor: 2/2 fields right]" in head for head in heads),
         [head[:900] for head in heads[-1:]]),
        # C1 (opt-in here): the previous decision's reasoning is shown once.
        ("reasoning_carried_once", "YOUR REASONING AT THE PREVIOUS DECISION" in second and "SMOKE-REASONING-1" in second
         and "SMOKE-REASONING-1" not in third, second[-1600:]),
        # H1/H2: the test that told the rivals apart is counted; deleting the refuted rival reports its records.
        ("separating_test_counted", 'question "controls": 1 test(s) recorded, 1 told rivals apart (#1)' in third, third[:900]),
        # A memory call batched with arc_action reports at the next decision, under the carried results.
        ("deletion_receipt", any("deleted with: hyp.left 1 result(s), 1 refuting, 1 that told it apart from a rival" in head
                                 and "RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION" in head for head in heads)
         and not any("- hyp.left at #" in head for head in heads),
         [head[head.find("RESULTS OF THE TOOLS"):][:600] for head in heads if "deleted with" in head][:1]),
        # L1: the agent's own cross-frame tool, written on state["history"], returns the exact change of every action.
        ("agent_built_frame_diff", any(_skill_value(text) == [
            {"n": 1, "action": "ACTION1", "changed": [[0, 0, 0, 1], [2, 3, 9, 0], [3, 3, 0, 9]]},
            {"n": 2, "action": "ACTION2", "changed": [[0, 0, 1, 2], [2, 3, 0, 9], [3, 3, 9, 0]]}] for text in texts("run_skill")),
         texts("run_skill")[:1]),
        # C2: the review turn sees every action since the start.
        ("review_sees_all_actions", "ACTIONS SINCE YOUR LAST REVIEW (#1–#3, 3 of 3):" in review, review[:1500]),
        # D1: one working-set row per decision, with section sizes.
        ("working_set_logged", (harness_stats.get("working_set") or {}).get("decisions") == 5
         and (harness_stats.get("working_set") or {}).get("decisions_with_carried_reasoning", 0) >= 1, harness_stats.get("working_set")),
        ("summary_counts", prediction.get("actions_with_prediction") == 3 and prediction.get("by_skill") == {"step v1": {"hits": 2, "scored": 2}}
         and (harness_stats.get("history") or {}).get("skill_versions_reading_history") == ["changes v1"]
         and (harness_stats.get("lifecycle") or {}).get("deleted_with_rivals") == 1
         and (harness_stats.get("lifecycle") or {}).get("deleted_without_separating_test") == 0
         and harness_stats.get("ledger") is None,
         {key: harness_stats.get(key) for key in ("prediction", "history")}),
        ("states_recorded", [row.get("n") for row in _read_jsonl(harness / "states.jsonl")] == [0, 1, 2, 3, 4], None),
        # A skill's product is an artifact: stored with its producer and state, and read by a later skill.
        ("artifact_produced_and_read", any('{"x":2,"artifacts":["row3"]}' in text for text in texts("skill"))
         and any('{"nine_at":2,"from":"board"}' in text for text in texts("skill"))
         and [(row.get("name"), row.get("skill"), row.get("n")) for row in _read_jsonl(harness / "artifacts.jsonl")] == [("row3", "board", 2)],
         texts("skill")[-2:]),
        ("artifacts_listed", any("ARTIFACTS (" in head and "- row3: " in head and "from board v1 on state #2 (1 action(s) ago)" in head
                                 for head in heads), None),
        # The active strategy's planned steps are matched against the moves taken; no progress fact is written.
        ("plan_steps_tracked", any("steps planned after #2: 1/3 followed; next ACTION3, ACTION1" in head for head in heads), None),
        ("resources_shown", any("RESOURCES: " in head and "of run time left" in head for head in heads), None),
        ("actions", [row.get("action") for row in trajectory] == ["ACTION1", "ACTION2", "ACTION4", "ACTION3"], [row.get("action") for row in trajectory]),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_self_harness_smoke(root: Path) -> Path:
    """Offline check of predictions, predictor skills, an agent-written frame-diff tool on history, the working-set
    log, the separating-test counts, the review window and the opt-in carried reasoning: mock ARC SDK, real bridge,
    Pi, thin extension and sandbox."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="legacy",
        max_decisions=4, consolidate_after_actions=3, experiment_timeout_seconds=600.0,
        decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        carry_reasoning_chars=200, ledger=False, critic=False,
        extension_env={"ARC_THIN_SMOKE_SCRIPT": "selfharness", "ARC_THIN_EXPANDED_TOOLS": "enabled"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _self_harness_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _continuity_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    """What the model was sent at the first request of each decision, with one earlier decision kept in view."""
    harness = root / "harness"
    requests = [row for row in _read_jsonl(root / "smoke-requests.jsonl") if not row.get("analyst") and not row.get("critic")]
    firsts = [row for row in requests if (row.get("transcript") or [{}])[-1].get("role") == "user"]
    transcript = lambda row: row.get("transcript") or []  # noqa: E731
    assistants = lambda row: [item for item in transcript(row) if item.get("role") == "assistant"]  # noqa: E731
    second = firsts[1] if len(firsts) > 1 else {}
    third = firsts[2] if len(firsts) > 2 else {}
    calls = [call for item in assistants(second) for call in item.get("calls") or []]
    config = json.loads((root / "run-config.json").read_text(encoding="utf-8"))
    budget = _read_jsonl(harness / "context_budget.jsonl")
    last_text = str(transcript(second)[-1].get("text")) if transcript(second) else ""
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("continuity_recorded", config.get("continuity") == "session" and config.get("continuity_decisions") == 1,
         {key: config.get(key) for key in ("continuity", "continuity_decisions")}),
        ("first_decision_has_no_history", bool(firsts) and len(transcript(firsts[0])) == 1, len(transcript(firsts[0])) if firsts else None),
        # Decision 2 sees decision 1: its prompt, the agent's text and calls, and their receipts, ahead of the working set.
        ("second_sees_first", [item.get("role") for item in transcript(second)] == ["user", "assistant", "toolResult", "toolResult", "user"]
         and any("SMOKE-CONTINUITY-1" in str(item.get("text")) for item in assistants(second))
         and [call.get("name") for call in calls] == ["skill", "arc_action"],
         [item.get("role") for item in transcript(second)]),
        # A skill's source is replaced by its size in the history; reasoning blocks never appear.
        ("history_compacted", any(str((call.get("arguments") or {}).get("source", "")).startswith("<") for call in calls)
         and not any("thinking" in (item.get("blocks") or []) for row in firsts for item in assistants(row)),
         calls[:1]),
        ("working_set_last", "HYPOTHESES" in last_text and "Decide the next action." in last_text, last_text[:200]),
        # Decision 3 keeps only decision 2 and says one earlier decision is not shown.
        ("window_limited", "1 earlier decision not shown" in str(transcript(third)[0].get("text") if transcript(third) else "")
         and any("SMOKE-CONTINUITY-2" in str(item.get("text")) for item in assistants(third))
         and not any("SMOKE-CONTINUITY-1" in str(item.get("text")) for item in assistants(third)),
         [item.get("text") for item in transcript(third)][:2]),
        ("history_logged", any(int(row.get("history_messages") or 0) > 0 for row in budget), budget[-1:]),
        ("actions", [row.get("action") for row in _read_jsonl(harness / "trajectory.jsonl")] == ["ACTION1", "ACTION3", "ACTION4"],
         [row.get("action") for row in _read_jsonl(harness / "trajectory.jsonl")]),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_continuity_smoke(root: Path) -> Path:
    """Offline check of session continuity: mock ARC SDK, real bridge, Pi, thin extension, scripted provider."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="legacy",
        max_decisions=3, consolidate_after_actions=100, experiment_timeout_seconds=600.0,
        decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        ledger=False, critic=False, continuity="session", continuity_decisions=1,
        extension_env={"ARC_THIN_SMOKE_SCRIPT": "continuity"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _continuity_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _guard_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = [row for row in _read_jsonl(root / "smoke-requests.jsonl") if not row.get("analyst") and not row.get("critic")]
    reviews = [row for row in requests if row.get("consolidating")]
    audit = next((str(row.get("head") or "") for row in reviews
                  if "action guards checked 2" in str(row.get("head") or "")), "")
    guard_rows = _read_jsonl(harness / "guard_runs.jsonl")
    admission_rows = _read_jsonl(harness / "provider-window-admission.jsonl")
    provider_budget = _read_jsonl(harness / "provider-token-budget.jsonl")
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    component_rows = _read_jsonl(root / ".harness" / "components.jsonl")
    source = root / "workspace" / "tools" / "action_guard.py"
    checks = [
        ("run_completed_after_two_actions", summary.get("stop_reason") == "max_decisions"
         and summary.get("decisions") == 3 and len(trajectory) == 2,
         {"stop_reason": summary.get("stop_reason"), "decisions": summary.get("decisions"), "actions": len(trajectory)}),
        ("review_created_saved_guard", source.exists() and any(row.get("path") == "tools/action_guard.py"
         and row.get("version") == 1 and row.get("level") == 0 for row in component_rows),
         {"source_exists": source.exists(), "bindings": [row for row in component_rows if row.get("path") == "tools/action_guard.py"]}),
        ("guard_refused_before_environment_and_allowed_changed_action",
         [row.get("action") for row in trajectory] == ["ACTION1", "ACTION4"]
         and len(guard_rows) == 2 and sum(row.get("sent") is False for row in guard_rows) == 1
         and sum(row.get("sent") is True for row in guard_rows) == 1
         and bool(trajectory[1].get("after_guard_refusal", {}).get("changed")),
         {"actions": [row.get("action") for row in trajectory], "guard_runs": guard_rows,
          "after_refusal": trajectory[1].get("after_guard_refusal") if len(trajectory) > 1 else None}),
        ("next_review_received_mechanical_loop_audit",
         "action guards checked 2" in audit and "refused 1" in audit
         and "next action changed after refusal 1 time(s)" in audit
         and "#2 ACTION1: refused" in audit and "#2 ACTION4: allowed" in audit,
         audit[:1600]),
        ("provider_cap_admits_and_settles_each_request",
         bool(admission_rows) and all(row.get("status") == "admitted" for row in admission_rows)
         and any(row.get("event") == "reported_usage" for row in provider_budget)
         and int(summary.get("budget_tokens") or 0) <= 100_000,
         {"admissions": len(admission_rows), "statuses": [row.get("status") for row in admission_rows],
          "budget_events": len(provider_budget), "budget_tokens": summary.get("budget_tokens")}),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_guard_smoke(root: Path) -> Path:
    """Offline native lifecycle check: stall review writes a guard, the action boundary enforces it, and the next
    review receives action/refusal feedback. Uses the real Pi, runner and bridge with a mock ARC SDK and scripted model."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="native",
        max_decisions=3, max_actions=3, consolidate_after_actions=100, stall_review_after=1,
        max_reported_tokens=100_000,
        experiment_timeout_seconds=600.0, decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        ledger=False, critic=False, extension_env={"ARC_THIN_SMOKE_SCRIPT": "guard", "ARC_THIN_REVIEW_CONSULT": "0"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _guard_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _claims_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    """Hypothesis checks run over history at save and on each new move; one-off python returns output and a value."""
    harness = root / "harness"
    requests = [row for row in _read_jsonl(root / "smoke-requests.jsonl") if not row.get("analyst") and not row.get("critic")]
    results = [result for row in requests for result in row.get("last_tool_results", [])]
    texts = lambda tool: [str(result.get("text") or "") for result in results if result.get("tool") == tool]  # noqa: E731
    heads = [str(row.get("head") or "") for row in requests]
    memory_receipt = next((text for text in texts("memory") if "hyp.right" in text), "")
    checks_rows = _read_jsonl(harness / "claim_checks.jsonl")
    by_key = lambda key: [row for row in checks_rows if row.get("key") == key and "result" in row]  # noqa: E731
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        # At save the checks ran over the one recorded move: right holds, wrong fails at #1, broken is reported.
        ("checked_at_save", "hyp.right check on 1 recorded move(s): holds 1 · fails 0" in memory_receipt
         and "hyp.wrong check on 1 recorded move(s): holds 0 · fails 1 (#1)" in memory_receipt
         and "hyp.broken check: not usable (SyntaxError" in memory_receipt, memory_receipt[-600:]),
        # One-off python: printed output and the final expression's value, nothing saved.
        ("python_one_off", any("nine at 3" in text and "→ 4" in text for text in texts("python"))
         and not _read_jsonl(harness / "skills.jsonl"), texts("python")[:1]),
        # After the second move (ACTION4) the right check does not apply to it; the view shows the updated record.
        ("checked_on_new_moves", any("check on 2 recorded move(s): holds 1 · fails 0 · n/a 1" in head for head in heads),
         [head[:900] for head in heads[-1:]]),
        # #1 at save, #2 when the third decision starts (the run stops before #3 is checked).
        ("stored_as_evidence", [row.get("result") for row in by_key("hyp.right")] == [True, None]
         and [row.get("result") for row in by_key("hyp.wrong")] == [False, None]
         and any(row.get("key") == "hyp.broken" and row.get("compile_error") for row in checks_rows),
         [(row.get("key"), row.get("n"), row.get("result", row.get("compile_error"))) for row in checks_rows]),
        ("python_logged", [row.get("ok") for row in _read_jsonl(harness / "python_runs.jsonl")] == [True], None),
        ("actions", [row.get("action") for row in _read_jsonl(harness / "trajectory.jsonl")] == ["ACTION1", "ACTION4", "ACTION1"],
         [row.get("action") for row in _read_jsonl(harness / "trajectory.jsonl")]),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_claims_smoke(root: Path) -> Path:
    """Offline check of hypothesis checks and one-off python: mock ARC SDK, real bridge, Pi, extension and sandbox."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment", foundation="legacy",
        max_decisions=3, consolidate_after_actions=100, experiment_timeout_seconds=600.0,
        decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        ledger=False, critic=False, extension_env={"ARC_THIN_SMOKE_SCRIPT": "claims"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _claims_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
