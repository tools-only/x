"""Evaluate one pilot round against the loop's three measures.

1. levels_completed (the gate), 2. tokens and actions (minimised), 3. self-harness: which non-memory components the
agent converted or used (skills, tools, subagents/observers, refiner, action sequences, python session).

Usage: python eval.py <label> [<label> ...]   -- reads $PILOT_OUT/<label>/arc-run (default: this file's directory).
Works on a running round too: the stores are append-only, so a partial read is still a measure of what has happened.
"""
from pathlib import Path
import json, os, sys, collections

BASE = Path(os.environ.get('PILOT_OUT') or Path(__file__).resolve().parent)


def rows(path):
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            pass  # a final truncated line while the run writes
    return out


def tokens(harness):
    """Uncached input + output (the cap measure since 2026-10-14) plus the raw totals, from request events."""
    requests = rows(harness / 'request-events.jsonl')
    agg = collections.Counter()
    for row in requests:
        usage = row.get('usage') or row
        for key in ('input', 'output', 'cache_read', 'cache_write', 'input_tokens', 'output_tokens',
                    'cached_input', 'cache_read_input_tokens', 'total', 'total_tokens'):
            value = usage.get(key)
            if isinstance(value, (int, float)):
                agg[key] += int(value)
    usage_rows = rows(harness / 'usage.jsonl')
    by_kind = collections.Counter()
    for row in usage_rows:
        by_kind[str(row.get('kind') or 'decision')] += int(row.get('total') or 0)
    return dict(requests=len(requests), request_totals=dict(agg), usage_by_kind=dict(by_kind),
                usage_total=sum(by_kind.values()))


def self_harness(root, harness):
    """What the agent built or ran beyond memory: the workspace dirs it wrote and the component stores that fired."""
    workspace = root / 'workspace'
    built = {}
    for name in ('skills', 'tools', 'agents', 'observers', 'notes', 'plans', 'data'):
        directory = workspace / name
        if directory.is_dir():
            files = sorted(p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file())
            if files:
                # Frame dumps run to hundreds of files; a count is the measure, the names are not.
                built[name] = files if len(files) <= 12 else [f'<{len(files)} files>', *files[:6]]
    components = collections.Counter()
    for row in rows(harness / 'component_runs.jsonl'):
        components[f"{row.get('component') or row.get('kind') or '?'}:{row.get('status') or row.get('outcome') or 'run'}"] += 1
    stores = {}
    for name in ('observer_runs', 'refiner', 'action_sequences', 'batch_results', 'python_session', 'wasi_runs',
                 'memory', 'provider_policy'):
        count = len(rows(harness / f'{name}.jsonl'))
        if count:
            stores[name] = count
    return dict(workspace_built=built, component_runs=dict(components), stores=stores)


def carry(root):
    """Responses route audits: continuation used, and decisions where the agent wrote no <carry> fields."""
    config = {}
    path = root / 'run-config.json'
    if path.is_file():
        config = json.loads(path.read_text(encoding='utf-8'))
    audit = collections.Counter()
    for row in rows(root / 'runtime-audit' / 'events.jsonl') + rows(root / 'request-control.jsonl'):
        kind = str(row.get('event') or row.get('kind') or '')
        if any(word in kind for word in ('carry', 'response', 'continu', 'prefix')):
            audit[kind] += 1
    return dict(pi_api=config.get('pi_api'), responses_continuation=config.get('responses_continuation'),
                decision_reasoning_mode=config.get('decision_reasoning_mode'),
                thinking_format=config.get('thinking_format'),
                thinking_reaches_provider=config.get('thinking_reaches_provider'),
                continuity=config.get('continuity'), audit=dict(audit))


def report(label):
    root = BASE / label / 'arc-run'
    harness = root / 'harness'
    trajectory = rows(harness / 'trajectory.jsonl')
    summary = {}
    path = root / 'summary.json'
    if path.is_file():
        summary = json.loads(path.read_text(encoding='utf-8'))
    # Each action records the level it finished on, so a running round is measurable without waiting for the summary.
    levels = [int(row.get('levels_completed') or 0) for row in trajectory if row.get('levels_completed') is not None]
    budget = (trajectory[-1].get('budget') or {}) if trajectory else {}
    hits = sum(int((row.get('prediction') or {}).get('hits') or 0) for row in trajectory)
    misses = sum(int((row.get('prediction') or {}).get('misses') or 0) for row in trajectory)
    actions = collections.Counter(str(row.get('action') or row.get('name') or '?') for row in trajectory)
    out = dict(label=label,
               levels_completed=summary.get('levels_completed') if summary.get('levels_completed') is not None
                                else (max(levels) if levels else None),
               stop_reason=summary.get('stop_reason'), passed=summary.get('passed'),
               partial=summary.get('partial'), elapsed_seconds=summary.get('elapsed_seconds'),
               actions=summary.get('actions', len(trajectory)), action_mix=dict(actions.most_common()),
               level_action_budget=budget, level_changes=sum(1 for row in trajectory if row.get('level_changed')),
               prediction=dict(hits=hits, misses=misses),
               decisions=len(rows(harness / 'context_budget.jsonl')),
               reported_tokens=summary.get('reported_tokens'), budget_tokens=summary.get('budget_tokens'),
               tokens=tokens(harness), route=carry(root), self_harness=self_harness(root, harness),
               error=summary.get('error'))
    return out


if __name__ == '__main__':
    for label in sys.argv[1:] or ['ls20-r01']:
        print(json.dumps(report(label), ensure_ascii=False, indent=2))
