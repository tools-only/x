#!/usr/bin/env python3
"""E0 audit (2026-10-26): what the stall and level reviews on record led to.

For each review turn of the thin/native ARC runs (working_set.jsonl rows marked level_review or stall_review) this reports:
  1. the review's own output: the file it wrote (prompts/review.md for a stall review, prompts/lessons.md for a level review),
     its "- test:" lines, and the other writes of the turn;
  2. components that followed: agent-authored saves (write/edit, python save=, python file writes) during the turn and in the
     window after it, the agent's refine(focus) requests, and the refiner's edits in the same window (a service, reported apart);
  3. use: views shown (observer_runs), tools called by name, predictors scored, subagents consulted, memory checks decided
     (claim_checks), and the review's own tests pinned and played (refiner.jsonl).
Whether a review names a loop-level cost is a semantic judgment: the script prints keyword hints, and the labels written by
the reviewing agent are merged from a JSON file when one is given.

Usage: python tools/arc_review_followup_audit.py --out <dir> [--labels <labels.json>] <runs root> [<runs root> ...]
"""
import argparse, bisect, collections, datetime, json, os, re, sys

COMPONENT = re.compile(r'^(prompts/[^/]+\.md|tools/[^/]+\.py|observers/[^/]+\.py|lib/[^/]+\.py|skills/[^/]+/SKILL\.md|agents/[^/]+\.md|roles/[^/]+\.md)$')
REVIEW_PROMPT = re.compile(r'^(RECOVER )?(LEVEL REVIEW|STALL REVIEW)\b')
TEST_LINE = re.compile(r'^\s*(?:[-*•]|\d+[.)])?\s*test\b\s*[:\-—–]?\s*(.+)$', re.I)
PY_WRITE = re.compile(r"""open\(\s*['"]((?:tools|lib|prompts|skills|agents|observers)/[^'"]+)['"]\s*,\s*['"][wa]""")
SKIP_DIRS = {'snapshots', 'fork-snapshots', 'runtime', 'node_modules', '.git', 'workspace', '.harness', '.pi-agent',
             'runtime-audit', 'versions', 'python_session', 'frames', 'observations', 'fixtures'}
WINDOW_ACTIONS = 40
# Keyword hints only; the labels file holds the judgment.
HINTS = {
    'action_waste': r'repeat|same (?:click|move|action|spot|cell)|no[- ]change|nothing changed|no effect|no-op|wast|ritual|replay|again and again|loop|spam|redundant|re-?click|identical',
    'computation_waste': r're-?deriv|recomput|retyp|by hand|manual|re-?read|re-?analy|re-?check|python|code',
    'follow_through': r'never (?:tested|tried|played)|not (?:tested|tried|played|followed)|ignored|skipped|abandon|pinned|plan (?:was|not)',
    'belief_persistence': r'kept too long|belief|assum|stuck|fixat|anchor|tunnel|premature|overconfid|misread|misinterpret|wrong (?:model|frame|belief)|level[- ]?1 (?:pattern|frame|rule)|carried',
    'overhead': r'tool call|deliberat|overthink|too many|tokens|time spent|budget',
}


