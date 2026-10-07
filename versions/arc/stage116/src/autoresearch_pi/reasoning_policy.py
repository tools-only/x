"""Opt-in provider capability policy; never treats a short CoT as task quality."""
import hashlib
import json
SUPPORTED_LEVELS = ("off", "minimal", "low", "medium", "high", "xhigh")


def consumed_opportunity_keys(opportunity):
    """Consume the whole batch only after a completed assistant turn."""
    if opportunity.startswith("geometry-batch:"):
        _, level, facts = opportunity.split(":", 2)
        return {opportunity, *(f"geometry-fact:{level}:{fact}" for fact in json.loads(facts))}
    return {opportunity}


def validate_reasoning_options(policy, levels, max_output_tokens):
    if policy not in {"provider-default", "adaptive", "adaptive-binary", "adaptive-evidence"}:
        raise ValueError("reasoning_policy must be provider-default, adaptive, adaptive-binary or adaptive-evidence")
    if any(level not in SUPPORTED_LEVELS for level in levels):
        raise ValueError("reasoning_levels must name supported Pi effort levels")
    if max_output_tokens is not None and (type(max_output_tokens) is not int or max_output_tokens < 1):
        raise ValueError("max_output_tokens must be a positive integer")
    if policy == "adaptive-binary" and ("off" not in levels or not any(level != "off" for level in levels)):
        raise ValueError("adaptive-binary requires verified off and enabled reasoning levels")
    if policy == "adaptive-evidence" and not {"low", "medium"}.issubset(levels):
        raise ValueError("adaptive-evidence requires explicitly verified low and medium levels")


def evidence_reasoning_opportunity(checkpoint, state, consumed_opportunities=None):
    """Use low follow-through without an active-plan prerequisite.

    RESET changes the board, not the existence of earlier observed operations.
    Keep their compute identity until a real level transition. This assigns
    effort only and never infers that an operation or goal has been solved.
    """
    actions = [a for a in checkpoint.get("recent_actions", []) if isinstance(a, dict)
               and isinstance(a.get("changed_cells"), (int, float))]
    boundary = next((i for i in range(len(actions)-1,-1,-1) if actions[i].get("level_changed")), -1)
    active = [a for a in actions[boundary+1:] if a.get("action") != "RESET"]
    level = actions[-1].get("level_after", "unknown") if actions else "unknown"
    geometry = state.get("geometry_evidence") or {}
    prior = consumed_opportunities or set()
    if actions and geometry.get("level") == level and isinstance(geometry.get("facts"), list):
        facts = sorted({hashlib.sha256(fact.encode()).hexdigest()[:24]
                        for fact in geometry["facts"] if isinstance(fact, str)})
        unseen = [fact for fact in facts if f"geometry-fact:{level}:{fact}" not in prior]
        if unseen:
            return f"geometry-batch:{level}:" + json.dumps(unseen, separators=(",", ":")), "new_exact_geometry_evidence"
    epoch = f"level-{level}" if boundary < 0 else f"level-{actions[boundary].get('observation_id', boundary)}"
    # Allocation identity is separate from the model's complete working state.
    # Prose revisions are not new evidence; keep all such prose in its context.
    normalized = {**checkpoint, "recent_actions": active,
                  "decision_state": {**(checkpoint.get("decision_state") or {}), "counterevidence": []}}
    plan = state.get("plan") or {}
    plan_identity = {key: plan[key] for key in (
        "plan_id", "candidate_id", "candidate_version", "current_step",
        "needs_reconciliation", "needs_assessment", "experiment_outcome_ref",
    ) if key in plan}
    outcome = plan.get("last_step_outcome") or {}
    if outcome:
        plan_identity["last_step_outcome"] = {key: outcome[key] for key in (
            "status", "observation_ref", "validation_ref",
        ) if key in outcome}
    allocation_state = {**state, "plan": plan_identity,
                        "candidates": sorted(state.get("candidates") or [],
                                             key=lambda c: (str(c.get("id")), str(c.get("version"))))}
    # The existing event policy supplies sparse effect/no-progress and explicit
    # challenge opportunities. Replace its reset epoch with this level identity.
    prior = consumed_opportunities or set()
    adapted = {key.replace(f":{epoch}:", ":initial:") for key in prior}
    opportunity, reason = binary_reasoning_opportunity(normalized, allocation_state, adapted)
    if opportunity == "initial-discovery" and actions:
        if boundary >= 0 and not active:
            return f"level:{epoch}", "new_level"
        return None, "bounded_followthrough"
    if opportunity:
        opportunity = opportunity.replace(":initial:", f":{epoch}:")
    return opportunity, reason


