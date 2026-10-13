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
_state = _req.get('state') or {}
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

# Python session (Prime Agent's persistent kernel, adapted: each call still runs in a fresh sandbox). What a python call
# defines at top level stays available to later calls: imports, functions and classes are re-run from their source,
# JSON values are restored. Names starting with _ and the runtime's own names are not kept.
_SESSION_SKIP = {'state', 'grid', 'history', 'prev_grid', 'artifacts', 'skill', 'args', 'env', 'ActStopped'}
_SESSION_VALUE_CHARS = 16000

def _session_load(session):
    failed = []
    for name, src in (session.get('defs') or {}).items():
        try:
            exec(compile(src, '<session %s>' % name, 'exec'), _ns)
        except BaseException:
            failed.append(name)
    _ns.update(session.get('vars') or {})
    return failed

def _session_delta(code):
    import json
    tree = ast.parse(code)
    ns = globals().get('_last_ns') or {}
    defs, values, dropped, assigned, total = {}, {}, [], [], 0
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            src = ast.get_source_segment(code, node)
            if src: defs['import: ' + src] = src
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            src = ast.get_source_segment(code, node)
            if src and node.name in ns:
                head = ''.join('@' + ast.get_source_segment(code, d) + '\n' for d in node.decorator_list)
                defs[node.name] = head + src
        else:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store) and sub.id not in assigned:
                    assigned.append(sub.id)
    for name in assigned:
        if name.startswith('_') or name in _SESSION_SKIP or name not in ns or name in defs:
            continue
        value = ns[name]
        if callable(value) or type(value).__name__ == 'module':
            continue
        try:
            text = json.dumps(value)
        except (TypeError, ValueError):
            dropped.append(name)
            continue
        if len(text) > _SESSION_VALUE_CHARS or total + len(text) > 3 * _SESSION_VALUE_CHARS:
            dropped.append(name)
            continue
        total += len(text)
        values[name] = json.loads(text)
    return {'defs': defs, 'vars': values, 'dropped': dropped}

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
                _ns['args'], _ns['env'] = _req.get('args') or {}, env
                _session = _req.get('session')
                if _session is not None:
                    _ns.update({'state': _state, 'grid': _state.get('grid'), 'history': _state.get('history'),
                                'prev_grid': _state.get('prev_grid'), 'artifacts': _state.get('artifacts') or {}})
                    _session_failed = _session_load(_session)
                    _req['session_ns'] = True
                result = {'ok': True, 'value': _exec(_req)}
                if _session is not None:
                    result['session'] = _session_delta(_req['code'])
                    if _session_failed: result['session']['failed'] = _session_failed
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

const base = arcSkillGuestProgram(SKILL_LIMITS);
const program = { ...base, source: base.source.split('\n_src =')[0] + NATIVE };
export type ActCall = { action: string; x?: number; y?: number; predict?: unknown };
export type SessionDelta = { defs: Record<string, string>; vars: Record<string, unknown>; dropped: string[]; failed?: string[] };
export type NativeResult = GuestResult & { need_file?: string; need_act?: ActCall; session?: SessionDelta;
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
