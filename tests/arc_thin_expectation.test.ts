import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitHarnessExpectation } from '../demo/arc_thin_expectation.ts';

// E1b (2026-10-27): in G1-B none of the agent's six EXPECT checks ran (" def check(t):" with a leading space) and its one
// tool kept its trailer as Python comments, unrecorded.

test('an EXPECT check is taken with its shared indentation off', () => {
  const split = splitHarnessExpectation('---\nactive: true\n---\nAvoid probes.\n\n<!-- HARNESS EXPECT\n' +
    'EXPECT within 3 actions: no ACTION7 probe\n def check(t):\n    return t["action"] != "ACTION7"\nEND\n-->\n');
  assert.equal(split.source, '---\nactive: true\n---\nAvoid probes.\n');
  assert.equal(split.expect?.claim, 'no ACTION7 probe');
  assert.equal(split.expect?.check, 'def check(t):\n   return t["action"] != "ACTION7"\n');
});

test('in a .py file the trailer may be written as comment lines', () => {
  const split = splitHarnessExpectation('def after(state, t):\n    return 1\n# <!-- HARNESS EXPECT\n' +
    '# EXPECT within 4 actions: the map is shown\n# def check(t):\n#     return True\n# END\n# -->\n');
  assert.equal(split.source, 'def after(state, t):\n    return 1\n');
  assert.deepEqual(split.expect, { claim: 'the map is shown', within: 4, check: 'def check(t):\n    return True\n' });
  assert.deepEqual(splitHarnessExpectation('x = 1\n# a comment\n'), { source: 'x = 1\n# a comment\n' });
});