def binary_reasoning_opportunity(checkpoint, state, consumed_opportunities=None):
    """Compute allocation from exact public events/explicit challenges, not guessed game rules.

    Stable opportunity identities allow one deep planning turn per evidence batch.
    No action is required, blocked, selected or declared progress by this policy.
    """
    actions = [a for a in checkpoint.get("recent_actions", []) if isinstance(a, dict)
               and isinstance(a.get("changed_cells"), (int, float))]
    boundary = next((i for i in range(len(actions) - 1, -1, -1)
                     if actions[i].get("action") == "RESET" or actions[i].get("level_changed")), -1)
    epoch = str(actions[boundary].get("observation_id", boundary)) if boundary >= 0 else "initial"
    active = actions[boundary + 1:]
    consumed = consumed_opportunities or set()
    plan = state.get("plan") or {}
    challenges = [(c.get("id"), c.get("version")) for c in state.get("candidates", [])
                  if c.get("status") == "challenged"]
    counter = (checkpoint.get("decision_state") or {}).get("counterevidence")
    if plan.get("needs_reconciliation") or plan.get("needs_assessment") or challenges or counter:
        digest = hashlib.sha256(json.dumps({"plan": plan, "challenges": challenges, "counter": counter},
                                          sort_keys=True).encode()).hexdigest()[:16]
        key = f"challenge:{epoch}:{digest}"
        if key not in consumed:
            return key, "explicit_counterevidence_or_plan_failure"
    if not actions:
        return "initial-discovery", "initial_discovery"
    if boundary >= 0 and not active and actions[boundary].get("level_changed"):
        return f"level:{epoch}", "new_level"
    positive = next((a for a in active if a.get("changed_cells", 0) > 0), None)
    if positive:
        key = f"first-effect:{epoch}:{positive.get('observation_id')}"
        if key not in consumed:
            return key, "first_persistent_visual_effect_planning"
        visible = sum(a.get("changed_cells", 0) > 0 for a in active)
        if visible >= 4:
            milestone = 2 ** (visible.bit_length() - 1)
            key = f"visible-without-level:{epoch}:{milestone}"
            if key not in consumed:
                return key, "visible_effects_without_level_transition"
    # Reconsider silent exploration at sparse evidence milestones. This is a
    # compute opportunity, never proof that coordinates/regions were exhausted.
    if not positive and len(active) >= 2:
        milestone = 2 ** (len(active).bit_length() - 1)
        return f"silent:{epoch}:{milestone}", "silent_probe_reconsideration"
    return None, "bounded_followthrough"


def select_reasoning_level(checkpoint, state, policy, levels, consumed_opportunities=None):
    if policy == "provider-default":
        return None, "provider_default"
    if not levels:
        return None, "capability_unavailable"
    if policy == "adaptive-evidence":
        opportunity, reason = evidence_reasoning_opportunity(checkpoint, state, consumed_opportunities)
        if opportunity and opportunity not in (consumed_opportunities or set()):
            return "medium", reason
        return "low", "bounded_followthrough"
    if policy == "adaptive-binary":
        opportunity, reason = binary_reasoning_opportunity(checkpoint, state, consumed_opportunities)
        if opportunity and opportunity not in (consumed_opportunities or set()):
            enabled = "medium" if "medium" in levels else next(level for level in levels if level != "off")
            return enabled, reason
        return "off", "bounded_followthrough"
    plan = state.get("plan") or {}
    decision = checkpoint.get("decision_state") or {}
    challenged = plan.get("needs_reconciliation") or plan.get("needs_assessment") or any(
        c.get("status") == "challenged" for c in state.get("candidates", [])
    ) or decision.get("counterevidence")
    if challenged:
        target, reason = "high", "counterevidence_or_reconciliation"
    elif (plan.get("status") == "active" and plan.get("last_step_outcome", {}).get("status") == "matched"
          and not (checkpoint.get("planning_gap") and "planning_gap" not in
                   (checkpoint.get("reasoning_state") or {}).get("stale_fields", []))) and not any(
        not isinstance(gap, dict) or gap.get("status", "unresolved") != "resolved"
        for gap in decision.get("knowledge_gaps", [])
    ):
        target, reason = "low", "checked_execution"
    else:
        target, reason = "medium", "discovery"
    if target in levels:
        return target, reason
    # Select only an operator-declared capability; never manufacture an API field.
    available = [level for level in SUPPORTED_LEVELS if level in levels]
    above = [level for level in available if SUPPORTED_LEVELS.index(level) >= SUPPORTED_LEVELS.index(target)]
    return (above[0] if above else available[-1]), reason
