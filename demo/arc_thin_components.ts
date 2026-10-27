/** Python file conventions and execution; syntax inspection itself runs in WASI. */
import { arcSkillGuestProgram, SKILL_LIMITS, type GuestResult } from './arc_thin_skill_guest.ts';
import { evaluateTaskPython } from './pi_task_python.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
import { PythonKernel } from './pi_task_python_kernel.ts';
import type { ComponentSpec } from './arc_thin_binder.ts';

const NATIVE = String.raw`
import ast, io, sys, importlib.abc, importlib.util, builtins

RESERVED = ('arc_action', 'read', 'write', 'edit', 'ls', 'grep', 'python', 'memory', 'consult', 'refine', 'run_skill')
# Every tool has one interface: a dict of arguments (Continual Harness's run(state, args) contract; Prime calls plain
# python). No schema is derived from type hints, so there is no annotation to get wrong.
TOOL_PARAMETERS = {'type': 'object', 'properties': {'args': {'type': 'object'}}, 'additionalProperties': False}

def _first_comment(source):
    for line in source.splitlines():
        if line.strip().startswith('#'):
            return line.strip().lstrip('#').strip()
        if line.strip():
            return ''
    return ''

def _entry(tree):
    names = [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]
    return 'run' if 'run' in names else 'observe' if 'observe' in names else None

def _reads_args(tree, entry):
    """Whether a tool takes arguments when called: a script that reads args, or a run() that reads its args or has
    parameters of its own. observe(state) takes none; so do run(), and run(args), run(args, env) or run(state, args)
    whose body never reads args (the arg-less snapshots agents save: 13 of 13 gpt-saved tools on 2026-10-19)."""
    reads = lambda node: any(isinstance(n, ast.Name) and n.id == 'args' for n in ast.walk(node))
    if entry is None:
        return reads(tree)
    if entry == 'observe':
        return False
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run')
    params = [a.arg for a in fn.args.args]
    if fn.args.vararg or fn.args.kwarg or fn.args.kwonlyargs:
        return True
    if params in (['args'], ['args', 'env'], ['state', 'args']):
        return reads(fn)
    return bool(params)

def _predictor(tree):
    """A tool that defines predict(state, action): run before every action, its returned prediction is scored."""
    return any(isinstance(n, ast.FunctionDef) and n.name == 'predict' and len(n.args.args) == 2 for n in tree.body)

def _guard(tree):
    """A tool that defines admit(state, action): a pure, read-only check before the environment action boundary."""
    fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'admit'), None)
    if fn is None:
        return False
    if len(fn.args.args) != 2 or fn.args.vararg or fn.args.kwarg or fn.args.kwonlyargs:
        raise ValueError('admit must have exactly the parameters (state, action)')
    return True

def _inspect(req):
    path = req['path']
    name = path.split('/')[-1][:-3]
    top = path.split('/')[0]
    tree = ast.parse(req['source'], path)
    describe = (ast.get_docstring(tree) or _first_comment(req['source']) or ('saved python ' + name)).splitlines()[0][:120]
    if top == 'lib':
        return {'name': name, 'kind': 'library', 'description': describe, 'enabled': True}
    if name in RESERVED:
        raise ValueError('tool name is reserved by the foundation')
    head = [line.strip() for line in req['source'].splitlines()[:10]]
    mount_lines = [line[8:].strip() for line in head if line.startswith('# mount:')]
    if len(mount_lines) > 1:
        raise ValueError('one # mount: declaration is allowed')
    mount = [part.strip() for part in mount_lines[0].split(',')] if mount_lines else []
    if mount and (not all(part in ('decision', 'action', 'feedback') for part in mount) or len(set(mount)) != len(mount)):
        raise ValueError('mount phases must be decision, action and/or feedback')
    if mount:
        fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'on_event'), None)
        if fn is None or [a.arg for a in fn.args.args] != ['state', 'event'] or fn.args.vararg or fn.args.kwarg or fn.args.kwonlyargs:
            raise ValueError('a mount needs on_event(state, event)')
    off = '# view: off' in head or '# observe: off' in head
    acts = 'env.act(' in req['source']
    predictor = _predictor(tree)
    guard = _guard(tree)
    if mount and (predictor or guard or '# view: on' in head):
        raise ValueError('use on_event for mounted behavior; do not combine mount with view, predict or admit')
    if (guard or mount) and acts:
        raise ValueError('an action guard or loop mount cannot call env.act')
    # A view is a tool whose output is shown after every new state (observers/ is the older place for views). Saved code
    # that takes no arguments, does not act and predicts nothing is one by default: it waits for no call (2026-10-20,
    # docs/plans/2026-10-20-loop-bound-artifacts.md A2); '# view: off' keeps it a plain tool.
    default = top == 'tools' and not acts and not predictor and not guard and not mount and not _reads_args(tree, _entry(tree))
    view = not mount and (top == 'observers' or '# view: on' in head or default) and not off
    if view and acts:
        raise ValueError('a view runs after every new state and cannot act: remove "# view: on" or the env.act call')
    return {'name': name, 'kind': 'tool', 'description': describe, 'parameters': TOOL_PARAMETERS, 'view': view,
            'predictor': predictor, 'guard': guard, 'mount': mount, 'enabled': not (top == 'observers' and off)}

# Run as a live kernel (pi_task_python_kernel.py), the guest has _rpc: it serves cell after cell in one namespace,
# and asks the host for actions and files where the code asks, instead of ending and being replayed.
_kernel = {'live': callable(globals().get('_rpc'))}
_kernel_modules = set()
class _NeedFile(BaseException):
    pass
class _StateDict(dict):
    """The runtime's state: a dict, of its own type so the python session can refer to it instead of copying it."""

def _begin(req):
    """What belongs to one cell. In a live kernel the namespace, definitions and the runtime's own modules stay."""
    global _req, _sources, _files, _writes, _ops, _available, _state, _warnings
    _req = req
    _sources = req.get('sources') or {}
    _files = dict(req.get('files') or {})
    _writes = {}
    _ops = []
    _available = set(req.get('file_names') or [])
    _state = _StateDict(req.get('state') or {})
    if isinstance(_state.get('history'), dict):
        _state['history'] = _History(_state['history'])
    # Continual Harness's observations (ARC_THIN_OBSERVATION=ch) arrive with hex rows, like act feedback; code sees int grids.
    for _o in _state.get('observations') or []:
        if isinstance(_o, dict) and isinstance(_o.get('frame'), list):
            _o['frame'] = [_grid(f) for f in _o['frame']]
    _warnings = []
    # Workspace modules are imported from this cell's sources; a name already bound keeps what it was bound to.
    for name in _kernel_modules:
        sys.modules.pop(name, None)
    _kernel_modules.clear()

def _need(path):
    """A workspace file this cell did not receive: a live kernel asks the host for it, a one-shot run restarts with it."""
    if not _kernel['live']:
        raise _NeedFile(path)
    reply = _rpc({'t': 'file', 'path': path})
    if reply.get('error'):
        raise FileNotFoundError('%s: %s' % (path, reply['error']))
    _files.update(reply.get('files') or {})

def _path(path):
    path = str(path).replace('\\', '/')
    if path.startswith('/') or ':' in path or any(p == '..' or p.startswith('.') and p != '.' for p in path.split('/')):
        raise PermissionError('invalid workspace path')
    return '/'.join(p for p in path.split('/') if p not in ('', '.'))

class _Writer(io.StringIO):
    def __init__(self, path, initial=''):
        super().__init__(initial)
        self.path = path
    def close(self):
        if not self.closed:
            _writes[self.path] = self.getvalue()
            _files[self.path] = self.getvalue()
            _available.add(self.path)
            _ops.append({'op': 'write', 'path': self.path, 'content': self.getvalue()})
        super().close()

def _open(path, mode='r', *args, **kwargs):
    path = _path(path)
    if path in _available and path not in _files and path not in _sources and ('a' in mode or 'r' in mode):
        _need(path)
    if any(c in mode for c in 'wax+'):
        if _session_flags.get('loading'):
            raise PermissionError('no workspace writes while the python session is restored or checkpointed')
        if not _req.get('allow_writes') or path.split('/')[0] in ('data', 'results'):
            raise PermissionError('workspace path is read-only in this execution')
        if 'b' in mode: raise ValueError('workspace writes must be text')
        if 'x' in mode and (path in _available or path in _files or path in _sources): raise FileExistsError(path)
        stream = _Writer(path, _files.get(path, '') if 'a' in mode else '')
        if 'a' in mode: stream.seek(0, 2)
        return stream
    if path not in _files and path not in _sources: raise FileNotFoundError(path)
    text = _files.get(path, _sources.get(path, ''))
    return io.BytesIO(text.encode('utf-8')) if 'b' in mode else io.StringIO(text)

class _Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname, path=None, target=None):
        rel = fullname.replace('.', '/')
        if rel + '.py' in _sources: return importlib.util.spec_from_loader(fullname, self)
        if any(p.startswith(rel + '/') for p in _sources): return importlib.util.spec_from_loader(fullname, self, is_package=True)
    def create_module(self, spec): return None
    def exec_module(self, module):
        rel = module.__name__.replace('.', '/') + '.py'
        _kernel_modules.add(module.__name__)
        module.__dict__.update({'state': _state, 'grid': _state.get('grid'), 'history': _state.get('history'),
                                'prev_grid': _state.get('prev_grid'), 'artifacts': _state.get('artifacts') or {}})
        if rel in _sources: exec(compile(_sources[rel], rel, 'exec'), module.__dict__)

def _remove(path):
    if _session_flags.get('loading'): raise PermissionError('no workspace mutation during session recovery')
    path = _path(path)
    if not _req.get('allow_writes') or path.split('/')[0] in ('data', 'results'):
        raise PermissionError('workspace path is read-only in this execution')
    if path not in _files and path not in _sources and path not in _available: raise FileNotFoundError(path)
    _files.pop(path, None)
    _sources.pop(path, None)
    _available.discard(path)
    _ops.append({'op': 'delete', 'path': path})

def _rename(src, dst):
    if _session_flags.get('loading'): raise PermissionError('no workspace mutation during session recovery')
    src, dst = _path(src), _path(dst)
    if not _req.get('allow_writes') or any(p.split('/')[0] in ('data', 'results') for p in (src, dst)):
        raise PermissionError('workspace path is read-only in this execution')
    if src in _available and src not in _files and src not in _sources: _need(src)
    if src not in _files and src not in _sources: raise FileNotFoundError(src)
    _files[dst] = _files.get(src, _sources.get(src, ''))
    _files.pop(src, None)
    _sources.pop(src, None)
    _sources.pop(dst, None)
    _available.discard(src)
    _available.add(dst)
    _ops.append({'op': 'move', 'path': src, 'destination': dst})

def _names():
    return set(_available) | set(_files) | set(_sources)

# The workspace's file names are known without their contents, so listing needs no file transfer. Without this,
# os.listdir('data') failed with ENOENT in the 2026-10-12 real run and the agent concluded data/ did not exist.
_DIRS = ('data', 'notes', 'prompts', 'lib', 'tools', 'observers', 'skills', 'agents', 'roles', 'artifacts', 'results')
def _listdir(path='.'):
    prefix = _path(path)
    below = prefix + '/' if prefix else ''
    found = sorted({name[len(below):].split('/')[0] for name in _names() if name.startswith(below)} | (set(_DIRS) if not prefix else set()))
    if not found and prefix.split('/')[0] not in _DIRS: raise FileNotFoundError(path)
    return found
def _isdir(path):
    prefix = _path(path)
    return not prefix or prefix in _DIRS or any(name.startswith(prefix + '/') for name in _names())
def _isfile(path):
    return _path(path) in _names()

class _NeedAct(BaseException):
    pass
class ActStopped(Exception):
    """The runtime stopped acting for this call (level change, game end, the action limit); the actions taken stand."""

def _grid(rows):
    # Observations come back as one hex character per cell to keep the replayed input small.
    return [[int(c, 16) for c in row] for row in rows] if isinstance(rows, list) and rows and isinstance(rows[0], str) else rows

class _Env:
    """What foreground code works with: the state and its history, and act(), which takes one action through the same
    boundary as arc_action and returns what came back, so the code decides whether to go on (closed loop)."""
    def __init__(self):
        self.state = _state
        self.grid = _state.get('grid')
        self.prev_grid = _state.get('prev_grid')
        self.history = _state.get('history')
        self.artifacts = _state.get('artifacts') or {}
        self.memory = {'facts': _state.get('memory'), 'hypotheses': _state.get('hypotheses'), 'strategies': _state.get('strategies')}
        self.acted = 0
        self.stopped = None
        self._namespace = _ns
    def __getitem__(self, key):
        return self.state[key]
    def get(self, key, default=None):
        return self.state.get(key, default)
    def frame(self, n):
        return self.history.grid(n)
    def act(self, action, x=None, y=None, predict=None):
        if isinstance(action, (list, tuple)):
            return self._act_list(action)
        if isinstance(action, dict):
            # One entry of an action list ({"name": ..., "x": ..., "y": ...}) plays as that action.
            entry = action
            action = entry.get('name', entry.get('action'))
            x, y = entry.get('x', x), entry.get('y', y)
            predict = entry.get('predict', predict)
        if _session_flags.get('loading'):
            raise PermissionError('no action while the python session is restored')
        if not _req.get('allow_act'):
            raise PermissionError('this execution is read-only or has no action capability')
        call = {'action': str(action).upper()}
        if x is not None and y is not None: call.update(x=int(x), y=int(y))
        if predict is not None: call['predict'] = predict
        return self._act_call(call)
    def _act_list(self, actions):
        """Continual Harness's take_actions from code: the entries run in order as one batch; an entry without a name, or
        one the host refuses, ends the list, and so do a level change, the game's end and a missed prediction (as in an
        arc_action list). An entry may be a bare name, and 'action' may stand for 'name', as arc_action reads them.
        Returns what CH returns."""
        if _session_flags.get('loading'):
            raise PermissionError('no action while the python session is restored')
        if not _req.get('allow_act'):
            raise PermissionError('this execution is read-only or has no action capability')
        def coord(value):
            try: return max(0, min(63, int(value)))
            except (TypeError, ValueError): return 0
        total, executed, terminal, level_changed, unread = len(actions), 0, False, False, None
        levels = self.state.get('levels_completed')
        for position, item in enumerate(actions, start=1):
            if isinstance(item, str):
                item = {'name': item}
            if isinstance(item, dict) and 'name' not in item and 'action' in item:
                item = dict(item, name=item['action'])
            if not isinstance(item, dict) or 'name' not in item:
                unread = f"entry {position}: missing 'name' field"
                break
            call = {'action': str(item['name']).upper(), 'batch': [position, total]}
            if item.get('x') is not None and item.get('y') is not None:
                call.update(x=coord(item['x']), y=coord(item['y']))
            if item.get('predict') is not None: call['predict'] = item['predict']
            try:
                feedback = self._act_call(call)
            except ActStopped:
                break
            executed += 1
            if feedback.get('state') in ('WIN', 'GAME_OVER'):
                terminal = True
                break
            if feedback.get('levels_completed') != levels:
                level_changed = True
                break
            if feedback.get('missed'):
                break
        if not executed:
            raise ActStopped(self.stopped or 'take_actions executed no actions' + (f' ({unread})' if unread else '') +
                             '; send a non-empty valid actions list using the currently available actions')
        frame = self.state.get('frames') or ([self.grid] if self.grid else [])
        last = {'frame': frame, 'state': self.state.get('state'), 'score': self.state.get('levels_completed'),
                'levels_completed': self.state.get('levels_completed'), 'available_actions': self.state.get('available_actions')}
        return {'executed_count': executed, 'last_frame': last, 'frame': last, 'terminal': terminal, 'level_changed': level_changed,
                'state': last['state'], 'score': last['score'], 'available_actions': last['available_actions']}
    def _act_call(self, call):
        if self.stopped: raise ActStopped(self.stopped)
        if _kernel['live']:
            # The cell waits here for the action's feedback and goes on; nothing before this line runs again.
            record = _rpc({'t': 'act', 'call': call})
            if record.get('error'):
                raise PermissionError(record['error'])
            self.acted += 1
        else:
            done = _req.get('acts') or []
            if self.acted >= len(done):
                raise _NeedAct(call)
            record = done[self.acted]
            if record['call'] != call:
                raise RuntimeError('acting code must repeat the same act() calls when it is replayed; avoid randomness and time')
            self.acted += 1
        if record.get('stopped'):
            # Code that catches this and calls act() again is refused here, without another host round trip.
            self.stopped = record['stopped']
            raise ActStopped(self.stopped)
        observation = dict(record['observation'])
        observation['grid'] = _grid(observation.get('grid'))
        self._refresh(observation)
        return observation
    def _refresh(self, observation):
        before = self.grid
        self.prev_grid, self.grid = before, observation['grid']
        self.state.update({k: observation[k] for k in ('state', 'levels_completed', 'available_actions', 'action_budget') if k in observation})
        self.state.update({'grid': self.grid, 'prev_grid': before})
        if 'frames' in observation:
            self.state['frames'] = [_grid(frame) for frame in observation['frames']]
        else:
            self.state.pop('frames', None)  # never advertise an earlier animation as current
        row = observation.get('transition')
        if row and isinstance(self.history, _History):
            n = row['n']
            if n != len(self.history._rows) + 1:
                raise RuntimeError('action feedback does not extend the canonical history')
            self.history._rows.append(_Transition(row))
            after = self.grid
            if before and after and len(before) == len(after) and all(len(a) == len(b) for a, b in zip(before, after)) and self.history._base is not None:
                self.history._deltas[str(n)] = [[x, y, before[y][x], v] for y, line in enumerate(after)
                                                for x, v in enumerate(line) if before[y][x] != v]
            else:
                self.history.base_n = n if after else None
                self.history._base, self.history._deltas = after or None, {}
        self._namespace.update({'state': self.state, 'grid': self.grid, 'prev_grid': before, 'history': self.history})
    def restore(self, path, version):
        """Bring back an earlier version of a harness file (it becomes the newest version)."""
        if _session_flags.get('loading'): raise PermissionError('no workspace mutation during session recovery')
        if not _req.get('allow_writes'): raise PermissionError('workspace path is read-only in this execution')
        _ops.append({'op': 'restore', 'path': _path(path), 'version': int(version)})
    def remember(self, **args):
        """Update memory with the memory tool's arguments (op/key/text, set, delete, hypotheses, tests, strategies).
        Applied when the cell ends, with the cell's file writes; the receipt comes with the cell's result."""
        if _session_flags.get('loading'): raise PermissionError('no memory update during session recovery')
        if not _req.get('allow_writes'): raise PermissionError('memory is read-only in this execution')
        _ops.append({'op': 'memory', 'args': json.loads(json.dumps(args))})

    def meta_decide(self, choice, reason):
        """Close the single pending harness trial after the requested file change is saved."""
        if _session_flags.get('loading'): raise PermissionError('no meta decision during session recovery')
        if not _req.get('allow_writes'): raise PermissionError('meta decision is unavailable in a read-only execution')
        _ops.append({'op': 'meta_decide', 'choice': str(choice), 'reason': str(reason)[:300]})

# Python session: the default computation workspace (Prime Agent's persistent kernel, adapted to a fresh sandbox per
# call). After every python call the whole user namespace is checkpointed, so in-place changes, deletions, common
# types and shared references survive, and nothing has to be saved by hand.
#   - Values are pickled inside the sandbox; the host stores the bytes and never unpickles them.
#   - Functions and classes are re-run from the source of their def/class statement, in the order they were first
#     defined, with acting, workspace writes and printing disabled: restoring never repeats an environment action.
#   - The runtime's own objects (state, history, env) are never stored; a value that refers to one is re-attached to
#     the current one. The names the runtime provides (grid, state, ...) are rebuilt from canonical history each call.
#   - What cannot be kept is reported by name with the reason. Nothing is dropped silently.
import pickle, zlib, base64, hashlib, types, textwrap, contextlib, marshal

def _row_runs(row, x0, bg):
    out, start = [], 0
    for x in range(1, len(row) + 1):
        if x < len(row) and row[x] == row[start]:
            continue
        if row[start] != bg:
            out.append('%d:%s' % (x0 + start, row[start]) if x - 1 == start else '%d-%d:%s' % (x0 + start, x0 + x - 1, row[start]))
        start = x
    return ' '.join(out)

def show(g=None, x0=0, y0=0, x1=None, y1=None, bg=None):
    """Print a grid (default: the current one) or the region x0..x1, y0..y1 (inclusive) as row runs: x ranges and
    their color, the background (default: the most common color) left out, equal consecutive rows merged. Lossless,
    with coordinates written out, and about a tenth of the tokens of printing digit rows."""
    g = _state.get('grid') if g is None else g
    if not g:
        print('show: no grid')
        return
    rows = [list(r[x0:None if x1 is None else x1 + 1]) for r in g[y0:None if y1 is None else y1 + 1]]
    if bg is None:
        counts = {}
        for r in rows:
            for v in r:
                counts[v] = counts.get(v, 0) + 1
        bg = max(counts, key=counts.get) if counts else 0
    groups = []
    for i, r in enumerate(rows):
        text = _row_runs(r, x0, bg)
        if groups and groups[-1][2] == text:
            groups[-1][1] = y0 + i
        else:
            groups.append([y0 + i, y0 + i, text])
    width = len(rows[0]) if rows else 0
    print('rows y%d-%d, x%d-%d; background %s not listed; rows not listed are all background:' % (y0, y0 + len(rows) - 1, x0, x0 + width - 1, bg))
    for a, b, text in groups:
        if text:
            print(('y%d' % a if a == b else 'y%d-%d' % (a, b)) + ': ' + text)

def cell(k, a=None, b=None):
    """Run your earlier python call P<k> again, here and on the current state, or only its lines a to b (work memory:
    every python result starts with its address, [P12], and names the lines it retyped from an earlier call). Returns the
    value of its final expression, as that call did."""
    code = (_req.get('cells') or {}).get(str(k))
    if code is None:
        raise KeyError('no python call P%s to run again' % k)
    if a is not None:
        code = '\n'.join(code.replace('\r\n', '\n').split('\n')[int(a) - 1:int(a if b is None else b)])
    tree = ast.parse(code, '<P%s>' % k, 'exec')
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, '<P%s>' % k, 'exec'), _ns)
    return eval(compile(ast.Expression(last.value), '<P%s>' % k, 'eval'), _ns) if last is not None else None

_SESSION_SKIP = {'state', 'grid', 'history', 'prev_grid', 'artifacts', 'skill', 'args', 'env', 'ActStopped', 'show', 'cell'}
_SESSION_RAW_BYTES = 2 * 1024 * 1024
_session_flags = {}
_session_defs = {}
_session_gone = []
_runtime = {}

class _Gone:
    """Stands in for a value whose definition no longer loads."""
    def __init__(self, *args, **kwargs): pass
    def __call__(self, *args, **kwargs): return self
    def __setstate__(self, state): pass
    def __reduce__(self): raise pickle.PicklingError('its definition no longer loads')

# Helpers a checkpoint refers to by name, in a module of their own so pickle finds them on both sides.
def _runtime_ref(key):
    return _runtime.get(key)
def _module_ref(name):
    try:
        return __import__(name, fromlist=['*'])
    except BaseException:
        _session_gone.append('module ' + name)
        return _Gone()
def _transition(row):
    return _Transition(row)
def _function_ref(name, code, defaults, kwdefaults, attributes, annotations):
    # Construct code without executing defaults/decorators. Its globals are the freshly rebound namespace.
    fn = types.FunctionType(marshal.loads(code), _ns, name, defaults)
    fn.__module__ = 'skill'
    fn.__kwdefaults__, fn.__annotations__ = kwdefaults, annotations
    fn.__dict__.update(attributes)
    return fn
_helpers = types.ModuleType('_arc_session')
for _helper in (_runtime_ref, _module_ref, _transition, _function_ref, _Gone):
    _helper.__module__ = '_arc_session'
    setattr(_helpers, _helper.__name__, _helper)
sys.modules['_arc_session'] = _helpers

def _session_own(obj, name):
    return callable(obj) and getattr(obj, '__module__', None) == 'skill' and getattr(obj, '__qualname__', '') == name

class _SessionPickler(pickle.Pickler):
    # reducer_override is not called for plain ints, floats, strings, lists, dicts and tuples, so data pickles at C
    # speed; the runtime's state dict is a dict subclass (_StateDict) so that it is seen here.
    def reducer_override(self, obj):
        for key, owned in _runtime.items():
            if obj is owned:
                return (_runtime_ref, (key,))
        if isinstance(obj, types.ModuleType):
            return (_module_ref, (obj.__name__,))
        if isinstance(obj, _Transition):
            return (_transition, (dict(obj),))
        if isinstance(obj, (_History, _Env)):
            raise pickle.PicklingError('a runtime object: take it from history or env again')
        if isinstance(obj, (types.FunctionType, type)) and getattr(obj, '__module__', None) == 'skill':
            name = getattr(obj, '__qualname__', '')
            if name not in _session_defs:
                raise pickle.PicklingError('%s is not defined by a def or class statement at the top level' % (name or 'it'))
            if _ns.get(name) is not obj:
                raise pickle.PicklingError('it refers to an earlier %s, which has been redefined or deleted' % name)
            if isinstance(obj, types.FunctionType):
                if obj.__closure__: raise pickle.PicklingError('a closure requires an explicit self-contained definition')
                return (_function_ref, (name, marshal.dumps(obj.__code__), obj.__defaults__, obj.__kwdefaults__, obj.__dict__, obj.__annotations__))
        return NotImplemented

class _SessionUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        try:
            return super().find_class(module, name)
        except _NeedFile:
            raise
        except BaseException:
            _session_gone.append(module + '.' + name)
            return _Gone

def _session_bytes(values):
    buffer = io.BytesIO()
    _SessionPickler(buffer, protocol=4).dump(values)
    return buffer.getvalue()

def _session_module():
    # User code runs as the module 'skill', so kept values can refer to the functions and classes it defines.
    global _ns
    module = types.ModuleType('skill')
    module.__dict__.update(_ns)
    sys.modules['skill'] = module
    _ns = module.__dict__

def _session_load(session):
    """Bring back what earlier python calls left. Returns what did not come back, with reasons."""
    report = {'failed_defs': [], 'gone': []}
    mark = len(_ops)
    _session_flags['loading'] = True
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            for name, src in session.get('defs') or []:
                try:
                    tree = ast.parse(src)
                    # New checkpoints contain function code/defaults in the same object graph as all values.
                    # Source remains for compatibility and inspection; older blobs still use source restoration.
                    if session.get('functions'):
                        for node in tree.body:
                            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                                node.decorator_list = []
                                node.args.defaults = []
                                node.args.kw_defaults = [None for _ in node.args.kw_defaults]
                                node.returns = None
                                for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs, node.args.vararg, node.args.kwarg]:
                                    if arg is not None: arg.annotation = None
                    exec(compile(tree, '<session %s>' % name, 'exec'), _ns)
                    _session_defs[name] = src
                except _NeedFile:
                    raise
                except BaseException as problem:
                    report['failed_defs'].append([name, (type(problem).__name__ + ': ' + str(problem))[:120]])
        blob = session.get('blob')
        if blob:
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    values = _SessionUnpickler(io.BytesIO(zlib.decompress(base64.b64decode(blob)))).load()
            except _NeedFile:
                raise
            except BaseException as problem:
                report['load_error'] = (type(problem).__name__ + ': ' + str(problem))[:200]
                return report
            for name in [k for k, v in values.items() if v is _Gone or isinstance(v, _Gone)]:
                del values[name]
                report['gone'].append(name)
            if report['gone']:
                report['gone_refs'] = sorted(set(_session_gone))[:8]
            _ns.update(values)
    finally:
        _session_flags['loading'] = False
        del _ops[mark:]
    return report

def _session_statements(tree):
    """def/class statements that run at module level, also inside if/try/with/for blocks."""
    found, pending = [], list(tree.body)
    while pending:
        node = pending.pop(0)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            found.append(node)
        elif isinstance(node, (ast.If, ast.For, ast.While, ast.Try, ast.With)):
            for field in ('body', 'orelse', 'finalbody'):
                pending.extend(getattr(node, field, None) or [])
            for handler in getattr(node, 'handlers', None) or []:
                pending.extend(handler.body)
    return found

def _brief(value):
    """A few characters saying what a name holds, for the line that lists the session to the agent."""
    if value is None or isinstance(value, (bool, int, float)):
        text = repr(value)
        return text if len(text) <= 20 else type(value).__name__
    if isinstance(value, str):
        return repr(value) if len(value) <= 20 else 'str[%d]' % len(value)
    if isinstance(value, types.ModuleType):
        return 'module'
    if isinstance(value, type):
        return 'class'
    if callable(value):
        return 'function'
    try:
        size = len(value)
    except BaseException:
        return type(value).__name__
    if isinstance(value, tuple) and size <= 4 and all(v is None or isinstance(v, (bool, int, float)) for v in value):
        return repr(value) if len(repr(value)) <= 20 else 'tuple[%d]' % size
    first = value[0] if isinstance(value, (list, tuple)) and size else None
    if isinstance(first, (list, tuple)) and all(isinstance(r, (list, tuple)) and len(r) == len(first) for r in value[:64]):
        return '%s[%dx%d]' % (type(value).__name__, size, len(first))
    return '%s[%d]' % (type(value).__name__, size)

def _signature(name, source):
    """A definition's parameters as written, '(grid, color)', so the session listing shows how to call it; 'class' for a class."""
    try:
        node = next(n for n in ast.parse(source).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == name)
    except BaseException:
        return ''
    if isinstance(node, ast.ClassDef):
        return 'class'
    try:
        return '(%s)' % ast.unparse(node.args)
    except BaseException:
        return ''

def _session_dump(code, session, base, before, loaded):
    """Checkpoint the namespace as it is now. All or nothing: over capacity or unverifiable means no checkpoint."""
    lines = code.splitlines()
    try:
        tree = ast.parse(code)
    except SyntaxError:
        tree = None
    statements = _session_statements(tree) if tree is not None else []
    for node in statements:
        obj = _ns.get(node.name)
        if _session_own(obj, node.name) and id(obj) != before.get(node.name):
            first = min([d.lineno for d in node.decorator_list] + [node.lineno])
            _session_defs[node.name] = textwrap.dedent('\n'.join(lines[first - 1:node.end_lineno])) + '\n'
    for name in list(_session_defs):
        if not _session_own(_ns.get(name), name):
            del _session_defs[name]
    values = {k: _ns[k] for k in _ns if not k.startswith('_') and k not in base and k not in _SESSION_SKIP
              and (k not in _session_defs or isinstance(_ns[k], types.FunctionType))}
    brief = {k + '()': _signature(k, src) for k, src in _session_defs.items()}
    brief.update({k: _brief(v) for k, v in values.items() if k not in _session_defs})
    unsupported = []
    try:
        raw = _session_bytes(values)
    except BaseException:
        kept = {}
        for k, v in values.items():
            try:
                _session_bytes({k: v})
                kept[k] = v
            except BaseException as problem:
                unsupported.append([k, (type(v).__name__ + ': ' + str(problem))[:160]])
        values = kept
        raw = _session_bytes(values)
    uses = []
    if tree is not None:
        own = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
        own |= {node.name for node in statements}
        own |= {(a.asname or a.name).split('.')[0] for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
        uses = sorted(({n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)} & loaded) - own)
    out = {'unsupported': unsupported, 'uses': uses, 'brief': brief}
    defs = [[k, v] for k, v in _session_defs.items()]
    sha = hashlib.sha256(raw).hexdigest()
    if sha == session.get('sha') and defs == (session.get('defs') or []):
        out['unchanged'] = True
        return out
    packed = base64.b64encode(zlib.compress(raw, 6)).decode('ascii')
    chars = len(packed) + sum(len(src) for _, src in defs)
    cap = int(session.get('cap') or 0)
    if len(raw) > _SESSION_RAW_BYTES or (cap and chars > cap):
        sizes = sorted(((len(zlib.compress(_session_bytes({k: v}), 6)) * 4 // 3, k) for k, v in values.items()), reverse=True)
        sizes += sorted(((len(src), k + '()') for k, src in defs), reverse=True)
        out['over'] = {'chars': chars, 'cap': cap, 'raw_bytes': len(raw), 'largest': [[k, n] for n, k in sorted(sizes, reverse=True)[:5]]}
        return out
    try:
        _SessionUnpickler(io.BytesIO(raw)).load()
    except BaseException as problem:
        out['error'] = 'it could not be read back (%s)' % (type(problem).__name__ + ': ' + str(problem))[:160]
        return out
    out.update({'defs': defs, 'blob': packed, 'sha': sha, 'names': sorted(k for k in values if k not in _session_defs),
                'functions': True, 'chars': chars, 'raw_bytes': len(raw)})
    return out

def _call(req, env):
    """One contract for every tool: a dict of arguments. A script reads args and env; run(args[, env]) is called with
    them; an older run(**kwargs), run(state, args) or observe(state) keeps working. With 'predict' in the request, a
    predictor's predict(state, action) is called for that action, or for each of a list of actions in this one execution."""
    source = _sources.get(req['path'], '')
    inner = (req.get('args') or {}).get('args') or {}
    if req.get('mount_event') is not None:
        module = __import__(req['path'][:-3].replace('/', '.'), fromlist=['*'])
        env._namespace = module.__dict__
        return _jsonable(module.on_event(_state, dict(req['mount_event'])))
    if req.get('predict') is not None:
        module = __import__(req['path'][:-3].replace('/', '.'), fromlist=['*'])
        env._namespace = module.__dict__
        if not isinstance(req['predict'], list):
            return _jsonable(module.predict(_state, dict(req['predict'])))
        out = []
        for action in req['predict']:
            try:
                out.append({'value': _jsonable(module.predict(_state, dict(action)))})
            except Exception as error:
                out.append({'error': (type(error).__name__ + ': ' + str(error))[:200]})
        return out
    if req.get('guard') is not None:
        module = __import__(req['path'][:-3].replace('/', '.'), fromlist=['*'])
        env._namespace = module.__dict__
        return _jsonable(module.admit(_state, dict(req['guard'])))
    entry = _entry(ast.parse(source, req['path']))
    if entry is None:
        req['code'] = source
        _ns['args'], _ns['env'] = inner, env
        return _exec(req)
    module = __import__(req['path'][:-3].replace('/', '.'), fromlist=['*'])
    env._namespace = module.__dict__
    if entry == 'observe':
        return _jsonable(module.observe(_state))
    params = [a.arg for a in next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'run').args.args]
    if params[:1] == ['args'] and len(params) <= 2:
        value = module.run(inner, env) if len(params) == 2 else module.run(inner)
    elif params[:2] == ['state', 'args']:
        value = module.run(_state, inner)
    else:
        value = module.run(**inner)
    return _jsonable(value)

def _session_cell(env):
    """Bring the python session in for one cell: restore it from its checkpoint, or in a live kernel, where it already
    is, point the names that held the runtime's objects at the current ones (as a restore does)."""
    _session = _req['session']
    if not (_kernel['live'] and _kernel.get('module')):
        _session_module()
        _kernel['module'] = True
    previous = dict(_runtime)
    _ns.update({'state': _state, 'grid': _state.get('grid'), 'history': _state.get('history'),
                'prev_grid': _state.get('prev_grid'), 'artifacts': _state.get('artifacts') or {}})
    _runtime.update({'state': _state, 'history': _state.get('history'), 'env': env})
    if _kernel['live'] and _kernel.get('loaded'):
        for name, value in list(_ns.items()):
            for key, old in previous.items():
                if value is old and old is not _runtime.get(key):
                    _ns[name] = _runtime[key]
        base, loaded = _kernel['base'], {}
    else:
        base = set(_ns)
        loaded = _session_load(_session)
        if _kernel['live'] and not loaded.get('load_error'):
            _kernel['loaded'], _kernel['base'] = True, base
    _req['session_ns'] = True
    return base, loaded, {name: id(_ns.get(name)) for name in _session_defs}, set(_ns) - base

def _cell(req):
    _begin(req)
    try:
        if _req['mode'] == 'inspect':
            return {'ok': True, 'value': _inspect(_req)}
        builtins.open = _open
        import os, random
        os.remove = os.unlink = _remove
        os.rename = os.replace = _rename
        os.listdir = _listdir
        os.path.isdir, os.path.isfile = _isdir, _isfile
        os.path.exists = lambda path: _isfile(path) or _isdir(path)
        if not any(isinstance(finder, _Loader) for finder in sys.meta_path):
            sys.meta_path.insert(0, _Loader())
        if not _kernel['live']:
            # Acting code is replayed from the start after every action, so it must be deterministic.
            random.seed(0)
        _req['state'] = _state
        env = _Env()
        _req['native_env'] = True
        _ns['ActStopped'] = ActStopped
        _ns['show'] = show
        _ns['cell'] = cell
        try:
            if _req['mode'] == 'exec':
                _session = _req.get('session')
                _ns['args'], _ns['env'] = _req.get('args') or {}, env
                if _session is not None:
                    _base, _loaded, _before, _restored = _session_cell(env)
                try:
                    if _session is not None and _loaded.get('load_error'):
                        raise RuntimeError('python session could not be restored; user code was not executed')
                    result = {'ok': True, 'value': _exec(_req)}
                except (_NeedFile, _NeedAct):
                    raise
                except ActStopped as stopped:
                    result = {'ok': True, 'value': {'stopped': str(stopped)}}
                except BaseException as error:
                    if _session is None:
                        raise
                    # As in a kernel, what ran before the error stays: the namespace is checkpointed either way.
                    result = {'ok': False, 'error': type(error).__name__ + ': ' + str(error),
                              'where': ('line %s' % error.lineno) if isinstance(error, SyntaxError) else _where(error, _req.get('code') or '')}
                if _session is not None:
                    if _loaded.get('load_error'):
                        # The stored checkpoint did not load: no user code ran and it must not be replaced.
                        result['session'] = _loaded
                    else:
                        try:
                            _session_flags['loading'] = True
                            with contextlib.redirect_stdout(io.StringIO()):
                                result['session'] = _session_dump(_req['code'], _session, _base, _before, _restored)
                        except BaseException as error:
                            result['session'] = {'error': (type(error).__name__ + ': ' + str(error))[:200]}
                        finally:
                            _session_flags['loading'] = False
                        result['session'].update({k: v for k, v in _loaded.items() if v})
            else:
                result = {'ok': True, 'value': _call(_req, env)}
        except ActStopped as stopped:
            result = {'ok': True, 'value': {'stopped': str(stopped)}}
        if _ops: result['ops'] = _ops
        return result
    except _NeedFile as error:
        return {'ok': False, 'error': 'workspace file requested', 'need_file': str(error)}
    except _NeedAct as error:
        return {'ok': False, 'error': 'action requested', 'need_act': error.args[0]}
    except BaseException as error:
        return {'ok': False, 'error': type(error).__name__ + ': ' + str(error),
                'where': ('line %s' % error.lineno) if isinstance(error, SyntaxError) else _where(error, _req.get('source') or _req.get('code') or '')}

# What a live kernel sends back per cell: printed text and a final value bounded, so one cell cannot end the kernel by
# its size. The whole value stays in the session as _.
_KERNEL_TEXT = 240_000
def _bounded(result):
    value = result.get('value')
    if isinstance(value, dict) and isinstance(value.get('stdout'), str) and len(value['stdout']) > _KERNEL_TEXT:
        text = value['stdout']
        value['stdout'] = text[:_KERNEL_TEXT // 4] + '\n… <%d of %d printed characters not returned> …\n' % (
            len(text) - _KERNEL_TEXT, len(text)) + text[-(_KERNEL_TEXT * 3 // 4):]
    if isinstance(value, dict) and value.get('has_value'):
        size = len(json.dumps(value.get('value'), allow_nan=False))
        if size > _KERNEL_TEXT:
            value['value'] = '(the final value is %d characters of JSON and was not returned; it is _ in the python session)' % size
    return result

if _kernel['live']:
    _next = _req
    while _next is not None:
        try:
            _out = _bounded(_cell(_next))
        except BaseException as _error:
            _out = {'ok': False, 'error': (type(_error).__name__ + ': ' + str(_error))[:600]}
        _next = _rpc({'t': 'done', 'result': _out})
else:
    result = _cell(_req)
`;

