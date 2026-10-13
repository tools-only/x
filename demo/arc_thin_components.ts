/** Python file conventions and execution; syntax inspection itself runs in WASI. */
import { arcSkillGuestProgram, SKILL_LIMITS, type GuestResult } from './arc_thin_skill_guest.ts';
import { evaluateTaskPython } from './pi_task_python.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
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
    off = '# view: off' in head or '# observe: off' in head
    # A view is a tool whose output is shown after every new state (observers/ is the older place for views).
    view = (top == 'observers' or '# view: on' in head) and not off
    if view and 'env.act(' in req['source']:
        raise ValueError('a view runs after every new state and cannot act: remove "# view: on" or the env.act call')
    return {'name': name, 'kind': 'tool', 'description': describe, 'parameters': TOOL_PARAMETERS, 'view': view,
            'enabled': not (top == 'observers' and off)}

_sources = _req.get('sources') or {}
_files = dict(_req.get('files') or {})
_writes = {}
_ops = []
_available = set(_req.get('file_names') or [])
class _NeedFile(BaseException):
    pass
class _StateDict(dict):
    """The runtime's state: a dict, of its own type so the python session can refer to it instead of copying it."""
_state = _StateDict(_req.get('state') or {})
if isinstance(_state.get('history'), dict):
    _state['history'] = _History(_state['history'])

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
        raise _NeedFile(path)
    if any(c in mode for c in 'wax+'):
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
        module.__dict__.update({'state': _state, 'grid': _state.get('grid'), 'history': _state.get('history'),
                                'prev_grid': _state.get('prev_grid'), 'artifacts': _state.get('artifacts') or {}})
        if rel in _sources: exec(compile(_sources[rel], rel, 'exec'), module.__dict__)

def _remove(path):
    path = _path(path)
    if not _req.get('allow_writes') or path.split('/')[0] in ('data', 'results'):
        raise PermissionError('workspace path is read-only in this execution')
    if path not in _files and path not in _sources and path not in _available: raise FileNotFoundError(path)
    _files.pop(path, None)
    _sources.pop(path, None)
    _available.discard(path)
    _ops.append({'op': 'delete', 'path': path})

