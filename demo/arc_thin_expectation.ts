import { parseExpect } from './arc_thin_refiner.ts';

export type HarnessExpectation = { claim: string; within?: number; check: string };
export type ComponentExpectationSource = { source: string; expect?: HarnessExpectation; error?: string };

/** Remove the optional EXPECT trailer before component validation or execution. */
export function splitHarnessExpectation(source: string): ComponentExpectationSource {
  const html = /\r?\n?<!-- HARNESS EXPECT\r?\n([\s\S]*?)\r?\n-->\s*$/.exec(source);
  if (!html) return { source };
  const parsed = parseExpect(html[1]);
  return { source: source.slice(0, html.index).trimEnd() + '\n',
    ...(parsed.expect ? { expect: parsed.expect } : { error: parsed.expectError ?? 'invalid EXPECT block' }) };
}
