# Window progress regression: full-suite audit

2026-09-24. Full pytest: 619 passed, 51 failed, 715.37 seconds.
Source: `runs/test-window-progress-audit-20260924.xml`.

The omitted-window progress regression passes. Real-SDK deterministic-provider smoke passes 15/15. Neither establishes whole-suite success or autonomous research adoption. The failures below are observed failures, not yet all classified as stale tests versus implementation defects. Do not restore admission gates just to satisfy historical tests.

## Failed tests

### Follow-up: revised Memory projection contract

`test_content_revision_cannot_inherit_old_custom_prompt` successfully wrote v2
NEW_BODY and removed OLD_PROMPT/OLD_SUMMARY in its original artifacts, but its
fixture omitted validity.scope and explicit assembly. A separate real-Pi
diagnostic at `runs/lifecycle-projection-audit-20260924` supplied task scope on
both writes and explicitly selected memory:position@v2. It returned no errors,
one assembly, task-prompt NEW_BODY without OLD_PROMPT, and memory summary NEW_BODY
without OLD_SUMMARY. This isolates this failure to missing current projection
prerequisites rather than failure to clear stale text. It does not diagnose the
other50 failures. No automatic assembly or new admission policy was added.

- `tests.test_arc_agi_3_e2e.test_real_arc_auto_research_validation_prompt_requires_evidence_backed_five_component_use`

  AssertionError: assert 'route receipt' in 'This is a real ARC Auto-Research -> method candidate -> parent creator authoring -> native self-harness closure probe...es mechanism reachability and real use; it does not by it

- `tests.test_harness_control_repair.test_review_prompts_require_parent_application_and_version_verification`

  AssertionError: assert 'authoring_method_ref INSIDE' in 'Play ARC-AGI-3 game {{game}}. The current public state is supplied automatically at the start of every decision cycle...es. Relative balance means the work fits th

- `tests.test_harness_control_repair.test_handoff_runtime_failure_degrades_immediately_and_releases_arc`

  AssertionError: assert ('proposed' == 'deferred'   - deferred   + proposed)

- `tests.test_harness_knowledge_lifecycle.test_content_revision_cannot_inherit_old_custom_prompt`

  AssertionError: assert ('NEW_BODY' in '')

- `tests.test_harness_knowledge_lifecycle.test_replacement_suspends_dependent_skill_and_policy_transitively`

  assert not True  +  where True = any(<generator object test_replacement_suspends_dependent_skill_and_policy_transitively.<locals>.<genexpr> at 0x000001CA7BF7D2F0>)

