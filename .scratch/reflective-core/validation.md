# Prepared real-task validation (not run)

Run from the checkout root in Git Bash after review. It uses the existing AZ configuration and `az/deepseek-v4-flash` model. One real task must inspect the live harness, then use `reflect_component` to redefine and consume all five component kinds at their new versions before delivering the requested presentation. Each change should serve the deck work. The evidence checker reports each kind and fails if any kind is missing, consumed before its redefine, or represented only by deck/output edits.

```bash
export PYTHONPATH=src
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4 --source demo/ppt-cases/jpmorgan-chase-3q21/assets
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4 --run --resume --model az/deepseek-v4-flash --thinking high --continue-prompt 'During this presentation task, use reflect_component(op="inspect") to inspect the live harness. Improve and serve the JPMorgan Chase presentation by choosing useful existing components and redefining each through reflect_component(op="redefine"). Redefine and then consume all five kinds in this same session: (1) a prompt with a presentation style rule and verify it appears in the next system prompt; (2) a skill with a slide checklist, then load/read and apply that version; (3) a tool that checks a concrete slide layout property, then run that version on the deck; (4) a reviewer subagent with a focused slide review role, then consult it; and (5) a memory entry with key task numbers, then verify it is read at the next task boundary and use those numbers accurately. Make each component change useful to the deck. After all five new versions have been consumed, create, render, review, and deliver the requested presentation. Deck/output edits alone do not count as component changes.'
python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4
```
