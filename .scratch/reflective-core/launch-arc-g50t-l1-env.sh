#!/usr/bin/env bash
# Loads selected variables from the main repo .env into process env (no secrets written or printed).
set -euo pipefail
main_env=D:/autoresearch_pi_project/.env
for k in OPENAI_API_BASE OPENAI_API_KEY ARC_API_KEY ARC_BASE_URL ARC_AGI_3_ROOT; do
  line=$(grep -E "^${k}=" "$main_env" | tail -1 || true)
  [[ -n "$line" ]] || continue
  v=${line#*=}; v=${v%$'\r'}; v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
  export "$k=$v"
done
# az endpoint for the reflective ARC run; never the openrouter ARC_OPENAI_* values.
export ARC_OPENAI_API_BASE="$OPENAI_API_BASE"
export ARC_OPENAI_API_KEY="$OPENAI_API_KEY"
unset ARC_MODEL
cd "$(dirname "$0")/../.."
exec bash .scratch/reflective-core/run-arc-g50t-l1.sh