- `tests.test_harness_knowledge_lifecycle.test_dependency_revision_requires_explicit_revalidation_and_survives_resume`

  AssertionError: assert not True  +  where True = <built-in method get of dict object at 0x000001CA7C005E40>('isError')  +    where <built-in method get of dict object at 0x000001CA7C005E40> = {'args': {'action': 'update'

- `tests.test_harness_knowledge_lifecycle.test_layers_and_activation_are_selected_before_body_projection`

  AssertionError: assert ('POLICY_BODY' in '')

- `tests.test_harness_knowledge_lifecycle.test_conditional_policy_reads_pretty_checkpoint_and_changes_on_resume`

  AssertionError: assert 'CONDITIONAL_POLICY' in ''  +  where '' = <built-in method join of str object at 0x00007FF90FB07CA0>([])  +    where <built-in method join of str object at 0x00007FF90FB07CA0> = ''.join  +    and  

- `tests.test_harness_knowledge_lifecycle.test_system_overlay_is_removed_after_prerequisite_revision_and_resume`

  AssertionError: assert 'DEPENDENT_SYSTEM_RULE' in '\n\nYou are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, ...24\nCurrent working directory: C:/Users/qi/AppDat

- `tests.test_harness_knowledge_lifecycle.test_supersession_stays_effective_after_replacement_retirement`

  assert 'superseded' in 'Task-local knowledge requiring review: [{"resource_ref":"memory:old@v1","reasons":["validity:missing_requires_review"...o not reactivate them. Native system overlays refresh at the next agent turn

- `tests.test_harness_knowledge_lifecycle.test_layers_and_review_notice_survive_context_compaction`

  assert (0 == 1)  +  where 0 = len([])

- `tests.test_harness_review.test_review_normalization_preserves_outer_component_and_aggregates_required_fields`

  AssertionError: assert {'instruction...ested': True}} == {'authoring_m... input.', ...}   Omitting 3 identical items, use -vv to show   Right contains 4 more items:   {'authoring_method_ref': 'method:skill-creator@v1',  

- `tests.test_harness_review.test_review_normalization_reports_candidate_conflicts_without_guessing`

  AssertionError: assert ['review[0].n...].validation'] == ['review[0].c...].validation']   At index 0 diff: 'review[0].next_use' != 'review[0].candidate.component'   Right contains 2 more items, first extra item: 'review[

- `tests.test_harness_review.test_invalid_review_draft_patch_is_revisioned_and_lossless`

  subprocess.CalledProcessError: Command '['C:\\nvm4w\\nodejs\\node.EXE', '--experimental-strip-types', '--input-type=module', '-e', 'import * as h from "file:///D:/autoresearch_pi_project/demo/pi_harness_review.ts"; conso

- `tests.test_pi_external_benchmark_native.test_shared_external_extension_closes_finding_compaction_effect_loop`

  assert '# Auto-Research: parent guide' in "AUTO-RESEARCH: use auto_research(action='start') for a bounded targeted or open read-only investigation when it can c...t working directory: C:/Users/qi/AppData/Local/Temp/pytes

- `tests.test_pi_external_benchmark_native.test_harness_effect_assessment_accepts_native_exposure_reference`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_harness_effect_assessment0\\native-exposure-assessment\\effect-assessments.jsonl'

- `tests.test_pi_external_benchmark_native.test_harness_effect_assessment_error_lists_current_native_refs`

  AssertionError: assert 'Available observation_refs for decision-1' in 'unknown observation reference: made-up-observation. No native exposure has been recorded for decision-1 yet; inspect task_harness_status and retry af

- `tests.test_pi_external_benchmark_native.test_task_harness_status_exposes_cross_context_candidate_without_starting_research`

  AssertionError: assert {'action': 's...e20677a4c@v1'} == {'action': 's...e20677a4c@v1'}   Omitting 2 identical items, use -vv to show   Left contains 1 more item:   {'authoring_method_ref': 'baseline_method:research-orch

- `tests.test_pi_external_benchmark_native.test_arc_adapter_starts_empty_with_direct_component_operations`

  AssertionError: assert {'arc_action', 'arc_state', 'delegate_task', 'inspect_arc_trajectory', 'read', 'research_resource', ...} <= {'arc_action', 'assess_harness_effect', 'auto_research', 'delegate_task', 'read', 'resear

- `tests.test_pi_external_benchmark_native.test_task_skills_are_projected_with_instructions_without_a_read_call`

  StopIteration

- `tests.test_pi_external_benchmark_native.test_task_local_context_projection_does_not_drop_components_after_five`

  IndexError: list index out of range

- `tests.test_pi_external_benchmark_native.test_task_tool_is_adapter_bounded_versioned_and_audited`

  assert False  +  where False = any(<generator object test_task_tool_is_adapter_bounded_versioned_and_audited.<locals>.<genexpr> at 0x000001CA7BA9F240>)

- `tests.test_pi_external_benchmark_native.test_agent_defined_task_program_creates_and_uses_new_behavior`

  AssertionError: assert 'failed' == 'completed'   - completed   + failed

- `tests.test_pi_external_benchmark_native.test_agent_defined_analysis_program_emits_provenance_bound_observation`

  json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)

- `tests.test_pi_external_benchmark_native.test_open_research_memory_and_system_prompt_reach_later_pi_context`

  assert False  +  where False = any(<generator object test_open_research_memory_and_system_prompt_reach_later_pi_context.<locals>.<genexpr> at 0x000001CA7BF3CC70>)

- `tests.test_pi_external_benchmark_native.test_research_linked_memory_records_decision_and_native_context_exposure`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_research_linked_memory_re0\\research-linked-memory\\harness-observations.jsonl'

- `tests.test_pi_external_benchmark_native.test_unassessed_native_intervention_is_visible_in_later_pi_context`

  assert 0 == 1  +  where 0 = len([])

- `tests.test_pi_external_benchmark_native.test_new_native_exposure_reopens_effect_check_after_prior_assessment`

  StopIteration

- `tests.test_pi_external_benchmark_native.test_same_task_skill_recovery_uses_context_without_native_loader`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_same_task_skill_recovery_0\\skill\\task-skill-events.jsonl'

- `tests.test_pi_external_benchmark_native.test_task_skill_creation_projection_and_later_read_are_distinct_facts`

  AssertionError: assert ['file_written'] == ['file_writte...ead_by_agent']   Right contains 2 more items, first extra item: 'projected_to_context'   Use -v to get more diff

- `tests.test_pi_external_benchmark_native.test_arc_task_subagent_runs_an_isolated_read_only_pi_loop`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_arc_task_subagent_runs_an0\\arc-subagent\\subagent-invocations.jsonl'

- `tests.test_pi_external_benchmark_native.test_arc_task_subagent_discards_large_intermediate_json_events`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_arc_task_subagent_discard0\\arc-subagent-large-intermediate\\subagent-invocations.jsonl'

- `tests.test_pi_external_benchmark_native.test_task_subagent_lifecycle_is_reusable_by_a_non_arc_adapter`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_task_subagent_lifecycle_i0\\generic-subagent\\subagent-invocations.jsonl'

- `tests.test_pi_external_benchmark_native.test_arc_child_state_uses_the_last_animation_frame_in_lossless_runs`

  FileNotFoundError: [Errno 2] No such file or directory: 'C:\\Users\\qi\\AppData\\Local\\Temp\\pytest-of-qi\\pytest-2540\\test_arc_child_state_uses_the_0\\arc-last-frame\\subagent-provider-contexts.jsonl'

- `tests.test_pi_external_benchmark_native.test_arc_task_tool_is_public_state_only_and_dynamic`

  KeyError: 'output_excerpt'

- `tests.test_pi_external_benchmark_native.test_arc_task_tool_returns_a_plan_without_advancing_live_environment`

  AssertionError: assert 'failed' == 'completed'   - completed   + failed

- `tests.test_pi_officebench_native.test_installed_pi_task_runtime_omits_weak_evidence_policy`

  AssertionError: assert 'No research stages or harness changes are mandatory' in 'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, exec...se an available tas

- `tests.test_pi_officebench_native.test_installed_pi_rehydrates_and_inspects_task_local_resources`

  AssertionError: assert 1009 <= 240  +  where 1009 = len('observed xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

- `tests.test_pi_officebench_native.test_installed_pi_compact_experience_record_and_retention`

  AssertionError: assert 6 == 5  +  where 6 = len([{'assessment_refs': [], 'decision': 'Use the focused calendar surface.', 'evidence': 'A task-local observation identi...later workspace reads.', 'evidence_refs': ['fixture

- `tests.test_pi_shopping_native.test_installed_pi_shopping_batch_surface_has_observed_effect`

  AssertionError: assert 'contradicted' == 'supported'   - supported   + contradicted

- `tests.test_pi_shopping_native.test_installed_pi_shopping_continue_with_can_supply_record_decision`

  AssertionError: assert 'contradicted' == 'supported'   - supported   + contradicted

- `tests.test_pi_shopping_native.test_installed_pi_shopping_effect_window_starts_after_surface_exposure`

  assert 0 == 2

- `tests.test_pi_shopping_native.test_installed_pi_shopping_exposes_stable_auto_research_method_only_in_treatment`

  AssertionError: assert 'Use research when it helps resolve an uncertainty; direct execution is also valid.' in 'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading fi

- `tests.test_pi_shopping_native.test_installed_pi_shopping_ignores_runner_projection_toggle`

  assert False  +  where False = all(<generator object test_installed_pi_shopping_ignores_runner_projection_toggle.<locals>.<genexpr> at 0x000001CA7BF3C2B0>)

- `tests.test_pi_shopping_native.test_installed_pi_shopping_rehydrates_read_only_research_resources`

  AssertionError: assert 500 <= 240  +  where 500 = len('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq...qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq

- `tests.test_pi_shopping_native.test_installed_pi_agent_selected_context_compaction_changes_only_cited_observation`

  assert False  +  where False = all(<generator object test_installed_pi_agent_selected_context_compaction_changes_only_cited_observation.<locals>.<genexpr> at 0x000001CA7D5960C0>)

- `tests.test_shopping_e2e.test_shopping_evaluator_reads_run_local_cart`

  RuntimeError: Error processing line 1 of D:\anaconda\Lib\site-packages\protobuf-4.25.3-py3.12-nspkg.pth:  Fatal Python error: init_import_site: Failed to import the site module Python runtime state: initialized Traceback

- `tests.test_shopping_e2e.test_shopping_bridge_preserves_unicode_output`

  RuntimeError: Error processing line 1 of D:\anaconda\Lib\site-packages\protobuf-4.25.3-py3.12-nspkg.pth:  Fatal Python error: init_import_site: Failed to import the site module Python runtime state: initialized Traceback

- `tests.test_shopping_e2e.test_shopping_bridge_preserves_cart_across_one_action_processes`

  RuntimeError: Error processing line 1 of D:\anaconda\Lib\site-packages\protobuf-4.25.3-py3.12-nspkg.pth:  Fatal Python error: init_import_site: Failed to import the site module Python runtime state: initialized Traceback

- `tests.test_shopping_e2e.test_shopping_batch_bridge_executes_multiple_cart_writes_in_one_process`

  RuntimeError: Error processing line 1 of D:\anaconda\Lib\site-packages\protobuf-4.25.3-py3.12-nspkg.pth:  Fatal Python error: init_import_site: Failed to import the site module Python runtime state: initialized Traceback

- `tests.test_shopping_e2e.test_shopping_e2e_runner_keeps_evaluator_and_agent_outcomes_separate`

  assert False is True
