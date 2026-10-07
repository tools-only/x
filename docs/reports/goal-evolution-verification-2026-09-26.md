# Goal-directed Harness verification — 2026-09-26

## Evidence boundaries

Astra supplied detailed architecture and independent behavioral review; SOL implemented; Luna ran the actual ARC SDK matrix and the ordinary real-provider FT09. Work remains on the existing branch. No commit or push was performed.

- Latest integration smoke: 15/15 passed, real ARC SDK and runtime boundaries, deterministic provider. See `runs/arc-goal-evolution-smoke-repair-20260926/arc-self-harness-smoke-summary.json`.
- Ordinary real FT09: `runs/arc-goal-evolution-ft09-20260925`, parent PID 56956 at launch, no Jev, no local action cap. Existing runner still has a 12-hour upper bound.
- Actual creator-authored candidate: `skill:ft09-glyph-panel-solve@v1`, goal-directed glyph/panel mismatch solving procedure, created 23:58:08 +08:00. This is procedural content, not merely a trajectory recap.
- Later actions cite the method and their reasoning follows its steps. However no assemble/focus calls were found; post-creation exposure rows have empty skill_versions. Authoring is demonstrated; native selection/loading/use acceptance is NOT complete.
- Auto-Research has not yet actually started in the observed run. Competing research quality and feedback revision remain unproven.
- Skill premises still need empirical scrutiny: centering/layout, palette inference, and how tile delta verification handles simultaneous counter changes.

## Diagnostics

Root independently reran capability followup diagnostics (8 passed), same-runtime scope test (1 passed after final semantic assertion repair), level retrospective Node tests (6 passed), and the actual compact-ARC surface/Skill-read fixture (1 passed). SOL's new review repair tests passed 2/2. The same-runtime test verifies semantic output before transition, scope-expired error afterward, Subagent blocking, task Skill survival and historical readability.

Full pytest command:

```powershell
D:/conda/python.exe -m pytest -q --basetemp runs/pytest-goal-evolution-full-20260925 --junitxml runs/goal-evolution-full-20260925.xml
```

Result: **628 passed, 54 failed**, 686.96 seconds. The full run is NOT green. Comparing test names with `runs/test-delta-projection-audit-20260925.xml`: all 51 older failure names recur, plus three names listed below. Name overlap is not a complete root-cause comparison and does not make old failures harmless.

### Three added failure names and subsequent disposition

1. `test_arc_uses_a_thin_initial_control_surface_with_on_demand_support_tools`: obsolete source-string assertion excluded the now-required task_checkpoint. Removed the source-only duplicate; actual compact-surface test below checks provider tool definitions and checkpoint writes.
2. `test_actual_arc_skill_creation_has_a_reachable_read_use_boundary`: behavior assertion likewise prohibited task_checkpoint. Updated to require the four actual initial tools, write task goal/planning gap and verify persistence; isolated rerun passes.
3. `test_saved_tool_and_subagent_recheck_level_scope_at_invocation_but_task_skill_survives`: full-suite process collected the earlier assertion while the focused fixture was being strengthened. Final isolated rerun passes with exact semantic output and scope-error assertions.

No second full-suite run has been performed after these test corrections. Do not relabel the original full run as passed.

## All failures from that full run

