import test from 'node:test';
import assert from 'node:assert/strict';
import { providerPermit } from '../demo/provider_permit.ts';
import { coverageFacts } from '../demo/self_root_ppt.ts';

test('request liability follows actual payload and output, not registered maximum', () => {
  const model = {contextWindow:175000,maxTokens:65536}, rates = {input:20,output:80};
  const p = providerPermit({messages:[{role:'user',content:'OK'}],max_completion_tokens:65536},model,8192,rates);
  assert.equal(p.payload.max_completion_tokens,8192);
  assert.ok(p.tokens < 13000); assert.ok(p.usd < 0.75);
  assert.ok(providerPermit({messages:['x'.repeat(30000)]},model,8192,rates).tokens > p.tokens);
  assert.throws(() => providerPermit({},model,65537,rates),/envelope/);
});

test('normalized observations respect whole number, polarity and citation scope', () => {
  const units = [{id:'u',title:'fixture',citation:'Source page 4',required:['$8,838','$1,621','3.0%','$5']}];
  const [r] = coverageFacts('<section>millions 8,838 (1,621) 13.0% p.4</section><section>$5 Source page 7</section>',units);
  assert.equal(r.citation_literal.found,false);
  assert.equal(r.normalized.citation_found,true);
  assert.deepEqual(r.normalized.matches.map(m=>m.found),[true,false,false,false]);
  assert.equal(coverageFacts('<section>$8,838 p.40</section>',units)[0].normalized.citation_found,false);
  const nested = coverageFacts('<div class="slide"><div>8,838</div>p.4</div><div class="slide">$5 p.7</div>',units)[0];
  assert.equal(nested.normalized.scope,'slide_elements');
  assert.deepEqual(nested.normalized.matches.map(m=>m.found),[true,false,false,false]);
});