def ts(value):
    """ISO timestamp or epoch milliseconds -> epoch seconds."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value / 1000.0 if value > 1e11 else float(value)
    try:
        return datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def rows(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def discover(roots):
    found = []
    for root in roots:
        for here, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            if os.path.basename(here) == 'harness' and 'working_set.jsonl' in files:
                with open(os.path.join(here, 'working_set.jsonl'), encoding='utf-8', errors='replace') as f:
                    text = f.read()
                if '"level_review":true' in text or '"stall_review":true' in text:
                    found.append(os.path.dirname(here))
                dirs[:] = []
    return sorted(set(found))


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(c.get('text', '') for c in content if isinstance(c, dict) and c.get('type') == 'text')
    return ''


def norm(path):
    path = str(path or '').replace('\\', '/')
    while path.startswith('./'):
        path = path[2:]
    return path


class Run:
    def __init__(self, root):
        self.root = root
        h = os.path.join(root, 'harness')
        cfg_path = os.path.join(root, 'run-config.json')
        self.cfg = json.load(open(cfg_path, encoding='utf-8')) if os.path.exists(cfg_path) else {}
        self.ws = rows(os.path.join(h, 'working_set.jsonl'))
        self.traj = rows(os.path.join(h, 'trajectory.jsonl'))
        self.refiner = rows(os.path.join(h, 'refiner.jsonl'))
        self.observer = rows(os.path.join(h, 'observer_runs.jsonl'))
        self.component_runs = rows(os.path.join(h, 'component_runs.jsonl'))
        self.claims = rows(os.path.join(h, 'claim_checks.jsonl'))
        self.binder = rows(os.path.join(root, '.harness', 'components.jsonl'))
        self.traj_t = [ts(r.get('t')) or 0 for r in self.traj]
        self.messages = []  # (t, role, message); images are dropped, only text and tool calls are read
        for entry in rows(os.path.join(root, 'session.jsonl')):
            if entry.get('type') != 'message':
                continue
            m = entry.get('message') or {}
            if isinstance(m.get('content'), list):
                m['content'] = [c for c in m['content'] if not (isinstance(c, dict) and c.get('type') == 'image')]
            self.messages.append((ts(entry.get('timestamp')) or ts(m.get('timestamp')) or 0, m.get('role'), m))
        results = {}
        for t, role, m in self.messages:
            if role == 'toolResult':
                results[m.get('toolCallId')] = m
        # Every assistant tool call with its result.
        self.calls = []
        for i, (t, role, m) in enumerate(self.messages):
            if role != 'assistant' or not isinstance(m.get('content'), list):
                continue
            for c in m['content']:
                if isinstance(c, dict) and c.get('type') == 'toolCall':
                    r = results.get(c.get('id')) or {}
                    rtext = text_of(r.get('content'))
                    self.calls.append({'i': i, 't': t, 'name': c.get('name'), 'args': c.get('arguments') or {},
                                       'error': bool(r.get('isError')), 'result': rtext[:2000]})
        self.kinds = {}
        for b in self.binder:
            good = b.get('good') or {}
            if good:
                self.kinds[b.get('path')] = {'kind': good.get('kind'), 'name': good.get('name'), 'view': good.get('view'),
                                            'predictor': good.get('predictor'), 'description': good.get('description')}

    def name(self):
        parts = self.root.replace('\\', '/').split('/')
        return '/'.join(parts[-3:-1]) if parts[-1] == 'arc-run' else '/'.join(parts[-2:])

    def actions_at(self, t):
        """Actions played before time t."""
        return bisect.bisect_right(self.traj_t, t)

    def time_of_action(self, n):
        """Time action n was recorded (n is 1-based), or None."""
        return self.traj_t[n - 1] if 0 < n <= len(self.traj_t) else None

    def level_at(self, n):
        return self.traj[n - 1].get('levels_completed', 0) if 0 < n <= len(self.traj) else 0


def agent_writes(run):
    """Component saves the agent itself made: write/edit to a component path, python save=, python file writes."""
    out = []
    for c in run.calls:
        name, args = c['name'], c['args']
        ok = not c['error'] and not re.search(r'NOT loaded|was NOT|not saved|refused', c['result'] or '')
        if name in ('write', 'edit'):
            path = norm(args.get('path'))
            if COMPONENT.match(path):
                content = args.get('content') if name == 'write' else None
                out.append({'t': c['t'], 'i': c['i'], 'path': path, 'how': name, 'ok': ok, 'content': content,
                            'edits': args.get('edits') if name == 'edit' else None, 'receipt': c['result'][:300]})
        elif name == 'python':
            code = str(args.get('code') or '')
            if args.get('save'):
                out.append({'t': c['t'], 'i': c['i'], 'path': f"tools/{args['save']}.py", 'how': 'python save', 'ok': ok,
                            'content': code, 'receipt': c['result'][:300]})
            for m in PY_WRITE.finditer(code):
                path = norm(m.group(1))
                if COMPONENT.match(path):
                    out.append({'t': c['t'], 'i': c['i'], 'path': path, 'how': 'python write', 'ok': ok, 'content': None,
                                'receipt': c['result'][:300]})
    return out


def memory_checks(run):
    """memory calls that set a hypothesis check (a check is run on every move, a pushed component)."""
    out = []
    for c in run.calls:
        if c['name'] != 'memory':
            continue
        blob = json.dumps(c['args'], ensure_ascii=False)
        if re.search(r'"check"\s*:\s*"[^"]', blob):
            keys = re.findall(r'"key"\s*:\s*"([^"]+)"', blob)
            out.append({'t': c['t'], 'i': c['i'], 'keys': keys, 'ok': not c['error']})
    return out


def review_turns(run):
    """Review turns: working_set rows marked as reviews, merged by decision, with the session span of the turn."""
    by_decision = collections.OrderedDict()
    for r in run.ws:
        if r.get('level_review') or r.get('stall_review'):
            d = r.get('decision')
            if d not in by_decision:
                by_decision[d] = r
    user = [(i, t, text_of(m.get('content'))) for i, (t, role, m) in enumerate(run.messages) if role == 'user']
    turns = []
    for d, r in by_decision.items():
        t = ts(r.get('t'))
        # The review prompt nearest the working set row (the row is written as the turn's context is built).
        cands = [(abs(ut - t), k) for k, (i, ut, text) in enumerate(user) if REVIEW_PROMPT.match(text) and ut <= t + 120]
        if not cands:
            turns.append({'decision': d, 'row': r, 'prompt': '', 'start_i': None, 'end_i': None, 't': t})
            continue
        k = min(cands)[1]
        start_i, start_t, prompt = user[k]
        # The turn runs to the next user message that is not a recovery of the same review.
        j = k + 1
        while j < len(user) and user[j][2].startswith('RECOVER ') and REVIEW_PROMPT.match(user[j][2]):
            j += 1
        end_i = user[j][0] if j < len(user) else len(run.messages)
        end_t = user[j][1] if j < len(user) else (run.messages[-1][0] if run.messages else t)
        turns.append({'decision': d, 'row': r, 'prompt': prompt, 'start_i': start_i, 'end_i': end_i, 't': start_t, 'end_t': end_t})
    return turns


def apply_edits(content, edits):
    for e in edits or []:
        old, new = e.get('oldText'), e.get('newText')
        if content is not None and old is not None and old in content:
            content = content.replace(old, new or '', 1)
        else:
            return None
    return content


def file_versions(run, path):
    """The content of `path` after each agent write/edit, in session order (None where it cannot be rebuilt)."""
    content, out = None, []
    for w in agent_writes(run):
        if w['path'] != path or not w['ok']:
            continue
        if w['how'] == 'write':
            content = w['content']
        elif w['how'] == 'edit':
            content = apply_edits(content, w['edits'])
        else:
            content = None
        out.append((w['t'], w['i'], content))
    return out


def use_of(run, path, since_t, until_t):
    """What became of a component after since_t (until until_t when given)."""
    info = run.kinds.get(path, {})
    stem = path.split('/')[-1].rsplit('.', 1)[0]
    name = info.get('name') or (path.split('/')[1] if path.startswith('skills/') else stem)
    within = lambda t: t is not None and t > since_t and (until_t is None or t <= until_t)
    use = {'kind': info.get('kind'), 'view': bool(info.get('view')), 'predictor': bool(info.get('predictor'))}
    if path.startswith(('tools/', 'observers/')):
        shown = [o for o in run.observer if str(o.get('key', '')).startswith(path + '@') and within(ts(o.get('t')))]
        values = [json.dumps(o.get('value'), ensure_ascii=False) for o in shown if o.get('ok') and o.get('value') not in (None, '', [], {})]
        use['view_states_shown'] = len(shown)
        use['view_nonempty'] = len(values)
        use['view_distinct_outputs'] = len(set(values))
        use['called_by_name'] = sum(1 for c in run.calls if c['name'] == name and within(c['t']))
        use['predictor_scored'] = sum(1 for r in run.traj if within(ts(r.get('t'))) and any(
            isinstance(p, dict) and p.get('path') == path for p in (r.get('predictors') or [])))
        use['acted_via'] = sum(1 for r in run.traj if within(ts(r.get('t'))) and str(r.get('via') or r.get('source') or '').endswith(stem + '.py'))
    elif path.startswith('lib/'):
        use['imported_by_python'] = sum(1 for c in run.calls if c['name'] == 'python' and within(c['t']) and re.search(
            r'\b(import|from)\s+' + re.escape(stem) + r'\b', str(c['args'].get('code') or '')))
    elif path.startswith(('agents/', 'roles/')):
        mine = [c for c in run.calls if c['name'] == 'consult' and within(c['t']) and c['args'].get('agent') == name]
        use['consulted'] = sum(1 for c in mine if not consult_failed(c))
        use['consult_errors'] = sum(1 for c in mine if consult_failed(c))
    elif path.startswith('skills/'):
        use['run'] = sum(1 for c in run.calls if c['name'] == 'run_skill' and within(c['t']) and name in json.dumps(c['args']))
    elif path.startswith('prompts/'):
        use['resident'] = True
    return use


def used_flag(use):
    """Mechanical use: shown with content, called, scored, imported, consulted or run. A prompt is delivered, not judged."""
    if use.get('resident'):
        return 'delivered (resident prompt)'
    if any(use.get(k) for k in ('called_by_name', 'predictor_scored', 'acted_via', 'imported_by_python', 'consulted', 'run')):
        return 'called/scored'
    if use.get('view_nonempty'):
        return 'shown' if use.get('view_distinct_outputs', 0) > 1 else 'shown (constant output)'
    return 'not used'


def test_pins(run, turn, review_file):
    """The review's own tests: read, pinned, played, expired, replaced, skipped."""
    d = turn['decision']
    prefix = f'test:{review_file}:{d}:'
    nexts = [r for r in run.refiner if r.get('kind') == 'next' and str(r.get('edit', '')).startswith(prefix)]
    done = {r.get('edit'): r for r in run.refiner if r.get('kind') == 'next_done'}
    outcomes = collections.Counter(done[r['edit']].get('outcome') if r['edit'] in done else 'open' for r in nexts)
    read = [r for r in run.refiner if r.get('kind') == 'tests' and r.get('path') == review_file and r.get('decision') == d]
    skipped = [r for r in run.refiner if r.get('kind') == 'test_skipped' and r.get('source') == review_file
               and turn['t'] <= (ts(r.get('t')) or 0) <= (turn.get('next_t') or 1e18)]
    return {'tests_read': sum(r.get('count', 0) for r in read), 'pinned': len(nexts), 'outcomes': dict(outcomes),
            'skipped': len(skipped), 'skip_reasons': sorted({str(r.get('why'))[:80] for r in skipped})}


