import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePythonComponent, executeNative } from '../demo/arc_thin_components.ts';

test('typed tools derive schemas and execute exact injected sources in isolated fresh WASI', async () => {
  const source = '"""Compare measured values."""\ndef run(x: int, bias: int = 2):\n    from lib.offset import plus\n    return plus(x, bias)\n';
  const spec = await validatePythonComponent('tools/compare.py', source);
  assert.deepEqual(spec.parameters.required, ['x']);
  assert.equal(spec.parameters.properties.x.type, 'integer');
  assert.ok(JSON.stringify(spec.parameters).length <= 400);
  const sources = { 'tools/compare.py': source, 'lib/offset.py': 'def plus(x, y):\n    return x + y\n' };
  const output = await executeNative({ mode: 'call', path: 'tools/compare.py', args: { x: 40 }, sources, state: {} });
  assert.deepEqual(output, { ok: true, value: 42 });
  await assert.rejects(validatePythonComponent('tools/bad.py', 'def run(x):\n    return x\n'), /annotation/);
  await assert.rejects(validatePythonComponent('tools/bad.py', 'def run(x: str)\n    return x\n'), /SyntaxError.*line 1/);
  const blocked = await executeNative({ mode: 'exec', code: "open('../secret')", sources: {}, state: {}, files: {} });
  assert.equal(blocked.ok, false);
  const text = await executeNative({ mode: 'exec', code: "open('notes/a.md').read()", sources: {}, state: {}, files: { 'notes/a.md': 'EXACT' } });
  assert.deepEqual(text.value, { stdout: '', value: 'EXACT', has_value: true });
});
