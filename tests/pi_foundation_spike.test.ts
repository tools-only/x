import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('installed Pi foundation contracts are probed through RPC without model cost', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-foundation-'));
  const run = spawnSync(process.execPath, ['--experimental-transform-types', 'tools/pi_foundation_spike.ts', root],
    { encoding: 'utf8', timeout: 90000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8'));
  assert.equal(report.piVersion, '0.87.0');
  assert.equal(report.paidTokens, 0);
  assert.equal(report.probes.length, 6);
  for (const probe of report.probes) assert.ok(probe.verified && (probe.pass || probe.workaround), JSON.stringify(probe));
});