- `tests.test_arc_agi_3_e2e::test_arc_uses_a_thin_initial_control_surface_with_on_demand_support_tools`
- `tests.test_arc_agi_3_e2e::test_real_arc_auto_research_validation_prompt_requires_evidence_backed_five_component_use`
- `tests.test_harness_capability_authoring::test_saved_tool_and_subagent_recheck_level_scope_at_invocation_but_task_skill_survives`
- `tests.test_harness_control_repair::test_review_prompts_require_parent_application_and_version_verification`
- `tests.test_harness_control_repair::test_handoff_runtime_failure_degrades_immediately_and_releases_arc`
- `tests.test_harness_knowledge_lifecycle::test_content_revision_cannot_inherit_old_custom_prompt`
- `tests.test_harness_knowledge_lifecycle::test_replacement_suspends_dependent_skill_and_policy_transitively`
- `tests.test_harness_knowledge_lifecycle::test_dependency_revision_requires_explicit_revalidation_and_survives_resume`
- `tests.test_harness_knowledge_lifecycle::test_layers_and_activation_are_selected_before_body_projection`
- `tests.test_harness_knowledge_lifecycle::test_conditional_policy_reads_pretty_checkpoint_and_changes_on_resume`
- `tests.test_harness_knowledge_lifecycle::test_system_overlay_is_removed_after_prerequisite_revision_and_resume`
- `tests.test_harness_knowledge_lifecycle::test_supersession_stays_effective_after_replacement_retirement`
- `tests.test_harness_knowledge_lifecycle::test_layers_and_review_notice_survive_context_compaction`
- `tests.test_harness_review::test_review_normalization_preserves_outer_component_and_aggregates_required_fields`
- `tests.test_harness_review::test_review_normalization_reports_candidate_conflicts_without_guessing`
- `tests.test_harness_review::test_invalid_review_draft_patch_is_revisioned_and_lossless`
- `tests.test_pi_external_benchmark_native::test_shared_external_extension_closes_finding_compaction_effect_loop`
- `tests.test_pi_external_benchmark_native::test_harness_effect_assessment_accepts_native_exposure_reference`
- `tests.test_pi_external_benchmark_native::test_harness_effect_assessment_error_lists_current_native_refs`
- `tests.test_pi_external_benchmark_native::test_task_harness_status_exposes_cross_context_candidate_without_starting_research`
- `tests.test_pi_external_benchmark_native::test_arc_adapter_starts_empty_with_direct_component_operations`
- `tests.test_pi_external_benchmark_native::test_task_skills_are_projected_with_instructions_without_a_read_call`
- `tests.test_pi_external_benchmark_native::test_task_local_context_projection_does_not_drop_components_after_five`
- `tests.test_pi_external_benchmark_native::test_task_tool_is_adapter_bounded_versioned_and_audited`
- `tests.test_pi_external_benchmark_native::test_agent_defined_task_program_creates_and_uses_new_behavior`
- `tests.test_pi_external_benchmark_native::test_agent_defined_analysis_program_emits_provenance_bound_observation`
- `tests.test_pi_external_benchmark_native::test_open_research_memory_and_system_prompt_reach_later_pi_context`
- `tests.test_pi_external_benchmark_native::test_research_linked_memory_records_decision_and_native_context_exposure`
- `tests.test_pi_external_benchmark_native::test_unassessed_native_intervention_is_visible_in_later_pi_context`
- `tests.test_pi_external_benchmark_native::test_new_native_exposure_reopens_effect_check_after_prior_assessment`
- `tests.test_pi_external_benchmark_native::test_same_task_skill_recovery_uses_context_without_native_loader`
- `tests.test_pi_external_benchmark_native::test_task_skill_creation_projection_and_later_read_are_distinct_facts`
- `tests.test_pi_external_benchmark_native::test_arc_task_subagent_runs_an_isolated_read_only_pi_loop`
- `tests.test_pi_external_benchmark_native::test_arc_task_subagent_discards_large_intermediate_json_events`
- `tests.test_pi_external_benchmark_native::test_task_subagent_lifecycle_is_reusable_by_a_non_arc_adapter`
- `tests.test_pi_external_benchmark_native::test_arc_child_state_uses_the_last_animation_frame_in_lossless_runs`
- `tests.test_pi_external_benchmark_native::test_arc_task_tool_is_public_state_only_and_dynamic`
- `tests.test_pi_external_benchmark_native::test_arc_task_tool_returns_a_plan_without_advancing_live_environment`
- `tests.test_pi_harness_entry::test_actual_arc_skill_creation_has_a_reachable_read_use_boundary`
- `tests.test_pi_officebench_native::test_installed_pi_task_runtime_omits_weak_evidence_policy`
- `tests.test_pi_officebench_native::test_installed_pi_rehydrates_and_inspects_task_local_resources`
- `tests.test_pi_officebench_native::test_installed_pi_compact_experience_record_and_retention`
- `tests.test_pi_shopping_native::test_installed_pi_shopping_batch_surface_has_observed_effect`
- `tests.test_pi_shopping_native::test_installed_pi_shopping_continue_with_can_supply_record_decision`
- `tests.test_pi_shopping_native::test_installed_pi_shopping_effect_window_starts_after_surface_exposure`
- `tests.test_pi_shopping_native::test_installed_pi_shopping_exposes_stable_auto_research_method_only_in_treatment`
- `tests.test_pi_shopping_native::test_installed_pi_shopping_ignores_runner_projection_toggle`
- `tests.test_pi_shopping_native::test_installed_pi_shopping_rehydrates_read_only_research_resources`
- `tests.test_pi_shopping_native::test_installed_pi_agent_selected_context_compaction_changes_only_cited_observation`
- `tests.test_shopping_e2e::test_shopping_evaluator_reads_run_local_cart`
- `tests.test_shopping_e2e::test_shopping_bridge_preserves_unicode_output`
- `tests.test_shopping_e2e::test_shopping_bridge_preserves_cart_across_one_action_processes`
- `tests.test_shopping_e2e::test_shopping_batch_bridge_executes_multiple_cart_writes_in_one_process`
- `tests.test_shopping_e2e::test_shopping_e2e_runner_keeps_evaluator_and_agent_outcomes_separate`

## Residual defects and unproven behavior

- Live parent uses the launch snapshot; later level-review corrections are tested on disk and in a fresh smoke, not hot-loaded into the ongoing game.
- A corrected batch change can retain a ghost pending failure because control identity hashes the entire unbound input. Exact batch reconciliation is not fixed here; original missing component kind makes automatic semantic matching unsafe.
- Explicit-window level-review repairs now reconcile; omitted window IDs still need an explicit target and cannot be treated as already repaired.
- Full-suite legacy failures need separate diagnosis; shopping subprocess failures include a conflicting Python installation/library path, and Harness projection failures cannot all be dismissed as environment issues.

## Notifications

Astra's full design HTML was emailed earlier (`1a0d91c11e293f1a`). Implementation/launch stage: `1a0d93cda08b2591`. Actual Skill body with assembly and quality limitations: `1a0d94de26dec3d9`. Recipient: the user's authorized 595819371@qq.com.