def hints(text):
    return sorted(k for k, pat in HINTS.items() if re.search(pat, text or '', re.I))


def consult_failed(call):
    """A consult that returned no answer: an error result, or a budget/round exhaustion reported as text."""
    return call['error'] or bool(re.search(r'budget exhausted|round budget|timed out|no answer', call['result'] or '', re.I))


COMPONENT_REQUEST = re.compile(r'\b(add|build|create|make|write|give)\b[^.]{0,40}\b(view|tool|check|predictor|function|script|guard)\b'
                               r'|\bfix (?:the )?(?:tools/|view|check)', re.I)


def audit(run):
    turns = review_turns(run)
    writes = agent_writes(run)
    mchecks = memory_checks(run)
    refines = [c for c in run.calls if c['name'] == 'refine']
    edits = [r for r in run.refiner if r.get('kind') == 'edit']
    starts = sorted(t['t'] for t in turns)
    out = []
    for k, turn in enumerate(turns):
        r = turn['row']
        kind = 'level' if r.get('level_review') else 'stall'
        review_file = 'prompts/lessons.md' if kind == 'level' else 'prompts/review.md'
        later = [s for s in starts if s > turn['t'] + 1]
        turn['next_t'] = later[0] if later else None
        span = (turn['start_i'], turn['end_i'])
        in_turn = lambda i: span[0] is not None and span[0] <= i < span[1]
        # The review file as the turn left it.
        versions = [v for v in file_versions(run, review_file) if in_turn(v[1])]
        review_text = versions[-1][2] if versions else None
        attempts = [{'how': w['how'], 'ok': w['ok'], 'receipt': (w['receipt'] or '')[:160]}
                    for w in writes if in_turn(w['i']) and w['path'] == review_file]
        if review_text is None and any(a['ok'] for a in attempts):
            # Written in a way the session cannot replay (python, an edit chain): the receipt names the version the binder
            # kept, and the binder's store holds its source.
            numbers = [int(m.group(1)) for a in attempts if a['ok'] for m in [re.search(r'→ prompt \S+ v(\d+)', a['receipt'])] if m]
            entry = next((b for b in run.binder if numbers and b.get('path') == review_file and b.get('version') == numbers[-1]
                          and (b.get('good') or {}).get('version') == numbers[-1]), None)
            if entry:
                source = os.path.join(run.root, '.harness', 'versions', f"{entry['good'].get('hash')}.txt")
                if os.path.exists(source):
                    review_text = open(source, encoding='utf-8', errors='replace').read()
        consults = [c for c in run.calls if c['name'] == 'consult' and in_turn(c['i'])]
        a0 = r.get('actions', run.actions_at(turn['t']))
        end_t = turn.get('end_t') or turn['t']
        cap_t = run.time_of_action(a0 + WINDOW_ACTIONS + 1)
        window_end = min(x for x in (turn['next_t'], cap_t, 1e18) if x is not None)
        after = lambda t: end_t < t <= window_end
        turn_writes = [w for w in writes if in_turn(w['i']) and w['path'] != review_file]
        # A later rewrite of the review's own file is the same prompt revised, counted apart from new components.
        after_writes = [w for w in writes if after(w['t']) and w['path'] != review_file]
        review_revisions = sum(1 for w in writes if after(w['t']) and w['path'] == review_file and w['ok'])
        comps = []
        for when, ws_ in (('turn', turn_writes), ('after', after_writes)):
            for w in ws_:
                use = use_of(run, w['path'], w['t'], None)
                comps.append({'when': when, 'path': w['path'], 'how': w['how'], 'ok': w['ok'],
                              'actions_after_review': run.actions_at(w['t']) - a0, 'use': use, 'used': used_flag(use),
                              'source_head': (w['content'] or '')[:400] if w['path'].endswith('.py') else None})
        checks = []
        for when, cond in (('turn', lambda m: in_turn(m['i'])), ('after', lambda m: after(m['t']))):
            for m in mchecks:
                if cond(m):
                    decided = sum(1 for c in run.claims if c.get('key') in m['keys'] and (ts(c.get('t')) or 0) > m['t']
                                  and c.get('result') in (True, False))
                    checks.append({'when': when, 'keys': m['keys'], 'decided_after': decided})
        reqs, seen_focus = [], {}
        for c in refines:
            if not (in_turn(c['i']) or after(c['t'])):
                continue
            focus = str(c['args'].get('focus'))[:300]
            if focus in seen_focus:
                seen_focus[focus]['repeats'] += 1
                continue
            seen_focus[focus] = {'when': 'turn' if in_turn(c['i']) else 'after', 'focus': focus, 'repeats': 0,
                                 'asks_component': bool(COMPONENT_REQUEST.search(focus)),
                                 'actions_after_review': run.actions_at(c['t']) - a0, 'error': c['error']}
            reqs.append(seen_focus[focus])
        refiner_edits = [{'path': e.get('path'), 'category': e.get('category'), 'why': str(e.get('why'))[:200],
                          'actions_after_review': run.actions_at(ts(e.get('t'))) - a0,
                          'agent_asked': any('the agent asked' in str(t) for t in (e.get('triggers') or []))}
                         for e in edits if end_t < (ts(e.get('t')) or 0) <= window_end]
        for e in refiner_edits:
            p = e['path'] or ''
            if COMPONENT.match(p):
                e['use'] = use_of(run, p, end_t, None)
                e['used'] = used_flag(e['use'])
        tests = [m.group(1).strip() for line in (review_text or '').splitlines() for m in [TEST_LINE.match(line.replace('**', '').replace('`', ''))] if m]
        level_now = run.level_at(a0)
        next_level_t = next((run.traj_t[i] for i in range(a0, len(run.traj)) if run.traj[i].get('level_changed')), None)
        out.append({
            'run': run.name(), 'root': run.root, 'model': run.cfg.get('model'), 'thinking': run.cfg.get('thinking'),
            'game': run.cfg.get('game'), 'observation': run.cfg.get('observation_delivery'),
            'fork': (run.cfg.get('fork') or {}).get('source'), 'fork_decision': (run.cfg.get('fork') or {}).get('decision'),
            'kind': kind, 'decision': turn['decision'], 't': turn['t'], 'ws_t': r.get('t'), 'actions': a0, 'level': level_now,
            'why': (turn['prompt'].split('\n')[0])[:200], 'review_file': review_file, 'review_text': review_text,
            'review_rebuilt': review_text is not None, 'review_write_attempts': attempts,
            'consults_in_turn': len(consults), 'consult_errors_in_turn': sum(1 for c in consults if consult_failed(c)),
            'tool_calls_in_turn': sum(1 for c in run.calls if in_turn(c['i'])),
            'tests_listed': tests, 'hints': hints(review_text),
            'turn_writes': [w['path'] for w in turn_writes], 'review_revisions_after': review_revisions,
            'components': comps, 'memory_checks': checks,
            'refine_requests': reqs, 'refiner_edits': refiner_edits, 'pins': test_pins(run, turn, review_file),
            'window_actions': (run.actions_at(window_end) - a0) if window_end < 1e17 else len(run.traj) - a0,
            'level_changed_in_window': bool(next_level_t and end_t < next_level_t <= window_end),
        })
    return out


