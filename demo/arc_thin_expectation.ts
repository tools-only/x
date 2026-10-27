import { parseExpect } from './arc_thin_refiner.ts';

export type HarnessExpectation = { claim: string; within?: number; check: string };
export type ComponentExpectationSource = { source: string; expect?: HarnessExpectation; error?: string };

/**
 * Remove the optional EXPECT trailer before component validation or execution. In a .py file the trailer may be written as
 * comment lines ("# <!-- HARNESS EXPECT" … "# -->"), since an HTML comment is not Python: in E1 G1-B (2026-10-26) the
 * agent's one tool kept its trailer as comments, and its expectation was never recorded.
 */
export function splitHarnessExpectation(source: string): ComponentExpectationSource {
  const html = /\r?\n?<!-- HARNESS EXPECT\r?\n([\s\S]*?)\r?\n-->\s*$/.exec(source)
    ?? /(?:^|\r?\n)[ \t]*#[ \t]?<!-- HARNESS EXPECT\r?\n((?:[ \t]*#[^\r\n]*\r?\n)*?)[ \t]*#[ \t]?-->\s*$/.exec(source);
  if (!html) return { source };
  const commented = !html[0].trimStart().startsWith('<!--');
  const body = commented ? html[1].split(/\r?\n/).map(line => line.replace(/^[ \t]*#[ \t]?/, '')).join('\n') : html[1];
  const parsed = parseExpect(body);
  return { source: source.slice(0, html.index).trimEnd() + '\n',
    ...(parsed.expect ? { expect: parsed.expect } : { error: parsed.expectError ?? 'invalid EXPECT block' }) };
}
