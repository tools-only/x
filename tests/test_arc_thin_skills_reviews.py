"""The reviews of ARC_THIN_SKILLS=1 in the runner (docs/plans/2026-10-21-components-by-default-canonical-forms.md, S3(b)):
a skill for the procedure, memory for the findings, and a prompt file that keeps only the test lines the runtime pins."""
from autoresearch_pi import arc_thin_e2e as runner

NEEDLE = "skills/<name>/SKILL.md"


def test_the_skills_reviews_ask_for_a_skill_then_memory_then_test_lines_and_carry_the_authoring_rules():
    level = runner._level_review_prompt(2, skills=True)
    assert level.startswith("LEVEL REVIEW. Level 2 is complete; this turn takes no action.")
    assert NEEDLE in level and "metadata: {trigger: level_start}" in level and "write no skill" in level
    assert "(level 2 only)" in level and "for level 3, 2-4 candidate win conditions" in level
    assert "\n- test: <move> — <the win condition it tests>\n" in level and "pins them in this order" in level
    stall = runner._stall_review_prompt([dict(n=n, action="ACTION1", level_changed=False) for n in range(1, 51)], 0, 0, skills=True)
    assert stall.startswith("STALL REVIEW. Level 1 is still open after 50 actions (since it began at action 1); this turn takes no action.")
    assert NEEDLE in stall and "metadata: {trigger: stall}" in stall and "cannot name one, write no skill" in stall
    assert "\n- test: <move> — <what it would show>\n" in stall
    # One source for how a skill is written: the refinement charter reads the same file (demo/prompts/arc_thin_skill_authoring.md).
    assert runner._skill_authoring() in level and runner._skill_authoring() in stall
    assert "description (what it does and when it applies" in runner._skill_authoring()


def test_a_skills_review_resumes_as_the_same_kind_of_review_and_the_legacy_ones_as_they_did():
    level, stall = runner._level_review_prompt(1, skills=True), runner._stall_review_prompt([dict(n=1, action="ACTION1")] * 40, 0, 0, skills=True)
    assert runner._review_recovery(level) == runner.LEVEL_REVIEW_SKILLS_RECOVERY_PROMPT
    assert runner._review_recovery(runner.LEVEL_REVIEW_SKILLS_RECOVERY_PROMPT) == runner.LEVEL_REVIEW_SKILLS_RECOVERY_PROMPT
    assert runner._review_recovery(stall) == runner.STALL_REVIEW_SKILLS_RECOVERY_PROMPT
    assert runner._review_recovery(runner.STALL_REVIEW_SKILLS_RECOVERY_PROMPT) == runner.STALL_REVIEW_SKILLS_RECOVERY_PROMPT
    for recovery in (runner.LEVEL_REVIEW_SKILLS_RECOVERY_PROMPT, runner.STALL_REVIEW_SKILLS_RECOVERY_PROMPT):
        assert recovery.startswith("RECOVER ") and "prompts/" in recovery and "- test:" in recovery and NEEDLE not in recovery
    assert runner._review_recovery(runner._level_review_prompt(1)) == runner.LEVEL_REVIEW_RECOVERY_PROMPT
    assert runner._review_recovery(runner._stall_review_prompt([dict(n=1, action="ACTION1")] * 40, 0, 0)) == runner.STALL_REVIEW_RECOVERY_PROMPT


def test_the_flag_is_read_from_the_runs_environment_and_without_it_the_reviews_are_the_legacy_ones():
    assert runner._skills_on({"ARC_THIN_SKILLS": "1"}, None) and not runner._skills_on({}, None) and not runner._skills_on({"ARC_THIN_SKILLS": "0"}, None)
    assert runner._skills_on({}, {"ARC_THIN_SKILLS": "1"}) and not runner._skills_on({"ARC_THIN_SKILLS": "1"}, {"ARC_THIN_SKILLS": "0"}), "the extension's environment wins"
    assert runner._level_review_prompt(2) == runner.LEVEL_REVIEW_PROMPT.format(level=2, next=3)
    rows = [dict(n=n, action="ACTION1", level_changed=False) for n in range(1, 41)]
    assert NEEDLE not in runner._stall_review_prompt(rows, 0, 0) and NEEDLE not in runner._level_review_prompt(1)