def no_file_reason(rv):
    attempts = rv['review_write_attempts']
    if any(a['ok'] for a in attempts):
        return None
    receipts = ' '.join(a['receipt'] for a in attempts)
    if 'consults first' in receipts:
        return 'consult-first refusal'
    if 'ends here' in receipts:
        return 'tool-call limit'
    return 'no tool call in the turn' if not rv['tool_calls_in_turn'] else 'no write of the file'


def summarize(reviews, runs_info):
    out = []
    w = out.append
    w('# Review follow-up audit: generated tables\n')
    w('Written by tools/arc_review_followup_audit.py; the reading is in docs/reports/2026-10-26-review-followup-audit.md.\n')
    forks = sum(1 for r in runs_info if r['fork'])
    kinds = collections.Counter(rv['kind'] for rv in reviews)
    models = collections.Counter((rv['model'] or '?') for rv in reviews)
    w(f"Runs with review turns: {len(runs_info)} ({forks} forks). Unique review turns: {len(reviews)} "
      f"(stall {kinds['stall']}, level {kinds['level']}); copies of fork prefixes counted once.")
    w('By model: ' + ', '.join(f'{m} {n}' for m, n in models.most_common()) + '.')
    w('\n## 1. Did the turn produce its review file?\n')
    w('| outcome | stall | level |\n|---|---|---|')
    outcome = collections.Counter((no_file_reason(rv) or 'file written', rv['kind']) for rv in reviews)
    for o in ('file written', 'consult-first refusal', 'tool-call limit', 'no write of the file', 'no tool call in the turn'):
        if outcome[(o, 'stall')] or outcome[(o, 'level')]:
            w(f"| {o} | {outcome[(o, 'stall')]} | {outcome[(o, 'level')]} |")
    written = [rv for rv in reviews if not no_file_reason(rv)]
    labelled = [rv for rv in written if rv.get('label') is not None]
    named = [rv for rv in labelled if rv['label'].get('loop_costs')]
    w(f"\n## 2. Loop-level costs named (labelled by the reviewing agent)\n")
    w(f"Reviews with a file: {len(written)}; labelled: {len(labelled)}; naming at least one loop-level cost: {len(named)} "
      f"(stall {sum(1 for rv in named if rv['kind'] == 'stall')} of {sum(1 for rv in labelled if rv['kind'] == 'stall')}, "
      f"level {sum(1 for rv in named if rv['kind'] == 'level')} of {sum(1 for rv in labelled if rv['kind'] == 'level')}).")
    cats = collections.Counter(c for rv in named for c in rv['label']['loop_costs'])
    w('By category (a review can name several): ' + ', '.join(f'{c} {n}' for c, n in cats.most_common()) + '.')
    # The same category named again by the run's next review: the cost was not resolved in between.
    by_run = collections.defaultdict(list)
    for rv in labelled:
        by_run[rv['run']].append(rv)
    pairs = recurs = 0
    for rs in by_run.values():
        rs.sort(key=lambda r: r['t'])
        for a, b in zip(rs, rs[1:]):
            for c in a['label'].get('loop_costs') or []:
                pairs += 1
                recurs += c in (b['label'].get('loop_costs') or [])
    w(f"A named category named again by the same run's next review: {recurs} of {pairs} (review files mostly carry their "
      f"previous 'Wasted' lines forward, so this shows costs left unresolved, not new occurrences).")
    # Replays of known results (work memory's novelty field, runs since 2026-10-21) in the 20 actions before and after
    # each review that names repeats.
    cache, before, after, worse, counted = {}, [0, 0], [0, 0], 0, 0
    for rv in named:
        if 'repeat' not in rv['label']['loop_costs']:
            continue
        path = os.path.join(rv['root'], 'harness', 'trajectory.jsonl')
        traj = cache.setdefault(path, rows(path))
        if not any('novelty' in r for r in traj):
            continue
        a0 = rv['actions']
        b = [r for r in traj if a0 - 20 < r['n'] <= a0 and 'novelty' in r]
        a = [r for r in traj if a0 < r['n'] <= a0 + 20 and 'novelty' in r]
        if not b or not a:
            continue
        kb, ka = sum(r['novelty'] == 'known' for r in b), sum(r['novelty'] == 'known' for r in a)
        before[0] += kb; before[1] += len(b); after[0] += ka; after[1] += len(a)
        counted += 1
        worse += ka / len(a) >= kb / len(b)
    if counted:
        w(f"Reviews naming repeats, with work-memory novelty data: {counted}. Actions that replayed a known result: "
          f"{before[0]}/{before[1]} ({100 * before[0] / before[1]:.0f}%) in the 20 actions before the review, "
          f"{after[0]}/{after[1]} ({100 * after[0] / after[1]:.0f}%) in the 20 after; the share did not fall in {worse} of {counted}.")
    w('\n## 3. What followed a named cost (agent-authored, in the turn or the window after it)\n')
    follow = collections.Counter((rv['label'].get('followup') or 'none') for rv in named)
    w('| follow-up | reviews |\n|---|---|')
    for k in ('component', 'prose', 'none'):
        w(f'| {k} | {follow[k]} |')
    w('\nEvery agent-authored executable component in a review turn or window (whatever the review named):\n')
    w('| review | path | how | when | use |\n|---|---|---|---|---|')
    for rv in reviews:
        for c in rv['components']:
            if not c['path'].startswith('prompts/'):
                use = {k: v for k, v in c['use'].items() if v not in (None, False, 0)}
                w(f"| {rv['id']} | {c['path']} | {c['how']} | {c['when']} | {c['used']}: {use} |")
    w('\nAgent requests for a component through refine(focus) in a review turn or window:\n')
    w('| review | when | repeats | request |\n|---|---|---|---|')
    for rv in reviews:
        for q in rv['refine_requests']:
            if q['asks_component']:
                w(f"| {rv['id']} | {q['when']} (+{q['actions_after_review']} actions) | {q['repeats']} | {q['focus'][:150]} |")
    w('\nThe same refine(focus) text sent again in a review window (repeats beyond the first):\n')
    w('| review | repeats | request |\n|---|---|---|')
    for rv in reviews:
        for q in rv['refine_requests']:
            if q['repeats'] >= 3:
                w(f"| {rv['id']} | {q['repeats']} | {q['focus'][:120]} |")
    w('\n## 4. The review\'s own tests\n')
    pins = collections.Counter()
    for rv in written:
        pins['listed'] += len(rv['tests_listed'])
        pins['pinned'] += rv['pins']['pinned']
        pins['skipped'] += rv['pins']['skipped']
        for k, n in rv['pins']['outcomes'].items():
            pins[k] += n
    w(', '.join(f'{k} {n}' for k, n in pins.items()) + '.')
    w('\n## 5. Per review\n')
    w('| review | model | kind | action | file | loop costs named | follow-up | tests listed/pinned/played |\n|---|---|---|---|---|---|---|---|')
    for rv in reviews:
        lab = rv.get('label') or {}
        w(f"| {rv['id']} | {rv['model']} | {rv['kind']} | {rv['actions']} | {no_file_reason(rv) or 'yes'} | "
          f"{', '.join(lab.get('loop_costs') or []) or ('-' if lab else '?')} | {lab.get('followup', '') or ''} | "
          f"{len(rv['tests_listed'])}/{rv['pins']['pinned']}/{rv['pins']['outcomes'].get('met', 0)} |")
    w('\n## Runs\n')
    w('| run | model | fork | actions | levels | reviews | agent tools/libs | refine component requests | refiner tool edits (asked/other) |\n|---|---|---|---|---|---|---|---|---|')
    for r in runs_info:
        w(f"| {r['run']} | {r['model']} | {'yes' if r['fork'] else ''} | {r['actions']} | {r['levels']} | {r['reviews_logged']} | "
          f"{len(r['agent_tool_paths'])} | {len(r['refine_component_requests'])} | {r['refiner_tool_edits_agent_asked']}/{r['refiner_tool_edits_other']} |")
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('roots', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--labels')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    runs = discover(args.roots)
    reviews, seen, runs_info = [], {}, []

    def forked(root):
        cfg = os.path.join(root, 'run-config.json')
        return bool(os.path.exists(cfg) and (json.load(open(cfg, encoding='utf-8')).get('fork')))
    # A fork's session and logs start with its source's prefix: the source run keeps the reviews they share.
    for root in sorted(runs, key=lambda r: (forked(r), r)):
        run = Run(root)
        if str(run.cfg.get('provider', '')).lower() in ('scripted', 'mock', 'deterministic', 'fake'):
            continue  # smoke runs: the scripted provider's reviews say nothing about a model
        found = audit(run)
        writes = agent_writes(run)
        focuses = {str(c['args'].get('focus'))[:300] for c in run.calls if c['name'] == 'refine'}
        tool_edits = [e for e in run.refiner if e.get('kind') == 'edit' and str(e.get('path', '')).startswith(('tools/', 'lib/'))]
        runs_info.append({'run': run.name(), 'root': root, 'provider': run.cfg.get('provider'), 'model': run.cfg.get('model'),
                          'thinking': run.cfg.get('thinking'), 'observation': run.cfg.get('observation_delivery'),
                          'fork': (run.cfg.get('fork') or {}).get('source'),
                          'agent_tool_paths': sorted({w['path'] for w in writes if w['ok'] and w['path'].startswith(('tools/', 'lib/', 'observers/'))}),
                          'refine_component_requests': sorted(f for f in focuses if COMPONENT_REQUEST.search(f)),
                          'refiner_tool_edits_agent_asked': sum(1 for e in tool_edits if any('the agent asked' in str(t) for t in (e.get('triggers') or []))),
                          'refiner_tool_edits_other': sum(1 for e in tool_edits if not any('the agent asked' in str(t) for t in (e.get('triggers') or []))),
                          'actions': len(run.traj), 'levels': run.traj[-1].get('levels_completed') if run.traj else None,
                          'reviews_logged': len(found)})
        for rv in found:
            key = rv['ws_t']  # forks copy the prefix's rows with their timestamps: one review, many copies
            if key in seen:
                seen[key]['copies'].append(rv['run'])
                continue
            rv['copies'] = []
            rv['id'] = f"{rv['run']}#d{rv['decision']}"
            seen[key] = rv
            reviews.append(rv)
    labels = json.load(open(args.labels, encoding='utf-8')) if args.labels and os.path.exists(args.labels) else {}
    for rv in reviews:
        rv['label'] = labels.get(rv['id'])
    json.dump({'runs': runs_info, 'reviews': reviews}, open(os.path.join(args.out, 'reviews.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    with open(os.path.join(args.out, 'review_texts.md'), 'w', encoding='utf-8') as f:
        for rv in reviews:
            f.write(f"\n\n## {rv['id']} ({rv['kind']}, {rv['model']}, {rv['observation']}, action {rv['actions']}, level {rv['level']})\n")
            f.write(f"why: {rv['why']}\nhints: {', '.join(rv['hints']) or '-'}; copies: {', '.join(rv['copies']) or '-'}\n")
            f.write(f"turn: {rv['tool_calls_in_turn']} tool calls, consults {rv['consults_in_turn']} ({rv['consult_errors_in_turn']} errors); "
                    f"review-file writes: {[(a['how'], a['ok'], a['receipt'][:90]) for a in rv['review_write_attempts']]}\n")
            f.write(f"turn writes: {rv['turn_writes']}\n")
            f.write(f"components: {[(c['when'], c['path'], c['how'], c['used']) for c in rv['components']]}\n")
            f.write(f"memory checks: {[(m['when'], m['keys'], m['decided_after']) for m in rv['memory_checks']]}\n")
            f.write(f"refine requests: {[(q['when'], q['repeats'], q['focus'][:160]) for q in rv['refine_requests']]}\n")
            f.write(f"review file revised after: {rv['review_revisions_after']}; window actions: {rv['window_actions']}; "
                    f"level changed in window: {rv['level_changed_in_window']}\n")
            f.write(f"refiner edits: {[(e['path'], e.get('used'), e['agent_asked']) for e in rv['refiner_edits']]}\n")
            f.write(f"pins: {rv['pins']}\n")
            f.write('```\n' + (rv['review_text'] or '(review file not rebuilt from the session)') + '\n```\n')
    with open(os.path.join(args.out, 'summary.md'), 'w', encoding='utf-8') as f:
        f.write(summarize(reviews, runs_info))
    print(f"{len(runs)} runs, {len(reviews)} review turns; output in {args.out}")


if __name__ == '__main__':
    main()