// A python call carries the session checkpoint in and out, so the native guest gets the runtime's largest transport.
const NATIVE_LIMITS = { ...SKILL_LIMITS, input_bytes: 512 * 1024, output_bytes: 256 * 1024 };
const base = arcSkillGuestProgram(NATIVE_LIMITS);
const program = { ...base, source: base.source.split('\n_src =')[0] + NATIVE };
export type ActCall = { action: string; x?: number; y?: number; predict?: unknown };
/** What the guest reports about the python session after a call (arc_thin_python_session.ts commits it). */
export type SessionReport = {
  defs?: Array<[string, string]>; blob?: string; sha?: string; names?: string[]; chars?: number; raw_bytes?: number;
  unchanged?: boolean; functions?: boolean; unsupported?: Array<[string, string]>; uses?: string[];
  /** What the namespace holds after the call: name -> a few characters on what it is; definitions as name() -> "". */
  brief?: Record<string, string>;
  over?: { chars: number; cap: number; raw_bytes: number; largest: Array<[string, number]> };
  error?: string; load_error?: string; failed_defs?: Array<[string, string]>; gone?: string[]; gone_refs?: string[];
};
export type NativeResult = GuestResult & { need_file?: string; need_act?: ActCall; session?: SessionReport;
  ops?: Array<{ op: 'write' | 'move' | 'delete' | 'restore'; path: string; content?: string; destination?: string; version?: number }
    | { op: 'memory'; args: unknown; path?: undefined; destination?: undefined }> };
export async function executeNative(input: Record<string, unknown>, signal?: AbortSignal, pool?: TaskPythonPool,
  onMetrics?: (metrics:Record<string,unknown>)=>void): Promise<NativeResult> {
  const reply = pool ? await pool.evaluate(program, input, signal) : await evaluateTaskPython(program, input, signal);
  onMetrics?.({...reply.consumed, ...(reply as any).transport});
  return reply.value as NativeResult;
}
/** The same guest program as a live kernel: it serves `exec` cells in one namespace until it ends. */
export function nativeKernel(): PythonKernel { return new PythonKernel(program); }
export async function validatePythonComponent(path: string, source: string): Promise<ComponentSpec> {
  const reply = await executeNative({ mode: 'inspect', path, source });
  if (!reply.ok) throw Error([reply.error, reply.where].filter(Boolean).join(' · '));
  return reply.value as ComponentSpec;
}
