#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

run_label="arc-reflective-g50t-l1-$(date -u +%Y%m%dT%H%M%SZ)"
run_root="runs/$run_label/arc-run"
log_dir=".scratch/reflective-core/paid-logs"
mkdir -p "$log_dir" "runs/$run_label"
if [[ -e "$run_root" ]]; then
  printf 'Refusing to start: run root already exists: %s\n' "$run_root" >&2
  exit 2
fi

export PYTHONPATH=src
export ARC_PI_API=openai-completions
export ARC_PI_THINKING_FORMAT=qwen
export ARC_INPUT_MODALITIES=text,image
export ARC_MODEL_MAX_OUTPUT_TOKENS=12000
export PPT_DEMO_BUDGET_USD=400
export PPT_DEMO_REQUEST_RESERVE_USD=4.46
export PPT_DEMO_INPUT_USD_PER_MILLION=20
export PPT_DEMO_OUTPUT_USD_PER_MILLION=80
export PPT_DEMO_CACHE_READ_USD_PER_MILLION=20
export PPT_DEMO_CACHE_WRITE_USD_PER_MILLION=20

log="$log_dir/$run_label.log"
printf 'Run root: %s\nLog: %s\n' "$run_root" "$log"
if python -m autoresearch_pi.cli arc-reflective-e2e \
  --root "$run_root" \
  --game g50t \
  --provider az \
  --model qwen3.8-27b \
  --thinking low \
  --thinking-format qwen \
  --input-modalities text,image \
  --max-output-tokens 12000 >"$log" 2>&1; then
  run_status=0
else
  run_status=$?
fi

checker="$log_dir/$run_label-evidence.json"
if python tools/check_reflective_core_evidence.py "$run_root" --mode historical >"$checker" 2>&1; then
  checker_status=0
else
  checker_status=$?
fi
measures="$log_dir/$run_label-measures.json"
if node tools/arc_run_measures.mjs runs "$run_label" >"$measures" 2>&1; then
  measures_status=0
else
  measures_status=$?
fi

printf 'Runner status: %s\nEvidence checker: %s (status %s)\nARC measures: %s (status %s)\n' \
  "$run_status" "$checker" "$checker_status" "$measures" "$measures_status"
if (( run_status != 0 )); then exit "$run_status"; fi
exit "$measures_status"