def _rename(src, dst):
    src, dst = _path(src), _path(dst)
    if not _req.get('allow_writes') or any(p.split('/')[0] in ('data', 'results') for p in (src, dst)):
        raise PermissionError('workspace path is read-only in this execution')
    if src in _available and src not in _files and src not in _sources: raise _NeedFile(src)
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
    """What saved code works with: the state and its history, and act(), which takes one action through the same
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
    def frame(self, n):
        return self.history.grid(n)
    def act(self, action, x=None, y=None, predict=None):
        if _session_flags.get('loading'):
            raise PermissionError('no action while the python session is restored')
        if not _req.get('allow_act'):
            raise PermissionError('only saved code acts: run this with python(save="name") or call a saved tool')
        call = {'action': str(action).upper()}
        if x is not None and y is not None: call.update(x=int(x), y=int(y))
        if predict is not None: call['predict'] = predict
        if self.stopped: raise ActStopped(self.stopped)
        done = _req.get('acts') or []
        if self.acted < len(done):
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
            self.grid = observation['grid']
            return observation
        raise _NeedAct(call)
    def restore(self, path, version):
        """Bring back an earlier version of a harness file (it becomes the newest version)."""
        if not _req.get('allow_writes'): raise PermissionError('workspace path is read-only in this execution')
        _ops.append({'op': 'restore', 'path': _path(path), 'version': int(version)})

# Python session: the default computation workspace (Prime Agent's persistent kernel, adapted to a fresh sandbox per
# call). After every python call the whole user namespace is checkpointed, so in-place changes, deletions, common
# types and shared references survive, and nothing has to be saved by hand.
#   - Values are pickled inside the sandbox; the host stores the bytes and never unpickles them.
#   - Functions and classes are re-run from the source of their def/class statement, in the order they were first
#     defined, with acting, workspace writes and printing disabled: restoring never repeats an environment action.
#   - The runtime's own objects (state, history, env) are never stored; a value that refers to one is re-attached to
#     the current one. The names the runtime provides (grid, state, ...) are rebuilt from canonical history each call.
#   - What cannot be kept is reported by name with the reason. Nothing is dropped silently.
import pickle, zlib, base64, hashlib, types, textwrap, contextlib

_SESSION_SKIP = {'state', 'grid', 'history', 'prev_grid', 'artifacts', 'skill', 'args', 'env', 'ActStopped'}
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
_helpers = types.ModuleType('_arc_session')
for _helper in (_runtime_ref, _module_ref, _transition, _Gone):
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
        return NotImplemented

class _SessionUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        try:
            return super().find_class(module, name)
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
                    exec(compile(src, '<session %s>' % name, 'exec'), _ns)
                    _session_defs[name] = src
                except _NeedFile:
                    raise
                except BaseException as problem:
                    report['failed_defs'].append([name, (type(problem).__name__ + ': ' + str(problem))[:120]])
    finally:
        _session_flags['loading'] = False
        del _ops[mark:]
    blob = session.get('blob')
    if blob:
        try:
            values = _SessionUnpickler(io.BytesIO(zlib.decompress(base64.b64decode(blob)))).load()
        except BaseException as problem:
            report['load_error'] = (type(problem).__name__ + ': ' + str(problem))[:200]
            return report
        for name in [k for k, v in values.items() if v is _Gone or isinstance(v, _Gone)]:
            del values[name]
            report['gone'].append(name)
        if report['gone']:
            report['gone_refs'] = sorted(set(_session_gone))[:8]
        _ns.update(values)
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
    values = {k: _ns[k] for k in _ns if not k.startswith('_') and k not in base and k not in _SESSION_SKIP and k not in _session_defs}
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
    out = {'unsupported': unsupported, 'uses': uses}
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
    out.update({'defs': defs, 'blob': packed, 'sha': sha, 'names': sorted(values), 'chars': chars, 'raw_bytes': len(raw)})
    return out

def _call(req, env):
    """One contract for every tool: a dict of arguments. A script reads args and env; run(args[, env]) is called with
    them; an older run(**kwargs), run(state, args) or observe(state) keeps working."""
    source = _sources.get(req['path'], '')
    inner = (req.get('args') or {}).get('args') or {}
    entry = _entry(ast.parse(source, req['path']))
    if entry is None:
        req['code'] = source
        _ns['args'], _ns['env'] = inner, env
        return _exec(req)
    module = __import__(req['path'][:-3].replace('/', '.'), fromlist=['*'])
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

try:
    if _req['mode'] == 'inspect':
        result = {'ok': True, 'value': _inspect(_req)}
    else:
        builtins.open = _open
        import os, random
        os.remove = os.unlink = _remove
        os.rename = os.replace = _rename
        os.listdir = _listdir
        os.path.isdir, os.path.isfile = _isdir, _isfile
        os.path.exists = lambda path: _isfile(path) or _isdir(path)
        sys.meta_path.insert(0, _Loader())
        # Acting code is replayed from the start after every action, so it must be deterministic.
        random.seed(0)
        _req['state'] = _state
        env = _Env()
        _ns['ActStopped'] = ActStopped
        try:
            if _req['mode'] == 'exec':
                _session = _req.get('session')
                if _session is not None:
                    _session_module()
                _ns['args'], _ns['env'] = _req.get('args') or {}, env
                if _session is not None:
                    _ns.update({'state': _state, 'grid': _state.get('grid'), 'history': _state.get('history'),
                                'prev_grid': _state.get('prev_grid'), 'artifacts': _state.get('artifacts') or {}})
                    _runtime.update({'state': _state, 'history': _state.get('history'), 'env': env})
                    _base = set(_ns)
                    _loaded = _session_load(_session)
                    _before = {name: id(_ns.get(name)) for name in _session_defs}
                    _restored = set(_ns) - _base
                    _req['session_ns'] = True
                try:
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
                        # The stored checkpoint did not load: this call ran without it and must not replace it.
                        result['session'] = _loaded
                    else:
                        try:
                            result['session'] = _session_dump(_req['code'], _session, _base, _before, _restored)
                        except BaseException as error:
                            result['session'] = {'error': (type(error).__name__ + ': ' + str(error))[:200]}
                        result['session'].update({k: v for k, v in _loaded.items() if v})
            else:
                result = {'ok': True, 'value': _call(_req, env)}
        except ActStopped as stopped:
            result = {'ok': True, 'value': {'stopped': str(stopped)}}
        if _ops: result['ops'] = _ops
except _NeedFile as error:
    result = {'ok': False, 'error': 'workspace file requested', 'need_file': str(error)}
except _NeedAct as error:
    result = {'ok': False, 'error': 'action requested', 'need_act': error.args[0]}
except BaseException as error:
    result = {'ok': False, 'error': type(error).__name__ + ': ' + str(error),
              'where': ('line %s' % error.lineno) if isinstance(error, SyntaxError) else _where(error, _req.get('source') or _req.get('code') or '')}
`;

// A python call carries the session checkpoint in and out, so the native guest gets the runtime's largest transport.
const NATIVE_LIMITS = { ...SKILL_LIMITS, input_bytes: 512 * 1024, output_bytes: 256 * 1024 };
const base = arcSkillGuestProgram(NATIVE_LIMITS);
const program = { ...base, source: base.source.split('\n_src =')[0] + NATIVE };
export type ActCall = { action: string; x?: number; y?: number; predict?: unknown };
/** What the guest reports about the python session after a call (arc_thin_python_session.ts commits it). */
export type SessionReport = {
  defs?: Array<[string, string]>; blob?: string; sha?: string; names?: string[]; chars?: number; raw_bytes?: number;
  unchanged?: boolean; unsupported?: Array<[string, string]>; uses?: string[];
  over?: { chars: number; cap: number; raw_bytes: number; largest: Array<[string, number]> };
  error?: string; load_error?: string; failed_defs?: Array<[string, string]>; gone?: string[]; gone_refs?: string[];
};
export type NativeResult = GuestResult & { need_file?: string; need_act?: ActCall; session?: SessionReport;
  ops?: Array<{ op: 'write' | 'move' | 'delete' | 'restore'; path: string; content?: string; destination?: string; version?: number }> };
export async function executeNative(input: Record<string, unknown>, signal?: AbortSignal, pool?: TaskPythonPool,
  onMetrics?: (metrics:Record<string,unknown>)=>void): Promise<NativeResult> {
  const reply = pool ? await pool.evaluate(program, input, signal) : await evaluateTaskPython(program, input, signal);
  onMetrics?.({...reply.consumed, ...(reply as any).transport});
  return reply.value as NativeResult;
}
export async function validatePythonComponent(path: string, source: string): Promise<ComponentSpec> {
  const reply = await executeNative({ mode: 'inspect', path, source });
  if (!reply.ok) throw Error([reply.error, reply.where].filter(Boolean).join(' · '));
  return reply.value as ComponentSpec;
}
