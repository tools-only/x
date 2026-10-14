"""Evaluate one pilot round against the loop's three measures.

1. levels_completed (the gate), 2. tokens and actions (minimised), 3. self-harness: which non-memory components the
agent converted or used (skills, tools, subagents/observers, refiner, action sequences, python session).

Usage: python arc_ls20_loop_eval.py <label> [<label> ...]
A label is resolved against $PILOT_OUT, then the working directory, then this file's directory, so the evaluator finds
a round whether or not the environment names the output root; an unresolvable label is an error rather than zeroes.
Works on a running round too: the stores are append-only, so a partial read is still a measure of what has happened.
"""
from pathlib import Path
import json, os, sys, collections

ROOTS = [Path(p) for p in (os.environ.get('PILOT_OUT'), os.getcwd(), Path(__file__).resolve().parent) if p]


def resolve(label):
    for root in ROOTS:
        if (root / label / 'arc-run').is_dir():
            return root / label / 'arc-run'
    raise SystemExit(f'no round {label!r} under any of: ' + ', '.join(str(r) for r in ROOTS))


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
    """The two measures the runner itself writes, from usage.jsonl, plus where they went.

    ``budget`` is what max_reported_tokens caps: uncached input + output, cache reads excluded. ``reported`` is the
    full total including cache reads. Splitting by kind separates the agent's own cost from its components'.
    """
    usage_rows = rows(harness / 'usage.jsonl')
    budget = sum(int(row.get('input') or 0) + int(row.get('output') or 0) for row in usage_rows)
    reported = sum(int(row.get('total') or 0) or int(row.get('input') or 0) + int(row.get('output') or 0)
                   for row in usage_rows)
    by_kind = collections.Counter()
    for row in usage_rows:
        by_kind[str(row.get('kind') or 'decision')] += int(row.get('total') or 0)
    # request-events.jsonl is one row per request *stage*, so the request count is its distinct ids.
    requests = {row.get('request_id') for row in rows(harness / 'request-events.jsonl')}
    requests.discard(None)
    return dict(budget_tokens=budget, reported_tokens=reported, requests=len(requests),
                by_kind=dict(by_kind.most_common()))


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
    """Responses route audits: whether the stored continuation was actually stood on, and what the carry cost was.

    ``responses_transport.jsonl`` records one row per provider request. ``continued`` means the exact local prefix
    matched the stored response, so the request sent a delta and named previous_response_id; any other reason is a
    rebase that re-sent the whole input. ``carry_missing`` counts projected assistant tool-calling messages with no
    <carry> block, which is what the "fields" mode replays in place of reasoning prose.
    """
    config = {}
    path = root / 'run-config.json'
    if path.is_file():
        config = json.loads(path.read_text(encoding='utf-8'))
    transport = rows(root / 'harness' / 'responses_transport.jsonl')
    reasons = collections.Counter(str(row.get('reason')) for row in transport)
    omitted = sum(int(row.get('omitted_items') or 0) for row in transport)
    wire_reasoning = sum(int(row.get('wire_reasoning_chars') or 0) for row in transport)
    budgets = rows(root / 'harness' / 'context_budget.jsonl')
    # Each row counts the whole projection it was taken from, so these are read per round, not summed: the measure is
    # whether the agent ever writes the block (max) and how many messages lacked it in the last projection.
    return dict(pi_api=config.get('pi_api'), responses_continuation=config.get('responses_continuation'),
                decision_reasoning_mode=config.get('decision_reasoning_mode'),
                thinking_format=config.get('thinking_format'),
                thinking_reaches_provider=config.get('thinking_reaches_provider'),
                continuity=config.get('continuity'),
                requests=len(transport), reasons=dict(reasons.most_common()),
                continued_share=round(reasons.get('continued', 0) / len(transport), 2) if transport else None,
                omitted_input_items=omitted, wire_reasoning_chars=wire_reasoning,
                carry_blocks_max=max((int(row.get('carry_blocks') or 0) for row in budgets), default=0),
                carry_rounds_with_a_block=sum(1 for row in budgets if int(row.get('carry_blocks') or 0)),
                carry_missing_last=int(budgets[-1].get('carry_missing') or 0) if budgets else None)


def report(label):
    root = resolve(label)
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
    measured = tokens(harness)
    # A partial summary is written while the run continues, so its counts go stale as the stores grow: trust the
    # append-only trajectory whenever the summary is not the final one.
    final = bool(summary) and not summary.get('partial')
    played = (summary.get('actions') if final else None) or len(trajectory)
    # context_budget.jsonl is one row per provider round; a decision spans several, so count the distinct ids.
    budget_rows = rows(harness / 'context_budget.jsonl')
    decisions = len({row.get('decision') for row in budget_rows} - {None})
    out = dict(label=label,
               levels_completed=summary.get('levels_completed') if final and summary.get('levels_completed') is not None
                                else (max(levels) if levels else None),
               stop_reason=summary.get('stop_reason'), passed=summary.get('passed'),
               partial=summary.get('partial'), elapsed_seconds=summary.get('elapsed_seconds'),
               actions=played, action_mix=dict(actions.most_common()),
               level_action_budget=budget, level_changes=sum(1 for row in trajectory if row.get('level_changed')),
               prediction=dict(hits=hits, misses=misses),
               decisions=decisions, provider_rounds=len(budget_rows),
               # What the round is optimised against: cost per action, how many actions one decision buys, and how
               # many provider rounds a decision spends before it acts.
               efficiency=dict(budget_tokens_per_action=round(measured['budget_tokens'] / played, 1) if played else None,
                               actions_per_decision=round(played / decisions, 2) if decisions else None,
                               rounds_per_decision=round(len(budget_rows) / decisions, 2) if decisions else None,
                               seconds_per_action=round(summary['elapsed_seconds'] / played, 1)
                               if played and summary.get('elapsed_seconds') else None),
               tokens=measured, route=carry(root), self_harness=self_harness(root, harness),
               error=summary.get('error'))
    return out


if __name__ == '__main__':
    for label in sys.argv[1:] or ['ls20-r01']:
        print(json.dumps(report(label), ensure_ascii=False, indent=2))
