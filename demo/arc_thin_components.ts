/** Python file conventions and execution; syntax inspection itself runs in WASI. */
import { arcSkillGuestProgram, SKILL_LIMITS, type GuestResult } from './arc_thin_skill_guest.ts';
import { evaluateTaskPython } from './pi_task_python.ts';
import { TaskPythonPool } from './pi_task_python_pool.ts';
import type { ComponentSpec } from './arc_thin_binder.ts';

const NATIVE = String.raw`
import ast, io, sys, importlib.abc, importlib.util, builtins

def _schema(node):
    if isinstance(node, ast.Name):
        names = {'int': 'integer', 'float': 'number', 'str': 'string', 'bool': 'boolean', 'list': 'array', 'dict': 'object'}
        if node.id in names:
            return {'type': names[node.id]}
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        if node.value.id == 'list':
            return {'type': 'array', 'items': _schema(node.slice)}
        if node.value.id == 'dict' and isinstance(node.slice, ast.Tuple) and len(node.slice.elts) == 2 and ast.unparse(node.slice.elts[0]) == 'str':
            return {'type': 'object', 'additionalProperties': _schema(node.slice.elts[1])}
    raise ValueError('unsupported or missing parameter annotation: ' + (ast.unparse(node) if node is not None else '(missing)'))

def _inspect(req):
    path = req['path']
    name = path.split('/')[-1][:-3]
    tree = ast.parse(req['source'], path)
    kind = {'tools': 'tool', 'observers': 'observer', 'lib': 'library'}[path.split('/')[0]]
    if kind == 'tool' and name in ('arc_action', 'read', 'write', 'edit', 'ls', 'grep', 'python', 'memory', 'consult', 'run_skill'):
        raise ValueError('tool name is reserved by the foundation')
    spec = {'name': name, 'kind': kind, 'description': (ast.get_docstring(tree) or name).splitlines()[0][:120],
            'enabled': not (kind == 'observer' and any(line.strip() == '# observe: off' for line in req['source'].splitlines()[:10]))}
    if kind == 'library':
        return spec
    functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith('_')]
    entry = 'run' if kind == 'tool' else 'observe'
    if len(functions) != 1 or functions[0].name != entry or not isinstance(functions[0], ast.FunctionDef):
        raise ValueError('define one public function ' + entry)
    fn = functions[0]
    if fn.decorator_list or fn.args.vararg or fn.args.kwarg or fn.args.posonlyargs:
        raise ValueError('decorators, variadic and positional-only entry parameters are unsupported')
    if kind == 'observer':
        if len(fn.args.args) != 1 or fn.args.args[0].arg != 'state' or fn.args.kwonlyargs:
            raise ValueError('observer must define observe(state)')
    else:
        args = fn.args.args + fn.args.kwonlyargs
        defaults = [None] * (len(fn.args.args) - len(fn.args.defaults)) + fn.args.defaults + fn.args.kw_defaults
        schema = {'type': 'object', 'properties': {}, 'required': [], 'additionalProperties': False}
        for arg, default in zip(args, defaults):
            schema['properties'][arg.arg] = _schema(arg.annotation)
            if default is None:
                schema['required'].append(arg.arg)
            else:
                ast.literal_eval(default)
        if len(json.dumps(schema, separators=(',', ':'))) > 400:
            raise ValueError('tool schema exceeds 400 chars; simplify the signature')
        spec['parameters'] = schema
    return spec

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

try:
    if _req['mode'] == 'inspect':
        result = {'ok': True, 'value': _inspect(_req)}
    else:
        builtins.open = _open
        import os
        os.remove = os.unlink = _remove
        os.rename = os.replace = _rename
        sys.meta_path.insert(0, _Loader())
        if _req['mode'] == 'exec':
            _req['state'] = _state
            result = {'ok': True, 'value': _exec(_req)}
        else:
            module = __import__(_req['path'][:-3].replace('/', '.'), fromlist=['*'])
            value = module.observe(_state) if _req['mode'] == 'observe' else module.run(**(_req.get('args') or {}))
            result = {'ok': True, 'value': _jsonable(value)}
        if _ops: result['ops'] = _ops
except _NeedFile as error:
    result = {'ok': False, 'error': 'workspace file requested', 'need_file': str(error)}
except BaseException as error:
    result = {'ok': False, 'error': type(error).__name__ + ': ' + str(error),
              'where': ('line %s' % error.lineno) if isinstance(error, SyntaxError) else _where(error, _req.get('source') or _req.get('code') or '')}
`;

const base = arcSkillGuestProgram(SKILL_LIMITS);
const program = { ...base, source: base.source.split('\n_src =')[0] + NATIVE };
export type NativeResult = GuestResult & { need_file?: string; ops?: Array<{ op: 'write' | 'move' | 'delete'; path: string; content?: string; destination?: string }> };
export async function executeNative(input: Record<string, unknown>, signal?: AbortSignal, pool?: TaskPythonPool): Promise<NativeResult> {
  const reply = pool ? await pool.evaluate(program, input, signal) : await evaluateTaskPython(program, input, signal);
  return reply.value as NativeResult;
}
export async function validatePythonComponent(path: string, source: string): Promise<ComponentSpec> {
  const reply = await executeNative({ mode: 'inspect', path, source });
  if (!reply.ok) throw Error([reply.error, reply.where].filter(Boolean).join(' · '));
  return reply.value as ComponentSpec;
}
