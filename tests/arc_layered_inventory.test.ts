import assert from "node:assert/strict";
import test from "node:test";
import { boardInventory, recordFrameColorChanges } from "../demo/arc_layered_inventory.ts";

test("boardInventory reports objective pixel counts, component counts, bboxes, and unchanged symbols", () => {
  const g1 = Array.from({ length: 16 }, () => Array(16).fill(0));
  // One 3-pixel cluster of symbol 7 (P)
  g1[5][10] = 7; g1[5][11] = 7; g1[6][10] = 7;
  // Two separate single-pixel clusters of symbol 8 (R)
  g1[2][3] = 8; g1[12][14] = 8;
  // Three separate clusters of symbol 14 (N)
  g1[1][1] = 14; g1[1][5] = 14; g1[1][9] = 14;

  const init = boardInventory(g1);
  assert.match(init.line, /W=248\/1@\(0,0\)-\(15,15\)/);
  assert.match(init.line, /P=3\/1@\(10,5\)-\(11,6\)/);
  assert.match(init.line, /R=2\/2@\(3,2\)-\(3,2\),\(14,12\)-\(14,12\)/);
  assert.match(init.line, /N=3\/3(?=,|$)/);
  assert.deepEqual(init.unchanged, []);

  // Move one R pixel; P and N remain untouched
  const g2 = g1.map(row => [...row]);
  g2[2][3] = 0; g2[2][4] = 8;
  const changed = new Set<number>();
  recordFrameColorChanges(g1, g2, changed);
  const after = boardInventory(g2, changed);
  assert.deepEqual(after.unchanged, ["P", "N"]);
});
