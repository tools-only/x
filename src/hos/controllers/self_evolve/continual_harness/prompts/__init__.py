from pathlib import Path

_ROOT = Path(__file__).parent


def load_prompt(name: str) -> str:
    return (_ROOT / name).read_text(encoding="utf-8").strip()


BASE_ORCHESTRATOR_POLICY = load_prompt("base_orchestrator_policy.md")
EVOLUTION_SYSTEM = load_prompt("evolution_system.md")
EVOLUTION_USER = load_prompt("evolution_user.md")
SKILL_EVOLUTION = load_prompt("skill_evolution.md")
SUBAGENT_EVOLUTION = load_prompt("subagent_evolution.md")
MEMORY_EVOLUTION = load_prompt("memory_evolution.md")
